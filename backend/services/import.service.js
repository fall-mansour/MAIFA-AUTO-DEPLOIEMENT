// ============================================================
//  MAIFA-AUTO — ANALYSE D'UN IMPORT
//
//  Transforme un fichier lu en un rapport de prévisualisation :
//  ce qui sera créé, ce qui sera mis à jour, ce qui demande une
//  confirmation, ce qui ne passera pas.
//
//  Ce module ne touche PAS la base. Il reçoit l'état du stock et
//  le référentiel, et rend un verdict. L'écriture est le travail
//  du contrôleur, après confirmation du gestionnaire.
//
//  Règle qui gouverne tout : en cas de doute, on n'applique pas.
//  Une pièce rattachée au mauvais véhicule ne se voit pas, et se
//  découvre le jour où un client reçoit la mauvaise pièce.
// ============================================================

const R = require('./rapprochement.service');

const SEUIL_ALERTE_DEFAUT = 3;
const ETATS_CONNUS = ['Neuf', 'Occasion', 'Reconditionné'];
const ANNEE_MIN_PLAUSIBLE = 1950;
const ANNEE_MAX_PLAUSIBLE = new Date().getFullYear() + 2;

// ------------------------------------------------------------
//  OUTILS
// ------------------------------------------------------------

/** Clé de recherche d'une référence, quelle qu'elle soit */
const normRef = (v) => R.normaliser(v);

function messageErreur(texte, champ) {
  return { gravite: 'erreur', champ, texte };
}
function messageAvertissement(texte, champ) {
  return { gravite: 'avertissement', champ, texte };
}

/** Rang de gravité, pour décider du statut d'une ligne */
function statutDepuisMessages(messages) {
  if (messages.some((m) => m.gravite === 'erreur')) return 'anomalie';
  if (messages.some((m) => m.gravite === 'avertissement')) return 'a_confirmer';
  return 'pret';
}

// ------------------------------------------------------------
//  INDEX DU STOCK EXISTANT
// ------------------------------------------------------------

/**
 * Prépare les recherches dans le stock actuel.
 *
 * @param {Array} piecesBase  [{ id, ref_interne, ref_oe, description }]
 */
function indexerStock(piecesBase = []) {
  const parRefInterne = new Map();
  const parRefOe = new Map(); // une référence constructeur peut viser plusieurs pièces

  for (const p of piecesBase) {
    if (p.ref_interne) parRefInterne.set(normRef(p.ref_interne), p);
    if (p.ref_oe) {
      const cle = normRef(p.ref_oe);
      if (!parRefOe.has(cle)) parRefOe.set(cle, []);
      parRefOe.get(cle).push(p);
    }
  }

  return { parRefInterne, parRefOe };
}

// ------------------------------------------------------------
//  ANALYSE D'UNE LIGNE DE PIÈCE
// ------------------------------------------------------------

/**
 * @param {object} ligne      ligne lue par excel.service
 * @param {object} contexte   { index, stock, categories }
 */
function analyserPiece(ligne, contexte) {
  const messages = [];
  const resolution = {};
  let action = 'creation';
  let idPiece = null;

  // --- Identification : création ou mise à jour ? -------------
  const refInterne = String(ligne.ref_interne || '').trim();

  if (refInterne) {
    const analyse = R.normaliser(refInterne);
    const existante = contexte.stock.parRefInterne.get(analyse);

    if (existante) {
      action = 'maj';
      idPiece = existante.id;
      resolution.ref_interne = existante.ref_interne;
    } else {
      messages.push(
        messageErreur(
          `Référence interne "${refInterne}" inconnue au stock. ` +
            'Laissez la colonne vide pour créer une nouvelle pièce.',
          'ref_interne',
        ),
      );
      action = 'aucune';
    }
  }

  // --- Désignation --------------------------------------------
  const description = String(ligne.description || '').trim();
  if (!description) {
    messages.push(messageErreur('Désignation absente.', 'description'));
  } else if (description.length > 500) {
    messages.push(
      messageAvertissement('Désignation très longue, elle sera tronquée.', 'description'),
    );
  }

  // --- Prix ----------------------------------------------------
  const prix = ligne.prix;
  if (prix === null || prix === undefined || prix === '') {
    // Sur une mise à jour, un prix vide signifie « ne pas toucher »
    if (action === 'creation') {
      messages.push(messageErreur('Prix absent.', 'prix'));
    }
  } else if (typeof prix !== 'number' || !Number.isFinite(prix)) {
    messages.push(messageErreur(`Prix illisible : "${prix}".`, 'prix'));
  } else if (prix < 0) {
    messages.push(messageErreur('Prix négatif.', 'prix'));
  } else if (prix === 0) {
    messages.push(messageAvertissement('Prix à zéro : la pièce sera affichée gratuite.', 'prix'));
  } else if (prix > 50_000_000) {
    messages.push(
      messageAvertissement(
        `Prix inhabituellement élevé (${prix.toLocaleString('fr-FR')} FCFA). À vérifier.`,
        'prix',
      ),
    );
  }

  // --- Quantité et seuil ---------------------------------------
  const quantite = ligne.quantite;
  if (quantite !== null && quantite !== undefined && quantite < 0) {
    messages.push(messageErreur('Quantité négative.', 'quantite'));
  }

  const seuil = ligne.seuil_alerte;
  resolution.seuil_alerte = seuil === null || seuil === undefined ? SEUIL_ALERTE_DEFAUT : seuil;

  // --- État -----------------------------------------------------
  const etat = String(ligne.etat || '').trim();
  if (etat) {
    const connu = ETATS_CONNUS.find((e) => R.normaliser(e) === R.normaliser(etat));
    if (connu) {
      resolution.etat = connu;
    } else {
      resolution.etat = etat;
      messages.push(
        messageAvertissement(
          `État "${etat}" hors de la liste habituelle (${ETATS_CONNUS.join(', ')}).`,
          'etat',
        ),
      );
    }
  }

  // --- Catégorie ------------------------------------------------
  const saisieCat = String(ligne.categorie || '').trim();
  if (saisieCat) {
    const res = R.rapprocherCategorie(saisieCat, contexte.index);

    if (res.statut === 'exact') {
      resolution.id_categorie = res.valeur.id;
      resolution.categorie = res.valeur.slug;
    } else if (res.statut === 'suggestion') {
      resolution.id_categorie = res.valeur.id;
      resolution.categorie = res.valeur.slug;
      resolution.categorie_suggeree = true;
      messages.push(
        messageAvertissement(
          `Catégorie "${saisieCat}" rapprochée de "${res.valeur.nom}". À confirmer.`,
          'categorie',
        ),
      );
    } else if (res.statut === 'ambigu') {
      messages.push(
        messageAvertissement(
          `Catégorie "${saisieCat}" ambiguë : ` +
            res.candidats.map((c) => c.nom).join(' ou ') +
            '. Choisissez.',
          'categorie',
        ),
      );
    } else {
      messages.push(
        messageAvertissement(
          `Catégorie "${saisieCat}" inconnue. La pièce sera sans catégorie.`,
          'categorie',
        ),
      );
    }
  } else if (action === 'creation') {
    messages.push(
      messageAvertissement(
        'Aucune catégorie : la pièce sera mal classée au catalogue.',
        'categorie',
      ),
    );
  }

  // --- Sous-catégorie -------------------------------------------
  const saisieSousCat = String(ligne.sous_categorie || '').trim();
  if (saisieSousCat) {
    const res = R.rapprocherCategorie(saisieSousCat, contexte.index);
    if (res.statut === 'exact' || res.statut === 'suggestion') {
      resolution.id_sous_categorie = res.valeur.id;
      if (res.statut === 'suggestion') {
        messages.push(
          messageAvertissement(
            `Sous-catégorie "${saisieSousCat}" rapprochée de "${res.valeur.nom}".`,
            'sous_categorie',
          ),
        );
      }
    } else {
      messages.push(
        messageAvertissement(
          `Sous-catégorie "${saisieSousCat}" inconnue, ignorée.`,
          'sous_categorie',
        ),
      );
    }
  }

  // --- Référence constructeur ------------------------------------
  const refOe = String(ligne.ref_oe || '').trim();
  if (refOe) {
    resolution.ref_oe = refOe;

    // Déjà portée par une AUTRE pièce du stock : signalé, pas bloquant,
    // car des équivalents partagent légitimement une référence.
    const existantes = contexte.stock.parRefOe.get(normRef(refOe)) || [];
    const autres = existantes.filter((p) => p.id !== idPiece);
    if (autres.length) {
      messages.push(
        messageAvertissement(
          `Référence constructeur déjà portée par ${autres.length} pièce(s) du stock ` +
            `(${autres.map((p) => p.ref_interne || '#' + p.id).join(', ')}).`,
          'ref_oe',
        ),
      );
    }
  } else if (action === 'creation') {
    messages.push(
      messageAvertissement(
        'Aucune référence constructeur : la pièce sera difficile à retrouver.',
        'ref_oe',
      ),
    );
  }

  // --- Photos -----------------------------------------------------
  const urls = String(ligne.url_images || '')
    .split(/[,;\s]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  resolution.url_images = urls;

  // Sans photo, la pièce entre en brouillon : elle existe au stock
  // mais n'apparaît dans aucun catalogue client.
  if (action === 'creation' && urls.length === 0) {
    resolution.visible_catalogue = 0;
    resolution.brouillon = true;
  }

  return {
    onglet: 'pieces',
    ligne_fichier: ligne._ligne,
    action,
    statut: action === 'aucune' ? 'anomalie' : statutDepuisMessages(messages),
    donnees: ligne,
    resolution,
    messages,
    id_piece: idPiece,
  };
}

// ------------------------------------------------------------
//  ANALYSE D'UNE LIGNE DE COMPATIBILITÉ
// ------------------------------------------------------------

/**
 * @param {object} ligne
 * @param {object} contexte  { index, stock, piecesDuFichier }
 *   piecesDuFichier : Map(clé de référence → analyse de la pièce),
 *   pour relier une compatibilité à une pièce créée dans le même
 *   fichier, qui n'a donc pas encore d'identifiant.
 */
function analyserCompatibilite(ligne, contexte) {
  const messages = [];
  const resolution = {};

  // --- À quelle pièce se rattache-t-elle ? ---------------------
  const refPiece = String(ligne.ref_piece || '').trim();

  if (!refPiece) {
    messages.push(messageErreur('Référence pièce absente.', 'ref_piece'));
  } else {
    const cle = normRef(refPiece);

    // 1. Une pièce du fichier en cours, par sa référence interne
    //    ou sa référence constructeur
    const duFichier = contexte.piecesDuFichier.get(cle);

    // 2. Une pièce déjà au stock
    const auStockInterne = contexte.stock.parRefInterne.get(cle);
    const auStockOe = contexte.stock.parRefOe.get(cle) || [];

    if (duFichier) {
      resolution.ligne_piece = duFichier.ligne_fichier;
      resolution.id_piece = duFichier.id_piece; // null si création
    } else if (auStockInterne) {
      resolution.id_piece = auStockInterne.id;
    } else if (auStockOe.length === 1) {
      resolution.id_piece = auStockOe[0].id;
    } else if (auStockOe.length > 1) {
      messages.push(
        messageErreur(
          `Référence "${refPiece}" portée par ${auStockOe.length} pièces du stock. ` +
            'Utilisez la référence interne pour lever l ambiguïté.',
          'ref_piece',
        ),
      );
    } else if (contexte.piecesRejetees.has(cle)) {
      // La pièce EST dans le fichier, mais sa ligne est en anomalie.
      // Le dire franchement évite une chasse inutile côté gestionnaire.
      messages.push(
        messageErreur(
          `La pièce "${refPiece}" est bien dans l onglet Pièces, ` +
            `mais sa ligne ${contexte.piecesRejetees.get(cle)} est en anomalie. ` +
            'Corrigez-la d abord.',
          'ref_piece',
        ),
      );
    } else {
      messages.push(
        messageErreur(
          `Référence "${refPiece}" absente de l onglet Pièces et du stock.`,
          'ref_piece',
        ),
      );
    }
  }

  // --- Véhicule -------------------------------------------------
  const res = R.rapprocherCompatibilite(
    { marque: ligne.marque, modele: ligne.modele },
    contexte.index,
  );

  const dm = res.marque;
  const dmo = res.modele;

  if (dm.statut === 'exact') {
    resolution.id_marque = dm.valeur.id;
    resolution.marque = dm.valeur.nom;
  } else if (dm.statut === 'suggestion') {
    resolution.id_marque = dm.valeur.id;
    resolution.marque = dm.valeur.nom;
    resolution.marque_suggeree = true;
    messages.push(
      messageAvertissement(
        `Marque "${dm.saisie}" rapprochée de "${dm.valeur.nom}". À confirmer.`,
        'marque',
      ),
    );
  } else if (dm.statut === 'ambigu') {
    messages.push(
      messageErreur(
        `Marque "${dm.saisie}" ambiguë : ${dm.candidats.map((c) => c.nom).join(' ou ')}.`,
        'marque',
      ),
    );
  } else if (dm.statut === 'vide') {
    messages.push(messageErreur('Marque absente.', 'marque'));
  } else {
    messages.push(
      messageErreur(
        `Marque "${dm.saisie}" absente du référentiel. ` +
          'Vérifiez l orthographe ou ajoutez-la au référentiel.',
        'marque',
      ),
    );
  }

  if (dmo.statut === 'exact') {
    resolution.id_modele = dmo.valeur.id;
    resolution.modele = dmo.valeur.modele;
  } else if (dmo.statut === 'suggestion') {
    resolution.id_modele = dmo.valeur.id;
    resolution.modele = dmo.valeur.modele;
    resolution.modele_suggere = true;
    messages.push(
      messageAvertissement(
        `Modèle "${dmo.saisie}" rapproché de "${dmo.valeur.modele}"` +
          (dmo.motif === 'generation' ? ' (une seule génération correspond).' : '.'),
        'modele',
      ),
    );
  } else if (dmo.statut === 'ambigu') {
    messages.push(
      messageAvertissement(
        `Modèle "${dmo.saisie}" ambigu : ` +
          dmo.candidats.map((c) => c.modele).join(' ou ') +
          '. Choisissez.',
        'modele',
      ),
    );
    resolution.candidats_modele = dmo.candidats.map((c) => ({ id: c.id, modele: c.modele }));
  } else if (dmo.statut === 'vide') {
    messages.push(messageErreur('Modèle absent.', 'modele'));
  } else if (dmo.statut === 'sans_marque') {
    // La marque n'étant pas certaine, le modèle n'a pas été cherché.
    // Un seul message suffit, celui de la marque.
  } else {
    messages.push(
      messageAvertissement(`Modèle "${dmo.saisie}" inconnu pour cette marque.`, 'modele'),
    );
  }

  // --- Années ----------------------------------------------------
  const amin = ligne.annee_min;
  const amax = ligne.annee_max;

  const anneeDouteuse = (a) =>
    a !== null && a !== undefined && (a < ANNEE_MIN_PLAUSIBLE || a > ANNEE_MAX_PLAUSIBLE);

  if (anneeDouteuse(amin)) {
    messages.push(messageErreur(`Année de début invraisemblable : ${amin}.`, 'annee_min'));
  }
  if (anneeDouteuse(amax)) {
    messages.push(messageErreur(`Année de fin invraisemblable : ${amax}.`, 'annee_max'));
  }
  if (amin && amax && amin > amax) {
    messages.push(
      messageErreur(
        `Année de début (${amin}) postérieure à l année de fin (${amax}).`,
        'annee_min',
      ),
    );
  }

  resolution.annee_min = anneeDouteuse(amin) ? null : (amin ?? null);
  resolution.annee_max = anneeDouteuse(amax) ? null : (amax ?? null);
  resolution.motorisation = String(ligne.motorisation || '').trim() || null;

  // Sans identifiant de modèle, la ligne ne peut pas être écrite.
  // Le message n'est ajouté que si rien ne l'explique déjà, pour
  // ne pas empiler deux fois le même diagnostic.
  if (!resolution.id_modele && messages.length === 0) {
    messages.push(
      messageErreur('Véhicule non identifié, la ligne ne sera pas appliquée.', 'modele'),
    );
  }

  return {
    onglet: 'compatibilites',
    ligne_fichier: ligne._ligne,
    action: 'creation',
    statut: statutDepuisMessages(messages),
    donnees: ligne,
    resolution,
    messages,
    id_piece: resolution.id_piece ?? null,
  };
}

// ------------------------------------------------------------
//  ANALYSE COMPLÈTE
// ------------------------------------------------------------

/**
 * @param {object} fichier   sortie de excel.service.lire()
 * @param {object} contexte  { index, piecesBase }
 * @returns rapport de prévisualisation
 */
function analyser(fichier, contexte) {
  const stock = indexerStock(contexte.piecesBase || []);
  const ctx = { index: contexte.index, stock };

  // --- Pièces ---------------------------------------------------
  const lignesPieces = fichier.pieces.map((l) => analyserPiece(l, ctx));

  // Doublons internes au fichier : deux lignes visant la même pièce
  const vues = new Map();
  for (const a of lignesPieces) {
    const cles = [a.resolution.ref_interne, a.donnees.ref_oe].filter(Boolean).map(normRef);

    for (const cle of cles) {
      if (vues.has(cle)) {
        a.messages.push(
          messageAvertissement(
            `Référence déjà présente ligne ${vues.get(cle)} du même fichier. ` +
              'La dernière ligne l emportera.',
            'ref_oe',
          ),
        );
        if (a.statut === 'pret') a.statut = 'a_confirmer';
      } else {
        vues.set(cle, a.ligne_fichier);
      }
    }
  }

  // Index des pièces du fichier, pour rattacher les compatibilités.
  // Les lignes en anomalie sont tenues à part : une compatibilité
  // qui les vise doit recevoir un message utile, pas un « introuvable ».
  const piecesDuFichier = new Map();
  const piecesRejetees = new Map();

  for (const a of lignesPieces) {
    const cles = [a.resolution.ref_interne, a.donnees.ref_oe].filter(Boolean).map(normRef);

    for (const cle of cles) {
      if (a.statut === 'anomalie') {
        if (!piecesRejetees.has(cle)) piecesRejetees.set(cle, a.ligne_fichier);
      } else {
        piecesDuFichier.set(cle, a);
      }
    }
  }

  // --- Compatibilités --------------------------------------------
  const lignesCompat = fichier.compatibilites.map((l) =>
    analyserCompatibilite(l, { ...ctx, piecesDuFichier, piecesRejetees }),
  );

  // Doublons de compatibilité : la contrainte d'unicité en base
  // porte sur (id_piece, id_modele, annee_min, annee_max), mais
  // MySQL considère deux NULL comme différents. Deux lignes sans
  // année passeraient donc toutes les deux. On les repère ici.
  const vuesCompat = new Map();
  for (const a of lignesCompat) {
    if (a.statut === 'anomalie' || !a.resolution.id_modele) continue;
    const cle = [
      a.resolution.id_piece ?? 'L' + a.resolution.ligne_piece,
      a.resolution.id_modele,
      a.resolution.annee_min ?? '*',
      a.resolution.annee_max ?? '*',
    ].join('|');

    if (vuesCompat.has(cle)) {
      a.statut = 'ignoree';
      a.messages.push(
        messageAvertissement(
          `Compatibilité identique à la ligne ${vuesCompat.get(cle)}. Ignorée.`,
          'modele',
        ),
      );
    } else {
      vuesCompat.set(cle, a.ligne_fichier);
    }
  }

  // --- Synthèse ---------------------------------------------------
  const compter = (lignes, statut) => lignes.filter((l) => l.statut === statut).length;

  const synthese = {
    pieces: {
      total: lignesPieces.length,
      creations: lignesPieces.filter((l) => l.action === 'creation' && l.statut !== 'anomalie')
        .length,
      mises_a_jour: lignesPieces.filter((l) => l.action === 'maj' && l.statut !== 'anomalie')
        .length,
      pretes: compter(lignesPieces, 'pret'),
      a_confirmer: compter(lignesPieces, 'a_confirmer'),
      anomalies: compter(lignesPieces, 'anomalie'),
      // Seules les lignes réellement applicables comptent : une
      // ligne en anomalie ne produira aucun brouillon.
      brouillons: lignesPieces.filter((l) => l.resolution.brouillon && l.statut !== 'anomalie')
        .length,
    },
    compatibilites: {
      total: lignesCompat.length,
      pretes: compter(lignesCompat, 'pret'),
      a_confirmer: compter(lignesCompat, 'a_confirmer'),
      anomalies: compter(lignesCompat, 'anomalie'),
      ignorees: compter(lignesCompat, 'ignoree'),
    },
  };

  return {
    synthese,
    anomalies_fichier: fichier.anomalies || [],
    lignes: [...lignesPieces, ...lignesCompat],
  };
}

module.exports = {
  SEUIL_ALERTE_DEFAUT,
  ETATS_CONNUS,
  indexerStock,
  analyserPiece,
  analyserCompatibilite,
  analyser,
};
