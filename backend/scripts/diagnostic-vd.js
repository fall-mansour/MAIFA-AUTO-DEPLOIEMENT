#!/usr/bin/env node
// ============================================================
//  MAIFA-AUTO — DIAGNOSTIC DE LA LIAISON VEHICLE DATABASES
//
//  À placer dans backend/scripts/ et à lancer depuis backend/ :
//
//      node scripts/diagnostic-vd.js
//      node scripts/diagnostic-vd.js VF3LCYHZ7JS123456
//
//  POURQUOI CE SCRIPT PLUTÔT QU'UN CURL
//
//  « Injoignable après 15 s » ne dit pas OÙ ça bloque. Entre ton
//  serveur et leur réponse il y a cinq étapes, et chacune peut
//  échouer pour une raison différente :
//
//      résolution DNS → connexion TCP → poignée TLS
//          → envoi de la requête → premier octet reçu
//
//  Ce script chronomètre les cinq. Il utilise le module https de
//  Node, pas fetch, précisément parce que fetch masque ces
//  étapes derrière un seul « timeout ».
//
//  Il teste aussi EN FORÇANT IPv4. C'est la panne silencieuse la
//  plus fréquente : un hébergement dont l'IPv6 est annoncé mais
//  ne route pas. La connexion part vers une adresse v6, n'aboutit
//  jamais, et rien ne le dit. Si la colonne IPv4 répond et pas
//  l'autre, le diagnostic est fait.
//
//  Aucune dépendance : que des modules Node.
// ============================================================

const https = require('node:https');
const dns = require('node:dns').promises;
const path = require('node:path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  /* on se fie aux variables déjà exportées */
}

const CLE = process.env.VD_CLE || '';
const HOTE = 'api.vehicledatabases.com';

// Le même réglage que le service, pour que les deux ne se
// contredisent pas. 30 s par défaut ici : le but est de MESURER
// la lenteur, donc on attend plus longtemps que la production.
const DELAI = Number(process.env.VD_DELAI_MS || 30000);

const C = {
  gras: (t) => `\x1b[1m${t}\x1b[0m`,
  vert: (t) => `\x1b[32m${t}\x1b[0m`,
  orange: (t) => `\x1b[33m${t}\x1b[0m`,
  rouge: (t) => `\x1b[31m${t}\x1b[0m`,
  gris: (t) => `\x1b[90m${t}\x1b[0m`,
};

const trait = (t = '') =>
  console.log('\n' + C.gris('─── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))));

const ligne = (l, v) => console.log('  ' + String(l).padEnd(26) + v);

const ms = (d) => (d === null ? C.gris('—') : `${d} ms`);

// ------------------------------------------------------------
//  UNE REQUÊTE, CHAQUE ÉTAPE CHRONOMÉTRÉE
// ------------------------------------------------------------
function sonder(chemin, { famille = 0, avecCle = true } = {}) {
  return new Promise((resoudre) => {
    const t0 = Date.now();
    const temps = { dns: null, tcp: null, tls: null, premierOctet: null, total: null };

    const options = {
      hostname: HOTE,
      path: chemin,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeout: DELAI,
    };
    if (famille) options.family = famille;
    if (avecCle && CLE) options.headers['x-authkey'] = CLE;

    const req = https.request(options, (res) => {
      temps.premierOctet = Date.now() - t0;
      let corps = '';
      res.on('data', (c) => {
        if (corps.length < 2000) corps += c;
      });
      res.on('end', () => {
        temps.total = Date.now() - t0;
        resoudre({ ok: true, statut: res.statusCode, temps, corps, adresse });
      });
    });

    let adresse = null;

    req.on('socket', (socket) => {
      socket.on('lookup', () => (temps.dns = Date.now() - t0));
      socket.on('connect', () => {
        temps.tcp = Date.now() - t0;
        // Lue ICI et pas sur la réponse : à la fin le socket peut
        // déjà être rendu au pool et remoteAddress revient vide.
        adresse = socket.remoteAddress;
      });
      socket.on('secureConnect', () => (temps.tls = Date.now() - t0));
    });

    req.on('timeout', () => {
      temps.total = Date.now() - t0;
      req.destroy();
      resoudre({ ok: false, erreur: `délai de ${DELAI / 1000} s dépassé`, temps });
    });

    req.on('error', (e) => {
      temps.total = Date.now() - t0;
      resoudre({ ok: false, erreur: `${e.code || ''} ${e.message}`.trim(), temps });
    });

    req.end();
  });
}

function afficher(titre, r) {
  trait(titre);
  ligne('Résolution DNS', ms(r.temps.dns));
  ligne('Connexion TCP', ms(r.temps.tcp));
  ligne('Poignée TLS', ms(r.temps.tls));
  ligne('Premier octet reçu', ms(r.temps.premierOctet));
  ligne('Total', ms(r.temps.total));

  if (!r.ok) {
    ligne('Résultat', C.rouge('ÉCHEC : ' + r.erreur));

    // Où exactement ça s'est arrêté : c'est toute l'information.
    //
    // Le code d'erreur passe AVANT les chronos : l'événement
    // « lookup » se déclenche même quand la résolution échoue, un
    // délai mesuré ne prouve donc pas que le DNS a abouti.
    const e = r.erreur || '';

    if (/ENOTFOUND|EAI_AGAIN/.test(e)) {
      console.log(
        C.rouge('\n  → Le nom ne se résout pas depuis ce serveur.') +
          '\n    DNS injoignable ou filtré. Teste : nslookup ' +
          HOTE,
      );
    } else if (/ECONNREFUSED/.test(e)) {
      console.log(C.rouge('\n  → Connexion refusée. Un équipement ferme le port 443.'));
    } else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(e)) {
      console.log(
        C.rouge('\n  → Certificat refusé.') +
          '\n    Un proxy ou un antivirus intercepte le trafic HTTPS.',
      );
    } else if (r.temps.tcp === null) {
      console.log(
        C.rouge('\n  → DNS réussi, connexion TCP impossible.') +
          '\n    Pare-feu sortant sur le port 443, ou route IPv6 annoncée mais morte.',
      );
    } else if (r.temps.tls === null) {
      console.log(C.rouge('\n  → TCP réussi, TLS bloqué. Interception ou certificat refusé.'));
    } else {
      console.log(
        C.orange('\n  → Connexion et TLS établis, mais aucune réponse.') +
          '\n    Leur serveur a reçu la requête (ton tableau de bord le confirme)' +
          '\n    et ne renvoie rien. C’est de leur côté.',
      );
    }
    return;
  }

  const couleur = r.statut < 300 ? C.vert : r.statut < 500 ? C.orange : C.rouge;
  ligne('Code HTTP', couleur(String(r.statut)));
  ligne('Adresse jointe', r.adresse || C.gris('—'));

  console.log('\n  ' + C.gras('Réponse brute :'));
  console.log(
    (r.corps || '(vide)')
      .slice(0, 1200)
      .split('\n')
      .map((l) => '    ' + l)
      .join('\n'),
  );
}

// ------------------------------------------------------------
const aDrapeau = (d) => process.argv.slice(2).includes(d);

(async () => {
  const vinArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

  console.log('\n  ' + C.gras('Diagnostic de la liaison Vehicle Databases'));
  trait('CONFIGURATION');
  ligne('Hôte', HOTE);
  ligne('Clé dans le .env', CLE ? C.vert(`oui (${CLE.length} caractères)`) : C.rouge('ABSENTE'));
  ligne('Version de Node', process.version);

  // --- 1. Que dit le DNS ? ---
  trait('ADRESSES PUBLIÉES');
  for (const [type, fn] of [
    ['IPv4 (A)', () => dns.resolve4(HOTE)],
    ['IPv6 (AAAA)', () => dns.resolve6(HOTE)],
  ]) {
    try {
      const adrs = await fn();
      ligne(type, C.vert(adrs.join(', ')));
    } catch (e) {
      ligne(type, C.gris('aucune  ' + (e.code || '')));
    }
  }
  console.log(
    C.gris(
      '\n  Si une adresse IPv6 est publiée et que le test « défaut » échoue\n' +
        '  alors que « IPv4 forcé » réussit, c’est la cause.',
    ),
  );

  // ----------------------------------------------------------
  //  2. Sans clé d'abord : GRATUIT, et déjà très instructif.
  //
  //  Leur passerelle refuse en moins de 200 ms. Si ce test
  //  répond, le DNS, le TCP et le TLS sont bons : inutile d'aller
  //  plus loin pour diagnostiquer le réseau.
  // ----------------------------------------------------------
  afficher(
    '/info · SANS CLÉ (gratuit, teste le chemin réseau)',
    await sonder('/info', { avecCle: false }),
  );

  // ----------------------------------------------------------
  //  3. Avec clé : UN SEUL APPEL, et il COÛTE UN CRÉDIT.
  //
  //  Mesuré sur un compte Sandbox : deux appels à /info ont
  //  débité deux crédits. Leur documentation ne le dit nulle
  //  part. Ce test est donc derrière un drapeau, et ne tourne
  //  qu'une fois.
  // ----------------------------------------------------------
  if (aDrapeau('--avec-cle')) {
    afficher('/info · AVEC CLÉ (⚠ consomme 1 crédit)', await sonder('/info'));
  } else {
    trait('/info · AVEC CLÉ');
    console.log(
      C.orange('  Non lancé : cet appel consomme 1 crédit.') +
        C.gris('\n  Ajoute --avec-cle si tu veux vérifier ta clé et ton solde.'),
    );
  }

  if (aDrapeau('--ipv4')) {
    afficher('/info · IPv4 FORCÉ (⚠ consomme 1 crédit)', await sonder('/info', { famille: 4 }));
  }

  // --- 4. Le décodage lui-même, seulement si demandé ---
  if (vinArg) {
    const propre = vinArg.toUpperCase().replace(/[^A-Z0-9]/g, '');
    afficher(
      `europe-vin-decode · ${propre}`,
      await sonder(`/europe-vin-decode/v2/${encodeURIComponent(propre)}`, { famille: 4 }),
    );
  } else {
    trait('DÉCODAGE');
    console.log(
      C.gris('  Passe un VIN en argument pour tester l’endpoint de décodage :\n') +
        '    node scripts/diagnostic-vd.js VF3LCYHZ7JS123456\n' +
        C.orange('  Utilise un VRAI numéro, relevé sur une carte grise.\n') +
        C.gris('    Leur base cherche un enregistrement réel ; un VIN inventé\n') +
        C.gris('    n’y figure pas et ressort en erreur.'),
    );
  }

  console.log();
})();
