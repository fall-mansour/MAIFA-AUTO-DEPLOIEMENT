-- ============================================================
--  MAIFA-AUTO — IMPORT EN MASSE DEPUIS UN FICHIER EXCEL
--
--  1. Correctif : recherche normalisée sur la référence constructeur
--  2. Tables de travail de l'import (lot + lignes)
--
--  Migration strictement additive. Aucune colonne existante n'est
--  modifiée ni supprimée.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RECHERCHE SUR LA RÉFÉRENCE CONSTRUCTEUR
--
--    Constat : ref_normalisee est calculée depuis `ref`, l'ancien
--    champ saisi à la main, désormais remplacé par ref_interne.
--    La référence qui compte vraiment pour un mécanicien, ref_oe,
--    n'a aucune forme normalisée.
--
--    Conséquence aujourd'hui : un client qui cherche "0451.103318"
--    ne trouve pas la pièce enregistrée sous "0451103318", alors
--    que la même recherche fonctionne sur l'ancien champ.
--
--    L'import rendant ref_oe central, on comble ce manque.
-- ------------------------------------------------------------
ALTER TABLE pieces
  ADD COLUMN ref_oe_norm VARCHAR(80)
    GENERATED ALWAYS AS (
      UCASE(REPLACE(REPLACE(REPLACE(IFNULL(ref_oe, ''), ' ', ''), '-', ''), '.', ''))
    ) STORED
    COMMENT 'Référence constructeur normalisée, pour la recherche';

ALTER TABLE pieces
  ADD KEY idx_piece_ref_oe_norm (ref_oe_norm);

-- Une référence constructeur peut légitimement être portée par
-- plusieurs pièces équivalentes : index simple, pas de contrainte
-- d'unicité.

-- ------------------------------------------------------------
-- 2. LOTS D'IMPORT
--
--    Un import se déroule en deux temps : analyse du fichier,
--    puis application après confirmation du gestionnaire. Entre
--    les deux, le travail est conservé ici.
--
--    Cela permet au gestionnaire de corriger les lignes refusées,
--    de quitter la page et d'y revenir, et laisse une trace de
--    qui a importé quoi.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_lots (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nom_fichier     VARCHAR(255) NOT NULL,
  taille_octets   INT UNSIGNED NULL,
  id_utilisateur  INT NULL COMMENT 'Gestionnaire à l origine de l import',

  statut          ENUM('analyse', 'applique', 'annule') NOT NULL DEFAULT 'analyse',

  nb_pieces       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nb_compat       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nb_creations    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nb_maj          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nb_anomalies    SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  anomalies       LONGTEXT NULL COMMENT 'Anomalies globales du fichier, en JSON',

  date_analyse    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_application TIMESTAMP NULL DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_lot_statut (statut),
  KEY idx_lot_date (date_analyse)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. LIGNES DU LOT
--
--    Une ligne du fichier, telle que lue, avec le verdict de
--    l'analyse. 'donnees' conserve la ligne brute en JSON pour
--    que le gestionnaire voie ce qu'il a réellement envoyé.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_lignes (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_lot        INT UNSIGNED NOT NULL,

  onglet        ENUM('pieces', 'compatibilites') NOT NULL,
  ligne_fichier SMALLINT UNSIGNED NOT NULL COMMENT 'Numéro de ligne dans Excel',

  -- pret        : rien à confirmer, sera appliqué tel quel
  -- a_confirmer : un rapprochement est probable mais pas certain
  -- anomalie    : la ligne ne peut pas être appliquée en l état
  -- ignoree     : le gestionnaire a choisi de l écarter
  statut        ENUM('pret', 'a_confirmer', 'anomalie', 'ignoree') NOT NULL DEFAULT 'pret',
  action        ENUM('creation', 'maj', 'aucune') NOT NULL DEFAULT 'creation',

  donnees       LONGTEXT NOT NULL COMMENT 'Ligne lue, en JSON',
  resolution    LONGTEXT NULL COMMENT 'Identifiants retenus après rapprochement, en JSON',
  messages      LONGTEXT NULL COMMENT 'Motifs affichés au gestionnaire, en JSON',

  id_piece      INT NULL COMMENT 'Pièce concernée, une fois connue',

  PRIMARY KEY (id),
  KEY idx_ligne_lot (id_lot, onglet, statut),
  CONSTRAINT fk_ligne_lot FOREIGN KEY (id_lot)
    REFERENCES import_lots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. VÉRIFICATIONS
-- ------------------------------------------------------------
-- Colonne de recherche en place et alimentée :
--   SELECT id, ref_oe, ref_oe_norm FROM pieces WHERE ref_oe IS NOT NULL;
--
-- Catégories orphelines, à corriger avant d importer :
--   SELECT p.id, p.id_categorie FROM pieces p
--    LEFT JOIN categories c ON c.id = p.id_categorie
--    WHERE p.id_categorie IS NOT NULL AND c.id IS NULL;
