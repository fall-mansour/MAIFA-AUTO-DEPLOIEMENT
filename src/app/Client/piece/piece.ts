import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environnement';
import { PanierService } from '../../panier.service';

interface Caracteristique {
  label: string;
  valeur: string;
  mono?: boolean;
}

@Component({
  selector: 'app-piece',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './piece.html',
  styleUrl: './piece.scss',
})
export class PieceDetail implements OnInit {
  data: any = null;
  erreur: string | null = null;
  imageActive: string | null = null;
  zoom = false;

  // Panier : signaux, le badge de l'en-tete se met a jour tout seul
  panier = inject(PanierService);
  quantite = 1;
  ajoutConfirme = false;
  messageAjout: string | null = null;

  private cdr = inject(ChangeDetectorRef);
  private minuteurAjout?: any;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Le slug se termine par l'identifiant : plaquettes-avant-renault-clio-v-42
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') || '';
      const id = this.extraireId(slug);

      if (!id) {
        this.erreur = 'Adresse de pièce invalide.';
        this.cdr.markForCheck();
        return;
      }

      this.charger(id, slug);
    });
  }

  /** Récupère l'identifiant en fin de slug */
  private extraireId(slug: string): number | null {
    const m = slug.match(/-(\d+)$/) || slug.match(/^(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  private charger(id: number, slugDemande: string): void {
    this.data = null;
    this.erreur = null;

    this.http.get<any>(`${environment.apiUrl}/piece/${id}`).subscribe({
      next: (res) => {
        this.data = res;
        this.imageActive = res.images?.[0] || null;
        this.zoom = false;
        this.quantite = 1;
        this.ajoutConfirme = false;
        this.messageAjout = null;

        // Redirection vers l'URL canonique si le libellé a changé depuis le partage du lien
        if (res.piece.slug && res.piece.slug !== slugDemande) {
          this.router.navigate(['/piece', res.piece.slug], { replaceUrl: true });
        }

        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('❌ Chargement de la fiche :', err);
        this.erreur =
          err.status === 404
            ? 'Cette pièce n’est plus disponible dans notre catalogue.'
            : 'Impossible de charger cette pièce pour le moment.';
        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  PANIER
  // ==========================================================

  /** Stock disponible pour cette piece */
  get stock(): number {
    return Number(this.data?.piece?.quantite) || 0;
  }

  /** Quantite deja presente dans le panier pour cette piece */
  get dejaDansPanier(): number {
    const ligne = this.panier.articles().find((a) => a.id_piece === this.data?.piece?.id);
    return ligne?.quantite || 0;
  }

  /** Ce que le client peut encore ajouter, compte tenu du panier */
  get ajoutMaximum(): number {
    return Math.max(0, this.stock - this.dejaDansPanier);
  }

  changerQuantite(delta: number): void {
    const nouvelle = this.quantite + delta;
    if (nouvelle >= 1 && nouvelle <= this.ajoutMaximum) this.quantite = nouvelle;
  }

  ajouterAuPanier(): void {
    if (!this.data?.piece) return;

    const ok = this.panier.ajouter(this.data.piece, this.quantite);

    if (!ok) {
      this.messageAjout = 'Stock insuffisant pour cette quantite.';
      this.ajoutConfirme = false;
      this.cdr.markForCheck();
      return;
    }

    this.ajoutConfirme = true;
    this.messageAjout = null;
    this.quantite = 1;
    this.cdr.markForCheck();

    // Le message d'ajout disparait au bout de quelques secondes
    if (this.minuteurAjout) clearTimeout(this.minuteurAjout);
    this.minuteurAjout = setTimeout(() => {
      this.ajoutConfirme = false;
      this.cdr.markForCheck();
    }, 6000);
  }

  // ==========================================================
  //  AFFICHAGE
  // ==========================================================
  get disponibilite(): 'stock' | 'dernieres' | 'commande' {
    const q = Number(this.data?.piece?.quantite) || 0;
    const seuil = Number(this.data?.piece?.seuil_alerte) || 3;
    if (q === 0) return 'commande';
    if (q <= seuil) return 'dernieres';
    return 'stock';
  }

  /** Caractéristiques construites depuis les colonnes réellement remplies */
  get caracteristiques(): Caracteristique[] {
    const p = this.data?.piece;
    if (!p) return [];

    const liste: Caracteristique[] = [];
    if (p.etat) liste.push({ label: 'État', valeur: p.etat });
    if (p.categorie) liste.push({ label: 'Catégorie', valeur: p.categorie });
    if (p.ref) liste.push({ label: 'Référence interne', valeur: p.ref, mono: true });
    if (p.ref_oe) liste.push({ label: 'Référence constructeur', valeur: p.ref_oe, mono: true });

    if (p.fournisseur) liste.push({ label: 'Fournisseur', valeur: p.fournisseur });
    if (p.annee) liste.push({ label: 'Année du véhicule', valeur: String(p.annee), mono: true });

    liste.push({
      label: 'Quantité disponible',
      valeur: p.quantite > 0 ? `${p.quantite} unité${p.quantite > 1 ? 's' : ''}` : 'Sur commande',
      mono: true,
    });

    return liste;
  }

  libelleType(type: string): string {
    if (type === 'OE') return 'Constructeur';
    if (type === 'fournisseur') return 'Interne';
    return 'Équivalence';
  }
}
