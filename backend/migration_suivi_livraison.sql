-- ============================================================
--  MAIFA-AUTO — SUIVI DE LIVRAISON PAR COURRIEL
--
--  1. Le statut « expédiée », qui manquait entre confirmée et livrée
--  2. Un jeton de suivi, qui rend la page de suivi consultable sans
--     exposer les commandes des autres
--  3. Les dates d'envoi, qui empêchent le double courriel
-- ============================================================

-- ------------------------------------------------------------
-- 1. LE STATUT MANQUANT
--
--    Le parcours client compte trois étapes :
--      confirmée  ->  expédiée  ->  livrée
--
--    « expédiée » n'existait pas : le gestionnaire passait
--    directement de confirmée à livrée, et le client n'apprenait
--    rien entre les deux.
-- ------------------------------------------------------------
ALTER TABLE commandes
  MODIFY COLUMN statut
    ENUM('en_attente', 'confirmee', 'expediee', 'livree', 'annulee')
    NOT NULL DEFAULT 'en_attente';

-- ------------------------------------------------------------
-- 2. LE JETON DE SUIVI
--
--    Aujourd'hui, GET /api/panier/commande/TM-2026-0042 est ouverte
--    à tous, et les références se devinent en comptant. N'importe
--    qui peut parcourir les numéros et lire le téléphone, l'adresse
--    et l'adresse électronique de chaque client.
--
--    Le jeton part dans le courriel du client, lui seul le détient.
--    Les numéros deviennent inutiles à deviner.
--
--    Il est rempli à la création de la commande par le contrôleur.
--    Pour les commandes déjà en base, le UPDATE plus bas en génère
--    un rétroactivement.
-- ------------------------------------------------------------
ALTER TABLE commandes
  ADD COLUMN jeton_suivi CHAR(24) NULL
    COMMENT 'Clé du lien de suivi envoyé au client' AFTER reference;

ALTER TABLE commandes
  ADD KEY idx_commande_jeton (jeton_suivi);

-- Jeton pour les commandes existantes. SHA2 d'une valeur aléatoire
-- propre à chaque ligne, tronqué à 24 caractères.
UPDATE commandes
   SET jeton_suivi = SUBSTRING(SHA2(CONCAT(id, reference, RAND(), UUID()), 256), 1, 24)
 WHERE jeton_suivi IS NULL;

-- ------------------------------------------------------------
-- 3. DATES D'ENVOI
--
--    Deux clics sur « Expédier » ne doivent pas produire deux
--    courriels. On note la date du dernier envoi par étape, et on
--    n'envoie que si la case est vide.
-- ------------------------------------------------------------
ALTER TABLE commandes
  ADD COLUMN mail_confirmee_le DATETIME NULL COMMENT 'Courriel de confirmation envoyé le',
  ADD COLUMN mail_expediee_le  DATETIME NULL COMMENT 'Courriel d expédition envoyé le',
  ADD COLUMN mail_livree_le    DATETIME NULL COMMENT 'Courriel de livraison envoyé le',
  ADD COLUMN mail_annulee_le   DATETIME NULL COMMENT 'Courriel d annulation envoyé le';

-- ------------------------------------------------------------
-- 4. VÉRIFICATIONS
-- ------------------------------------------------------------
-- SHOW COLUMNS FROM commandes LIKE 'statut';
-- SELECT reference, jeton_suivi FROM commandes LIMIT 5;
-- SELECT COUNT(*) AS sans_jeton FROM commandes WHERE jeton_suivi IS NULL;
