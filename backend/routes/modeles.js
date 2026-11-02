const express = require('express');
const router = express.Router();
const modelesCtrl = require('../controllers/modeles.controller');

// Liste complete (format historique : id, modele, rappel_marque)
// Utilisee par acceuil.ts et demande.ts
router.get('/all', modelesCtrl.getAllModeles);

// Referentiel vehicules
router.get('/marques', modelesCtrl.getMarques);
router.get('/marques/:id/modeles', modelesCtrl.getModelesParMarque);
router.get('/recherche', modelesCtrl.chercherModeles);

// Categories : familles puis sous-categories en cascade
router.get('/categories', modelesCtrl.getCategories);
router.get('/categories/:id/sous-categories', modelesCtrl.getSousCategories);

module.exports = router;
