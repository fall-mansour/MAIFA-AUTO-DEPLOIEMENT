const db = require('../db');

// Référentiel des configurations, alimenté par les décodages.
//
// La dépendance va dans ce sens uniquement : configuration.service
// n'importe pas celui-ci. Aucun cycle, et ses fonctions avalent
// leurs propres erreurs, donc un apprentissage qui échoue ne casse
// jamais un décodage.
const configurations = require('./configuration.service');

// ============================================================
//  MAIFA-AUTO — DÉCODAGE DU NUMÉRO DE CHÂSSIS (VIN)
//
//  TROIS SOURCES, DANS CET ORDRE, ET LA RAISON DE CET ORDRE
//
//  1. TABLE LOCALE DES CODES CONSTRUCTEUR
//     Instantanée, hors ligne, gratuite. Donne la marque et
//     l'année. Couvre les marques françaises que l'API
//     américaine ignore. C'est elle qui fait le gros du travail
//     sur le parc sénégalais.
//
//  2. vPIC, administration américaine
//     Gratuite et illimitée. Appelée pour obtenir le MODÈLE.
//
//  3. VEHICLE DATABASES, europe-vin-decode
//     PAYANTE, au crédit. Appelée UNIQUEMENT si vPIC n'a pas
//     rendu de modèle.
//
//  POURQUOI PAS UN AIGUILLAGE PAR PAYS
//
//  L'idée naturelle est de router sur le premier caractère du
//  VIN, qui code la région. Vérifié en direct, elle est fausse :
//
//    JTDKB20U093500000  Japon      vPIC → Prius 2009      ✔
//    WDDGF4HB1CR200000  Allemagne  vPIC → C-Class 2012    ✔
//    KMHCM41BP8U123456  Corée      vPIC → Accent 2008     ✔
//    VF3LCYHZ7JS123456  France     vPIC → marque seule    �’
//
//  vPIC ne couvre pas ce qui est CONSTRUIT en Amérique, elle
//  couvre ce qui est VENDU sur le marché américain. Toyota,
//  Hyundai et Mercedes y sont vendues, donc elle les connaît, où
//  qu'elles soient assemblées. Router par pays aurait dépensé
//  trois crédits payants pour rien.
//
//  Mieux encore : la Mercedes WDD commence par W, lettre de
//  l'Allemagne, et son usine est en Afrique du Sud. Le premier
//  caractère n'indique même pas le pays d'assemblage.
//
//  La clé retenue est donc le RÉSULTAT, pas la provenance : on
//  ne paie que là où le gratuit a échoué.
//
//  Variables du .env :
//    VD_CLE=...                 clé Vehicle Databases
//    VD_CREDITS_JOUR=50         plafond d'appels payants par jour
//    VIN_CACHE_TABLE=1          utiliser la table vin_cache
// ============================================================

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

/**
 * Hôte de Vehicle Databases, réglable sans toucher au code.
 *
 * Utile s'ils te donnent une adresse distincte pour le bac à
 * sable, ou s'ils changent de version : VD_BASE_URL dans le .env
 * suffit alors.
 */
const VD_BASE = (process.env.VD_BASE_URL || 'https://api.vehicledatabases.com').replace(/\/+$/, '');

/**
 * Délais d'attente, volontairement différents.
 *
 * vPIC est servie par un gros hébergement public, elle répond en
 * quelques centaines de millisecondes ou pas du tout. Six
 * secondes y sont largement suffisantes, et surtout un échec n'y
 * coûte rien : on retombe sur la table locale.
 *
 * Vehicle Databases est plus lente, et depuis Dakar la latence
 * vers les États-Unis s'ajoute. Six secondes coupaient l'appel
 * avant la réponse : le crédit est éventuellement débité chez eux
 * et on n'en voit rien. Mieux vaut attendre quinze secondes de
 * temps en temps que payer pour rien.
 *
 * L'attente ne se produit que sur une configuration JAMAIS vue,
 * grâce au cache par squish VIN. Réglable par VD_DELAI_MS si ton
 * hébergement est plus rapide ou plus lent.
 */
const DELAI_MS = 6000;

/**
 * Douze secondes, et pas trente.
 *
 * Mesuré sur une réponse réelle depuis Dakar : leur décodage rend
 * la main en 2,2 secondes, leur /info en 2,9. Douze laissent donc
 * cinq fois la marge nécessaire.
 *
 * Au-delà, ce n'est plus de la lenteur. Face à un VIN absent de
 * leur base, leur serveur ne répond PAS : il ne renvoie pas
 * d'erreur, il reste muet. Attendre soixante secondes n'y change
 * rien et bloque le client d'autant.
 */
const VD_DELAI_MS = Number(process.env.VD_DELAI_MS || 12000);

const VD_CLE = process.env.VD_CLE || '';
const VD_ACTIVE = Boolean(VD_CLE);
const VD_PLAFOND_JOUR = Number(process.env.VD_CREDITS_JOUR || 50);
const CACHE_EN_BASE = process.env.VIN_CACHE_TABLE !== '0';

if (!VD_ACTIVE) {
  console.warn(
    '🚗 VD_CLE absente du .env : le décodage VIN se limitera à la table locale ' +
      'et à vPIC. Les véhicules européens ne rendront que leur marque.',
  );
}

// ------------------------------------------------------------
//  TABLE DES CODES CONSTRUCTEUR (WMI)
//
//  Les trois premiers caractères du VIN. Liste orientée parc
//  sénégalais : les marques qu'on voit réellement à Dakar, pas
//  un catalogue mondial.
//
//  Les clés de 3 caractères sont essayées d'abord, puis celles
//  de 2, ce qui permet de couvrir une marque entière sans lister
//  chacune de ses usines.
// ------------------------------------------------------------
const WMI = {
  // --- France ---
  VF1: 'RENAULT',
  VF2: 'RENAULT',
  VF6: 'RENAULT',
  VF8: 'MATRA',
  VF3: 'PEUGEOT',
  VF7: 'CITROEN',
  VF9: 'BUGATTI',
  VR1: 'DS',
  VR3: 'PEUGEOT',
  VR7: 'CITROEN',

  // --- Roumanie, Maroc, Turquie : usines Dacia et Renault ---
  UU1: 'DACIA',
  UU5: 'DACIA',
  UU6: 'DACIA',
  VSK: 'NISSAN',
  VSS: 'SEAT',
  NM0: 'FORD',
  NMT: 'TOYOTA',
  NLH: 'HYUNDAI',

  // --- Japon ---
  JTD: 'TOYOTA',
  JTE: 'TOYOTA',
  JTF: 'TOYOTA',
  JTG: 'TOYOTA',
  JTH: 'LEXUS',
  JTJ: 'LEXUS',
  JTK: 'TOYOTA',
  JTL: 'TOYOTA',
  JTM: 'TOYOTA',
  JTN: 'TOYOTA',
  JT2: 'TOYOTA',
  JT3: 'TOYOTA',
  JT4: 'TOYOTA',
  JT5: 'TOYOTA',
  JT6: 'LEXUS',
  JT8: 'LEXUS',
  JHM: 'HONDA',
  JHL: 'HONDA',
  JH4: 'HONDA',
  JN1: 'NISSAN',
  JN6: 'NISSAN',
  JN8: 'NISSAN',
  JNK: 'INFINITI',
  JM1: 'MAZDA',
  JM3: 'MAZDA',
  JM7: 'MAZDA',
  JMB: 'MITSUBISHI',
  JMY: 'MITSUBISHI',
  JA3: 'MITSUBISHI',
  JA4: 'MITSUBISHI',
  JSA: 'SUZUKI',
  JS1: 'SUZUKI',
  JS2: 'SUZUKI',
  JS3: 'SUZUKI',
  JF1: 'SUBARU',
  JF2: 'SUBARU',
  JAA: 'ISUZU',
  JAB: 'ISUZU',
  JAC: 'ISUZU',
  JAL: 'ISUZU',

  // --- Corée ---
  KMH: 'HYUNDAI',
  KMF: 'HYUNDAI',
  KM8: 'HYUNDAI',
  KMJ: 'HYUNDAI',
  KNA: 'KIA',
  KNB: 'KIA',
  KNC: 'KIA',
  KND: 'KIA',
  KNE: 'KIA',
  KNM: 'RENAULT',
  KPA: 'SSANGYONG',
  KPT: 'SSANGYONG',
  KL1: 'CHEVROLET',
  KL3: 'CHEVROLET',
  KLA: 'DAEWOO',

  // --- Allemagne ---
  WVW: 'VOLKSWAGEN',
  WV1: 'VOLKSWAGEN',
  WV2: 'VOLKSWAGEN',
  WVG: 'VOLKSWAGEN',
  WAU: 'AUDI',
  WA1: 'AUDI',
  TRU: 'AUDI',
  WBA: 'BMW',
  WBS: 'BMW',
  WBX: 'BMW',
  WBY: 'BMW',
  WDB: 'MERCEDES',
  WDC: 'MERCEDES',
  WDD: 'MERCEDES',
  WDF: 'MERCEDES',
  W1K: 'MERCEDES',
  W1N: 'MERCEDES',
  W1V: 'MERCEDES',
  WME: 'SMART',
  WMW: 'MINI',
  W0L: 'OPEL',
  W0V: 'OPEL',
  WOL: 'OPEL',
  WP0: 'PORSCHE',
  WP1: 'PORSCHE',
  WF0: 'FORD',
  WMA: 'MAN',

  // --- Royaume-Uni ---
  SAL: 'LAND ROVER',
  SAJ: 'JAGUAR',
  SCC: 'LOTUS',
  SHS: 'HONDA',
  SJN: 'NISSAN',
  SB1: 'TOYOTA',
  SFD: 'IVECO',

  // --- Italie, Espagne, Tchéquie ---
  ZFA: 'FIAT',
  ZFC: 'FIAT',
  ZFF: 'FERRARI',
  ZAR: 'ALFA ROMEO',
  ZCG: 'PIAGGIO',
  ZLA: 'LANCIA',
  ZAM: 'MASERATI',
  VSE: 'SEAT',
  TMB: 'SKODA',
  TMP: 'SKODA',
  TSM: 'SUZUKI',
  TMA: 'HYUNDAI',
  TMK: 'KIA',

  // --- Inde ---
  MAT: 'TATA',
  MA1: 'MAHINDRA',
  MA3: 'SUZUKI',
  MA6: 'CHEVROLET',
  MAJ: 'FORD',
  MAL: 'HYUNDAI',
  MBH: 'SUZUKI',
  MEE: 'RENAULT',
  MCA: 'MARUTI',
  MZB: 'MARUTI',
  MR0: 'TOYOTA',
  MM0: 'MAZDA',

  // --- Chine ---
  LSV: 'VOLKSWAGEN',
  LFV: 'VOLKSWAGEN',
  LVS: 'FORD',
  LGB: 'BYD',
  LC0: 'BYD',
  LJ1: 'JAC',
  LSG: 'CHEVROLET',
  LDC: 'PEUGEOT',
  LB2: 'GEELY',
  LVV: 'CHERY',
  LZW: 'CHEVROLET',

  // --- Amérique du Nord ---
  '1FA': 'FORD',
  '1FT': 'FORD',
  '1FM': 'FORD',
  '1FD': 'FORD',
  '2FA': 'FORD',
  '2FM': 'FORD',
  '2FT': 'FORD',
  '3FA': 'FORD',
  '3FE': 'FORD',
  '1G1': 'CHEVROLET',
  '1GC': 'CHEVROLET',
  '1GN': 'CHEVROLET',
  '2G1': 'CHEVROLET',
  '3G1': 'CHEVROLET',
  '1GK': 'GMC',
  '1GT': 'GMC',
  '1HG': 'HONDA',
  '2HG': 'HONDA',
  '5FN': 'HONDA',
  '19X': 'ACURA',
  '4T1': 'TOYOTA',
  '4T3': 'TOYOTA',
  '5TD': 'TOYOTA',
  '5TF': 'TOYOTA',
  '2T1': 'TOYOTA',
  '2T3': 'TOYOTA',
  '1N4': 'NISSAN',
  '1N6': 'NISSAN',
  '3N1': 'NISSAN',
  '5N1': 'NISSAN',
  '1C3': 'CHRYSLER',
  '1C4': 'JEEP',
  '1C6': 'RAM',
  '1J4': 'JEEP',
  '1J8': 'JEEP',
  '5XY': 'KIA',
  '5XX': 'KIA',
  '5NP': 'HYUNDAI',
  '4US': 'BMW',
  '5UX': 'BMW',
  '3VW': 'VOLKSWAGEN',
  '4JG': 'MERCEDES',

  // --- Deux caractères, repli ---
  JT: 'TOYOTA',
  JH: 'HONDA',
  JN: 'NISSAN',
  JM: 'MAZDA',
  JS: 'SUZUKI',
  JF: 'SUBARU',
  JA: 'ISUZU',
  KM: 'HYUNDAI',
  KN: 'KIA',
  WV: 'VOLKSWAGEN',
  WB: 'BMW',
  WD: 'MERCEDES',
  WA: 'AUDI',
  VF: 'PEUGEOT',
  UU: 'DACIA',
  ZF: 'FIAT',
  SA: 'LAND ROVER',
  '1F': 'FORD',
  '2F': 'FORD',
  '3F': 'FORD',
};

/** Pays d'assemblage, d'après le premier caractère */
const PAYS = {
  1: 'États-Unis',
  2: 'Canada',
  3: 'Mexique',
  4: 'États-Unis',
  5: 'États-Unis',
  6: 'Australie',
  7: 'Nouvelle-Zélande',
  8: 'Argentine',
  9: 'Brésil',
  J: 'Japon',
  K: 'Corée du Sud',
  L: 'Chine',
  M: 'Inde',
  N: 'Turquie',
  S: 'Royaume-Uni',
  T: 'Tchéquie ou Hongrie',
  U: 'Roumanie',
  V: 'France ou Espagne',
  W: 'Allemagne',
  X: 'Russie',
  Y: 'Suède',
  Z: 'Italie',
};

/**
 * Marques que vPIC ne décode JAMAIS au-delà du nom : elles ne
 * sont pas vendues sur le marché américain.
 *
 * Ce n'est pas la règle d'aiguillage, c'est un raccourci. Pour
 * ces marques on saute directement à Vehicle Databases, ce qui
 * économise un aller-retour, pas un crédit. La règle reste le
 * résultat : partout ailleurs vPIC est interrogée d'abord.
 */
const HORS_MARCHE_US = new Set([
  'PEUGEOT',
  'CITROEN',
  'DS',
  'RENAULT',
  'DACIA',
  'OPEL',
  'SEAT',
  'SKODA',
  'LANCIA',
  'VAUXHALL',
  'TALBOT',
  'SIMCA',
  'MATRA',
  'LADA',
  'SSANGYONG',
  'TATA',
  'MAHINDRA',
  'MARUTI',
  'CHERY',
  'GEELY',
  'BYD',
  'JAC',
  'DAEWOO',
]);

/**
 * Codes d'année, position 10.
 *
 * Le cycle fait trente ans : « J » vaut 1988 ET 2018. La règle
 * qui tranche, un caractère alphabétique en position 7 pour les
 * véhicules récents, est une convention nord-américaine que les
 * constructeurs européens ne suivent pas.
 *
 * Vehicle Databases ne renvoie PAS le millésime, cette ambiguïté
 * ne sera donc pas levée par elle. On rend les deux hypothèses,
 * la récente d'abord : un véhicule qui roule au Sénégal a bien
 * plus de chances d'être de 2018 que de 1988.
 */
const CODES_ANNEE = 'ABCDEFGHJKLMNPRSTVWXY123456789';

// ------------------------------------------------------------
//  OUTILS
// ------------------------------------------------------------

const normaliser = (vin) =>
  String(vin || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** I, O et Q sont interdits dans un VIN : ils se confondent avec 1 et 0 */
const CARACTERES_INTERDITS = /[IOQ]/;

const VALEURS = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const POIDS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Chiffre de contrôle, position 9.
 *
 * Obligatoire en Amérique du Nord, facultatif ailleurs. On ne
 * REFUSE donc jamais un VIN sur ce seul critère : la moitié des
 * Peugeot et Renault seraient écartées à tort.
 */
function controleValide(vin) {
  try {
    let somme = 0;
    for (let i = 0; i < 17; i++) {
      const c = vin[i];
      const v = /[0-9]/.test(c) ? Number(c) : VALEURS[c];
      if (v === undefined) return null;
      somme += v * POIDS[i];
    }
    const reste = somme % 11;
    const attendu = reste === 10 ? 'X' : String(reste);
    return vin[8] === attendu;
  } catch {
    return null;
  }
}

/** Marque d'après les trois premiers caractères, puis les deux premiers */
function marqueDepuisWmi(vin) {
  return WMI[vin.slice(0, 3)] || WMI[vin.slice(0, 2)] || null;
}

/** Années possibles, la plus probable en premier */
function anneesPossibles(vin) {
  const index = CODES_ANNEE.indexOf(vin[9]);
  if (index === -1) return { annees: [], certaine: false };

  const ancienne = 1980 + index;
  const recente = ancienne + 30;
  const maintenant = new Date().getFullYear();

  // Une année à venir n'a pas de sens : on retombe sur l'ancienne
  if (recente > maintenant + 1) {
    return { annees: [ancienne], certaine: true };
  }

  // La position 7 tranche, mais seulement pour les véhicules
  // nord-américains. Ailleurs, les deux restent possibles.
  const nordAmericain = /^[1-5]/.test(vin);
  if (nordAmericain) {
    const recent = /[A-Z]/.test(vin[6]);
    return { annees: [recent ? recente : ancienne], certaine: true };
  }

  return { annees: [recente, ancienne], certaine: false };
}

// ============================================================
//  CACHE, INDEXÉ SUR LE SQUISH VIN
//
//  LA CLÉ N'EST PAS LE VIN COMPLET, ET C'EST TOUT L'INTÉRÊT.
//
//  Les positions 1 à 8 et 10 décrivent le VÉHICULE : constructeur,
//  carrosserie, motorisation, millésime. Le numéro de série vit
//  ailleurs (positions 11 à 17), et la position 9 n'est qu'un
//  chiffre de contrôle. Cette empreinte de 9 caractères s'appelle
//  le squish VIN, et c'est la clé que l'industrie emploie pour
//  exactement cet usage. Vehicle Databases la renvoie d'ailleurs
//  dans son champ « Squish VIN ».
//
//    VF3LCYHZ7JS123456
//    VF3LCYHZ J            ← toutes les 208 de ce millésime et de
//                            cette motorisation
//
//  Conséquence : un crédit payé ne couvre plus UNE voiture mais
//  un modèle, une année, une variante. Le deuxième client qui
//  arrive avec une 206 de 2004 ne coûte rien. La dépense cesse
//  d'être proportionnelle au trafic ; elle est bornée par le
//  nombre de configurations qui roulent réellement à Dakar.
//
//  Ce qui dépend de l'exemplaire (le VIN lui-même, son chiffre de
//  contrôle) n'est donc PAS mis en cache : c'est recalculé à
//  chaque fois, ce qui ne coûte rien.
//
//  Les ÉCHECS sont mis en cache eux aussi. Une configuration que
//  Vehicle Databases ne connaît pas ne doit pas être redemandée,
//  sinon on paie deux fois la même absence de réponse.
// ============================================================

/** Empreinte du véhicule : positions 1 à 8 et 10, sans le contrôle */
const squish = (vin) => vin.slice(0, 8) + vin[9];

const memoire = new Map();
const MEMOIRE_MAX = 500;

/** Ce qui décrit le véhicule, par opposition à l'exemplaire */
const partieVehicule = (r) => ({
  marque: r.marque,
  modele: r.modele,
  annee: r.annee,
  annees_possibles: r.annees_possibles,
  annee_certaine: r.annee_certaine,
  source: r.source,
  details: r.details,
});

function enMemoire(cle, charge) {
  if (memoire.size >= MEMOIRE_MAX) memoire.delete(memoire.keys().next().value);
  memoire.set(cle, charge);
}

async function lireCache(cle) {
  if (memoire.has(cle)) return memoire.get(cle);
  if (!CACHE_EN_BASE) return null;

  try {
    const [lignes] = await db.query('SELECT charge FROM vin_cache WHERE squish = ?', [cle]);
    if (!lignes.length) return null;

    const charge = JSON.parse(lignes[0].charge);
    enMemoire(cle, charge);

    // Compteur de réutilisation : c'est lui qui chiffre ce que le
    // cache a fait économiser. Volontairement sans await, pour ne
    // pas ralentir la réponse sur une écriture décorative.
    db.query('UPDATE vin_cache SET relectures = relectures + 1 WHERE squish = ?', [cle]).catch(
      () => {},
    );

    return charge;
  } catch (erreur) {
    // Table absente ou base indisponible : le cache mémoire
    // continue de fonctionner, le décodage n'est pas bloqué.
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('VIN : lecture du cache impossible —', erreur.message);
    }
    return null;
  }
}

/**
 * N'écrit que ce qui est DÉFINITIF.
 *
 * La version précédente enregistrait tout, y compris un décodage
 * qui avait échoué faute de réponse. Une Skoda dont l'appel avait
 * expiré une fois était gravée « marque seule, pas de modèle », et
 * plus jamais réinterrogée : le cache répondait à sa place. Le
 * crédit suivant n'était pas dépensé, mais le modèle n'arrivait
 * jamais non plus.
 *
 * Est définitif ce qui ne changera pas en réessayant :
 *   un modèle trouvé, par vPIC ou par Vehicle Databases
 *   un « aucun enregistrement » explicite de leur part
 *
 * Est provisoire, et n'est donc PAS gardé :
 *   un délai dépassé, une panne réseau, un plafond atteint,
 *   une clé refusée
 */
async function ecrireCache(cle, charge, paye, definitif) {
  if (!definitif) return;

  enMemoire(cle, charge);
  if (!CACHE_EN_BASE) return;

  try {
    await db.query(
      `INSERT INTO vin_cache (squish, charge, source, paye)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE charge = VALUES(charge), source = VALUES(source),
                               paye = GREATEST(paye, VALUES(paye))`,
      [cle, JSON.stringify(charge), charge.source || 'local', paye ? 1 : 0],
    );
  } catch (erreur) {
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('VIN : écriture du cache impossible —', erreur.message);
    }
  }
}

// ============================================================
//  GARDE-FOU BUDGÉTAIRE
//
//  La route de décodage est publique. Sans plafond, un script
//  qui essaie des VIN au hasard vide le quota mensuel en
//  quelques minutes, et la facture arrive sans prévenir.
//
//  Trois freins, du plus souple au plus ferme :
//    un plafond d'appels par jour, remis à zéro à minuit
//    une mise en sommeil de 10 minutes après un 429
//    un arrêt définitif après un 401, qui signale une clé fausse
// ============================================================
const budget = {
  jour: new Date().toDateString(),
  consommes: 0,
  sommeilJusqua: 0,
  cleInvalide: false,
};

function budgetDisponible() {
  if (!VD_ACTIVE || budget.cleInvalide) return false;
  if (Date.now() < budget.sommeilJusqua) return false;

  const aujourdhui = new Date().toDateString();
  if (budget.jour !== aujourdhui) {
    budget.jour = aujourdhui;
    budget.consommes = 0;
  }
  return budget.consommes < VD_PLAFOND_JOUR;
}

/** État du budget, pour une page d'administration ou un journal */
function etatBudget() {
  return {
    active: VD_ACTIVE,
    cle_invalide: budget.cleInvalide,
    consommes_aujourdhui: budget.consommes,
    plafond_jour: VD_PLAFOND_JOUR,
    en_sommeil: Date.now() < budget.sommeilJusqua,
    sommeil_jusqua: budget.sommeilJusqua ? new Date(budget.sommeilJusqua).toISOString() : null,
  };
}

// ------------------------------------------------------------
//  APPEL À vPIC
// ------------------------------------------------------------

/**
 * Demande le modèle à l'API américaine.
 * Ne lève jamais : une panne réseau doit laisser le décodage
 * local intact, pas faire échouer toute la recherche.
 */
async function interrogerVpic(vin) {
  try {
    const reponse = await fetch(`${VPIC}/${encodeURIComponent(vin)}?format=json`, {
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { Accept: 'application/json' },
    });

    if (!reponse.ok) return null;

    const donnees = await reponse.json();
    const r = donnees?.Results?.[0];
    if (!r) return null;

    const vide = (v) => !v || v === 'Not Applicable' || String(v).trim() === '';

    // Series et Trim ne sont volontairement pas repris : vPIC y met
    // des codes de plateforme constructeur (« MC » pour une Accent)
    // qui ne disent rien à un acheteur de pièces.
    return {
      marque: vide(r.Make) ? null : String(r.Make).trim().toUpperCase(),
      modele: vide(r.Model) ? null : String(r.Model).trim(),
      annee: vide(r.ModelYear) ? null : Number(r.ModelYear),
      carrosserie: vide(r.BodyClass) ? null : String(r.BodyClass).trim(),
      motorisation: vide(r.DisplacementL) ? null : `${Number(r.DisplacementL).toFixed(1)} L`,
      carburant: vide(r.FuelTypePrimary) ? null : String(r.FuelTypePrimary).trim(),
      usine: vide(r.PlantCountry) ? null : String(r.PlantCountry).trim(),
    };
  } catch (erreur) {
    console.warn('VIN : vPIC injoignable —', erreur.message);
    return null;
  }
}

// ------------------------------------------------------------
//  APPEL À VEHICLE DATABASES
// ------------------------------------------------------------

/**
 * Lit une clé imbriquée dont le nom porte des espaces.
 *
 * Nettoie aussi un défaut d'encodage présent dans leurs réponses :
 * « Â Skoda Czech Republic » au lieu de « Skoda ». Le  Â
 * parasite vient d'un UTF-8 encodé deux fois chez eux. Sans ce
 * filtrage, il se retrouverait tel quel sur la fiche du client.
 */
const champ = (objet, section, nom) => {
  const v = objet?.[section]?.[nom];
  if (v === null || v === undefined) return null;

  const t = String(v).replace(/Â/g, '').replace(/\s+/g, ' ').trim();

  return t && t !== '-' && t.toLowerCase() !== 'n/a' ? t : null;
};

/**
 * Décodage européen, payant.
 *
 * @returns {Promise<{donnees: object|null, paye: boolean}>}
 *   paye vaut true dès qu'un crédit a pu être consommé, même si
 *   la réponse est vide : c'est ce qu'il faut mettre en cache
 *   pour ne pas repayer la même absence de résultat.
 */
async function interrogerVehicleDatabases(vin) {
  if (!budgetDisponible()) {
    return { donnees: null, paye: false, raison: 'budget' };
  }

  budget.consommes++;
  const debut = Date.now();

  try {
    const reponse = await fetch(`${VD_BASE}/europe-vin-decode/v2/${encodeURIComponent(vin)}`, {
      signal: AbortSignal.timeout(VD_DELAI_MS),
      headers: { 'x-authkey': VD_CLE, Accept: 'application/json' },
    });

    // Un refus d'authentification ou de débit ne consomme pas de
    // crédit : on rend celui qu'on venait de compter, sinon le
    // garde-fou se fermerait sur une dépense qui n'a pas eu lieu.
    if (reponse.status === 401) {
      // Clé fausse ou révoquée. On arrête net : réessayer ne
      // ferait que répéter l'échec à chaque recherche.
      budget.consommes = Math.max(0, budget.consommes - 1);
      budget.cleInvalide = true;
      console.error('🚗 Vehicle Databases : clé refusée (401). Décodage européen désactivé.');
      return { donnees: null, paye: false, raison: 'cle' };
    }

    if (reponse.status === 429) {
      budget.consommes = Math.max(0, budget.consommes - 1);
      budget.sommeilJusqua = Date.now() + 10 * 60 * 1000;
      console.warn('🚗 Vehicle Databases : débit dépassé (429). Mise en sommeil 10 minutes.');
      return { donnees: null, paye: false, raison: 'debit' };
    }

    // ----------------------------------------------------------
    //  TOUTE AUTRE RÉPONSE : on imprime leur message tel quel.
    //
    //  Sans ça, un refus de leur part est indiscernable d'un
    //  véhicule inconnu : les deux donnent une fiche sans modèle.
    //  Leur corps de réponse dit souvent précisément ce qui cloche
    //  (service non souscrit, endpoint hors forfait, VIN hors
    //  couverture), et c'est la seule trace qui permette de
    //  trancher sans les appeler.
    // ----------------------------------------------------------
    if (!reponse.ok) {
      let corpsBrut = '';
      try {
        corpsBrut = (await reponse.text()).slice(0, 400);
      } catch {
        corpsBrut = '(corps illisible)';
      }

      console.warn(
        `🚗 Vehicle Databases a refusé ${vin} — HTTP ${reponse.status}\n` +
          `   Réponse : ${corpsBrut || '(vide)'}`,
      );

      // 400 signifie « aucun enregistrement » dans leur
      // documentation. Compté comme payant par PRUDENCE : ils ne
      // disent pas si une recherche infructueuse débite un crédit,
      // et mieux vaut surestimer que dépasser le quota sans le
      // voir venir. Mis en cache, donc payé une seule fois.
      if (reponse.status === 400) {
        return { donnees: null, paye: true, raison: 'inconnu' };
      }

      return { donnees: null, paye: true, raison: `http_${reponse.status}` };
    }

    const corps = await reponse.json();
    if (corps?.status !== 'success' || !corps?.data) {
      return { donnees: null, paye: true, raison: 'vide' };
    }

    const d = corps.data;
    const general = 'General Information';
    const spec = 'Vehicle Specification';

    // ----------------------------------------------------------
    //  LE MILLÉSIME EST DANS « Year », PAS DANS « Manufactured in »
    //
    //  Leur documentation ne liste pas « Year », et j'avais déduit
    //  à tort que « Manufactured in » pouvait le porter. Une
    //  réponse réelle tranche :
    //
    //    "Year": "2010"
    //    "Manufactured in": "Czech Republic"
    //
    //  Le second est le PAYS. Sans cette correction, le millésime
    //  était perdu sur chaque décodage réussi, et l'ambiguïté des
    //  trente ans restait posée au client alors que la réponse
    //  payée contenait la bonne année.
    // ----------------------------------------------------------
    const anneeLue = champ(d, general, 'Year');
    const annee =
      anneeLue && /^\d{4}$/.test(anneeLue) && Number(anneeLue) >= 1981 ? Number(anneeLue) : null;

    const paysFabrication = champ(d, general, 'Manufactured in');
    const cylindree = champ(d, spec, 'Displacement SI');
    const marqueLue = (champ(d, general, 'Make') || '').toUpperCase() || null;
    const modeleLu = champ(d, general, 'Model');

    // ----------------------------------------------------------
    //  DIAGNOSTIC DE LA LECTURE DES CHAMPS
    //
    //  Leur réponse est arrivée et annonce « success », mais rien
    //  n'en est sorti. Deux causes possibles, et elles ne se
    //  distinguent pas du résultat affiché au client :
    //
    //    leur base ne connaît pas ce véhicule   → normal
    //    mes noms de champs sont faux           → bogue, et le
    //                                             crédit est perdu
    //
    //  On imprime donc la structure réelle de leur réponse. C'est
    //  la seule trace qui permette de trancher, et elle ne coûte
    //  rien puisque l'appel a déjà eu lieu.
    // ----------------------------------------------------------
    if (!marqueLue && !modeleLu) {
      console.warn(
        `🚗 Vehicle Databases : ${vin} répond « success » mais aucun champ lu.\n` +
          `   Sections reçues : ${Object.keys(d).join(', ')}\n` +
          `   Clés de "${general}" : ${Object.keys(d[general] || {}).join(', ') || 'section absente'}`,
      );
    } else {
      console.log(
        `🚗 Vehicle Databases : ${vin} → ${marqueLue || '?'} ${modeleLu || '(modèle absent)'} · 1 crédit`,
      );
    }

    return {
      paye: true,
      donnees: {
        marque: marqueLue,
        modele: modeleLu,
        annee,
        finition: champ(d, general, 'Trim level'),
        carrosserie:
          champ(d, general, 'Body style') ||
          champ(d, spec, 'Body type') ||
          champ(d, general, 'Vehicle class'),
        carburant: champ(d, general, 'Fuel type'),
        boite: champ(d, general, 'Transmission'),
        motorisation: cylindree || champ(d, general, 'Engine type'),
        portes: champ(d, spec, 'Number of doors'),
        places: champ(d, spec, 'Number of seats'),
        transmission: champ(d, spec, 'Driveline'),
        puissance: champ(d, spec, 'Engine horsepower'),
        usine: champ(d, 'Manufacturer', 'Country') || paysFabrication,
      },
    };
  } catch (erreur) {
    const ecoule = Date.now() - debut;
    const parDelai = /abort|timeout/i.test(erreur.message);

    console.warn(
      `🚗 Vehicle Databases injoignable après ${(ecoule / 1000).toFixed(1)} s — ${erreur.message}`,
    );

    if (parDelai) {
      console.warn(
        `   Délai réglé à ${VD_DELAI_MS / 1000} s. S'il est atteint souvent, augmente ` +
          'VD_DELAI_MS dans le .env, ou vérifie que ton hébergement joint bien ' +
          'api.vehicledatabases.com.',
      );
    }

    // Le crédit n'a probablement pas été débité puisqu'aucune
    // réponse n'est arrivée, mais on l'avait déjà compté. On le
    // rend plutôt que de fermer le plafond sur une dépense
    // incertaine. En contrepartie, un délai dépassé qui aurait
    // quand même été facturé chez eux passerait inaperçu : c'est
    // le tableau de bord Vehicle Databases qui fait foi, pas ce
    // compteur.
    budget.consommes = Math.max(0, budget.consommes - 1);
    return { donnees: null, paye: false, raison: parDelai ? 'delai' : 'reseau' };
  }
}

/**
 * Configurations dont l'appel a expiré, gardées EN MÉMOIRE SEULE.
 *
 * Un VIN absent de leur base ne provoque pas une erreur mais un
 * silence. Sans cette liste, chaque nouvelle tentative sur le même
 * véhicule referait attendre douze secondes.
 *
 * En mémoire et jamais en base, délibérément : un silence peut
 * aussi venir d'une panne passagère chez eux. Le redémarrage du
 * serveur efface l'ardoise et laisse une seconde chance, là où
 * une ligne en base condamnerait la configuration pour toujours.
 */
const silences = new Set();

/** Crédits restants chez Vehicle Databases, pour contrôle */
async function creditsRestants() {
  if (!VD_ACTIVE) return { disponible: false };
  try {
    const reponse = await fetch(`${VD_BASE}/info`, {
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'x-authkey': VD_CLE, Accept: 'application/json' },
    });
    if (!reponse.ok) return { disponible: false, statut: reponse.status };
    return { disponible: true, ...(await reponse.json()) };
  } catch (erreur) {
    return { disponible: false, erreur: erreur.message };
  }
}

// ============================================================
//  EXTRACTION D'UN VIN DANS UN TEXTE RECONNU PAR OCR
//
//  Le client photographie la case du numéro de châssis sur sa
//  carte grise. La reconnaissance de caractères ne rend pas un
//  VIN propre : elle rend tout ce qu'elle a cru voir, libellés
//  compris, avec ses erreurs de lecture.
//
//    "E.1 N° identification  VF3LCYHZ7JS1Z3456  D.1 PEUGEOT"
//
//  Le travail n'est donc pas de lire, c'est de RETROUVER le VIN
//  là-dedans. Et un VIN n'est pas une chaîne quelconque : ses
//  règles permettent de le reconnaître et de corriger une bonne
//  partie des fautes de lecture.
//
//    I, O et Q sont INTERDITS dans un VIN. Toute lecture qui en
//    produit se corrige donc sans perte : I devient 1, O et Q
//    deviennent 0. Ce sont justement les confusions les plus
//    fréquentes en reconnaissance de caractères.
//
//    17 caractères, ni plus ni moins.
//
//    Les trois premiers doivent figurer dans la table WMI, qui
//    connaît déjà les marques du parc.
//
//    Le dixième code le millésime et n'accepte que 30 valeurs.
//
//    Le neuvième est un chiffre de contrôle calculable.
//
//  On fait donc glisser une fenêtre de 17 caractères sur tout le
//  texte nettoyé, on note chaque position, et on rend la
//  meilleure. Le résultat n'a pas besoin d'être certain : il
//  remplit un champ qui reste modifiable, et fait gagner seize
//  caractères de saisie sur dix-sept.
// ============================================================

/**
 * Corrections SÛRES : ces trois lettres sont interdites dans un
 * VIN, les remplacer ne peut donc jamais abîmer un numéro valide.
 * Ce sont aussi les confusions les plus fréquentes en OCR.
 */
const CORRECTIONS_SURES = { I: '1', O: '0', Q: '0' };

/**
 * Confusions SPÉCULATIVES : ces lettres sont parfaitement légales
 * dans un VIN. Les remplacer partout détruirait un numéro juste,
 * « TMBFA25J » deviendrait « TM8FA255J ». Elles ne sont donc
 * essayées qu'UNE À LA FOIS, et seulement si aucun bon candidat
 * n'est ressorti autrement.
 */
const CONFUSIONS_POSSIBLES = {
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
  D: '0',
  U: '0',
  1: 'L',
  2: 'Z',
  5: 'S',
  8: 'B',
  6: 'G',
  0: 'D',
};

/**
 * Note un candidat de 17 caractères.
 * Plus le score est haut, plus c'est probablement le VIN.
 */
function noterCandidat(c) {
  if (c.length !== 17) return -1;
  if (CARACTERES_INTERDITS.test(c)) return -1;

  // REFUS SEC, et non une pénalité. Un VIN mélange toujours
  // lettres et chiffres. Dix-sept chiffres d'affilée sont une
  // date, un numéro de facture ou un code-barres, jamais un
  // châssis. En simple pénalité, une suite de chiffres dont le
  // neuvième tombait juste par hasard, une chance sur onze,
  // passait devant le vrai VIN.
  const lettres = (c.match(/[A-Z]/g) || []).length;
  const chiffres = (c.match(/[0-9]/g) || []).length;
  if (lettres < 2 || chiffres < 3) return -1;

  // DEUXIÈME REFUS SEC : les six dernières positions sont le
  // numéro de séquence, quasiment toujours numérique chez les
  // constructeurs européens. Sans cette règle, une phrase
  // suffisait à produire un VIN : « Certificat immatriculation »
  // devenait 1F1CAT1MMATR1CULA, dont les trois premiers
  // caractères tombaient par malchance sur le code Ford.
  const sequence = (c.slice(11).match(/[0-9]/g) || []).length;
  if (sequence < 2) return -1;

  let score = 0;

  // Le code constructeur est le signal le plus fort : il est
  // reconnu ou il ne l'est pas.
  if (marqueDepuisWmi(c)) score += 50;

  // Un code de millésime valide écarte beaucoup de faux positifs
  if (CODES_ANNEE.includes(c[9])) score += 15;

  // Le chiffre de contrôle, quand il tombe juste, ne laisse
  // pratiquement aucun doute. Quand il tombe faux on ne pénalise
  // pas : il est facultatif hors Amérique du Nord.
  if (controleValide(c) === true) score += 40;

  // Les positions 12 à 17 sont le numéro de séquence : presque
  // toujours numériques chez les constructeurs européens.
  const fin = c.slice(11);
  if ((fin.match(/[0-9]/g) || []).length >= 4) score += 8;

  return score;
}

/**
 * Cherche le meilleur VIN dans un texte reconnu par OCR.
 *
 * @param {string} texte  la sortie brute de la reconnaissance
 * @returns {{vin: string|null, score: number, confiance: string, candidats: Array}}
 */
function extraireVin(texte) {
  const brut = String(texte || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (brut.length < 17) {
    return { vin: null, score: 0, confiance: 'aucune', candidats: [], lus: brut.length };
  }

  const vus = new Map();
  const retenir = (candidat, score) => {
    if (score <= 0) return;
    if (!vus.has(candidat) || vus.get(candidat) < score) vus.set(candidat, score);
  };

  // --- Passe 1 : le texte avec les seules corrections sûres ---
  //
  // I, O et Q sont interdits dans un VIN : les remplacer est
  // toujours juste. Cette passe est donc appliquée d'office, sans
  // pénalité, et non proposée comme une variante incertaine.
  const sain = [...brut].map((ch) => CORRECTIONS_SURES[ch] ?? ch).join('');

  for (let i = 0; i + 17 <= sain.length; i++) {
    retenir(sain.slice(i, i + 17), noterCandidat(sain.slice(i, i + 17)));
  }

  // --- Passe 2 : une seule confusion spéculative à la fois ---
  //
  // Lancée uniquement si la première n'a rien donné de solide.
  // On ne touche qu'UN caractère par essai : remplacer tous les B
  // par des 8 casserait un numéro correct.
  const meilleurActuel = Math.max(0, ...vus.values());

  if (meilleurActuel < 90) {
    for (let i = 0; i + 17 <= sain.length; i++) {
      const base = sain.slice(i, i + 17);
      for (let p = 0; p < 17; p++) {
        const remplacant = CONFUSIONS_POSSIBLES[base[p]];
        if (!remplacant) continue;
        const essai = base.slice(0, p) + remplacant + base.slice(p + 1);
        // Pénalité de 5 : à score égal, la lecture qui n'a rien
        // inventé doit passer devant.
        retenir(essai, noterCandidat(essai) - 5);
      }
    }
  }

  const classes = [...vus.entries()]
    .map(([vin, score]) => ({ vin, score, marque: marqueDepuisWmi(vin) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (classes.length === 0) {
    return { vin: null, score: 0, confiance: 'aucune', candidats: [], lus: brut.length };
  }

  const meilleur = classes[0];

  // ----------------------------------------------------------
  //  PLANCHER DE 65 POINTS
  //
  //  En dessous, on ne rend RIEN plutôt qu'un à-peu-près. Un
  //  champ pré-rempli avec une suite de caractères inventée est
  //  pire qu'un champ vide : le client la valide sans relire, et
  //  la recherche échoue sans qu'il comprenne pourquoi.
  //
  //  Un vrai VIN dont le constructeur est connu atteint 73 au
  //  minimum, 113 avec un chiffre de contrôle juste. Le plancher
  //  ne coupe donc que le bruit.
  //
  //  Contrepartie assumée : un VIN dont le code constructeur est
  //  absent de la table ne sera pas extrait. Mieux vaut laisser
  //  le client taper que lui faire corriger une invention.
  // ----------------------------------------------------------
  if (meilleur.score < 65) {
    return {
      vin: null,
      score: meilleur.score,
      confiance: 'aucune',
      candidats: classes,
      lus: brut.length,
    };
  }

  // Le libellé décide de ce que l'écran dit au client, et donc de
  // la confiance qu'il accordera au champ pré-rempli.
  let confiance = 'faible';
  if (meilleur.score >= 100) confiance = 'haute';
  else if (meilleur.score >= 73) confiance = 'moyenne';

  return {
    vin: meilleur.vin,
    score: meilleur.score,
    confiance,
    marque: meilleur.marque,
    candidats: classes,
    lus: brut.length,
  };
}

// ============================================================
//  DÉCODAGE COMPLET
// ============================================================

/**
 * Pose le message et l'indicateur de complétude.
 *
 * Fonction à part, et non deux lignes en fin de decoder() : elle
 * sert aussi bien au premier décodage qu'à une lecture du cache,
 * et les deux doivent dire exactement la même chose.
 */
function composer(r) {
  if (!r.marque) {
    r.message =
      'Ce numéro de châssis n’est pas reconnu. Choisissez votre véhicule dans les listes.';
    r.complet = false;
  } else if (!r.modele) {
    r.message =
      `${r.marque} identifiée. Le modèle n’est pas disponible pour ce véhicule, ` +
      'choisissez-le dans la liste.';
    r.complet = false;
  } else {
    r.message = `${r.marque} ${r.modele}${r.annee ? ' de ' + r.annee : ''}.`;
    r.complet = true;
  }
  return r;
}

/**
 * @param {string} saisie  le VIN tel que tapé par le client
 * @param {object} options
 *        compter : incrémente le compteur de vues de la
 *        configuration. Vrai pour une recherche client, FAUX quand
 *        c'est le gestionnaire qui saisit un VIN : son activité ne
 *        doit pas gonfler une statistique qui sert à savoir quels
 *        véhicules roulent chez les clients.
 * @returns {Promise<object>} toujours un objet, jamais d'exception
 */
async function decoder(saisie, { compter = true } = {}) {
  const vin = normaliser(saisie);

  // --- Validations de forme, avant tout appel : jamais un
  //     crédit dépensé sur un VIN mal tapé ---
  if (!vin) {
    return { valide: false, motif: 'vide', message: 'Entrez un numéro de châssis.' };
  }

  if (vin.length !== 17) {
    return {
      valide: false,
      motif: 'longueur',
      message: `Un numéro de châssis compte 17 caractères, vous en avez saisi ${vin.length}.`,
    };
  }

  if (CARACTERES_INTERDITS.test(vin)) {
    return {
      valide: false,
      motif: 'caracteres',
      message:
        'Les lettres I, O et Q n’existent pas dans un numéro de châssis. ' +
        'Vérifiez : ce sont souvent des 1 et des 0.',
    };
  }

  // --- Cache, sur l'empreinte du véhicule et non sur l'exemplaire ---
  const cle = squish(vin);
  const duCache = await lireCache(cle);
  if (duCache) {
    // On recompose autour de CE VIN : le chiffre de contrôle et le
    // numéro lui-même appartiennent à l'exemplaire, pas au modèle.
    const relu = composer({
      valide: true,
      vin,
      ...duCache,
      pays: PAYS[vin[0]] || null,
      controle_ok: controleValide(vin),
    });

    // Apprentissage SUR RELECTURE AUSSI, pour deux raisons :
    //   le compteur de vues doit monter à chaque client
    //   les décodages antérieurs à cette table se rattrapent tout
    //   seuls, au premier client qui revient sur la configuration
    await configurations.apprendre(vin, relu, { compter });

    return relu;
  }

  // --- 1. Décodage local, immédiat ---
  const marqueLocale = marqueDepuisWmi(vin);
  const { annees, certaine } = anneesPossibles(vin);

  const resultat = {
    valide: true,
    vin,
    marque: marqueLocale,
    modele: null,
    annee: annees[0] ?? null,
    annees_possibles: annees,
    annee_certaine: certaine,
    pays: PAYS[vin[0]] || null,
    controle_ok: controleValide(vin),
    source: 'local',
    details: {},
  };

  // --- 2. vPIC, sauf pour les marques qu'elle ne connaît jamais ---
  const sauterVpic = marqueLocale && HORS_MARCHE_US.has(marqueLocale);
  const vpic = sauterVpic ? null : await interrogerVpic(vin);

  if (vpic) {
    if (vpic.marque) resultat.marque = vpic.marque;

    if (vpic.modele) {
      resultat.modele = vpic.modele;
      resultat.source = 'vpic';
    }

    // ----------------------------------------------------------
    //  L'ANNÉE DE vPIC N'EST RETENUE QUE SI vPIC A RECONNU LE
    //  MODÈLE.
    //
    //  Vérifié en direct sur l'API :
    //
    //    KMHCM41BP8U123456  Hyundai Accent  →  2008  (juste)
    //    VF3LCYHZ7JS123456  Peugeot, pas de modèle → 1988 (faux,
    //                                              c'est 2018)
    //
    //  Quand vPIC ne connaît pas le véhicule, elle se contente du
    //  même relevé de la position 10 que nous, mais tranche
    //  toujours pour l'interprétation ancienne du cycle de trente
    //  ans. Sur une voiture qui roule à Dakar, c'est presque
    //  toujours la mauvaise.
    // ----------------------------------------------------------
    const plausible =
      vpic.annee && vpic.annee >= 1980 && vpic.annee <= new Date().getFullYear() + 1;

    if (plausible && vpic.modele) {
      resultat.annee = vpic.annee;
      resultat.annees_possibles = [vpic.annee];
      resultat.annee_certaine = true;
    }

    resultat.details = {
      carrosserie: vpic.carrosserie,
      motorisation: vpic.motorisation,
      carburant: vpic.carburant,
      usine: vpic.usine,
    };
  }

  // ----------------------------------------------------------
  //  3. VEHICLE DATABASES, uniquement si le modèle manque
  //
  //  C'est ici que l'argent se dépense, et seulement ici. Pas
  //  d'aiguillage par pays : on constate que le gratuit n'a pas
  //  suffi, puis on paie.
  // ----------------------------------------------------------
  let paye = false;

  // Un décodage est définitif tant qu'aucune tentative n'a échoué
  // pour une raison passagère. Voir ecrireCache().
  let definitif = true;

  if (!resultat.modele && VD_ACTIVE && !silences.has(cle)) {
    const vd = await interrogerVehicleDatabases(vin);
    paye = vd.paye;

    // Échecs techniques : rien n'est acquis, on ne grave rien.
    // Réessayer plus tard peut très bien aboutir.
    if (['delai', 'reseau', 'budget', 'cle', 'debit'].includes(vd.raison)) {
      definitif = false;
    }

    // Silence de leur part : on ne refera pas attendre le client
    // douze secondes sur la même configuration.
    if (vd.raison === 'delai') {
      silences.add(cle);
      console.warn(
        `🚗 ${cle} marqué muet : plus d'appel payant sur cette configuration ` +
          'jusqu’au redémarrage du serveur.',
      );
    }

    if (vd.donnees) {
      const d = vd.donnees;
      if (d.marque) resultat.marque = d.marque;
      if (d.modele) {
        resultat.modele = d.modele;
        resultat.source = 'vehicledatabases';
      }

      // Leur réponse ne porte pas le millésime dans le cas
      // général : l'ambiguïté des trente ans reste entière et le
      // client choisira. On ne retient une année que si elle est
      // réellement présente et cohérente avec le code du VIN.
      if (d.annee && (annees.length === 0 || annees.includes(d.annee))) {
        resultat.annee = d.annee;
        resultat.annees_possibles = [d.annee];
        resultat.annee_certaine = true;
      }

      resultat.details = {
        ...resultat.details,
        carrosserie: d.carrosserie || resultat.details.carrosserie,
        motorisation: d.motorisation || resultat.details.motorisation,
        carburant: d.carburant || resultat.details.carburant,
        usine: d.usine || resultat.details.usine,
        finition: d.finition,
        boite: d.boite,
        portes: d.portes,
        places: d.places,
        transmission: d.transmission,
        puissance: d.puissance,
      };
    }
  }

  // Une marque européenne restée sans modèle alors que l'API
  // payante n'a jamais été interrogée n'est pas un résultat
  // définitif non plus : le jour où la clé est posée, elle doit
  // pouvoir répondre.
  if (!resultat.modele && !VD_ACTIVE) definitif = false;

  await ecrireCache(cle, partieVehicule(resultat), paye, definitif);

  const final = composer(resultat);

  // La configuration s'apprend même quand le décodage est partiel :
  // une marque sans modèle reste une ligne utile, qui s'enrichira
  // au prochain passage si une source répond mieux. Seule l'absence
  // totale de marque est écartée, côté service.
  await configurations.apprendre(vin, final, { compter });

  return final;
}

module.exports = {
  WMI,
  PAYS,
  HORS_MARCHE_US,
  normaliser,
  squish,
  controleValide,
  marqueDepuisWmi,
  anneesPossibles,
  extraireVin,
  decoder,
  creditsRestants,
  etatBudget,
  _memoire: memoire,
};
