// ============================================================
//  MAIFA-AUTO — ROUTES DU JOURNAL
//
//  À monter dans server.js :
//      const journalRoutes = require('./routes/journal');
//      app.use('/api/journal', journalRoutes);
//
//  Réservé au responsable, verrou posé une fois pour le routeur
//  entier : une route ajoutée plus tard sera protégée sans qu'on
//  ait à y penser.
//
//  Aucune route d'écriture, de modification ni de suppression.
//  C'est volontaire et cela doit le rester.
// ============================================================

const express = require('express');

const controleur = require('../controllers/journal.controller');
const { verifierJeton, exigerRole } = require('../middleware/auth');

const router = express.Router();

router.use(verifierJeton, exigerRole('responsable'));

// Synthèse par gestionnaire, pour l'en-tête de la page
router.get('/synthese', controleur.synthese);

// Comptes gestionnaires et responsables
router.get('/equipe', controleur.equipe);

// Valeurs présentes dans le journal, pour alimenter les menus
router.get('/filtres', controleur.filtres);

// Export du journal filtré
router.get('/export', controleur.exporter);

// Historique complet d'une commande ou d'une pièce
router.get('/objet/:type/:id', controleur.historiqueObjet);

// Liste paginée. En dernier : sinon elle capterait /synthese,
// /equipe et les autres.
router.get('/', controleur.lister);

module.exports = router;
