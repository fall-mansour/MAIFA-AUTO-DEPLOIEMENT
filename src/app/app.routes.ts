import { Routes } from '@angular/router';

// --- Espace de gestion ---
import { Ajoutpieces } from './Gestion/ajoutpieces/ajoutpieces';
import { Dashboard } from './Gestion/dashboard/dashboard';
import { Stock } from './Gestion/stock/stock';
import { Commandes } from './Gestion/commandes/commandes';
import { ImportComponent } from './Gestion/import/import';
import { SuiviGestionnaireComponent } from './Gestion/suivigestionnaire/suivigestionnaire';
import { responsableGuard } from './responsable.guard';

// --- Espace client ---
import { Acceuil } from './Client/acceuil/acceuil';
import { PieceDetail } from './Client/piece/piece';
import { CompteComponent } from './Client/compte/compte';
import { ConnexionComponent } from './Client/connexion/connexion';
import { PasswordComponent } from './Client/password/password';
import { DemandeComponent } from './Client/demande/demande';
import { PanierPage } from './Client/panier/panier';

import { gestionnaireGuard } from './gestionnaire.guard';
import { ProfilComponent } from './Client/profil/profil';

export const routes: Routes = [
  // ==========================================================
  //  ESPACE DE GESTION
  //
  //  gestionnaireGuard masque l'interface. La vraie protection
  //  reste le middleware exigerRole() cote serveur, qui refuse
  //  les donnees. Les deux couches sont necessaires : sans le
  //  garde, la page s'afficherait vide et pleine d'erreurs.
  // ==========================================================
  {
    path: 'Dashboard',
    component: Dashboard,
    canActivate: [gestionnaireGuard],
    title: 'Tableau de bord — MAIFA-AUTO',
  },
  {
    path: 'ajoutpieces',
    component: Ajoutpieces,
    canActivate: [gestionnaireGuard],
    title: 'Ajouter une pièce — MAIFA-AUTO',
  },
  {
    path: 'stock',
    component: Stock,
    canActivate: [gestionnaireGuard],
    title: 'Gestion du stock — MAIFA-AUTO',
  },
  {
    path: 'Commandes',
    component: Commandes,
    canActivate: [gestionnaireGuard],
    title: 'Commandes — MAIFA-AUTO',
  },

  {
    path: 'Import',
    component: ImportComponent,
    canActivate: [gestionnaireGuard],
    title: 'Import/Export — MAIFA-AUTO',
  },

  {
    path: 'suivi',
    loadComponent: () =>
      import('./Gestion/suivigestionnaire/suivigestionnaire').then(
        (m) => m.SuiviGestionnaireComponent,
      ),
    canActivate: [responsableGuard],
  },

  // ==========================================================
  //  ESPACE CLIENT
  // ==========================================================
  {
    path: '',
    component: Acceuil,
    pathMatch: 'full',
    title: 'MAIFA-AUTO — Le coin des mécanos',
  },

  // Fiche piece : le slug se termine par l'identifiant
  // ex. /piece/plaquettes-de-frein-avant-renault-clio-v-42
  { path: 'piece/:slug', component: PieceDetail, title: 'Détail de la pièce — MAIFA-AUTO' },

  { path: 'Panier', component: PanierPage, title: 'Mon panier — MAIFA-AUTO' },
  { path: 'login', component: ConnexionComponent, title: 'Connexion — MAIFA-AUTO' },
  { path: 'compte', component: CompteComponent, title: 'Créer un compte — MAIFA-AUTO' },
  { path: 'password', component: PasswordComponent, title: 'Mot de passe — MAIFA-AUTO' },
  { path: 'demande', component: DemandeComponent, title: 'Demande de pièce — MAIFA-AUTO' },
  { path: 'profil', component: ProfilComponent, title: 'Mon profil — MAIFA-AUTO' },

  // ==========================================================
  //  COMPATIBILITE DE CASSE
  //
  //  Le routage Angular distingue les majuscules : /Panier et
  //  /panier sont deux adresses differentes. Ces redirections
  //  rattrapent les anciens liens et les favoris deja enregistres.
  // ==========================================================
  { path: 'Panier', redirectTo: 'panier', pathMatch: 'full' },
  { path: 'Commandes', redirectTo: 'commandes', pathMatch: 'full' },
  { path: 'Stock', redirectTo: 'stock', pathMatch: 'full' },
  { path: 'Login', redirectTo: 'login', pathMatch: 'full' },
  { path: 'Compte', redirectTo: 'compte', pathMatch: 'full' },

  // ==========================================================
  //  REPLI : toute URL inconnue renvoie a l'accueil
  //  A garder en DERNIERE position, sinon il intercepte tout.
  // ==========================================================
  { path: '**', redirectTo: '' },
];
