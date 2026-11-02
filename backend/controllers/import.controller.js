// ============================================================
//  MAIFA-AUTO — IMPORT ET EXPORT EN MASSE
//
//  Parcours en deux temps, volontairement :
//
//    1. ANALYSER   le fichier est lu, rapproché du référentiel et
//                  enregistré comme lot. RIEN n'est écrit au stock.
//    2. APPLIQUER  après que le gestionnaire a vu ce qui va se
//                  passer et corrigé ce qui doit l'être.
//
//  Importer 300 lignes à l'aveugle dans un catalogue est le genre
//  d'opération qu'on ne sait pas annuler. D'où la prévisualisation
//  obligatoire, et l'application entière dans une seule transaction :
//  soit tout passe, soit rien ne bouge.
// ============================================================

const db = require('../db');
const excel = require('../services/excel.service');
const rapprochement = require('../services/rapprochement.service');
const analyse = require('../services/import.service');
const reference = require('../services/reference.service');

/** Colonnes images de la table pieces, dans l'ordre de remplissage */
const COLONNES_IMAGES = ['img_principale', 'img1', 'img2', 'img3', 'img4'];

// ------------------------------------------------------------
//  CHARGEMENT DU RÉFÉRENTIEL
// ------------------------------------------------------------

/**
 * Charge marques, modèles et catégories, puis construit l'index de
 * rapprochement. Une seule fois par import, pas une fois par ligne.
 */
async function chargerIndex(connexion = db) {
  const [marques] = await connexion.query('SELECT id, nom FROM marques ORDER BY nom');
  const [modeles] = await connexion.query('SELECT id, modele, id_marque FROM modeles');
  const [categories] = await connexion.query(
    'SELECT id, nom, slug, id_parent FROM categories ORDER BY ordre, nom',
  );

  return {
    index: rapprochement.construireIndex({ marques, modeles, categories }),
    marques,
    modeles,
    categories,
  };
}

/**
 * Met le référentiel en forme pour les listes déroulantes d'Excel.
 *
 * Les couples sont aplatis en libellés : le fichier produit ne
 * connaît aucun identifiant, et le rapprochement sait retrouver une
 * catégorie aussi bien par son nom que par son slug.
 *
 * Partagé par le gabarit vierge et par l'export, pour que les deux
 * proposent exactement les mêmes choix.
 */
function listesReferentiel({ marques = [], modeles = [], categories = [] }) {
  const nomMarque = new Map(marques.map((m) => [m.id, m.nom]));
  const parents = categories.filter((c) => c.id_parent === null);
  const nomParent = new Map(parents.map((c) => [c.id, c.nom]));

  return {
    marques: marques.map((m) => m.nom),
    categories: parents.map((c) => c.nom),

    // Une sous-catégorie orpheline (parent supprimé) est écartée :
    // elle rendrait sa ligne de la cascade inatteignable.
    sousCategories: categories
      .filter((c) => c.id_parent !== null && nomParent.has(c.id_parent))
      .map((c) => ({ parent: nomParent.get(c.id_parent), nom: c.nom })),

    modeles: modeles
      .filter((mo) => nomMarque.has(mo.id_marque))
      .map((mo) => ({ marque: nomMarque.get(mo.id_marque), modele: mo.modele })),

    etats: analyse.ETATS_CONNUS,
  };
}

/** Le stock existant, réduit à ce qui sert à identifier une pièce */
async function chargerPiecesBase(connexion = db) {
  const [rows] = await connexion.query('SELECT id, ref_interne, ref_oe, description FROM pieces');
  return rows;
}

// ------------------------------------------------------------
//  1. GET /api/import/modele
//     Le gabarit, rempli des listes réelles du référentiel
// ------------------------------------------------------------
exports.telechargerModele = async (req, res) => {
  try {
    const tampon = await excel.modeleVierge(listesReferentiel(await chargerIndex()));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="modele-import-MAIFA-AUTO.xlsx"');
    res.send(Buffer.from(tampon));
  } catch (erreur) {
    console.error('Erreur génération du modèle :', erreur);
    res.status(500).json({ message: 'Impossible de générer le modèle.' });
  }
};

// ------------------------------------------------------------
//  2. POST /api/import/analyser
//     Téléversement, analyse, enregistrement du lot
// ------------------------------------------------------------
exports.analyser = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Aucun fichier reçu.' });
  }

  const connexion = await db.getConnection();

  try {
    // --- Lecture -------------------------------------------------
    let fichier;
    try {
      fichier = await excel.lire(req.file.buffer);
    } catch (erreur) {
      console.error('Fichier illisible :', erreur.message);
      return res.status(400).json({
        message:
          'Fichier illisible. Vérifiez qu il s agit bien d un classeur Excel (.xlsx) non protégé par mot de passe.',
      });
    }

    if (fichier.pieces.length === 0 && fichier.compatibilites.length === 0) {
      return res.status(400).json({
        message: 'Le fichier ne contient aucune ligne exploitable.',
        anomalies: fichier.anomalies,
      });
    }

    // Une anomalie bloquante rend l'analyse inutile
    const bloquantes = fichier.anomalies.filter((a) => a.gravite === 'bloquant');
    if (bloquantes.length) {
      return res.status(400).json({
        message: 'Le fichier ne peut pas être analysé en l état.',
        anomalies: fichier.anomalies,
      });
    }

    // --- Analyse --------------------------------------------------
    const { index } = await chargerIndex(connexion);
    const piecesBase = await chargerPiecesBase(connexion);
    const rapport = analyse.analyser(fichier, { index, piecesBase });

    // --- Enregistrement du lot -------------------------------------
    await connexion.beginTransaction();

    const [lot] = await connexion.query(
      `INSERT INTO import_lots
         (nom_fichier, taille_octets, id_utilisateur, statut,
          nb_pieces, nb_compat, nb_creations, nb_maj, nb_anomalies, anomalies)
       VALUES (?, ?, ?, 'analyse', ?, ?, ?, ?, ?, ?)`,
      [
        req.file.originalname?.slice(0, 255) || 'import.xlsx',
        req.file.size || null,
        req.utilisateur?.id ?? null,
        rapport.synthese.pieces.total,
        rapport.synthese.compatibilites.total,
        rapport.synthese.pieces.creations,
        rapport.synthese.pieces.mises_a_jour,
        rapport.synthese.pieces.anomalies + rapport.synthese.compatibilites.anomalies,
        JSON.stringify(rapport.anomalies_fichier),
      ],
    );

    const idLot = lot.insertId;

    if (rapport.lignes.length) {
      await connexion.query(
        `INSERT INTO import_lignes
           (id_lot, onglet, ligne_fichier, statut, action, donnees, resolution, messages, id_piece)
         VALUES ?`,
        [
          rapport.lignes.map((l) => [
            idLot,
            l.onglet,
            l.ligne_fichier,
            l.statut,
            l.action,
            JSON.stringify(l.donnees),
            JSON.stringify(l.resolution),
            JSON.stringify(l.messages),
            l.id_piece,
          ]),
        ],
      );
    }

    await connexion.commit();

    res.status(201).json({
      id_lot: idLot,
      fichier: req.file.originalname,
      synthese: rapport.synthese,
      anomalies_fichier: rapport.anomalies_fichier,
      lignes: await relireLignes(connexion, idLot),
    });
  } catch (erreur) {
    await connexion.rollback().catch(() => {});
    console.error('Erreur analyse import :', erreur);
    res.status(500).json({ message: 'Erreur pendant l analyse du fichier.' });
  } finally {
    connexion.release();
  }
};

/** Relit les lignes d'un lot, JSON déjà décodé */
async function relireLignes(connexion, idLot) {
  const [rows] = await connexion.query(
    `SELECT id, onglet, ligne_fichier, statut, action, donnees, resolution, messages, id_piece
       FROM import_lignes
      WHERE id_lot = ?
      ORDER BY onglet, ligne_fichier`,
    [idLot],
  );

  const decoder = (v, defaut) => {
    if (v === null || v === undefined) return defaut;
    try {
      return JSON.parse(v);
    } catch {
      return defaut;
    }
  };

  return rows.map((r) => ({
    ...r,
    donnees: decoder(r.donnees, {}),
    resolution: decoder(r.resolution, {}),
    messages: decoder(r.messages, []),
  }));
}

// ------------------------------------------------------------
//  3. GET /api/import/lots/:id
// ------------------------------------------------------------
exports.lireLot = async (req, res) => {
  try {
    const [[lot]] = await db.query('SELECT * FROM import_lots WHERE id = ?', [req.params.id]);
    if (!lot) return res.status(404).json({ message: 'Lot introuvable.' });

    const connexion = await db.getConnection();
    try {
      const lignes = await relireLignes(connexion, lot.id);
      res.json({ lot, lignes });
    } finally {
      connexion.release();
    }
  } catch (erreur) {
    console.error('Erreur lecture lot :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture du lot.' });
  }
};

// ------------------------------------------------------------
//  4. PATCH /api/import/lots/:id/lignes/:idLigne
//     Le gestionnaire tranche une ambiguïté, ou écarte une ligne
// ------------------------------------------------------------
exports.corrigerLigne = async (req, res) => {
  const { id, idLigne } = req.params;
  const { id_modele, id_categorie, id_sous_categorie, ignorer } = req.body;

  const connexion = await db.getConnection();

  try {
    await connexion.beginTransaction();

    const [[lot]] = await connexion.query(
      'SELECT id, statut FROM import_lots WHERE id = ? FOR UPDATE',
      [id],
    );
    if (!lot) {
      await connexion.rollback();
      return res.status(404).json({ message: 'Lot introuvable.' });
    }
    if (lot.statut !== 'analyse') {
      await connexion.rollback();
      return res.status(409).json({
        message: 'Ce lot a déjà été appliqué, il ne peut plus être modifié.',
      });
    }

    const [[ligne]] = await connexion.query(
      'SELECT * FROM import_lignes WHERE id = ? AND id_lot = ?',
      [idLigne, id],
    );
    if (!ligne) {
      await connexion.rollback();
      return res.status(404).json({ message: 'Ligne introuvable dans ce lot.' });
    }

    let resolution = {};
    let messages = [];
    try {
      resolution = JSON.parse(ligne.resolution || '{}');
      messages = JSON.parse(ligne.messages || '[]');
    } catch {
      /* contenu illisible : on repart d'une résolution vide */
    }

    // --- Mise à l'écart -------------------------------------------
    if (ignorer === true) {
      await connexion.query('UPDATE import_lignes SET statut = ? WHERE id = ?', [
        'ignoree',
        idLigne,
      ]);
      await connexion.commit();
      return res.json({ message: 'Ligne écartée de l import.' });
    }

    // --- Choix du modèle -------------------------------------------
    if (id_modele !== undefined) {
      const [[modele]] = await connexion.query(
        `SELECT mo.id, mo.modele, ma.id AS id_marque, ma.nom AS marque
           FROM modeles mo JOIN marques ma ON ma.id = mo.id_marque
          WHERE mo.id = ?`,
        [id_modele],
      );
      if (!modele) {
        await connexion.rollback();
        return res.status(400).json({ message: 'Modèle inconnu.' });
      }

      resolution.id_modele = modele.id;
      resolution.modele = modele.modele;
      resolution.id_marque = modele.id_marque;
      resolution.marque = modele.marque;
      delete resolution.modele_suggere;
      delete resolution.marque_suggeree;
      delete resolution.candidats_modele;

      messages = messages.filter((m) => m.champ !== 'modele' && m.champ !== 'marque');
    }

    // --- Choix de la catégorie --------------------------------------
    for (const [champ, valeur] of [
      ['id_categorie', id_categorie],
      ['id_sous_categorie', id_sous_categorie],
    ]) {
      if (valeur === undefined) continue;

      if (valeur === null) {
        delete resolution[champ];
      } else {
        const [[cat]] = await connexion.query('SELECT id, nom, slug FROM categories WHERE id = ?', [
          valeur,
        ]);
        if (!cat) {
          await connexion.rollback();
          return res.status(400).json({ message: 'Catégorie inconnue.' });
        }
        resolution[champ] = cat.id;
        if (champ === 'id_categorie') {
          resolution.categorie = cat.slug;
          delete resolution.categorie_suggeree;
        }
      }
      messages = messages.filter(
        (m) => m.champ !== (champ === 'id_categorie' ? 'categorie' : 'sous_categorie'),
      );
    }

    // --- Nouveau statut ----------------------------------------------
    // Une ligne de compatibilité sans modèle reste inapplicable.
    const encoreErreur =
      messages.some((m) => m.gravite === 'erreur') ||
      (ligne.onglet === 'compatibilites' && !resolution.id_modele);

    const statut = encoreErreur
      ? 'anomalie'
      : messages.some((m) => m.gravite === 'avertissement')
        ? 'a_confirmer'
        : 'pret';

    await connexion.query(
      'UPDATE import_lignes SET statut = ?, resolution = ?, messages = ? WHERE id = ?',
      [statut, JSON.stringify(resolution), JSON.stringify(messages), idLigne],
    );

    await connexion.commit();
    res.json({ id: Number(idLigne), statut, resolution, messages });
  } catch (erreur) {
    await connexion.rollback().catch(() => {});
    console.error('Erreur correction de ligne :', erreur);
    res.status(500).json({ message: 'Erreur lors de la correction.' });
  } finally {
    connexion.release();
  }
};

// ------------------------------------------------------------
//  5. POST /api/import/lots/:id/appliquer
//     Écriture réelle, en une seule transaction
// ------------------------------------------------------------
exports.appliquer = async (req, res) => {
  const idLot = req.params.id;
  const connexion = await db.getConnection();

  try {
    await connexion.beginTransaction();

    // Verrou sur le lot : deux clics sur « Appliquer » ne doivent
    // pas produire deux imports.
    const [[lot]] = await connexion.query('SELECT * FROM import_lots WHERE id = ? FOR UPDATE', [
      idLot,
    ]);

    if (!lot) {
      await connexion.rollback();
      return res.status(404).json({ message: 'Lot introuvable.' });
    }
    if (lot.statut !== 'analyse') {
      await connexion.rollback();
      return res.status(409).json({
        message: lot.statut === 'applique' ? 'Ce lot a déjà été appliqué.' : 'Ce lot a été annulé.',
      });
    }

    const lignes = await relireLignes(connexion, idLot);

    const applicables = lignes.filter((l) => l.statut === 'pret' || l.statut === 'a_confirmer');

    const lignesPieces = applicables.filter((l) => l.onglet === 'pieces');
    const lignesCompat = applicables.filter((l) => l.onglet === 'compatibilites');

    const rapport = {
      pieces_creees: 0,
      pieces_mises_a_jour: 0,
      compatibilites_ajoutees: 0,
      compatibilites_ignorees: 0,
      brouillons: 0,
      non_appliquees: [],
      references_attribuees: [],
    };

    // --- Réservation des références ------------------------------
    // Un seul verrou pour toutes les créations du lot, plutôt qu un
    // verrou par pièce.
    const creations = lignesPieces.filter((l) => l.action === 'creation');
    const referencesLibres = creations.length
      ? await reference.reserver(connexion, creations.length)
      : [];
    let curseurReference = 0;

    // Correspondance ligne du fichier → identifiant de pièce, pour
    // rattacher les compatibilités aux pièces créées à l instant.
    const idParLigne = new Map();

    // --- Pièces ----------------------------------------------------
    for (const l of lignesPieces) {
      const d = l.donnees;
      const r = l.resolution;

      // Les photos fournies par adresse web sont stockées telles
      // quelles. Sans photo, la pièce entre en brouillon : elle
      // existe au stock mais n apparaît dans aucun catalogue.
      const images = Array.isArray(r.url_images) ? r.url_images.slice(0, 5) : [];
      const brouillon = images.length === 0;

      if (l.action === 'creation') {
        const refInterne = referencesLibres[curseurReference++];

        const colonnes = {
          ref_interne: refInterne,
          description: String(d.description || '').slice(0, 65535),
          categorie: r.categorie ?? null,
          id_categorie: r.id_categorie ?? null,
          id_sous_categorie: r.id_sous_categorie ?? null,
          fournisseur: d.fournisseur || null,
          prix: typeof d.prix === 'number' ? d.prix : null,
          etat: r.etat || null,
          quantite: d.quantite ?? 0,
          seuil_alerte: r.seuil_alerte ?? analyse.SEUIL_ALERTE_DEFAUT,
          visible_catalogue: brouillon ? 0 : 1,
          ref_oe: r.ref_oe ?? null,
        };

        COLONNES_IMAGES.forEach((col, i) => {
          colonnes[col] = images[i] || null;
        });

        const champs = Object.keys(colonnes);
        const [resultat] = await connexion.query(
          `INSERT INTO pieces (${champs.join(', ')})
           VALUES (${champs.map(() => '?').join(', ')})`,
          champs.map((c) => colonnes[c]),
        );

        idParLigne.set(l.ligne_fichier, resultat.insertId);
        rapport.pieces_creees++;
        if (brouillon) rapport.brouillons++;
        rapport.references_attribuees.push({
          ligne: l.ligne_fichier,
          ref_interne: refInterne,
          description: colonnes.description,
        });

        await connexion.query('UPDATE import_lignes SET id_piece = ? WHERE id = ?', [
          resultat.insertId,
          l.id,
        ]);
      } else if (l.action === 'maj' && l.id_piece) {
        // Mise à jour partielle : une cellule vide dans le fichier
        // signifie « ne pas toucher », jamais « effacer ».
        const majs = {};

        if (String(d.description || '').trim()) majs.description = d.description;
        if (typeof d.prix === 'number') majs.prix = d.prix;
        if (d.quantite !== null && d.quantite !== undefined) majs.quantite = d.quantite;
        if (d.seuil_alerte !== null && d.seuil_alerte !== undefined) {
          majs.seuil_alerte = d.seuil_alerte;
        }
        if (r.etat) majs.etat = r.etat;
        if (d.fournisseur) majs.fournisseur = d.fournisseur;
        if (r.ref_oe) majs.ref_oe = r.ref_oe;
        if (r.id_categorie) {
          majs.id_categorie = r.id_categorie;
          majs.categorie = r.categorie;
        }
        if (r.id_sous_categorie) majs.id_sous_categorie = r.id_sous_categorie;

        images.forEach((url, i) => {
          majs[COLONNES_IMAGES[i]] = url;
        });

        if (Object.keys(majs).length) {
          const champs = Object.keys(majs);
          await connexion.query(
            `UPDATE pieces SET ${champs.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
            [...champs.map((c) => majs[c]), l.id_piece],
          );
          rapport.pieces_mises_a_jour++;
        }

        idParLigne.set(l.ligne_fichier, l.id_piece);
      } else {
        rapport.non_appliquees.push({
          onglet: 'pieces',
          ligne: l.ligne_fichier,
          motif: 'Action indéterminée.',
        });
      }
    }

    // --- Compatibilités ---------------------------------------------
    for (const l of lignesCompat) {
      const r = l.resolution;

      const idPiece = r.id_piece ?? (r.ligne_piece ? idParLigne.get(r.ligne_piece) : null);

      if (!idPiece || !r.id_modele) {
        rapport.non_appliquees.push({
          onglet: 'compatibilites',
          ligne: l.ligne_fichier,
          motif: !idPiece ? 'Pièce non identifiée.' : 'Véhicule non identifié.',
        });
        continue;
      }

      // La contrainte uk_compat ne couvre pas les années nulles,
      // deux NULL étant considérés différents par MySQL. On vérifie
      // donc nous-mêmes avant d insérer.
      const [existantes] = await connexion.query(
        `SELECT id FROM piece_compatibilite
          WHERE id_piece = ? AND id_modele = ?
            AND (annee_min <=> ?) AND (annee_max <=> ?)`,
        [idPiece, r.id_modele, r.annee_min ?? null, r.annee_max ?? null],
      );

      if (existantes.length) {
        rapport.compatibilites_ignorees++;
        continue;
      }

      await connexion.query(
        `INSERT INTO piece_compatibilite
           (id_piece, id_modele, annee_min, annee_max, motorisation)
         VALUES (?, ?, ?, ?, ?)`,
        [idPiece, r.id_modele, r.annee_min ?? null, r.annee_max ?? null, r.motorisation ?? null],
      );

      rapport.compatibilites_ajoutees++;

      await connexion.query('UPDATE import_lignes SET id_piece = ? WHERE id = ?', [idPiece, l.id]);
    }

    // --- Clôture du lot ------------------------------------------------
    await connexion.query(
      `UPDATE import_lots
          SET statut = 'applique', date_application = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [idLot],
    );

    await connexion.commit();

    console.log(
      `Import #${idLot} appliqué : ${rapport.pieces_creees} création(s), ` +
        `${rapport.pieces_mises_a_jour} mise(s) à jour, ` +
        `${rapport.compatibilites_ajoutees} compatibilité(s).`,
    );

    res.json({ message: 'Import appliqué.', id_lot: Number(idLot), rapport });
  } catch (erreur) {
    await connexion.rollback().catch(() => {});
    console.error('Erreur application import :', erreur);
    res.status(500).json({
      message:
        'Erreur pendant l application. Aucune modification n a été conservée, le stock est intact.',
      detail: erreur.message,
    });
  } finally {
    connexion.release();
  }
};

// ------------------------------------------------------------
//  6. DELETE /api/import/lots/:id
//     Abandonner un lot analysé mais non appliqué
// ------------------------------------------------------------
exports.annulerLot = async (req, res) => {
  try {
    const [resultat] = await db.query(
      `UPDATE import_lots SET statut = 'annule'
        WHERE id = ? AND statut = 'analyse'`,
      [req.params.id],
    );

    if (resultat.affectedRows === 0) {
      return res.status(409).json({
        message: 'Lot introuvable, ou déjà appliqué.',
      });
    }

    res.json({ message: 'Lot abandonné.' });
  } catch (erreur) {
    console.error('Erreur annulation lot :', erreur);
    res.status(500).json({ message: 'Erreur lors de l abandon du lot.' });
  }
};

// ------------------------------------------------------------
//  7. GET /api/import/export
//     Le stock au format d'import : modifiable dans Excel,
//     réimportable tel quel.
// ------------------------------------------------------------
exports.exporter = async (req, res) => {
  try {
    const referentiel = listesReferentiel(await chargerIndex());

    // Mêmes filtres que l'écran de stock, pour exporter ce que le
    // gestionnaire a sous les yeux plutôt que tout le catalogue.
    const { id_categorie, sans_compat, alerte } = req.query;

    let sql = `
      SELECT p.id, p.ref_interne, p.ref_oe, p.description,
             p.prix, p.quantite, p.seuil_alerte, p.etat,
             p.fournisseur,
             -- Le LIBELLÉ, et non le slug : c'est lui qui figure
             -- dans la liste déroulante. Exporter « freinage » là
             -- où la liste propose « Freinage » ferait sonner la
             -- validation sur chaque ligne du fichier exporté.
             c.nom AS categorie_nom, sc.nom AS sous_categorie_nom
        FROM pieces p
        LEFT JOIN categories c  ON c.id  = p.id_categorie
        LEFT JOIN categories sc ON sc.id = p.id_sous_categorie
       WHERE 1 = 1`;
    const params = [];

    if (id_categorie) {
      sql += ' AND p.id_categorie = ?';
      params.push(id_categorie);
    }
    if (alerte === '1' || alerte === 'true') {
      sql += ' AND p.quantite <= p.seuil_alerte';
    }
    if (sans_compat === '1' || sans_compat === 'true') {
      sql += ' AND NOT EXISTS (SELECT 1 FROM piece_compatibilite pc WHERE pc.id_piece = p.id)';
    }

    sql += ' ORDER BY p.ref_interne, p.id';

    const [pieces] = await db.query(sql, params);

    // Compatibilités des pièces exportées uniquement
    let compatibilites = [];
    if (pieces.length) {
      const [rows] = await db.query(
        `SELECT p.ref_interne, ma.nom AS marque, mo.modele,
                pc.annee_min, pc.annee_max, pc.motorisation
           FROM piece_compatibilite pc
           JOIN pieces  p  ON p.id  = pc.id_piece
           JOIN modeles mo ON mo.id = pc.id_modele
           JOIN marques ma ON ma.id = mo.id_marque
          WHERE pc.id_piece IN (?)
          ORDER BY p.ref_interne, ma.nom, mo.modele`,
        [pieces.map((p) => p.id)],
      );
      compatibilites = rows;
    }

    const tampon = await excel.exporter(pieces, compatibilites, referentiel);

    const horodatage = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stock-MAIFA-AUTO-${horodatage}.xlsx"`,
    );
    res.send(Buffer.from(tampon));
  } catch (erreur) {
    console.error('Erreur export :', erreur);
    res.status(500).json({ message: 'Impossible de générer l export.' });
  }
};

// ------------------------------------------------------------
//  8. GET /api/import/lots
//     Historique, pour la page de gestion
// ------------------------------------------------------------
exports.listerLots = async (req, res) => {
  try {
    const [lots] = await db.query(
      `SELECT l.*, CONCAT(IFNULL(u.prenom, ''), ' ', IFNULL(u.nom, '')) AS gestionnaire
         FROM import_lots l
         LEFT JOIN users u ON u.id = l.id_utilisateur
        ORDER BY l.date_analyse DESC
        LIMIT 50`,
    );
    res.json(lots);
  } catch (erreur) {
    console.error('Erreur historique des imports :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture de l historique.' });
  }
};
