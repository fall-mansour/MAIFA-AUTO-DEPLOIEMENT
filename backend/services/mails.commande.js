const M = require('./mail.service');

// ============================================================
//  MAIFA-AUTO — COURRIELS DE SUIVI DE COMMANDE
//
//  Trois étapes côté client :
//      Confirmée  ->  Expédiée  ->  Livrée
//  plus un message d'annulation, au ton différent.
//
//  LA FRISE EST FAITE SANS AUCUNE IMAGE.
//
//  Gmail, Outlook et la plupart des clients bloquent les images
//  par défaut. Une frise en images laisserait, à la première
//  ouverture, trois rectangles vides avec des mots en dessous.
//  Ici les pastilles sont des cellules de tableau colorées :
//  visibles immédiatement, sans aucune requête réseau.
// ============================================================

const { C } = M;

/** Les trois étapes, dans l'ordre du parcours client */
const ETAPES = [
  { cle: 'confirmee', libelle: 'Confirmée' },
  { cle: 'expediee', libelle: 'Expédiée' },
  { cle: 'livree', libelle: 'Livrée' },
];

const RANG = { confirmee: 0, expediee: 1, livree: 2 };

// ------------------------------------------------------------
//  LA FRISE
// ------------------------------------------------------------

/**
 * Pastille d'une étape.
 *
 * Outlook ignore border-radius et affichera un carré. C'est
 * acceptable : la couleur et le numéro portent l'information, la
 * forme n'est qu'un agrément.
 */
const pastille = (numero, etat) => {
  const styles = {
    faite: { fond: C.vert, texte: '#FFFFFF', bordure: C.vert },
    active: { fond: C.orange, texte: C.navy900, bordure: C.orange },
    avenir: { fond: '#FFFFFF', texte: C.mute, bordure: C.ligne },
  }[etat];

  // L'étape franchie porte une coche, les autres leur numéro
  const contenu = etat === 'faite' ? '&#10003;' : numero;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center">
      <tr>
        <td width="38" height="38" align="center" valign="middle"
            style="width:38px;height:38px;background:${styles.fond};border:2px solid ${styles.bordure};
                   border-radius:50%;color:${styles.texte};font-size:15px;font-weight:800;
                   font-family:Arial,Helvetica,sans-serif;line-height:38px;text-align:center;">
          ${contenu}
        </td>
      </tr>
    </table>`;
};

/** Trait de liaison entre deux pastilles */
const liaison = (franchi) => `
  <td style="padding:0 4px;" valign="middle">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="height:3px;line-height:3px;font-size:0;background:${franchi ? C.vert : C.ligne};">&nbsp;</td>
      </tr>
    </table>
  </td>`;

/**
 * Frise complète.
 * @param {string} etapeActive  'confirmee' | 'expediee' | 'livree'
 */
const frise = (etapeActive) => {
  const actif = RANG[etapeActive] ?? 0;

  const etatDe = (i) => (i < actif ? 'faite' : i === actif ? 'active' : 'avenir');

  const cellules = [];
  const libelles = [];

  ETAPES.forEach((e, i) => {
    cellules.push(
      `<td width="38" align="center" valign="middle" style="width:38px;">${pastille(i + 1, etatDe(i))}</td>`,
    );
    if (i < ETAPES.length - 1) cellules.push(liaison(i < actif));

    const couleur = etatDe(i) === 'avenir' ? C.mute : etatDe(i) === 'active' ? C.orange700 : C.vert;

    libelles.push(`
      <td align="center" style="padding-top:9px;font-size:12px;font-weight:700;color:${couleur};
                                 font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
        ${e.libelle}
      </td>`);
    if (i < ETAPES.length - 1) libelles.push('<td>&nbsp;</td>');
  });

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:${C.fond};border:1px solid ${C.ligne};border-radius:12px;">
      <tr>
        <td style="padding:22px 26px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>${cellules.join('')}</tr>
            <tr>${libelles.join('')}</tr>
          </table>
        </td>
      </tr>
    </table>`;
};

// ------------------------------------------------------------
//  LE RÉCAPITULATIF DES ARTICLES
// ------------------------------------------------------------

const ligneArticle = (a) => `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid ${C.ligne};vertical-align:top;">
      <strong style="font-size:14px;color:${C.texte};font-weight:600;">
        ${M.echapper(a.designation)}
      </strong>
      ${
        a.ref
          ? `<br><span style="font-size:12px;color:${C.mute};">Réf. ${M.echapper(a.ref)}</span>`
          : ''
      }
      ${
        a.vehicule
          ? `<br><span style="font-size:12px;color:${C.mute};">${M.echapper(a.vehicule)}</span>`
          : ''
      }
    </td>
    <td align="center" style="padding:12px 10px;border-bottom:1px solid ${C.ligne};font-size:14px;color:${C.dim};vertical-align:top;white-space:nowrap;">
      × ${Number(a.quantite) || 1}
    </td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.ligne};font-size:14px;font-weight:700;color:${C.texte};vertical-align:top;white-space:nowrap;">
      ${M.montant(a.montant)}
    </td>
  </tr>`;

const tableauArticles = (articles = [], total) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding-bottom:6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${C.mute};">
        Article${articles.length > 1 ? 's' : ''}
      </td>
      <td></td>
      <td></td>
    </tr>
    ${articles.map(ligneArticle).join('')}
    <tr>
      <td colspan="2" style="padding:14px 0 0;font-size:15px;font-weight:700;color:${C.navy};">
        Total
      </td>
      <td align="right" style="padding:14px 0 0;font-size:19px;font-weight:800;color:${C.navy};white-space:nowrap;">
        ${M.montant(total)}
      </td>
    </tr>
  </table>`;

// ------------------------------------------------------------
//  LE TEXTE PROPRE À CHAQUE ÉTAPE
// ------------------------------------------------------------

const MESSAGES = {
  confirmee: {
    surtitre: 'Commande confirmée',
    titre: (c) => `Votre commande ${c.reference} est confirmée`,
    corps:
      'Vos pièces sont réservées à votre nom. Nous préparons votre colis et ' +
      'vous écrirons dès qu’il partira.',
    apercu: (c) => `Votre commande ${c.reference} est confirmée et en préparation.`,
    accent: C.vert,
    accentPale: C.vert50,
  },
  expediee: {
    surtitre: 'Colis en route',
    titre: (c) => `Votre commande ${c.reference} est expédiée`,
    corps:
      'Votre colis a quitté notre atelier. Gardez votre téléphone à portée : ' +
      'le livreur vous appellera à l’approche.',
    apercu: (c) => `Votre colis ${c.reference} est en route.`,
    accent: C.orange700,
    accentPale: C.orange50,
  },
  livree: {
    surtitre: 'Commande livrée',
    titre: (c) => `Votre commande ${c.reference} vous a été remise`,
    corps:
      'Merci de votre confiance. Si une pièce ne correspond pas à votre véhicule, ' +
      'écrivez-nous rapidement, nous trouverons une solution.',
    apercu: (c) => `Votre commande ${c.reference} a bien été livrée. Merci !`,
    accent: C.vert,
    accentPale: C.vert50,
  },
  annulee: {
    surtitre: 'Commande annulée',
    titre: (c) => `Votre commande ${c.reference} a été annulée`,
    corps:
      'Si cette annulation ne vient pas de vous, répondez à ce message ou ' +
      'appelez-nous : nous reprendrons votre commande sans frais.',
    apercu: (c) => `Votre commande ${c.reference} a été annulée.`,
    accent: C.rouge,
    accentPale: C.rouge50,
  },
};

// ------------------------------------------------------------
//  LE GABARIT
// ------------------------------------------------------------

/** Lien de suivi, protégé par le jeton de la commande */
const lienSuivi = (commande) =>
  `${M.URL_FRONT}/suivi/${encodeURIComponent(commande.reference)}` +
  (commande.jeton_suivi ? `?c=${encodeURIComponent(commande.jeton_suivi)}` : '');

function gabarit(etape, commande) {
  const m = MESSAGES[etape];
  const prenom = String(commande.prenom || commande.nom || '').trim();
  const articles = commande.articles || [];

  const contenu = `
    <tr>
      <td style="padding:30px 30px 6px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${m.accent};">
          ${m.surtitre}
        </p>
        <h1 style="margin:0;font-size:22px;line-height:1.35;color:${C.navy};font-weight:800;">
          ${M.echapper(m.titre(commande))}
        </h1>
      </td>
    </tr>

    <tr>
      <td style="padding:16px 30px 0;font-size:15px;line-height:1.65;color:${C.dim};">
        ${prenom ? `Bonjour <strong style="color:${C.navy};">${M.echapper(prenom)}</strong>,<br><br>` : ''}
        ${m.corps}
      </td>
    </tr>

    ${etape !== 'annulee' ? `<tr><td style="padding:24px 30px 0;">${frise(etape)}</td></tr>` : ''}

    ${
      articles.length
        ? `<tr><td style="padding:26px 30px 0;">${tableauArticles(articles, commande.total)}</td></tr>`
        : ''
    }

    ${
      etape === 'expediee' && commande.adresse_livraison
        ? `
    <tr>
      <td style="padding:22px 30px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${m.accentPale};border:1px solid ${C.ligne};border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${m.accent};">
                Adresse de livraison
              </p>
              <p style="margin:5px 0 0;font-size:15px;color:${C.navy};font-weight:600;line-height:1.5;">
                ${M.paragraphes(commande.adresse_livraison)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
        : ''
    }

    <tr>
      <td align="center" style="padding:28px 30px 4px;">
        ${M.bouton('Suivre ma commande', lienSuivi(commande))}
      </td>
    </tr>

    <tr>
      <td style="padding:18px 30px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${M.ligneInfo('Référence', `<span style="font-family:monospace;">${M.echapper(commande.reference)}</span>`)}
          ${M.ligneInfo('Paiement', M.echapper(libellePaiement(commande.mode_paiement)))}
        </table>
      </td>
    </tr>`;

  return M.enveloppe({
    titrePage: m.titre(commande),
    apercu: m.apercu(commande),
    contenu,
    pied:
      'Vous recevez ce message parce que vous avez passé commande sur MAIFA-AUTO. ' +
      'Répondez directement à ce courriel pour nous joindre.',
  });
}

const libellePaiement = (mode) =>
  ({
    livraison: 'À la livraison',
    wave: 'Wave',
    om: 'Orange Money',
  })[mode] || 'À la livraison';

// ------------------------------------------------------------
//  VERSION TEXTE
//  Pour les clients qui n'affichent pas le HTML, et parce qu'un
//  courriel sans version texte part plus souvent en indésirable.
// ------------------------------------------------------------

function texte(etape, commande) {
  const m = MESSAGES[etape];
  const lignes = [
    m.titre(commande).toUpperCase(),
    '',
    commande.prenom ? `Bonjour ${commande.prenom},` : 'Bonjour,',
    '',
    m.corps,
    '',
  ];

  if (etape !== 'annulee') {
    const actif = RANG[etape] ?? 0;
    lignes.push(
      'Suivi : ' +
        ETAPES.map((e, i) =>
          i < actif ? `[x] ${e.libelle}` : i === actif ? `[>] ${e.libelle}` : `[ ] ${e.libelle}`,
        ).join('   '),
      '',
    );
  }

  if (commande.articles?.length) {
    lignes.push('Articles :');
    commande.articles.forEach((a) => {
      lignes.push(`  - ${a.designation} x${a.quantite} : ${M.montant(a.montant)}`);
    });
    lignes.push('', `Total : ${M.montant(commande.total)}`, '');
  }

  lignes.push(
    `Référence : ${commande.reference}`,
    `Suivre ma commande : ${lienSuivi(commande)}`,
    '',
    'MAIFA-AUTO',
  );

  return lignes.join('\n');
}

// ------------------------------------------------------------
//  ENVOI
// ------------------------------------------------------------

const SUJETS = {
  confirmee: (c) => `Commande ${c.reference} confirmée — MAIFA-AUTO`,
  expediee: (c) => `Votre colis ${c.reference} est en route — MAIFA-AUTO`,
  livree: (c) => `Commande ${c.reference} livrée — MAIFA-AUTO`,
  annulee: (c) => `Commande ${c.reference} annulée — MAIFA-AUTO`,
};

/**
 * Envoie le courriel de suivi correspondant à une étape.
 *
 * N'interrompt jamais l'appelant : une messagerie en panne ne doit
 * pas empêcher une commande d'avancer.
 *
 * @param {string} etape     confirmee | expediee | livree | annulee
 * @param {object} commande  { reference, jeton_suivi, prenom, nom, email,
 *                             total, mode_paiement, adresse_livraison, articles }
 * @returns {Promise<boolean>} true si le courriel est parti
 */
async function envoyerSuivi(etape, commande) {
  if (!MESSAGES[etape]) {
    console.warn(`✉️  Étape inconnue, aucun courriel : ${etape}`);
    return false;
  }

  if (!commande?.email) return false; // commande sans adresse : rien à faire

  return M.envoyer({
    from: `"MAIFA-AUTO" <${M.MAIL_USER}>`,
    to: commande.email,
    replyTo: M.DESTINATAIRE,
    subject: SUJETS[etape](commande),
    html: gabarit(etape, commande),
    text: texte(etape, commande),
  });
}

module.exports = {
  ETAPES,
  MESSAGES,
  frise,
  gabarit,
  texte,
  lienSuivi,
  envoyerSuivi,
};
