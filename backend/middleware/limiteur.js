const rateLimit = require('express-rate-limit');

/**
 * Limiteurs de debit.
 *
 * Sans eux, un attaquant peut essayer des milliers de mots de passe
 * par minute sur /api/connexion. C'est la faille la plus exploitee
 * en pratique, bien avant la connaissance de l'URL d'administration.
 */

/** Connexion : 10 tentatives par quart d'heure et par adresse IP */
const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Une connexion reussie ne compte pas : seuls les echecs sont decomptes
  skipSuccessfulRequests: true,
  message: {
    message: 'Trop de tentatives de connexion. Réessayez dans quinze minutes.',
    code: 'TROP_DE_TENTATIVES',
  },
});

/** Creation de compte : 5 par heure, pour limiter les comptes automatises */
const limiteurInscription = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Trop de créations de compte depuis cette connexion. Réessayez plus tard.',
    code: 'TROP_DE_TENTATIVES',
  },
});

/** Validation de panier : 20 par heure, pour eviter les commandes en masse */
const limiteurCommande = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Trop de commandes envoyées. Contactez-nous directement.',
    code: 'TROP_DE_TENTATIVES',
  },
});

/** Garde-fou general sur l'API, large pour ne gener aucun usage normal */
const limiteurGeneral = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de requêtes. Patientez un instant.' },
});

module.exports = {
  limiteurConnexion,
  limiteurInscription,
  limiteurCommande,
  limiteurGeneral,
};
