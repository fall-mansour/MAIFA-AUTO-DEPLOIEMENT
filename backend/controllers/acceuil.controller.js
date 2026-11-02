const db = require('../db');

/** Fabrique un slug URL : "Plaquettes avant" + "RENAULT CLIO V" + 42 */
const construireSlug = (piece) => {
  const brut = [piece.description, piece.marque, piece.modele].filter(Boolean).join(' ');
  const slug = brut
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'piece'}-${piece.id}`;
};

/**
 * GET /api/acceuil
 * Renvoie les pièces de la vitrine ET la liste des catégories
 * disponibles, en un seul appel. Paramètres optionnels :
 *   ?limit=10        pour n'afficher qu'un aperçu
 *   ?categorie=slug  pour filtrer côté serveur
 */
exports.getPiecesAcceuil = async (req, res) => {
  try {
    const { limit, categorie, sous_categorie } = req.query;

    let sql = `
      SELECT
        p.id, p.marque, p.modele, p.description, p.prix, p.etat, p.annee,
        p.quantite, p.categorie, p.id_categorie, p.fournisseur, p.ref, p.ref_oe,
        p.img_principale, p.img1, p.img2, p.img3, p.img4, p.date_ajout,
        -- Sans sous-categorie renseignee, la piece est rangee dans
        -- un groupe « Autres <famille> », pour rester filtrable.
        COALESCE(sc.slug, CONCAT('autres-', fam.slug)) AS sous_categorie,
        COALESCE(sc.nom, CONCAT('Autres ', LOWER(fam.nom))) AS sous_categorie_nom
      FROM pieces p
      LEFT JOIN categories sc ON sc.id = p.id_sous_categorie
      LEFT JOIN categories fam
        ON fam.id_parent IS NULL
       AND (fam.id = p.id_categorie
            OR (p.id_categorie IS NULL AND fam.slug = LOWER(TRIM(p.categorie))))
      WHERE p.visible_catalogue = 1
    `;
    const params = [];

    if (categorie) {
      sql += ` AND (p.categorie = ? OR p.id_categorie = (
                 SELECT id FROM categories WHERE slug = ? AND id_parent IS NULL LIMIT 1
               ))`;
      params.push(categorie, categorie);
    }

    if (sous_categorie) {
      if (sous_categorie.startsWith('autres-')) {
        // Groupe de repli : pieces sans sous-categorie dans cette famille
        sql += ' AND sc.id IS NULL AND fam.slug = ?';
        params.push(sous_categorie.slice(7));
      } else {
        sql += ' AND sc.slug = ?';
        params.push(sous_categorie);
      }
    }

    sql += ' ORDER BY p.date_ajout DESC, p.id DESC';

    if (limit && Number(limit) > 0) {
      sql += ' LIMIT ?';
      params.push(Number(limit));
    }

    const [rows] = await db.query(sql, params);

    const pieces = rows.map((piece) => ({
      ...piece,
      prix: piece.prix !== null ? Number(piece.prix) : null,
      quantite: Number(piece.quantite) || 0,
      slug: construireSlug(piece),
      img_url: piece.img_principale
        ? piece.img_principale
        : 'https://via.placeholder.com/400x300?text=Image+indisponible',
    }));

    // Total du catalogue, pour afficher "8 pièces sur 312"
    const [[compte]] = await db.query(
      'SELECT COUNT(*) AS total FROM pieces WHERE visible_catalogue = 1',
    );

    // ----- FILTRE GÉNÉRAL (pastilles en haut de page) -----
    // Familles ayant au moins une pièce : jamais de famille vide,
    // la liste se met à jour toute seule.
    const [categories] = await db.query(`
      SELECT c.nom, c.slug, COUNT(DISTINCT p.id) AS nb
      FROM categories c
      JOIN pieces p
        ON (p.id_categorie = c.id OR LOWER(TRIM(p.categorie)) = c.slug)
       AND p.visible_catalogue = 1
      WHERE c.id_parent IS NULL
      GROUP BY c.id, c.nom, c.slug, c.ordre
      ORDER BY c.ordre, c.nom
    `);

    // ----- FILTRE DÉTAILLÉ (grille au-dessus du pied de page) -----
    // On part du RÉFÉRENTIEL : toutes les familles et toutes leurs
    // sous-catégories sont renvoyées, même vides. Le front grise
    // celles sans pièce, ce qui donne un menu complet et lisible.
    const [toutes] = await db.query(`
      SELECT id, nom, slug, id_parent, ordre
      FROM categories
      ORDER BY ordre, nom
    `);

    // Nombre de pièces par sous-catégorie
    const [parSous] = await db.query(`
      SELECT p.id_sous_categorie AS id, COUNT(DISTINCT p.id) AS nb
      FROM pieces p
      WHERE p.visible_catalogue = 1 AND p.id_sous_categorie IS NOT NULL
      GROUP BY p.id_sous_categorie
    `);
    const compteSous = new Map(parSous.map((r) => [r.id, Number(r.nb)]));

    // Pièces rattachées à une famille mais sans sous-catégorie :
    // elles forment un groupe « Autres <famille> », sinon elles
    // seraient introuvables depuis cette grille.
    const [parFamille] = await db.query(`
      SELECT fam.id AS id, COUNT(DISTINCT p.id) AS nb
      FROM pieces p
      JOIN categories fam
        ON fam.id_parent IS NULL
       AND (fam.id = p.id_categorie
            OR (p.id_categorie IS NULL AND fam.slug = LOWER(TRIM(p.categorie))))
      WHERE p.visible_catalogue = 1 AND p.id_sous_categorie IS NULL
      GROUP BY fam.id
    `);
    const compteAutres = new Map(parFamille.map((r) => [r.id, Number(r.nb)]));

    const familles = toutes
      .filter((c) => c.id_parent === null)
      .map((fam) => {
        const sous = toutes
          .filter((c) => c.id_parent === fam.id)
          .map((sc) => ({
            nom: sc.nom,
            slug: sc.slug,
            nb: compteSous.get(sc.id) || 0,
            autres: false,
          }));

        // Le groupe de repli vient en dernier, et seulement s'il est peuplé
        const nbAutres = compteAutres.get(fam.id) || 0;
        if (nbAutres > 0) {
          sous.push({
            nom: `Autres ${fam.nom.toLowerCase()}`,
            slug: `autres-${fam.slug}`,
            nb: nbAutres,
            autres: true,
          });
        }

        return {
          nom: fam.nom,
          slug: fam.slug,
          nb: sous.reduce((total, sc) => total + sc.nb, 0),
          sous,
        };
      });

    console.log(
      `✅ ${pieces.length} pièces envoyées (catalogue : ${compte.total}, ` +
        `${categories.length} familles, ${familles.length} familles détaillées)`,
    );

    res.status(200).json({
      pieces,
      total: Number(compte.total),
      affichees: pieces.length,
      categories: categories.map((c) => ({ ...c, nb: Number(c.nb) })),
      familles,
    });
  } catch (error) {
    console.error('❌ Erreur SQL lors de la récupération (Accueil) :', error.message);
    res.status(500).json({
      message: 'Erreur serveur lors de la récupération des pièces.',
      error: error.message,
    });
  }
};
