const express = require('express');
const router = express.Router();
const panierCtrl = require('../controllers/panier.controller');
const { verifierJeton, exigerRole, jetonFacultatif } = require('../middleware/auth');
const { limiteurCommande } = require('../middleware/limiteur');

// ============================================================
//  PROTECTION DES ROUTES DE GESTION
//
//  Basculer a false UNIQUEMENT en developpement, pour inspecter
//  l'affichage sans se connecter. Un avertissement s'affiche alors
//  au demarrage du serveur.
// ============================================================
const PROTECTION_ACTIVE = true;

// Middlewares de gestion : liste vide quand la protection est coupee
const gestion = PROTECTION_ACTIVE ? [verifierJeton, exigerRole('gestionnaire')] : [];

if (!PROTECTION_ACTIVE) {
  console.warn('');
  console.warn('  ⚠️  ATTENTION : routes de gestion du panier NON PROTEGEES');
  console.warn('     Mode developpement uniquement. Remettre PROTECTION_ACTIVE');
  console.warn('     a true dans routes/panier.js avant tout deploiement.');
  console.warn('');
}

// --- Cote client : ouvert aux visiteurs sans compte ---
router.post('/verifier', panierCtrl.verifierPanier);
router.post('/valider', limiteurCommande, jetonFacultatif, panierCtrl.validerPanier);
router.get('/commande/:reference', panierCtrl.getCommande);

// --- Cote gestion ---
router.get('/commandes', ...gestion, panierCtrl.getCommandes);
router.get('/stats', ...gestion, panierCtrl.getStatsCommandes);
router.patch('/commande/:id/statut', ...gestion, panierCtrl.majStatut);

module.exports = router;

// ============================================================
//  POUR REACTIVER LA PROTECTION
//  Une seule ligne a changer, en haut de ce fichier :
//
//      const PROTECTION_ACTIVE = true;
//
//  Et cote front, remettre le garde sur la route dans
//  app.routes.ts :
//
//      {
//        path: 'commandes',
//        component: Commandes,
//        canActivate: [gestionnaireGuard],
//        title: 'Commandes — MAIFA-AUTO',
//      },
// ============================================================
