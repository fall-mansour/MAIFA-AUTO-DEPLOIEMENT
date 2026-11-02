// ============================================================
//  MAIFA-AUTO — ROUTES D'IMPORT ET D'EXPORT
//
//  À monter dans server.js :
//      const importRoutes = require('./routes/import');
//      app.use('/api/import', importRoutes);
//
//  Toutes les routes sont réservées aux gestionnaires. Le verrou
//  est posé une fois pour le routeur entier : une route ajoutée
//  plus tard sera protégée sans qu'on ait à y penser.
// ============================================================

const express = require('express');
const multer = require('multer');

const controleur = require('../controllers/import.controller');
const { verifierJeton, exigerRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
//  RÉCEPTION DU FICHIER
//
//  En mémoire, pas sur disque : le fichier est lu puis jeté, rien
//  ne traîne dans le système de fichiers du serveur.
// ------------------------------------------------------------

const TAILLE_MAX = 10 * 1024 * 1024; // 10 Mo

const TYPES_ACCEPTES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls, envoyé par certains navigateurs
  'application/octet-stream', // Safari sur macOS, parfois
]);

const reception = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX, files: 1 },
  fileFilter: (req, fichier, suite) => {
    const extensionOk = /\.xlsx$/i.test(fichier.originalname || '');

    // On se fie à l'extension autant qu'au type annoncé : le type
    // envoyé par le navigateur n'est pas fiable, surtout sur macOS.
    if (extensionOk || TYPES_ACCEPTES.has(fichier.mimetype)) {
      return suite(null, true);
    }

    suite(
      new Error(
        'Format non accepté. Le fichier doit être un classeur Excel (.xlsx). ' +
          'Depuis un .xls ou un .csv, enregistrez-le d abord au format .xlsx.',
      ),
    );
  },
});

/** Traduit les erreurs de multer en messages lisibles */
function receptionFichier(req, res, suite) {
  reception.single('fichier')(req, res, (erreur) => {
    if (!erreur) return suite();

    if (erreur.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `Fichier trop volumineux. Maximum ${TAILLE_MAX / 1024 / 1024} Mo.`,
      });
    }
    if (erreur.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: 'Un seul fichier à la fois, sous le nom de champ « fichier ».',
      });
    }
    return res.status(400).json({ message: erreur.message });
  });
}

// ------------------------------------------------------------
//  PROTECTION
// ------------------------------------------------------------
router.use(verifierJeton, exigerRole('gestionnaire'));

// ------------------------------------------------------------
//  ROUTES
// ------------------------------------------------------------

// Gabarit vierge, rempli des listes réelles du référentiel
router.get('/modele', controleur.telechargerModele);

// Export du stock, au même format que l'import
router.get('/export', controleur.exporter);

// Historique des imports
router.get('/lots', controleur.listerLots);

// Analyse d'un fichier. N'écrit RIEN au stock.
router.post('/analyser', receptionFichier, controleur.analyser);

// Reprise d'un lot analysé
router.get('/lots/:id', controleur.lireLot);

// Correction d'une ligne : choix d'un modèle, d'une catégorie,
// ou mise à l'écart
router.patch('/lots/:id/lignes/:idLigne', controleur.corrigerLigne);

// Application. C'est ici, et seulement ici, que le stock change.
router.post('/lots/:id/appliquer', controleur.appliquer);

// Abandon d'un lot non appliqué
router.delete('/lots/:id', controleur.annulerLot);

module.exports = router;
