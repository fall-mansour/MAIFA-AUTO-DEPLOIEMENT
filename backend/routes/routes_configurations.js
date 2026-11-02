// ============================================================
//  MAIFA-AUTO — ROUTES DES CONFIGURATIONS DE VÉHICULES
//
//  À monter dans server.js :
//      const configurationRoutes = require('./routes/configurations');
//      app.use('/api/configurations', configurationRoutes);
//
//  Réservé aux gestionnaires, verrou posé une fois pour le routeur
//  entier. Ce n'est pas du catalogue public : la liste des
//  véhicules recherchés par les clients, avec leur fréquence, est
//  une information commerciale.
//
//  La table ne se remplit PAS depuis ici. Elle se remplit toute
//  seule à chaque recherche VIN sur la page d'accueil, par
//  vin.service. Ces routes ne font que lire, décoder un VIN que le
//  gestionnaire a sous les yeux, et rattraper les orphelines.
// ============================================================

const express = require('express');

const controleur = require('../controllers/configuration.controller');
const { verifierJeton, exigerRole } = require('../middleware/auth');

const router = express.Router();

router.use(verifierJeton, exigerRole('gestionnaire'));

// Décodage d'un numéro de châssis saisi par le gestionnaire.
// DÉCLARÉE AVANT la liste : une route plus spécifique d'abord,
// par principe, même si aucune collision n'est possible ici.
router.post('/vin', controleur.decoderVin);

// Rattrapage des configurations orphelines après enrichissement
// du référentiel marques/modeles.
router.post('/rattacher', controleur.rattacher);

// Liste, éventuellement filtrée par ?id_modele= ou ?marque=
router.get('/', controleur.lister);

module.exports = router;
