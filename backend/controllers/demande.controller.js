const M = require('../services/mail.service');

// ============================================================
//  MAIFA-AUTO — DEMANDE DE PIÈCE
//
//  Le transporteur, la palette et les fonctions d'échappement
//  vivent désormais dans services/mail.service.js, partagés avec
//  les courriels de suivi de commande. Ce fichier ne garde que
//  ce qui lui est propre : le gabarit de la demande.
// ============================================================

const { C } = M;

/** Gabarit du courriel reçu par le gestionnaire */
const gabaritDemande = (d) => {
  const intl = M.numeroInternational(d.telephone);
  const vehicule = [d.marque, d.modele].filter(Boolean).join(' ');
  const messageWa = encodeURIComponent(
    `Bonjour ${d.nom}, MAIFA-AUTO au sujet de votre demande de pièce pour ${vehicule}.`,
  );

  const contenu = `
    <tr>
      <td style="padding:28px 30px 8px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${C.orange700};">
          Nouvelle demande de pièce
        </p>
        <h1 style="margin:0;font-size:22px;line-height:1.3;color:${C.navy};">
          ${M.echapper(d.nom)} recherche une pièce
        </h1>
      </td>
    </tr>

    <tr>
      <td style="padding:16px 30px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${C.orange50};border:1px solid #F8C9A8;border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0;font-size:12px;color:${C.orange700};font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">
                Véhicule concerné
              </p>
              <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:${C.navy};">
                ${M.echapper(vehicule) || 'Non précisé'}
                ${d.annee ? `<span style="font-weight:600;color:${C.dim};"> · ${M.echapper(d.annee)}</span>` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:22px 30px 6px;">
        <h2 style="margin:0 0 10px;font-size:15px;color:${C.navy};">Description du besoin</h2>
        <div style="background:${C.fond};border-left:4px solid ${C.orange};border-radius:6px;padding:14px 16px;font-size:14px;line-height:1.6;color:${C.texte};">
          ${M.paragraphes(d.description) || `<em style="color:${C.mute};">Aucune description fournie</em>`}
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding:22px 30px 8px;">
        <h2 style="margin:0 0 6px;font-size:15px;color:${C.navy};">Coordonnées du client</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${M.ligneInfo('Nom', M.echapper(d.nom))}
          ${M.ligneInfo(
            'Email',
            d.email
              ? `<a href="mailto:${M.echapper(d.email)}" style="color:${C.orange700};text-decoration:none;">${M.echapper(d.email)}</a>`
              : '',
          )}
          ${M.ligneInfo('Téléphone', M.echapper(d.telephone))}
        </table>
      </td>
    </tr>

    ${
      intl
        ? `
    <tr>
      <td style="padding:20px 30px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:10px;">
              ${M.bouton('Répondre sur WhatsApp', `https://wa.me/${intl}?text=${messageWa}`, {
                fond: '#25D366',
                texte: '#FFFFFF',
              })}
            </td>
            <td>
              ${M.bouton('Appeler le client', `tel:+${intl}`)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`
        : ''
    }`;

  return M.enveloppe({
    titrePage: 'Nouvelle demande de pièce',
    apercu: `${d.nom} recherche une pièce pour ${vehicule || 'un véhicule non précisé'}.`,
    contenu,
    pied:
      'Courriel généré automatiquement depuis le formulaire de demande MAIFA-AUTO. ' +
      'Cliquer sur « Répondre » écrit directement au client.',
  });
};

/** Version texte, pour les clients qui n'affichent pas le HTML */
const texteDemande = (d) =>
  [
    'NOUVELLE DEMANDE DE PIECE — MAIFA-AUTO',
    '',
    `Client     : ${d.nom}`,
    `Email      : ${d.email || 'non renseigné'}`,
    `Téléphone  : ${d.telephone || 'non renseigné'}`,
    `Véhicule   : ${[d.marque, d.modele].filter(Boolean).join(' ')} ${d.annee ? '(' + d.annee + ')' : ''}`,
    '',
    'Description :',
    d.description || 'aucune',
  ].join('\n');

// ============================================================
//  POST /api/demande
// ============================================================
exports.envoyerDemande = async (req, res) => {
  const { nom, email, telephone, marque, modele, annee, description } = req.body;

  // Configuration absente : on le dit clairement plutôt que d'échouer en silence
  if (!M.CONFIGURE) {
    console.error('❌ MAIL_USER ou MAIL_PASS absent du .env');
    return res.status(500).json({ error: 'Service de messagerie non configuré.' });
  }

  if (!nom || !description || (!email && !telephone)) {
    return res.status(400).json({
      error: 'Le nom, la description et un moyen de contact sont obligatoires.',
    });
  }

  const donnees = { nom, email, telephone, marque, modele, annee, description };
  const vehicule = [marque, modele].filter(Boolean).join(' ') || 'véhicule non précisé';

  try {
    // Ici l'envoi DOIT réussir : c'est la seule trace de la demande.
    // D'où envoyerOuEchouer, qui lève, contrairement aux courriels de
    // suivi où un échec ne doit rien interrompre.
    await M.envoyerOuEchouer({
      // L'expéditeur reste TON compte : Gmail le réécrit de toute façon,
      // et usurper l'adresse du client fait échouer les contrôles
      // anti-usurpation, ce qui envoie tes propres courriels en indésirable.
      from: `"MAIFA-AUTO · Demandes" <${M.MAIL_USER}>`,
      to: M.DESTINATAIRE,
      // Répondre écrit directement au client
      replyTo: email || undefined,
      subject: `Demande de pièce : ${vehicule.toUpperCase()} — ${nom}`,
      html: gabaritDemande(donnees),
      text: texteDemande(donnees),
    });

    console.log(`✅ Demande envoyée pour ${nom} (${vehicule})`);
    res.status(200).json({ message: 'Demande envoyée avec succès' });
  } catch (error) {
    console.error('❌ Erreur Nodemailer :', error.message);
    res.status(500).json({ error: "Impossible d'envoyer l'e-mail" });
  }
};

// Exporte pour pouvoir prévisualiser le gabarit sans envoyer de courriel
exports._gabaritDemande = gabaritDemande;
