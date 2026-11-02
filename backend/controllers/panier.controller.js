const crypto = require('crypto');
const db = require('../db');
const journal = require('../services/journal.service');
const mailsCommande = require('../services/mails.commande');

const MODES_PAIEMENT = ['livraison', 'wave', 'om'];

/** Clé du lien de suivi envoyé au client. 24 caractères, non devinables. */
const nouveauJetonSuivi = () => crypto.randomBytes(12).toString('hex');

/** Chaîne vide -> NULL */
const nn = (v) =>
  v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();

// ==========================================================
//  POST /api/panier/verifier
//  Contrôle la disponibilité et les prix AVANT le formulaire.
//  Le client envoie seulement des id et des quantités.
// ==========================================================
exports.verifierPanier = async (req, res) => {
  try {
    const articles = Array.isArray(req.body.articles) ? req.body.articles : [];
    if (articles.length === 0) {
      return res.status(400).json({ message: 'Le panier est vide.' });
    }

    const ids = [...new Set(articles.map((a) => Number(a.id_piece)).filter(Boolean))];
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Aucune pièce valide dans le panier.' });
    }

    const [rows] = await db.query(
      `SELECT id, description, ref_interne, ref_oe, marque, modele, etat, prix, quantite,
              img_principale, visible_catalogue
       FROM pieces WHERE id IN (?)`,
      [ids],
    );
    const parId = new Map(rows.map((r) => [r.id, r]));

    let total = 0;
    const lignes = articles.map((a) => {
      const id = Number(a.id_piece);
      const demandee = Math.max(1, Number(a.quantite) || 1);
      const p = parId.get(id);

      if (!p || !p.visible_catalogue) {
        return {
          id_piece: id,
          disponible: false,
          probleme: 'retiree',
          message: 'Cette pièce n’est plus au catalogue.',
        };
      }

      const stock = Number(p.quantite) || 0;
      const prix = Number(p.prix) || 0;
      const quantite = Math.min(demandee, stock);
      const montant = prix * quantite;
      total += montant;

      return {
        id_piece: id,
        designation: p.description,
        ref: p.ref_interne,
        vehicule: [p.marque, p.modele].filter(Boolean).join(' '),
        etat: p.etat,
        img_principale: p.img_principale,
        prix_unitaire: prix,
        quantite,
        quantite_demandee: demandee,
        stock,
        montant,
        disponible: stock > 0,
        probleme: stock === 0 ? 'rupture' : demandee > stock ? 'stock_insuffisant' : null,
        message:
          stock === 0
            ? 'Cette pièce vient d’être vendue.'
            : demandee > stock
              ? `Il ne reste que ${stock} unité${stock > 1 ? 's' : ''}.`
              : null,
      };
    });

    res.status(200).json({
      lignes,
      total,
      nb_articles: lignes.reduce((s, l) => s + (l.quantite || 0), 0),
      tout_disponible: lignes.every((l) => l.disponible && !l.probleme),
    });
  } catch (error) {
    console.error('❌ Erreur vérification panier :', error);
    res.status(500).json({ message: 'Erreur lors de la vérification du panier.' });
  }
};

// ==========================================================
//  POST /api/panier/valider
//  Crée la commande et décrémente le stock, en une transaction.
//  Le prix vient TOUJOURS de la base, jamais du navigateur.
// ==========================================================
exports.validerPanier = async (req, res) => {
  const { articles, client, mode_paiement } = req.body;

  // Le compte rattaché vient du JETON, jamais du corps de la requête.
  //
  // Lu depuis req.body, n'importe qui pouvait envoyer l'identifiant
  // d'un autre client et rattacher sa commande à son compte. La route
  // acceptant les invités (jetonFacultatif), la valeur reste nulle
  // pour une commande sans compte.
  const idUser = req.utilisateur?.id ?? null;

  // --- 1. Validations de forme ---
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ message: 'Le panier est vide.' });
  }

  if (!client || !nn(client.nom) || !nn(client.telephone)) {
    return res.status(400).json({ message: 'Le nom et le téléphone sont obligatoires.' });
  }

  const mode = MODES_PAIEMENT.includes(mode_paiement) ? mode_paiement : 'livraison';

  // Le paiement en ligne exige un compte : il demande une traçabilité
  if (mode !== 'livraison' && !idUser) {
    return res.status(403).json({
      message: 'Le paiement en ligne nécessite un compte. Choisissez le paiement à la livraison.',
    });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const ids = [...new Set(articles.map((a) => Number(a.id_piece)).filter(Boolean))];

    // --- 2. Verrouillage des lignes le temps de la transaction ---
    // Empêche deux clients de commander la même pièce simultanément
    const [pieces] = await conn.query(
      `SELECT id, description, ref_interne, marque, modele, etat, prix, quantite,
              img_principale, visible_catalogue
       FROM pieces WHERE id IN (?) FOR UPDATE`,
      [ids],
    );
    const parId = new Map(pieces.map((p) => [p.id, p]));

    // --- 3. Contrôle de disponibilité et calcul du total côté serveur ---
    const lignes = [];
    const conflits = [];
    let total = 0;
    let nbArticles = 0;

    for (const a of articles) {
      const id = Number(a.id_piece);
      const demandee = Math.max(1, Number(a.quantite) || 1);
      const p = parId.get(id);

      if (!p || !p.visible_catalogue) {
        conflits.push({ id_piece: id, message: 'Pièce retirée du catalogue.' });
        continue;
      }

      const stock = Number(p.quantite) || 0;
      if (stock < demandee) {
        conflits.push({
          id_piece: id,
          designation: p.description,
          stock,
          demandee,
          message:
            stock === 0
              ? `« ${p.description} » vient d’être vendue.`
              : `« ${p.description} » : il ne reste que ${stock} unité${stock > 1 ? 's' : ''}.`,
        });
        continue;
      }

      const prix = Number(p.prix) || 0;
      const montant = prix * demandee;
      total += montant;
      nbArticles += demandee;

      lignes.push([
        null, // id_commande, complété plus bas
        id,
        p.description,
        p.ref_interne,
        [p.marque, p.modele].filter(Boolean).join(' ') || null,
        p.etat,
        p.img_principale,
        prix,
        demandee,
        montant,
      ]);
    }

    // Un seul conflit annule tout : mieux vaut prévenir que livrer partiellement
    if (conflits.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        message: 'Certaines pièces ne sont plus disponibles.',
        conflits,
      });
    }

    // --- 4. Création de la commande ---
    const jetonSuivi = nouveauJetonSuivi();

    const [resCmd] = await conn.query(
      `INSERT INTO commandes
        (id_user, jeton_suivi, nom, prenom, telephone, email, adresse_livraison, commentaire,
         mode_paiement, total, nb_articles, stock_decremente)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        idUser,
        jetonSuivi,
        nn(client.nom),
        nn(client.prenom),
        nn(client.telephone),
        nn(client.email),
        nn(client.adresse_livraison),
        nn(client.commentaire),
        mode,
        total,
        nbArticles,
      ],
    );

    const idCommande = resCmd.insertId;

    // Référence lisible, générée depuis l'id : aucun risque de collision
    const [[{ reference }]] = await conn.query(
      `SELECT CONCAT('TM-', YEAR(NOW()), '-', LPAD(?, 4, '0')) AS reference`,
      [idCommande],
    );
    await conn.query('UPDATE commandes SET reference = ? WHERE id = ?', [reference, idCommande]);

    // --- 5. Articles ---
    for (const l of lignes) {
      l[0] = idCommande;
      await conn.query(
        `INSERT INTO commande_articles
          (id_commande, id_piece, designation, ref, vehicule, etat, img_principale,
           prix_unitaire, quantite, montant)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        l,
      );
    }

    // --- 6. Le stock N'EST PAS décrémenté ici ---
    // Il l'est à la confirmation par le gestionnaire (voir majStatut).
    // La pièce reste donc visible pour d'autres clients : la page de
    // gestion signale les commandes concurrentes sur un même article.

    await conn.commit();

    console.log(`🛒 Commande ${reference} en attente — ${nbArticles} article(s), ${total} FCFA`);

    res.status(201).json({
      message: 'Commande enregistrée, en attente de confirmation.',
      reference,
      id: idCommande,
      total,
      nb_articles: nbArticles,
      mode_paiement: mode,
      articles: lignes.map((l) => ({
        designation: l[2],
        ref: l[3],
        prix_unitaire: l[7],
        quantite: l[8],
        montant: l[9],
      })),
    });
  } catch (error) {
    await conn.rollback();
    console.error('❌ Erreur validation panier :', error);
    res.status(500).json({ message: 'Erreur interne du serveur.', error: error.message });
  } finally {
    conn.release();
  }
};

// ==========================================================
//  GET /api/panier/commande/:reference
//  Récapitulatif après validation (page de confirmation)
// ==========================================================
exports.getCommande = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM commandes WHERE reference = ?', [
      req.params.reference,
    ]);
    if (rows.length === 0) return res.status(404).json({ message: 'Commande introuvable.' });

    const commande = rows[0];
    const [articles] = await db.query(
      'SELECT * FROM commande_articles WHERE id_commande = ? ORDER BY id',
      [commande.id],
    );

    res.status(200).json({
      ...commande,
      total: Number(commande.total),
      articles: articles.map((a) => ({
        ...a,
        prix_unitaire: Number(a.prix_unitaire),
        montant: Number(a.montant),
      })),
    });
  } catch (error) {
    console.error('❌ Erreur récupération commande :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la commande.' });
  }
};

// ==========================================================
//  PATCH /api/panier/commande/:id/statut   (gestion)
//
//  C'est ICI que le stock bouge :
//   - en_attente -> confirmee : décrémentation
//   - confirmee/livree -> annulee : restitution
//  Le drapeau stock_decremente garantit une seule opération.
//
//  C'est ici aussi que la commande est AFFECTÉE à son
//  gestionnaire, et que l'action est INSCRITE AU JOURNAL. Les
//  deux écritures se font dans la transaction : si le changement
//  de statut échoue, la trace n'existe pas non plus, et
//  réciproquement.
// ==========================================================

/** Action du journal correspondant à chaque statut visé */
const ACTION_PAR_STATUT = {
  confirmee: 'commande_confirmee',
  expediee: 'commande_expediee',
  annulee: 'commande_annulee',
  livree: 'commande_livree',
  en_attente: 'commande_rouverte',
};

exports.majStatut = async (req, res) => {
  const STATUTS = ['en_attente', 'confirmee', 'expediee', 'livree', 'annulee'];
  const { statut } = req.body;

  if (!STATUTS.includes(statut)) {
    return res.status(400).json({ message: 'Statut invalide.' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, reference, statut, stock_decremente, traite_par, total
         FROM commandes WHERE id = ? FOR UPDATE`,
      [req.params.id],
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const commande = rows[0];

    if (commande.statut === statut) {
      await conn.rollback();
      return res.status(200).json({ message: 'Statut déjà à jour.', statut });
    }

    const [articles] = await conn.query(
      `SELECT ca.id_piece, ca.quantite, ca.designation
       FROM commande_articles ca
       WHERE ca.id_commande = ? AND ca.id_piece IS NOT NULL`,
      [commande.id],
    );

    // Détail du mouvement de stock, pour le journal
    const mouvements = [];

    // ---------- CONFIRMATION : on retire du stock ----------
    if (statut === 'confirmee' && !commande.stock_decremente) {
      const ids = articles.map((a) => a.id_piece);

      if (ids.length > 0) {
        // Verrou sur les pièces concernées
        const [pieces] = await conn.query(
          'SELECT id, description, quantite FROM pieces WHERE id IN (?) FOR UPDATE',
          [ids],
        );
        const parId = new Map(pieces.map((p) => [p.id, p]));

        // Contrôle avant toute écriture : une seule ligne insuffisante bloque tout
        const manquants = [];
        for (const a of articles) {
          const p = parId.get(a.id_piece);
          const stock = p ? Number(p.quantite) || 0 : 0;
          if (stock < a.quantite) {
            manquants.push({
              id_piece: a.id_piece,
              designation: a.designation,
              demandee: a.quantite,
              stock,
              message: `« ${a.designation} » : ${stock} en stock pour ${a.quantite} commandée(s).`,
            });
          }
        }

        if (manquants.length > 0) {
          await conn.rollback();
          return res.status(409).json({
            message: 'Stock insuffisant pour confirmer cette commande.',
            conflits: manquants,
          });
        }

        for (const a of articles) {
          await conn.query('UPDATE pieces SET quantite = quantite - ? WHERE id = ?', [
            a.quantite,
            a.id_piece,
          ]);

          const avant = Number(parId.get(a.id_piece)?.quantite) || 0;
          mouvements.push({
            piece: a.designation,
            avant,
            apres: avant - a.quantite,
          });
        }
      }

      await conn.query('UPDATE commandes SET stock_decremente = 1 WHERE id = ?', [commande.id]);
      console.log(`✅ ${commande.reference} confirmée — ${articles.length} ligne(s) déstockée(s)`);
    }

    // ---------- ANNULATION : on remet en stock ----------
    if (statut === 'annulee' && commande.stock_decremente) {
      const ids = articles.map((a) => a.id_piece);
      const parId = new Map();

      if (ids.length > 0) {
        const [pieces] = await conn.query(
          'SELECT id, quantite FROM pieces WHERE id IN (?) FOR UPDATE',
          [ids],
        );
        pieces.forEach((p) => parId.set(p.id, p));
      }

      for (const a of articles) {
        await conn.query('UPDATE pieces SET quantite = quantite + ? WHERE id = ?', [
          a.quantite,
          a.id_piece,
        ]);

        const avant = Number(parId.get(a.id_piece)?.quantite) || 0;
        mouvements.push({
          piece: a.designation,
          avant,
          apres: avant + a.quantite,
        });
      }

      await conn.query('UPDATE commandes SET stock_decremente = 0 WHERE id = ?', [commande.id]);
      console.log(`↩️ ${commande.reference} annulée — ${articles.length} ligne(s) restituée(s)`);
    }

    // ---------- AFFECTATION ----------
    // Le premier qui confirme devient le responsable de la commande.
    // Une intervention ultérieure d'un collègue figure au journal,
    // mais ne change pas l'affectation : celui qui a confirmé est
    // celui qui a vérifié le stock et appelé le client.
    const premiereConfirmation = statut === 'confirmee' && !commande.traite_par;

    if (premiereConfirmation && req.utilisateur?.id) {
      await conn.query(
        'UPDATE commandes SET traite_par = ?, date_traitement = NOW() WHERE id = ?',
        [req.utilisateur.id, commande.id],
      );
    }

    await conn.query('UPDATE commandes SET statut = ? WHERE id = ?', [statut, commande.id]);

    // ---------- JOURNAL ----------
    // Dans la transaction : la trace et l'action partagent le même sort.
    const action = ACTION_PAR_STATUT[statut] || 'commande_modifiee';

    await journal.enregistrer(conn, req, {
      action,
      objet: { type: 'commande', id: commande.id, libelle: commande.reference },
      avant: { statut: commande.statut, stock_decremente: !!commande.stock_decremente },
      apres: {
        statut,
        stock_decremente: statut === 'confirmee' ? true : statut === 'annulee' ? false : undefined,
      },
      // Le résumé par défaut ne connaît pas « rouverte », et ne dirait
      // rien du stock remué ni du montant. On l'écrit donc nous-mêmes.
      resume: construireResume(req, statut, commande, mouvements),
    });

    await conn.commit();

    // ---------- COURRIEL AU CLIENT ----------
    // APRÈS la validation, jamais pendant.
    //
    // C'est l'inverse de la règle du journal, et c'est voulu : si le
    // serveur de messagerie est injoignable, la commande doit rester
    // confirmée. Le changement de statut est acquis, le courriel est
    // un supplément. On n'attend donc pas son issue pour répondre.
    notifierClient(commande.id, statut).catch((e) =>
      console.error('✉️  Notification client impossible :', e.message),
    );

    res.status(200).json({
      message: 'Statut mis à jour.',
      statut,
      reference: commande.reference,
      traite_par: premiereConfirmation ? (req.utilisateur?.id ?? null) : commande.traite_par,
    });
  } catch (error) {
    await conn.rollback();
    console.error('❌ Erreur mise à jour statut :', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour.', error: error.message });
  } finally {
    conn.release();
  }
};

// ----------------------------------------------------------
//  NOTIFICATION DU CLIENT
// ----------------------------------------------------------

/** Colonne qui note la date d'envoi, pour chaque étape */
const COLONNE_MAIL = {
  confirmee: 'mail_confirmee_le',
  expediee: 'mail_expediee_le',
  livree: 'mail_livree_le',
  annulee: 'mail_annulee_le',
};

/**
 * Envoie au client le courriel correspondant à l'étape atteinte.
 *
 * Deux garde-fous :
 *   la colonne de date empêche le double envoi, un gestionnaire
 *   qui clique deux fois ne produit qu'un seul message ;
 *   une commande sans adresse électronique est simplement ignorée,
 *   ce n'est pas une erreur.
 *
 * Ne lève jamais : l'appelant a déjà répondu au gestionnaire.
 */
async function notifierClient(idCommande, statut) {
  const colonne = COLONNE_MAIL[statut];
  if (!colonne) return; // en_attente : rien à annoncer

  const [[commande]] = await db.query(
    `SELECT id, reference, jeton_suivi, nom, prenom, email, telephone,
            adresse_livraison, mode_paiement, total, ${colonne} AS deja_envoye
       FROM commandes WHERE id = ?`,
    [idCommande],
  );

  if (!commande) return;
  if (!commande.email) return;
  if (commande.deja_envoye) {
    console.log(`✉️  ${commande.reference} : courriel « ${statut} » déjà envoyé, ignoré.`);
    return;
  }

  const [articles] = await db.query(
    `SELECT designation, ref, vehicule, quantite, montant
       FROM commande_articles WHERE id_commande = ? ORDER BY id`,
    [idCommande],
  );

  const parti = await mailsCommande.envoyerSuivi(statut, {
    ...commande,
    total: Number(commande.total) || 0,
    articles: articles.map((a) => ({ ...a, montant: Number(a.montant) || 0 })),
  });

  // La date n'est posée qu'en cas de succès : un échec réseau doit
  // pouvoir être rattrapé par un nouveau clic.
  if (parti) {
    await db.query(`UPDATE commandes SET ${colonne} = NOW() WHERE id = ?`, [idCommande]);
  }
}

/** Phrase lisible par le responsable, dans la page de suivi */
function construireResume(req, statut, commande, mouvements) {
  const auteur = journal.auteurDepuis(req).nom;
  const montant = Number(commande.total || 0).toLocaleString('fr-FR');

  const verbes = {
    confirmee: 'a confirmé',
    expediee: 'a expédié',
    annulee: 'a annulé',
    livree: 'a marqué comme livrée',
    en_attente: 'a remis en attente',
  };

  let phrase = `${auteur} ${verbes[statut] || 'a modifié'} la commande ${commande.reference}`;

  if (statut === 'confirmee' || statut === 'annulee') {
    phrase += ` (${montant} FCFA`;
    if (mouvements.length) {
      const sens = statut === 'confirmee' ? 'déstockée' : 'restituée';
      phrase += `, ${mouvements.length} ligne${mouvements.length > 1 ? 's' : ''} ${sens}`;
    }
    phrase += ')';
  }

  return phrase.slice(0, 255);
}

// ==========================================================
//  GET /api/panier/commandes?statut=en_attente   (gestion)
//  `stock_suffisant` prévient le gestionnaire avant qu'il ne
//  tente une confirmation impossible.
// ==========================================================
exports.getCommandes = async (req, res) => {
  try {
    const { statut, traite_par } = req.query;

    let sql = `
      SELECT
        c.id, c.reference, c.statut, c.mode_paiement, c.total, c.nb_articles,
        c.date_commande, c.telephone, c.email, c.adresse_livraison, c.commentaire,
        c.stock_decremente, c.traite_par, c.date_traitement,
        CONCAT_WS(' ', g.prenom, g.nom) AS gestionnaire,
        CONCAT_WS(' ', c.prenom, c.nom) AS client,
        (c.id_user IS NOT NULL) AS avec_compte,
        NOT EXISTS (
          SELECT 1 FROM commande_articles ca
          LEFT JOIN pieces p ON p.id = ca.id_piece
          WHERE ca.id_commande = c.id
            AND (p.id IS NULL OR p.quantite < ca.quantite)
        ) AS stock_suffisant
      FROM commandes c
      LEFT JOIN users g ON g.id = c.traite_par
      WHERE 1 = 1`;
    const params = [];

    if (statut) {
      sql += ' AND c.statut = ?';
      params.push(statut);
    }

    // Permet à un gestionnaire de n'afficher que ses commandes
    if (traite_par) {
      sql += ' AND c.traite_par = ?';
      params.push(traite_par);
    }

    sql +=
      " ORDER BY FIELD(c.statut, 'en_attente', 'confirmee', 'livree', 'annulee'), c.date_commande DESC";

    const [commandes] = await db.query(sql, params);

    if (commandes.length === 0) return res.status(200).json([]);

    // Articles de toutes les commandes en une seule requête
    const ids = commandes.map((c) => c.id);
    const [articles] = await db.query(
      `SELECT ca.*, p.quantite AS stock_actuel
       FROM commande_articles ca
       LEFT JOIN pieces p ON p.id = ca.id_piece
       WHERE ca.id_commande IN (?)
       ORDER BY ca.id`,
      [ids],
    );

    const parCommande = new Map(ids.map((id) => [id, []]));
    articles.forEach((a) => {
      parCommande.get(a.id_commande)?.push({
        ...a,
        prix_unitaire: Number(a.prix_unitaire),
        montant: Number(a.montant),
        quantite: Number(a.quantite),
        stock_actuel: a.stock_actuel === null ? null : Number(a.stock_actuel),
      });
    });

    res.status(200).json(
      commandes.map((c) => ({
        ...c,
        total: Number(c.total),
        nb_articles: Number(c.nb_articles),
        avec_compte: !!Number(c.avec_compte),
        stock_suffisant: !!Number(c.stock_suffisant),
        stock_decremente: !!Number(c.stock_decremente),
        gestionnaire: c.gestionnaire || null,
        articles: parCommande.get(c.id) || [],
      })),
    );
  } catch (error) {
    console.error('❌ Erreur liste commandes :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des commandes.' });
  }
};

// ==========================================================
//  GET /api/panier/stats   (gestion)
// ==========================================================
exports.getStatsCommandes = async (req, res) => {
  try {
    const [[s]] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(statut = 'en_attente') AS en_attente,
        SUM(statut = 'confirmee')  AS confirmees,
        SUM(statut = 'livree')     AS livrees,
        SUM(statut = 'annulee')    AS annulees,
        COALESCE(SUM(CASE WHEN statut IN ('confirmee','livree') THEN total ELSE 0 END), 0) AS chiffre_affaires,
        COALESCE(SUM(CASE WHEN statut = 'en_attente' THEN total ELSE 0 END), 0) AS en_attente_montant
      FROM commandes
    `);

    res.status(200).json({
      total: Number(s.total),
      en_attente: Number(s.en_attente),
      confirmees: Number(s.confirmees),
      livrees: Number(s.livrees),
      annulees: Number(s.annulees),
      chiffre_affaires: Number(s.chiffre_affaires),
      en_attente_montant: Number(s.en_attente_montant),
    });
  } catch (error) {
    console.error('❌ Erreur stats commandes :', error);
    res.status(500).json({ message: 'Erreur lors du calcul des statistiques.' });
  }
};
