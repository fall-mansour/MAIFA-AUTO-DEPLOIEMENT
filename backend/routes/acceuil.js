const express = require('express');
const router = express.Router();
const acceuilCtrl = require('../controllers/acceuil.controller');

// GET http://localhost:3000/api/acceuil?limit=10&categorie=freinage&sous_categorie=plaquettes-frein
// Renvoie les pièces ET les deux niveaux de filtre en un seul appel
router.get('/', acceuilCtrl.getPiecesAcceuil);

module.exports = router;
