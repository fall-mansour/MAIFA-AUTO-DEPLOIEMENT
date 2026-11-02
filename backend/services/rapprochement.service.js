// ============================================================
//  MAIFA-AUTO — RAPPROCHEMENT AVEC LE RÉFÉRENTIEL
//
//  Un fichier fournisseur écrit "PEUGEOT", "Peugot", "peugeot sa"
//  ou "PSA PEUGEOT" là où le référentiel dit "PEUGEOT". Ce module
//  fait le lien, et dit honnêtement quand il n'est pas sûr.
//
//  Principe directeur : ne JAMAIS rattacher d'office un libellé
//  douteux. Une pièce rattachée au mauvais modèle est pire qu'une
//  pièce non rattachée, parce que personne ne s'en aperçoit avant
//  qu'un client reçoive la mauvaise pièce.
//
//  Trois verdicts possibles :
//    exact      → correspondance certaine, on applique
//    suggestion → correspondance probable, le gestionnaire confirme
//    inconnu    → rien de crédible, la ligne part en anomalie
// ============================================================

// ------------------------------------------------------------
//  NORMALISATION
// ------------------------------------------------------------

/**
 * Forme comparable d'un libellé :
 *   accents retirés, majuscules, ponctuation et espaces supprimés.
 *   "Citroën C3  Picasso" → "CITROENC3PICASSO"
 */
function normaliser(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Variante conservant les espaces, pour comparer mot à mot */
function normaliserMots(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Mots que les fournisseurs ajoutent sans qu'ils distinguent quoi
 * que ce soit. Retirés avant comparaison des marques uniquement.
 */
const BRUIT_MARQUE = new Set([
  'SA',
  'SAS',
  'SARL',
  'GROUPE',
  'GROUP',
  'MOTORS',
  'MOTOR',
  'AUTOMOBILES',
  'AUTOMOBILE',
  'AUTO',
  'AUTOS',
  'FRANCE',
  'PSA',
]);

/**
 * Noms commerciaux que les fournisseurs emploient et qui ne
 * correspondent à aucune entrée du référentiel. La correction
 * orthographique ne peut rien pour eux : "VW" et "VOLKSWAGEN"
 * n'ont aucune lettre commune au début, et "MERCEDES-BENZ" est
 * trop long de quatre caractères pour "MERCEDES".
 *
 * Table explicite plutôt que tolérance élargie : élargir la
 * distance ferait passer de vrais faux positifs ailleurs.
 *
 * Clé : forme nettoyée de la saisie. Valeur : forme nettoyée de
 * l'entrée du référentiel visée. À compléter au fil des fichiers
 * fournisseurs rencontrés.
 */
const EQUIVALENCES_MARQUE = new Map([
  ['VW', 'VOLKSWAGEN'],
  ['VOLKS', 'VOLKSWAGEN'],
  ['MERCEDESBENZ', 'MERCEDES'],
  ['BENZ', 'MERCEDES'],
  ['CHEVY', 'CHEVROLET'],
  ['ALFA', 'ALFAROMEO'],
  ['RANGEROVER', 'LANDROVER'],
  ['RANGE', 'LANDROVER'],
  ['ALPINE', 'ALPINERENAULT'],
  ['MINICOOPER', 'MINI'],
  ['DFSK', 'SERESDFSK'],
  ['SERES', 'SERESDFSK'],
  ['GONOW', 'GACGONOW'],
  ['GAC', 'GACGONOW'],
  ['MPM', 'MPMMOTORS'],
  ['FSO', 'FSOPOLSKI'],
  ['POLSKI', 'FSOPOLSKI'],
]);

function nettoyerMarque(valeur) {
  const mots = normaliserMots(valeur)
    .split(' ')
    .filter((m) => m && !BRUIT_MARQUE.has(m));
  const cle = mots.join('');
  return EQUIVALENCES_MARQUE.get(cle) || cle;
}

// ------------------------------------------------------------
//  DISTANCE
// ------------------------------------------------------------

/**
 * Distance de Levenshtein, bornée : on abandonne dès que le coût
 * dépasse le plafond, ce qui évite de calculer la matrice entière
 * pour deux chaînes qui n'ont rien à voir.
 *
 * Sur 1782 modèles comparés à chaque ligne d'un fichier de 300
 * lignes, cette borne fait toute la différence.
 */
function distance(a, b, plafond = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1;

  const precedente = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) precedente[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let diagonale = precedente[0];
    precedente[0] = i;
    let minLigne = precedente[0];

    for (let j = 1; j <= b.length; j++) {
      const temp = precedente[j];
      precedente[j] = Math.min(
        precedente[j] + 1, // suppression
        precedente[j - 1] + 1, // insertion
        diagonale + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
      diagonale = temp;
      if (precedente[j] < minLigne) minLigne = precedente[j];
    }

    // Toute la ligne dépasse le plafond : inutile de continuer
    if (minLigne > plafond) return plafond + 1;
  }

  return precedente[b.length];
}

/**
 * Tolérance proportionnelle à la longueur du libellé.
 * "C3" ne tolère aucune faute, sinon il deviendrait "C4".
 * "SPORTAGE" en tolère deux.
 */
function toleranceFautes(longueur) {
  if (longueur <= 3) return 0;
  if (longueur <= 6) return 1;
  if (longueur <= 12) return 2;
  return 3;
}

// ------------------------------------------------------------
//  INDEX
// ------------------------------------------------------------

/**
 * Prépare le référentiel une fois pour tout un import, plutôt
 * qu'à chaque ligne.
 *
 * @param {Array} marques   [{ id, nom }]
 * @param {Array} modeles   [{ id, modele, id_marque }]
 * @param {Array} categories [{ id, nom, slug, id_parent }]
 */
function construireIndex({ marques = [], modeles = [], categories = [] }) {
  const index = {
    marques: new Map(), // clé normalisée → marque
    marquesListe: [],
    modelesParMarque: new Map(), // id_marque → Map(clé → modèle)
    modelesListe: [],
    categories: new Map(),
    categoriesListe: [],
  };

  for (const m of marques) {
    const cle = nettoyerMarque(m.nom);
    if (cle) index.marques.set(cle, m);
    index.marquesListe.push({ ...m, cle });
  }

  for (const mo of modeles) {
    const cle = normaliser(mo.modele);
    if (!index.modelesParMarque.has(mo.id_marque)) {
      index.modelesParMarque.set(mo.id_marque, new Map());
    }
    const parMarque = index.modelesParMarque.get(mo.id_marque);
    // Premier arrivé conservé : le référentiel contient des doublons
    if (!parMarque.has(cle)) parMarque.set(cle, mo);
    index.modelesListe.push({ ...mo, cle });
  }

  for (const c of categories) {
    const cleNom = normaliser(c.nom);
    const cleSlug = normaliser(c.slug);
    if (cleNom) index.categories.set(cleNom, c);
    if (cleSlug && !index.categories.has(cleSlug)) index.categories.set(cleSlug, c);
    index.categoriesListe.push({ ...c, cle: cleNom });
  }

  return index;
}

// ------------------------------------------------------------
//  RAPPROCHEMENT
// ------------------------------------------------------------

/** Verdict commun aux trois rapprochements */
function verdict(statut, valeur, saisie, extra = {}) {
  return { statut, valeur, saisie, ...extra };
}

/**
 * Marque. Le nettoyage retire les suffixes commerciaux avant
 * comparaison, puis on tolère une faute de frappe.
 */
function rapprocherMarque(saisie, index) {
  const brut = String(saisie ?? '').trim();
  if (!brut) return verdict('vide', null, brut);

  const cle = nettoyerMarque(brut);
  if (!cle) return verdict('inconnu', null, brut);

  // 1. Correspondance exacte
  const exacte = index.marques.get(cle);
  if (exacte) return verdict('exact', exacte, brut);

  // 2. Correspondance approchée
  const plafond = toleranceFautes(cle.length);
  if (plafond === 0) return verdict('inconnu', null, brut);

  let candidats = [];
  let meilleurCout = plafond + 1;

  for (const m of index.marquesListe) {
    if (!m.cle) continue;
    const cout = distance(cle, m.cle, plafond);
    if (cout < meilleurCout) {
      meilleurCout = cout;
      candidats = [m];
    } else if (cout === meilleurCout && cout <= plafond) {
      candidats.push(m);
    }
  }

  if (meilleurCout > plafond || candidats.length === 0) {
    return verdict('inconnu', null, brut);
  }

  // Plusieurs marques à égale distance : on ne tranche pas à la
  // place du gestionnaire, on lui présente le choix.
  if (candidats.length > 1) {
    return verdict('ambigu', null, brut, {
      candidats: candidats.slice(0, 8),
      ecart: meilleurCout,
    });
  }

  return verdict('suggestion', candidats[0], brut, { ecart: meilleurCout });
}

/**
 * Modèle. Toujours cherché DANS une marque déjà identifiée :
 * chercher un modèle sur les 1782 toutes marques confondues
 * produirait des rapprochements absurdes (une "Partner" Peugeot
 * rattachée à une "Partner" d'une autre marque).
 */
function rapprocherModele(saisie, idMarque, index) {
  const brut = String(saisie ?? '').trim();
  if (!brut) return verdict('vide', null, brut);
  if (!idMarque) return verdict('sans_marque', null, brut);

  const parMarque = index.modelesParMarque.get(idMarque);
  if (!parMarque) return verdict('inconnu', null, brut);

  const cle = normaliser(brut);

  // 1. Correspondance exacte
  const exacte = parMarque.get(cle);
  if (exacte) return verdict('exact', exacte, brut);

  // 2. Le référentiel porte souvent la génération : "308 II".
  //    Un fournisseur écrit "308". On accepte si UNE SEULE
  //    génération commence par la saisie, sinon on hésiterait
  //    entre plusieurs et il faut demander.
  const prefixes = [];
  for (const [cleRef, modele] of parMarque) {
    if (cleRef.startsWith(cle) && cle.length >= 2) prefixes.push(modele);
  }
  if (prefixes.length === 1) {
    return verdict('suggestion', prefixes[0], brut, { motif: 'generation' });
  }
  if (prefixes.length > 1) {
    return verdict('ambigu', null, brut, {
      candidats: prefixes.slice(0, 8),
      motif: 'plusieurs generations',
    });
  }

  // 3. Correspondance approchée dans la marque uniquement
  const plafond = toleranceFautes(cle.length);
  if (plafond === 0) return verdict('inconnu', null, brut);

  let candidats = [];
  let meilleurCout = plafond + 1;

  for (const [cleRef, modele] of parMarque) {
    const cout = distance(cle, cleRef, plafond);
    if (cout < meilleurCout) {
      meilleurCout = cout;
      candidats = [modele];
    } else if (cout === meilleurCout && cout <= plafond) {
      candidats.push(modele);
    }
  }

  if (meilleurCout > plafond || candidats.length === 0) {
    return verdict('inconnu', null, brut);
  }

  // Égalité parfaite entre plusieurs modèles : "COROLA" est à une
  // faute de COROLLA comme de CORONA. Deviner ici reviendrait à
  // rattacher une pièce au mauvais véhicule une fois sur deux.
  if (candidats.length > 1) {
    return verdict('ambigu', null, brut, {
      candidats: candidats.slice(0, 8),
      ecart: meilleurCout,
      motif: 'plusieurs modeles proches',
    });
  }

  return verdict('suggestion', candidats[0], brut, { ecart: meilleurCout });
}

/** Catégorie. Rapprochée par nom ou par slug. */
function rapprocherCategorie(saisie, index) {
  const brut = String(saisie ?? '').trim();
  if (!brut) return verdict('vide', null, brut);

  const cle = normaliser(brut);
  const exacte = index.categories.get(cle);
  if (exacte) return verdict('exact', exacte, brut);

  const plafond = toleranceFautes(cle.length);
  if (plafond === 0) return verdict('inconnu', null, brut);

  let meilleure = null;
  let meilleurCout = plafond + 1;

  for (const c of index.categoriesListe) {
    if (!c.cle) continue;
    const cout = distance(cle, c.cle, plafond);
    if (cout < meilleurCout) {
      meilleurCout = cout;
      meilleure = c;
    }
  }

  if (meilleure && meilleurCout <= plafond) {
    return verdict('suggestion', meilleure, brut, { ecart: meilleurCout });
  }

  return verdict('inconnu', null, brut);
}

/**
 * Rapproche une ligne de compatibilité complète.
 *
 * Le modèle est cherché dans la marque identifiée, que celle-ci
 * soit certaine ou seulement suggérée. Refuser de chercher sur une
 * marque suggérée bloquerait toute la ligne pour un simple "Peugot"
 * au lieu de "Peugeot", alors que le gestionnaire n'a qu'à
 * confirmer. L'incertitude est reportée dans le verdict, pas dans
 * un refus de chercher.
 */
function rapprocherCompatibilite({ marque, modele }, index) {
  const resMarque = rapprocherMarque(marque, index);

  const marqueUtilisable = resMarque.statut === 'exact' || resMarque.statut === 'suggestion';

  const idMarque = marqueUtilisable ? resMarque.valeur.id : null;

  const resModele = rapprocherModele(modele, idMarque, index);

  const certain = resMarque.statut === 'exact' && resModele.statut === 'exact';

  // Exploitable : un identifiant de modèle existe, mais au moins
  // un des deux rapprochements demande confirmation.
  const exploitable =
    marqueUtilisable && (resModele.statut === 'exact' || resModele.statut === 'suggestion');

  return {
    marque: resMarque,
    modele: resModele,
    certain,
    exploitable,
    id_modele: exploitable ? resModele.valeur.id : null,
  };
}

module.exports = {
  EQUIVALENCES_MARQUE,
  normaliser,
  normaliserMots,
  nettoyerMarque,
  distance,
  construireIndex,
  rapprocherMarque,
  rapprocherModele,
  rapprocherCategorie,
  rapprocherCompatibilite,
};
