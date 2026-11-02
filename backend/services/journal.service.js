// ============================================================
//  MAIFA-AUTO — JOURNAL DES ACTIONS
//
//  Enregistre qui a fait quoi. Un seul point d'entrée :
//
//      await journal.enregistrer(connexion, req, {
//        action: 'commande_confirmee',
//        objet: { type: 'commande', id: 42, libelle: 'CMD-00042' },
//        avant: { statut: 'en_attente' },
//        apres: { statut: 'confirmee' },
//      });
//
//  LA RÈGLE QUI COMPTE : l'appel se fait DANS la transaction de
//  l'action, en lui passant la connexion. Si l'action est annulée,
//  la trace l'est aussi. Si la trace échoue, l'action l'est aussi.
//
//  Un journal écrit à côté de la transaction finit par décrire un
//  monde qui n'existe pas : des commandes confirmées sans trace,
//  ou des traces de confirmations qui n'ont jamais eu lieu.
// ============================================================

const db = require('../db');

// ------------------------------------------------------------
//  CATALOGUE DES ACTIONS
//
//  Chaque entrée donne le libellé affiché au responsable et le
//  type d'objet concerné. Une action absente d'ici reste
//  enregistrée, mais sans résumé automatique.
// ------------------------------------------------------------
const ACTIONS = {
  // Commandes
  commande_confirmee: { libelle: 'a confirmé la commande', objet: 'commande' },
  commande_annulee: { libelle: 'a annulé la commande', objet: 'commande' },
  commande_expediee: { libelle: 'a expédié la commande', objet: 'commande' },
  commande_livree: { libelle: 'a marqué comme livrée la commande', objet: 'commande' },

  // Stock
  piece_creee: { libelle: 'a créé la pièce', objet: 'piece' },
  piece_modifiee: { libelle: 'a modifié la pièce', objet: 'piece' },
  piece_supprimee: { libelle: 'a supprimé la pièce', objet: 'piece' },
  stock_ajuste: { libelle: 'a ajusté le stock de', objet: 'piece' },

  // Import en masse
  import_analyse: { libelle: 'a analysé le fichier', objet: 'import' },
  import_applique: { libelle: 'a appliqué l import', objet: 'import' },
  import_annule: { libelle: 'a abandonné l import', objet: 'import' },
  export_stock: { libelle: 'a exporté le stock', objet: 'import' },

  // Comptes
  role_modifie: { libelle: 'a changé le rôle de', objet: 'utilisateur' },
};

// ------------------------------------------------------------
//  AUTEUR
// ------------------------------------------------------------

/**
 * Identité de l'auteur, telle qu'on la fige dans la ligne.
 *
 * On ne se fie qu'au jeton vérifié, jamais au corps de la requête :
 * sinon n'importe qui pourrait signer ses actions du nom d'un autre.
 */
function auteurDepuis(req) {
  const u = req?.utilisateur || req?.user || null;

  if (!u) {
    return { id: null, nom: 'Système', mail: null, role: null };
  }

  const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim();

  return {
    id: u.id ?? null,
    nom: nom || u.mail || 'Inconnu',
    mail: u.mail ?? null,
    role: u.role ?? null,
  };
}

/** Adresse d'origine, en tenant compte d'un éventuel proxy */
function adresseDepuis(req) {
  if (!req) return null;
  const transmise = req.headers?.['x-forwarded-for'];
  const brute = transmise
    ? String(transmise).split(',')[0].trim()
    : req.ip || req.socket?.remoteAddress || null;
  return brute ? String(brute).slice(0, 45) : null;
}

// ------------------------------------------------------------
//  RÉSUMÉ
// ------------------------------------------------------------

/**
 * Phrase lisible, construite une fois à l'écriture plutôt qu'à
 * chaque affichage. Le responsable doit comprendre sans ouvrir le
 * détail JSON.
 */
function construireResume(auteur, action, objet, extra) {
  if (extra?.resume) return String(extra.resume).slice(0, 255);

  const modele = ACTIONS[action];
  const verbe = modele ? modele.libelle : `a effectué « ${action} » sur`;
  const cible = objet?.libelle || (objet?.id ? `#${objet.id}` : '');

  let phrase = `${auteur.nom} ${verbe} ${cible}`.trim();

  // Un ajustement de stock sans le chiffre n'apprend rien
  if (action === 'stock_ajuste' && extra?.avant && extra?.apres) {
    const a = extra.avant.quantite;
    const b = extra.apres.quantite;
    if (a !== undefined && b !== undefined) {
      phrase += ` (${a} → ${b})`;
    }
  }

  return phrase.slice(0, 255);
}

/** JSON compact, ou null. Ne fait jamais échouer l'écriture. */
function serialiser(valeur) {
  if (valeur === null || valeur === undefined) return null;
  try {
    const texte = JSON.stringify(valeur);
    return texte && texte !== '{}' ? texte.slice(0, 65000) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
//  ÉCRITURE
// ------------------------------------------------------------

/**
 * Enregistre une action.
 *
 * @param {object} connexion  la connexion de la transaction en cours.
 *                            Passer `db` seulement hors transaction.
 * @param {object} req        la requête, pour l'auteur et l'adresse
 * @param {object} details    { action, objet:{type,id,libelle}, avant, apres, resume }
 */
async function enregistrer(connexion, req, details) {
  const { action, objet = {}, avant, apres, resume } = details || {};

  if (!action) throw new Error("journal.enregistrer : 'action' est obligatoire.");

  const auteur = auteurDepuis(req);
  const modele = ACTIONS[action];
  const type = objet.type || modele?.objet || 'autre';

  const texte = construireResume(auteur, action, objet, { avant, apres, resume });

  await (connexion || db).query(
    `INSERT INTO journal_actions
       (id_utilisateur, auteur_nom, auteur_mail, auteur_role,
        action, objet_type, objet_id, objet_libelle,
        resume, avant, apres, adresse_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auteur.id,
      auteur.nom.slice(0, 160),
      auteur.mail ? auteur.mail.slice(0, 190) : null,
      auteur.role,
      action.slice(0, 40),
      String(type).slice(0, 20),
      objet.id ?? null,
      objet.libelle ? String(objet.libelle).slice(0, 255) : null,
      texte,
      serialiser(avant),
      serialiser(apres),
      adresseDepuis(req),
    ],
  );
}

/**
 * Variante pour les actions SANS transaction, typiquement les
 * lectures notables comme un export.
 *
 * Elle n'interrompt jamais l'appelant : échouer à tracer un
 * téléchargement ne doit pas empêcher le téléchargement. À ne PAS
 * utiliser pour une action qui modifie quelque chose, où la trace
 * doit partager le sort de l'action.
 */
async function enregistrerSansBloquer(req, details) {
  try {
    await enregistrer(db, req, details);
  } catch (erreur) {
    console.error('Journal non écrit :', erreur.message, details?.action);
  }
}

/**
 * Compare deux objets et ne garde que ce qui a changé.
 * Évite de stocker trente colonnes identiques quand seul le prix
 * a bougé, et rend le détail lisible.
 */
function difference(avant = {}, apres = {}) {
  const dAvant = {};
  const dApres = {};

  for (const cle of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    const a = avant[cle];
    const b = apres[cle];
    if (String(a ?? '') !== String(b ?? '')) {
      dAvant[cle] = a ?? null;
      dApres[cle] = b ?? null;
    }
  }

  return { avant: dAvant, apres: dApres, aChange: Object.keys(dApres).length > 0 };
}

module.exports = {
  ACTIONS,
  auteurDepuis,
  enregistrer,
  enregistrerSansBloquer,
  difference,
};
