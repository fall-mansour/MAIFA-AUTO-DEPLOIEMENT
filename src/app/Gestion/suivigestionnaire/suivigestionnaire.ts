import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { environment } from '../../environnement';

// ============================================================
//  SUIVI DES GESTIONNAIRES
//
//  Page de consultation, réservée au responsable. Elle ne modifie
//  rien : ni le journal, ni les commandes, ni le stock. Un registre
//  que l'on peut retoucher depuis l'interface ne prouve rien.
//
//  Deux niveaux de lecture :
//    l'activité de chacun, en un coup d'œil
//    le détail action par action, filtrable
// ============================================================

interface MembreEquipe {
  id: number;
  prenom: string;
  nom: string;
  mail: string;
  role: 'gestionnaire' | 'responsable';
  nb_actions: number;
  derniere_action: string | null;
}

interface LigneAuteur {
  id_utilisateur: number;
  auteur_nom: string;
  auteur_mail: string;
  nb_actions: number;
  nb_commandes: number;
  nb_pieces: number;
  nb_confirmations: number;
  nb_annulations: number;
  nb_suppressions: number;
  derniere_action: string | null;
}

interface ActionJournal {
  id: number;
  date_action: string;
  id_utilisateur: number | null;
  auteur_nom: string;
  auteur_mail: string | null;
  auteur_role: string | null;
  action: string;
  objet_type: string;
  objet_id: number | null;
  objet_libelle: string | null;
  resume: string | null;
  avant: Record<string, any> | null;
  apres: Record<string, any> | null;
  adresse_ip: string | null;
}

interface OptionAction {
  code: string;
  libelle: string;
  nb: number;
}

type Periode = '7j' | '30j' | 'tout' | 'perso';

@Component({
  selector: 'app-suivigestionnaire',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './suivigestionnaire.html',
  styleUrl: './suivigestionnaire.scss',
})
export class SuiviGestionnaireComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly api = environment.apiUrl;

  // --- Données ------------------------------------------------
  equipe: MembreEquipe[] = [];
  parAuteur: LigneAuteur[] = [];
  totaux = { total: 0, nb_gestionnaires: 0, premiere: null, derniere: null };

  actions: ActionJournal[] = [];
  total = 0;
  page = 1;
  pages = 1;
  readonly parPage = 50;

  // --- Filtres --------------------------------------------------
  periode: Periode = 'tout';
  depuis = '';
  jusquA = '';

  filtreAuteur = '';
  filtreAction = '';
  filtreType = '';
  recherche = '';

  optionsActions: OptionAction[] = [];
  readonly typesObjet = [
    { code: 'commande', libelle: 'Commandes' },
    { code: 'piece', libelle: 'Pièces' },
    { code: 'import', libelle: 'Imports' },
    { code: 'utilisateur', libelle: 'Comptes' },
  ];

  // --- Interface --------------------------------------------------
  /** Lignes dont le détail est déplié */
  depliees = new Set<number>();
  chargement = false;
  messageErreur = '';

  private minuteurRecherche?: any;

  // ==========================================================
  //  CYCLE DE VIE
  // ==========================================================
  ngOnInit(): void {
    this.chargerEquipe();
    this.chargerFiltres();
    this.rafraichir();
  }

  private get navigateur(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  // ==========================================================
  //  CHARGEMENT
  // ==========================================================
  private parametresPeriode(): HttpParams {
    let p = new HttpParams();
    if (this.depuis) p = p.set('depuis', this.depuis);
    if (this.jusquA) p = p.set('jusqu_a', this.jusquA);
    return p;
  }

  private parametresComplets(): HttpParams {
    let p = this.parametresPeriode();
    if (this.filtreAuteur) p = p.set('auteur', this.filtreAuteur);
    if (this.filtreAction) p = p.set('action', this.filtreAction);
    if (this.filtreType) p = p.set('objet_type', this.filtreType);
    if (this.recherche.trim()) p = p.set('recherche', this.recherche.trim());
    return p;
  }

  private chargerEquipe(): void {
    this.http.get<MembreEquipe[]>(`${this.api}/journal/equipe`).subscribe({
      next: (donnees) => {
        this.equipe = donnees;
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.messageErreur = this.lireErreur(err, "Impossible de lire l'équipe.");
        this.cdr.markForCheck();
      },
    });
  }

  private chargerFiltres(): void {
    this.http.get<any>(`${this.api}/journal/filtres`).subscribe({
      next: (donnees) => {
        this.optionsActions = donnees.actions || [];
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  private chargerSynthese(): void {
    this.http
      .get<any>(`${this.api}/journal/synthese`, { params: this.parametresPeriode() })
      .subscribe({
        next: (donnees) => {
          this.parAuteur = donnees.par_auteur || [];
          this.totaux = donnees.totaux || this.totaux;
          this.cdr.markForCheck();
        },
        error: (err: HttpErrorResponse) => {
          this.messageErreur = this.lireErreur(err, 'Impossible de calculer la synthèse.');
          this.cdr.markForCheck();
        },
      });
  }

  private chargerActions(): void {
    this.chargement = true;

    const params = this.parametresComplets()
      .set('page', String(this.page))
      .set('par_page', String(this.parPage));

    this.http.get<any>(`${this.api}/journal`, { params }).subscribe({
      next: (donnees) => {
        this.actions = donnees.lignes || [];
        this.total = donnees.total || 0;
        this.pages = donnees.pages || 1;
        this.depliees.clear();
        this.chargement = false;
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.chargement = false;
        this.messageErreur = this.lireErreur(err, 'Impossible de lire le journal.');
        this.cdr.markForCheck();
      },
    });
  }

  /** Recharge synthèse et liste. Tout changement de filtre passe ici. */
  rafraichir(): void {
    this.messageErreur = '';
    this.chargerSynthese();
    this.chargerActions();
  }

  /** Les filtres de la liste seule : la synthèse n'en dépend pas */
  rafraichirListe(): void {
    this.page = 1;
    this.chargerActions();
  }

  /** La recherche libre attend que la frappe s'arrête */
  onRechercheChange(): void {
    clearTimeout(this.minuteurRecherche);
    this.minuteurRecherche = setTimeout(() => this.rafraichirListe(), 350);
  }

  // ==========================================================
  //  PÉRIODE
  // ==========================================================
  choisirPeriode(p: Periode): void {
    this.periode = p;

    if (p === 'tout') {
      this.depuis = '';
      this.jusquA = '';
    } else if (p === '7j' || p === '30j') {
      const jours = p === '7j' ? 7 : 30;
      const fin = new Date();
      const debut = new Date();
      debut.setDate(debut.getDate() - jours);
      this.depuis = debut.toISOString().slice(0, 10);
      this.jusquA = fin.toISOString().slice(0, 10);
    }
    // 'perso' : les champs de date gardent leurs valeurs

    this.page = 1;
    this.rafraichir();
  }

  onDatePerso(): void {
    this.periode = 'perso';
    this.page = 1;
    this.rafraichir();
  }

  // ==========================================================
  //  FILTRES
  // ==========================================================
  /** Clic sur la carte d'un gestionnaire : on filtre sur lui */
  filtrerSur(idUtilisateur: number): void {
    const cible = String(idUtilisateur);
    this.filtreAuteur = this.filtreAuteur === cible ? '' : cible;
    this.rafraichirListe();
  }

  get aDesFiltres(): boolean {
    return !!(this.filtreAuteur || this.filtreAction || this.filtreType || this.recherche.trim());
  }

  reinitialiser(): void {
    this.filtreAuteur = '';
    this.filtreAction = '';
    this.filtreType = '';
    this.recherche = '';
    this.rafraichirListe();
  }

  // ==========================================================
  //  PAGINATION
  // ==========================================================
  allerPage(n: number): void {
    if (n < 1 || n > this.pages || n === this.page) return;
    this.page = n;
    this.chargerActions();
    if (this.navigateur) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================
  //  DÉTAIL
  // ==========================================================
  basculerDetail(ligne: ActionJournal): void {
    if (this.depliees.has(ligne.id)) this.depliees.delete(ligne.id);
    else this.depliees.add(ligne.id);
    this.cdr.markForCheck();
  }

  estDepliee(ligne: ActionJournal): boolean {
    return this.depliees.has(ligne.id);
  }

  aUnDetail(ligne: ActionJournal): boolean {
    return !!(
      (ligne.avant && Object.keys(ligne.avant).length) ||
      (ligne.apres && Object.keys(ligne.apres).length)
    );
  }

  /** Les champs modifiés, pour le tableau avant / après */
  champsModifies(ligne: ActionJournal): string[] {
    const cles = new Set<string>([
      ...Object.keys(ligne.avant || {}),
      ...Object.keys(ligne.apres || {}),
    ]);
    return [...cles];
  }

  valeur(objet: Record<string, any> | null, cle: string): string {
    const v = objet?.[cle];
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  // ==========================================================
  //  EXPORT
  // ==========================================================
  exporter(): void {
    if (!this.navigateur || this.chargement) return;

    this.chargement = true;

    this.http
      .get(`${this.api}/journal/export`, {
        params: this.parametresComplets(),
        responseType: 'blob',
      })
      .subscribe({
        next: (donnees) => {
          const jour = new Date().toISOString().slice(0, 10);
          const lien = document.createElement('a');
          lien.href = URL.createObjectURL(donnees);
          lien.download = `journal-MAIFA-AUTO-${jour}.xlsx`;
          lien.click();
          URL.revokeObjectURL(lien.href);

          this.chargement = false;
          this.cdr.markForCheck();
        },
        error: (err: HttpErrorResponse) => {
          this.chargement = false;
          this.messageErreur = this.lireErreur(err, 'Export impossible.');
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  AFFICHAGE
  // ==========================================================
  nomComplet(m: MembreEquipe): string {
    return [m.prenom, m.nom].filter(Boolean).join(' ').trim() || m.mail;
  }

  /** Deux lettres, pour la pastille d'un gestionnaire */
  initiales(nom: string): string {
    const mots = String(nom || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (mots.length === 0) return '?';
    if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
    return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
  }

  /** Synthèse d'un membre, s'il a agi sur la période */
  statsDe(idUtilisateur: number): LigneAuteur | null {
    return this.parAuteur.find((a) => a.id_utilisateur === idUtilisateur) || null;
  }

  /** Famille d'une action, pour la couleur de la pastille */
  familleAction(action: string): string {
    if (action.startsWith('commande_')) {
      return action === 'commande_annulee' ? 'annulation' : 'commande';
    }
    if (action === 'piece_supprimee') return 'suppression';
    if (action.startsWith('piece_') || action === 'stock_ajuste') return 'stock';
    if (action.startsWith('import_') || action.startsWith('export_')) return 'import';
    return 'autre';
  }

  libelleAction(action: string): string {
    return this.optionsActions.find((o) => o.code === action)?.libelle || action;
  }

  /** « il y a 3 heures », pour les actions récentes */
  depuisQuand(date: string | null): string {
    if (!date) return 'jamais';

    const ecart = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(ecart / 60000);

    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;

    const heures = Math.floor(minutes / 60);
    if (heures < 24) return `il y a ${heures} h`;

    const jours = Math.floor(heures / 24);
    if (jours === 1) return 'hier';
    if (jours < 31) return `il y a ${jours} jours`;

    return new Date(date).toLocaleDateString('fr-FR');
  }

  private lireErreur(err: HttpErrorResponse, defaut: string): string {
    if (err.status === 0) {
      return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
    }
    if (err.status === 403) {
      return 'Cette page est réservée au responsable.';
    }
    if (err.status === 401) {
      return 'Votre session a expiré. Reconnectez-vous.';
    }
    return err.error?.message || defaut;
  }

  trackAction(_index: number, ligne: ActionJournal): number {
    return ligne.id;
  }

  trackMembre(_index: number, m: MembreEquipe): number {
    return m.id;
  }
}
