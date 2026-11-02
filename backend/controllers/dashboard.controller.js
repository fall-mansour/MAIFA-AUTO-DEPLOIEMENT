const db = require('../db');

const SEUIL_DEFAUT = 3;

/** Les 12 derniers mois au format YYYY-MM, du plus ancien au plus récent */
const douzeDerniersMois = () => {
  const mois = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    mois.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return mois;
};

/**
 * Nombre sûr. Une valeur absente vaut 0, jamais NaN.
 *
 * Indispensable depuis que les blocs peuvent échouer isolément :
 * sans ce filet, un bloc manquant afficherait « NaN » sur une
 * tuile du tableau de bord.
 */
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ============================================================
//  LES ONZE BLOCS DU TABLEAU DE BORD
//
//  Nommés, pour que l'erreur dise lequel a lâché. « Erreur Stats
//  Dashboard » suivi d'une trace de trente lignes ne désigne rien.
// ============================================================
const BLOCS = [
  // 1. Vue d'ensemble du stock
  {
    nom: 'stock',
    sql: `
      SELECT
        COUNT(*)                                          AS references_total,
        COALESCE(SUM(quantite), 0)                        AS unites,
        COALESCE(SUM(prix * quantite), 0)                 AS valeur,
        COALESCE(ROUND(AVG(prix)), 0)                     AS prix_moyen,
        SUM(CASE WHEN LOWER(etat) = 'neuf' THEN 1 ELSE 0 END)     AS neuf,
        SUM(CASE WHEN LOWER(etat) = 'occasion' THEN 1 ELSE 0 END) AS occasion,
        SUM(CASE WHEN quantite = 0 THEN 1 ELSE 0 END)             AS ruptures,
        SUM(CASE WHEN quantite > 0 AND quantite <= COALESCE(seuil_alerte, ${SEUIL_DEFAUT})
                 THEN 1 ELSE 0 END)                               AS stock_faible
      FROM pieces
    `,
  },

  // 2. Répartition par catégorie
  {
    nom: 'catégories',
    sql: `
      SELECT
        COALESCE(categorie, 'Non classée')  AS nom,
        COUNT(*)                            AS nb,
        COALESCE(SUM(quantite), 0)          AS unites,
        COALESCE(SUM(prix * quantite), 0)   AS valeur
      FROM pieces
      GROUP BY COALESCE(categorie, 'Non classée')
      ORDER BY nb DESC
    `,
  },

  // 3. Clients
  {
    nom: 'clients',
    sql: `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN date_creacomte >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS nouveaux_30j,
        SUM(CASE WHEN marque_vehicule IS NOT NULL AND marque_vehicule <> '' THEN 1 ELSE 0 END) AS avec_vehicule
      FROM users
    `,
  },

  // ----------------------------------------------------------
  //  4. Parc automobile des clients, et couverture par le stock
  //
  //  RÉÉCRITE. La version précédente lisait u.marque_vehicule
  //  dans le EXISTS alors que le groupement portait sur
  //  UPPER(TRIM(u.marque_vehicule)). MySQL 8 la refuse avec
  //  l'erreur 1055, ONLY_FULL_GROUP_BY étant actif par défaut
  //  chez lui et pas chez MariaDB.
  //
  //  Ce n'était pas du zèle : « Renault » et « RENAULT » tombent
  //  dans le même groupe, et MariaDB prenait l'une des deux AU
  //  HASARD pour évaluer le EXISTS. L'indicateur « couverte »
  //  pouvait donc changer d'un affichage à l'autre.
  //
  //  L'agrégation passe dans une table dérivée, et le EXISTS
  //  corrèle sur la clé de groupement déjà calculée. Déterministe,
  //  et valide sous MySQL comme sous MariaDB.
  // ----------------------------------------------------------
  {
    nom: 'parc clients',
    sql: `
      SELECT
        m.marque,
        m.nb_clients,
        EXISTS (
          SELECT 1
            FROM pieces p
            JOIN piece_compatibilite pc ON pc.id_piece = p.id
            JOIN modeles mo ON mo.id = pc.id_modele
            JOIN marques ma ON ma.id = mo.id_marque
           WHERE UPPER(TRIM(ma.nom)) = m.marque
             AND p.quantite > 0
        ) AS couverte
      FROM (
        SELECT UPPER(TRIM(u.marque_vehicule)) AS marque,
               COUNT(*)                       AS nb_clients
          FROM users u
         WHERE u.marque_vehicule IS NOT NULL
           AND TRIM(u.marque_vehicule) <> ''
         GROUP BY UPPER(TRIM(u.marque_vehicule))
      ) AS m
      ORDER BY m.nb_clients DESC
      LIMIT 8
    `,
  },

  // 5. Référentiel véhicules
  {
    nom: 'référentiel',
    sql: `
      SELECT
        (SELECT COUNT(*) FROM marques)             AS marques,
        (SELECT COUNT(*) FROM modeles)             AS modeles,
        (SELECT COUNT(*) FROM piece_compatibilite) AS compatibilites,
        (SELECT COUNT(DISTINCT ma.id)
           FROM marques ma
           JOIN modeles mo ON mo.id_marque = ma.id
           JOIN piece_compatibilite pc ON pc.id_modele = mo.id) AS marques_couvertes
    `,
  },

  // 6. Ajouts des 12 derniers mois
  {
    nom: 'évolution',
    sql: `
      SELECT
        DATE_FORMAT(date_ajout, '%Y-%m')  AS mois,
        COUNT(*)                          AS nb,
        COALESCE(SUM(prix * quantite), 0) AS valeur
      FROM pieces
      WHERE date_ajout >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
      GROUP BY DATE_FORMAT(date_ajout, '%Y-%m')
      ORDER BY mois
    `,
  },

  // 7. Marques les mieux fournies en stock
  {
    nom: 'top marques',
    sql: `
      SELECT ma.nom AS marque, COUNT(DISTINCT p.id) AS nb
      FROM pieces p
      JOIN piece_compatibilite pc ON pc.id_piece = p.id
      JOIN modeles mo ON mo.id = pc.id_modele
      JOIN marques ma ON ma.id = mo.id_marque
      GROUP BY ma.nom
      ORDER BY nb DESC
      LIMIT 6
    `,
  },

  // 8. Dernières pièces ajoutées
  {
    nom: 'dernières pièces',
    sql: `
      SELECT id, ref, description, categorie, prix, quantite, etat, img_principale, date_ajout
      FROM pieces
      ORDER BY date_ajout DESC, id DESC
      LIMIT 5
    `,
  },

  // 9. Pièces sans véhicule rattaché
  //    Dépend de la VUE v_pieces_a_rattacher. Si elle n'a pas été
  //    recréée sur la base distante, ce bloc seul tombera, et le
  //    journal le nommera.
  { nom: 'pièces orphelines', sql: `SELECT COUNT(*) AS nb FROM v_pieces_a_rattacher` },

  // 10. Activité commerciale
  {
    nom: 'commandes',
    sql: `
      SELECT
        COUNT(*)                        AS total,
        SUM(statut = 'en_attente')      AS en_attente,
        SUM(statut = 'confirmee')       AS confirmees,
        SUM(statut = 'livree')          AS livrees,
        SUM(statut = 'annulee')         AS annulees,
        COALESCE(SUM(CASE WHEN statut = 'en_attente' THEN total ELSE 0 END), 0) AS montant_attente,
        COALESCE(SUM(CASE WHEN statut IN ('confirmee','livree') THEN total ELSE 0 END), 0) AS chiffre_affaires,
        SUM(date_commande >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS nouvelles_30j
      FROM commandes
    `,
  },

  // 11. Dernières commandes reçues
  {
    nom: 'dernières commandes',
    sql: `
      SELECT
        c.id, c.reference, c.statut, c.total, c.nb_articles, c.date_commande,
        CONCAT_WS(' ', c.prenom, c.nom) AS client,
        c.telephone
      FROM commandes c
      ORDER BY c.date_commande DESC
      LIMIT 5
    `,
  },
];

// ============================================================
//  GET /api/dashboard/stats
// ============================================================
exports.getStats = async (req, res) => {
  try {
    // --------------------------------------------------------
    //  allSettled, ET NON all.
    //
    //  Promise.all rejette dès la première requête en échec et
    //  jette les dix autres, qui avaient pourtant abouti. Une
    //  vue manquante ou une incompatibilité SQL ne rendait donc
    //  pas un tableau de bord incomplet : elle le tuait tout
    //  entier, et le journal montrait une erreur sans dire
    //  laquelle des onze requêtes l'avait provoquée.
    //
    //  Avec allSettled, chaque bloc tombe seul, nommément, et les
    //  autres s'affichent.
    // --------------------------------------------------------
    const resultats = await Promise.allSettled(BLOCS.map((b) => db.query(b.sql)));

    const indisponibles = [];

    /** Les lignes d'un bloc, ou un tableau vide s'il a échoué */
    const lignes = (i) => {
      const r = resultats[i];
      if (r.status === 'fulfilled') return r.value[0] || [];

      indisponibles.push(BLOCS[i].nom);
      console.error(
        `⚠️  Dashboard — bloc « ${BLOCS[i].nom} » indisponible : ${r.reason?.message || r.reason}`,
      );
      return [];
    };

    /** La première ligne d'un bloc, ou un objet vide */
    const ligne = (i) => lignes(i)[0] || {};

    const stock = ligne(0);
    const categories = lignes(1);
    const clients = ligne(2);
    const parcClients = lignes(3);
    const referentiel = ligne(4);
    const evolution = lignes(5);
    const topMarques = lignes(6);
    const dernieres = lignes(7);
    const orphelines = ligne(8);
    const commandes = ligne(9);
    const dernieresCommandes = lignes(10);

    // --- Évolution : on comble les mois sans ajout ---
    const parMois = new Map(evolution.map((e) => [e.mois, e]));
    const serie = douzeDerniersMois().map((mois) => ({
      mois,
      nb: n(parMois.get(mois)?.nb),
      valeur: n(parMois.get(mois)?.valeur),
    }));

    // --- Compteurs par catégorie, format historique ---
    // L'ancien dashboard attend stats.motorisation, stats.freinage, etc.
    const legacy = {
      motorisation: 0,
      transmission: 0,
      freinage: 0,
      suspension: 0,
      carrosserie: 0,
      electronique: 0,
    };
    categories.forEach((c) => {
      const cat = String(c.nom).toLowerCase();
      const nb = n(c.nb);
      if (cat.includes('motor') || cat.includes('moteur')) legacy.motorisation += nb;
      else if (cat.includes('transm')) legacy.transmission += nb;
      else if (cat.includes('frein')) legacy.freinage += nb;
      else if (cat.includes('suspens')) legacy.suspension += nb;
      else if (cat.includes('carros')) legacy.carrosserie += nb;
      else if (cat.includes('electro') || cat.includes('électro')) legacy.electronique += nb;
    });

    if (indisponibles.length) {
      console.warn(
        `⚠️  Dashboard rendu avec ${indisponibles.length} bloc(s) manquant(s) : ` +
          indisponibles.join(', '),
      );
    }

    res.status(200).json({
      // --- Rétrocompatibilité avec l'ancienne interface StatsPieces ---
      total: n(stock.references_total),
      ...legacy,

      // --- Vue d'ensemble ---
      stock: {
        references: n(stock.references_total),
        unites: n(stock.unites),
        valeur: n(stock.valeur),
        prix_moyen: n(stock.prix_moyen),
        neuf: n(stock.neuf),
        occasion: n(stock.occasion),
      },

      alertes: {
        ruptures: n(stock.ruptures),
        stock_faible: n(stock.stock_faible),
        sans_compatibilite: n(orphelines.nb),
        seuil: SEUIL_DEFAUT,
      },

      clients: {
        total: n(clients.total),
        nouveaux_30j: n(clients.nouveaux_30j),
        avec_vehicule: n(clients.avec_vehicule),
      },

      referentiel: {
        marques: n(referentiel.marques),
        modeles: n(referentiel.modeles),
        compatibilites: n(referentiel.compatibilites),
        marques_couvertes: n(referentiel.marques_couvertes),
      },

      categories: categories.map((c) => ({
        nom: c.nom,
        nb: n(c.nb),
        unites: n(c.unites),
        valeur: n(c.valeur),
      })),

      evolution: serie,

      top_marques: topMarques.map((m) => ({ marque: m.marque, nb: n(m.nb) })),

      parc_clients: parcClients.map((p) => ({
        marque: p.marque,
        nb_clients: n(p.nb_clients),
        couverte: !!n(p.couverte),
      })),

      dernieres: dernieres.map((p) => ({
        ...p,
        prix: n(p.prix),
        quantite: n(p.quantite),
      })),

      commandes: {
        total: n(commandes.total),
        en_attente: n(commandes.en_attente),
        confirmees: n(commandes.confirmees),
        livrees: n(commandes.livrees),
        annulees: n(commandes.annulees),
        montant_attente: n(commandes.montant_attente),
        chiffre_affaires: n(commandes.chiffre_affaires),
        nouvelles_30j: n(commandes.nouvelles_30j),
      },

      dernieres_commandes: dernieresCommandes.map((c) => ({
        ...c,
        total: n(c.total),
        nb_articles: n(c.nb_articles),
      })),

      // Les blocs qui ont échoué, pour que l'interface puisse le
      // signaler au lieu d'afficher des zéros silencieux.
      _indisponibles: indisponibles,
    });
  } catch (error) {
    // Ne devrait plus se produire : allSettled ne rejette pas.
    // Le filet reste, pour une panne du pool ou une erreur de code.
    console.error('Erreur Stats Dashboard:', error);
    res.status(500).json({ error: 'Erreur serveur lors du calcul des statistiques' });
  }
};
