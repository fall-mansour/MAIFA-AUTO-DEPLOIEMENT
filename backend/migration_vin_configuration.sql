-- ============================================================
--  MAIFA-AUTO — RÉFÉRENTIEL DES CONFIGURATIONS DE VÉHICULES
--
--  CE QUE CETTE MIGRATION RÉSOUT
--
--  La jointure pièce/véhicule se fait aujourd'hui sur un modèle
--  du référentiel local : « cette pièce va sur une Fabia ». C'est
--  trop large, parce qu'une Fabia 1.4 diesel et une Fabia 1.9
--  diesel ne prennent pas le même turbo.
--
--  Affiner demanderait au gestionnaire une précision qu'il n'a
--  pas. Il a un carton sur une étagère, une référence fournisseur,
--  et parfois une mention sur l'emballage. Il n'a PAS le véhicule
--  sous les yeux, donc il n'a pas de numéro de châssis.
--
--  D'où le renversement : le VIN n'entre pas par la gestion, il
--  entre par le client. Chaque recherche VIN apprend une
--  configuration réelle, et c'est le gestionnaire qui en profite.
--
--  LA DIFFÉRENCE AVEC vin_cache
--
--  vin_cache est indexé sur le squish (9 caractères, année
--  comprise) parce qu'il mémorise une RÉPONSE d'API. Deux Fabia de
--  2010 et 2012 y occupent deux lignes.
--
--  Ici la clé est WMI + VDS (8 caractères, SANS l'année) parce
--  qu'on décrit une CONFIGURATION. Les deux Fabia n'en font qu'une,
--  et la plage d'années de la ligne s'élargit toute seule à mesure
--  que les clients arrivent :
--
--      1er client, Fabia 2010  →  annee_min 2010, annee_max 2010
--      2e  client, Fabia 2012  →  annee_min 2010, annee_max 2012
--      3e  client, Fabia 2011  →  inchangé, déjà dans la plage
--
--  Le référentiel ne décrit donc pas toutes les voitures d'Europe,
--  mais le parc réel des clients de Dakar. C'est exactement le
--  périmètre utile.
--
--  CE QUI EST SÛR DANS CE FICHIER
--
--  Une seule création de table, en CREATE TABLE IF NOT EXISTS.
--  Un seul ajout de colonne, sous garde : si la colonne existe
--  déjà, la commande ne s'exécute pas. Rejouer ce fichier autant
--  de fois que tu veux ne produira ni #1060 ni #1061.
--
--  Aucun DROP. Aucun INSERT. Aucune ligne existante modifiée.
-- ============================================================


-- ------------------------------------------------------------
--  1. LE RÉFÉRENTIEL
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicule_configuration (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,

  -- LA CLÉ MÉTIER. Positions 1 à 3 puis 4 à 8 du numéro de châssis.
  -- Le VDS est le « descripteur du véhicule » : modèle, carrosserie,
  -- motorisation. Son contenu exact est défini par chaque
  -- constructeur, on ne l'interprète donc JAMAIS champ par champ.
  -- On se contente de le comparer, ce qui suffit : deux véhicules du
  -- même constructeur avec le même VDS sont la même configuration.
  wmi             CHAR(3)       NOT NULL COMMENT 'Positions 1-3, le constructeur',
  vds             CHAR(5)       NOT NULL COMMENT 'Positions 4-8, le descripteur',

  -- CE QUE LE GESTIONNAIRE LIT. Il ne verra jamais wmi ni vds :
  -- il choisit « SKODA FABIA 1.4 TDI 2010-2012 » dans une liste.
  marque          VARCHAR(60)   NULL,
  modele          VARCHAR(80)   NULL,
  motorisation    VARCHAR(80)   NULL,
  carburant       VARCHAR(40)   NULL,
  boite           VARCHAR(40)   NULL,
  puissance       VARCHAR(40)   NULL,
  carrosserie     VARCHAR(60)   NULL,
  portes          VARCHAR(10)   NULL,

  -- Plage de production OBSERVÉE, pas déclarée. Élargie seulement
  -- par un millésime certain : le code année du VIN tourne sur
  -- trente ans, et un millésime ambigu étirerait la plage jusqu'en
  -- 1980 sur un véhicule de 2010.
  annee_min       SMALLINT UNSIGNED NULL,
  annee_max       SMALLINT UNSIGNED NULL,

  -- Rattachement au référentiel local (table modeles). NULL quand
  -- la marque ou le modèle renvoyé par l'API ne correspond à rien
  -- chez nous : la configuration reste utilisable, elle n'apparaît
  -- simplement pas sous la cascade marque/modèle.
  id_modele       INT UNSIGNED  NULL,

  source          VARCHAR(20)   NOT NULL DEFAULT 'local'
                                COMMENT 'local, vpic ou vehicledatabases',

  -- Combien de véhicules de cette configuration ont été recherchés.
  -- Affiché au gestionnaire : c'est l'information commerciale qu'il
  -- n'a nulle part ailleurs, elle lui dit quoi stocker.
  vues            INT UNSIGNED  NOT NULL DEFAULT 0,

  date_creation   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_vue        DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_configuration (wmi, vds),
  KEY idx_configuration_modele (id_modele),
  KEY idx_configuration_vues (vues),
  KEY idx_configuration_marque (marque, modele)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Configurations de véhicules apprises des recherches VIN clients.';


-- ------------------------------------------------------------
--  2. LE RATTACHEMENT DEPUIS piece_compatibilite
--
--  UNE SEULE colonne, nullable. Toutes tes lignes actuelles
--  restent valides avec id_configuration à NULL, et continuent de
--  se comporter exactement comme aujourd'hui.
--
--  Une ligne de compatibilité devient donc de deux natures :
--
--    id_modele seul                  compatibilité large, l'actuelle
--    id_modele + id_configuration    compatibilité précise
--
--  Pourquoi une clé étrangère vers vehicule_configuration plutôt
--  que les colonnes wmi et vds recopiées ici : la configuration
--  porte les libellés lisibles, et une correction sur un libellé
--  profite d'un coup à toutes les pièces rattachées.
--
--  GARDE D'IDEMPOTENCE : on lit information_schema avant d'agir.
--  Si la colonne est déjà là, la commande exécutée est « DO 0 »,
--  qui ne fait rien. Même mécanique pour l'index.
-- ------------------------------------------------------------

SET @colonne_existe := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND COLUMN_NAME  = 'id_configuration'
);

SET @instruction := IF(
  @colonne_existe = 0,
  'ALTER TABLE piece_compatibilite
     ADD COLUMN id_configuration INT UNSIGNED NULL
     COMMENT ''Configuration precise, NULL = compatibilite au modele''',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


SET @index_existe := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND INDEX_NAME   = 'idx_compatibilite_configuration'
);

SET @instruction := IF(
  @index_existe = 0,
  'ALTER TABLE piece_compatibilite
     ADD KEY idx_compatibilite_configuration (id_configuration)',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


-- ------------------------------------------------------------
--  VÉRIFICATION
--
--  À lancer juste après, pour voir que les deux objets sont là.
-- ------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vehicule_configuration')          AS table_creee,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'piece_compatibilite'
      AND COLUMN_NAME = 'id_configuration')               AS colonne_ajoutee;


-- ============================================================
--  CLÉ ÉTRANGÈRE, FACULTATIVE
--
--  Volontairement HORS du bloc exécuté. Elle est propre, mais elle
--  échoue si les deux tables n'ont pas le même moteur ou le même
--  jeu de caractères, et je ne veux pas qu'une migration de confort
--  s'arrête sur ça. Sans elle, le service fait des LEFT JOIN : une
--  configuration purgée laisse simplement la pièce en
--  compatibilité large, ce qui est le comportement souhaité.
--
--  Si tu la veux, lance ce bloc séparément.
-- ============================================================

-- ALTER TABLE piece_compatibilite
--   ADD CONSTRAINT fk_compatibilite_configuration
--   FOREIGN KEY (id_configuration) REFERENCES vehicule_configuration (id)
--   ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
--  CONTRÔLE DE REMPLISSAGE
--
--  À relancer dans quelques semaines. La colonne « rattachees »
--  est celle qui compte : c'est le nombre de configurations que le
--  gestionnaire verra réellement dans sa liste déroulante.
-- ============================================================

-- SELECT
--   COUNT(*)                                            AS configurations,
--   SUM(id_modele IS NOT NULL)                          AS rattachees,
--   SUM(motorisation IS NOT NULL)                       AS avec_motorisation,
--   SUM(vues)                                           AS recherches_clients,
--   MIN(date_creation)                                  AS depuis
-- FROM vehicule_configuration;

-- SELECT marque, modele, motorisation, annee_min, annee_max, vues
--   FROM vehicule_configuration
--  ORDER BY vues DESC
--  LIMIT 20;
