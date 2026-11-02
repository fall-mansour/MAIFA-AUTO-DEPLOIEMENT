-- ============================================================
--  MAIFA-AUTO — CACHE DES DÉCODAGES VIN
--
--  LA CLÉ EST LE SQUISH VIN, PAS LE VIN COMPLET
--
--  Les positions 1 à 8 et 10 d'un numéro de châssis décrivent le
--  VÉHICULE : constructeur, carrosserie, motorisation, millésime.
--  Le numéro de série est ailleurs (positions 11 à 17), et la
--  position 9 n'est qu'un chiffre de contrôle. Cette empreinte de
--  9 caractères s'appelle le squish VIN.
--
--    VF3LCYHZ7JS123456  →  VF3LCYHZJ
--
--  Toutes les Peugeot 208 d'un même millésime et d'une même
--  motorisation la partagent. Indexer le cache dessus signifie
--  qu'un crédit Vehicle Databases payé ne couvre plus UNE voiture
--  mais une configuration entière. La dépense cesse d'être
--  proportionnelle au trafic : elle est bornée par le nombre de
--  modèles qui roulent réellement à Dakar.
--
--  POURQUOI CETTE TABLE EXISTE MAINTENANT, ET PAS AVANT
--
--  Tant que les sources étaient gratuites, le cache vivait en
--  mémoire. C'était le bon choix : aucune migration, suppression
--  en trois gestes. Vehicle Databases facture au crédit, donc un
--  cache en mémoire jette des réponses PAYÉES à chaque
--  déploiement. Cette table coûte moins que les crédits qu'elle
--  économise.
--
--  CREATE TABLE IF NOT EXISTS : rejouer ce fichier ne casse rien.
-- ============================================================

CREATE TABLE IF NOT EXISTS vin_cache (
  squish          CHAR(9)      NOT NULL COMMENT 'Positions 1-8 et 10 du VIN',

  -- Uniquement ce qui décrit le véhicule : marque, modèle, année,
  -- détails. Rien qui appartienne à l'exemplaire, puisque la ligne
  -- sert à tous les véhicules de cette configuration.
  charge          LONGTEXT     NOT NULL COMMENT 'Données du véhicule, en JSON',

  -- D'où vient le MODÈLE : local, vpic, ou vehicledatabases
  source          VARCHAR(20)  NOT NULL DEFAULT 'local',

  -- 1 si un crédit Vehicle Databases a pu être débité, y compris
  -- quand la réponse était vide. Permet de chiffrer la dépense et
  -- de ne jamais repayer la même absence de résultat.
  paye            TINYINT(1)   NOT NULL DEFAULT 0,

  -- Combien de véhicules ont réutilisé cette configuration.
  -- Sur une ligne payée, c'est exactement le nombre de crédits
  -- que le cache a évités.
  relectures      INT UNSIGNED NOT NULL DEFAULT 0,

  date_creation   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_relecture  DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (squish),
  KEY idx_vin_cache_paye (paye, date_creation),
  KEY idx_vin_cache_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Décodages VIN par configuration de véhicule (squish VIN).';


-- ============================================================
--  CONTRÔLE
--
--  À lancer de temps en temps : la dernière colonne est le
--  nombre de crédits que le cache t'a fait économiser.
-- ============================================================

-- SELECT
--   COUNT(*)                                                     AS configurations,
--   SUM(paye)                                                    AS credits_depenses,
--   SUM(CASE WHEN source = 'vehicledatabases' THEN 1 ELSE 0 END)  AS resolues_par_vd,
--   SUM(CASE WHEN source = 'vpic'             THEN 1 ELSE 0 END)  AS resolues_par_vpic,
--   SUM(CASE WHEN source = 'local'            THEN 1 ELSE 0 END)  AS marque_seule,
--   SUM(CASE WHEN paye = 1 THEN relectures ELSE 0 END)            AS credits_evites
-- FROM vin_cache;
