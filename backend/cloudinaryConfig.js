// ============================================================
//  TERANGA MOTORS — CONFIGURATION CLOUDINARY
//  Upload (multer) + suppression des images + diagnostic
// ============================================================

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// ------------------------------------------------------------
//  1. CONNEXION
//  Les valeurs du .env priment ; sinon on retombe sur celles-ci.
//  ⚠️ À terme, garder uniquement process.env et vider ce fichier
//     de toute donnée sensible (voir note en bas).
// ------------------------------------------------------------
const CONFIG = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dtwsxs2pz',
  api_key: process.env.CLOUDINARY_API_KEY || '742635421594659',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'kLRnDLU7ZMJFu4RRZeN6ATqfde4',
  secure: true, // force les URLs en https
};

cloudinary.config(CONFIG);

// ------------------------------------------------------------
//  2. STOCKAGE MULTER -> CLOUDINARY
// ------------------------------------------------------------
const FORMATS_AUTORISES = ['jpg', 'jpeg', 'png', 'webp'];
const TAILLE_MAX = 5 * 1024 * 1024; // 5 Mo par fichier

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'teranga_motors',
    allowed_formats: FORMATS_AUTORISES,
    // Nom lisible dans le dashboard : piece-img1-1712345678901
    public_id: `piece-${file.fieldname}-${Date.now()}`,
    // Redimensionne à l'upload : allège le stockage et accélère le catalogue
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }],
  }),
});

/** Refuse tout ce qui n'est pas une image, avant même l'envoi à Cloudinary */
const fileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Seules les images sont acceptées (jpg, png, webp).'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: TAILLE_MAX, files: 5 },
});

// ------------------------------------------------------------
//  3. SUPPRESSION DES IMAGES
// ------------------------------------------------------------

/**
 * Reconstruit le public_id à partir de l'URL sécurisée stockée en base.
 *
 * https://res.cloudinary.com/dtwsxs2pz/image/upload/v1712345678/teranga_motors/piece-img1-171234.jpg
 *   -> teranga_motors/piece-img1-171234
 *
 * Gère aussi les URLs contenant des transformations :
 * .../upload/w_500,c_fill/v1712345678/teranga_motors/abc.png -> teranga_motors/abc
 */
const extractPublicId = (url) => {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return null;

  const chemin = url.split('/upload/')[1].split('?')[0];
  const segments = chemin.split('/');

  // Le segment de version (v1712345678) sépare les transformations du public_id
  const indexVersion = segments.findIndex((s) => /^v\d+$/.test(s));
  const utiles = indexVersion >= 0 ? segments.slice(indexVersion + 1) : segments;

  if (utiles.length === 0) return null;

  return utiles.join('/').replace(/\.[a-zA-Z0-9]+$/, '');
};

/**
 * Supprime sur Cloudinary les images correspondant aux URLs fournies.
 * Ne lève jamais d'exception : renvoie un rapport que l'appelant peut logger.
 *
 * @param {Array<string|null>} urls
 * @returns {Promise<{demandees:number, supprimees:number, publicIds:string[], erreur:string|null}>}
 */
const supprimerImages = async (urls = []) => {
  const publicIds = urls.map(extractPublicId).filter(Boolean);

  if (publicIds.length === 0) {
    return { demandees: 0, supprimees: 0, publicIds: [], erreur: null };
  }

  try {
    // delete_resources accepte jusqu'à 100 public_ids par appel
    const resultat = await cloudinary.api.delete_resources(publicIds, {
      resource_type: 'image',
      invalidate: true, // purge aussi le cache CDN
    });

    const supprimees = Object.values(resultat.deleted || {}).filter(
      (etat) => etat === 'deleted',
    ).length;

    return { demandees: publicIds.length, supprimees, publicIds, erreur: null };
  } catch (error) {
    const message = lireErreur(error);
    console.error('⚠️ Suppression Cloudinary échouée :', message);
    return { demandees: publicIds.length, supprimees: 0, publicIds, erreur: message };
  }
};

/**
 * Supprime les fichiers déjà envoyés à Cloudinary quand l'insertion SQL échoue.
 * À appeler dans le catch du contrôleur d'ajout pour éviter les images orphelines.
 * @param {object} files - req.files de multer
 */
const nettoyerUploads = async (files = {}) => {
  const urls = Object.values(files)
    .flat()
    .map((f) => f.path);
  return supprimerImages(urls);
};

// ------------------------------------------------------------
//  4. DIAGNOSTIC
// ------------------------------------------------------------

/** Les erreurs Cloudinary arrivent souvent sous la forme { error: { message } } */
const lireErreur = (e) =>
  e?.error?.message || e?.message || (typeof e === 'string' ? e : JSON.stringify(e));

/**
 * Teste la connexion au démarrage. À appeler depuis server.js.
 * @returns {Promise<boolean>}
 */
const verifierConnexion = async () => {
  try {
    await cloudinary.api.ping();
    console.log(`☁️  Cloudinary connecté (cloud : ${CONFIG.cloud_name})`);
    return true;
  } catch (error) {
    console.error('❌ Cloudinary injoignable :', lireErreur(error));
    console.error(
      `   cloud_name: ${CONFIG.cloud_name} | api_key: ${CONFIG.api_key} | secret défini: ${!!CONFIG.api_secret}`,
    );
    return false;
  }
};

module.exports = {
  cloudinary,
  upload,
  extractPublicId,
  supprimerImages,
  nettoyerUploads,
  verifierConnexion,
  lireErreur,
};
