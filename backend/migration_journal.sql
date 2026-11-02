-- ============================================================
--  MAIFA-AUTO — RÔLE RESPONSABLE ET JOURNAL DES ACTIONS
--
--  1. Un troisième rôle, au-dessus de gestionnaire
--  2. Le journal : qui a fait quoi, quand
--
--  Migration additive. Les rôles existants sont conservés tels
--  quels : personne ne perd ses droits.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LE RÔLE RESPONSABLE
--
--    Hiérarchie : client < gestionnaire < responsable.
--    Un responsable fait tout ce que fait un gestionnaire, et
--    consulte en plus le journal.
-- ------------------------------------------------------------
ALTER TABLE users
  MODIFY COLUMN role ENUM('client', 'gestionnaire', 'responsable')
    NOT NULL DEFAULT 'client'
    COMMENT 'client < gestionnaire < responsable';

-- Le responsable actuel. À ajuster si l'adresse change : la liste
-- RESPONSABLES_AUTORISES du .env doit porter la même valeur, le
-- rôle en base seul ne suffit pas.
UPDATE users SET role = 'responsable'
 WHERE mail = 'a.fall.aliou@gmail.com';

-- ------------------------------------------------------------
-- 2. LE JOURNAL
--
--    Deux principes gouvernent cette table.
--
--    Elle ne se modifie jamais. Aucune route ne propose de
--    corriger ni de supprimer une ligne. Un journal que l'on peut
--    retoucher ne prouve rien.
--
--    Elle conserve une copie du nom et de l'adresse de l'auteur.
--    Le lien vers users se vide si le compte est supprimé, mais la
--    trace reste lisible : « Aliou Fall a annulé la commande
--    CMD-00042 » doit rester vrai dans deux ans, même si ce compte
--    n'existe plus.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_actions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  date_action     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Auteur : le lien, puis sa copie figée
  id_utilisateur  INT NULL,
  auteur_nom      VARCHAR(160) NOT NULL DEFAULT 'Inconnu',
  auteur_mail     VARCHAR(190) NULL,
  auteur_role     VARCHAR(20)  NULL,

  -- Ce qui a été fait
  action          VARCHAR(40)  NOT NULL COMMENT 'commande_confirmee, stock_ajuste...',
  objet_type      VARCHAR(20)  NOT NULL COMMENT 'commande, piece, import, utilisateur',
  objet_id        INT NULL,
  objet_libelle   VARCHAR(255) NULL COMMENT 'Référence lisible, figée au moment de l action',

  resume          VARCHAR(255) NULL COMMENT 'Phrase affichée au responsable',

  -- Détail, pour les cas où le résumé ne suffit pas
  avant           LONGTEXT NULL COMMENT 'État antérieur, en JSON',
  apres           LONGTEXT NULL COMMENT 'État postérieur, en JSON',

  adresse_ip      VARCHAR(45) NULL,

  PRIMARY KEY (id),
  KEY idx_journal_date (date_action),
  KEY idx_journal_auteur (id_utilisateur, date_action),
  KEY idx_journal_objet (objet_type, objet_id),
  KEY idx_journal_action (action, date_action),

  -- SET NULL et non CASCADE : supprimer un compte ne doit pas
  -- effacer ce qu'il a fait.
  CONSTRAINT fk_journal_utilisateur FOREIGN KEY (id_utilisateur)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. VUE DE SYNTHÈSE
--    Activité par gestionnaire, pour l'en-tête de la page.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_journal_par_auteur AS
SELECT
  COALESCE(j.id_utilisateur, 0)                       AS id_utilisateur,
  j.auteur_nom,
  j.auteur_mail,
  COUNT(*)                                            AS nb_actions,
  SUM(j.objet_type = 'commande')                      AS nb_commandes,
  SUM(j.objet_type = 'piece')                         AS nb_pieces,
  SUM(j.action = 'commande_annulee')                  AS nb_annulations,
  SUM(j.action LIKE 'piece_supprimee')                AS nb_suppressions,
  MIN(j.date_action)                                  AS premiere_action,
  MAX(j.date_action)                                  AS derniere_action
FROM journal_actions j
GROUP BY COALESCE(j.id_utilisateur, 0), j.auteur_nom, j.auteur_mail;

-- ------------------------------------------------------------
-- 4. VÉRIFICATIONS
-- ------------------------------------------------------------
-- SELECT mail, role FROM users WHERE role <> 'client';
-- SELECT * FROM v_journal_par_auteur;
