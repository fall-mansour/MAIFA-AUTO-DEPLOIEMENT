import { Component, signal } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { Acceuil } from './acceuil/acceuil';
import {} from '@angular/common/http';
import { CompteComponent } from './compte/compte';
import { ConnexionComponent } from './connexion/connexion';
import { PasswordComponent } from './password/password';
import { DemandeComponent } from './demande/demande';
import { PanierPage } from './panier/panier';

@Component({
  selector: 'app-root',
  imports: [
    Acceuil,
    DemandeComponent,
    RouterModule,
    ConnexionComponent,
    PasswordComponent,
    CompteComponent,
    DemandeComponent,
    RouterOutlet,
    PanierPage,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('piecebi');
}
