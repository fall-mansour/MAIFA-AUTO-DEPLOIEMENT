-- ============================================================
--  MAIFA-AUTO — RÉFÉRENCE INTERNE DES PIÈCES
--  Format : MA-00042-N  (préfixe, séquence sur 5 chiffres, lettre de contrôle)
--
--  Cette migration est strictement additive : elle ne modifie
--  aucune colonne existante et ne supprime rien.
--
--  L'attribution des numéros se fait ensuite par le script
--  backend/scripts/backfill_reference_interne.js, qui applique
--  le même algorithme que le service utilisé en production.
--  Ne jamais numéroter à la main : la lettre de contrôle se calcule.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Colonne sur la table des pièces
--    Nullable : une pièce peut exister un court instant avant
--    que sa référence ne lui soit attribuée dans la transaction.
--    L'unicité garantit qu'un numéro n'est jamais porté deux fois.
-- ------------------------------------------------------------
ALTER TABLE pieces
  ADD COLUMN ref_interne VARCHAR(16) NULL COMMENT 'Référence interne MAIFA-AUTO, immuable' AFTER id;

ALTER TABLE pieces
  ADD UNIQUE KEY uq_pieces_ref_interne (ref_interne);

-- Recherche par référence saisie sans tirets ni lettre de contrôle
ALTER TABLE pieces
  ADD COLUMN ref_interne_norm VARCHAR(16)
    GENERATED ALWAYS AS (UPPER(REPLACE(REPLACE(ref_interne, '-', ''), ' ', ''))) STORED
    COMMENT 'Forme normalisée, pour la recherche';

ALTER TABLE pieces
  ADD KEY idx_pieces_ref_interne_norm (ref_interne_norm);

-- ------------------------------------------------------------
-- 2. Table des compteurs
--    Un compteur par séquence. Verrouillée en transaction au
--    moment de la réservation, ce qui empêche deux gestionnaires
--    simultanés d'obtenir le même numéro.
--
--    Le compteur ne recule JAMAIS, même après suppression d'une
--    pièce : un numéro retiré n'est pas recyclé, sinon deux pièces
--    différentes porteraient la même référence à des mois d'écart
--    et l'historique des commandes deviendrait faux.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compteurs (
  nom           VARCHAR(40)  NOT NULL,
  valeur        BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Dernier numéro attribué',
  prefixe       VARCHAR(8)   NOT NULL DEFAULT 'MA'  COMMENT 'Figé dès la première émission',
  date_creation TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_maj      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (nom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Amorce du compteur des pièces. Le script de numérotation le
-- positionnera ensuite sur le nombre de pièces déjà en base.
INSERT INTO compteurs (nom, valeur, prefixe)
VALUES ('piece', 0, 'MA')
ON DUPLICATE KEY UPDATE nom = nom;

-- ------------------------------------------------------------
-- 3. Vérification
-- ------------------------------------------------------------
-- SELECT nom, valeur, prefixe FROM compteurs;
-- SELECT COUNT(*) AS a_numeroter FROM pieces WHERE ref_interne IS NULL;
