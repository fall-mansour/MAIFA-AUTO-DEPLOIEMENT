import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environnement';
import { PanierService } from '../../panier.service';
import { SessionService } from '../../session.service';

@Component({
  selector: 'app-panier',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './panier.html',
  styleUrl: './panier.scss',
})
export class PanierPage implements OnInit {
  // Services exposés au template (signaux : pas de markForCheck nécessaire)
  panier = inject(PanierService);
  session = inject(SessionService);

  formulaireOuvert = false;
  envoi = false;
  erreur: string | null = null;
  conflits: any[] = [];
  commandeValidee: any = null;

  /** Message affiche pendant la redirection vers PayTech */
  redirection: string | null = null;

  modePaiement: 'livraison' | 'wave' | 'om' = 'livraison';

  client = {
    nom: '',
    prenom: '',
    telephone: '',
    email: '',
    adresse_livraison: '',
    commentaire: '',
  };

  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    // Retour depuis PayTech : /panier?paiement=succes&ref=TM-2026-0001-XXXX
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const retour = params.get('paiement');
    const ref = params.get('ref');

    if (retour && ref) {
      this.verifierPaiement(ref, retour === 'succes');
      return;
    }

    this.prerremplir();
    if (!this.panier.estVide()) this.verifierDisponibilite();
  }

  /** Reprend les informations du compte, sans les imposer */
  private prerremplir(): void {
    const u = this.session.utilisateur();
    if (!u) return;

    this.client.nom = u.nom || '';
    this.client.prenom = u.prenom || '';
    this.client.email = u.mail || '';
    this.client.telephone = u.telephone || '';
    this.client.adresse_livraison = u.adresse || '';
  }

  /**
   * Contrôle serveur des prix et des stocks.
   * Une pièce vendue entre-temps est retirée du panier.
   */
  private verifierDisponibilite(): void {
    this.http
      .post<any>(`${environment.apiUrl}/panier/verifier`, { articles: this.panier.pourEnvoi() })
      .subscribe({
        next: (res) => {
          this.conflits = (res.lignes || []).filter((l: any) => l.probleme);
          this.panier.synchroniser(res.lignes || []);
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('❌ Vérification du panier :', err);
          this.cdr.markForCheck();
        },
      });
  }

  ouvrirFormulaire(): void {
    this.formulaireOuvert = true;
    this.erreur = null;
    this.verifierDisponibilite();
  }

  viderPanier(): void {
    if (confirm('Vider entièrement le panier ?')) {
      this.panier.vider();
      this.formulaireOuvert = false;
    }
  }

  valider(): void {
    this.erreur = null;

    if (!this.client.nom.trim() || !this.client.telephone.trim()) {
      this.erreur = 'Le nom et le téléphone sont obligatoires.';
      return;
    }

    if (this.panier.estVide()) {
      this.erreur = 'Votre panier est vide.';
      return;
    }

    this.envoi = true;

    const charge = {
      articles: this.panier.pourEnvoi(), // uniquement id et quantité
      client: this.client,
      mode_paiement: this.modePaiement,
      id_user: this.session.utilisateur()?.id ?? null,
    };

    this.http.post<any>(`${environment.apiUrl}/panier/valider`, charge).subscribe({
      next: (res) => {
        this.envoi = false;
        this.commandeValidee = res;
        this.panier.vider();
        this.cdr.markForCheck();

        // Paiement en ligne : on enchaine sur PayTech au lieu de
        // s'arreter a l'ecran de confirmation
        if (this.modePaiement !== 'livraison') {
          this.lancerPaiement(res.reference);
          return;
        }

        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err) => {
        this.envoi = false;

        // 409 : une pièce a été vendue pendant la saisie
        if (err.status === 409 && err.error?.conflits) {
          this.conflits = err.error.conflits;
          this.erreur = err.error.message;
          this.verifierDisponibilite();
        } else {
          this.erreur = err.error?.message || 'Impossible d’enregistrer la commande.';
        }

        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  PAIEMENT EN LIGNE
  // ==========================================================

  /**
   * Demande l'URL de paiement au serveur, puis redirige.
   * Le montant n'est jamais transmis : le serveur le relit en base.
   */
  private lancerPaiement(reference: string): void {
    this.envoi = true;
    this.redirection = 'Redirection vers le paiement sécurisé…';
    this.cdr.markForCheck();

    this.http
      .post<any>(`${environment.apiUrl}/paiement/initier`, {
        reference,
        methode: this.modePaiement,
      })
      .subscribe({
        next: (res) => {
          if (res.avertissement) console.warn('⚠️', res.avertissement);
          // Redirection hors application : PayTech heberge la page de paiement
          if (typeof window !== 'undefined') window.location.href = res.url;
        },
        error: (err) => {
          this.envoi = false;
          this.redirection = null;
          // La commande EXISTE deja : on ne la perd pas, on previent
          // simplement que le paiement en ligne a echoue
          this.erreur =
            (err.error?.message || 'Le paiement en ligne est indisponible.') +
            ` Votre commande ${reference} est bien enregistrée, nous vous contactons.`;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Verifie l'etat reel du paiement au retour de PayTech.
   *
   * On ne se fie PAS au parametre d'URL : n'importe qui peut taper
   * ?paiement=succes. Seul le serveur sait, et il ne l'apprend que
   * par la notification envoyee par PayTech.
   */
  private verifierPaiement(reference: string, annonceSucces: boolean): void {
    this.envoi = true;
    this.cdr.markForCheck();

    this.http.get<any>(`${environment.apiUrl}/paiement/statut/${reference}`).subscribe({
      next: (c) => {
        this.envoi = false;

        if (c.statut_paiement === 'paye') {
          this.commandeValidee = {
            reference: c.reference,
            total: c.montant_paye || c.total,
            nb_articles: 0,
            articles: [],
            paye: true,
            methode: c.methode_reelle,
          };
          this.panier.vider();
        } else if (annonceSucces) {
          // Decalage frequent de quelques secondes entre le paiement
          // et l'arrivee de la notification
          this.commandeValidee = {
            reference: c.reference,
            total: c.total,
            nb_articles: 0,
            articles: [],
            en_attente: true,
          };
          this.panier.vider();
        } else {
          this.erreur = 'Paiement annulé. Votre panier a été conservé.';
        }

        this.cdr.markForCheck();
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: () => {
        this.envoi = false;
        this.erreur =
          'Impossible de vérifier le paiement. Contactez-nous avec la référence ' + reference + '.';
        this.cdr.markForCheck();
      },
    });
  }
}
