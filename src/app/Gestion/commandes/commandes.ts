import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environnement';

@Component({
  selector: 'app-commandes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './commandes.html',
  styleUrl: './commandes.scss',
})
export class Commandes implements OnInit, OnDestroy {
  commandes: any[] = [];
  stats: any = null;

  filtre: '' | 'en_attente' | 'confirmee' | 'livree' | 'annulee' = 'en_attente';
  recherche = '';
  ouverte: number | null = null;
  enCours: number | null = null;
  chargement = true;
  erreur: string | null = null;

  /** Horodatage du dernier chargement reussi */
  derniereMaj: Date | null = null;
  /** Rafraichissement en cours, pour l'indicateur discret */
  actualisation = false;
  /** Identifiants deja vus, pour signaler les nouvelles commandes */
  private dejaVues = new Set<number>();
  nouvelles = 0;

  /** Intervalle entre deux verifications automatiques, en secondes */
  private readonly PERIODE = 25;

  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);
  private minuteur?: any;

  ngOnInit(): void {
    this.charger();
    this.demarrerActualisation();
  }

  ngOnDestroy(): void {
    // Sans cela, l'intervalle continue de tourner et interroge le
    // serveur apres avoir quitte la page
    if (this.minuteur) clearInterval(this.minuteur);
  }

  // ==========================================================
  //  ACTUALISATION AUTOMATIQUE
  // ==========================================================

  private demarrerActualisation(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.minuteur = setInterval(() => {
      // On n'interroge pas le serveur si l'onglet est en arriere-plan :
      // inutile, et cela evite des dizaines de requetes pour rien
      if (document.visibilityState === 'visible') {
        this.charger(true);
      }
    }, this.PERIODE * 1000);
  }

  /**
   * Retour sur l'onglet : on rafraichit immediatement plutot que
   * d'attendre le prochain cycle. C'est ce qui donne l'impression
   * d'un affichage toujours a jour.
   */
  @HostListener('document:visibilitychange')
  auRetourSurOnglet(): void {
    if (isPlatformBrowser(this.platformId) && document.visibilityState === 'visible') {
      this.charger(true);
    }
  }

  /** Rafraichissement manuel, depuis le bouton de la barre */
  rafraichir(): void {
    this.nouvelles = 0;
    this.charger(true);
  }

  // ==========================================================
  //  CHARGEMENT
  // ==========================================================
  /**
   * @param discret true pour une actualisation de fond : on n'affiche
   *        pas l'ecran de chargement, ce qui evite un clignotement
   *        toutes les 25 secondes sous les yeux du gestionnaire
   */
  charger(discret = false): void {
    if (discret) this.actualisation = true;
    else this.chargement = true;

    const url = `${environment.apiUrl}/panier/commandes${this.filtre ? '?statut=' + this.filtre : ''}`;

    this.http.get<any[]>(url).subscribe({
      next: (data) => {
        // Commandes apparues depuis le dernier chargement
        if (this.dejaVues.size > 0) {
          const inedites = data.filter((c) => !this.dejaVues.has(c.id));
          if (inedites.length > 0) {
            this.nouvelles += inedites.length;
            inedites.forEach((c) => (c.estNouvelle = true));
          }
        }
        data.forEach((c) => this.dejaVues.add(c.id));

        this.commandes = data;
        this.chargement = false;
        this.actualisation = false;
        this.derniereMaj = new Date();
        this.erreur = null;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.chargement = false;
        this.actualisation = false;
        // Une actualisation de fond qui echoue ne doit pas effacer
        // ce qui est deja affiche
        if (!discret) {
          this.erreur =
            err.status === 403
              ? 'Accès réservé aux gestionnaires.'
              : err.error?.message || 'Impossible de charger les commandes.';
        }
        this.cdr.markForCheck();
      },
    });

    this.http.get<any>(`${environment.apiUrl}/panier/stats`).subscribe({
      next: (s) => {
        this.stats = s;
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  filtrer(statut: any): void {
    this.filtre = this.filtre === statut ? '' : statut;
    this.ouverte = null;
    this.charger();
  }

  basculer(id: number): void {
    this.ouverte = this.ouverte === id ? null : id;
  }

  // ==========================================================
  //  CHANGEMENT DE STATUT
  // ==========================================================
  changerStatut(commande: any, statut: string): void {
    const messages: { [k: string]: string } = {
      confirmee: `Confirmer ${commande.reference} ? Les pièces seront retirées du stock.`,
      livree: `Marquer ${commande.reference} comme livrée ?`,
      annulee: commande.stock_decremente
        ? `Annuler ${commande.reference} ? Les pièces seront remises en stock.`
        : `Annuler ${commande.reference} ?`,
    };

    if (!confirm(messages[statut] || 'Confirmer ?')) return;

    this.enCours = commande.id;
    this.erreur = null;

    this.http
      .patch<any>(`${environment.apiUrl}/panier/commande/${commande.id}/statut`, { statut })
      .subscribe({
        next: (res) => {
          this.enCours = null;
          this.charger();
          alert(`✅ ${res.reference || commande.reference} : ${this.libelleStatut(statut)}`);
        },
        error: (err) => {
          this.enCours = null;

          // 409 : stock insuffisant, le détail des lignes est renvoyé
          if (err.status === 409 && err.error?.conflits) {
            const lignes = err.error.conflits.map((c: any) => '• ' + c.message).join('\n');
            alert(`⚠️ ${err.error.message}\n\n${lignes}`);
            this.charger();
          } else {
            this.erreur = err.error?.message || 'Impossible de mettre à jour la commande.';
            this.cdr.markForCheck();
          }
        },
      });
  }

  // ==========================================================
  //  AFFICHAGE
  // ==========================================================
  get commandesFiltrees(): any[] {
    const q = this.recherche.trim().toLowerCase();
    if (!q) return this.commandes;

    return this.commandes.filter(
      (c) =>
        c.reference?.toLowerCase().includes(q) ||
        c.client?.toLowerCase().includes(q) ||
        c.telephone?.includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }

  /** « il y a 12 s », pour l'indicateur de fraicheur */
  get depuisMaj(): string {
    if (!this.derniereMaj) return '';
    const secondes = Math.floor((Date.now() - this.derniereMaj.getTime()) / 1000);
    if (secondes < 10) return "a l'instant";
    if (secondes < 60) return `il y a ${secondes} s`;
    const minutes = Math.floor(secondes / 60);
    return `il y a ${minutes} min`;
  }

  libelleStatut(statut: string): string {
    const l: { [k: string]: string } = {
      en_attente: 'En attente',
      confirmee: 'Confirmée',
      livree: 'Livrée',
      annulee: 'Annulée',
    };
    return l[statut] || statut;
  }

  libellePaiement(mode: string): string {
    const l: { [k: string]: string } = {
      livraison: 'À la livraison',
      wave: 'Wave',
      om: 'Orange Money',
    };
    return l[mode] || mode;
  }
}
