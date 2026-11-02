const express = require('express');
const router = express.Router();
const profilCtrl = require('../controllers/profil.controller');
const { verifierJeton } = require('../middleware/auth');

// ============================================================
//  Toutes les routes exigent une session : l'identifiant vient
//  du jeton, jamais de l'URL. Aucun parametre :id n'est expose,
//  il serait sinon possible de lire ou modifier le profil d'un
//  autre client en changeant un chiffre.
// ============================================================
router.use(verifierJeton);

router.get('/', profilCtrl.getProfil);
router.put('/', profilCtrl.majProfil);

// Operations sensibles : mot de passe exige
router.put('/email', profilCtrl.changerEmail);
router.put('/motdepasse', profilCtrl.changerMotDePasse);

module.exports = router;
