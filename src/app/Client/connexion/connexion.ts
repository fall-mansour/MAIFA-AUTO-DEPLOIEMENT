// src/app/Client/connexion/connexion.ts
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ConnexionService } from '../../connexion.service';
import { SessionService } from '../../session.service';
import { BoutonGoogle } from '../../bouton-google';

@Component({
  selector: 'app-connexion',
  standalone: true,
  imports: [RouterModule, FormsModule, CommonModule, BoutonGoogle],
  templateUrl: './connexion.html',
  styleUrl: './connexion.scss',
})
export class ConnexionComponent implements OnInit, OnDestroy {
  email: string = '';
  password: string = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  /** Affichage du mot de passe en clair */
  voirMotDePasse = false;

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse
  // asynchrone, sinon les messages ne s'affichent jamais
  private cdr = inject(ChangeDetectorRef);
  private session = inject(SessionService);
  private route = inject(ActivatedRoute);
  private minuteur?: any;

  constructor(
    private router: Router,
    private connexionService: ConnexionService,
  ) {}

  ngOnInit(): void {
    // Session arrivee a echeance : le service pose ce parametre en redirigeant
    if (this.route.snapshot.queryParams['expiree']) {
      this.errorMessage = 'Votre session a expiré. Reconnectez-vous pour continuer.';
    }

    // Retour depuis une page protegee : on le signale
    if (this.route.snapshot.queryParams['retour']) {
      this.errorMessage = 'Cette page nécessite une connexion.';
    }
  }

  ngOnDestroy(): void {
    // Sans cela, la redirection se declenche meme apres avoir quitte la page
    if (this.minuteur) clearTimeout(this.minuteur);
  }

  // ==========================================================
  //  CONNEXION PAR MOT DE PASSE
  // ==========================================================
  onSubmit() {
    // 1. Réinitialisation des états
    this.errorMessage = '';
    this.successMessage = '';
    this.isLoading = true;

    // 2. Validation de base
    if (!this.email || !this.password) {
      this.errorMessage = 'Veuillez remplir tous les champs.';
      this.isLoading = false;
      this.cdr.markForCheck();
      return;
    }

    console.log('🚀 Tentative de connexion envoyée...');

    // 3. Appel au service
    this.connexionService.login(this.email.trim(), this.password).subscribe({
      next: (res: any) => {
        this.isLoading = false;

        // 4. Ouverture de la session : jeton, echeance et profil.
        //    Sans cela, l'application ne sait pas qui est connecte
        //    des qu'on change de page.
        this.session.connecter(res);

        this.successMessage = `Connexion réussie. Bienvenue ${res.user.prenom}, redirection en cours…`;
        this.cdr.markForCheck();

        console.log('💎 Utilisateur connecté :', res.user.prenom, `(${res.user.role})`);

        // 5. Courte pause pour laisser lire le message, puis redirection
        //    selon le role : un gestionnaire va droit aux commandes.
        this.minuteur = setTimeout(() => {
          this.router.navigate([this.destination(res.user.role)]);
        }, 1800);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || 'Identifiants incorrects ou problème réseau.';
        this.cdr.markForCheck();
        console.error('❌ Erreur de connexion :', err);
      },
    });
  }

  // ==========================================================
  //  CONNEXION GOOGLE
  //  Le composant BoutonGoogle a deja ouvert la session
  // ==========================================================
  apresGoogle(res: any): void {
    this.errorMessage = '';
    this.successMessage = `Bienvenue ${res.user.prenom}, redirection en cours…`;
    this.cdr.markForCheck();

    this.minuteur = setTimeout(() => {
      // Compte Google sans telephone ni vehicule : on invite a completer
      if (res.profil_incomplet) {
        this.router.navigate(['/compte'], { queryParams: { completer: 1 } });
        return;
      }
      this.router.navigate([this.destination(res.user.role)]);
    }, 1200);
  }

  /** Page d'arrivee apres connexion */
  private destination(role: string): string {
    // Si l'utilisateur venait d'une page protegee, on l'y ramene
    const retour = this.route.snapshot.queryParams['retour'];
    if (retour) return retour;

    // Un gestionnaire arrive sur son tableau de bord, pas sur la vitrine
    return role === 'gestionnaire' ? '/Dashboard' : '/';
  }
}
