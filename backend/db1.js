const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
require('dotenv').config();

// ============================================================
//  MAIFA-AUTO — CONNEXION À LA BASE AIVEN
//
//  Fichier séparé de db.js, pour un déploiement provisoire. Le
//  jour où tu abandonnes Aiven, tu supprimes ce fichier et la
//  ligne d'aiguillage en tête de db.js, et rien d'autre ne bouge.
//
//  TROIS DIFFÉRENCES AVEC db.js, ET AUCUNE N'EST COSMÉTIQUE
//
//  1. TLS OBLIGATOIRE. Aiven refuse les connexions en clair.
//     Le client mysql en ligne de commande négocie TLS tout
//     seul, ce qui explique que ta console fonctionne ; mysql2,
//     lui, se connecte sans chiffrement par défaut et se fait
//     fermer la porte.
//
//  2. MOINS DE CONNEXIONS. Le plan gratuit d'Aiven plafonne le
//     nombre de connexions simultanées bien plus bas qu'un MySQL
//     local. Un pool de 10, plus les reconnexions, suffit à le
//     saturer et à sortir des « Too many connections » qui n'ont
//     rien à voir avec ton code.
//
//  3. SURVIE AUX COUPURES. Aiven ferme les connexions inactives,
//     et un hébergement gratuit met le serveur en veille. Sans
//     keep-alive, la première requête après une pause échoue sur
//     une connexion morte que le pool croit vivante.
// ============================================================

// ------------------------------------------------------------
//  LE CERTIFICAT
//
//  Aiven signe ses serveurs avec une autorité qui lui est propre,
//  absente du magasin de certificats du système. Vérifier
//  l'identité du serveur exige donc de lui fournir ce certificat.
//
//  Où le trouver : console Aiven, ta service MySQL, onglet
//  Overview, « CA Certificate », bouton de téléchargement. Place
//  le fichier dans backend/certs/aiven-ca.pem.
//
//  Sans lui, deux issues, et aucune n'est bonne :
//    rejectUnauthorized à true  → échec « self signed certificate
//                                  in certificate chain »
//    rejectUnauthorized à false → ça marche, et plus personne ne
//                                  vérifie à qui il parle
//
//  Le second est tentant un vendredi soir. C'est précisément
//  ainsi qu'on expédie en production une connexion que n'importe
//  quel intermédiaire peut lire.
// ------------------------------------------------------------
//  DEUX FAÇONS DE LE FOURNIR
//
//  Par fichier, en développement : backend/certs/aiven-ca.pem
//
//  Par variable d'environnement, en production : AIVEN_CA_PEM.
//  Les hébergements gratuits ne donnent pas d'accès au système de
//  fichiers, et y déposer un fichier suppose de le committer. Ce
//  certificat étant public, le committer serait acceptable ; la
//  variable évite simplement d'avoir à y penser, et permet de le
//  remplacer sans redéployer quand il expirera en 2035.
//
//  Sur Render, colle le contenu du .pem tel quel, retours à la
//  ligne compris, dans une variable d'environnement multiligne.
// ------------------------------------------------------------
const CHEMIN_CA = process.env.DB_CA || path.join(__dirname, 'certs', 'aiven-ca.pem');

let ssl;

if (process.env.AIVEN_CA_PEM) {
  // Certains panneaux remplacent les retours à la ligne par \n
  // littéraux au passage. On rétablit, sinon le PEM est illisible
  // et l'erreur qui en sort ne ressemble à rien.
  ssl = {
    ca: process.env.AIVEN_CA_PEM.replace(/\\n/g, '\n'),
    rejectUnauthorized: true,
  };
  console.log("🔒 Certificat Aiven chargé depuis l'environnement");
} else if (fs.existsSync(CHEMIN_CA)) {
  ssl = {
    ca: fs.readFileSync(CHEMIN_CA),
    rejectUnauthorized: true,
  };
  console.log(`🔒 Certificat Aiven chargé : ${path.basename(CHEMIN_CA)}`);
} else {
  // On continue, pour ne pas bloquer une mise au point, mais on
  // le dit assez fort pour que ça ne parte pas en production.
  ssl = { rejectUnauthorized: false };
  console.warn(
    '\n⚠️  CERTIFICAT AIVEN ABSENT\n' +
      `   Attendu ici : ${CHEMIN_CA}\n` +
      "   La connexion est chiffrée mais l'identité du serveur n'est PAS vérifiée.\n" +
      '   Télécharge le CA depuis la console Aiven avant toute mise en ligne.\n',
  );
}

// ------------------------------------------------------------
//  LE POOL
// ------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.AIVEN_DB_HOST,
  user: process.env.AIVEN_DB_USER,
  password: process.env.AIVEN_DB_PASSWORD,
  database: process.env.AIVEN_DB_NAME,
  port: process.env.AIVEN_DB_PORT || 3306,

  ssl,

  waitForConnections: true,
  // Volontairement bas. Voir le point 2 de l'en-tête.
  connectionLimit: Number(process.env.AIVEN_DB_POOL || 5),
  queueLimit: 0,

  // Une requête qui n'aboutit pas en 15 s sur une base distante
  // n'aboutira pas. Mieux vaut rendre une erreur au client que
  // de le laisser devant une page qui tourne.
  connectTimeout: 15000,

  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// ------------------------------------------------------------
//  TEST AU DÉMARRAGE
//
//  Même principe que dans db.js, avec un diagnostic : sur une
//  base distante, « ERREUR DB » tout court ne dit pas s'il s'agit
//  du mot de passe, du certificat, du pare-feu ou d'une faute de
//  frappe dans le nom d'hôte.
// ------------------------------------------------------------
pool.getConnection((err, connexion) => {
  if (!err) {
    console.log(
      `✅ AIVEN CONNECTÉ : ${process.env.AIVEN_DB_NAME} sur ${process.env.AIVEN_DB_HOST}`,
    );
    connexion.release();
    return;
  }

  console.error('❌ ERREUR AIVEN :', err.message);

  const indices = {
    ER_ACCESS_DENIED_ERROR:
      'Identifiant ou mot de passe refusé. Vérifie AIVEN_DB_USER et AIVEN_DB_PASSWORD.',
    ER_BAD_DB_ERROR: `La base « ${process.env.AIVEN_DB_NAME} » n'existe pas sur ce service.`,
    ENOTFOUND: "Nom d'hôte introuvable. Vérifie AIVEN_DB_HOST, il se termine par .aivencloud.com",
    ETIMEDOUT: 'Aucune réponse. Port bloqué par un pare-feu, ou AIVEN_DB_PORT incorrect.',
    ECONNREFUSED: 'Connexion refusée. Le service Aiven est peut-être en pause.',
    HANDSHAKE_NO_SSL_SUPPORT: 'Le serveur refuse TLS, ce qui ne devrait pas arriver chez Aiven.',
  };

  const indice =
    indices[err.code] ||
    (/self.signed|unable to verify/i.test(err.message)
      ? 'Certificat non vérifiable : télécharge le CA Aiven dans backend/certs/aiven-ca.pem'
      : null);

  if (indice) console.error('   →', indice);
});

module.exports = pool.promise();

//Local connexion

const mysql = require('mysql2');
require('dotenv').config();

//A la place const pool
const pool1 = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test de connexion automatique
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ ERREUR DB :', err.message);
  } else {
    console.log(`✅ BASE DE DONNÉES CONNECTÉE : ${process.env.DB_NAME}`);
    connection.release();
  }
});

module.exports = pool.promise();
