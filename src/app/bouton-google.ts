import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  PLATFORM_ID,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from './environnement';
import { SessionService } from './session.service';

declare const google: any;

/**
 * Bouton « Continuer avec Google », utilisable sur la connexion
 * comme sur l'inscription.
 *
 * Le composant charge la bibliothèque Google, affiche le bouton officiel,
 * transmet le jeton d'identité au backend et ouvre la session.
 * Le parent n'a qu'à écouter (connecte) pour rediriger.
 */
@Component({
  selector: 'app-bouton-google',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="google-zone">
      <div class="google-sep" *ngIf="separateur">
        <span>ou</span>
      </div>

      <!-- Google injecte son bouton ici -->
      <div #zone class="google-btn"></div>

      <p class="google-attente" *ngIf="!pret && !erreur">Chargement de Google…</p>
      <p class="google-erreur" *ngIf="erreur">{{ erreur }}</p>
    </div>
  `,
  styles: [
    `
      .google-zone {
        width: 100%;
      }

      .google-sep {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 18px 0;
        color: #93a2c0;
        font-size: 0.85rem;
      }

      .google-sep::before,
      .google-sep::after {
        content: '';
        flex: 1;
        height: 1px;
        background: #e6ecf7;
      }

      .google-btn {
        display: flex;
        justify-content: center;
        min-height: 44px;
      }

      .google-attente,
      .google-erreur {
        margin: 8px 0 0;
        font-size: 0.84rem;
        text-align: center;
        color: #93a2c0;
      }

      .google-erreur {
        color: #dc2626;
      }
    `,
  ],
})
export class BoutonGoogle implements OnInit {
  /** Affiche un séparateur « ou » au-dessus du bouton */
  @Input() separateur = true;

  /** Texte du bouton Google : signin_with, signup_with, continue_with */
  @Input() texte: 'signin_with' | 'signup_with' | 'continue_with' = 'continue_with';

  @Output() connecte = new EventEmitter<any>();
  @Output() echec = new EventEmitter<string>();

  @ViewChild('zone', { static: true }) zone!: ElementRef<HTMLDivElement>;

  pret = false;
  erreur: string | null = null;

  private readonly platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    // La bibliothèque Google n'existe pas côté serveur (SSR)
    if (!isPlatformBrowser(this.platformId)) return;

    if (!environment.googleClientId) {
      this.erreur = 'Identifiant Google non configuré.';
      return;
    }

    this.chargerBibliotheque()
      .then(() => this.afficherBouton())
      .catch(() => {
        this.erreur = 'Google est momentanément indisponible.';
        this.cdr.markForCheck();
      });
  }

  /** Charge le script une seule fois, même avec plusieurs boutons sur la page */
  private chargerBibliotheque(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google.accounts) return resolve();

      const existant = document.getElementById('google-identity');
      if (existant) {
        existant.addEventListener('load', () => resolve());
        existant.addEventListener('error', () => reject());
        return;
      }

      const script = document.createElement('script');
      script.id = 'google-identity';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject();
      document.head.appendChild(script);
    });
  }

  private afficherBouton(): void {
    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (reponse: any) => this.envoyerAuServeur(reponse.credential),
      // Pas de One Tap automatique : le client clique quand il le décide
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    google.accounts.id.renderButton(this.zone.nativeElement, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: this.texte,
      locale: 'fr',
      width: 320,
    });

    this.pret = true;
    this.cdr.markForCheck();
  }

  /** Le jeton est vérifié côté serveur, jamais ici */
  private envoyerAuServeur(credential: string): void {
    this.erreur = null;
    this.cdr.markForCheck();

    this.http.post<any>(`${environment.apiUrl}/connexion/google`, { credential }).subscribe({
      next: (res) => {
        this.session.connecter(res);
        this.connecte.emit(res);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.erreur = err.error?.message || 'Connexion Google impossible.';
        this.echec.emit(this.erreur!);
        this.cdr.markForCheck();
      },
    });
  }
}
