import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { PiecesServicegestion } from '../../piecesgestion';
import { environment } from '../../environnement';

interface Marque {
  id: number;
  nom: string;
}
interface Modele {
  id: number;
  modele: string;
}
interface Categorie {
  id: number;
  nom: string;
  slug: string;
}

/**
 * Champs modifiables dans la fenetre d'edition.
 *
 * `equipementier` en est RETIRE : la colonne n'existe plus en base,
 * le serveur ignorait donc la valeur sans rien dire. Le gestionnaire
 * remplissait un champ dans le vide.
 *
 * `ref` reste, mais en LECTURE SEULE. C'est la reference interne,
 * generee et immuable : elle figure sur les etiquettes et dans
 * l'historique des commandes. Le serveur la refuse de toute facon.
 */
interface EditionPiece {
  id: number;
  description: string;
  prix: number | null;
  quantite: number;
  seuil_alerte: number;
  etat: string;
  fournisseur: string;
  ref: string;
  ref_oe: string;
  visible_catalogue: boolean;
}

/** Une photo deja en place, dans son emplacement */
interface PhotoPosee {
  colonne: string;
  url: string;
}

/** Fenetre des photos d'une piece */
interface EditionPhotos {
  id: number;
  ref: string;
  description: string;
  liste: PhotoPosee[];
}

/** Fenetre des vehicules compatibles d'une piece */
interface EditionVehicules {
  id: number;
  ref: string;
  description: string;
}

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterModule],
  templateUrl: './stock.html',
  styleUrl: './stock.scss',
})
export class Stock implements OnInit {
  pieces: any[] = [];

  // --- Filtres ---
  searchText = '';
  selectedMarque = ''; // id de marque
  selectedModele = ''; // id de modèle
  selectedAnnee = '';
  selectedCategorie = '';
  onlyAlerts = false;
  onlySansCompat = false;
  onlyBrouillons = false;
  sortBy: 'recent' | 'stock' | 'prix-asc' | 'prix-desc' | 'marque' = 'recent';

  view: 'grid' | 'list' = 'grid';

  // --- Référentiel ---
  marques: Marque[] = [];
  modelesDisponibles: Modele[] = [];
  categories: Categorie[] = [];
  annees: number[] = [];
  chargementModeles = false;

  readonly SEUIL_DEFAUT = 3;
  readonly ETATS = ['Neuf', 'Occasion', 'Reconditionné'];

  /** Les cinq emplacements d'image, dans l'ordre d'affichage */
  readonly COLONNES_IMAGES = ['img_principale', 'img1', 'img2', 'img3', 'img4'];
  private readonly TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo, comme à l'ajout

  // --- Ajustement rapide du stock ---
  /** Pieces dont la quantite est en cours d'enregistrement */
  private enCours = new Set<number>();

  // --- Fenetre d'edition ---
  edition: EditionPiece | null = null;
  enregistrement = false;
  erreurEdition: string | null = null;

  // --- Fenetre des photos ---
  photos: EditionPhotos | null = null;
  envoiPhotos = false;
  erreurPhotos: string | null = null;

  // --- Fenetre des vehicules compatibles ---
  vehicules: EditionVehicules | null = null;
  envoiVehicule = false;
  erreurVehicules: string | null = null;

  /**
   * Selection et liste de modeles PROPRES a la fenetre.
   *
   * Surtout pas `selectedMarque` et `modelesDisponibles`, qui
   * appartiennent aux filtres de la page : rattacher un vehicule
   * remettrait alors le stock a plat sous les yeux du gestionnaire.
   */
  vehSelection = {
    id_marque: '',
    id_modele: '',
    annee_min: '',
    annee_max: '',
    motorisation: '',
  };
  vehModeles: Modele[] = [];
  vehChargement = false;

  // --- Notification discrete ---
  notification: { texte: string; type: 'ok' | 'ko' } | null = null;
  private minuteurNotif?: any;

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse asynchrone
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private piecesService: PiecesServicegestion,
    private http: HttpClient,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const actuelle = new Date().getFullYear();
    for (let a = actuelle + 1; a >= 1990; a--) this.annees.push(a);

    this.chargerStock();
    this.chargerReferentiel();
  }

  // ==========================================================
  //  CHARGEMENT
  // ==========================================================
  chargerStock(): void {
    this.piecesService.getPieces().subscribe({
      next: (data: any[]) => {
        this.pieces = data.map((piece) => this.normaliser(piece));
        console.log(`✅ Stock chargé : ${this.pieces.length} pièces`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('❌ Erreur de récupération du stock:', err);
        this.cdr.markForCheck();
      },
    });
  }

  /** Forme commune d'une piece, a la reception comme apres modification */
  private normaliser(piece: any): any {
    return {
      ...piece,
      img: piece.img_principale || 'assets/logo.jpeg',
      compatibilites: piece.compatibilites || [],
      references: piece.references || [],
    };
  }

  private chargerReferentiel(): void {
    this.http.get<Marque[]>(`${environment.apiUrl}/modeles/marques`).subscribe({
      next: (data) => {
        this.marques = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('❌ Chargement des marques :', err),
    });

    this.http.get<Categorie[]>(`${environment.apiUrl}/modeles/categories`).subscribe({
      next: (data) => {
        this.categories = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('❌ Chargement des catégories :', err),
    });
  }

  onMarqueChange(idMarque: string): void {
    this.selectedModele = '';
    this.modelesDisponibles = [];
    if (!idMarque) return;

    this.chargementModeles = true;
    this.http.get<Modele[]>(`${environment.apiUrl}/modeles/marques/${idMarque}/modeles`).subscribe({
      next: (data) => {
        this.modelesDisponibles = data;
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
  //  AJUSTEMENT RAPIDE DU STOCK (boutons − et +)
  //
  //  Mise a jour optimiste : l'affichage change immediatement,
  //  puis on aligne sur la valeur renvoyee par le serveur. En
  //  cas d'echec, on revient a la valeur precedente.
  // ==========================================================
  ajusterStock(piece: any, delta: number, event?: Event): void {
    event?.stopPropagation();

    const id = Number(piece.id);
    const avant = Number(piece.quantite) || 0;
    const apres = avant + delta;

    if (apres < 0 || this.enCours.has(id)) return;

    this.enCours.add(id);
    piece.quantite = apres;
    this.cdr.markForCheck();

    this.http.patch<any>(`${environment.apiUrl}/stock/${id}/quantite`, { delta }).subscribe({
      next: (res) => {
        piece.quantite = res.quantite;
        this.enCours.delete(id);
        this.cdr.markForCheck();
      },
      error: (err) => {
        piece.quantite = avant;
        this.enCours.delete(id);
        this.notifier(err.error?.message || 'Quantité non enregistrée.', 'ko');
        this.cdr.markForCheck();
      },
    });
  }

  estEnCours(piece: any): boolean {
    return this.enCours.has(Number(piece.id));
  }

  // ==========================================================
  //  PHOTOS
  //
  //  Une piece importee sans adresse d'image entre en brouillon :
  //  elle est au stock mais invisible du client. Cette fenetre est
  //  la seule facon de refermer cet etat, et elle le referme SEULE :
  //  des la premiere photo le serveur republie la piece, des la
  //  derniere retiree il la remet en brouillon. Rien a cocher.
  // ==========================================================

  /** Nombre de photos effectivement posees */
  nbPhotos(piece: any): number {
    return this.COLONNES_IMAGES.filter((c) => piece[c]).length;
  }

  /** Une piece sans aucune photo : au stock, hors catalogue */
  estBrouillon(piece: any): boolean {
    return this.nbPhotos(piece) === 0;
  }

  /**
   * Masquee a la main, ce qui n'est pas la meme chose qu'un
   * brouillon : la piece a des photos mais le gestionnaire a
   * decoche sa visibilite. Les deux meritent un libelle different,
   * sinon on cherche une photo manquante qui ne manque pas.
   */
  estMasquee(piece: any): boolean {
    return Number(piece.visible_catalogue) === 0 && !this.estBrouillon(piece);
  }

  get nbBrouillons(): number {
    return this.pieces.filter((p) => this.estBrouillon(p)).length;
  }

  ouvrirPhotos(piece: any, event?: Event): void {
    event?.stopPropagation();
    this.erreurPhotos = null;
    this.photos = {
      id: Number(piece.id),
      ref: piece.ref || '',
      description: piece.description || '',
      liste: this.COLONNES_IMAGES.filter((c) => piece[c]).map((c) => ({
        colonne: c,
        url: piece[c],
      })),
    };
  }

  fermerPhotos(): void {
    if (this.envoiPhotos) return;
    this.photos = null;
    this.erreurPhotos = null;
  }

  get placesLibres(): number {
    return this.photos ? this.COLONNES_IMAGES.length - this.photos.liste.length : 0;
  }

  /** Remplace la piece dans la liste et reconstruit la fenetre */
  private appliquerPiece(recue: any): void {
    const piece = this.normaliser(recue);
    const index = this.pieces.findIndex((p) => Number(p.id) === Number(piece.id));
    if (index !== -1) this.pieces[index] = piece;

    if (this.photos && Number(this.photos.id) === Number(piece.id)) {
      this.photos.liste = this.COLONNES_IMAGES.filter((c) => piece[c]).map((c) => ({
        colonne: c,
        url: piece[c],
      }));
    }
  }

  onPhotosChoisies(event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichiers = Array.from(input.files || []);
    input.value = ''; // permet de rechoisir le meme fichier
    if (fichiers.length) this.envoyerPhotos(fichiers);
  }

  private envoyerPhotos(fichiers: File[]): void {
    if (!this.photos || this.envoiPhotos) return;

    const libres = this.placesLibres;
    if (libres === 0) {
      this.erreurPhotos = 'Cette pièce porte déjà 5 photos. Retirez-en une d’abord.';
      return;
    }

    // Tri cote client AVANT l'envoi : inutile de televerser un
    // fichier que le serveur refusera, surtout depuis un telephone
    // en 3G.
    const valides: File[] = [];
    for (const f of fichiers) {
      if (!f.type.startsWith('image/')) {
        this.erreurPhotos = `« ${f.name} » n’est pas une image.`;
        return;
      }
      if (f.size > this.TAILLE_MAX) {
        this.erreurPhotos = `« ${f.name} » dépasse 2 Mo.`;
        return;
      }
      valides.push(f);
    }

    const retenus = valides.slice(0, libres);
    const ignores = valides.length - retenus.length;

    const corps = new FormData();
    retenus.forEach((f) => corps.append('photos', f));

    this.envoiPhotos = true;
    this.erreurPhotos = null;
    this.cdr.markForCheck();

    this.http.post<any>(`${environment.apiUrl}/stock/${this.photos.id}/photos`, corps).subscribe({
      next: (res) => {
        this.appliquerPiece(res.piece);
        this.envoiPhotos = false;

        let texte = res.message;
        if (ignores > 0) {
          texte += ` ${ignores} fichier(s) non envoyé(s), faute de place.`;
        }
        this.notifier(texte, 'ok');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.envoiPhotos = false;
        this.erreurPhotos = err.error?.message || 'Envoi impossible.';
        this.cdr.markForCheck();
      },
    });
  }

  retirerPhoto(photo: PhotoPosee): void {
    if (!this.photos || this.envoiPhotos) return;

    const derniere = this.photos.liste.length === 1;
    const question = derniere
      ? 'C’est la dernière photo. La pièce repassera en brouillon et quittera le catalogue. Continuer ?'
      : 'Retirer cette photo ?';
    if (!confirm(question)) return;

    this.envoiPhotos = true;
    this.erreurPhotos = null;
    this.cdr.markForCheck();

    this.http
      .delete<any>(`${environment.apiUrl}/stock/${this.photos.id}/photos/${photo.colonne}`)
      .subscribe({
        next: (res) => {
          this.appliquerPiece(res.piece);
          this.envoiPhotos = false;
          this.notifier(res.message, 'ok');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.envoiPhotos = false;
          this.erreurPhotos = err.error?.message || 'Suppression impossible.';
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  VEHICULES COMPATIBLES
  //
  //  Symetrique des photos. Une piece sans vehicule rattache
  //  n'apparait dans aucun catalogue client, puisque la requete
  //  du catalogue fait une JOIN sur piece_compatibilite. Elle est
  //  au stock et invendable.
  //
  //  Le serveur savait deja rattacher un vehicule, mais aucun
  //  ecran ne le proposait : la page comptait les pieces non
  //  rattachees et savait les filtrer, sans offrir d'y remedier.
  // ==========================================================

  /** La piece ouverte dans la fenetre, telle qu'elle est dans la liste */
  get pieceVehicules(): any | null {
    if (!this.vehicules) return null;
    return this.pieces.find((p) => Number(p.id) === Number(this.vehicules!.id)) || null;
  }

  get listeVehicules(): any[] {
    return this.pieceVehicules?.compatibilites || [];
  }

  ouvrirVehicules(piece: any, event?: Event): void {
    event?.stopPropagation();
    this.erreurVehicules = null;
    this.vehSelection = {
      id_marque: '',
      id_modele: '',
      annee_min: '',
      annee_max: '',
      motorisation: '',
    };
    this.vehModeles = [];
    this.vehicules = {
      id: Number(piece.id),
      ref: piece.ref || '',
      description: piece.description || '',
    };
  }

  fermerVehicules(): void {
    if (this.envoiVehicule) return;
    this.vehicules = null;
    this.erreurVehicules = null;
  }

  /** Le choix d'une marque recharge SES modeles, sans toucher aux filtres */
  onVehMarqueChange(idMarque: string): void {
    this.vehSelection.id_modele = '';
    this.vehModeles = [];
    if (!idMarque) return;

    this.vehChargement = true;
    this.http.get<Modele[]>(`${environment.apiUrl}/modeles/marques/${idMarque}/modeles`).subscribe({
      next: (data) => {
        this.vehModeles = data;
        this.vehChargement = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('❌ Chargement des modèles :', err);
        this.vehChargement = false;
        this.cdr.markForCheck();
      },
    });
  }

  rattacherVehicule(): void {
    if (!this.vehicules || this.envoiVehicule) return;

    const s = this.vehSelection;
    if (!s.id_modele) {
      this.erreurVehicules = 'Choisissez un modèle.';
      return;
    }

    const min = s.annee_min ? Number(s.annee_min) : null;
    const max = s.annee_max ? Number(s.annee_max) : null;
    if (min && max && min > max) {
      this.erreurVehicules = "L'année de début doit précéder l'année de fin.";
      return;
    }

    this.envoiVehicule = true;
    this.erreurVehicules = null;
    this.cdr.markForCheck();

    const idPiece = this.vehicules.id;

    this.http
      .post<any>(`${environment.apiUrl}/pieces/${idPiece}/compatibilites`, {
        id_modele: Number(s.id_modele),
        annee_min: min,
        annee_max: max,
        motorisation: s.motorisation.trim() || null,
      })
      .subscribe({
        next: (res) => {
          const piece = this.pieces.find((p) => Number(p.id) === idPiece);
          if (piece) {
            piece.compatibilites = [...(piece.compatibilites || []), res.compatibilite];
          }

          // La marque reste choisie : on rattache souvent plusieurs
          // modeles d'affilee, la meme plaquette allant sur toute
          // une gamme.
          this.vehSelection.id_modele = '';
          this.vehSelection.motorisation = '';

          this.envoiVehicule = false;
          this.notifier(res.message, 'ok');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.envoiVehicule = false;
          this.erreurVehicules = err.error?.message || 'Rattachement impossible.';
          this.cdr.markForCheck();
        },
      });
  }

  detacherVehicule(compat: any): void {
    if (!this.vehicules || this.envoiVehicule) return;

    const derniere = this.listeVehicules.length === 1;
    const question = derniere
      ? 'C’est le dernier véhicule. La pièce quittera tous les catalogues clients. Continuer ?'
      : `Retirer ${compat.marque} ${compat.modele} ?`;
    if (!confirm(question)) return;

    this.envoiVehicule = true;
    this.erreurVehicules = null;
    this.cdr.markForCheck();

    const idPiece = this.vehicules.id;

    this.http.delete<any>(`${environment.apiUrl}/pieces/compatibilites/${compat.id}`).subscribe({
      next: (res) => {
        const piece = this.pieces.find((p) => Number(p.id) === idPiece);
        if (piece) {
          piece.compatibilites = (piece.compatibilites || []).filter(
            (c: any) => Number(c.id) !== Number(compat.id),
          );
        }
        this.envoiVehicule = false;
        this.notifier(res.message, 'ok');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.envoiVehicule = false;
        this.erreurVehicules = err.error?.message || 'Suppression impossible.';
        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  FENETRE D'EDITION
  // ==========================================================

  /** Ouvre la fenetre sur une COPIE : rien ne change tant qu'on n'enregistre pas */
  ouvrirEdition(piece: any): void {
    this.erreurEdition = null;
    this.edition = {
      id: Number(piece.id),
      description: piece.description || '',
      prix: piece.prix ?? null,
      quantite: Number(piece.quantite) || 0,
      seuil_alerte: Number(piece.seuil_alerte ?? this.SEUIL_DEFAUT),
      etat: piece.etat || 'Neuf',
      fournisseur: piece.fournisseur || '',
      ref: piece.ref || '',
      ref_oe: piece.ref_oe || '',
      visible_catalogue:
        piece.visible_catalogue === undefined ? true : !!Number(piece.visible_catalogue),
    };
  }

  fermerEdition(): void {
    if (this.enregistrement) return;
    this.edition = null;
    this.erreurEdition = null;
  }

  /** Echap ferme la fenetre ouverte */
  @HostListener('document:keydown.escape')
  surEchap(): void {
    if (this.photos) {
      this.fermerPhotos();
      this.cdr.markForCheck();
      return;
    }
    if (this.vehicules) {
      this.fermerVehicules();
      this.cdr.markForCheck();
      return;
    }
    if (this.edition) {
      this.fermerEdition();
      this.cdr.markForCheck();
    }
  }

  /** Validation cote client, doublee cote serveur */
  private validerEdition(e: EditionPiece): string | null {
    if (!e.description.trim()) return 'La désignation est obligatoire.';
    if (e.prix === null || e.prix === undefined || Number(e.prix) < 0) {
      return 'Le prix doit être un nombre positif.';
    }
    if (!Number.isInteger(Number(e.quantite)) || Number(e.quantite) < 0) {
      return 'La quantité doit être un entier positif.';
    }
    if (!Number.isInteger(Number(e.seuil_alerte)) || Number(e.seuil_alerte) < 0) {
      return "Le seuil d'alerte doit être un entier positif.";
    }
    return null;
  }

  enregistrerEdition(): void {
    if (!this.edition || this.enregistrement) return;

    const erreur = this.validerEdition(this.edition);
    if (erreur) {
      this.erreurEdition = erreur;
      return;
    }

    const e = this.edition;
    this.enregistrement = true;
    this.erreurEdition = null;
    this.cdr.markForCheck();

    // `ref` et `equipementier` ne sont plus envoyes : le serveur les
    // ignorait en silence, ce qui faisait croire a un enregistrement.
    const charge = {
      description: e.description.trim(),
      prix: Number(e.prix),
      quantite: Number(e.quantite),
      seuil_alerte: Number(e.seuil_alerte),
      etat: e.etat,
      fournisseur: e.fournisseur,
      ref_oe: e.ref_oe,
      visible_catalogue: e.visible_catalogue,
    };

    this.http.patch<any>(`${environment.apiUrl}/stock/${e.id}`, charge).subscribe({
      next: (res) => {
        // Le serveur renvoie la piece complete : on remplace la copie locale
        const index = this.pieces.findIndex((p) => Number(p.id) === e.id);
        if (index !== -1) this.pieces[index] = this.normaliser(res.piece);

        this.enregistrement = false;
        this.edition = null;
        this.notifier('Pièce mise à jour.', 'ok');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.enregistrement = false;
        this.erreurEdition = err.error?.message || 'Enregistrement impossible.';
        this.cdr.markForCheck();
      },
    });
  }

  private notifier(texte: string, type: 'ok' | 'ko'): void {
    this.notification = { texte, type };
    if (this.minuteurNotif) clearTimeout(this.minuteurNotif);
    this.minuteurNotif = setTimeout(() => {
      this.notification = null;
      this.cdr.markForCheck();
    }, 3500);
  }

  // ==========================================================
  //  SUPPRESSION
  // ==========================================================
  supprimerPiece(id: string | number | undefined): void {
    if (id === undefined) return;
    const idToDelete = id.toString();

    if (confirm('Voulez-vous vraiment retirer cette pièce du stock définitivement ?')) {
      this.piecesService.deletePiece(idToDelete).subscribe({
        next: (res: any) => {
          this.pieces = this.pieces.filter((p) => p._id !== idToDelete && p.id !== id);
          this.notifier(`Pièce retirée${res?.ref ? ' (' + res.ref + ')' : ''}.`, 'ok');
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('❌ Erreur lors de la suppression:', err);
          this.notifier('Impossible de supprimer la pièce.', 'ko');
          this.cdr.markForCheck();
        },
      });
    }
  }

  // ==========================================================
  //  ÉTAT DU STOCK
  // ==========================================================
  stockStatus(piece: any): 'rupture' | 'faible' | 'ok' {
    const q = Number(piece.quantite) || 0;
    const seuil = Number(piece.seuil_alerte ?? this.SEUIL_DEFAUT);
    if (q === 0) return 'rupture';
    if (q <= seuil) return 'faible';
    return 'ok';
  }

  stockLabel(piece: any): string {
    const status = this.stockStatus(piece);
    if (status === 'rupture') return 'en rupture';
    if (status === 'faible') return 'à réapprovisionner';
    return 'en stock';
  }

  // ==========================================================
  //  CHIFFRES CLÉS
  // ==========================================================
  get totalUnites(): number {
    return this.pieces.reduce((sum, p) => sum + (Number(p.quantite) || 0), 0);
  }

  get valeurStock(): number {
    return this.pieces.reduce(
      (sum, p) => sum + (Number(p.prix) || 0) * (Number(p.quantite) || 0),
      0,
    );
  }

  get nbAlertes(): number {
    return this.pieces.filter((p) => this.stockStatus(p) !== 'ok').length;
  }

  get nbSansCompat(): number {
    return this.pieces.filter((p) => !p.compatibilites?.length).length;
  }

  // ==========================================================
  //  FILTRAGE ET TRI
  // ==========================================================
  get hasFilters(): boolean {
    return !!(
      this.searchText ||
      this.selectedMarque ||
      this.selectedModele ||
      this.selectedAnnee ||
      this.selectedCategorie ||
      this.onlyAlerts ||
      this.onlySansCompat ||
      this.onlyBrouillons
    );
  }

  resetFilters(): void {
    this.searchText = '';
    this.selectedMarque = '';
    this.selectedModele = '';
    this.selectedAnnee = '';
    this.selectedCategorie = '';
    this.onlyAlerts = false;
    this.onlySansCompat = false;
    this.onlyBrouillons = false;
    this.modelesDisponibles = [];
  }

  get filteredPieces(): any[] {
    const search = this.searchText.trim().toLowerCase();
    const marqueNom = this.marques.find((m) => m.id === +this.selectedMarque)?.nom;

    const list = this.pieces.filter((piece) => {
      const compat = piece.compatibilites || [];

      const matchesSearch =
        !search ||
        piece.ref?.toLowerCase().includes(search) ||
        piece.ref_oe?.toLowerCase().includes(search) ||
        piece.description?.toLowerCase().includes(search) ||
        piece.fournisseur?.toLowerCase().includes(search) ||
        compat.some(
          (c: any) =>
            c.marque?.toLowerCase().includes(search) || c.modele?.toLowerCase().includes(search),
        ) ||
        (piece.references || []).some((r: any) => r.reference?.toLowerCase().includes(search));

      const matchesMarque = !marqueNom || compat.some((c: any) => c.marque === marqueNom);

      const matchesModele =
        !this.selectedModele || compat.some((c: any) => c.id_modele === +this.selectedModele);

      const annee = +this.selectedAnnee;
      const matchesAnnee =
        !this.selectedAnnee ||
        compat.some((c: any) => annee >= (c.annee_min || 0) && annee <= (c.annee_max || 9999));

      const matchesCategorie =
        !this.selectedCategorie || piece.categorie === this.selectedCategorie;

      const matchesAlerte = !this.onlyAlerts || this.stockStatus(piece) !== 'ok';

      const matchesSansCompat = !this.onlySansCompat || compat.length === 0;

      const matchesBrouillon = !this.onlyBrouillons || this.estBrouillon(piece);

      return (
        matchesSearch &&
        matchesMarque &&
        matchesModele &&
        matchesAnnee &&
        matchesCategorie &&
        matchesAlerte &&
        matchesSansCompat &&
        matchesBrouillon
      );
    });

    return this.sortList(list);
  }

  private sortList(list: any[]): any[] {
    const sorted = [...list];

    switch (this.sortBy) {
      case 'stock':
        return sorted.sort((a, b) => (Number(a.quantite) || 0) - (Number(b.quantite) || 0));
      case 'prix-asc':
        return sorted.sort((a, b) => (Number(a.prix) || 0) - (Number(b.prix) || 0));
      case 'prix-desc':
        return sorted.sort((a, b) => (Number(b.prix) || 0) - (Number(a.prix) || 0));
      case 'marque':
        return sorted.sort((a, b) =>
          (a.compatibilites?.[0]?.marque || '').localeCompare(b.compatibilites?.[0]?.marque || ''),
        );
      default:
        return sorted.sort((a, b) => {
          const da = a.date_ajout ? new Date(a.date_ajout).getTime() : Number(a.id) || 0;
          const db = b.date_ajout ? new Date(b.date_ajout).getTime() : Number(b.id) || 0;
          return db - da;
        });
    }
  }

  trackById(_index: number, piece: any): string | number {
    return piece._id ?? piece.id ?? _index;
  }

  goconnexion(): void {
    this.router.navigate(['/login']);
  }
}
