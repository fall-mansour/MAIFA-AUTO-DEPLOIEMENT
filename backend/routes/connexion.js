const express = require('express');
const router = express.Router();
const connexionCtrl = require('../controllers/connexion.controller');
const { verifierJeton } = require('../middleware/auth');

// POST http://localhost:3000/api/connexion
router.post('/', connexionCtrl.login);

// Connexion ou inscription via Google
router.post('/google', connexionCtrl.loginGoogle);

// Vérification de la session au démarrage du front
router.get('/moi', verifierJeton, connexionCtrl.moi);

module.exports = router;
