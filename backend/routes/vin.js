const express = require('express');
const router = express.Router();
const vinService = require('../services/vin.service');

// ============================================================
//  MAIFA-AUTO — ROUTE DE DÉCODAGE VIN
//
//  FONCTIONNALITÉ D'ESSAI. Un seul fichier, un seul point
//  d'entrée, le gestionnaire écrit ici plutôt que dans un
//  contrôleur séparé : le jour où tu la retires, tu supprimes
//  ce fichier et une ligne de server.js.
//
//  Route PUBLIQUE, comme le reste du catalogue : un client qui
//  cherche une pièce n'est pas connecté.
// ============================================================

// ------------------------------------------------------------
//  LIMITATION DE DÉBIT
//
//  La route est publique et chaque appel part vers une API
//  tierce. Sans garde-fou, un script qui essaie des VIN au
//  hasard fait pour nous des milliers de requêtes vers
//  l'administration américaine, qui finira par bloquer notre
//  adresse IP.
//
//  Compteur en mémoire : la fonctionnalité est temporaire,
//  inutile de sortir Redis pour ça.
// ------------------------------------------------------------
const FENETRE_MS = 60_000;
const MAX_PAR_FENETRE = 20;
const compteurs = new Map();

setInterval(() => {
  const limite = Date.now() - FENETRE_MS;
  for (const [ip, essais] of compteurs) {
    const restants = essais.filter((t) => t > limite);
    if (restants.length) compteurs.set(ip, restants);
    else compteurs.delete(ip);
  }
}, FENETRE_MS).unref(); // unref : n'empêche pas l'arrêt du serveur

function trop(ip) {
  const maintenant = Date.now();
  const essais = (compteurs.get(ip) || []).filter((t) => t > maintenant - FENETRE_MS);
  essais.push(maintenant);
  compteurs.set(ip, essais);
  return essais.length > MAX_PAR_FENETRE;
}

// ============================================================
//  POST /api/vin/extraire
//
//  Le client photographie la case du numéro de châssis de sa
//  carte grise. La reconnaissance de caractères se fait DANS SON
//  NAVIGATEUR, et c'est seulement le texte reconnu qui arrive
//  ici. Trois conséquences :
//
//    aucune photo ne transite ni n'est stockée
//    aucun crédit n'est consommé, l'opération est purement locale
//    la table WMI du serveur sert à retrouver le VIN dans le
//    texte, sans avoir à la recopier côté client
//
//  Corps attendu : { "texte": "E.3 N° ident TMBFA25J1A3149778 ..." }
// ============================================================
router.post('/extraire', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'inconnue';

  if (trop(ip)) {
    return res
      .status(429)
      .json({ vin: null, message: 'Trop de tentatives. Patientez une minute.' });
  }

  const texte = String(req.body?.texte ?? '');

  // Une page de carte grise reconnue tient largement dans 20 000
  // caractères. Au-delà, c'est autre chose, et la fenêtre
  // glissante tournerait pour rien.
  if (texte.length > 20000) {
    return res.status(413).json({ vin: null, message: 'Texte trop long.' });
  }

  try {
    const r = vinService.extraireVin(texte);

    return res.json({
      ...r,
      message: r.vin ? `Numéro lu : ${r.vin}` : 'Aucun numéro de châssis reconnu sur cette photo.',
    });
  } catch (erreur) {
    console.error('❌ Extraction VIN :', erreur.message);
    return res.status(500).json({ vin: null, message: 'Lecture impossible.' });
  }
});

// ============================================================
//  GET /api/vin/:vin
//
//  Réponse 200 dans tous les cas où le VIN est lisible, même si
//  le véhicule n'est pas reconnu : côté front, « non reconnu »
//  est une réponse, pas une erreur. Seul un VIN mal formé
//  renvoie 400.
//
//  DÉCLARÉE APRÈS /extraire : Express essaie les routes dans
//  l'ordre, et « /:vin » avalerait « /extraire » comme s'il
//  s'agissait d'un numéro de châssis.
// ============================================================
router.get('/:vin', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'inconnue';

  if (trop(ip)) {
    return res.status(429).json({
      valide: false,
      message: 'Trop de recherches. Patientez une minute.',
    });
  }

  try {
    const resultat = await vinService.decoder(req.params.vin);

    // VIN mal formé : longueur, caractères interdits
    if (!resultat.valide) {
      return res.status(400).json(resultat);
    }

    return res.json(resultat);
  } catch (erreur) {
    // Ne devrait pas arriver : decoder() avale déjà ses erreurs.
    // Le filet est là pour que la page d'accueil ne casse jamais
    // à cause d'une fonctionnalité d'essai.
    console.error('❌ Décodage VIN :', erreur.message);
    return res.status(500).json({
      valide: false,
      message: 'Recherche indisponible. Choisissez votre véhicule dans les listes.',
    });
  }
});

module.exports = router;
