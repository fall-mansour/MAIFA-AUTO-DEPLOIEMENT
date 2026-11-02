const nodemailer = require('nodemailer');

// ============================================================
//  MAIFA-AUTO — COUCHE D'ENVOI PARTAGÉE
//
//  Tout ce qui est commun à nos courriels : le transporteur, la
//  palette, l'échappement, l'enveloppe visuelle.
//
//  Les gabarits eux-mêmes vivent ailleurs. Ce fichier ne sait pas
//  ce qu'il envoie, il sait seulement l'envoyer et l'habiller.
//
//  Variables du .env :
//    MAIL_USER=adresse@gmail.com
//    MAIL_PASS=xxxx xxxx xxxx xxxx     (mot de passe d'application)
//    MAIL_DESTINATAIRE=adresse@gmail.com
//    LOGO_URL=https://res.cloudinary.com/.../logo-horizontal.png
//    URL_FRONT=https://maifa-auto.sn
// ============================================================

const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const DESTINATAIRE = process.env.MAIL_DESTINATAIRE || MAIL_USER;
const LOGO_URL = process.env.LOGO_URL || '';
const URL_FRONT = (process.env.URL_FRONT || 'http://localhost:4200').replace(/\/+$/, '');

const CONFIGURE = Boolean(MAIL_USER && MAIL_PASS);

if (!CONFIGURE) {
  console.warn(
    '✉️  MAIL_USER ou MAIL_PASS absent du .env : aucun courriel ne partira. ' +
      'Le reste de l application fonctionne normalement.',
  );
}

// Transporteur créé une seule fois, et non à chaque requête
const transporter = CONFIGURE
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: MAIL_USER, pass: MAIL_PASS },
    })
  : null;

// ============================================================
//  PALETTE DU LOGO
//  Les clients de messagerie ignorent les feuilles de style :
//  tout est écrit en attributs style, et la mise en page utilise
//  des tableaux, seule structure fiable dans Gmail et Outlook.
// ============================================================
const C = {
  navy: '#12314B',
  navy900: '#081724',
  navy600: '#1B4A6F',
  orange: '#F2762E',
  orange700: '#C25317',
  orange50: '#FFF4ED',
  texte: '#12314B',
  dim: '#435A76',
  mute: '#647489',
  ligne: '#DFE5EE',
  fond: '#F6F8FB',
  vert: '#077F55',
  vert50: '#ECFDF5',
  rouge: '#CC1F1F',
  rouge50: '#FEF2F2',
};

// ============================================================
//  OUTILS DE TEXTE
// ============================================================

/**
 * Échappe les caractères HTML.
 * Sans cela, un visiteur qui écrit <a href="..."> dans un champ
 * libre glisse un lien dans le courriel.
 */
const echapper = (valeur) =>
  String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Conserve les retours à la ligne */
const paragraphes = (texte) => echapper(texte).replace(/\r?\n/g, '<br>');

/** Numéro au format international, pour les liens tel: et WhatsApp */
const numeroInternational = (tel) => {
  const chiffres = String(tel || '').replace(/\D/g, '');
  if (!chiffres) return '';
  return chiffres.startsWith('221') ? chiffres : `221${chiffres}`;
};

/** Montant en francs CFA, séparateurs insécables */
const montant = (valeur) =>
  `${Number(valeur || 0)
    .toLocaleString('fr-FR')
    .replace(/ | /g, ' ')} FCFA`;

/** Un sujet de courriel ne doit jamais contenir de retour à la ligne */
const sujetPropre = (texte) =>
  String(texte || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();

// ============================================================
//  BRIQUES VISUELLES
// ============================================================

/**
 * En-tête de marque. Sans logo hébergé, on reproduit le mot-symbole
 * en texte : MAIFA en blanc, AUTO en orange, comme sur le logo.
 * Une image locale serait invisible pour le destinataire.
 */
const entete = () =>
  LOGO_URL
    ? `<img src="${LOGO_URL}" alt="MAIFA-AUTO" height="40" style="display:block;height:40px;border:0;">`
    : `<span style="font-size:26px;font-weight:800;letter-spacing:-0.5px;">
         <span style="color:#FFFFFF;">MAIFA</span><span style="color:${C.orange};">-AUTO</span>
       </span>`;

/** Une ligne libellé / valeur d'un tableau d'informations */
const ligneInfo = (libelle, valeur) => `
  <tr>
    <td style="padding:9px 0;border-bottom:1px solid ${C.ligne};font-size:13px;color:${C.mute};width:130px;vertical-align:top;">
      ${libelle}
    </td>
    <td style="padding:9px 0;border-bottom:1px solid ${C.ligne};font-size:14px;color:${C.texte};font-weight:600;">
      ${valeur || `<span style="color:${C.mute};font-weight:400;">Non renseigné</span>`}
    </td>
  </tr>`;

/** Bouton d'action. Pas de <button>, aucun client ne le stylerait. */
const bouton = (libelle, lien, { fond = C.orange, texte = C.navy900 } = {}) => `
  <a href="${lien}"
     style="display:inline-block;padding:13px 26px;border-radius:99px;background:${fond};
            color:${texte};font-size:15px;font-weight:700;text-decoration:none;">
    ${libelle}
  </a>`;

/**
 * Enveloppe commune : en-tête bleu nuit, bandeau orange, contenu,
 * pied de page.
 *
 * Le bloc caché en haut est l'aperçu affiché dans la liste des
 * courriels, avant ouverture. Sans lui, Gmail y recopie le premier
 * texte trouvé, souvent le mot « MAIFA-AUTO » répété.
 */
const enveloppe = ({ titrePage, apercu, contenu, pied }) => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${echapper(titrePage)}</title>
</head>
<body style="margin:0;padding:0;background:${C.fond};font-family:Arial,Helvetica,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${echapper(apercu)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:${C.fond};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid ${C.ligne};">

          <tr>
            <td style="background:${C.navy900};background-image:linear-gradient(135deg,${C.navy900},${C.navy} 60%,${C.navy600});padding:26px 30px;">
              ${entete()}
            </td>
          </tr>

          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:${C.orange};">&nbsp;</td>
          </tr>

          ${contenu}

          <tr>
            <td style="padding:26px 30px 28px;">
              <p style="margin:0;padding-top:18px;border-top:1px solid ${C.ligne};font-size:12px;line-height:1.6;color:${C.mute};">
                ${pied}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ============================================================
//  ENVOI
// ============================================================

/**
 * Envoie un courriel, sans jamais interrompre l'appelant.
 *
 * C'est délibéré, et c'est l'inverse de la règle du journal. Si le
 * serveur de messagerie est injoignable, une commande confirmée doit
 * le rester : le changement de statut est acquis, le courriel est un
 * supplément. L'échec part dans la console, pas au gestionnaire.
 *
 * @returns {Promise<boolean>} true si le courriel est parti
 */
async function envoyer({ to, subject, html, text, replyTo, from }) {
  if (!CONFIGURE) {
    console.warn(`✉️  Courriel non envoyé (messagerie non configurée) : ${subject}`);
    return false;
  }

  if (!to) {
    // Un client sans compte n'a pas toujours donné d'adresse.
    // Ce n'est pas une erreur, simplement rien à faire.
    return false;
  }

  try {
    await transporter.sendMail({
      from: from || `"MAIFA-AUTO" <${MAIL_USER}>`,
      to,
      replyTo: replyTo || undefined,
      subject: sujetPropre(subject),
      html,
      text,
    });
    console.log(`✉️  Courriel envoyé à ${to} : ${sujetPropre(subject)}`);
    return true;
  } catch (erreur) {
    console.error(`❌ Courriel non parti vers ${to} :`, erreur.message);
    return false;
  }
}

/** Même envoi, mais qui lève en cas d'échec. Pour les routes qui en dépendent. */
async function envoyerOuEchouer(options) {
  if (!CONFIGURE) {
    throw new Error('Service de messagerie non configuré.');
  }
  const parti = await envoyer(options);
  if (!parti) throw new Error("Impossible d'envoyer le courriel.");
  return true;
}

module.exports = {
  C,
  CONFIGURE,
  MAIL_USER,
  DESTINATAIRE,
  URL_FRONT,
  echapper,
  paragraphes,
  numeroInternational,
  montant,
  sujetPropre,
  entete,
  ligneInfo,
  bouton,
  enveloppe,
  envoyer,
  envoyerOuEchouer,
};
