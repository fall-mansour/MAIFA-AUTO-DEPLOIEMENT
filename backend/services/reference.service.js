// ============================================================
//  MAIFA-AUTO — RÉFÉRENCES INTERNES DES PIÈCES
//
//  Format : MA-00042-N
//           ^^ préfixe    (configurable, figé dès la 1re émission)
//              ^^^^^ séquence sur 5 chiffres, jamais recyclée
//                    ^ lettre de contrôle, calculée
//
//  Une référence interne est IMMUABLE. Elle sera imprimée sur des
//  étagères, lue au téléphone et figurera dans l'historique des
//  commandes : on ne la renumérote pas, on ne réutilise pas un
//  numéro libéré par une suppression.
//
//  Ce module est la seule source de vérité de l'algorithme.
//  Ne jamais le réimplémenter ailleurs, ni en SQL.
// ============================================================

const PREFIXE = (process.env.REF_PREFIXE || 'MA').toUpperCase();
const LONGUEUR = Number(process.env.REF_LONGUEUR || 5);

/**
 * Alphabet de la lettre de contrôle : 22 lettres.
 * I, O, Q et U sont exclues parce qu'elles se confondent à la
 * lecture avec 1, 0, 0 et V, or ces références transitent par
 * WhatsApp et se dictent au téléphone.
 */
const ALPHABET = 'ABCDEFGHJKLMNPRSTVWXYZ';

/**
 * Poids appliqués aux chiffres, de gauche à droite.
 * Deux poids voisins sont toujours différents : une inversion de
 * deux chiffres consécutifs change donc la lettre, et la faute
 * de recopie la plus fréquente est détectée.
 */
const POIDS = [7, 3, 1, 7, 3, 1, 7, 3];

// ------------------------------------------------------------
//  CALCUL
// ------------------------------------------------------------

/** Lettre de contrôle d'un numéro de séquence */
function lettreControle(numero) {
  const chiffres = String(numero).padStart(LONGUEUR, '0');
  let somme = 0;

  for (let i = 0; i < chiffres.length; i++) {
    somme += Number(chiffres[i]) * POIDS[i % POIDS.length];
  }

  return ALPHABET[somme % ALPHABET.length];
}

/** Numéro de séquence vers référence affichable : 42 → "MA-00042-N" */
function formater(numero) {
  const sequence = String(numero).padStart(LONGUEUR, '0');
  return `${PREFIXE}-${sequence}-${lettreControle(numero)}`;
}

/** Forme comparable : enlève tirets, espaces et casse */
function normaliser(saisie) {
  return String(saisie || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Analyse une référence saisie par un gestionnaire ou un client.
 *
 * Accepte les deux écritures, avec ou sans lettre de contrôle :
 *   "MA-00042-N"  → complète, lettre vérifiée
 *   "MA-00042"    → acceptée, rien à vérifier
 *   "ma00042n"    → acceptée
 *   "42"          → acceptée, le préfixe est sous-entendu
 *
 * Retourne toujours un objet, jamais d'exception : l'appelant
 * décide quoi afficher.
 */
function analyser(saisie) {
  const brut = normaliser(saisie);

  if (!brut) {
    return { valide: false, motif: 'vide' };
  }

  // Préfixe facultatif à la saisie
  const sansPrefixe = brut.startsWith(PREFIXE) ? brut.slice(PREFIXE.length) : brut;

  const correspondance = sansPrefixe.match(/^(\d{1,12})([A-Z])?$/);
  if (!correspondance) {
    return { valide: false, motif: 'format' };
  }

  const numero = Number(correspondance[1]);
  const lettreFournie = correspondance[2] || null;
  const lettreAttendue = lettreControle(numero);

  // Lettre absente : on ne peut rien vérifier, mais la saisie reste exploitable
  if (!lettreFournie) {
    return {
      valide: true,
      numero,
      reference: formater(numero),
      controle: 'absent',
    };
  }

  // Lettre présente mais fausse : faute de recopie quasi certaine
  if (lettreFournie !== lettreAttendue) {
    return {
      valide: false,
      motif: 'controle',
      numero,
      lettreFournie,
      lettreAttendue,
      suggestion: formater(numero),
    };
  }

  return {
    valide: true,
    numero,
    reference: formater(numero),
    controle: 'verifie',
  };
}

// ------------------------------------------------------------
//  RÉSERVATION
// ------------------------------------------------------------

/**
 * Réserve un bloc de numéros consécutifs.
 *
 * À appeler DANS une transaction déjà ouverte, en lui passant la
 * connexion : le verrou FOR UPDATE ne tient que le temps de la
 * transaction, et c'est lui qui empêche deux gestionnaires
 * simultanés d'obtenir le même numéro.
 *
 * Pour un import de 300 lignes, un seul appel avec combien = 300
 * plutôt que 300 verrouillages successifs.
 *
 * @param {object} connexion  connexion issue de pool.getConnection()
 * @param {number} combien    nombre de références à réserver
 * @returns {Promise<string[]>} références formatées, dans l'ordre
 */
async function reserver(connexion, combien = 1) {
  const quantite = Math.max(1, Math.trunc(Number(combien) || 1));

  const [lignes] = await connexion.query('SELECT valeur FROM compteurs WHERE nom = ? FOR UPDATE', [
    'piece',
  ]);

  if (lignes.length === 0) {
    throw new Error(
      "Compteur 'piece' absent. Exécutez migration_reference_interne.sql avant d'ajouter des pièces.",
    );
  }

  const depart = Number(lignes[0].valeur);
  const arrivee = depart + quantite;

  await connexion.query('UPDATE compteurs SET valeur = ? WHERE nom = ?', [arrivee, 'piece']);

  const references = [];
  for (let n = depart + 1; n <= arrivee; n++) {
    references.push(formater(n));
  }
  return references;
}

/** Raccourci pour une pièce unique */
async function reserverUne(connexion) {
  const [reference] = await reserver(connexion, 1);
  return reference;
}

// ------------------------------------------------------------
//  RECHERCHE
// ------------------------------------------------------------

/**
 * Fragment SQL de recherche par référence interne, tolérant aux
 * deux écritures. À coller dans un WHERE avec le paramètre rendu.
 *
 *   const { clause, parametre } = reference.clauseRecherche(saisie);
 *   if (clause) sql += ` AND ${clause}`, params.push(parametre);
 */
function clauseRecherche(saisie) {
  const analyse = analyser(saisie);
  if (!analyse.numero && analyse.numero !== 0) {
    return { clause: null, parametre: null };
  }

  // On compare sur la forme normalisée COMPLÈTE, lettre incluse,
  // puisque c'est elle qui est stockée.
  return {
    clause: 'p.ref_interne_norm = ?',
    parametre: normaliser(formater(analyse.numero)),
  };
}

module.exports = {
  PREFIXE,
  LONGUEUR,
  lettreControle,
  formater,
  normaliser,
  analyser,
  reserver,
  reserverUne,
  clauseRecherche,
};
