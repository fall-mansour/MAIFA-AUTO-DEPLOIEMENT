const db = require('../db');
const bcrypt = require('bcrypt');
const { signerJeton, expirationJeton, roleEffectif } = require('../middleware/auth');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  console.log('🔑 Tentative de connexion pour :', email);

  try {
    const [users] = await db.execute('SELECT * FROM users WHERE mail = ?', [email]);

    if (users.length === 0) {
      console.log('❌ Utilisateur non trouvé dans la base.');
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log('❌ Mot de passe incorrect.');
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Role reellement accorde : role en base ET liste blanche
    const role = roleEffectif(user);

    console.log('✅ Connexion réussie pour', user.prenom, `(${role})`);

    // Jeton signé, valable 2h par défaut (JWT_DUREE dans le .env)
    const token = signerJeton(user);

    const userData = {
      id: user.id,
      prenom: user.prenom,
      nom: user.nom,
      mail: user.mail,
      role,
      avatar: user.avatar,
      telephone: user.telephone,
      adresse: user.adresse,
      vehicule: user.marque_vehicule
        ? `${user.marque_vehicule} ${user.modele_vehicule}`
        : 'Non spécifié',
    };

    return res.status(200).json({
      message: 'Connexion réussie !',
      token,
      expiration: expirationJeton(token),
      user: userData,
    });
  } catch (error) {
    console.error('🔥 Erreur Login :', error);
    return res.status(500).json({ message: 'Erreur technique sur le serveur.' });
  }
};

/**
 * GET /api/connexion/moi
 * Permet au front de vérifier que la session est encore valable
 * au démarrage de l'application.
 */
exports.moi = async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, nom, prenom, mail, role, telephone, adresse FROM users WHERE id = ?',
      [req.utilisateur.id],
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Compte introuvable.', code: 'JETON_INVALIDE' });
    }

    res.status(200).json({ user: { ...users[0], role: roleEffectif(users[0]) } });
  } catch (error) {
    console.error('🔥 Erreur /moi :', error);
    res.status(500).json({ message: 'Erreur technique sur le serveur.' });
  }
};

// ==========================================================
//  POST /api/connexion/google
//  Le front envoie le jeton d'identité renvoyé par Google.
//  On le vérifie auprès de Google avant toute écriture.
// ==========================================================
const { OAuth2Client } = require('google-auth-library');
const clientGoogle = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.loginGoogle = async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ message: 'Jeton Google manquant.' });
  }

  try {
    // Vérification de la signature et de l'audience par la bibliothèque Google.
    // Sans cette étape, n'importe qui pourrait envoyer un faux jeton.
    const ticket = await clientGoogle.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const profil = ticket.getPayload();

    // On refuse une adresse non vérifiée : sinon quelqu'un pourrait
    // récupérer un compte existant en déclarant l'email d'un autre.
    if (!profil.email_verified) {
      return res.status(403).json({ message: 'Adresse Google non vérifiée.' });
    }

    const googleId = profil.sub;
    const email = profil.email;

    // 1. Compte déjà lié à ce Google
    let [rows] = await db.execute('SELECT * FROM users WHERE google_id = ?', [googleId]);
    let user = rows[0];

    // 2. Compte existant avec la même adresse : on rattache
    if (!user) {
      [rows] = await db.execute('SELECT * FROM users WHERE mail = ?', [email]);
      user = rows[0];

      if (user) {
        await db.execute(
          'UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?',
          [googleId, profil.picture || null, user.id],
        );
        user.google_id = googleId;
        console.log('🔗 Compte existant rattaché à Google :', email);
      }
    }

    // 3. Création du compte
    if (!user) {
      const [creation] = await db.execute(
        `INSERT INTO users (nom, prenom, mail, google_id, avatar, password)
         VALUES (?, ?, ?, ?, ?, NULL)`,
        [
          profil.family_name || profil.name || 'Client',
          profil.given_name || '',
          email,
          googleId,
          profil.picture || null,
        ],
      );

      [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [creation.insertId]);
      user = rows[0];
      console.log('✨ Nouveau compte créé via Google :', email);
    }

    const token = signerJeton(user);

    return res.status(200).json({
      message: 'Connexion réussie !',
      token,
      expiration: expirationJeton(token),
      // profil_incomplet : le front peut inviter à compléter le véhicule
      profil_incomplet: !user.telephone || !user.marque_vehicule,
      user: {
        id: user.id,
        prenom: user.prenom,
        nom: user.nom,
        mail: user.mail,
        role: roleEffectif(user),
        telephone: user.telephone,
        adresse: user.adresse,
        avatar: user.avatar,
        vehicule: user.marque_vehicule
          ? `${user.marque_vehicule} ${user.modele_vehicule || ''}`.trim()
          : 'Non spécifié',
      },
    });
  } catch (error) {
    console.error('🔥 Erreur connexion Google :', error.message);
    return res.status(401).json({ message: 'Jeton Google invalide ou expiré.' });
  }
};
