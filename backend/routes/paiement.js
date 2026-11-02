const express = require('express');
const router = express.Router();
const paiementCtrl = require('../controllers/Paiement.controller');
const { verifierJeton, exigerRole } = require('../middleware/auth');

// ============================================================
//  Initiation : jeton obligatoire.
//  Le controleur verifie en plus que la commande appartient bien
//  a l'utilisateur connecte.
// ============================================================
router.post('/initier', verifierJeton, paiementCtrl.initierPaiement);

// ============================================================
//  IPN : appele par les serveurs PayTech, PAS par le navigateur.
//  Aucun jeton possible ici : l'authenticite est etablie par la
//  signature HMAC, verifiee dans le controleur.
//
//  express.urlencoded est necessaire : PayTech poste en
//  application/x-www-form-urlencoded, pas en JSON.
// ============================================================
router.post(
  '/ipn',
  express.urlencoded({ extended: true }),
  express.json(),
  paiementCtrl.notificationPaytech,
);

// ============================================================
//  Retour du client depuis Wave ou Orange Money.
//  Simple redirection vers le front : les operateurs refusent une
//  URL de retour locale, le backend sert donc de relais public.
// ============================================================
router.get('/retour/:issue', paiementCtrl.retourPaiement);

// Consultation du statut, ouverte : la reference suffit et ne
// revele aucune donnee sensible
router.get('/statut/:reference', paiementCtrl.statutPaiement);

// Reconciliation manuelle, reservee au gestionnaire
router.post(
  '/reconcilier/:reference',
  verifierJeton,
  exigerRole('gestionnaire'),
  paiementCtrl.reconcilier,
);

module.exports = router;
