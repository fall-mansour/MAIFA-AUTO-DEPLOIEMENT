import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { environment } from '../../environnement';
import { SessionService } from '../../session.service';
import { BoutonsFlottants } from '../../boutons-flottants';

interface Vehicule {
  id: number;
  modele: string;
  id_marque: number;
  rappel_marque: string;
}

interface DemandeForm {
  marque: string;
  modele: string;
  annee: string | number;
  description: string;
  // Coordonnees : saisies par le visiteur, ou pre-remplies depuis son compte
  nom: string;
  email: string;
  telephone: string;
}

interface DemandePayload {
  nom: string;
  email: string;
  telephone: string;
  marque: string;
  modele: string;
  annee: string;
  description: string;
}

const ANNEE_MIN = 1980;
const DESCRIPTION_MIN = 10;

/** Numero professionnel, pour le lien WhatsApp de secours */
const NUMERO_WHATSAPP = '221781970151';

@Component({
  selector: 'app-demande',
  standalone: true,
  imports: [CommonModule, FormsModule, BoutonsFlottants],
  templateUrl: './demande.html',
  styleUrl: './demande.scss',
})
export class DemandeComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionService);

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse
  // asynchrone, sinon les listes et les notifications ne s'affichent pas
  private readonly cdr = inject(ChangeDetectorRef);

  // Objet pour stocker les donnees du formulaire
  demande: DemandeForm = this.formulaireVide();

  // Donnees pour les menus deroulants dynamiques
  allVehicules: Vehicule[] = [];
  marques: string[] = [];
  modelesFiltr: string[] = [];

  // Liste d'annees prete a l'emploi pour un <select> (de l'annee prochaine a ANNEE_MIN)
  readonly anneeMax = new Date().getFullYear() + 1;
  readonly annees: number[] = Array.from(
    { length: this.anneeMax - ANNEE_MIN + 1 },
    (_, i) => this.anneeMax - i,
  );

  /** Lien de repli, pour qui prefere ecrire directement */
  readonly lienWhatsApp =
    `https://wa.me/${NUMERO_WHATSAPP}?text=` +
    encodeURIComponent('Bonjour MAIFA-AUTO, je recherche une pièce pour mon véhicule.');

  // Etats de l'interface utilisateur
  isLoading = false; // envoi de la demande en cours
  isLoadingModeles = false; // chargement des marques et modeles en cours
  successMessage = '';
  errorMessage = '';

  ngOnInit(): void {
    this.preremplirCoordonnees();
    this.loadModeles();
  }

  // ---------------------------------------------------------------------
  // Etat de connexion
  // ---------------------------------------------------------------------

  /**
   * Vrai si un utilisateur est connecte.
   * Lu directement dans SessionService, seule source de verite :
   * l'ancienne cle localStorage 'currentUser' n'est plus alimentee.
   */
  get estConnecte(): boolean {
    return this.session.estConnecte();
  }

  /** Au moins un moyen de contact, sinon impossible de repondre au client */
  get contactRenseigne(): boolean {
    return !!(this.demande.telephone?.trim() || this.demande.email?.trim());
  }

  /**
   * Vrai quand le formulaire peut etre envoye.
   * Utilisable dans le template : [disabled]="!canSubmit"
   */
  get canSubmit(): boolean {
    return !this.isLoading && this.validerFormulaire() === null;
  }

  /**
   * Un client connecte n'a pas a ressaisir ses coordonnees.
   * Les champs restent modifiables : il peut vouloir etre rappele
   * sur un autre numero que celui de son compte.
   */
  private preremplirCoordonnees(): void {
    const u = this.session.utilisateur();
    if (!u) return;

    this.demande.nom = [u.prenom, u.nom].filter(Boolean).join(' ');
    this.demande.email = u.mail || '';
    this.demande.telephone = u.telephone || '';
  }

  // ---------------------------------------------------------------------
  // 1. Referentiel vehicules
  // ---------------------------------------------------------------------

  loadModeles(): void {
    this.isLoadingModeles = true;

    this.http
      .get<Vehicule[]>(`${environment.apiUrl}/modeles/all`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isLoadingModeles = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (data) => {
          this.allVehicules = Array.isArray(data) ? data : [];

          // Marques uniques, sans valeur vide, triees selon l'alphabet francais
          this.marques = [
            ...new Set(
              this.allVehicules.map((v) => v.rappel_marque?.trim()).filter((m): m is string => !!m),
            ),
          ].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

          // Si une marque etait deja choisie (rechargement), on recalcule ses modeles
          if (this.demande.marque) {
            this.modelesFiltr = this.modelesDe(this.demande.marque);
          }
        },
        error: (err: HttpErrorResponse) => {
          console.error('❌ Erreur lors du chargement des modèles :', err);
          this.errorMessage = 'Impossible de charger la liste des véhicules.';
        },
      });
  }

  /** 2. Filtre les modeles des que la marque change */
  onMarqueChange(): void {
    this.demande.modele = '';
    this.modelesFiltr = this.modelesDe(this.demande.marque);
  }

  // ---------------------------------------------------------------------
  // 3. Envoi de la demande
  //
  // La connexion n'est plus exigee : un visiteur peut chercher une
  // piece sans avoir de compte, et l'obliger a s'inscrire d'abord
  // ferait perdre une bonne partie des demandes. Il laisse
  // simplement un moyen de contact.
  // ---------------------------------------------------------------------

  onSendDemande(): void {
    // Anti double clic
    if (this.isLoading) return;

    this.errorMessage = '';
    this.successMessage = '';

    // Validation des champs avant tout appel reseau
    const erreur = this.validerFormulaire();
    if (erreur) {
      this.errorMessage = erreur;
      this.cdr.markForCheck();
      return;
    }

    // Objet final pour demande.controller.js
    const payload: DemandePayload = {
      nom: this.demande.nom.trim(),
      email: this.demande.email.trim().toLowerCase(),
      telephone: this.demande.telephone.trim(),
      marque: this.demande.marque,
      modele: this.demande.modele,
      annee: String(this.demande.annee).trim(),
      description: this.demande.description.trim(),
    };

    // On verrouille l'interface pendant l'envoi
    this.isLoading = true;
    this.cdr.markForCheck();

    this.http
      .post(`${environment.apiUrl}/demande`, payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (res) => {
          console.log('✅ Demande envoyée :', res);
          this.successMessage = "Votre demande a été transmise avec succès à l'équipe.";

          // On vide le vehicule et la description, mais PAS les coordonnees :
          // un client qui fait une seconde demande n'a pas a les ressaisir
          this.demande = {
            ...this.formulaireVide(),
            nom: this.demande.nom,
            email: this.demande.email,
            telephone: this.demande.telephone,
          };
          this.modelesFiltr = [];

          // La notification disparait seule apres quelques secondes
          setTimeout(() => {
            this.successMessage = '';
            this.cdr.markForCheck();
          }, 6000);
        },
        error: (err: HttpErrorResponse) => {
          console.error('❌ Erreur envoi demande :', err);
          this.errorMessage = this.messageErreur(err);
        },
      });
  }

  // ---------------------------------------------------------------------
  // Methodes internes
  // ---------------------------------------------------------------------

  private formulaireVide(): DemandeForm {
    return {
      marque: '',
      modele: '',
      annee: '',
      description: '',
      nom: '',
      email: '',
      telephone: '',
    };
  }

  /** Modeles uniques d'une marque, tries */
  private modelesDe(marque: string): string[] {
    if (!marque) return [];

    return [
      ...new Set(
        this.allVehicules
          .filter((v) => v.rappel_marque?.trim() === marque)
          .map((v) => v.modele?.trim())
          .filter((m): m is string => !!m),
      ),
    ].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }));
  }

  /** Retourne un message d'erreur, ou null si le formulaire est valide */
  private validerFormulaire(): string | null {
    if (!this.demande.marque) return 'Veuillez choisir une marque.';
    if (!this.demande.modele) return 'Veuillez choisir un modèle.';

    const annee = Number(String(this.demande.annee).trim());
    if (!Number.isInteger(annee) || annee < ANNEE_MIN || annee > this.anneeMax) {
      return `Veuillez choisir une année valide, entre ${ANNEE_MIN} et ${this.anneeMax}.`;
    }

    if (this.demande.description.trim().length < DESCRIPTION_MIN) {
      return `Veuillez décrire la pièce recherchée (au moins ${DESCRIPTION_MIN} caractères).`;
    }

    if (!this.demande.nom.trim()) {
      return 'Veuillez indiquer votre nom.';
    }

    if (!this.contactRenseigne) {
      return 'Indiquez au moins un téléphone ou un email pour que nous puissions vous répondre.';
    }

    const email = this.demande.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "L'adresse email semble incorrecte.";
    }

    const tel = this.demande.telephone.replace(/\D/g, '');
    if (this.demande.telephone.trim() && tel.length < 9) {
      return 'Le numéro de téléphone semble incomplet (9 chiffres attendus).';
    }

    return null;
  }

  /** Message lisible selon le type d'echec HTTP */
  private messageErreur(err: HttpErrorResponse): string {
    if (err.status === 0) {
      return 'Serveur injoignable. Vérifiez votre connexion internet puis réessayez.';
    }
    if (err.status === 400 || err.status === 422) {
      // Le serveur explique precisement ce qui manque : autant l'afficher
      return err.error?.error || err.error?.message || 'Certaines informations sont invalides.';
    }
    if (err.status === 429) {
      return 'Trop de demandes envoyées. Merci de patienter quelques minutes.';
    }
    if (err.status === 500 && err.error?.error) {
      return err.error.error;
    }
    return "Une erreur est survenue lors de l'envoi. Veuillez réessayer.";
  }
}
