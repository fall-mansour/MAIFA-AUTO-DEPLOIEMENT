const express = require('express');
const router = express.Router();
const stockCtrl = require('../controllers/stock.controller');
const { verifierJeton, exigerRole } = require('../middleware/auth');

// ============================================================
//  TOUTES les routes de stock sont reservees aux gestionnaires.
//  Le catalogue public passe par /api/acceuil et /api/piece.
// ============================================================
router.use(verifierJeton, exigerRole('gestionnaire'));

// ⚠️ Segments fixes AVANT /:id, sinon "stats" est interprete comme un id
router.get('/stats', stockCtrl.getStats);
router.get('/catalogue', stockCtrl.getCatalogue);
router.get('/recherche-ref/:ref', stockCtrl.chercherParReference);

router.get('/', stockCtrl.getAllPieces);
router.get('/:id', stockCtrl.getPieceById);

// Ajustement rapide du stock : { delta: 1 } ou { quantite: 12 }
router.patch('/:id/quantite', stockCtrl.majQuantite);

// Modification des informations : prix, description, seuil, etat...
router.patch('/:id', stockCtrl.majPiece);

router.delete('/:id', stockCtrl.deletePiece);

module.exports = router;
