// ============================================================
//  MAIFA-AUTO — LECTURE ET ÉCRITURE DES FICHIERS EXCEL
//
//  Trois usages, un seul format de fichier :
//    1. modeleVierge()  → le gabarit que le fournisseur remplit
//    2. lire()          → analyse d'un fichier reçu
//    3. exporter()      → le stock actuel, modifiable puis réimporté
//
//  Le fichier porte DEUX onglets :
//    "Pièces"          une ligne par pièce
//    "Compatibilités"  une ligne par couple pièce / véhicule
//
//  Cette séparation n'est pas un raffinement : une pièce s'adapte
//  à plusieurs véhicules. Un filtre à huile qui couvre quinze
//  modèles ne tient pas sur une ligne unique.
//
//  Dépendance : exceljs   (npm install exceljs)
// ============================================================

const ExcelJS = require('exceljs');

const ONGLET_PIECES = 'Pièces';
const ONGLET_COMPAT = 'Compatibilités';
const ONGLET_AIDE = "Mode d'emploi";
const ONGLET_LISTES = 'Listes';

/**
 * Jusqu'où descendent les listes déroulantes.
 *
 * Généreux sans coût : une validation couvre une plage entière en
 * un seul élément XML, donc 5000 lignes ne pèsent pas plus lourd
 * que 50 dans le fichier produit.
 */
const LIGNES_VALIDEES = 5000;

const BLEU_NUIT = 'FF12314B';
const ORANGE = 'FFF2762E';

// ------------------------------------------------------------
//  COLONNES
//
//  'cle'    : nom interne, utilisé par le moteur d'import
//  'entete' : libellé affiché, et reconnu à la lecture
//  'alias'  : autres libellés acceptés dans un fichier fournisseur
// ------------------------------------------------------------

const COLONNES_PIECES = [
  {
    cle: 'ref_interne',
    entete: 'Référence interne',
    alias: ['ref interne', 'reference interne', 'ref maifa', 'code interne'],
    largeur: 16,
    aide: 'Laisser VIDE pour une nouvelle pièce. Rempli par le système.',
  },
  {
    cle: 'ref_oe',
    entete: 'Référence constructeur',
    alias: [
      'ref oe',
      'reference oe',
      'ref origine',
      'reference constructeur',
      'oem',
      'ref fabricant',
    ],
    largeur: 20,
    aide: "Référence d'origine du constructeur. Fortement recommandée.",
  },
  {
    cle: 'description',
    entete: 'Désignation',
    alias: ['designation', 'libelle', 'libellé', 'nom', 'produit', 'description'],
    largeur: 38,
    obligatoire: true,
    aide: 'Ce que le client lit en premier. Obligatoire.',
  },
  {
    cle: 'categorie',
    entete: 'Catégorie',
    alias: ['categorie', 'famille', 'rayon'],
    largeur: 20,
    aide: "Famille générale. Voir la liste dans l'onglet Mode d'emploi.",
  },
  {
    cle: 'sous_categorie',
    entete: 'Sous-catégorie',
    alias: ['sous categorie', 'sous-famille', 'sous famille'],
    largeur: 22,
    aide: 'Facultatif, affine le classement au catalogue.',
  },
  {
    cle: 'prix',
    entete: 'Prix (FCFA)',
    alias: ['prix', 'prix vente', 'prix de vente', 'pu', 'tarif', 'montant'],
    largeur: 14,
    obligatoire: true,
    format: '# ##0',
    aide: 'Nombre entier, sans espace ni devise. Obligatoire.',
  },
  {
    cle: 'quantite',
    entete: 'Quantité',
    alias: ['quantite', 'qte', 'stock', 'qty'],
    largeur: 11,
    format: '0',
    aide: "Nombre d'unités en stock. 0 accepté.",
  },
  {
    cle: 'seuil_alerte',
    entete: "Seuil d'alerte",
    alias: ['seuil', 'seuil alerte', 'stock mini', 'minimum'],
    largeur: 13,
    format: '0',
    aide: 'En dessous, la pièce est signalée à réapprovisionner. Défaut : 3.',
  },
  {
    cle: 'etat',
    entete: 'État',
    alias: ['etat', 'condition'],
    largeur: 13,
    aide: 'Neuf, Occasion ou Reconditionné.',
  },
  {
    cle: 'fournisseur',
    entete: 'Fournisseur',
    // Les libellés de l'ancienne colonne « Équipementier » sont
    // repris ici : un fichier fournisseur qui écrit « Fabricant »
    // ou « Marque pièce » vise la même information.
    alias: [
      'fournisseur',
      'founisseur',
      'provider',
      'equipementier',
      'marque piece',
      'fabricant',
      'brand',
    ],
    largeur: 22,
    aide: 'Bosch, Valeo, Febi... à ne pas confondre avec la marque du véhicule.',
  },
  {
    cle: 'url_images',
    entete: 'Photos (adresses web)',
    alias: ['photos', 'images', 'url images', 'liens photos'],
    largeur: 34,
    aide: 'Facultatif. Plusieurs adresses séparées par une virgule.',
  },
];

const COLONNES_COMPAT = [
  {
    cle: 'ref_piece',
    entete: 'Référence pièce',
    alias: [
      'ref piece',
      'reference piece',
      'ref interne',
      'référence interne',
      'ref oe',
      'référence constructeur',
    ],
    largeur: 22,
    obligatoire: true,
    aide:
      'Recopiez la référence interne de la pièce si elle en a déjà une, ' +
      "sinon sa référence constructeur. C'est ce qui relie les deux onglets.",
  },
  {
    cle: 'marque',
    entete: 'Marque véhicule',
    alias: ['marque', 'constructeur', 'make'],
    largeur: 20,
    obligatoire: true,
  },
  {
    cle: 'modele',
    entete: 'Modèle véhicule',
    alias: ['modele', 'modèle', 'model'],
    largeur: 24,
    obligatoire: true,
  },
  {
    cle: 'annee_min',
    entete: 'Année début',
    alias: ['annee min', 'année min', 'de', 'depuis', 'annee'],
    largeur: 12,
    format: '0',
    aide: 'Première année de compatibilité. Vide = sans limite.',
  },
  {
    cle: 'annee_max',
    entete: 'Année fin',
    alias: ['annee max', 'année max', 'a', "jusqu'a", 'jusqua'],
    largeur: 12,
    format: '0',
    aide: "Dernière année. Vide = toujours d'actualité.",
  },
  {
    cle: 'motorisation',
    entete: 'Motorisation',
    alias: ['motorisation', 'moteur', 'engine'],
    largeur: 20,
    aide: 'Facultatif : 1.6 HDi, 2.0 TDI...',
  },
];

// ------------------------------------------------------------
//  RECONNAISSANCE DES EN-TÊTES
// ------------------------------------------------------------

/** Forme comparable d'un en-tête : sans accents, sans ponctuation */
function cleEntete(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Associe chaque colonne du fichier reçu à une colonne attendue.
 * Un fournisseur n'écrit jamais les en-têtes comme le gabarit :
 * on accepte les libellés connus et leurs variantes.
 *
 * @returns {{ parIndex: Map<number,string>, manquantes: string[], ignorees: string[] }}
 */
function associerColonnes(ligneEntete, definitions) {
  const dictionnaire = new Map();
  for (const def of definitions) {
    dictionnaire.set(cleEntete(def.entete), def.cle);
    for (const a of def.alias || []) dictionnaire.set(cleEntete(a), def.cle);
  }

  const parIndex = new Map();
  const ignorees = [];
  const vues = new Set();

  ligneEntete.forEach((valeur, i) => {
    const cle = dictionnaire.get(cleEntete(valeur));
    if (cle && !vues.has(cle)) {
      parIndex.set(i, cle);
      vues.add(cle);
    } else if (String(valeur ?? '').trim()) {
      ignorees.push(String(valeur).trim());
    }
  });

  const manquantes = definitions
    .filter((d) => d.obligatoire && !vues.has(d.cle))
    .map((d) => d.entete);

  return { parIndex, manquantes, ignorees };
}

// ------------------------------------------------------------
//  CONVERSION DES VALEURS
// ------------------------------------------------------------

/**
 * Excel rend selon les cas une chaîne, un nombre, une date, ou un
 * objet de formule. On ramène tout à du texte exploitable.
 */
function valeurTexte(cellule) {
  const v = cellule?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v.hyperlink) return String(v.text || v.hyperlink);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}

/**
 * Nombre tolérant aux usages locaux : "45 000", "45.000,50",
 * "45 000 FCFA" donnent tous 45000 ou 45000.5.
 * Retourne null si rien d'exploitable, jamais NaN.
 */
function valeurNombre(cellule) {
  const v = cellule?.value;
  if (typeof v === 'number') return v;

  let t = valeurTexte(cellule);
  if (!t) return null;

  t = t.replace(/[^\d,.\-]/g, ''); // retire espaces, devises, lettres
  if (!t) return null;

  const nbPoints = (t.match(/\./g) || []).length;
  const nbVirgules = (t.match(/,/g) || []).length;

  if (nbPoints > 0 && nbVirgules > 0) {
    // Les deux présents : le dernier rencontré est la décimale,
    // l'autre sépare les milliers. "1.234,56" et "1,234.56".
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      t = t.replace(/,/g, '');
    }
  } else if (nbPoints + nbVirgules > 0) {
    // Un seul type de séparateur. Point et virgule sont traités à
    // l'identique : au Sénégal les deux servent aux milliers.
    const sep = nbPoints > 0 ? '.' : ',';
    const occurrences = nbPoints + nbVirgules;
    const apres = t.length - t.lastIndexOf(sep) - 1;

    // Répété, ou suivi d'exactement 3 chiffres : milliers.
    // "28.000" et "1.000.000" valent 28000 et 1000000.
    // Suivi de 1 ou 2 chiffres : décimale. "42500,50" vaut 42500,5.
    if (occurrences > 1 || apres === 3) {
      t = t.split(sep).join('');
    } else {
      t = t.replace(sep, '.');
    }
  }

  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Entier positif, ou null */
function valeurEntier(cellule) {
  const n = valeurNombre(cellule);
  if (n === null) return null;
  const e = Math.trunc(n);
  return e >= 0 ? e : null;
}

// ------------------------------------------------------------
//  LECTURE
// ------------------------------------------------------------

/** Entiers : pas de décimale possible */
const CLES_ENTIERES = new Set(['quantite', 'seuil_alerte', 'annee_min', 'annee_max']);

/** Décimales admises : la colonne prix est un DECIMAL(10,2) en base */
const CLES_DECIMALES = new Set(['prix']);

/**
 * Lit un onglet et renvoie une ligne par enregistrement, avec son
 * numéro de ligne Excel pour que le gestionnaire retrouve l'erreur
 * dans son fichier.
 */
function lireOnglet(feuille, definitions) {
  if (!feuille) {
    return {
      lignes: [],
      manquantes: definitions.filter((d) => d.obligatoire).map((d) => d.entete),
      ignorees: [],
    };
  }

  // L'en-tête n'est pas toujours en ligne 1 : un fournisseur place
  // parfois un titre ou un logo au-dessus. On cherche la première
  // ligne qui ressemble à un en-tête, dans les 10 premières.
  let ligneEnteteNum = 0;
  let association = null;

  for (let n = 1; n <= Math.min(10, feuille.rowCount); n++) {
    const brut = [];
    feuille.getRow(n).eachCell({ includeEmpty: true }, (cell, col) => {
      brut[col - 1] = valeurTexte(cell);
    });
    const essai = associerColonnes(brut, definitions);
    if (essai.manquantes.length === 0) {
      ligneEnteteNum = n;
      association = essai;
      break;
    }
    // On garde le meilleur essai au cas où rien ne soit parfait
    if (!association || essai.parIndex.size > association.parIndex.size) {
      ligneEnteteNum = n;
      association = essai;
    }
  }

  if (!association) {
    return {
      lignes: [],
      manquantes: definitions.filter((d) => d.obligatoire).map((d) => d.entete),
      ignorees: [],
    };
  }

  const lignes = [];

  for (let n = ligneEnteteNum + 1; n <= feuille.rowCount; n++) {
    const rangee = feuille.getRow(n);
    const enreg = { _ligne: n };
    let vide = true;

    for (const [indexCol, cle] of association.parIndex) {
      const cellule = rangee.getCell(indexCol + 1);
      const valeur = CLES_ENTIERES.has(cle)
        ? valeurEntier(cellule)
        : CLES_DECIMALES.has(cle)
          ? valeurNombre(cellule)
          : valeurTexte(cellule);

      enreg[cle] = valeur;
      if (valeur !== '' && valeur !== null) vide = false;
    }

    if (!vide) lignes.push(enreg);
  }

  return {
    lignes,
    manquantes: association.manquantes,
    ignorees: association.ignorees,
    ligneEntete: ligneEnteteNum,
  };
}

/**
 * Lit un fichier Excel complet.
 *
 * @param {Buffer|string} source  tampon mémoire ou chemin
 * @returns {Promise<{pieces, compatibilites, anomalies}>}
 */
async function lire(source) {
  const classeur = new ExcelJS.Workbook();

  if (Buffer.isBuffer(source)) {
    await classeur.xlsx.load(source);
  } else {
    await classeur.xlsx.readFile(source);
  }

  // Le gestionnaire renomme parfois l'onglet : on le retrouve par
  // son nom, sinon par sa position.
  const trouver = (nom, position) => {
    const parNom = classeur.worksheets.find((f) => cleEntete(f.name) === cleEntete(nom));
    return parNom || classeur.worksheets[position] || null;
  };

  const fPieces = trouver(ONGLET_PIECES, 0);
  const fCompat = trouver(ONGLET_COMPAT, 1);

  const resPieces = lireOnglet(fPieces, COLONNES_PIECES);
  const resCompat = lireOnglet(fCompat, COLONNES_COMPAT);

  const anomalies = [];

  if (!fPieces) {
    anomalies.push({
      gravite: 'bloquant',
      message: `Onglet "${ONGLET_PIECES}" introuvable. Téléchargez le modèle et repartez de celui-ci.`,
    });
  }

  for (const entete of resPieces.manquantes) {
    anomalies.push({
      gravite: 'bloquant',
      onglet: ONGLET_PIECES,
      message: `Colonne obligatoire absente : "${entete}".`,
    });
  }

  for (const entete of resCompat.manquantes) {
    anomalies.push({
      gravite: 'avertissement',
      onglet: ONGLET_COMPAT,
      message: `Colonne "${entete}" absente : les compatibilités ne seront pas rattachées.`,
    });
  }

  for (const col of resPieces.ignorees) {
    anomalies.push({
      gravite: 'information',
      onglet: ONGLET_PIECES,
      message: `Colonne non reconnue, ignorée : "${col}".`,
    });
  }

  return {
    pieces: resPieces.lignes,
    compatibilites: resCompat.lignes,
    anomalies,
  };
}

// ------------------------------------------------------------
//  ÉCRITURE
// ------------------------------------------------------------

function habillerEntete(feuille, definitions) {
  feuille.columns = definitions.map((d) => ({
    header: d.entete,
    key: d.cle,
    width: d.largeur || 16,
    style: d.format ? { numFmt: d.format } : undefined,
  }));

  const entete = feuille.getRow(1);
  entete.height = 24;
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  entete.alignment = { vertical: 'middle', horizontal: 'left' };
  entete.eachCell((cellule) => {
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU_NUIT } };
  });

  // Les champs obligatoires se repèrent d'un coup d'œil
  definitions.forEach((d, i) => {
    if (d.obligatoire) {
      entete.getCell(i + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ORANGE },
      };
      entete.getCell(i + 1).font = { bold: true, color: { argb: BLEU_NUIT }, size: 11 };
    }
    if (d.aide) {
      entete.getCell(i + 1).note = d.aide;
    }
  });

  feuille.views = [{ state: 'frozen', ySplit: 1 }];
  feuille.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: definitions.length },
  };
}

// ============================================================
//  LISTES DÉROULANTES
//
//  Deux listes simples (marque, catégorie, état) et deux listes
//  EN CASCADE : les modèles dépendent de la marque choisie, les
//  sous-catégories dépendent de la catégorie choisie.
//
//  La cascade se fait avec OFFSET + MATCH + COUNTIF plutôt qu'avec
//  INDIRECT et des plages nommées. Raison : une plage nommée ne
//  supporte ni espace ni accent ni tiret, or le référentiel porte
//  « ALFA ROMEO », « Éclairage » et « vitres-et-optiques ». Il
//  aurait fallu inventer des noms assainis et maintenir la
//  correspondance. Avec OFFSET, les libellés restent tels quels.
//
//  Le couple (parent, enfant) doit être GROUPÉ : MATCH renvoie la
//  première occurrence et COUNTIF compte le total. Si les lignes
//  d'une même marque étaient dispersées, la liste serait tronquée.
// ============================================================

/** Lettre de colonne Excel d'après la position de la clé dans le gabarit */
function lettreColonne(colonnes, cle) {
  const i = colonnes.findIndex((c) => c.cle === cle);
  if (i < 0) return null;
  let n = i + 1;
  let lettre = '';
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettre = String.fromCharCode(65 + reste) + lettre;
    n = Math.floor((n - 1) / 26);
  }
  return lettre;
}

/**
 * Onglet masqué portant toutes les listes du référentiel.
 * Renvoie les plages à viser, ou null si le référentiel est vide.
 */
function ajouterListes(classeur, referentiel = {}) {
  const marques = referentiel.marques || [];
  const categories = referentiel.categories || [];
  const etats = referentiel.etats || [];
  const modeles = referentiel.modeles || [];
  const sousCategories = referentiel.sousCategories || [];

  if (!marques.length && !categories.length && !etats.length) return null;

  const f = classeur.addWorksheet(ONGLET_LISTES);
  f.columns = [
    { width: 22 },
    { width: 3 }, // A marques
    { width: 22 },
    { width: 24 },
    { width: 3 }, // C/D marque + modèle
    { width: 22 },
    { width: 3 }, // F catégories
    { width: 22 },
    { width: 26 },
    { width: 3 }, // H/I catégorie + sous-catégorie
    { width: 16 }, // K états
  ];

  // Entêtes, pour que l'onglet reste lisible si on le dévoile
  const titres = {
    A1: 'MARQUES',
    C1: 'MARQUE',
    D1: 'MODÈLE',
    F1: 'CATÉGORIES',
    H1: 'CATÉGORIE',
    I1: 'SOUS-CATÉGORIE',
    K1: 'ÉTATS',
  };
  for (const [adresse, texte] of Object.entries(titres)) {
    const c = f.getCell(adresse);
    c.value = texte;
    c.font = { bold: true, size: 9, color: { argb: 'FF5D6F96' } };
  }

  const remplir = (lettre, valeurs) => {
    valeurs.forEach((v, i) => (f.getCell(`${lettre}${i + 2}`).value = v));
    return valeurs.length;
  };

  const nbMarques = remplir('A', marques);
  const nbCategories = remplir('F', categories);
  const nbEtats = remplir('K', etats);

  // Couples groupés par parent : indispensable au MATCH/COUNTIF
  const groupes = (paires, cleParent, cleEnfant, colParent, colEnfant) => {
    const triees = [...paires].sort(
      (a, b) =>
        String(a[cleParent]).localeCompare(String(b[cleParent]), 'fr') ||
        String(a[cleEnfant]).localeCompare(String(b[cleEnfant]), 'fr'),
    );
    triees.forEach((p, i) => {
      f.getCell(`${colParent}${i + 2}`).value = p[cleParent];
      f.getCell(`${colEnfant}${i + 2}`).value = p[cleEnfant];
    });
    return triees.length;
  };

  const nbModeles = groupes(modeles, 'marque', 'modele', 'C', 'D');
  const nbSousCat = groupes(sousCategories, 'parent', 'nom', 'H', 'I');

  // Masqué, mais pas « veryHidden » : le gestionnaire doit pouvoir
  // l'afficher pour comprendre d'où viennent les listes.
  f.state = 'hidden';

  const plage = (lettre, nb) => (nb ? `${ONGLET_LISTES}!$${lettre}$2:$${lettre}$${nb + 1}` : null);

  return {
    marques: plage('A', nbMarques),
    categories: plage('F', nbCategories),
    etats: plage('K', nbEtats),
    modelesParent: plage('C', nbModeles),
    modelesEnfant: nbModeles ? `${ONGLET_LISTES}!$D$2` : null,
    sousCatParent: plage('H', nbSousCat),
    sousCatEnfant: nbSousCat ? `${ONGLET_LISTES}!$I$2` : null,
  };
}

/**
 * Pose les validations sur les deux onglets de saisie.
 *
 * errorStyle differe selon la liste, et ce n'est pas un detail :
 *
 *   stop     catégorie, sous-catégorie, état. Listes fermées,
 *            pilotées par la base. Une valeur hors liste serait
 *            refusée à l'import de toute façon.
 *
 *   warning  marque et modèle. Le référentiel couvre mal le parc
 *            sénégalais, et un fournisseur peut légitimement
 *            livrer une marque qui n'y est pas encore. On prévient
 *            sans bloquer : la prévisualisation signalera la ligne.
 */
function poserValidations(fPieces, fCompat, plages) {
  if (!plages) return;

  const jusque = LIGNES_VALIDEES;
  const colP = (cle) => lettreColonne(COLONNES_PIECES, cle);
  const colC = (cle) => lettreColonne(COLONNES_COMPAT, cle);

  const liste = (feuille, lettre, formule, options = {}) => {
    if (!lettre || !formule) return;
    feuille.dataValidations.add(`${lettre}2:${lettre}${jusque}`, {
      type: 'list',
      allowBlank: true,
      // Sans le « = » initial : c'est la forme qu'écrivent Excel et
      // LibreOffice eux-mêmes.
      formulae: [formule],
      showErrorMessage: true,
      errorStyle: 'stop',
      ...options,
    });
  };

  // ---- Onglet Pièces ----
  liste(fPieces, colP('categorie'), plages.categories, {
    errorTitle: 'Catégorie inconnue',
    error: 'Choisissez une catégorie dans la liste déroulante de la cellule.',
  });

  if (plages.sousCatParent && plages.sousCatEnfant) {
    const cat = colP('categorie');
    liste(
      fPieces,
      colP('sous_categorie'),
      `OFFSET(${plages.sousCatEnfant},MATCH($${cat}2,${plages.sousCatParent},0)-1,0,` +
        `COUNTIF(${plages.sousCatParent},$${cat}2),1)`,
      {
        // Avertissement et non blocage : une catégorie sans
        // sous-catégorie rend la formule vide, ce qui verrouillerait
        // la cellule en mode stop.
        errorStyle: 'warning',
        errorTitle: 'Sous-catégorie inattendue',
        error:
          'Cette sous-catégorie n appartient pas à la catégorie choisie. ' +
          'Renseignez d abord la catégorie, ou laissez la cellule vide.',
        showInputMessage: true,
        promptTitle: 'Dépend de la catégorie',
        prompt: 'Remplissez la colonne Catégorie pour voir la liste.',
      },
    );
  }

  liste(fPieces, colP('etat'), plages.etats, {
    errorTitle: 'État inconnu',
    error: 'Choisissez un état dans la liste déroulante de la cellule.',
  });

  // ---- Onglet Compatibilités ----
  liste(fCompat, colC('marque'), plages.marques, {
    errorStyle: 'warning',
    errorTitle: 'Marque hors référentiel',
    error:
      'Cette marque ne figure pas au référentiel. Vous pouvez la saisir, ' +
      'mais la ligne sera signalée à la prévisualisation.',
  });

  if (plages.modelesParent && plages.modelesEnfant) {
    const mq = colC('marque');
    liste(
      fCompat,
      colC('modele'),
      `OFFSET(${plages.modelesEnfant},MATCH($${mq}2,${plages.modelesParent},0)-1,0,` +
        `COUNTIF(${plages.modelesParent},$${mq}2),1)`,
      {
        errorStyle: 'warning',
        errorTitle: 'Modèle hors référentiel',
        error:
          'Ce modèle n est pas listé pour cette marque. Vous pouvez le saisir, ' +
          'mais la ligne sera signalée à la prévisualisation.',
        showInputMessage: true,
        promptTitle: 'Dépend de la marque',
        prompt: 'Remplissez la colonne Marque véhicule pour voir la liste.',
      },
    );
  }
}

function ajouterAide(classeur, { marques = [], categories = [], etats = [] }) {
  const f = classeur.addWorksheet(ONGLET_AIDE);
  f.columns = [{ width: 4 }, { width: 30 }, { width: 70 }];

  const titre = (texte) => {
    const r = f.addRow(['', texte, '']);
    r.font = { bold: true, size: 12, color: { argb: BLEU_NUIT } };
    r.height = 22;
    return r;
  };
  const ligne = (a, b) => f.addRow(['', a, b]);

  f.addRow([]);
  titre('MAIFA-AUTO — Import de pièces');
  f.addRow([]);

  titre('Comment remplir');
  ligne('Onglet Pièces', 'Une ligne par pièce. Les colonnes orange sont obligatoires.');
  ligne(
    'Onglet Compatibilités',
    'Une ligne par véhicule compatible. Une pièce peut en avoir plusieurs.',
  );
  ligne(
    'Lien entre les deux',
    'La colonne "Référence pièce" de l\'onglet Compatibilités recopie une référence ' +
      "de l'onglet Pièces : la référence interne si la pièce en a déjà une, " +
      'sinon la référence constructeur.',
  );
  ligne(
    'Pièce nouvelle',
    "Elle n'a pas encore de référence interne, celle-ci est attribuée à l'import. " +
      "Servez-vous de sa référence constructeur pour la désigner dans l'onglet " +
      'Compatibilités. Une pièce nouvelle SANS référence constructeur ne peut être ' +
      'reliée à aucun véhicule : renseignez-en une, même provisoire.',
  );
  f.addRow([]);

  titre('Création ou mise à jour');
  ligne('Référence interne vide', 'La pièce est CRÉÉE et reçoit une référence automatiquement.');
  ligne('Référence interne remplie', 'La pièce existante est MISE À JOUR.');
  f.addRow([]);

  titre('Photos');
  ligne(
    'Sans photo',
    "La pièce entre en brouillon : invisible au catalogue jusqu'à ce qu'une photo soit ajoutée.",
  );
  ligne('Avec adresses web', "Les images sont récupérées automatiquement après l'import.");
  f.addRow([]);

  if (etats.length) {
    titre('États acceptés');
    ligne('', etats.join('   /   '));
    f.addRow([]);
  }

  if (categories.length) {
    titre(`Catégories du catalogue (${categories.length})`);
    for (let i = 0; i < categories.length; i += 4) {
      ligne('', categories.slice(i, i + 4).join('   /   '));
    }
    f.addRow([]);
  }

  if (marques.length) {
    titre(`Marques reconnues (${marques.length})`);
    for (let i = 0; i < marques.length; i += 6) {
      ligne('', marques.slice(i, i + 6).join('   /   '));
    }
    ligne('', 'Une marque absente de cette liste sera signalée à la prévisualisation.');
  }

  f.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  return f;
}

/** Métadonnées communes à tous les fichiers produits */
function preparerClasseur() {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'MAIFA-AUTO';
  classeur.created = new Date();
  return classeur;
}

/**
 * Gabarit vierge, avec quelques lignes d'exemple et les listes
 * du référentiel réel.
 */
async function modeleVierge(referentiel = {}) {
  const classeur = preparerClasseur();

  const fPieces = classeur.addWorksheet(ONGLET_PIECES);
  habillerEntete(fPieces, COLONNES_PIECES);

  const fCompat = classeur.addWorksheet(ONGLET_COMPAT);
  habillerEntete(fCompat, COLONNES_COMPAT);

  // Exemples : une pièce neuve, une pièce couvrant deux véhicules
  fPieces.addRow({
    ref_interne: '',
    ref_oe: '0451103318',
    description: 'Filtre à huile',
    categorie: referentiel.categories?.[0] || 'Moteur',
    prix: 4500,
    quantite: 24,
    seuil_alerte: 5,
    etat: 'Neuf',
    fournisseur: 'Bosch',
  });
  fPieces.addRow({
    ref_interne: '',
    ref_oe: '1609848280',
    description: 'Plaquettes de frein avant',
    categorie: referentiel.categories?.[1] || 'Freinage',
    prix: 28000,
    quantite: 6,
    seuil_alerte: 3,
    etat: 'Neuf',
    fournisseur: 'Valeo',
  });

  fCompat.addRow({
    ref_piece: '0451103318',
    marque: 'PEUGEOT',
    modele: '308',
    annee_min: 2013,
    annee_max: 2021,
    motorisation: '1.6 HDi',
  });
  fCompat.addRow({
    ref_piece: '0451103318',
    marque: 'CITROEN',
    modele: 'C4',
    annee_min: 2010,
    annee_max: 2018,
    motorisation: '1.6 HDi',
  });
  fCompat.addRow({
    ref_piece: '1609848280',
    marque: 'PEUGEOT',
    modele: '3008',
    annee_min: 2016,
    annee_max: '',
    motorisation: '',
  });

  // Exemples en gris clair : visiblement à remplacer
  [fPieces, fCompat].forEach((f) => {
    for (let n = 2; n <= f.rowCount; n++) {
      f.getRow(n).font = { color: { argb: 'FF93A2C0' }, italic: true };
    }
  });

  poserValidations(fPieces, fCompat, ajouterListes(classeur, referentiel));
  ajouterAide(classeur, referentiel);
  return classeur.xlsx.writeBuffer();
}

/**
 * Export du stock : le même format que l'import, pour que le
 * gestionnaire modifie dans Excel et réimporte.
 *
 * @param {Array} pieces         lignes de la table pieces
 * @param {Array} compatibilites lignes de piece_compatibilite enrichies
 */
async function exporter(pieces = [], compatibilites = [], referentiel = {}) {
  const classeur = preparerClasseur();

  const fPieces = classeur.addWorksheet(ONGLET_PIECES);
  habillerEntete(fPieces, COLONNES_PIECES);

  for (const p of pieces) {
    fPieces.addRow({
      ref_interne: p.ref_interne || '',
      ref_oe: p.ref_oe || '',
      description: p.description || '',
      categorie: p.categorie_nom || p.categorie || '',
      sous_categorie: p.sous_categorie_nom || '',
      prix: p.prix === null || p.prix === undefined ? null : Number(p.prix),
      quantite: Number(p.quantite || 0),
      seuil_alerte: Number(p.seuil_alerte ?? 3),
      etat: p.etat || '',
      fournisseur: p.fournisseur || '',
      url_images: '',
    });
  }

  // La référence interne ne se modifie pas : c'est elle qui
  // identifie la pièce au réimport. On la verrouille visuellement.
  fPieces.getColumn(1).font = { color: { argb: 'FF5D6F96' } };

  const fCompat = classeur.addWorksheet(ONGLET_COMPAT);
  habillerEntete(fCompat, COLONNES_COMPAT);

  for (const c of compatibilites) {
    fCompat.addRow({
      ref_piece: c.ref_interne || '',
      marque: c.marque || '',
      modele: c.modele || '',
      annee_min: c.annee_min ?? null,
      annee_max: c.annee_max ?? null,
      motorisation: c.motorisation || '',
    });
  }

  // Les mêmes listes que dans le gabarit vierge : le gestionnaire
  // modifie le stock exporté dans Excel et le réimporte, il doit
  // donc retrouver les mêmes garde-fous.
  poserValidations(fPieces, fCompat, ajouterListes(classeur, referentiel));
  ajouterAide(classeur, referentiel);
  return classeur.xlsx.writeBuffer();
}

module.exports = {
  ONGLET_PIECES,
  ONGLET_COMPAT,
  COLONNES_PIECES,
  COLONNES_COMPAT,
  cleEntete,
  associerColonnes,
  valeurTexte,
  valeurNombre,
  valeurEntier,
  lire,
  modeleVierge,
  exporter,
  lettreColonne,
  ajouterListes,
  poserValidations,
};
