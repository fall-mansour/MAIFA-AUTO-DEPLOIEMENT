const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// 1. Initialisation de l'application
const app = express();

// 2. Importation de la connexion DB
const db = require('./db');

// 3. Vérification de la connexion Cloudinary au démarrage
const { verifierConnexion } = require('./cloudinaryConfig');

// 4. Importation de TOUTES les routes (Client + Gestion)
const acceuilRoutes = require('./routes/acceuil');
const compteRoutes = require('./routes/compte');
const connexionRoutes = require('./routes/connexion');
const modelesRoutes = require('./routes/modeles');
const demandeRoutes = require('./routes/demande');
const pieceRoutes = require('./routes/Piece'); // fiche détaillée d'une pièce (singulier)
const journalRoutes = require('./routes/journal');
const PiecesRoutes = require('./routes/ajoutpieces');
const StockRoutes = require('./routes/stock');
const DashboardRoutes = require('./routes/dashboard');
const paiementRoutes = require('./routes/Paiement');
const panierRoutes = require('./routes/panier');
const profilRoutes = require('./routes/profil');
const importRoutes = require('./routes/import');

// --- MIDDLEWARES ---
// En production, restreindre aux domaines réels :
// app.use(cors({ origin: ['http://localhost:4200', 'https://ton-domaine.com'] }));
app.use(cors());
app.use(express.json());

/**
 * Dossier d'images locales.
 * Les nouvelles pièces passent par Cloudinary ; ce dossier ne sert
 * plus que pour d'éventuels fichiers historiques.
 */
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- ROUTES API ---

// Partie Client
app.use('/api/acceuil', acceuilRoutes);
app.use('/api/compte', compteRoutes);
app.use('/api/connexion', connexionRoutes);
app.use('/api/modeles', modelesRoutes); // référentiel : marques, modèles, catégories
app.use('/api/demande', demandeRoutes);
app.use('/api/piece', pieceRoutes); // ⚠️ SINGULIER : fiche détaillée
app.use('/api/paiement', paiementRoutes);
app.use('/api/profil', profilRoutes);
app.use('/api/vin', require('./routes/vin'));

// Partie Gestion (Admin)
app.use('/api/pieces', PiecesRoutes); // ⚠️ PLURIEL : ajout de pièces
app.use('/api/stock', StockRoutes);
app.use('/api/dashboard', DashboardRoutes);
app.use('/api/panier', panierRoutes);
app.use('/api/import', importRoutes);
app.use('/api/journal', journalRoutes);

// Route de base
app.get('/', (req, res) => {
  res.send('🚀 API Teranga Motors Unifiée et en ligne !');
});

// --- GESTION DES ERREURS ---

// 404 : aucune route ne correspond, on répond en JSON et non en HTML
app.use((req, res) => {
  res.status(404).json({ message: `Route introuvable : ${req.method} ${req.originalUrl}` });
});

// Erreurs non gérées : renvoie un JSON exploitable côté Angular
// (doit être déclaré en DERNIER, avec ses 4 paramètres)
app.use((err, req, res, next) => {
  console.error('💥 Erreur non gérée :', err);
  res.status(err.http_code || err.status || 500).json({
    message: err.message || 'Erreur interne du serveur.',
  });
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('=======================================================');
  console.log(`✅ SERVEUR UNIFIÉ TERANGA MOTORS ACTIF`);
  console.log(`🔗 URL API : http://localhost:${PORT}/api`);
  console.log(`🖼️  DOSSIER IMAGES : http://localhost:${PORT}/uploads`);

  // Diagnostic Cloudinary : on le sait au démarrage, pas au premier upload raté
  if (typeof verifierConnexion === 'function') {
    await verifierConnexion();
  }

  console.log('=======================================================');
});
