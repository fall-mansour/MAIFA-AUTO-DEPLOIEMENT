import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Ajoutpieces } from './Gestion/ajoutpieces/ajoutpieces';
import { Dashboard } from './Gestion/dashboard/dashboard';
import { Stock } from './Gestion/stock/stock';
import { Acceuil } from './Client/acceuil/acceuil';
import { PieceDetail } from './Client/piece/piece';
import { PanierPage } from './Client/panier/panier';
import { Commandes } from './Gestion/commandes/commandes';
import { DemandeComponent } from './Client/demande/demande';
import { ProfilComponent } from './Client/profil/profil';
import { ImportComponent } from './Gestion/import/import';
import { SuiviGestionnaireComponent } from './Gestion/suivigestionnaire/suivigestionnaire';

@Component({
  selector: 'app-root',
  imports: [
    Acceuil,
    RouterOutlet,
    Ajoutpieces,
    Dashboard,
    Stock,
    PieceDetail,
    PanierPage,
    Commandes,
    DemandeComponent,
    ProfilComponent,
    ImportComponent,
    SuiviGestionnaireComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('gestion');
}
