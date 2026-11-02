// ============================================================
//  MAIFA-AUTO — CONSULTATION DU JOURNAL
//
//  Réservé au responsable. Lecture seule, sans exception :
//  aucune route ne modifie ni ne supprime une ligne de journal.
//  Un registre que l'on peut retoucher ne prouve rien.
// ============================================================

const db = require('../db');
const ExcelJS = require('exceljs');
const journal = require('../services/journal.service');

const PAR_PAGE_DEFAUT = 50;
const PAR_PAGE_MAX = 200;

const BLEU_NUIT = 'FF12314B';

/** Décode un champ JSON sans jamais faire échouer la réponse */
const decoder = (valeur) => {
  if (!valeur) return null;
  try {
    return JSON.parse(valeur);
  } catch {
    return null;
  }
};

/**
 * Construit la clause WHERE commune à la liste et à l'export,
 * pour que l'export porte exactement sur ce que le responsable
 * a sous les yeux.
 */
function construireFiltres(requete) {
  const { auteur, action, objet_type, depuis, jusqu_a, recherche } = requete;

  let sql = ' WHERE 1 = 1';
  const params = [];

  if (auteur) {
    sql += ' AND j.id_utilisateur = ?';
    params.push(auteur);
  }

  if (action) {
    sql += ' AND j.action = ?';
    params.push(action);
  }

  if (objet_type) {
    sql += ' AND j.objet_type = ?';
    params.push(objet_type);
  }

  if (depuis) {
    sql += ' AND j.date_action >= ?';
    params.push(`${depuis} 00:00:00`);
  }

  if (jusqu_a) {
    sql += ' AND j.date_action <= ?';
    params.push(`${jusqu_a} 23:59:59`);
  }

  if (recherche) {
    const like = `%${recherche}%`;
    sql += ' AND (j.resume LIKE ? OR j.objet_libelle LIKE ? OR j.auteur_nom LIKE ?)';
    params.push(like, like, like);
  }

  return { sql, params };
}

// ==========================================================
// 1. GET /api/journal
//    Liste paginée, filtrable
// ==========================================================
exports.lister = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const parPage = Math.min(PAR_PAGE_MAX, Number(req.query.par_page) || PAR_PAGE_DEFAUT);
    const depart = (page - 1) * parPage;

    const { sql: filtres, params } = construireFiltres(req.query);

    const [[compte]] = await db.query(
      `SELECT COUNT(*) AS total FROM journal_actions j${filtres}`,
      params,
    );

    const [lignes] = await db.query(
      `SELECT j.id, j.date_action, j.id_utilisateur, j.auteur_nom, j.auteur_mail,
              j.auteur_role, j.action, j.objet_type, j.objet_id, j.objet_libelle,
              j.resume, j.avant, j.apres, j.adresse_ip
         FROM journal_actions j${filtres}
        ORDER BY j.date_action DESC, j.id DESC
        LIMIT ? OFFSET ?`,
      [...params, parPage, depart],
    );

    res.json({
      total: Number(compte.total),
      page,
      par_page: parPage,
      pages: Math.max(1, Math.ceil(Number(compte.total) / parPage)),
      lignes: lignes.map((l) => ({
        ...l,
        avant: decoder(l.avant),
        apres: decoder(l.apres),
      })),
    });
  } catch (erreur) {
    console.error('Erreur lecture du journal :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture du journal.' });
  }
};

// ==========================================================
// 2. GET /api/journal/synthese
//    Activité par gestionnaire, sur une période
// ==========================================================
exports.synthese = async (req, res) => {
  try {
    const { depuis, jusqu_a } = req.query;

    let sql = `
      SELECT COALESCE(j.id_utilisateur, 0) AS id_utilisateur,
             j.auteur_nom,
             j.auteur_mail,
             COUNT(*)                           AS nb_actions,
             SUM(j.objet_type = 'commande')     AS nb_commandes,
             SUM(j.objet_type = 'piece')        AS nb_pieces,
             SUM(j.action = 'commande_confirmee') AS nb_confirmations,
             SUM(j.action = 'commande_annulee')   AS nb_annulations,
             SUM(j.action = 'piece_supprimee')    AS nb_suppressions,
             MAX(j.date_action)                 AS derniere_action
        FROM journal_actions j
       WHERE 1 = 1`;
    const params = [];

    if (depuis) {
      sql += ' AND j.date_action >= ?';
      params.push(`${depuis} 00:00:00`);
    }
    if (jusqu_a) {
      sql += ' AND j.date_action <= ?';
      params.push(`${jusqu_a} 23:59:59`);
    }

    sql += `
       GROUP BY COALESCE(j.id_utilisateur, 0), j.auteur_nom, j.auteur_mail
       ORDER BY nb_actions DESC`;

    const [parAuteur] = await db.query(sql, params);

    // Totaux de la période, pour les chiffres en tête de page
    const [[totaux]] = await db.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT j.id_utilisateur) AS nb_gestionnaires,
              MIN(j.date_action) AS premiere,
              MAX(j.date_action) AS derniere
         FROM journal_actions j
        WHERE 1 = 1
          ${depuis ? 'AND j.date_action >= ?' : ''}
          ${jusqu_a ? 'AND j.date_action <= ?' : ''}`,
      params,
    );

    res.json({
      par_auteur: parAuteur.map((a) => ({
        ...a,
        nb_actions: Number(a.nb_actions),
        nb_commandes: Number(a.nb_commandes),
        nb_pieces: Number(a.nb_pieces),
        nb_confirmations: Number(a.nb_confirmations),
        nb_annulations: Number(a.nb_annulations),
        nb_suppressions: Number(a.nb_suppressions),
      })),
      totaux: {
        total: Number(totaux.total),
        nb_gestionnaires: Number(totaux.nb_gestionnaires),
        premiere: totaux.premiere,
        derniere: totaux.derniere,
      },
    });
  } catch (erreur) {
    console.error('Erreur synthèse du journal :', erreur);
    res.status(500).json({ message: 'Erreur lors du calcul de la synthèse.' });
  }
};

// ==========================================================
// 3. GET /api/journal/objet/:type/:id
//    Tout l'historique d'une commande ou d'une pièce
// ==========================================================
exports.historiqueObjet = async (req, res) => {
  try {
    const { type, id } = req.params;

    const [lignes] = await db.query(
      `SELECT j.id, j.date_action, j.auteur_nom, j.auteur_mail, j.action,
              j.resume, j.avant, j.apres
         FROM journal_actions j
        WHERE j.objet_type = ? AND j.objet_id = ?
        ORDER BY j.date_action ASC, j.id ASC`,
      [type, id],
    );

    res.json(
      lignes.map((l) => ({
        ...l,
        avant: decoder(l.avant),
        apres: decoder(l.apres),
      })),
    );
  } catch (erreur) {
    console.error('Erreur historique objet :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture de l historique.' });
  }
};

// ==========================================================
// 4. GET /api/journal/filtres
//    Les valeurs réellement présentes, pour alimenter les menus
// ==========================================================
exports.filtres = async (req, res) => {
  try {
    const [auteurs] = await db.query(
      `SELECT DISTINCT j.id_utilisateur, j.auteur_nom, j.auteur_mail
         FROM journal_actions j
        WHERE j.id_utilisateur IS NOT NULL
        ORDER BY j.auteur_nom`,
    );

    const [actions] = await db.query(
      `SELECT j.action, COUNT(*) AS nb
         FROM journal_actions j
        GROUP BY j.action
        ORDER BY nb DESC`,
    );

    res.json({
      auteurs,
      actions: actions.map((a) => ({
        code: a.action,
        libelle: journal.ACTIONS[a.action]?.libelle || a.action,
        nb: Number(a.nb),
      })),
      types: ['commande', 'piece', 'import', 'utilisateur'],
    });
  } catch (erreur) {
    console.error('Erreur filtres du journal :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture des filtres.' });
  }
};

// ==========================================================
// 5. GET /api/journal/export
//    Le journal filtré, en Excel
// ==========================================================
exports.exporter = async (req, res) => {
  try {
    const { sql: filtres, params } = construireFiltres(req.query);

    const [lignes] = await db.query(
      `SELECT j.date_action, j.auteur_nom, j.auteur_mail, j.auteur_role,
              j.action, j.objet_type, j.objet_libelle, j.resume, j.adresse_ip
         FROM journal_actions j${filtres}
        ORDER BY j.date_action DESC, j.id DESC
        LIMIT 20000`,
      params,
    );

    const classeur = new ExcelJS.Workbook();
    classeur.creator = 'MAIFA-AUTO';
    classeur.created = new Date();

    const feuille = classeur.addWorksheet('Journal');
    feuille.columns = [
      { header: 'Date et heure', key: 'date_action', width: 20 },
      { header: 'Gestionnaire', key: 'auteur_nom', width: 24 },
      { header: 'Adresse', key: 'auteur_mail', width: 28 },
      { header: 'Rôle', key: 'auteur_role', width: 14 },
      { header: 'Action', key: 'action', width: 22 },
      { header: 'Type', key: 'objet_type', width: 13 },
      { header: 'Objet', key: 'objet_libelle', width: 22 },
      { header: 'Détail', key: 'resume', width: 62 },
      { header: 'Adresse IP', key: 'adresse_ip', width: 16 },
    ];

    const entete = feuille.getRow(1);
    entete.height = 22;
    entete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    entete.eachCell((cellule) => {
      cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLEU_NUIT } };
    });
    feuille.views = [{ state: 'frozen', ySplit: 1 }];
    feuille.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

    for (const l of lignes) {
      feuille.addRow({
        ...l,
        date_action: l.date_action
          ? new Date(l.date_action).toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })
          : '',
      });
    }

    // Trace de l'export lui-même : savoir qui a sorti le journal
    // fait partie du journal.
    await journal.enregistrerSansBloquer(req, {
      action: 'export_journal',
      objet: { type: 'import', libelle: `${lignes.length} ligne(s)` },
      resume: `${journal.auteurDepuis(req).nom} a exporté le journal (${lignes.length} ligne(s))`,
    });

    const jour = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="journal-MAIFA-AUTO-${jour}.xlsx"`);
    res.send(Buffer.from(await classeur.xlsx.writeBuffer()));
  } catch (erreur) {
    console.error('Erreur export du journal :', erreur);
    res.status(500).json({ message: 'Impossible de générer l export.' });
  }
};

// ==========================================================
// 6. GET /api/journal/equipe
//    Les comptes gestionnaires et responsables
// ==========================================================
exports.equipe = async (req, res) => {
  try {
    const [membres] = await db.query(
      `SELECT u.id, u.prenom, u.nom, u.mail, u.role,
              (SELECT COUNT(*) FROM journal_actions j WHERE j.id_utilisateur = u.id) AS nb_actions,
              (SELECT MAX(j.date_action) FROM journal_actions j WHERE j.id_utilisateur = u.id) AS derniere_action
         FROM users u
        WHERE u.role IN ('gestionnaire', 'responsable')
        ORDER BY FIELD(u.role, 'responsable', 'gestionnaire'), u.nom, u.prenom`,
    );

    res.json(
      membres.map((m) => ({
        ...m,
        nb_actions: Number(m.nb_actions),
      })),
    );
  } catch (erreur) {
    console.error('Erreur lecture de l équipe :', erreur);
    res.status(500).json({ message: 'Erreur lors de la lecture de l équipe.' });
  }
};
