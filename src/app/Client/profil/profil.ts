import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environnement';
import { SessionService } from '../../session.service';

interface Marque {
  id: number;
  nom: string;
}
interface Modele {
  id: number;
  modele: string;
}

interface Profil {
  id: number;
  prenom: string;
  nom: string;
  mail: string;
  role: string;
  telephone: string | null;
  adresse: string | null;
  marque_vehicule: string | null;
  modele_vehicule: string | null;
  annee: number | null;
  avatar: string | null;
  date_creacomte: string | null;
  a_mot_de_passe: boolean;
  compte_google: boolean;
}

@Component({
  selector: 'app-profil',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profil.html',
  styleUrl: './profil.scss',
})
export class ProfilComponent implements OnInit {
  profil: Profil | null = null;
  chargement = true;
  erreurChargement: string | null = null;

  /** Onglet affiche : informations, vehicule ou securite */
  onglet: 'infos' | 'vehicule' | 'securite' = 'infos';

  // --- Formulaire principal ---
  form = {
    prenom: '',
    nom: '',
    telephone: '',
    adresse: '',
    marque_vehicule: '',
    modele_vehicule: '',
    annee: '' as string | number,
  };
  enregistrement = false;

  // --- Changement d'adresse ---
  nouveauMail = '';
  motDePasseMail = '';
  envoiMail = false;

  // --- Mot de passe ---
  ancienMdp = '';
  nouveauMdp = '';
  confirmationMdp = '';
  envoiMdp = false;
  voirMdp = false;

  // --- Referentiel vehicules ---
  marques: Marque[] = [];
  modeles: Modele[] = [];
  chargementModeles = false;
  annees: number[] = [];

  // --- Retours ---
  notification: { texte: string; type: 'ok' | 'ko' } | null = null;
  private minuteurNotif?: any;

  private http = inject(HttpClient);
  private router = inject(Router);
  private session = inject(SessionService);

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse asynchrone
  private cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    // Page reservee aux comptes : sans session, rien a afficher
    if (!this.session.estConnecte()) {
      this.router.navigate(['/login'], { queryParams: { retour: '/profil' } });
      return;
    }

    const actuelle = new Date().getFullYear();
    for (let a = actuelle + 1; a >= 1980; a--) this.annees.push(a);

    this.chargerProfil();
    this.chargerMarques();
  }

  // ==========================================================
  //  CHARGEMENT
  // ==========================================================
  private chargerProfil(): void {
    this.http.get<{ user: Profil }>(`${environment.apiUrl}/profil`).subscribe({
      next: (res) => {
        this.profil = res.user;
        this.remplirFormulaire(res.user);
        this.chargement = false;
        this.cdr.markForCheck();

        // Les modeles de la marque deja enregistree
        if (res.user.marque_vehicule) this.onMarqueChange(res.user.marque_vehicule, false);
      },
      error: (err) => {
        this.chargement = false;
        this.erreurChargement =
          err.status === 401
            ? 'Votre session a expiré. Reconnectez-vous.'
            : err.error?.message || 'Impossible de charger votre profil.';
        this.cdr.markForCheck();
      },
    });
  }

  private remplirFormulaire(u: Profil): void {
    this.form = {
      prenom: u.prenom || '',
      nom: u.nom || '',
      telephone: u.telephone || '',
      adresse: u.adresse || '',
      marque_vehicule: u.marque_vehicule || '',
      modele_vehicule: u.modele_vehicule || '',
      annee: u.annee ?? '',
    };
  }

  private chargerMarques(): void {
    this.http.get<Marque[]>(`${environment.apiUrl}/modeles/marques`).subscribe({
      next: (data) => {
        this.marques = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('❌ Chargement des marques :', err),
    });
  }

  /**
   * @param reinitialiser false au chargement initial : on garde le
   *        modele deja enregistre au lieu de le vider
   */
  onMarqueChange(nomMarque: string, reinitialiser = true): void {
    if (reinitialiser) this.form.modele_vehicule = '';
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
        error: () => {
          this.chargementModeles = false;
          this.cdr.markForCheck();
        },
      });
  }

  /** La marque vient d'etre chargee alors que le profil l'avait deja */
  get marqueInconnue(): boolean {
    return (
      !!this.form.marque_vehicule &&
      this.marques.length > 0 &&
      !this.marques.some((m) => m.nom === this.form.marque_vehicule)
    );
  }

  // ==========================================================
  //  ENREGISTREMENT DES INFORMATIONS
  // ==========================================================
  get aDesModifications(): boolean {
    if (!this.profil) return false;
    const u = this.profil;
    return (
      this.form.prenom !== (u.prenom || '') ||
      this.form.nom !== (u.nom || '') ||
      this.form.telephone !== (u.telephone || '') ||
      this.form.adresse !== (u.adresse || '') ||
      this.form.marque_vehicule !== (u.marque_vehicule || '') ||
      this.form.modele_vehicule !== (u.modele_vehicule || '') ||
      String(this.form.annee) !== String(u.annee ?? '')
    );
  }

  enregistrer(): void {
    if (this.enregistrement || !this.aDesModifications) return;

    this.enregistrement = true;
    this.cdr.markForCheck();

    const charge = {
      prenom: this.form.prenom.trim(),
      nom: this.form.nom.trim(),
      telephone: this.form.telephone.trim(),
      adresse: this.form.adresse.trim(),
      marque_vehicule: this.form.marque_vehicule,
      modele_vehicule: this.form.modele_vehicule,
      annee: this.form.annee === '' ? null : Number(this.form.annee),
    };

    this.http.put<{ user: Profil }>(`${environment.apiUrl}/profil`, charge).subscribe({
      next: (res) => {
        this.profil = res.user;
        this.remplirFormulaire(res.user);
        this.enregistrement = false;

        // La session porte l'ancien nom : on l'aligne pour que
        // l'en-tete du site affiche le bon immediatement
        this.session.majUtilisateur(res.user as any);

        this.notifier('Profil mis à jour.', 'ok');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.enregistrement = false;
        this.notifier(err.error?.message || 'Enregistrement impossible.', 'ko');
        this.cdr.markForCheck();
      },
    });
  }

  annulerModifications(): void {
    if (this.profil) this.remplirFormulaire(this.profil);
  }

  // ==========================================================
  //  CHANGEMENT D'ADRESSE
  // ==========================================================
  changerEmail(): void {
    if (this.envoiMail) return;

    if (!this.nouveauMail.trim() || !this.motDePasseMail) {
      this.notifier('Renseignez la nouvelle adresse et votre mot de passe.', 'ko');
      return;
    }

    this.envoiMail = true;
    this.cdr.markForCheck();

    this.http
      .put<any>(`${environment.apiUrl}/profil/email`, {
        nouveau_mail: this.nouveauMail.trim(),
        password: this.motDePasseMail,
      })
      .subscribe({
        next: (res) => {
          this.envoiMail = false;
          this.nouveauMail = '';
          this.motDePasseMail = '';
          this.notifier(res.message, 'ok');
          this.cdr.markForCheck();

          // Le jeton porte l'ancienne adresse : il faut se reconnecter
          if (res.reconnexion_requise) {
            setTimeout(() => {
              this.session.deconnecter();
              this.router.navigate(['/login']);
            }, 2500);
          }
        },
        error: (err) => {
          this.envoiMail = false;
          this.notifier(err.error?.message || "Changement d'adresse impossible.", 'ko');
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  MOT DE PASSE
  // ==========================================================
  /** Repere visuel de robustesse, identique a la page d'inscription */
  get forceMotDePasse(): { niveau: number; libelle: string; classe: string } {
    const mdp = this.nouveauMdp || '';
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

  changerMotDePasse(): void {
    if (this.envoiMdp) return;

    if (this.nouveauMdp.length < 6) {
      this.notifier('Le mot de passe doit contenir au moins 6 caractères.', 'ko');
      return;
    }
    if (this.nouveauMdp !== this.confirmationMdp) {
      this.notifier('Les deux mots de passe ne correspondent pas.', 'ko');
      return;
    }

    this.envoiMdp = true;
    this.cdr.markForCheck();

    this.http
      .put<any>(`${environment.apiUrl}/profil/motdepasse`, {
        ancien: this.ancienMdp || undefined,
        nouveau: this.nouveauMdp,
      })
      .subscribe({
        next: (res) => {
          this.envoiMdp = false;
          this.ancienMdp = '';
          this.nouveauMdp = '';
          this.confirmationMdp = '';
          if (this.profil) this.profil.a_mot_de_passe = true;
          this.notifier(res.message, 'ok');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.envoiMdp = false;
          this.notifier(err.error?.message || 'Changement impossible.', 'ko');
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  DIVERS
  // ==========================================================
  get initiales(): string {
    if (!this.profil) return '';
    return ((this.profil.prenom?.[0] || '') + (this.profil.nom?.[0] || '')).toUpperCase();
  }

  deconnexion(): void {
    this.session.deconnecter();
    this.router.navigate(['/']);
  }

  private notifier(texte: string, type: 'ok' | 'ko'): void {
    this.notification = { texte, type };
    if (this.minuteurNotif) clearTimeout(this.minuteurNotif);
    this.minuteurNotif = setTimeout(() => {
      this.notification = null;
      this.cdr.markForCheck();
    }, 4000);
  }
}
