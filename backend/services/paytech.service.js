const crypto = require('crypto');

/**
 * Service PayTech.
 * Documentation officielle : https://docs.intech.sn/doc_paytech.php
 *
 * Les cles ne quittent jamais le serveur : CORS n'est pas active chez
 * PayTech, et une cle secrete dans le navigateur serait exploitable
 * par n'importe qui.
 */

const BASE_URL = 'https://paytech.sn/api';

const API_KEY = process.env.PAYTECH_API_KEY;
const API_SECRET = process.env.PAYTECH_API_SECRET;

/** 'test' ou 'prod'. En test, PayTech debite un montant aleatoire de 100 a 150 FCFA. */
const ENV = process.env.PAYTECH_ENV || 'test';

/** Base publique du backend, en HTTPS obligatoirement pour l'IPN */
const URL_BACKEND = process.env.URL_BACKEND || '';
/** Base du front, pour les redirections apres paiement */
const URL_FRONT = process.env.URL_FRONT || 'http://localhost:4200';

const entetes = () => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  API_KEY: API_KEY,
  API_SECRET: API_SECRET,
});

/** Correspondance entre nos modes et les libelles attendus par PayTech */
const METHODES = {
  wave: 'Wave',
  om: 'Orange Money',
  free: 'Free Money',
  carte: 'Carte Bancaire',
};

/**
 * Cree une demande de paiement et renvoie l'URL de redirection.
 *
 * @param {object} p
 * @param {number} p.montant        en FCFA, entier
 * @param {string} p.refCommande    reference unique par TENTATIVE
 * @param {string} p.libelle        nom du produit affiche sur la page PayTech
 * @param {string} p.description    description de la commande
 * @param {string} [p.methode]      'wave', 'om', 'free', 'carte' ou vide pour toutes
 * @param {object} [p.donnees]      custom_field, renvoye tel quel dans l'IPN
 * @param {object} [p.client]       { telephone, nom } pour le pre-remplissage
 */
const demanderPaiement = async ({
  montant,
  refCommande,
  libelle,
  description,
  methode = '',
  donnees = {},
  client = null,
}) => {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Clés PayTech absentes : renseignez PAYTECH_API_KEY et PAYTECH_API_SECRET.');
  }

  if (!URL_BACKEND.startsWith('https://')) {
    // PayTech refuse une ipn_url non chiffree, et sans IPN un paiement
    // reussi ne serait jamais enregistre.
    throw new Error(
      'URL_BACKEND doit être une adresse HTTPS publique pour recevoir les notifications PayTech. En développement, utilisez un tunnel (ngrok, cloudflared).',
    );
  }

  const cible = METHODES[methode] || '';

  const corps = {
    item_name: libelle,
    // PayTech attend un entier : les centimes n'existent pas en FCFA
    item_price: Math.round(Number(montant)),
    currency: 'XOF',
    ref_command: refCommande,
    command_name: description,
    env: ENV,
    target_payment: cible,
    ipn_url: `${URL_BACKEND}/api/paiement/ipn`,

    // Les URL de retour passent par le BACKEND, qui redirige ensuite
    // vers le front. Wave et Orange Money refusent une adresse locale
    // comme http://localhost:4200 : elle n'est joignable que depuis
    // la machine de developpement, et leur validateur la rejette.
    // Le backend, lui, a une adresse publique (ngrok ou Render).
    success_url: `${URL_BACKEND}/api/paiement/retour/succes?ref=${encodeURIComponent(refCommande)}`,
    cancel_url: `${URL_BACKEND}/api/paiement/retour/annule?ref=${encodeURIComponent(refCommande)}`,
    custom_field: JSON.stringify(donnees),
  };

  const reponse = await fetch(`${BASE_URL}/payment/request-payment`, {
    method: 'POST',
    headers: entetes(),
    body: JSON.stringify(corps),
  });

  const json = await reponse.json();

  if (json.success !== 1) {
    throw new Error(json.message || 'PayTech a refusé la demande de paiement.');
  }

  let url = json.redirect_url || json.redirectUrl;

  // Pre-remplissage : possible uniquement avec UNE seule methode ciblee.
  // Le client arrive alors avec son numero deja saisi.
  if (cible && client?.telephone) {
    const tel = String(client.telephone).replace(/\s/g, '');
    const national = tel.replace(/^\+?221/, '');

    const params = new URLSearchParams({
      pn: tel.startsWith('+') ? tel : `+221${national}`,
      nn: national,
      fn: client.nom || '',
      tp: cible,
      // 0 = saisie manuelle, obligatoire pour la carte bancaire
      nac: cible === 'Carte Bancaire' ? '0' : '1',
    });

    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  return { token: json.token, url, env: ENV };
};

/**
 * Verifie l'authenticite d'une notification.
 *
 * Deux methodes, dans l'ordre de preference de PayTech :
 *   1. HMAC-SHA256 sur "montant|ref_command|api_key", signe avec le secret
 *   2. comparaison des SHA256 des deux cles
 *
 * La comparaison se fait en temps constant : une comparaison naive
 * permettrait de deviner la signature octet par octet en mesurant le
 * temps de reponse.
 */
const verifierNotification = (corps) => {
  if (!API_KEY || !API_SECRET) return false;

  const egal = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  };

  // --- Methode 1 : HMAC ---
  if (corps.hmac_compute) {
    const montant = corps.final_item_price || corps.item_price;
    const message = `${montant}|${corps.ref_command}|${API_KEY}`;
    const attendu = crypto.createHmac('sha256', API_SECRET).update(message).digest('hex');
    return egal(attendu, String(corps.hmac_compute));
  }

  // --- Methode 2 : empreintes des cles ---
  const cleAttendue = crypto.createHash('sha256').update(API_KEY).digest('hex');
  const secretAttendu = crypto.createHash('sha256').update(API_SECRET).digest('hex');

  return (
    egal(cleAttendue, String(corps.api_key_sha256 || '')) &&
    egal(secretAttendu, String(corps.api_secret_sha256 || ''))
  );
};

/**
 * Le champ custom_field revient encode en Base64 dans les IPN,
 * mais pas toujours selon les versions. On gere les deux cas.
 */
const lireDonnees = (custom_field) => {
  if (!custom_field) return {};

  const essayer = (texte) => {
    try {
      return JSON.parse(texte);
    } catch {
      return null;
    }
  };

  return (
    essayer(custom_field) ||
    essayer(Buffer.from(String(custom_field), 'base64').toString('utf-8')) ||
    {}
  );
};

/**
 * Interroge PayTech sur l'etat d'un paiement.
 * Utile en secours : si une notification n'est jamais arrivee,
 * on peut reconcilier une commande a la demande.
 */
const consulterStatut = async (token) => {
  const reponse = await fetch(
    `${BASE_URL}/payment/get-status?token_payment=${encodeURIComponent(token)}`,
    { method: 'GET', headers: entetes() },
  );
  return reponse.json();
};

module.exports = {
  demanderPaiement,
  verifierNotification,
  lireDonnees,
  consulterStatut,
  METHODES,
  ENV,
};
