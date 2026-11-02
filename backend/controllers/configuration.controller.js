const db = require('../db');
const configurations = require('../services/configuration.service');
const vinService = require('../services/vin.service');
const journal = require('../services/journal.service');

// ============================================================
//  MAIFA-AUTO — CONFIGURATIONS DE VÉHICULES, CÔTÉ GESTION
//
//  Ce que le gestionnaire consulte ici, ce sont les véhicules que
//  ses CLIENTS ont réellement cherchés par numéro de châssis. La
//  table ne se remplit pas depuis cet écran : elle se remplit
//  toute seule à chaque recherche sur la page d'accueil.
//
//  Aucune route d'écriture libre. Les deux seules écritures
//  possibles sont le décodage d'un VIN qu'il a réellement sous les
//  yeux, et le rattrapage des configurations orphelines.
// ============================================================

// ------------------------------------------------------------
//  GET /api/configurations
//
//  Paramètres facultatifs :
//    id_modele   restreint à un modèle du référentiel
//    marque      restreint à une marque, par son libellé
//
//  Réponse : { configurations: [...], synthese: {...} }
//
//  La synthèse porte le nombre d'orphelines, c'est-à-dire les
//  véhicules cherchés par des clients que le gestionnaire ne peut
//  pas rattacher faute de modèle correspondant chez nous. Le front
//  l'affiche : c'est une liste de travail pour enrichir le
//  référentiel, pas un défaut.
// ------------------------------------------------------------
exports.lister = async (req, res) => {
  try {
    const filtres = {};

    if (req.query.id_modele) {
      const id = Number(req.query.id_modele);
      if (Number.isInteger(id) && id > 0) filtres.id_modele = id;
    } else if (req.query.marque) {
      filtres.marque = String(req.query.marque).trim();
    }

    const [liste, synthese] = await Promise.all([
      configurations.lister(filtres),
      configurations.statistiques(),
    ]);

    res.json({ configurations: liste, synthese });
  } catch (erreur) {
    console.error('Erreur liste des configurations :', erreur);
    res.status(500).json({ message: 'Lecture impossible.', error: erreur.message });
  }
};

// ------------------------------------------------------------
//  POST /api/configurations/vin
//
//  Pour les trois cas où le gestionnaire a RÉELLEMENT un numéro de
//  châssis sous les yeux :
//
//    un client l'appelle et le lui donne
//    une pièce d'occasion prélevée sur un véhicule de la cour
//    une carte grise photographiée à l'atelier
//
//  compter: false. L'activité du gestionnaire ne doit pas gonfler
//  le compteur de vues, qui sert à savoir quels véhicules roulent
//  chez les CLIENTS. Gonfler ce chiffre reviendrait à se
//  recommander à soi-même quoi stocker.
// ------------------------------------------------------------
exports.decoderVin = async (req, res) => {
  const saisie = String(req.body?.vin ?? '').trim();

  if (!saisie) {
    return res.status(400).json({ message: 'Entrez un numéro de châssis.' });
  }

  try {
    const decode = await vinService.decoder(saisie, { compter: false });

    if (!decode.valide) {
      return res.status(400).json({ message: decode.message, decode });
    }

    if (!decode.marque) {
      return res.status(200).json({
        message: decode.message,
        decode,
        configuration: null,
      });
    }

    const id = await configurations.apprendre(decode.vin, decode, { compter: false });
    const configuration = id ? await configurations.parId(id) : null;

    // Rattachable ou non : la distinction compte pour le front.
    // Une ligne de piece_compatibilite exige un id_modele NOT NULL,
    // donc une configuration non rattachée au référentiel ne peut
    // pas être jointe à une pièce, quoi qu'on en fasse ensuite.
    const rattachable = Boolean(configuration?.id_modele);

    res.json({
      message: rattachable
        ? `${decode.marque} ${decode.modele || ''}`.trim() + ' reconnu.'
        : `${decode.marque} reconnu, mais ce véhicule ne figure pas encore dans votre référentiel.`,
      decode,
      configuration,
      rattachable,
    });
  } catch (erreur) {
    console.error('Erreur décodage VIN gestion :', erreur);
    res.status(500).json({ message: 'Décodage indisponible.', error: erreur.message });
  }
};

// ------------------------------------------------------------
//  POST /api/configurations/rattacher
//
//  À lancer après avoir enrichi les tables marques ou modeles :
//  les configurations restées orphelines retrouvent leur place
//  sans qu'un client ait à revenir sur le site.
// ------------------------------------------------------------
exports.rattacher = async (req, res) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const bilan = await configurations.rattacherOrphelines(conn);

    if (bilan.rattachees > 0) {
      await journal.enregistrer(conn, req, {
        action: 'configurations_rattachees',
        objet: { type: 'referentiel', id: 0, libelle: 'Configurations véhicules' },
        apres: bilan,
      });
    }

    await conn.commit();

    res.json({
      message:
        bilan.rattachees === 0
          ? `Aucune des ${bilan.examinees} configuration(s) orpheline(s) n'a pu être rattachée.`
          : `${bilan.rattachees} configuration(s) rattachée(s) sur ${bilan.examinees} examinée(s).`,
      ...bilan,
    });
  } catch (erreur) {
    await conn.rollback();
    console.error('Erreur rattrapage des configurations :', erreur);
    res.status(500).json({ message: 'Rattrapage impossible.', error: erreur.message });
  } finally {
    conn.release();
  }
};
