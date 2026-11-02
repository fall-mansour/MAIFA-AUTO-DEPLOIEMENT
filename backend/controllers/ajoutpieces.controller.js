const db = require('../db');
const { nettoyerUploads } = require('../cloudinaryConfig');
const refService = require('../services/reference.service');
const journal = require('../services/journal.service');

// ============================================================
//  COMPATIBILITÉ VÉHICULE : DEUX NIVEAUX DE PRÉCISION
//
//  Une ligne de piece_compatibilite peut désormais être :
//
//    LARGE     id_modele seul. « Cette pièce va sur une Fabia. »
//              C'est le comportement historique, et il ne
//              disparaît pas : beaucoup de pièces vont réellement
//              sur tout un modèle.
//
//    PRÉCISE   id_modele + id_configuration. « Cette pièce va sur
//              la Fabia 1.4 TDI de 2010 à 2012. » La configuration
//              vient d'un numéro de châssis réellement décodé, le
//              plus souvent lors d'une recherche client.
//
//  id_modele reste OBLIGATOIRE dans les deux cas. La colonne est
//  NOT NULL avec une clé étrangère, et c'est elle qui fait
//  remonter la pièce dans les catalogues. Une configuration que le
//  référentiel ne reconnaît pas n'est donc pas rattachable : le
//  contrôleur le dit explicitement au lieu de laisser passer une
//  ligne muette.
// ============================================================
const configurations = require('../services/configuration.service');

/** Transforme les chaînes vides du FormData en NULL SQL */
const nn = (v) => (v === undefined || v === null || v === '' ? null : v);

/** Parse un champ FormData contenant du JSON (tableaux envoyés par le front) */
const parseJson = (valeur, defaut = []) => {
  if (!valeur) return defaut;
  if (Array.isArray(valeur)) return valeur;
  try {
    const parse = JSON.parse(valeur);
    return Array.isArray(parse) ? parse : defaut;
  } catch {
    return defaut;
  }
};

/**
 * Retrouve l'id d'un modèle depuis les libellés texte.
 * Filet de sécurité pour l'ancien formulaire, qui envoie encore
 * "Renault" / "Clio 5" au lieu d'un id_modele.
 */
const resoudreModele = async (conn, marque, modele) => {
  if (!marque || !modele) return null;

  const [rows] = await conn.query(
    `SELECT mo.id
     FROM modeles mo
     JOIN marques ma ON ma.id = mo.id_marque
     WHERE ma.nom = TRIM(?)
       AND REPLACE(mo.modele, ' ', '') = REPLACE(TRIM(?), ' ', '')
     LIMIT 1`,
    [marque, modele],
  );

  return rows.length ? rows[0].id : null;
};

/**
 * Vérifie qu'un couple modèle / configuration est cohérent et
 * réellement rattachable.
 *
 * TROIS CONTRÔLES, et aucun n'est décoratif :
 *
 *   1. le modèle existe au référentiel
 *   2. la configuration existe, si elle est demandée
 *   3. la configuration DÉSIGNE BIEN CE MODÈLE
 *
 * Le troisième évite la faute la plus coûteuse : rattacher la
 * configuration d'une Clio à une ligne qui pointe sur une Fabia
 * produirait une pièce qui remonte sur le mauvais véhicule, et
 * personne ne s'en apercevrait avant qu'un client reçoive la
 * mauvaise pièce.
 *
 * @returns {Promise<{erreur?: string, vehicule?: object, configuration?: object}>}
 */
const validerCible = async (conn, idModele, idConfiguration) => {
  const [[vehicule]] = await conn.query(
    `SELECT mo.id, mo.modele, ma.nom AS marque
       FROM modeles mo JOIN marques ma ON ma.id = mo.id_marque
      WHERE mo.id = ?`,
    [idModele],
  );

  if (!vehicule) {
    return { erreur: 'Ce modèle ne figure pas au référentiel.' };
  }

  if (!idConfiguration) {
    return { vehicule, configuration: null };
  }

  const [[configuration]] = await conn.query('SELECT * FROM vehicule_configuration WHERE id = ?', [
    idConfiguration,
  ]);

  if (!configuration) {
    return { erreur: "Cette version de véhicule n'existe plus." };
  }

  if (!configuration.id_modele) {
    return {
      erreur:
        `${configuration.marque || 'Ce véhicule'} ${configuration.modele || ''}`.trim() +
        " n'est rattaché à aucun modèle de votre référentiel. " +
        'Ajoutez-le aux marques et modèles, puis relancez le rattrapage.',
    };
  }

  if (Number(configuration.id_modele) !== Number(idModele)) {
    return {
      erreur:
        `La version choisie correspond à ${configuration.marque} ${configuration.modele}, ` +
        `pas à ${vehicule.marque} ${vehicule.modele}.`,
    };
  }

  return { vehicule, configuration };
};

/**
 * Reproduit en JavaScript la colonne générée `cle_unicite` de la
 * base, pour écarter les doublons AVANT l'insertion.
 *
 * Pourquoi dupliquer la règle plutôt que laisser MySQL trancher :
 * dans ajouterPiece, toutes les compatibilités sont insérées dans
 * la même transaction que la pièce. Un #1062 sur la troisième
 * ligne annulerait la création entière, images comprises, pour un
 * doublon que le formulaire aurait dû refuser de lui-même.
 *
 * La clé en base reste le filet. Celle-ci est le portier.
 */
const cleLigne = (idPiece, c) =>
  [
    idPiece,
    c.id_modele,
    c.id_configuration || 0,
    c.annee_min || 0,
    c.annee_max || 0,
    // utf8mb4_unicode_ci est insensible à la casse : on s'aligne,
    // sinon le portier laisserait passer ce que le filet refuse.
    String(c.motorisation || '')
      .trim()
      .toUpperCase(),
  ].join('|');

// ==========================================================
//  POST /api/pieces/ajouter
// ==========================================================
exports.ajouterPiece = async (req, res) => {
  console.log("--- Tentative d'ajout de pièce via Cloudinary ---");

  const { description, marque, categorie, modele, annee, fournisseur, prix, etat, quantite } =
    req.body;

  // Référence saisie à la main : c'est une référence FOURNISSEUR,
  // pas la référence interne. Celle-ci est générée plus bas, comme
  // à l'import, et ne se saisit jamais.
  const reference = nn(req.body.reference ?? req.body.ref);
  const refOe = nn(req.body.ref_oe);
  const sousCategorie = nn(req.body.sous_categorie);

  // Champs structurés, facultatifs tant que le front n'est pas migré :
  //   compatibilites : [{ id_modele, annee_min, annee_max, motorisation }]
  //   references     : [{ reference, type, fabricant }]
  const compatibilites = parseJson(req.body.compatibilites);
  const referencesCroisees = parseJson(req.body.references);

  // 1. Champs obligatoires
  if (!description || !categorie || !prix || !quantite) {
    return res.status(400).json({ message: 'Veuillez remplir tous les champs obligatoires.' });
  }

  if (compatibilites.length === 0 && (!marque || !modele)) {
    return res
      .status(400)
      .json({ message: 'Indiquez au moins un véhicule compatible pour cette pièce.' });
  }

  // 2. Images obligatoires
  if (!req.files || !req.files['img_principale'] || !req.files['img1'] || !req.files['img2']) {
    console.error('❌ Erreur : Images obligatoires manquantes.');
    return res
      .status(400)
      .json({ message: "L'image principale ainsi que les images 1 et 2 sont obligatoires." });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const img_principale = req.files['img_principale'][0].path;
    const img1 = req.files['img1'][0].path;
    const img2 = req.files['img2'][0].path;
    const img3 = req.files['img3'] ? req.files['img3'][0].path : null;
    const img4 = req.files['img4'] ? req.files['img4'][0].path : null;

    // 3. Catégorie texte -> id_categorie (famille générale)
    const [cat] = await conn.query(
      `SELECT id FROM categories
       WHERE (slug = LOWER(TRIM(?)) OR nom = TRIM(?)) AND id_parent IS NULL
       LIMIT 1`,
      [categorie, categorie],
    );
    const idCategorie = cat.length ? cat[0].id : null;

    // 4. Sous-catégorie : on vérifie qu'elle appartient bien à la famille choisie.
    //    Sinon on l'ignore, plutôt que d'enregistrer une incohérence.
    let idSousCategorie = null;
    if (sousCategorie && idCategorie) {
      const [sous] = await conn.query(
        `SELECT id FROM categories
         WHERE (slug = LOWER(TRIM(?)) OR id = ?) AND id_parent = ?
         LIMIT 1`,
        [sousCategorie, Number(sousCategorie) || 0, idCategorie],
      );
      idSousCategorie = sous.length ? sous[0].id : null;

      if (!idSousCategorie) {
        console.warn(`⚠️ Sous-catégorie "${sousCategorie}" hors de la famille, ignorée.`);
      }
    }

    // ----------------------------------------------------------
    //  5. RÉFÉRENCE INTERNE
    //
    //  Générée ici comme elle l'est à l'import, et pour la même
    //  raison : c'est elle que le stock affiche, que l'étiquette
    //  porte et que l'historique des commandes conserve. Une pièce
    //  ajoutée à la main qui n'en aurait pas apparaîtrait sans
    //  référence partout dans l'application.
    //
    //  Le verrou du compteur est pris à l'intérieur de la
    //  transaction : si l'insertion échoue, le numéro n'est pas
    //  consommé et la série ne saute pas.
    // ----------------------------------------------------------
    const refInterne = await refService.reserverUne(conn);

    // ----------------------------------------------------------
    //  6. Insertion de la pièce
    //
    //  19 colonnes, 19 marqueurs, 19 valeurs. Le compte était faux
    //  depuis le retrait de la colonne `equipementier` : son nom
    //  avait disparu de la liste mais sa valeur était restée dans
    //  le tableau, et la variable elle-même n'existait plus nulle
    //  part. L'appel levait un ReferenceError avant même d'atteindre
    //  MySQL, et la page « Nouvelle pièce » n'enregistrait rien.
    // ----------------------------------------------------------
    const [result] = await conn.query(
      `INSERT INTO pieces
        (ref_interne, description, marque, categorie, id_categorie, id_sous_categorie,
         modele, annee, fournisseur, prix, etat, quantite, ref, ref_oe,
         img_principale, img1, img2, img3, img4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        refInterne,
        description,
        nn(marque),
        categorie,
        idCategorie,
        idSousCategorie,
        nn(modele),
        nn(annee),
        nn(fournisseur),
        prix,
        nn(etat),
        quantite,
        reference,
        refOe,
        img_principale,
        img1,
        img2,
        img3,
        img4,
      ],
    );

    const idPiece = result.insertId;

    // 7. Compatibilités véhicules
    let lignesCompat = compatibilites;

    if (lignesCompat.length === 0) {
      const idModele = await resoudreModele(conn, marque, modele);
      if (!idModele) {
        await conn.rollback();
        await nettoyerUploads(req.files);
        return res.status(400).json({
          message: `Le véhicule "${marque} ${modele}" ne figure pas dans le référentiel. Choisissez un modèle dans la liste.`,
        });
      }
      lignesCompat = [{ id_modele: idModele, annee_min: nn(annee), annee_max: nn(annee) }];
    }

    // ----------------------------------------------------------
    //  INSERTION DES COMPATIBILITÉS
    //
    //  L'INSERT IGNORE d'origine a disparu, pour la raison déjà
    //  corrigée dans ajouterCompatibilite : IGNORE avalait les
    //  violations de clé étrangère. Un id_modele inexistant
    //  renvoyait « Pièce ajoutée » avec un 201 alors qu'aucune
    //  compatibilité n'avait été écrite, et la pièce restait hors
    //  catalogue sans que personne puisse comprendre pourquoi.
    //
    //  Ici on vérifie d'abord, on insère ensuite, et un refus
    //  annule proprement la création.
    // ----------------------------------------------------------
    const vues = new Set();
    const retenues = [];

    for (const c of lignesCompat) {
      const idModele = Number(c.id_modele);
      const idConfiguration = c.id_configuration ? Number(c.id_configuration) : null;

      if (!Number.isInteger(idModele) || idModele <= 0) {
        await conn.rollback();
        await nettoyerUploads(req.files);
        return res.status(400).json({ message: 'Véhicule compatible invalide.' });
      }

      const cible = await validerCible(conn, idModele, idConfiguration);
      if (cible.erreur) {
        await conn.rollback();
        await nettoyerUploads(req.files);
        return res.status(400).json({ message: cible.erreur });
      }

      const ligne = {
        id_modele: idModele,
        id_configuration: idConfiguration,
        annee_min: nn(c.annee_min),
        annee_max: nn(c.annee_max),
        // Une configuration porte déjà sa motorisation : garder en
        // plus un texte libre créerait deux vérités pour la même
        // information, et deux lignes distinctes au regard de la
        // clé d'unicité.
        //
        // Le texte est RÉDUIT avant d'être stocké, et pas seulement
        // avant d'être comparé : « 1.4 TDI » et « 1.4 TDI » avec un
        // espace de trop sont la même motorisation, et doivent
        // s'écrire pareil en base. Sans ce trim, le portier
        // refuserait ce que le filet aurait accepté.
        motorisation: idConfiguration ? null : nn(String(c.motorisation ?? '').trim()),
      };

      // Doublon à l'intérieur du même formulaire : on l'écarte en
      // silence plutôt que d'annuler toute la création.
      const cle = cleLigne(idPiece, ligne);
      if (vues.has(cle)) continue;
      vues.add(cle);

      await conn.query(
        `INSERT INTO piece_compatibilite
           (id_piece, id_modele, id_configuration, annee_min, annee_max, motorisation)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          idPiece,
          ligne.id_modele,
          ligne.id_configuration,
          ligne.annee_min,
          ligne.annee_max,
          ligne.motorisation,
        ],
      );

      retenues.push(ligne);
    }

    lignesCompat = retenues;

    // 8. Références croisées
    const toutesRefs = [...referencesCroisees];
    if (reference) toutesRefs.push({ reference, type: 'fournisseur', fabricant: nn(fournisseur) });
    if (refOe) toutesRefs.push({ reference: refOe, type: 'OE', fabricant: nn(marque) });

    for (const r of toutesRefs) {
      if (!r.reference) continue;
      await conn.query(
        `INSERT IGNORE INTO piece_references (id_piece, reference, type, fabricant, source)
         VALUES (?, ?, ?, ?, 'saisie')`,
        [idPiece, String(r.reference).trim(), r.type || 'equivalent', nn(r.fabricant)],
      );
    }

    // 9. Trace. L'action piece_creee figurait au catalogue du journal
    //    sans que rien ne l'émette jamais : une pièce ajoutée à la
    //    main n'apparaissait dans aucun suivi.
    await journal.enregistrer(conn, req, {
      action: 'piece_creee',
      objet: { type: 'piece', id: idPiece, libelle: refInterne },
      apres: {
        description,
        prix: Number(prix),
        quantite: Number(quantite),
        compatibilites: lignesCompat.length,
      },
    });

    await conn.commit();

    console.log(
      `✅ Pièce ${refInterne} (id ${idPiece}) enregistrée — ${lignesCompat.length} compatibilité(s)`,
    );
    res.status(201).json({
      message: 'Pièce ajoutée avec succès !',
      id: idPiece,
      ref_interne: refInterne,
      ref: reference,
      sous_categorie: idSousCategorie,
      compatibilites: lignesCompat.length,
      references: toutesRefs.length,
      url_principale: img_principale,
    });
  } catch (error) {
    await conn.rollback();

    // La ligne SQL n'existe plus : on retire les images envoyées à Cloudinary
    await nettoyerUploads(req.files);

    if (error.code === 'ER_DUP_ENTRY') {
      console.error('❌ Référence déjà utilisée :', reference);
      return res
        .status(409)
        .json({ message: `La référence ${reference} existe déjà pour une autre pièce.` });
    }

    console.error("❌ ERREUR lors de l'insertion Cloudinary/SQL :", error);
    res.status(500).json({ message: 'Erreur interne du serveur.', error: error.message });
  } finally {
    conn.release();
  }
};

// ==========================================================
//  COMPATIBILITÉS D'UNE PIÈCE EXISTANTE
//
//  Une pièce sans véhicule rattaché n'apparaît dans aucun
//  catalogue client : `getCatalogue` fait une JOIN sur
//  piece_compatibilite. Elle est au stock et invendable, comme
//  une pièce sans photo.
// ==========================================================

/**
 * La ligne telle que le front l'attend, libellés compris.
 *
 * LEFT JOIN sur la configuration, et non JOIN : l'immense majorité
 * des lignes sont larges, sans configuration. Un JOIN simple les
 * ferait toutes disparaître de l'affichage.
 */
const LIGNE_COMPAT = `
  SELECT pc.id, pc.id_piece, pc.id_modele, pc.id_configuration,
         pc.annee_min, pc.annee_max, pc.motorisation,
         mo.modele, ma.nom AS marque,
         vc.motorisation AS config_motorisation,
         vc.carburant    AS config_carburant,
         vc.boite        AS config_boite,
         vc.annee_min    AS config_annee_min,
         vc.annee_max    AS config_annee_max
    FROM piece_compatibilite pc
    JOIN modeles mo ON mo.id = pc.id_modele
    JOIN marques ma ON ma.id = mo.id_marque
    LEFT JOIN vehicule_configuration vc ON vc.id = pc.id_configuration`;

// ==========================================================
//  POST /api/pieces/:id/compatibilites
// ==========================================================
exports.ajouterCompatibilite = async (req, res) => {
  const idPiece = Number(req.params.id);
  const { id_modele, annee_min, annee_max, motorisation } = req.body;

  if (!id_modele) {
    return res.status(400).json({ message: 'Le modèle est obligatoire.' });
  }

  const idConfiguration = req.body.id_configuration ? Number(req.body.id_configuration) : null;

  const min = nn(annee_min);
  const max = nn(annee_max);

  if (min && max && Number(min) > Number(max)) {
    return res.status(400).json({
      message: "L'année de début doit précéder l'année de fin.",
    });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // ----------------------------------------------------------
    //  Les deux existences sont vérifiées AVANT d'insérer, et
    //  l'INSERT IGNORE d'origine a disparu.
    //
    //  IGNORE avalait les violations de clé étrangère : un
    //  id_modele inexistant renvoyait « Compatibilité ajoutée »
    //  avec un 201, alors que rien n'avait été écrit. Le
    //  gestionnaire croyait sa pièce rattachée et elle restait
    //  hors catalogue, sans aucun moyen de comprendre pourquoi.
    // ----------------------------------------------------------
    const [[piece]] = await conn.query(
      'SELECT id, ref_interne, description FROM pieces WHERE id = ?',
      [idPiece],
    );
    if (!piece) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pièce non trouvée.' });
    }

    // Modèle et configuration vérifiés ensemble : la configuration
    // doit exister, être rattachée au référentiel, et désigner
    // précisément ce modèle.
    const cible = await validerCible(conn, Number(id_modele), idConfiguration);
    if (cible.erreur) {
      await conn.rollback();
      return res.status(400).json({ message: cible.erreur });
    }
    const { vehicule, configuration } = cible;

    // Une configuration porte déjà sa motorisation. Conserver en
    // plus un texte libre créerait deux vérités pour la même
    // information. Texte réduit avant stockage, pour que la valeur
    // écrite soit exactement celle qui a été comparée.
    const moteur = idConfiguration ? null : nn(String(motorisation ?? '').trim());

    // Doublon. La contrainte d'unicité en base est désormais réelle
    // grâce à la colonne générée, mais ce contrôle reste : il rend
    // un message lisible au gestionnaire là où MySQL rendrait un
    // #1062 brut. Le <=> traite deux NULL comme égaux, ce que le
    // = ne fait pas.
    const [existantes] = await conn.query(
      `SELECT id FROM piece_compatibilite
        WHERE id_piece = ? AND id_modele = ?
          AND (id_configuration <=> ?)
          AND (annee_min <=> ?) AND (annee_max <=> ?)
          AND (motorisation <=> ?)`,
      [idPiece, id_modele, idConfiguration, min, max, moteur],
    );

    if (existantes.length) {
      await conn.rollback();
      const quoi = configuration
        ? `${vehicule.marque} ${vehicule.modele} ${configurations.libelle(configuration)}`
        : `${vehicule.marque} ${vehicule.modele}`;
      return res.status(409).json({ message: `${quoi} est déjà rattaché à cette pièce.` });
    }

    const [resultat] = await conn.query(
      `INSERT INTO piece_compatibilite
         (id_piece, id_modele, id_configuration, annee_min, annee_max, motorisation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idPiece, id_modele, idConfiguration, min, max, moteur],
    );

    await journal.enregistrer(conn, req, {
      action: 'compatibilite_ajoutee',
      objet: { type: 'piece', id: idPiece, libelle: piece.ref_interne || `#${idPiece}` },
      apres: {
        vehicule: `${vehicule.marque} ${vehicule.modele}`,
        version: configuration ? configurations.libelle(configuration) : null,
        annee_min: min,
        annee_max: max,
      },
    });

    await conn.commit();

    // On renvoie la ligne complète, libellés compris : le front
    // l'ajoute à sa liste sans recharger tout le stock.
    const [[ligne]] = await conn.query(`${LIGNE_COMPAT} WHERE pc.id = ?`, [resultat.insertId]);

    console.log(
      `🔗 ${vehicule.marque} ${vehicule.modele} rattaché à ${piece.ref_interne || idPiece}`,
    );

    res.status(201).json({
      message: `${vehicule.marque} ${vehicule.modele} rattaché à la pièce.`,
      compatibilite: ligne,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Erreur ajout compatibilité:', error);
    res.status(500).json({ message: "Erreur lors de l'ajout", error: error.message });
  } finally {
    conn.release();
  }
};

// ==========================================================
//  DELETE /api/pieces/compatibilites/:id
// ==========================================================
exports.supprimerCompatibilite = async (req, res) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Lue avant la suppression : après, il n'y aurait plus rien à
    // écrire dans le journal, et « a retiré #317 » ne dit rien à
    // personne.
    const [[ligne]] = await conn.query(
      `${LIGNE_COMPAT}
        WHERE pc.id = ?`,
      [req.params.id],
    );

    if (!ligne) {
      await conn.rollback();
      return res.status(404).json({ message: 'Compatibilité introuvable.' });
    }

    const [[piece]] = await conn.query('SELECT ref_interne FROM pieces WHERE id = ?', [
      ligne.id_piece,
    ]);

    await conn.query('DELETE FROM piece_compatibilite WHERE id = ?', [req.params.id]);

    // Combien en reste-t-il ? Zéro signifie que la pièce vient de
    // quitter tous les catalogues clients, et le front doit le dire.
    const [[reste]] = await conn.query(
      'SELECT COUNT(*) AS nb FROM piece_compatibilite WHERE id_piece = ?',
      [ligne.id_piece],
    );

    await journal.enregistrer(conn, req, {
      action: 'compatibilite_retiree',
      objet: {
        type: 'piece',
        id: ligne.id_piece,
        libelle: piece?.ref_interne || `#${ligne.id_piece}`,
      },
      avant: { vehicule: `${ligne.marque} ${ligne.modele}` },
      apres: { vehicules_restants: Number(reste.nb) },
    });

    await conn.commit();

    res.status(200).json({
      message:
        Number(reste.nb) === 0
          ? `${ligne.marque} ${ligne.modele} retiré. Sans véhicule rattaché, la pièce quitte les catalogues clients.`
          : `${ligne.marque} ${ligne.modele} retiré.`,
      id_piece: ligne.id_piece,
      restants: Number(reste.nb),
    });
  } catch (error) {
    await conn.rollback();
    console.error('Erreur suppression compatibilité:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression', error: error.message });
  } finally {
    conn.release();
  }
};
