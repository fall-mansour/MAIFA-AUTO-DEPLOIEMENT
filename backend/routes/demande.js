const express = require('express');
const router = express.Router();
const demandeCtrl = require('../controllers/demande.controller');

// La route complète sera : POST http://localhost:3000/api/demande
router.post('/', demandeCtrl.envoyerDemande);

module.exports = router;
