import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface ArticlePanier {
  id_piece: number;
  designation: string;
  ref?: string | null;
  vehicule?: string | null;
  etat?: string | null;
  img?: string | null;
  slug?: string | null;
  prix: number; // affichage seulement : le serveur recalcule à la validation
  quantite: number;
  stock_max: number;
}

/**
 * Panier conservé dans localStorage.
 *
 * Le prix stocké ici ne sert qu'à l'affichage. À la validation, seuls
 * les couples (id_piece, quantite) sont transmis : le serveur relit les
 * prix et les stocks en base. Modifier ce stockage n'a donc aucun effet
 * sur le montant réellement facturé.
 */
@Injectable({ providedIn: 'root' })
export class PanierService {
  private readonly CLE = 'teranga_panier';
  private readonly platformId = inject(PLATFORM_ID);

  private _articles = signal<ArticlePanier[]>([]);

  /** Contenu du panier */
  readonly articles = this._articles.asReadonly();

  /** Nombre total d'unités, pour le badge de l'en-tête */
  readonly nbArticles = computed(() => this._articles().reduce((s, a) => s + a.quantite, 0));

  /** Nombre de lignes distinctes */
  readonly nbLignes = computed(() => this._articles().length);

  /** Montant indicatif */
  readonly total = computed(() => this._articles().reduce((s, a) => s + a.prix * a.quantite, 0));

  readonly estVide = computed(() => this._articles().length === 0);

  constructor() {
    this.restaurer();
  }

  private get navigateur(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  // ==========================================================
  //  ACTIONS
  // ==========================================================

  /**
   * Ajoute une pièce, ou incrémente la ligne existante.
   * @returns false si le stock ne permet pas d'ajouter davantage
   */
  ajouter(piece: any, quantite = 1): boolean {
    const stockMax = Number(piece.quantite ?? piece.stock_max ?? 0);
    if (stockMax <= 0) return false;

    const id = Number(piece.id ?? piece.id_piece);
    const existant = this._articles().find((a) => a.id_piece === id);

    if (existant) {
      const nouvelle = existant.quantite + quantite;
      if (nouvelle > stockMax) return false;

      this._articles.update((liste) =>
        liste.map((a) => (a.id_piece === id ? { ...a, quantite: nouvelle } : a)),
      );
    } else {
      this._articles.update((liste) => [
        ...liste,
        {
          id_piece: id,
          designation: piece.description ?? piece.designation ?? 'Pièce',
          ref: piece.ref ?? null,
          vehicule:
            piece.vehicule ?? [piece.marque, piece.modele].filter(Boolean).join(' ') ?? null,
          etat: piece.etat ?? null,
          img: piece.img_principale ?? piece.img_url ?? piece.img ?? null,
          slug: piece.slug ?? null,
          prix: Number(piece.prix) || 0,
          quantite: Math.min(quantite, stockMax),
          stock_max: stockMax,
        },
      ]);
    }

    this.sauvegarder();
    return true;
  }

  /** Fixe la quantité d'une ligne, dans la limite du stock */
  changerQuantite(idPiece: number, quantite: number): void {
    if (quantite <= 0) return this.retirer(idPiece);

    this._articles.update((liste) =>
      liste.map((a) =>
        a.id_piece === idPiece ? { ...a, quantite: Math.min(quantite, a.stock_max) } : a,
      ),
    );
    this.sauvegarder();
  }

  incrementer(idPiece: number): void {
    const a = this._articles().find((x) => x.id_piece === idPiece);
    if (a) this.changerQuantite(idPiece, a.quantite + 1);
  }

  decrementer(idPiece: number): void {
    const a = this._articles().find((x) => x.id_piece === idPiece);
    if (a) this.changerQuantite(idPiece, a.quantite - 1);
  }

  retirer(idPiece: number): void {
    this._articles.update((liste) => liste.filter((a) => a.id_piece !== idPiece));
    this.sauvegarder();
  }

  vider(): void {
    this._articles.set([]);
    this.sauvegarder();
  }

  contient(idPiece: number): boolean {
    return this._articles().some((a) => a.id_piece === idPiece);
  }

  /** Charge utile envoyée au serveur : aucun prix */
  pourEnvoi(): { id_piece: number; quantite: number }[] {
    return this._articles().map((a) => ({ id_piece: a.id_piece, quantite: a.quantite }));
  }

  /** Met à jour les lignes après une vérification serveur */
  synchroniser(lignes: any[]): void {
    this._articles.update((liste) =>
      liste
        .map((a) => {
          const maj = lignes.find((l) => l.id_piece === a.id_piece);
          if (!maj || !maj.disponible) return null;
          return {
            ...a,
            prix: Number(maj.prix_unitaire) || a.prix,
            quantite: Number(maj.quantite) || a.quantite,
            stock_max: Number(maj.stock) || a.stock_max,
          };
        })
        .filter((a): a is ArticlePanier => a !== null),
    );
    this.sauvegarder();
  }

  // ==========================================================
  //  PERSISTANCE
  // ==========================================================
  private sauvegarder(): void {
    if (!this.navigateur) return;
    try {
      localStorage.setItem(this.CLE, JSON.stringify(this._articles()));
    } catch (e) {
      console.warn('Panier non conservé :', e);
    }
  }

  private restaurer(): void {
    // localStorage n'existe pas côté serveur : sans ce garde-fou, le SSR plante
    if (!this.navigateur) return;

    try {
      const brut = localStorage.getItem(this.CLE);
      if (brut) {
        const liste = JSON.parse(brut);
        if (Array.isArray(liste)) this._articles.set(liste);
      }
    } catch {
      localStorage.removeItem(this.CLE);
    }
  }
}
