const jwt = require('jsonwebtoken');

// ⚠️ À définir dans le .env : une chaîne longue et aléatoire.
// Si elle change, tous les jetons émis deviennent invalides.
const SECRET = process.env.JWT_SECRET || 'teranga_secret_a_remplacer_absolument';

// Avertissement au démarrage plutôt qu'une découverte en production
if (SECRET === 'teranga_secret_a_remplacer_absolument') {
  console.warn(
    '🚨 JWT_SECRET absent du .env : la valeur de repli du code est utilisée. ' +
      'Tout jeton peut être forgé. À corriger avant toute mise en ligne.',
  );
}

// ------------------------------------------------------------
//  DURÉES DE SESSION
//
//  Deux régimes, parce que les usages n'ont rien à voir.
//
//  CLIENT : 15 minutes d'INACTIVITÉ. Le jeton ne vaut qu'un quart
//  d'heure, mais il se renouvelle tant que la personne agit. Elle
//  n'est déconnectée que si elle laisse réellement son écran.
//
//  GESTION : 2 heures fermes. Pas de renouvellement : la session
//  s'arrête à l'échéance, même en pleine activité. Une session de
//  gestion qui se prolonge indéfiniment sur un poste partagé est
//  précisément ce qu'on veut éviter.
// ------------------------------------------------------------
const minutes = (valeur, defaut) => {
  const n = Number(valeur);
  return (Number.isFinite(n) && n > 0 ? n : defaut) * 60; // secondes
};

const DUREES = {
  client: minutes(process.env.JWT_DUREE_CLIENT_MIN, 15),
  gestionnaire: minutes(process.env.JWT_DUREE_GESTION_MIN, 120),
  responsable: minutes(process.env.JWT_DUREE_GESTION_MIN, 120),
};

/** Rôles dont le jeton se prolonge avec l'activité */
const RENOUVELABLES = new Set(['client']);

/**
 * On ne réémet pas à chaque requête : un jeton n'est renouvelé que
 * lorsqu'il a dépassé cette fraction de sa vie. Sans ce seuil, une
 * page qui fait dix appels signerait dix jetons.
 */
const SEUIL_RENOUVELLEMENT = 0.5;

const dureePour = (role) => DUREES[role] ?? DUREES.client;

// ------------------------------------------------------------
//  HIÉRARCHIE DES RÔLES
//
//  client < gestionnaire < responsable
//
//  Un responsable fait tout ce que fait un gestionnaire, et
//  consulte en plus le journal. Comparer les rôles par égalité
//  stricte l'aurait exclu de l'espace de gestion dès l'ajout du
//  nouveau rôle.
// ------------------------------------------------------------
const HIERARCHIE = {
  client: 0,
  gestionnaire: 1,
  responsable: 2,
};

const niveau = (role) => HIERARCHIE[role] ?? -1;

// ------------------------------------------------------------
//  LISTES BLANCHES
//
//  Définies dans le .env :
//
//    GESTIONNAIRES_AUTORISES=a@b.com,c@d.com
//    RESPONSABLES_AUTORISES=a@b.com
//
//  Elles doublent le contrôle du rôle stocké en base. Intérêt réel :
//  si quelqu'un parvenait à modifier la colonne `role` d'un compte,
//  la liste bloquerait quand même l'accès. Et une liste dans le .env
//  s'ajuste sans toucher au code ni redéployer.
//
//  Liste vide = contrôle désactivé pour ce rôle, seul le rôle en
//  base fait foi.
// ------------------------------------------------------------
const lireListe = (brut) =>
  (brut || '')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);

const GESTIONNAIRES = lireListe(process.env.GESTIONNAIRES_AUTORISES);
const RESPONSABLES = lireListe(process.env.RESPONSABLES_AUTORISES);

const dansListe = (liste, mail) => {
  if (liste.length === 0) return true; // contrôle désactivé
  return liste.includes(
    String(mail || '')
      .trim()
      .toLowerCase(),
  );
};

/** L'adresse figure-t-elle dans la liste des gestionnaires ? */
const estGestionnaireAutorise = (mail) => dansListe(GESTIONNAIRES, mail);

/** L'adresse figure-t-elle dans la liste des responsables ? */
const estResponsableAutorise = (mail) => dansListe(RESPONSABLES, mail);

/** Liste blanche correspondant à un rôle donné */
const autorisePour = (role, mail) => {
  if (role === 'responsable') return estResponsableAutorise(mail);
  if (role === 'gestionnaire') return estGestionnaireAutorise(mail);
  return true;
};

/**
 * Rôle réellement accordé : le rôle en base ET la liste blanche
 * doivent concorder.
 *
 * La rétrogradation est graduelle, pas brutale. Un responsable
 * absent de RESPONSABLES_AUTORISES mais présent dans la liste des
 * gestionnaires redevient gestionnaire, pas client : oublier une
 * ligne du .env au moment du déploiement ne doit pas verrouiller
 * son auteur hors de toute l'application.
 */
const roleEffectif = (user) => {
  const demande = user?.role || 'client';

  if (niveau(demande) <= 0) return 'client';

  if (autorisePour(demande, user.mail)) return demande;

  console.warn(
    `🚨 ALERTE : le compte ${user.mail} porte le rôle ${demande} ` +
      `mais ne figure pas dans la liste blanche correspondante.`,
  );

  // Un cran en dessous, si la liste de ce niveau l'accepte
  if (demande === 'responsable' && estGestionnaireAutorise(user.mail)) {
    console.warn(`   → rétrogradé au rôle gestionnaire pour ${user.mail}.`);
    return 'gestionnaire';
  }

  console.warn(`   → accès refusé pour ${user.mail}.`);
  return 'client';
};

// ------------------------------------------------------------
//  ÉMISSION
// ------------------------------------------------------------

/** Génère un jeton, de la durée correspondant au rôle accordé */
const signerJeton = (user) => {
  const role = roleEffectif(user);

  return jwt.sign({ id: user.id, mail: user.mail, role }, SECRET, { expiresIn: dureePour(role) });
};

/** Réémet un jeton à partir d'une charge déjà vérifiée */
const prolongerJeton = (charge) =>
  jwt.sign({ id: charge.id, mail: charge.mail, role: charge.role }, SECRET, {
    expiresIn: dureePour(charge.role),
  });

/** Date d'expiration en millisecondes, transmise au front pour l'affichage */
const expirationJeton = (token) => {
  try {
    const { exp } = jwt.decode(token);
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------
//  RENOUVELLEMENT
// ------------------------------------------------------------

/**
 * Prolonge la session d'un client actif.
 *
 * Le nouveau jeton part dans un en-tête de réponse plutôt que dans
 * le corps : il n'y a ainsi aucune route à modifier, et le front
 * le récupère au même endroit quelle que soit la requête.
 *
 * Les en-têtes personnalisés ne sont pas lisibles par le navigateur
 * sans y être autorisés, d'où l'Access-Control-Expose-Headers.
 */
const renouvelerSiBesoin = (res, charge) => {
  if (!charge || !RENOUVELABLES.has(charge.role)) return;
  if (!charge.exp) return;

  const totalMs = dureePour(charge.role) * 1000;
  const restantMs = charge.exp * 1000 - Date.now();

  if (restantMs > totalMs * SEUIL_RENOUVELLEMENT) return;

  try {
    const token = prolongerJeton(charge);
    res.setHeader('X-Nouveau-Jeton', token);
    res.setHeader('X-Nouvelle-Expiration', String(expirationJeton(token) ?? ''));
    res.setHeader('Access-Control-Expose-Headers', 'X-Nouveau-Jeton, X-Nouvelle-Expiration');
  } catch (erreur) {
    // Échouer à prolonger ne doit pas faire échouer la requête :
    // l'utilisateur sera simplement déconnecté à l'échéance.
    console.error('Renouvellement de jeton impossible :', erreur.message);
  }
};

// ------------------------------------------------------------
//  VÉRIFICATION
// ------------------------------------------------------------

/** Extrait le jeton de l'en-tête Authorization, ou null */
const lireJeton = (req) => {
  const entete = req.headers.authorization || '';
  return entete.startsWith('Bearer ') ? entete.slice(7) : null;
};

/**
 * Vérifie le jeton présent dans l'en-tête Authorization.
 * Place les informations de l'utilisateur dans req.utilisateur.
 */
const verifierJeton = (req, res, next) => {
  const token = lireJeton(req);

  if (!token) {
    return res.status(401).json({ message: 'Authentification requise.', code: 'JETON_ABSENT' });
  }

  try {
    req.utilisateur = jwt.verify(token, SECRET);
    renouvelerSiBesoin(res, req.utilisateur);
    next();
  } catch (error) {
    // Le front distingue les deux cas : expiré = reconnexion, invalide = déconnexion
    const expire = error.name === 'TokenExpiredError';
    return res.status(401).json({
      message: expire ? 'Session expirée, reconnectez-vous.' : 'Session invalide.',
      code: expire ? 'JETON_EXPIRE' : 'JETON_INVALIDE',
    });
  }
};

/**
 * Restreint l'accès à partir d'un niveau de rôle.
 *
 *   exigerRole('gestionnaire')   gestionnaires ET responsables
 *   exigerRole('responsable')    responsables seulement
 *
 * On retient le niveau le plus bas parmi ceux cités, et tout rôle
 * au-dessus passe. Les appels existants n'ont rien à changer.
 */
const exigerRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.utilisateur) {
      return res.status(401).json({ message: 'Authentification requise.', code: 'JETON_ABSENT' });
    }

    const requis = Math.min(...roles.map(niveau));
    const porte = niveau(req.utilisateur.role);

    if (porte < requis) {
      return res.status(403).json({ message: 'Accès réservé.', code: 'ROLE_INSUFFISANT' });
    }

    // Second contrôle sur la liste blanche : un jeton émis avant un
    // retrait de la liste resterait sinon valable jusqu'à son échéance.
    // On vérifie le rôle réellement porté, pas celui demandé par la route.
    if (porte >= 1 && !autorisePour(req.utilisateur.role, req.utilisateur.mail)) {
      console.warn(`🚨 Jeton ${req.utilisateur.role} hors liste blanche : ${req.utilisateur.mail}`);
      return res.status(403).json({ message: 'Accès réservé.', code: 'ROLE_INSUFFISANT' });
    }

    next();
  };

/**
 * Jeton facultatif : renseigne req.utilisateur s'il est valide,
 * mais laisse passer les visiteurs sans compte.
 * Utile pour la validation du panier, ouverte aux invités.
 *
 * Renouvelle lui aussi : le panier est l'endroit où un client passe
 * le plus de temps, ne pas y compter son activité le déconnecterait
 * au pire moment.
 */
const jetonFacultatif = (req, res, next) => {
  const token = lireJeton(req);

  if (token) {
    try {
      req.utilisateur = jwt.verify(token, SECRET);
      renouvelerSiBesoin(res, req.utilisateur);
    } catch {
      req.utilisateur = null;
    }
  }
  next();
};

module.exports = {
  DUREES,
  HIERARCHIE,
  niveau,
  dureePour,
  signerJeton,
  prolongerJeton,
  expirationJeton,
  verifierJeton,
  exigerRole,
  jetonFacultatif,
  estGestionnaireAutorise,
  estResponsableAutorise,
  roleEffectif,
  GESTIONNAIRES,
  RESPONSABLES,
};
