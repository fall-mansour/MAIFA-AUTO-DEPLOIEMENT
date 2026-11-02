// ============================================================
//  MAIFA-AUTO — NUMÉROTATION DU STOCK EXISTANT
//
//  Attribue une référence interne aux pièces déjà en base, dans
//  leur ordre de création, puis positionne le compteur à la suite.
//
//  À exécuter UNE SEULE FOIS, après migration_reference_interne.sql :
//      node backend/scripts/backfill_reference_interne.js
//
//  Relancer le script est sans danger : les pièces déjà numérotées
//  sont ignorées. Mais une référence attribuée ne change plus.
//
//  Option --simulation pour voir le résultat sans rien écrire.
// ============================================================

const db = require('../db');
const reference = require('../services/reference.service');

const SIMULATION = process.argv.includes('--simulation');

async function numeroter() {
  const connexion = await db.getConnection();

  try {
    await connexion.beginTransaction();

    // Pièces à numéroter, dans l'ordre où elles sont entrées au stock
    const [pieces] = await connexion.query(
      `SELECT id, ref, description
         FROM pieces
        WHERE ref_interne IS NULL
        ORDER BY date_ajout ASC, id ASC`,
    );

    if (pieces.length === 0) {
      console.log('✅ Rien à faire : toutes les pièces portent déjà une référence interne.');
      await connexion.rollback();
      return;
    }

    console.log(`${pieces.length} pièce(s) à numéroter.`);

    // Un seul verrou pour tout le lot
    const references = await reference.reserver(connexion, pieces.length);

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const refInterne = references[i];

      console.log(
        `  ${refInterne}  ←  #${piece.id}  ${piece.description || '(sans désignation)'}` +
          (piece.ref ? `  [réf. constructeur ${piece.ref}]` : ''),
      );

      if (!SIMULATION) {
        await connexion.query('UPDATE pieces SET ref_interne = ? WHERE id = ?', [
          refInterne,
          piece.id,
        ]);
      }
    }

    if (SIMULATION) {
      await connexion.rollback();
      console.log('\n🔍 Simulation : aucune écriture. Relancez sans --simulation pour appliquer.');
      return;
    }

    await connexion.commit();

    const [[compteur]] = await connexion.query('SELECT valeur FROM compteurs WHERE nom = ?', [
      'piece',
    ]);
    console.log(
      `\n✅ ${pieces.length} pièce(s) numérotée(s). ` +
        `Prochaine référence : ${reference.formater(Number(compteur.valeur) + 1)}`,
    );
  } catch (erreur) {
    await connexion.rollback();
    console.error('❌ Numérotation interrompue, aucune modification conservée.');
    console.error(erreur.message);
    process.exitCode = 1;
  } finally {
    connexion.release();
    await db.end();
  }
}

numeroter();
