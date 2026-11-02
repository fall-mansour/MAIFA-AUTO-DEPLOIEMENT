// On importe la connexion à la base de données et la config Cloudinary
const db = require('../db');
const { supprimerImages } = require('../cloudinaryConfig');
const journal = require('../services/journal.service');

const SEUIL_DEFAUT = 3;

/** Colonnes contenant les URLs Cloudinary */
const COLONNES_IMAGES = ['img_principale', 'img1', 'img2', 'img3', 'img4'];

/** Forme comparable d'une référence saisie : sans tirets, points ni espaces */
const normaliserRef = (valeur) =>
  String(valeur ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * mysql2 renvoie les DECIMAL sous forme de chaîne ("45000.00").
 * On normalise pour que le front puisse additionner et trier sans conversion.
 */
const formatPiece = (row) => ({
  ...row,

  // La référence affichée est désormais la référence interne
  // ("MA-00042-N"), générée et immuable. L'ancienne colonne `ref`,
  // saisie à la main, n'est plus exposée sous ce nom : le front
  // continue de lire `piece.ref` sans rien changer.
  ref: row.ref_interne || null,
  ref_interne: row.ref_interne || null,
  ref_oe: row.ref_oe || null,

  prix: row.prix !== null ? Number(row.prix) : null,
  quantite: row.quantite !== null ? Number(row.quantite) : 0,
  annee: row.annee !== null ? Number(row.annee) : null,
  seuil_alerte: Number(row.seuil_alerte ?? SEUIL_DEFAUT),
  compatibilites: [],
  references: [],
});

/**
 * Charge compatibilités et références pour un lot de pièces,
 * en 2 requêtes au total (et non 2 par pièce).
 */
const attacherRelations = async (pieces) => {
  if (pieces.length === 0) return pieces;

  const ids = pieces.map((p) => p.id);
  const index = new Map(pieces.map((p) => [p.id, p]));

  const [compat] = await db.query(
    `SELECT pc.id, pc.id_piece, pc.id_modele, pc.annee_min, pc.annee_max, pc.motorisation,
            mo.modele, ma.nom AS marque
     FROM piece_compatibilite pc
     JOIN modeles mo ON mo.id = pc.id_modele
     JOIN marques ma ON ma.id = mo.id_marque
     WHERE pc.id_piece IN (?)
     ORDER BY ma.nom, mo.modele`,
    [ids],
  );
  compat.forEach((c) => index.get(c.id_piece)?.compatibilites.push(c));

  const [refs] = await db.query(
    `SELECT id, id_piece, reference, type, fabricant
     FROM piece_references
     WHERE id_piece IN (?)
     ORDER BY FIELD(type, 'OE', 'equivalent', 'fournisseur'), reference`,
    [ids],
  );
  refs.forEach((r) => index.get(r.id_piece)?.references.push(r));

  return pieces;
};

// ==========================================================
// 1. GET /api/stock
//    Filtres : search, marque, id_marque, id_modele, categorie,
//              annee, modele, alerte, sans_compat
// ==========================================================
exports.getAllPieces = async (req, res) => {
  try {
    const {
      search,
      marque,
      id_marque,
      id_modele,
      categorie,
      annee,
      modele,
      alerte,
      sans_compat,
      brouillon,
    } = req.query;

    let sql = `
      SELECT DISTINCT p.*
      FROM pieces p
      LEFT JOIN piece_compatibilite pc ON pc.id_piece = p.id
      LEFT JOIN modeles mo ON mo.id = pc.id_modele
      LEFT JOIN marques ma ON ma.id = mo.id_marque
      WHERE 1 = 1`;
    const params = [];

    // Recherche libre.
    //
    // Les colonnes normalisées rendent la saisie indifférente aux
    // séparateurs : "MA-00042-N", "ma00042n" et "MA 00042 N"
    // trouvent la même pièce, de même pour "0451.103318".
    if (search) {
      const like = `%${search}%`;
      const norm = `%${normaliserRef(search)}%`;

      sql += ` AND (
        p.ref_interne LIKE ? OR p.ref_interne_norm LIKE ?
        OR p.ref_oe LIKE ? OR p.ref_oe_norm LIKE ?
        OR p.ref_normalisee LIKE ?
        OR p.description LIKE ? OR p.fournisseur LIKE ?
        OR ma.nom LIKE ? OR mo.modele LIKE ?
        OR EXISTS (
          SELECT 1 FROM piece_references pr
          WHERE pr.id_piece = p.id AND pr.reference_norm LIKE ?
        )
      )`;
      params.push(like, norm, like, norm, norm, like, like, like, like, norm);
    }

    if (id_modele) {
      sql += ' AND pc.id_modele = ?';
      params.push(id_modele);
    }

    if (id_marque) {
      sql += ' AND ma.id = ?';
      params.push(id_marque);
    }

    if (marque) {
      sql += ' AND ma.nom = ?';
      params.push(marque);
    }

    if (modele) {
      sql += ' AND mo.modele LIKE ?';
      params.push(`%${modele}%`);
    }

    // Compatibilité sur une PLAGE d'années, pas une valeur exacte
    if (annee) {
      sql += ' AND ? BETWEEN IFNULL(pc.annee_min, 0) AND IFNULL(pc.annee_max, 9999)';
      params.push(annee);
    }

    if (categorie) {
      sql += ' AND (p.categorie = ? OR p.id_categorie = ?)';
      params.push(categorie, categorie);
    }

    if (alerte === '1' || alerte === 'true') {
      sql += ' AND p.quantite <= p.seuil_alerte';
    }

    // Pièces non rattachées au référentiel : à corriger
    if (sans_compat === '1' || sans_compat === 'true') {
      sql += ' AND pc.id IS NULL';
    }

    // Brouillons : pièces sans aucune photo, donc invisibles au
    // catalogue. Après un import de 200 lignes dont la moitié sans
    // adresse d'image, c'est le seul moyen de retrouver celles qui
    // attendent une photo.
    if (brouillon === '1' || brouillon === 'true') {
      sql += ` AND ${COLONNES_IMAGES.map((c) => `p.${c} IS NULL`).join(' AND ')}`;
    }

    sql += ' ORDER BY p.date_ajout DESC, p.id DESC';

    const [rows] = await db.query(sql, params);
    const pieces = await attacherRelations(rows.map(formatPiece));

    res.status(200).json(pieces);
  } catch (error) {
    console.error('Erreur GET stock:', error);
    res
      .status(500)
      .json({ message: 'Erreur lors de la récupération du stock', error: error.message });
  }
};

// ==========================================================
// 2. GET /api/stock/catalogue?id_modele=1299&annee=2021
//    Vue client : uniquement ce qui est en stock et visible
// ==========================================================
exports.getCatalogue = async (req, res) => {
  try {
    const { id_modele, annee, categorie } = req.query;

    let sql = `
      SELECT DISTINCT p.*
      FROM pieces p
      JOIN piece_compatibilite pc ON pc.id_piece = p.id
      WHERE p.visible_catalogue = 1 AND p.quantite > 0`;
    const params = [];

    if (id_modele) {
      sql += ' AND pc.id_modele = ?';
      params.push(id_modele);
    }

    if (annee) {
      sql += ' AND ? BETWEEN IFNULL(pc.annee_min, 0) AND IFNULL(pc.annee_max, 9999)';
      params.push(annee);
    }

    if (categorie) {
      sql += ' AND (p.categorie = ? OR p.id_categorie = ?)';
      params.push(categorie, categorie);
    }

    sql += ' ORDER BY p.date_ajout DESC';

    const [rows] = await db.query(sql, params);
    const pieces = await attacherRelations(rows.map(formatPiece));

    res.status(200).json(pieces);
  } catch (error) {
    console.error('Erreur GET catalogue:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du catalogue' });
  }
};

// ==========================================================
// 3. GET /api/stock/:id
// ==========================================================
exports.getPieceById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM pieces WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pièce non trouvée.' });

    const [piece] = await attacherRelations(rows.map(formatPiece));
    res.status(200).json(piece);
  } catch (error) {
    console.error('Erreur GET pièce:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération', error: error.message });
  }
};

// ==========================================================
// 4. GET /api/stock/recherche-ref/:ref
//    Cherche dans la référence interne, la référence constructeur
//    et les équivalences, quelle que soit la forme saisie.
// ==========================================================
exports.chercherParReference = async (req, res) => {
  try {
    const norm = normaliserRef(req.params.ref);
    if (!norm) return res.status(400).json({ message: 'Référence vide.' });

    const [rows] = await db.query(
      `SELECT DISTINCT p.*
       FROM pieces p
       LEFT JOIN piece_references pr ON pr.id_piece = p.id
       WHERE p.ref_interne_norm = ?
          OR p.ref_oe_norm = ?
          OR p.ref_normalisee = ?
          OR pr.reference_norm = ?
       ORDER BY p.ref_interne_norm = ? DESC, p.id`,
      [norm, norm, norm, norm, norm],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: `Aucune pièce pour la référence ${req.params.ref}.` });
    }

    const pieces = await attacherRelations(rows.map(formatPiece));
    res.status(200).json(pieces);
  } catch (error) {
    console.error('Erreur recherche référence:', error);
    res.status(500).json({ message: 'Erreur lors de la recherche', error: error.message });
  }
};

// ==========================================================
// 5. GET /api/stock/stats
// ==========================================================
exports.getStats = async (req, res) => {
  try {
    const [[stats]] = await db.query(
      `SELECT
         COUNT(*)                          AS references_total,
         COALESCE(SUM(quantite), 0)        AS unites_total,
         COALESCE(SUM(prix * quantite), 0) AS valeur_stock,
         SUM(CASE WHEN quantite = 0 THEN 1 ELSE 0 END) AS ruptures,
         SUM(CASE WHEN quantite > 0 AND quantite <= seuil_alerte THEN 1 ELSE 0 END) AS stock_faible
       FROM pieces`,
    );

    const [[orphelines]] = await db.query(`SELECT COUNT(*) AS nb FROM v_pieces_a_rattacher`);

    res.status(200).json({
      references_total: Number(stats.references_total),
      unites_total: Number(stats.unites_total),
      valeur_stock: Number(stats.valeur_stock),
      ruptures: Number(stats.ruptures),
      stock_faible: Number(stats.stock_faible),
      sans_compatibilite: Number(orphelines.nb),
    });
  } catch (error) {
    console.error('Erreur GET stats:', error);
    res.status(500).json({ message: 'Erreur lors du calcul des statistiques' });
  }
};

// ==========================================================
// 6. PATCH /api/stock/:id/quantite
// ==========================================================
exports.majQuantite = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantite, delta } = req.body;

    if (quantite === undefined && delta === undefined) {
      return res.status(400).json({ message: 'Fournissez une quantité ou un delta.' });
    }

    const [rows] = await db.query('SELECT quantite, seuil_alerte FROM pieces WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Pièce non trouvée.' });

    const actuelle = Number(rows[0].quantite) || 0;
    const nouvelle = quantite !== undefined ? Number(quantite) : actuelle + Number(delta);

    if (isNaN(nouvelle) || nouvelle < 0) {
      return res.status(400).json({ message: 'La quantité ne peut pas être négative.' });
    }

    await db.query('UPDATE pieces SET quantite = ? WHERE id = ?', [nouvelle, id]);

    res.status(200).json({
      message: 'Quantité mise à jour.',
      id: Number(id),
      quantite: nouvelle,
      alerte: nouvelle <= Number(rows[0].seuil_alerte ?? SEUIL_DEFAUT),
    });
  } catch (error) {
    console.error('Erreur PATCH quantité:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour', error: error.message });
  }
};

// ==========================================================
// 7. DELETE /api/stock/:id
//    Compatibilités et références partent en cascade (FK).
// ==========================================================
exports.deletePiece = async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await db.query(
      `SELECT id, ref_interne, description, ${COLONNES_IMAGES.join(', ')}
         FROM pieces WHERE id = ?`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Pièce non trouvée dans la base de données' });
    }

    const piece = rows[0];

    const [result] = await db.query('DELETE FROM pieces WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Pièce non trouvée dans la base de données' });
    }

    const urls = COLONNES_IMAGES.map((col) => piece[col]);
    const rapport = await supprimerImages(urls);

    console.log(
      `🗑️ Pièce supprimée : ${piece.ref_interne || 'sans référence'} (id ${piece.id}) — ` +
        `images Cloudinary : ${rapport.supprimees}/${rapport.demandees}`,
    );

    res.status(200).json({
      message: 'La pièce a été supprimée avec succès !',
      id: piece.id,
      ref: piece.ref_interne,
      images: rapport,
    });
  } catch (error) {
    console.error('Erreur DELETE pièce:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression', error: error.message });
  }
};

// ==========================================================
// 8. PATCH /api/stock/:id
//    Modification des informations d'une piece.
//
//    Liste blanche des champs : tout ce qui n'y figure pas est
//    ignore. Sans elle, n'importe quel champ envoye serait ecrit,
//    y compris l'identifiant ou la date d'ajout.
//
//    Deux champs ont ete RETIRES de cette liste :
//      equipementier  la colonne n'existe plus en base
//      ref            remplacee par ref_interne, qui est generee
//                     et ne se modifie jamais. Elle figure sur des
//                     etiquettes et dans l'historique des commandes :
//                     la changer rendrait ces traces fausses.
// ==========================================================
const ETATS = ['Neuf', 'Occasion', 'Reconditionné'];

const CHAMPS_MODIFIABLES = {
  description: (v) => {
    const t = String(v ?? '').trim();
    if (!t) throw new Error('La désignation ne peut pas être vide.');
    if (t.length > 255) throw new Error('Désignation trop longue (255 caractères maximum).');
    return t;
  },
  prix: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error('Le prix doit être un nombre positif.');
    return Math.round(n);
  },
  quantite: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error('La quantité doit être un entier positif.');
    return n;
  },
  seuil_alerte: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0)
      throw new Error("Le seuil d'alerte doit être un entier positif.");
    return n;
  },
  etat: (v) => {
    if (!ETATS.includes(v))
      throw new Error(`État invalide. Valeurs admises : ${ETATS.join(', ')}.`);
    return v;
  },
  fournisseur: (v) => String(v ?? '').trim() || null,
  ref_oe: (v) => String(v ?? '').trim() || null,
  visible_catalogue: (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0),
};

/** Champs que le front peut encore envoyer, mais qu'on ignore sans bruit */
const CHAMPS_OBSOLETES = new Set(['equipementier', 'ref', 'ref_interne', 'marque', 'modele']);

exports.majPiece = async (req, res) => {
  const { id } = req.params;

  try {
    const [existe] = await db.query('SELECT id FROM pieces WHERE id = ?', [id]);
    if (existe.length === 0) return res.status(404).json({ message: 'Pièce non trouvée.' });

    // On ne retient que les champs autorises effectivement envoyes
    const colonnes = [];
    const valeurs = [];

    for (const [champ, valider] of Object.entries(CHAMPS_MODIFIABLES)) {
      if (req.body[champ] === undefined) continue;
      try {
        valeurs.push(valider(req.body[champ]));
        colonnes.push(`\`${champ}\` = ?`);
      } catch (e) {
        return res.status(400).json({ message: e.message, champ });
      }
    }

    // Une tentative de modifier la reference interne merite d'etre
    // refusee franchement plutot qu'ignoree en silence : le
    // gestionnaire croirait sa saisie enregistree.
    if (req.body.ref_interne !== undefined) {
      return res.status(400).json({
        message: 'La référence interne est attribuée automatiquement et ne peut pas être modifiée.',
        champ: 'ref_interne',
      });
    }

    const ignores = Object.keys(req.body).filter(
      (c) => CHAMPS_OBSOLETES.has(c) && c !== 'ref_interne',
    );
    if (ignores.length) {
      console.warn(`Champs ignorés sur la pièce ${id} : ${ignores.join(', ')}`);
    }

    if (colonnes.length === 0) {
      return res.status(400).json({ message: 'Aucun champ modifiable fourni.' });
    }

    await db.query(`UPDATE pieces SET ${colonnes.join(', ')} WHERE id = ?`, [...valeurs, id]);

    // On renvoie la piece complete, relations comprises,
    // pour que le front remplace sa copie sans recharger la liste
    const [rows] = await db.query('SELECT * FROM pieces WHERE id = ?', [id]);
    const [piece] = await attacherRelations(rows.map(formatPiece));

    console.log(
      `✏️  Pièce ${piece.ref_interne || piece.id} modifiée : ` +
        colonnes.map((c) => c.split('`')[1]).join(', '),
    );

    res.status(200).json({ message: 'Pièce mise à jour.', piece });
  } catch (error) {
    // Reference deja utilisee par une autre piece
    if (error.code === 'ER_DUP_ENTRY') {
      return res
        .status(409)
        .json({ message: 'Cette référence est déjà utilisée par une autre pièce.' });
    }
    console.error('Erreur PATCH pièce:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour', error: error.message });
  }
};

// ==========================================================
//  PHOTOS D'UNE PIÈCE EXISTANTE
//
//  L'import met à 0 le `visible_catalogue` des pièces arrivées
//  sans photo : elles entrent au stock en brouillon, invisibles
//  du client. Jusqu'ici rien ne savait refermer cet état. Une
//  pièce entrée en brouillon y restait, puisque la liste blanche
//  de `majPiece` ne contient aucune colonne image et qu'aucune
//  route n'acceptait de fichier sur une pièce existante.
//
//  Ces deux routes ferment la boucle, et la referment toute
//  seule : dès la première photo la pièce est publiée, dès la
//  dernière retirée elle repasse en brouillon. Un gestionnaire
//  qui photographie une pièce veut la vendre, pas cocher ensuite
//  une case qu'il oubliera.
// ==========================================================

/** Supprime de Cloudinary des fichiers fraîchement téléversés */
const retirerDeCloudinary = async (fichiers) => {
  const urls = (fichiers || []).map((f) => f && f.path).filter(Boolean);
  if (urls.length) await supprimerImages(urls);
};

/** Les fichiers reçus, que multer ait utilisé .array() ou .fields() */
const fichiersRecus = (req) => {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && Array.isArray(req.files.photos)) return req.files.photos;
  if (req.file) return [req.file];
  return [];
};

// ==========================================================
// 9. POST /api/stock/:id/photos
//    multipart, champ « photos », jusqu'à 5 fichiers
// ==========================================================
exports.ajouterPhotos = async (req, res) => {
  const { id } = req.params;
  const fichiers = fichiersRecus(req);

  if (fichiers.length === 0) {
    return res.status(400).json({ message: 'Aucune photo reçue.' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // FOR UPDATE : deux gestionnaires qui photographient la même
    // pièce en même temps écriraient sinon dans le même emplacement,
    // et la photo du premier serait perdue sans laisser de trace.
    const [rows] = await conn.query(
      `SELECT id, ref_interne, description, visible_catalogue, ${COLONNES_IMAGES.join(', ')}
         FROM pieces WHERE id = ? FOR UPDATE`,
      [id],
    );

    if (rows.length === 0) {
      await conn.rollback();
      await retirerDeCloudinary(fichiers);
      return res.status(404).json({ message: 'Pièce non trouvée.' });
    }

    const piece = rows[0];
    const occupees = COLONNES_IMAGES.filter((c) => piece[c]);
    const libres = COLONNES_IMAGES.filter((c) => !piece[c]);

    if (libres.length === 0) {
      await conn.rollback();
      await retirerDeCloudinary(fichiers);
      return res.status(409).json({
        message: 'Cette pièce porte déjà 5 photos. Retirez-en une avant d en ajouter.',
      });
    }

    // Ce qui ne rentre pas est renvoyé à Cloudinary plutôt que
    // conservé sans référence : une image orpheline se paie et ne
    // sert à personne.
    const retenus = fichiers.slice(0, libres.length);
    const surplus = fichiers.slice(libres.length);

    const maj = {};
    retenus.forEach((f, i) => {
      maj[libres[i]] = f.path;
    });

    // Première photo : la pièce sort du brouillon d'elle-même
    const publication = occupees.length === 0 && Number(piece.visible_catalogue) !== 1;
    if (publication) maj.visible_catalogue = 1;

    const champs = Object.keys(maj);
    await conn.query(
      `UPDATE pieces SET ${champs.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
      [...champs.map((c) => maj[c]), id],
    );

    await journal.enregistrer(conn, req, {
      action: publication ? 'piece_publiee' : 'piece_photos_ajoutees',
      objet: { type: 'piece', id: Number(id), libelle: piece.ref_interne || `#${id}` },
      avant: { photos: occupees.length, visible_catalogue: Number(piece.visible_catalogue) },
      apres: {
        photos: occupees.length + retenus.length,
        visible_catalogue: publication ? 1 : Number(piece.visible_catalogue),
      },
    });

    await conn.commit();

    // Après le commit seulement : si la transaction avait échoué
    // après coup, on aurait détruit des images encore référencées.
    if (surplus.length) await retirerDeCloudinary(surplus);

    const [apres] = await conn.query('SELECT * FROM pieces WHERE id = ?', [id]);
    const [complete] = await attacherRelations(apres.map(formatPiece));

    console.log(
      `📷 ${retenus.length} photo(s) ajoutée(s) à ${piece.ref_interne || id}` +
        (publication ? ' — pièce publiée au catalogue' : ''),
    );

    res.status(200).json({
      message: publication
        ? `${retenus.length} photo(s) ajoutée(s). La pièce est maintenant visible au catalogue.`
        : `${retenus.length} photo(s) ajoutée(s).`,
      ajoutees: retenus.length,
      ignorees: surplus.length,
      emplacements_restants: libres.length - retenus.length,
      publiee: publication,
      piece: complete,
    });
  } catch (error) {
    await conn.rollback();
    await retirerDeCloudinary(fichiers);
    console.error('Erreur ajout photos:', error);
    res.status(500).json({ message: "Erreur lors de l'ajout des photos", error: error.message });
  } finally {
    conn.release();
  }
};

// ==========================================================
// 10. DELETE /api/stock/:id/photos/:emplacement
//     emplacement : « img_principale », « img1 »… ou 0 à 4
// ==========================================================
exports.supprimerPhoto = async (req, res) => {
  const { id, emplacement } = req.params;

  const colonne = COLONNES_IMAGES.includes(emplacement)
    ? emplacement
    : COLONNES_IMAGES[Number(emplacement)];

  if (!colonne) {
    return res.status(400).json({
      message: `Emplacement inconnu. Valeurs admises : ${COLONNES_IMAGES.join(', ')} ou 0 à 4.`,
    });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, ref_interne, visible_catalogue, ${COLONNES_IMAGES.join(', ')}
         FROM pieces WHERE id = ? FOR UPDATE`,
      [id],
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Pièce non trouvée.' });
    }

    const piece = rows[0];
    const urlRetiree = piece[colonne];

    if (!urlRetiree) {
      await conn.rollback();
      return res.status(404).json({ message: 'Aucune photo à cet emplacement.' });
    }

    // Compactage. Les emplacements ne sont pas interchangeables :
    // `img_principale` est celle qu'affichent les cartes du
    // catalogue. Retirer la principale sans faire remonter les
    // suivantes laisserait une pièce illustrée avec une vignette
    // vide. On réécrit donc les cinq colonnes dans l'ordre.
    const restantes = COLONNES_IMAGES.filter((c) => c !== colonne)
      .map((c) => piece[c])
      .filter(Boolean);

    const maj = {};
    COLONNES_IMAGES.forEach((c, i) => {
      maj[c] = restantes[i] ?? null;
    });

    // Plus aucune photo : retour au brouillon, symétrique de la
    // publication automatique ci-dessus.
    const retourBrouillon = restantes.length === 0 && Number(piece.visible_catalogue) === 1;
    if (retourBrouillon) maj.visible_catalogue = 0;

    const champs = Object.keys(maj);
    await conn.query(
      `UPDATE pieces SET ${champs.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
      [...champs.map((c) => maj[c]), id],
    );

    await journal.enregistrer(conn, req, {
      action: 'piece_photo_retiree',
      objet: { type: 'piece', id: Number(id), libelle: piece.ref_interne || `#${id}` },
      avant: { photos: restantes.length + 1, visible_catalogue: Number(piece.visible_catalogue) },
      apres: {
        photos: restantes.length,
        visible_catalogue: retourBrouillon ? 0 : Number(piece.visible_catalogue),
      },
    });

    await conn.commit();

    // Cloudinary après le commit, jamais avant : une suppression
    // d'image est irréversible, une transaction ne l'est pas.
    const rapport = await supprimerImages([urlRetiree]);

    const [apres] = await conn.query('SELECT * FROM pieces WHERE id = ?', [id]);
    const [complete] = await attacherRelations(apres.map(formatPiece));

    console.log(
      `🗑️  Photo retirée de ${piece.ref_interne || id}` +
        (retourBrouillon ? ' — pièce repassée en brouillon' : ''),
    );

    res.status(200).json({
      message: retourBrouillon
        ? 'Photo retirée. Sans photo, la pièce repasse en brouillon et quitte le catalogue.'
        : 'Photo retirée.',
      restantes: restantes.length,
      brouillon: retourBrouillon,
      images: rapport,
      piece: complete,
    });
  } catch (error) {
    await conn.rollback();
    console.error('Erreur suppression photo:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression', error: error.message });
  } finally {
    conn.release();
  }
};
