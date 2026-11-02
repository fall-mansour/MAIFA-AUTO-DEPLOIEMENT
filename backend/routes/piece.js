const express = require('express');
const router = express.Router();
const pieceCtrl = require('../controllers/Piece.controller');

// Fiche complète d'une pièce (détail + compatibilités + rebonds)
router.get('/:id', pieceCtrl.getFiche);

module.exports = router;
