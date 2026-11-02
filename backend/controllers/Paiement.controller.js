const db = require('../db');
const paytech = require('../services/paytech.service');

// ==========================================================
//  POST /api/paiement/initier
//  Corps : { reference } — la reference de la commande
//
//  Le montant est TOUJOURS relu en base. Si le navigateur
//  envoyait le prix, il suffirait de le modifier pour payer
//  une commande de 950 000 FCFA avec 100 FCFA.
// ==========================================================
exports.initierPaiement = async (req, res) => {
  const { reference, methode } = req.body;

  if (!reference) {
    return res.status(400).json({ message: 'Référence de commande manquante.' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM commandes WHERE reference = ?', [reference]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const commande = rows[0];

    // La commande doit appartenir a l'utilisateur connecte.
    // Sans ce controle, on pourrait payer, ou consulter, la commande d'un autre.
    if (!commande.id_user || commande.id_user !== req.utilisateur?.id) {
      return res.status(403).json({
        message: 'Le paiement en ligne est réservé au titulaire de la commande.',
        code: 'NON_AUTORISE',
      });
    }

    if (commande.statut_paiement === 'paye') {
      return res.status(409).json({
        message: 'Cette commande est déjà payée.',
        code: 'DEJA_PAYEE',
      });
    }

    if (commande.statut === 'annulee') {
      return res.status(409).json({ message: 'Cette commande a été annulée.' });
    }

    const mode = methode || commande.mode_paiement;
    if (!paytech.METHODES[mode]) {
      return res.status(400).json({
        message: 'Mode de paiement non pris en charge par PayTech.',
      });
    }

    // Reference unique par TENTATIVE : PayTech refuse une ref_command
    // deja utilisee, et un client peut abandonner puis recommencer.
    const refTentative = `${commande.reference}-${Date.now().toString(36).toUpperCase()}`;

    const nbArticles = Number(commande.nb_articles) || 1;
    const libelle = `Commande ${commande.reference} — ${nbArticles} article${nbArticles > 1 ? 's' : ''}`;

    const paiement = await paytech.demanderPaiement({
      montant: Number(commande.total),
      refCommande: refTentative,
      libelle,
      description: `MAIFA-AUTO — ${libelle}`,
      methode: mode,
      donnees: {
        id_commande: commande.id,
        reference: commande.reference,
        id_user: commande.id_user,
      },
      client: {
        telephone: commande.telephone,
        nom: [commande.prenom, commande.nom].filter(Boolean).join(' '),
      },
    });

    await db.query(
      `UPDATE commandes
       SET statut_paiement = 'en_attente',
           paytech_ref = ?,
           paytech_token = ?,
           mode_paiement = ?
       WHERE id = ?`,
      [refTentative, paiement.token, mode, commande.id],
    );

    console.log(`💳 Paiement initié : ${refTentative} (${commande.total} FCFA, ${paiement.env})`);

    res.status(200).json({
      message: 'Paiement initié.',
      url: paiement.url,
      token: paiement.token,
      env: paiement.env,
      // En test, PayTech debite un montant aleatoire de 100 a 150 FCFA
      avertissement:
        paiement.env === 'test'
          ? 'Mode test : le montant débité sera aléatoire entre 100 et 150 FCFA.'
          : null,
    });
  } catch (error) {
    console.error('❌ Erreur initiation paiement :', error.message);
    res.status(500).json({ message: error.message || 'Impossible d’initier le paiement.' });
  }
};

// ==========================================================
//  POST /api/paiement/ipn
//  Appele par PayTech, jamais par le navigateur.
//
//  C'est la SEULE source de verite : un client peut fermer son
//  navigateur apres avoir paye, l'URL de succes ne serait alors
//  jamais atteinte alors que l'argent est bien parti.
// ==========================================================
exports.notificationPaytech = async (req, res) => {
  const corps = req.body || {};
  const signatureOk = paytech.verifierNotification(corps);
  const donnees = paytech.lireDonnees(corps.custom_field);

  // On journalise AVANT de traiter, signature valide ou non : une
  // notification rejetee est soit une erreur de configuration, soit
  // une tentative de fraude, et les deux doivent laisser une trace.
  try {
    await db.query(
      `INSERT INTO paiements_journal
        (id_commande, paytech_ref, token, type_event, methode, montant,
         client_phone, env, signature_ok, charge_utile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        donnees.id_commande || null,
        corps.ref_command || null,
        corps.token || null,
        corps.type_event || null,
        corps.payment_method || null,
        corps.final_item_price || corps.item_price || null,
        corps.client_phone || null,
        corps.env || null,
        signatureOk ? 1 : 0,
        JSON.stringify(corps),
      ],
    );
  } catch (e) {
    console.error('⚠️ Journalisation IPN impossible :', e.message);
  }

  if (!signatureOk) {
    console.warn('🚨 IPN REJETÉE, signature invalide :', corps.ref_command);
    return res.status(403).send('IPN KO');
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // On retrouve la commande par la reference de tentative, et a defaut
    // par l'identifiant transporte dans custom_field.
    const [rows] = await conn.query(
      `SELECT * FROM commandes
       WHERE paytech_ref = ? OR (? IS NOT NULL AND id = ?)
       LIMIT 1 FOR UPDATE`,
      [corps.ref_command, donnees.id_commande || null, donnees.id_commande || null],
    );

    if (rows.length === 0) {
      await conn.rollback();
      console.warn('⚠️ IPN sans commande correspondante :', corps.ref_command);
      // On repond 200 : sinon PayTech reessaiera indefiniment une
      // notification qui ne trouvera jamais sa commande.
      return res.status(200).send('IPN OK (commande inconnue)');
    }

    const commande = rows[0];

    // Notification deja traitee : PayTech peut renvoyer le meme evenement
    if (commande.statut_paiement === 'paye' && corps.type_event === 'sale_complete') {
      await conn.rollback();
      console.log(`↻ IPN déjà traitée pour ${commande.reference}`);
      return res.status(200).send('IPN OK (déjà traitée)');
    }

    if (corps.type_event === 'sale_complete') {
      const montantPaye = Number(corps.final_item_price || corps.item_price) || 0;

      await conn.query(
        `UPDATE commandes
         SET statut_paiement = 'paye',
             montant_paye = ?,
             methode_reelle = ?,
             date_paiement = NOW(),
             paytech_token = COALESCE(?, paytech_token)
         WHERE id = ?`,
        [montantPaye, corps.payment_method || null, corps.token || null, commande.id],
      );

      // Le stock reste decremente a la confirmation par le gestionnaire :
      // un paiement recu ne garantit pas que la piece est encore la.
      // La commande apparait simplement comme payee dans la liste.
      console.log(
        `💰 ${commande.reference} payée : ${montantPaye} FCFA via ${corps.payment_method}`,
      );

      // Ecart notable entre le total et le montant debite. Normal en
      // mode test, a examiner en production.
      const total = Number(commande.total);
      if (corps.env === 'prod' && Math.abs(montantPaye - total) > 1) {
        console.warn(
          `🚨 Écart de montant sur ${commande.reference} : attendu ${total}, reçu ${montantPaye}`,
        );
      }
    } else if (corps.type_event === 'sale_canceled') {
      await conn.query(`UPDATE commandes SET statut_paiement = 'echoue' WHERE id = ?`, [
        commande.id,
      ]);
      console.log(`❌ Paiement annulé pour ${commande.reference}`);
    } else if (corps.type_event === 'refund_complete') {
      await conn.query(
        `UPDATE commandes SET statut_paiement = 'rembourse', statut = 'annulee' WHERE id = ?`,
        [commande.id],
      );
      console.log(`↩️ Remboursement enregistré pour ${commande.reference}`);
    }

    await conn.commit();
    res.status(200).send('IPN OK');
  } catch (error) {
    await conn.rollback();
    console.error('❌ Erreur traitement IPN :', error);
    // 500 : PayTech reessaiera, ce qui est souhaitable ici
    res.status(500).send('IPN KO');
  } finally {
    conn.release();
  }
};

// ==========================================================
//  GET /api/paiement/statut/:reference
//  Le front interroge cette route apres le retour de PayTech,
//  pour savoir si l'IPN est arrivee.
// ==========================================================
exports.statutPaiement = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT reference, statut, statut_paiement, total, montant_paye,
              methode_reelle, date_paiement, mode_paiement
       FROM commandes WHERE reference = ? OR paytech_ref = ? LIMIT 1`,
      [req.params.reference, req.params.reference],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const c = rows[0];
    res.status(200).json({
      ...c,
      total: Number(c.total),
      montant_paye: c.montant_paye === null ? null : Number(c.montant_paye),
    });
  } catch (error) {
    console.error('❌ Erreur statut paiement :', error);
    res.status(500).json({ message: 'Erreur lors de la vérification du paiement.' });
  }
};

// ==========================================================
//  POST /api/paiement/reconcilier/:reference   (gestion)
//  Filet de securite : si une notification n'est jamais arrivee
//  (panne reseau, tunnel ferme), on interroge PayTech directement.
// ==========================================================
exports.reconcilier = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, reference, paytech_token, statut_paiement, total FROM commandes WHERE reference = ?',
      [req.params.reference],
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Commande introuvable.' });

    const commande = rows[0];
    if (!commande.paytech_token) {
      return res.status(400).json({ message: 'Aucun paiement PayTech pour cette commande.' });
    }

    const statut = await paytech.consulterStatut(commande.paytech_token);

    res.status(200).json({
      message: 'Statut PayTech récupéré.',
      commande: commande.reference,
      statut_local: commande.statut_paiement,
      statut_paytech: statut,
    });
  } catch (error) {
    console.error('❌ Erreur réconciliation :', error.message);
    res.status(500).json({ message: error.message });
  }
};

// ==========================================================
//  GET /api/paiement/retour/:issue
//  Le client revient ici depuis Wave ou Orange Money, puis est
//  renvoye vers le front.
//
//  Ce detour existe parce que les operateurs refusent une URL de
//  retour locale : le backend est publiquement joignable, le front
//  en developpement ne l'est pas.
// ==========================================================
exports.retourPaiement = (req, res) => {
  const issue = req.params.issue === 'succes' ? 'succes' : 'annule';
  const ref = req.query.ref || '';
  const front = process.env.URL_FRONT || 'http://localhost:4200';

  const destination = `${front}/panier?paiement=${issue}&ref=${encodeURIComponent(ref)}`;

  console.log(`↩️  Retour ${issue} : ${ref} → ${destination}`);

  res.redirect(302, destination);
};
