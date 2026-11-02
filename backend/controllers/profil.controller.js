const db = require('../db');
const bcrypt = require('bcrypt');

// ⚠️ Si ton projet utilise bcryptjs, remplace la ligne ci-dessus par :
// const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/** Champs renvoyes au front : jamais le mot de passe, meme hache */
const CHAMPS_PUBLICS = `id, prenom, nom, mail, role, telephone, adresse,
                        marque_vehicule, modele_vehicule, annee, avatar,
                        google_id, date_creacomte,
                        (password IS NOT NULL) AS a_mot_de_passe`;

const formatUser = (row) => ({
  ...row,
  annee: row.annee !== null ? Number(row.annee) : null,
  a_mot_de_passe: !!Number(row.a_mot_de_passe),
  // Un compte Google n'a pas forcement de mot de passe : le front
  // propose alors d'en definir un, sans demander l'ancien
  compte_google: !!row.google_id,
});

// ==========================================================
//  GET /api/profil
//  L'identifiant vient du JETON, jamais de l'URL : sinon
//  n'importe qui pourrait lire le profil d'un autre client.
// ==========================================================
exports.getProfil = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT ${CHAMPS_PUBLICS} FROM users WHERE id = ?`, [
      req.utilisateur.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Compte introuvable.' });
    }

    res.status(200).json({ user: formatUser(rows[0]) });
  } catch (error) {
    console.error('❌ Erreur GET profil :', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du profil.' });
  }
};

// ==========================================================
//  PUT /api/profil
//  Informations personnelles et vehicule.
//
//  Ni le role ni l'email ne figurent ici : le premier ne se
//  change qu'en base, le second exige le mot de passe.
// ==========================================================
const CHAMPS_MODIFIABLES = {
  prenom: (v) => {
    const t = String(v ?? '').trim();
    if (!t) throw new Error('Le prénom est obligatoire.');
    if (t.length > 100) throw new Error('Prénom trop long.');
    return t;
  },
  nom: (v) => {
    const t = String(v ?? '').trim();
    if (!t) throw new Error('Le nom est obligatoire.');
    if (t.length > 100) throw new Error('Nom trop long.');
    return t;
  },
  telephone: (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    const chiffres = t.replace(/\D/g, '');
    if (chiffres.length < 9) throw new Error('Le numéro de téléphone semble incomplet.');
    return t;
  },
  adresse: (v) => String(v ?? '').trim() || null,
  marque_vehicule: (v) => String(v ?? '').trim() || null,
  modele_vehicule: (v) => String(v ?? '').trim() || null,
  annee: (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    const max = new Date().getFullYear() + 1;
    if (!Number.isInteger(n) || n < 1950 || n > max) {
      throw new Error(`L'année doit être comprise entre 1950 et ${max}.`);
    }
    return n;
  },
};

exports.majProfil = async (req, res) => {
  try {
    const colonnes = [];
    const valeurs = [];

    for (const [champ, valider] of Object.entries(CHAMPS_MODIFIABLES)) {
      if (req.body[champ] === undefined) continue;
      try {
        valeurs.push(valider(req.body[champ]));
        colonnes.push(`\`${champ}\` = ?`);
      } catch (e) {
        return res.status(400).json({ message: e.message, champ });
      }
    }

    if (colonnes.length === 0) {
      return res.status(400).json({ message: 'Aucune information à mettre à jour.' });
    }

    await db.query(`UPDATE users SET ${colonnes.join(', ')} WHERE id = ?`, [
      ...valeurs,
      req.utilisateur.id,
    ]);

    const [rows] = await db.query(`SELECT ${CHAMPS_PUBLICS} FROM users WHERE id = ?`, [
      req.utilisateur.id,
    ]);

    console.log(
      `✏️  Profil mis à jour (${req.utilisateur.mail}) : ` +
        colonnes.map((c) => c.split('`')[1]).join(', '),
    );

    res.status(200).json({ message: 'Profil mis à jour.', user: formatUser(rows[0]) });
  } catch (error) {
    console.error('❌ Erreur PUT profil :', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du profil.' });
  }
};

// ==========================================================
//  PUT /api/profil/email
//  Changer d'adresse exige le mot de passe : c'est l'identifiant
//  de connexion, et une session volee ne doit pas permettre de
//  s'approprier definitivement le compte.
// ==========================================================
exports.changerEmail = async (req, res) => {
  const { nouveau_mail, password } = req.body;

  if (!nouveau_mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nouveau_mail)) {
    return res.status(400).json({ message: 'Adresse email invalide.' });
  }

  try {
    const [rows] = await db.query('SELECT password, google_id FROM users WHERE id = ?', [
      req.utilisateur.id,
    ]);

    if (rows.length === 0) return res.status(404).json({ message: 'Compte introuvable.' });

    const user = rows[0];

    // Un compte sans mot de passe (cree via Google) ne peut pas
    // changer d'adresse : elle vient de Google
    if (!user.password) {
      return res.status(403).json({
        message:
          'Votre compte est lié à Google. Définissez d’abord un mot de passe pour pouvoir changer d’adresse.',
        code: 'SANS_MOT_DE_PASSE',
      });
    }

    if (!password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Mot de passe incorrect.', champ: 'password' });
    }

    const mail = String(nouveau_mail).trim().toLowerCase();

    const [existe] = await db.query('SELECT id FROM users WHERE mail = ? AND id <> ?', [
      mail,
      req.utilisateur.id,
    ]);
    if (existe.length > 0) {
      return res.status(409).json({ message: 'Cette adresse est déjà utilisée.' });
    }

    await db.query('UPDATE users SET mail = ? WHERE id = ?', [mail, req.utilisateur.id]);

    const [maj] = await db.query(`SELECT ${CHAMPS_PUBLICS} FROM users WHERE id = ?`, [
      req.utilisateur.id,
    ]);

    console.log(`📧 Adresse changée : ${req.utilisateur.mail} → ${mail}`);

    // Le jeton porte l'ancienne adresse : le front doit reconnecter
    res.status(200).json({
      message: 'Adresse mise à jour. Reconnectez-vous avec votre nouvelle adresse.',
      user: formatUser(maj[0]),
      reconnexion_requise: true,
    });
  } catch (error) {
    console.error('❌ Erreur changement email :', error);
    res.status(500).json({ message: "Erreur lors du changement d'adresse." });
  }
};

// ==========================================================
//  PUT /api/profil/motdepasse
//  Deux cas :
//    - compte classique : ancien mot de passe exige
//    - compte Google sans mot de passe : premiere definition
// ==========================================================
exports.changerMotDePasse = async (req, res) => {
  const { ancien, nouveau } = req.body;

  if (!nouveau || String(nouveau).length < 6) {
    return res.status(400).json({
      message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.',
      champ: 'nouveau',
    });
  }

  try {
    const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.utilisateur.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Compte introuvable.' });

    const actuel = rows[0].password;

    // Compte classique : on verifie l'ancien mot de passe
    if (actuel) {
      if (!ancien) {
        return res.status(400).json({
          message: 'Saisissez votre mot de passe actuel.',
          champ: 'ancien',
        });
      }
      if (!(await bcrypt.compare(ancien, actuel))) {
        return res.status(401).json({ message: 'Mot de passe actuel incorrect.', champ: 'ancien' });
      }
      if (await bcrypt.compare(nouveau, actuel)) {
        return res.status(400).json({
          message: 'Le nouveau mot de passe doit être différent de l’ancien.',
          champ: 'nouveau',
        });
      }
    }

    const hash = await bcrypt.hash(String(nouveau), SALT_ROUNDS);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.utilisateur.id]);

    console.log(`🔑 Mot de passe ${actuel ? 'modifié' : 'défini'} pour ${req.utilisateur.mail}`);

    res.status(200).json({
      message: actuel
        ? 'Mot de passe modifié.'
        : 'Mot de passe défini. Vous pouvez désormais vous connecter sans Google.',
      a_mot_de_passe: true,
    });
  } catch (error) {
    console.error('❌ Erreur changement mot de passe :', error);
    res.status(500).json({ message: 'Erreur lors du changement de mot de passe.' });
  }
};
