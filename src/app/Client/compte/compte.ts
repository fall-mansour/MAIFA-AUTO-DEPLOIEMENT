import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CompteService } from '../../compte.service';
import { environment } from '../../environnement';
import { BoutonGoogle } from '../../bouton-google';

interface Marque {
  id: number;
  nom: string;
}
interface Modele {
  id: number;
  modele: string;
}

@Component({
  selector: 'app-compte',
  templateUrl: './compte.html',
  styleUrls: ['./compte.scss'],
  standalone: true,
  // RouterModule : le template utilise routerLink
  imports: [FormsModule, CommonModule, RouterModule, BoutonGoogle],
})
export class CompteComponent implements OnInit, OnDestroy {
  prenom: string = '';
  nom: string = '';
  mail: string = '';
  password: string = '';
  confirmation: string = '';
  telephone: string = '';
  adresse: string = '';
  marque_vehicule: string = '';
  modele_vehicule: string = '';
  annee: number | null = null;

  isLoading = false;
  errorMessage = '';
  successMessage = '';
  countdown: number = 3;

  /** Affichage du mot de passe en clair */
  voirMotDePasse = false;

  /** Referentiel vehicules, charge depuis la base */
  marques: Marque[] = [];
  modeles: Modele[] = [];
  chargementModeles = false;

  years: number[] = Array.from({ length: 30 }, (_, i) => 2026 - i);

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse
  // asynchrone, sinon les listes et les messages ne s'affichent pas
  private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient);

  private interval?: any;
  private minuteur?: any;

  constructor(
    private router: Router,
    private compteService: CompteService,
  ) {}

  ngOnInit(): void {
    this.chargerMarques();
  }

  ngOnDestroy(): void {
    // Sans cela, le decompte continue et la redirection se declenche
    // meme apres avoir quitte la page
    if (this.interval) clearInterval(this.interval);
    if (this.minuteur) clearTimeout(this.minuteur);
  }

  // ==========================================================
  //  RÉFÉRENTIEL VÉHICULES
  // ==========================================================
  private chargerMarques(): void {
    this.http.get<Marque[]>(`${environment.apiUrl}/modeles/marques`).subscribe({
      next: (data) => {
        this.marques = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('❌ Chargement des marques :', err),
    });
  }

  /** Le choix d'une marque recharge la liste de ses modeles */
  onMarqueChange(nomMarque: string): void {
    this.modele_vehicule = '';
    this.modeles = [];
    if (!nomMarque) return;

    const marque = this.marques.find((m) => m.nom === nomMarque);
    if (!marque) return;

    this.chargementModeles = true;
    this.http
      .get<Modele[]>(`${environment.apiUrl}/modeles/marques/${marque.id}/modeles`)
      .subscribe({
        next: (data) => {
          this.modeles = data;
          this.chargementModeles = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('❌ Chargement des modèles :', err);
          this.chargementModeles = false;
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  ROBUSTESSE DU MOT DE PASSE
  // ==========================================================
  /** Repere visuel affiche sous le champ mot de passe */
  get forceMotDePasse(): { niveau: number; libelle: string; classe: string } {
    const mdp = this.password || '';
    let niveau = 0;

    if (mdp.length >= 6) niveau++;
    if (mdp.length >= 10) niveau++;
    if (/[A-Z]/.test(mdp) && /[a-z]/.test(mdp)) niveau++;
    if (/[0-9]/.test(mdp) && /[^A-Za-z0-9]/.test(mdp)) niveau++;

    if (niveau <= 1) return { niveau, libelle: 'Faible', classe: 'est-faible' };
    if (niveau === 2) return { niveau, libelle: 'Moyen', classe: 'est-moyen' };
    if (niveau === 3) return { niveau, libelle: 'Bon', classe: 'est-bon' };
    return { niveau, libelle: 'Excellent', classe: 'est-bon' };
  }

  // ==========================================================
  //  CRÉATION DU COMPTE
  // ==========================================================
  creerCompte() {
    if (!this.prenom || !this.nom || !this.mail || !this.password) {
      this.errorMessage = 'Veuillez remplir tous les champs obligatoires.';
      this.cdr.markForCheck();
      return;
    }

    if (this.password !== this.confirmation) {
      this.errorMessage = 'Les deux mots de passe ne correspondent pas.';
      this.cdr.markForCheck();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    const payload = {
      prenom: this.prenom.trim(),
      nom: this.nom.trim(),
      mail: this.mail.trim().toLowerCase(),
      password: this.password,
      telephone: this.telephone || null,
      adresse: this.adresse || null,
      // Vehicule facultatif : le referentiel fournit les libelles exacts,
      // ce qui fait fonctionner le croisement du tableau de bord
      marque_vehicule: this.marque_vehicule || null,
      modele_vehicule: this.modele_vehicule || null,
      annee: this.annee ? Number(this.annee) : null,
    };

    this.compteService.inscription(payload).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMessage = res.message || 'Compte créé avec succès !';
        this.cdr.markForCheck();

        // Décompte visuel
        this.interval = setInterval(() => {
          this.countdown--;
          this.cdr.markForCheck();
          if (this.countdown <= 0) clearInterval(this.interval);
        }, 1000);

        this.minuteur = setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Erreur:', err);
        this.errorMessage = err.error?.message || "Une erreur est survenue lors de l'envoi.";
        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  INSCRIPTION VIA GOOGLE
  //  Le composant BoutonGoogle a deja ouvert la session
  // ==========================================================
  apresGoogle(res: any): void {
    this.errorMessage = '';
    this.successMessage = `Bienvenue ${res.user.prenom}, votre compte est prêt.`;
    this.cdr.markForCheck();

    this.minuteur = setTimeout(() => {
      // Un compte Google n'a ni telephone ni vehicule : on le signale
      this.router.navigate(['/'], {
        queryParams: res.profil_incomplet ? { completer: 1 } : {},
      });
    }, 1400);
  }
}
