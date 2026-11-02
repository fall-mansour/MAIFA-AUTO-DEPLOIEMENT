const db = require('../db');

const SEUIL_DEFAUT = 3;

/**
 * Fabrique un slug URL.
 *
 * Le véhicule vient en priorité de piece_compatibilite : les
 * colonnes marque et modele de la table pieces ne sont plus
 * alimentées pour les pièces créées par import, elles ne servent
 * donc que de repli pour l'ancien stock.
 */
const construireSlug = (piece, vehicule = null) => {
  const marque = vehicule?.marque || piece.marque;
  const modele = vehicule?.modele || piece.modele;

  const brut = [piece.description, marque, modele].filter(Boolean).join(' ');
  const slug = brut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'piece'}-${piece.id}`;
};

const formatPiece = (row, vehicule = null) => ({
  ...row,
  // Référence affichée au client : la référence interne, sous sa
  // forme lisible avec tirets. ref_interne_norm reste disponible
  // mais sert à la recherche, pas à l'affichage.
  ref: row.ref_interne || null,
  ref_interne: row.ref_interne || null,
  ref_interne_norm: row.ref_interne_norm || null,
  ref_oe: row.ref_oe || null,
  prix: row.prix !== null ? Number(row.prix) : null,
  quantite: Number(row.quantite) || 0,
  annee: row.annee !== null ? Number(row.annee) : null,
  seuil_alerte: Number(row.seuil_alerte ?? SEUIL_DEFAUT),
  slug: construireSlug(row, vehicule),
});

/** Version allégée pour les blocs de rebond */
const formatCarte = (row) => {
  const vehicule = row._vehicule || null;
  return {
    id: row.id,
    ref: row.ref_interne || null,
    ref_interne: row.ref_interne || null,
    ref_oe: row.ref_oe || null,
    description: row.description,
    categorie: row.categorie,
    etat: row.etat,
    prix: Number(row.prix) || 0,
    quantite: Number(row.quantite) || 0,
    img_principale: row.img_principale,
    marque: vehicule?.marque || row.marque || null,
    modele: vehicule?.modele || row.modele || null,
    slug: construireSlug(row, vehicule),
  };
};

/**
 * Attache à chaque carte le premier véhicule compatible.
 *
 * Sans cela, une pièce créée par import n'afficherait aucun
 * véhicule sur les cartes de rebond : ses colonnes marque et
 * modele sont vides, le véhicule ne vit que dans
 * piece_compatibilite.
 *
 * Une seule requête pour tout le lot, pas une par carte.
 */
async function attacherVehicules(rows) {
  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);

  const [compat] = await db.query(
    `SELECT pc.id_piece, ma.nom AS marque, mo.modele
       FROM piece_compatibilite pc
       JOIN modeles mo ON mo.id = pc.id_modele
       JOIN marques ma ON ma.id = mo.id_marque
      WHERE pc.id_piece IN (?)
      ORDER BY pc.id_piece, ma.nom, mo.modele`,
    [ids],
  );

  // Premier véhicule rencontré pour chaque pièce
  const parPiece = new Map();
  for (const c of compat) {
    if (!parPiece.has(c.id_piece)) parPiece.set(c.id_piece, c);
  }

  rows.forEach((r) => {
    r._vehicule = parPiece.get(r.id) || null;
  });

  return rows;
}

// ==========================================================
//  GET /api/piece/:id
//  Renvoie tout ce dont la fiche a besoin en un seul appel
// ==========================================================
exports.getFiche = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Identifiant invalide.' });

    // --- 1. La pièce ---
    const [rows] = await db.query('SELECT * FROM pieces WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cette pièce n’est plus disponible.' });
    }

    // --- 2. Véhicules compatibles ---
    const [compatibilites] = await db.query(
      `SELECT pc.id, pc.id_modele, pc.annee_min, pc.annee_max, pc.motorisation,
              mo.modele, ma.nom AS marque, ma.id AS id_marque
       FROM piece_compatibilite pc
       JOIN modeles mo ON mo.id = pc.id_modele
       JOIN marques ma ON ma.id = mo.id_marque
       WHERE pc.id_piece = ?
       ORDER BY ma.nom, mo.modele`,
      [id],
    );

    // Le slug est construit après, pour pouvoir y mettre le véhicule
    const piece = formatPiece(rows[0], compatibilites[0] || null);

    // --- 3. Références (OE, équivalences, fournisseur) ---
    const [references] = await db.query(
      `SELECT id, reference, type, fabricant
       FROM piece_references
       WHERE id_piece = ?
       ORDER BY FIELD(type, 'OE', 'equivalent', 'fournisseur'), reference`,
      [id],
    );

    // --- 4. Autres pièces pour ce véhicule, avec repli en cascade ---
    const autres = await autresPiecesVehicule(id, piece, compatibilites);

    // --- 5. Pièces portant une référence identique ---
    //     Deux sources : la table des équivalences, et la référence
    //     constructeur portée directement par la pièce.
    const [equivalences] = await db.query(
      `SELECT DISTINCT p.id, p.ref_interne, p.ref_oe, p.description, p.categorie,
              p.etat, p.prix, p.quantite, p.img_principale, p.marque, p.modele
       FROM pieces p
       LEFT JOIN piece_references pr ON pr.id_piece = p.id
       WHERE p.id <> ?
         AND p.visible_catalogue = 1
         AND (
           pr.reference_norm IN (
             SELECT reference_norm FROM piece_references WHERE id_piece = ?
           )
           OR (p.ref_oe_norm IS NOT NULL AND p.ref_oe_norm <> ''
               AND p.ref_oe_norm = (SELECT ref_oe_norm FROM pieces WHERE id = ?))
         )
       LIMIT 6`,
      [id, id, id],
    );

    await attacherVehicules(equivalences);

    res.status(200).json({
      piece,
      compatibilites,
      references,
      autres_vehicule: autres.pieces,
      autres_titre: autres.titre,
      equivalences: equivalences.map(formatCarte),
      images: ['img_principale', 'img1', 'img2', 'img3', 'img4']
        .map((c) => piece[c])
        .filter(Boolean),
    });
  } catch (error) {
    console.error('Erreur fiche pièce :', error);
    res.status(500).json({ message: 'Erreur interne du serveur.', error: error.message });
  }
};

/**
 * Cascade de repli pour ne jamais afficher un bloc vide :
 * même modèle -> même marque -> même catégorie -> derniers ajouts.
 */
async function autresPiecesVehicule(id, piece, compatibilites) {
  const LIMITE = 8;
  const idsModeles = compatibilites.map((c) => c.id_modele);
  const vus = new Set([id]);
  const brutes = [];
  let titre = 'Autres pièces disponibles';

  const ajouter = (rows) => {
    rows.forEach((r) => {
      if (!vus.has(r.id) && brutes.length < LIMITE) {
        vus.add(r.id);
        brutes.push(r);
      }
    });
  };

  // ----------------------------------------------------------
  //  LES COLONNES RAMENÉES PAR LES QUATRE NIVEAUX
  //
  //  date_ajout et en_stock y figurent pour une raison précise :
  //  les niveaux 1 et 2 utilisent SELECT DISTINCT, et MySQL exige
  //  alors que tout ce qui apparaît dans le ORDER BY soit présent
  //  dans la liste sélectionnée. Sans elles :
  //
  //    ERROR 3065 : Expression #2 of ORDER BY clause is not in
  //    SELECT list, references column 'p.date_ajout'
  //
  //  MariaDB l'acceptait, MySQL 8 non, la règle étant rattachée à
  //  ONLY_FULL_GROUP_BY. Elle est fondée : trier sur une colonne
  //  que le DISTINCT a pu fusionner ne donne pas un ordre
  //  déterministe.
  //
  //  en_stock est calculé et nommé plutôt que laissé en expression
  //  dans le ORDER BY, pour que la règle soit satisfaite sans
  //  dépendre de l'interprétation du moteur.
  //
  //  Ajouter ces deux colonnes ne change pas le DISTINCT : p.id
  //  est déjà dans la liste et c'est la clé primaire, donc deux
  //  lignes issues de la jointure pour une même pièce restent
  //  identiques sur toutes les colonnes et se fusionnent comme
  //  avant. formatCarte ne les expose pas au client.
  // ----------------------------------------------------------
  const champs = `p.id, p.ref_interne, p.ref_oe, p.description, p.categorie, p.etat,
                  p.prix, p.quantite, p.img_principale, p.marque, p.modele,
                  p.date_ajout, (p.quantite > 0) AS en_stock`;

  // Niveau 1 : les pièces qui vont sur le même modèle
  if (idsModeles.length) {
    const [r1] = await db.query(
      `SELECT DISTINCT ${champs}
       FROM pieces p
       JOIN piece_compatibilite pc ON pc.id_piece = p.id
       WHERE pc.id_modele IN (?) AND p.id <> ? AND p.visible_catalogue = 1
       ORDER BY en_stock DESC, p.date_ajout DESC
       LIMIT ?`,
      [idsModeles, id, LIMITE],
    );
    if (r1.length) {
      const premier = compatibilites[0];
      titre = `Autres pièces pour cette ${premier.marque} ${premier.modele}`;
      ajouter(r1);
    }
  }

  // Niveau 2 : même marque de véhicule
  if (brutes.length < LIMITE && compatibilites.length) {
    const idsMarques = [...new Set(compatibilites.map((c) => c.id_marque))];
    const [r2] = await db.query(
      `SELECT DISTINCT ${champs}
       FROM pieces p
       JOIN piece_compatibilite pc ON pc.id_piece = p.id
       JOIN modeles mo ON mo.id = pc.id_modele
       WHERE mo.id_marque IN (?) AND p.id <> ? AND p.visible_catalogue = 1
       ORDER BY en_stock DESC, p.date_ajout DESC
       LIMIT ?`,
      [idsMarques, id, LIMITE],
    );
    if (r2.length && !brutes.length) {
      titre = `Autres pièces ${compatibilites[0].marque}`;
    }
    ajouter(r2);
  }

  // Niveau 3 : même catégorie
  if (brutes.length < LIMITE && piece.categorie) {
    const [r3] = await db.query(
      `SELECT ${champs} FROM pieces p
       WHERE p.categorie = ? AND p.id <> ? AND p.visible_catalogue = 1
       ORDER BY en_stock DESC, p.date_ajout DESC
       LIMIT ?`,
      [piece.categorie, id, LIMITE],
    );
    if (r3.length && !brutes.length) {
      titre = `Autres pièces de ${piece.categorie}`;
    }
    ajouter(r3);
  }

  // Niveau 4 : derniers ajouts, pour combler
  if (brutes.length < LIMITE) {
    const [r4] = await db.query(
      `SELECT ${champs} FROM pieces p
       WHERE p.id <> ? AND p.visible_catalogue = 1 AND p.quantite > 0
       ORDER BY p.date_ajout DESC
       LIMIT ?`,
      [id, LIMITE],
    );
    ajouter(r4);
  }

  // Le véhicule de chaque carte, en une requête pour tout le lot
  await attacherVehicules(brutes);

  return { pieces: brutes.map(formatCarte), titre };
}

// ==========================================================
//  GET /api/piece/reference/:ref
//  Recherche directe par référence interne, tolérante à la saisie
//  ("MA-00042-N", "ma00042n", "MA 00042 N" donnent la même pièce)
// ==========================================================
exports.getParReference = async (req, res) => {
  try {
    const norm = String(req.params.ref || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!norm) return res.status(400).json({ message: 'Référence vide.' });

    const [rows] = await db.query(
      `SELECT id FROM pieces
        WHERE ref_interne_norm = ?
           OR ref_oe_norm = ?
           OR ref_normalisee = ?
        LIMIT 1`,
      [norm, norm, norm],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: `Aucune pièce pour la référence ${req.params.ref}.` });
    }

    req.params.id = rows[0].id;
    return exports.getFiche(req, res);
  } catch (error) {
    console.error('Erreur recherche par référence :', error);
    res.status(500).json({ message: 'Erreur interne du serveur.' });
  }
};
