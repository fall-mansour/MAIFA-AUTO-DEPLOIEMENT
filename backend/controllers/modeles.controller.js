// controllers/modeles.controller.js
const db = require('../db');

// ==========================================================
//  GET /api/modeles/all
//  ⚠️ RÉTROCOMPATIBLE : `rappel_marque` n'existe plus dans la
//  table depuis la migration, mais acceuil.ts et demande.ts
//  l'attendent. On le reconstitue par un alias sur marques.nom.
// ==========================================================
exports.getAllModeles = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mo.id, mo.modele, ma.nom AS rappel_marque, ma.id AS id_marque
       FROM modeles mo
       JOIN marques ma ON ma.id = mo.id_marque
       WHERE mo.actif = 1 AND ma.actif = 1
       ORDER BY ma.nom, mo.modele`,
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (modeles/all) :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des modèles' });
  }
};

// ==========================================================
//  GET /api/modeles/marques
//  Marques ayant au moins un modèle, pour un premier select
// ==========================================================
exports.getMarques = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ma.id, ma.nom, COUNT(mo.id) AS nb_modeles
       FROM marques ma
       LEFT JOIN modeles mo ON mo.id_marque = ma.id AND mo.actif = 1
       WHERE ma.actif = 1
       GROUP BY ma.id, ma.nom
       HAVING nb_modeles > 0
       ORDER BY ma.nom`,
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (marques) :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des marques' });
  }
};

// ==========================================================
//  GET /api/modeles/marques/:id/modeles
//  Modèles d'une marque, pour le select en cascade
// ==========================================================
exports.getModelesParMarque = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, modele, annee_debut, annee_fin
       FROM modeles
       WHERE id_marque = ? AND actif = 1
       ORDER BY modele`,
      [req.params.id],
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (modeles par marque) :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des modèles' });
  }
};

// ==========================================================
//  GET /api/modeles/recherche?q=clio
//  Autocomplétion : cherche dans le modèle ET la marque
// ==========================================================
exports.chercherModeles = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.status(200).json([]);

    const [rows] = await db.query(
      `SELECT mo.id, mo.modele, ma.nom AS marque, ma.id AS id_marque
       FROM modeles mo
       JOIN marques ma ON ma.id = mo.id_marque
       WHERE mo.modele LIKE ? OR ma.nom LIKE ?
       ORDER BY ma.nom, mo.modele
       LIMIT 30`,
      [`%${q}%`, `%${q}%`],
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (recherche modeles) :', error);
    res.status(500).json({ message: 'Erreur lors de la recherche' });
  }
};

// ==========================================================
//  GET /api/modeles/categories
//  Familles generales uniquement (premier niveau).
//  Utilise par le select principal de la page d'ajout.
// ==========================================================
exports.getCategories = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nom, slug
       FROM categories
       WHERE id_parent IS NULL
       ORDER BY ordre, nom`,
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (categories) :', error);
    res.status(500).json({ message: 'Erreur lors de la recuperation des categories' });
  }
};

// ==========================================================
//  GET /api/modeles/categories/:id/sous-categories
//  Sous-categories d'une famille, pour le select en cascade.
//  Accepte l'id numerique ou le slug de la famille.
// ==========================================================
exports.getSousCategories = async (req, res) => {
  try {
    const cle = req.params.id;

    const [rows] = await db.query(
      `SELECT e.id, e.nom, e.slug
       FROM categories e
       JOIN categories p ON p.id = e.id_parent
       WHERE p.id = ? OR p.slug = ?
       ORDER BY e.ordre, e.nom`,
      [Number(cle) || 0, cle],
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error('Erreur SQL (sous-categories) :', error);
    res.status(500).json({ message: 'Erreur lors de la recuperation des sous-categories' });
  }
};
