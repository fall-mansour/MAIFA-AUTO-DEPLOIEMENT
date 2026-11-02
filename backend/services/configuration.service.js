const db = require('../db');

// ============================================================
//  MAIFA-AUTO — CONFIGURATIONS DE VÉHICULES
//
//  CE SERVICE EST L'INVERSE DE CE QU'ON IMAGINE
//
//  On croit d'abord que le gestionnaire va saisir des numéros de
//  châssis pour préciser ses compatibilités. Il ne peut pas : il a
//  un carton sur une étagère, pas la voiture.
//
//  Alors c'est le CLIENT qui alimente. Chaque recherche VIN sur la
//  page d'accueil apprend une configuration, gratuitement, puisque
//  l'appel d'API a de toute façon lieu. Au bout de quelques
//  dizaines de recherches, le gestionnaire dispose d'une liste
//  déroulante de motorisations qui correspondent au parc réel de
//  ses clients, et non à un catalogue européen abstrait.
//
//  LA CLÉ : WMI + VDS, SANS L'ANNÉE
//
//  Positions 1 à 3 puis 4 à 8 du numéro de châssis. Le VDS est le
//  descripteur du véhicule, défini par chaque constructeur. On ne
//  l'interprète jamais champ par champ, on le compare : deux
//  véhicules du même constructeur avec le même VDS sont la même
//  configuration. C'est fiable dans ce sens, et SEULEMENT dans ce
//  sens. Deux VDS différents peuvent très bien prendre la même
//  pièce, ce qui explique que la jointure large ne disparaisse
//  jamais.
//
//  CE SERVICE NE DÉPEND PAS DE vin.service
//
//  C'est vin.service qui l'appelle, pas l'inverse. Aucun cycle de
//  dépendances, et ce fichier peut être supprimé sans toucher au
//  décodeur.
// ============================================================

// ------------------------------------------------------------
//  CLÉ
// ------------------------------------------------------------

/**
 * Découpe un VIN en clé de configuration.
 * @returns {{wmi: string, vds: string}|null} null si le VIN est inexploitable
 */
function clePiece(vin) {
  const v = String(vin || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (v.length !== 17) return null;
  return { wmi: v.slice(0, 3), vds: v.slice(3, 8) };
}

// ------------------------------------------------------------
//  RATTACHEMENT AU RÉFÉRENTIEL LOCAL
//
//  L'API renvoie « SKODA » et « FABIA ». Notre table modeles
//  contient peut-être « Skoda » et « Fabia II ». Il faut rapprocher
//  les deux sans jamais inventer : une configuration mal rattachée
//  ferait remonter des pièces sur le mauvais véhicule, ce qui est
//  pire que pas de rattachement du tout.
//
//  Trois niveaux, du plus sûr au plus souple, et on s'arrête net
//  dès que c'est ambigu :
//
//    1. égalité après normalisation          « FABIA » = « Fabia »
//    2. un SEUL modèle commence par le nom   « FABIA » → « Fabia II »
//    3. plusieurs candidats                  on abandonne, id_modele NULL
//
//  Le cas 3 est volontaire. « GOLF » commence « Golf Plus » et
//  « Golf Sportsvan » : choisir au hasard serait une faute.
// ------------------------------------------------------------

/** Majuscules, sans accents, sans ponctuation ni espaces */
const cle = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Quelques écritures concurrentes de la même marque ou du même
 * modèle. Volontairement courte : chaque entrée est un risque de
 * faux rapprochement, on n'y met que ce qu'on a réellement vu.
 */
function variantes(nom) {
  const k = cle(nom);
  const sorties = new Set([k]);

  // Mercedes : « C-Class » chez eux, « Classe C » chez nous
  const classe = k.match(/^CLASS([A-Z])$/) || k.match(/^([A-Z])CLASS$/);
  if (classe) sorties.add('CLASSE' + classe[1]).add(classe[1] + 'CLASSE');

  // Volkswagen abrégé dans certaines réponses
  if (k === 'VW') sorties.add('VOLKSWAGEN');
  if (k === 'VOLKSWAGEN') sorties.add('VW');

  // Mercedes avec ou sans Benz
  if (k === 'MERCEDESBENZ') sorties.add('MERCEDES');
  if (k === 'MERCEDES') sorties.add('MERCEDESBENZ');

  return [...sorties];
}

// Index du référentiel, chargé une fois puis gardé en mémoire.
// Les marques et modèles changent rarement, et une erreur de
// chargement ne doit pas faire échouer un décodage : on retombe
// simplement sur id_modele à NULL.
const INDEX_TTL_MS = 10 * 60 * 1000;
let index = null;
let indexDate = 0;

async function chargerIndex(connexion = db) {
  if (index && Date.now() - indexDate < INDEX_TTL_MS) return index;

  try {
    const [lignes] = await connexion.query(
      `SELECT mo.id, mo.modele, ma.nom AS marque
         FROM modeles mo
         JOIN marques ma ON ma.id = mo.id_marque`,
    );

    // marque normalisée → [{ id, cleModele }]
    const parMarque = new Map();

    for (const l of lignes) {
      const km = cle(l.modele);
      for (const vm of variantes(l.marque)) {
        if (!parMarque.has(vm)) parMarque.set(vm, []);
        parMarque.get(vm).push({ id: l.id, cleModele: km });
      }
    }

    index = parMarque;
    indexDate = Date.now();
    return index;
  } catch (erreur) {
    console.warn('Configurations : référentiel illisible —', erreur.message);
    return null;
  }
}

/** Force le rechargement, à appeler si le référentiel est modifié */
function invaliderIndex() {
  index = null;
  indexDate = 0;
}

/**
 * @returns {Promise<number|null>} l'id du modèle local, ou null si
 *          rien ne correspond ou si plusieurs correspondent
 */
async function trouverModele(marque, modele, connexion = db) {
  if (!marque || !modele) return null;

  const idx = await chargerIndex(connexion);
  if (!idx) return null;

  let candidats = null;
  for (const vm of variantes(marque)) {
    if (idx.has(vm)) {
      candidats = idx.get(vm);
      break;
    }
  }
  if (!candidats || !candidats.length) return null;

  for (const vmod of variantes(modele)) {
    // 1. égalité exacte
    const exacts = candidats.filter((c) => c.cleModele === vmod);
    if (exacts.length === 1) return exacts[0].id;
    if (exacts.length > 1) return null; // référentiel ambigu, on s'abstient

    // 2. un seul modèle local commence par le nom décodé
    if (vmod.length >= 3) {
      const prefixes = candidats.filter((c) => c.cleModele.startsWith(vmod));
      if (prefixes.length === 1) return prefixes[0].id;
    }
  }

  // 3. ambigu ou inconnu
  return null;
}

// ------------------------------------------------------------
//  APPRENTISSAGE
// ------------------------------------------------------------

/**
 * Enregistre ou enrichit une configuration à partir d'un décodage.
 *
 * NE LÈVE JAMAIS D'EXCEPTION. Le décodage d'un VIN est le chemin
 * critique de la page d'accueil : il ne doit pas casser parce que
 * la table est absente ou la base indisponible.
 *
 * SUR LA PLAGE D'ANNÉES
 *
 * Elle n'est élargie que par un millésime CERTAIN. Le code année
 * du VIN (position 10) tourne sur trente ans : « A » est 1980 ou
 * 2010. Élargir avec un millésime ambigu produirait une Fabia
 * « 1980-2012 », c'est-à-dire une plage qui ne filtre plus rien.
 *
 * @param {string} vin      le numéro de châssis complet
 * @param {object} decode   le retour de vin.service.decoder()
 * @param {object} options  { compter } compter la vue (client) ou non (gestion)
 * @returns {Promise<number|null>} l'id de la configuration, ou null
 */
async function apprendre(vin, decode, { compter = true, connexion = db } = {}) {
  try {
    const k = clePiece(vin);
    if (!k) return null;

    // Sans marque il n'y a rien à apprendre : une ligne
    // « TMB+FA25J, inconnu » n'aiderait personne et occuperait la
    // clé unique, empêchant un apprentissage ultérieur correct.
    if (!decode || !decode.marque) return null;

    const d = decode.details || {};

    // Millésime retenu seulement s'il est certain
    const annee =
      decode.annee_certaine && Number.isInteger(decode.annee) && decode.annee >= 1980
        ? decode.annee
        : null;

    const idModele = await trouverModele(decode.marque, decode.modele, connexion);

    const [resultat] = await connexion.query(
      `INSERT INTO vehicule_configuration
         (wmi, vds, marque, modele, motorisation, carburant, boite,
          puissance, carrosserie, portes, annee_min, annee_max,
          id_modele, source, vues)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         -- COALESCE dans cet ordre : une donnée nouvelle remplace
         -- une absence, mais une absence n'efface jamais une donnée
         -- déjà connue. Un décodage dégradé n'appauvrit donc pas
         -- une configuration déjà renseignée.
         marque       = COALESCE(VALUES(marque),       marque),
         modele       = COALESCE(VALUES(modele),       modele),
         motorisation = COALESCE(VALUES(motorisation), motorisation),
         carburant    = COALESCE(VALUES(carburant),    carburant),
         boite        = COALESCE(VALUES(boite),        boite),
         puissance    = COALESCE(VALUES(puissance),    puissance),
         carrosserie  = COALESCE(VALUES(carrosserie),  carrosserie),
         portes       = COALESCE(VALUES(portes),       portes),
         id_modele    = COALESCE(VALUES(id_modele),    id_modele),

         -- LEAST et GREATEST rendent NULL dès qu'un argument l'est,
         -- d'où le double COALESCE : chaque borne se compare à
         -- elle-même quand l'autre valeur manque.
         annee_min = LEAST(
           COALESCE(annee_min, VALUES(annee_min)),
           COALESCE(VALUES(annee_min), annee_min)
         ),
         annee_max = GREATEST(
           COALESCE(annee_max, VALUES(annee_max)),
           COALESCE(VALUES(annee_max), annee_max)
         ),

         -- La source ne régresse pas vers 'local'
         source = IF(VALUES(source) = 'local', source, VALUES(source)),

         vues = vues + VALUES(vues),
         id   = LAST_INSERT_ID(id)`,
      [
        k.wmi,
        k.vds,
        decode.marque || null,
        decode.modele || null,
        d.motorisation || null,
        d.carburant || null,
        d.boite || null,
        d.puissance || null,
        d.carrosserie || null,
        d.portes != null ? String(d.portes) : null,
        annee,
        annee,
        idModele,
        decode.source || 'local',
        compter ? 1 : 0,
      ],
    );

    return resultat.insertId || null;
  } catch (erreur) {
    // Table absente : la migration n'a pas encore été passée, et le
    // décodage doit continuer de fonctionner sans elle.
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('Configurations : apprentissage impossible —', erreur.message);
    }
    return null;
  }
}

// ------------------------------------------------------------
//  LECTURE, POUR L'ÉCRAN DE GESTION
// ------------------------------------------------------------

/**
 * Le libellé que lit le gestionnaire. Construit ici et non stocké
 * en base : le jour où on veut une autre présentation, aucune
 * migration n'est nécessaire.
 *
 *   « 1.4 TDI · diesel · 2010-2012 »
 */
function libelle(c) {
  const morceaux = [];

  if (c.motorisation) morceaux.push(c.motorisation);
  else if (c.carrosserie) morceaux.push(c.carrosserie);

  if (c.carburant) morceaux.push(c.carburant);
  if (c.boite) morceaux.push(c.boite);

  const annees =
    c.annee_min && c.annee_max
      ? c.annee_min === c.annee_max
        ? String(c.annee_min)
        : `${c.annee_min}-${c.annee_max}`
      : null;
  if (annees) morceaux.push(annees);

  // Dernier recours : aucune caractéristique lisible n'est connue,
  // on montre le code plutôt qu'une ligne vide. Rare, et au moins
  // le gestionnaire voit qu'il y a quelque chose.
  return morceaux.length ? morceaux.join(' · ') : `${c.wmi}${c.vds}`;
}

/**
 * Lecture commune.
 *
 * LEFT JOIN sur le référentiel pour rendre AUSSI ses libellés à
 * lui. L'API renvoie « SKODA » et « FABIA », le référentiel dit
 * « Skoda » et « Fabia II » : c'est l'écriture du référentiel que
 * le gestionnaire doit lire, sinon le même véhicule apparaît sous
 * deux orthographes dans un seul écran.
 *
 * Le LEFT est indispensable : une configuration orpheline a
 * id_modele à NULL et doit rester visible, précisément pour qu'on
 * sache qu'elle manque au référentiel.
 */
const SELECT_CONFIG = `
  SELECT vc.id, vc.wmi, vc.vds, vc.marque, vc.modele, vc.motorisation,
         vc.carburant, vc.boite, vc.puissance, vc.carrosserie, vc.portes,
         vc.annee_min, vc.annee_max, vc.id_modele, vc.source, vc.vues,
         mo.modele  AS ref_modele,
         ma.nom     AS ref_marque
    FROM vehicule_configuration vc
    LEFT JOIN modeles mo ON mo.id = vc.id_modele
    LEFT JOIN marques ma ON ma.id = mo.id_marque`;

/** Ajoute le libellé calculé et les noms d'affichage retenus */
const habiller = (l) => ({
  ...l,
  libelle: libelle(l),
  affiche_marque: l.ref_marque || l.marque,
  affiche_modele: l.ref_modele || l.modele,
  rattachable: Boolean(l.id_modele),
});

/**
 * Les configurations proposées dans la liste déroulante.
 *
 * Triées par nombre de vues : les véhicules que ses clients
 * conduisent réellement arrivent en premier.
 *
 * @param {object} filtres { id_modele } ou { marque }
 */
async function lister(filtres = {}, connexion = db) {
  const conditions = [];
  const valeurs = [];

  if (filtres.id_modele) {
    conditions.push('vc.id_modele = ?');
    valeurs.push(filtres.id_modele);
  } else if (filtres.marque) {
    // Comparaison souple, et sur les DEUX écritures : le
    // gestionnaire tape le nom du référentiel, la table garde
    // celui de l'API.
    conditions.push('(UPPER(vc.marque) = UPPER(?) OR UPPER(ma.nom) = UPPER(?))');
    valeurs.push(filtres.marque, filtres.marque);
  }

  try {
    const [lignes] = await connexion.query(
      `${SELECT_CONFIG}
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY vc.vues DESC,
                 vc.motorisation IS NULL,
                 vc.motorisation,
                 vc.annee_min`,
      valeurs,
    );

    return lignes.map(habiller);
  } catch (erreur) {
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('Configurations : lecture impossible —', erreur.message);
    }
    return [];
  }
}

/** Une configuration par son identifiant, avec son libellé */
async function parId(id, connexion = db) {
  try {
    const [lignes] = await connexion.query(`${SELECT_CONFIG} WHERE vc.id = ?`, [id]);
    if (!lignes.length) return null;
    return habiller(lignes[0]);
  } catch (erreur) {
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('Configurations : lecture impossible —', erreur.message);
    }
    return null;
  }
}

/**
 * Comptages pour l'écran de gestion.
 *
 * `orphelines` est le chiffre qui compte : ce sont des véhicules
 * que des clients ont réellement cherchés et que le gestionnaire ne
 * peut PAS rattacher, faute de marque ou de modèle correspondant
 * dans le référentiel. C'est une liste de travail, pas une anomalie.
 */
async function statistiques(connexion = db) {
  try {
    const [[s]] = await connexion.query(
      `SELECT COUNT(*)                                  AS total,
              SUM(id_modele IS NOT NULL)                AS rattachees,
              SUM(id_modele IS NULL)                    AS orphelines,
              COALESCE(SUM(vues), 0)                    AS recherches
         FROM vehicule_configuration`,
    );

    return {
      total: Number(s.total || 0),
      rattachees: Number(s.rattachees || 0),
      orphelines: Number(s.orphelines || 0),
      recherches: Number(s.recherches || 0),
    };
  } catch (erreur) {
    if (erreur.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('Configurations : synthèse impossible —', erreur.message);
    }
    return { total: 0, rattachees: 0, orphelines: 0, recherches: 0 };
  }
}

/**
 * Rattrapage : rattache au référentiel local les configurations
 * restées à id_modele NULL.
 *
 * Utile après un enrichissement de la table marques ou modeles. Une
 * configuration apprise alors que la marque manquait chez nous
 * peut alors trouver sa place sans qu'un client ait à revenir.
 *
 * @returns {Promise<{examinees: number, rattachees: number}>}
 */
async function rattacherOrphelines(connexion = db) {
  invaliderIndex();

  try {
    const [lignes] = await connexion.query(
      `SELECT id, marque, modele
         FROM vehicule_configuration
        WHERE id_modele IS NULL
          AND marque IS NOT NULL
          AND modele IS NOT NULL`,
    );

    let rattachees = 0;

    for (const l of lignes) {
      const idModele = await trouverModele(l.marque, l.modele, connexion);
      if (!idModele) continue;

      await connexion.query('UPDATE vehicule_configuration SET id_modele = ? WHERE id = ?', [
        idModele,
        l.id,
      ]);
      rattachees++;
    }

    return { examinees: lignes.length, rattachees };
  } catch (erreur) {
    console.warn('Configurations : rattrapage impossible —', erreur.message);
    return { examinees: 0, rattachees: 0 };
  }
}

module.exports = {
  clePiece,
  apprendre,
  lister,
  parId,
  libelle,
  statistiques,
  trouverModele,
  rattacherOrphelines,
  invaliderIndex,
};
