-- ============================================================
--  MAIFA-AUTO — UNICITÉ DES LIGNES DE COMPATIBILITÉ
--
--  À PASSER APRÈS migration_vin_configuration.sql
--
--  CE QUE LA CLÉ ACTUELLE LAISSE PASSER, ET CE QU'ELLE INTERDIT
--
--  État constaté le 29 octobre :
--
--      UNIQUE KEY uk_compat (id_piece, id_modele, annee_min, annee_max)
--
--  Deux défauts, indépendants de la recherche VIN.
--
--  1. motorisation n'est PAS dans la clé. Le gestionnaire ne peut
--     donc pas déclarer deux motorisations du même modèle sur la
--     même plage d'années :
--
--       pièce 7, Fabia, 2010-2014, 1.4 TDI   acceptée
--       pièce 7, Fabia, 2010-2014, 1.9 TDI   REFUSÉE, doublon
--
--     C'est précisément la précision qu'on cherche à obtenir.
--
--  2. annee_min et annee_max sont nullables, et MySQL traite deux
--     NULL comme DISTINCTS dans un index unique. La clé ne protège
--     donc pas les lignes sans plage d'années, qui sont les plus
--     courantes. La protection réelle repose aujourd'hui
--     uniquement sur le contrôle applicatif en <=>.
--
--  LA CORRECTION
--
--  Une colonne générée qui remplace chaque NULL par une valeur
--  neutre, et la clé unique posée sur elle. La base interdit alors
--  réellement les doublons au lieu de faire semblant, et les deux
--  cas ci-dessus deviennent possibles.
--
--  Le contrôle applicatif en <=> RESTE en place : il rend un
--  message lisible au gestionnaire, là où la base rendrait un
--  #1062 brut. La clé est le filet, pas le portier.
--
--  POURQUOI remarque N'EST PAS DANS LA CLÉ
--
--  Deux lignes qui ne diffèrent que par un commentaire libre sont
--  deux fois la même compatibilité. Les inclure reviendrait à
--  désactiver la clé dès qu'un gestionnaire annote.
--
--  VOLUME CONCERNÉ
--
--  AUTO_INCREMENT à 14, donc treize lignes créées depuis l'origine.
--  La reconstruction de table est instantanée.
-- ============================================================


-- ------------------------------------------------------------
--  0. VÉRIFICATION PRÉALABLE
--
--  La migration du référentiel doit être passée AVANT celle-ci.
--  Si la ligne suivante renvoie 0, arrête-toi et lance d'abord
--  migration_vin_configuration.sql.
-- ------------------------------------------------------------
SELECT COUNT(*) AS id_configuration_presente
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'piece_compatibilite'
   AND COLUMN_NAME  = 'id_configuration';


-- ------------------------------------------------------------
--  0 bis. DOUBLONS EXISTANTS
--
--  Si cette requête renvoie des lignes, la nouvelle clé ne pourra
--  pas être posée. Supprime les doublons à la main avant de
--  continuer : avec treize lignes, c'est l'affaire d'une minute.
--
--  Zéro ligne attendue.
-- ------------------------------------------------------------
SELECT id_piece,
       id_modele,
       COALESCE(id_configuration, 0) AS configuration,
       COALESCE(annee_min, 0)        AS debut,
       COALESCE(annee_max, 0)        AS fin,
       COALESCE(motorisation, '')    AS moteur,
       COUNT(*)                      AS occurrences,
       GROUP_CONCAT(id)              AS identifiants
  FROM piece_compatibilite
 GROUP BY id_piece, id_modele, configuration, debut, fin, moteur
HAVING COUNT(*) > 1;


-- ------------------------------------------------------------
--  1. LA COLONNE GÉNÉRÉE
--
--  STORED et non VIRTUAL : une colonne virtuelle est recalculée à
--  chaque lecture d'index, ce qui n'a pas de sens pour une clé
--  unique interrogée à chaque insertion.
--
--  VARCHAR(190) : motorisation fait 100 caractères, le reste tient
--  largement dans la marge. 190 × 4 octets reste sous la limite
--  d'index d'InnoDB quel que soit le format de ligne.
--
--  Sous garde, comme toujours : rejouable sans #1060.
-- ------------------------------------------------------------

SET @colonne_existe := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND COLUMN_NAME  = 'cle_unicite'
);

SET @instruction := IF(
  @colonne_existe = 0,
  'ALTER TABLE piece_compatibilite
     ADD COLUMN cle_unicite VARCHAR(190)
     GENERATED ALWAYS AS (
       CONCAT_WS(''|'',
         id_piece,
         id_modele,
         COALESCE(id_configuration, 0),
         COALESCE(annee_min, 0),
         COALESCE(annee_max, 0),
         COALESCE(motorisation, ''''))
     ) STORED
     COMMENT ''Empreinte d unicite, NULL normalises''',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


-- ------------------------------------------------------------
--  1 bis. L'INDEX QUI SOUTIENT LA CLÉ ÉTRANGÈRE SUR id_piece
--
--  POURQUOI CETTE ÉTAPE EXISTE
--
--  InnoDB exige qu'une clé étrangère soit soutenue par un index
--  dont elle est le préfixe gauche. La table en a deux :
--
--    fk_compat_modele sur id_modele  → soutenue par idx_compat_modele
--    fk_compat_piece  sur id_piece   → soutenue par uk_compat
--
--  Il n'existe aucun index propre à id_piece : c'est uk_compat,
--  dont id_piece est la première colonne, qui fait ce travail.
--  Le retirer sans le remplacer provoque :
--
--    ERROR 1553 : Cannot drop index 'uk_compat',
--                 needed in a foreign key constraint
--
--  D'où cet index, posé AVANT le retrait. Il n'est pas un
--  pis-aller : vehicules.service.js interroge la table en
--  « WHERE pc.id_piece IN (?) » sur chaque page de catalogue, et
--  s'appuyait jusqu'ici sur le préfixe de la clé unique. Il
--  retrouve ici un index dédié.
-- ------------------------------------------------------------

SET @index_piece_existe := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND INDEX_NAME   = 'idx_compat_piece'
);

SET @instruction := IF(
  @index_piece_existe = 0,
  'ALTER TABLE piece_compatibilite ADD KEY idx_compat_piece (id_piece)',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


-- ------------------------------------------------------------
--  2. RETRAIT DE L'ANCIENNE CLÉ
--
--  Sous garde également : si elle a déjà été retirée, on ne
--  provoque pas un #1091 « clé inexistante ».
--
--  DOUBLE CONDITION. On ne retire uk_compat que si les deux
--  remplaçants sont en place :
--
--    cle_unicite        sinon la table perdrait toute protection
--    idx_compat_piece   sinon InnoDB refuse, erreur 1553
--
--  Une exécution interrompue ne peut donc jamais laisser la table
--  dans un état dégradé.
-- ------------------------------------------------------------

SET @ancienne_existe := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND INDEX_NAME   = 'uk_compat'
);

SET @colonne_prete := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND COLUMN_NAME  = 'cle_unicite'
);

SET @support_pret := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND INDEX_NAME   = 'idx_compat_piece'
);

SET @instruction := IF(
  @ancienne_existe > 0 AND @colonne_prete > 0 AND @support_pret > 0,
  'ALTER TABLE piece_compatibilite DROP INDEX uk_compat',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


-- ------------------------------------------------------------
--  3. LA NOUVELLE CLÉ
-- ------------------------------------------------------------

SET @nouvelle_existe := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'piece_compatibilite'
     AND INDEX_NAME   = 'uk_compat_v2'
);

SET @instruction := IF(
  @nouvelle_existe = 0,
  'ALTER TABLE piece_compatibilite
     ADD UNIQUE KEY uk_compat_v2 (cle_unicite)',
  'DO 0'
);

PREPARE requete FROM @instruction;
EXECUTE requete;
DEALLOCATE PREPARE requete;


-- ------------------------------------------------------------
--  4. CONTRÔLE FINAL
--
--  Attendu :
--    colonne_generee = 1
--    index_piece     = 1
--    ancienne_cle    = 0
--    nouvelle_cle    = 1
-- ------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'piece_compatibilite'
      AND COLUMN_NAME = 'cle_unicite')        AS colonne_generee,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'piece_compatibilite'
      AND INDEX_NAME = 'idx_compat_piece')    AS index_piece,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'piece_compatibilite'
      AND INDEX_NAME = 'uk_compat')           AS ancienne_cle,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'piece_compatibilite'
      AND INDEX_NAME = 'uk_compat_v2')        AS nouvelle_cle;


-- ============================================================
--  PREUVE, FACULTATIF
--
--  Ce que la nouvelle clé change, sur une pièce d'essai. À jouer
--  seulement si tu veux le constater, et à annuler ensuite.
--
--  Remplace 7 et 1 par un id_piece et un id_modele qui existent.
-- ============================================================

-- INSERT INTO piece_compatibilite (id_piece, id_modele, annee_min, annee_max, motorisation)
--   VALUES (7, 1, 2010, 2014, '1.4 TDI');
-- INSERT INTO piece_compatibilite (id_piece, id_modele, annee_min, annee_max, motorisation)
--   VALUES (7, 1, 2010, 2014, '1.9 TDI');   -- refusée AVANT, acceptée APRÈS
-- INSERT INTO piece_compatibilite (id_piece, id_modele, annee_min, annee_max, motorisation)
--   VALUES (7, 1, 2010, 2014, '1.4 TDI');   -- refusée, vrai doublon
--
-- DELETE FROM piece_compatibilite WHERE id_piece = 7 AND id_modele = 1;
