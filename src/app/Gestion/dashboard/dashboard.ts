import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { PiecesService, StatsPieces } from '../../piecesdash';
import { SessionService } from '../../session.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  public stats?: StatsPieces;

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse asynchrone
  // Signaux : le nom s'affiche sans detection de changement manuelle
  session = inject(SessionService);

  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  /**
   * Palette du donut et de la legende, dans l'ordre des categories.
   *
   * Construite autour des deux couleurs du logo, en ALTERNANT bleu
   * nuit et orange plutot qu'en groupant les familles. Mesure de
   * l'ecart perceptuel entre segments voisins : 14.8 minimum et 83.8
   * en moyenne, contre 11.2 et 27.8 pour une palette groupee. Deux
   * secteurs adjacents se distinguent donc franchement.
   *
   * Le couple bleu / orange est aussi le plus sur en cas de daltonisme,
   * qui affecte surtout la distinction du rouge et du vert.
   */
  private readonly palette = [
    '#12314b', // bleu nuit du logo
    '#f2762e', // orange du logo
    '#256291',
    '#ffb383',
    '#1b4a6f',
    '#c25317',
    '#3f80b0',
    '#ff9052',
    '#6ba3c9',
    '#8d9bb0', // gris bleute, pour le reste
  ];

  private readonly moisLabels = [
    'jan',
    'fév',
    'mar',
    'avr',
    'mai',
    'juin',
    'juil',
    'août',
    'sep',
    'oct',
    'nov',
    'déc',
  ];

  constructor(private piecesService: PiecesService) {}

  ngOnInit(): void {
    this.piecesService.getStats().subscribe({
      next: (data) => {
        this.stats = data;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('❌ Chargement du tableau de bord :', err);
        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  INDICATEURS
  // ==========================================================
  get totalAlertes(): number {
    if (!this.stats) return 0;
    const a = this.stats.alertes;
    return a.ruptures + a.stock_faible + a.sans_compatibilite;
  }

  /** Part des pièces neuves, pour la barre de répartition */
  get partNeuf(): number {
    if (!this.stats) return 0;
    const { neuf, occasion } = this.stats.stock;
    const total = neuf + occasion;
    return total === 0 ? 0 : (neuf / total) * 100;
  }

  get totalAjouts(): number {
    if (!this.stats) return 0;
    return this.stats.evolution.reduce((s, m) => s + m.nb, 0);
  }

  get marquesNonCouvertes(): number {
    if (!this.stats) return 0;
    return this.stats.parc_clients.filter((p) => !p.couverte).length;
  }

  // ==========================================================
  //  COMPTE GESTIONNAIRE
  // ==========================================================

  /** Initiales affichees dans la pastille */
  get initiales(): string {
    const u = this.session.utilisateur();
    if (!u) return '';
    return ((u.prenom?.[0] || '') + (u.nom?.[0] || '')).toUpperCase();
  }

  deconnexion(): void {
    if (!confirm('Se déconnecter de l’espace de gestion ?')) return;

    this.session.deconnecter();
    // Redirection explicite : deconnecter() ne redirige de lui-meme
    // que lorsque la session arrive a echeance
    this.router.navigate(['/login']);
  }

  // ==========================================================
  //  COMMANDES
  // ==========================================================
  libelleStatut(statut: string): string {
    const l: { [k: string]: string } = {
      en_attente: 'En attente',
      confirmee: 'Confirmée',
      livree: 'Livrée',
      annulee: 'Annulée',
    };
    return l[statut] || statut;
  }

  // ==========================================================
  //  DONUT DES CATÉGORIES
  // ==========================================================
  couleur(index: number): string {
    return this.palette[index % this.palette.length];
  }

  pourcentage(valeur: number): string {
    if (!this.stats || this.stats.stock.references === 0) return '0 %';
    return ((valeur / this.stats.stock.references) * 100).toFixed(0) + ' %';
  }

  /** Construit le conic-gradient à partir des catégories réelles */
  get donutStyle(): string {
    if (!this.stats || this.stats.categories.length === 0) {
      return 'conic-gradient(#e6ecf7 0% 100%)';
    }

    const total = this.stats.categories.reduce((s, c) => s + c.nb, 0);
    if (total === 0) return 'conic-gradient(#e6ecf7 0% 100%)';

    let position = 0;
    const segments = this.stats.categories.map((c, i) => {
      const debut = position;
      position += (c.nb / total) * 100;
      return `${this.couleur(i)} ${debut.toFixed(2)}% ${position.toFixed(2)}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  }

  // ==========================================================
  //  HISTOGRAMME DES AJOUTS
  // ==========================================================
  /** Hauteur relative d'une barre, la plus haute occupant 100 % */
  hauteurBarre(valeur: number): number {
    if (!this.stats) return 0;
    const max = Math.max(...this.stats.evolution.map((m) => m.nb), 1);
    return valeur === 0 ? 3 : Math.max((valeur / max) * 100, 8);
  }

  /** "2026-09" -> "sep" */
  moisCourt(mois: string): string {
    const index = Number(mois.split('-')[1]) - 1;
    return this.moisLabels[index] ?? mois;
  }

  // ==========================================================
  //  BARRES HORIZONTALES
  // ==========================================================
  largeurParc(valeur: number): number {
    if (!this.stats || this.stats.parc_clients.length === 0) return 0;
    const max = Math.max(...this.stats.parc_clients.map((p) => p.nb_clients), 1);
    return Math.max((valeur / max) * 100, 4);
  }

  largeurTop(valeur: number): number {
    if (!this.stats || this.stats.top_marques.length === 0) return 0;
    const max = Math.max(...this.stats.top_marques.map((m) => m.nb), 1);
    return Math.max((valeur / max) * 100, 4);
  }
}
