import { NgIf, NgFor, DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environnement';

interface Marque {
  id: number;
  nom: string;
  nb_modeles?: number;
}
interface Modele {
  id: number;
  modele: string;
  annee_debut?: number;
  annee_fin?: number;
}
interface Categorie {
  id: number;
  nom: string;
  slug: string;
}
interface SousCategorie {
  id: number;
  nom: string;
  slug: string;
}

/**
 * Une configuration de véhicule, apprise des recherches par numéro
 * de châssis faites par les CLIENTS sur la page d'accueil.
 *
 * Le gestionnaire ne la saisit pas : elle apparaît toute seule. Ce
 * qu'il voit, c'est `libelle` et `vues`, jamais wmi ni vds, qui
 * sont des codes constructeur sans intérêt pour lui.
 */
interface Configuration {
  id: number;
  wmi: string;
  vds: string;
  marque: string | null;
  modele: string | null;
  motorisation: string | null;
  carburant: string | null;
  boite: string | null;
  puissance: string | null;
  annee_min: number | null;
  annee_max: number | null;
  id_modele: number | null;
  vues: number;
  libelle: string;
  affiche_marque: string | null;
  affiche_modele: string | null;
  rattachable: boolean;
}

interface SyntheseConfig {
  total: number;
  rattachees: number;
  orphelines: number;
  recherches: number;
}

interface Compatibilite {
  id_modele: number;
  /** null = compatibilité large, sur tout le modèle */
  id_configuration: number | null;
  marque: string;
  modele: string;
  /** Libellé de la configuration, pour l'affichage de la puce */
  version: string | null;
  annee_min: number | null;
  annee_max: number | null;
  motorisation: string | null;
}

@Component({
  selector: 'app-ajoutpieces',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor, DecimalPipe],
  templateUrl: './ajoutpieces.html',
  styleUrl: './ajoutpieces.scss',
})
export class Ajoutpieces implements OnInit {
  // Modèle initial pour réinitialisation facile.
  //
  // `equipementier` a disparu : la colonne a été retirée de la
  // table `pieces`, le champ partait quand même dans le FormData et
  // comptait dans la jauge de complétion, qui ne pouvait donc
  // jamais atteindre 100 %.
  private readonly initialData = {
    description: '',
    categorie: '',
    sous_categorie: '',
    reference: '',
    ref_oe: '',
    etat: '',
    prix: null,
    quantite: null,
    fournisseur: '',
  };

  pieceData: any = { ...this.initialData };

  // ---------- Référentiel ----------
  marques: Marque[] = [];
  modelesDisponibles: Modele[] = [];
  categories: Categorie[] = [];
  sousCategories: SousCategorie[] = [];
  chargementSousCat = false;
  annees: number[] = [];
  etats = ['Neuf', 'Occasion'];
  chargementModeles = false;

  // ---------- Configurations issues des clients ----------
  configurations: Configuration[] = [];
  /** Celles du modèle actuellement choisi, pour la liste « Version » */
  versions: Configuration[] = [];
  syntheseConfig: SyntheseConfig = { total: 0, rattachees: 0, orphelines: 0, recherches: 0 };
  panneauVehicules = false;
  chargementConfigs = false;

  // ---------- Numéro de châssis saisi par le gestionnaire ----------
  vinSaisi = '';
  vinEnCours = false;
  vinMessage = '';
  vinErreur = false;

  // ---------- Compatibilités ----------
  selection = {
    id_marque: '',
    id_modele: '',
    id_configuration: '',
    annee_min: '',
    annee_max: '',
    motorisation: '',
  };
  compatibilites: Compatibilite[] = [];

  // ---------- Images ----------
  private readonly slots = ['img_principale', 'img1', 'img2', 'img3', 'img4'];
  selectedFiles: { [key: string]: File } = {};
  previews: { [key: string]: string } = {};
  fileNames: { [key: string]: string } = {};
  gallery: string[] = [];
  activeImage: string | null = null;
  dragTarget: string | null = null;
  saving = false;

  private readonly MAX_SIZE = 2 * 1024 * 1024; // 2 Mo

  // Mode zoneless : Angular doit etre prevenu apres chaque reponse asynchrone
  private cdr = inject(ChangeDetectorRef);

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    const actuelle = new Date().getFullYear();
    for (let a = actuelle + 1; a >= 1990; a--) this.annees.push(a);

    this.chargerMarques();
    this.chargerCategories();
    this.chargerConfigurations();
  }

  // ==========================================================
  //  RÉFÉRENTIEL
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

  private chargerCategories(): void {
    this.http.get<Categorie[]>(`${environment.apiUrl}/modeles/categories`).subscribe({
      next: (data) => {
        this.categories = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('❌ Chargement des catégories :', err),
    });
  }

  /** Le choix d'une marque recharge la liste de ses modèles */
  onMarqueChange(idMarque: string): void {
    this.selection.id_modele = '';
    this.modelesDisponibles = [];
    this.onModeleChange('');
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
  //  CATÉGORIES EN CASCADE
  // ==========================================================

  /** Le choix d'une famille recharge ses sous-catégories */
  onCategorieChange(slug: string): void {
    this.pieceData.sous_categorie = '';
    this.sousCategories = [];
    if (!slug) return;

    this.chargementSousCat = true;
    this.http
      .get<SousCategorie[]>(`${environment.apiUrl}/modeles/categories/${slug}/sous-categories`)
      .subscribe({
        next: (data) => {
          this.sousCategories = data;
          this.chargementSousCat = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('❌ Chargement des sous-catégories :', err);
          this.chargementSousCat = false;
          this.cdr.markForCheck();
        },
      });
  }

  /** Libellés lisibles pour l'aperçu */
  nomCategorie(): string {
    return this.categories.find((c) => c.slug === this.pieceData.categorie)?.nom || '';
  }

  nomSousCategorie(): string {
    return this.sousCategories.find((c) => c.slug === this.pieceData.sous_categorie)?.nom || '';
  }

  // ==========================================================
  //  CONFIGURATIONS APPRISES DES CLIENTS
  //
  //  Chargées UNE FOIS au démarrage, et filtrées ensuite côté
  //  navigateur. Le volume est borné par nature : la table décrit
  //  le parc réel des clients de Dakar, pas le catalogue européen.
  //  Une requête par changement de modèle serait du trafic pour
  //  rien.
  // ==========================================================
  private chargerConfigurations(): void {
    this.chargementConfigs = true;

    this.http
      .get<{
        configurations: Configuration[];
        synthese: SyntheseConfig;
      }>(`${environment.apiUrl}/configurations`)
      .subscribe({
        next: (data) => {
          this.configurations = data.configurations || [];
          this.syntheseConfig = data.synthese || this.syntheseConfig;
          this.chargementConfigs = false;
          this.majVersions();
          this.cdr.markForCheck();
        },
        error: (err) => {
          // Panne non bloquante : sans configurations, l'écran
          // fonctionne exactement comme avant, en compatibilité
          // large. On n'empêche pas le gestionnaire de travailler.
          console.error('❌ Chargement des configurations :', err);
          this.chargementConfigs = false;
          this.cdr.markForCheck();
        },
      });
  }

  /** Les véhicules rattachables, les plus cherchés d'abord */
  get vehiculesClients(): Configuration[] {
    return this.configurations.filter((c) => c.rattachable);
  }

  /** Le choix d'un modèle recharge la liste de ses versions */
  onModeleChange(idModele: string): void {
    this.selection.id_configuration = '';
    this.majVersions();
  }

  private majVersions(): void {
    const id = Number(this.selection.id_modele);
    this.versions = id ? this.configurations.filter((c) => c.id_modele === id) : [];
  }

  /**
   * Une version choisie pré-remplit la plage d'années observée.
   *
   * Pré-remplit, mais ne verrouille pas : une pièce peut n'équiper
   * qu'une partie de la période de production, et c'est au
   * gestionnaire de le savoir.
   *
   * La motorisation en texte libre est en revanche vidée et
   * désactivée. La configuration porte déjà cette information, et
   * garder les deux créerait deux vérités pour la même chose.
   */
  onConfigurationChange(id: string): void {
    this.selection.motorisation = '';
    if (!id) return;

    const c = this.configurations.find((v) => v.id === Number(id));
    if (!c) return;

    if (c.annee_min) this.selection.annee_min = String(c.annee_min);
    if (c.annee_max) this.selection.annee_max = String(c.annee_max);
  }

  // ==========================================================
  //  NUMÉRO DE CHÂSSIS SAISI PAR LE GESTIONNAIRE
  //
  //  Trois cas réels : un client qui appelle et donne son numéro,
  //  une pièce d'occasion prélevée sur un véhicule de la cour, une
  //  carte grise photographiée à l'atelier. Hors de ces cas, le
  //  gestionnaire n'a pas de VIN et n'a pas à en chercher un.
  // ==========================================================
  decoderVin(): void {
    const vin = this.vinSaisi.trim();
    if (!vin || this.vinEnCours) return;

    this.vinEnCours = true;
    this.vinMessage = '';
    this.vinErreur = false;

    this.http
      .post<{
        message: string;
        configuration: Configuration | null;
        rattachable: boolean;
      }>(`${environment.apiUrl}/configurations/vin`, { vin })
      .subscribe({
        next: (res) => {
          this.vinEnCours = false;
          this.vinMessage = res.message;
          this.vinErreur = !res.rattachable;

          if (res.configuration) {
            // Nouvelle configuration : on l'ajoute à la liste
            // locale pour qu'elle apparaisse immédiatement dans le
            // panneau et les listes déroulantes.
            const connue = this.configurations.some((c) => c.id === res.configuration!.id);
            if (!connue) this.configurations.unshift(res.configuration);
            this.majVersions();

            if (res.rattachable) {
              this.ajouterDepuisConfiguration(res.configuration);
              this.vinSaisi = '';
            }
          }

          this.cdr.markForCheck();
        },
        error: (err) => {
          this.vinEnCours = false;
          this.vinErreur = true;
          this.vinMessage = err.error?.message || 'Décodage indisponible.';
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  COMPATIBILITÉS
  // ==========================================================

  /**
   * Empreinte d'une ligne, alignée sur la colonne générée
   * `cle_unicite` de la base.
   *
   * L'ancien contrôle portait sur le seul id_modele, ce qui
   * interdisait d'ajouter deux versions du même modèle. C'est
   * exactement ce que cet écran doit permettre.
   */
  private cle(c: {
    id_modele: number;
    id_configuration: number | null;
    annee_min: number | null;
    annee_max: number | null;
    motorisation: string | null;
  }): string {
    return [
      c.id_modele,
      c.id_configuration || 0,
      c.annee_min || 0,
      c.annee_max || 0,
      (c.motorisation || '').trim().toUpperCase(),
    ].join('|');
  }

  ajouterCompatibilite(): void {
    const modele = this.modelesDisponibles.find((m) => m.id === +this.selection.id_modele);
    const marque = this.marques.find((m) => m.id === +this.selection.id_marque);
    if (!modele || !marque) return;

    const idConfiguration = this.selection.id_configuration
      ? +this.selection.id_configuration
      : null;
    const configuration = idConfiguration
      ? this.configurations.find((c) => c.id === idConfiguration) || null
      : null;

    const min = this.selection.annee_min ? +this.selection.annee_min : null;
    const max = this.selection.annee_max ? +this.selection.annee_max : null;

    if (min && max && min > max) {
      alert("⚠️ L'année de début doit précéder l'année de fin.");
      return;
    }

    const ligne: Compatibilite = {
      id_modele: modele.id,
      id_configuration: idConfiguration,
      marque: marque.nom,
      modele: modele.modele,
      version: configuration ? configuration.libelle : null,
      annee_min: min,
      annee_max: max,
      motorisation: idConfiguration ? null : this.selection.motorisation.trim() || null,
    };

    if (this.compatibilites.some((c) => this.cle(c) === this.cle(ligne))) {
      alert('⚠️ Ce véhicule est déjà dans la liste.');
      return;
    }

    this.compatibilites.push(ligne);

    // On garde la marque et le modèle : on ajoute souvent plusieurs
    // versions du même véhicule à la suite.
    this.selection.id_configuration = '';
    this.selection.motorisation = '';
    this.cdr.markForCheck();
  }

  /**
   * Ajout direct depuis le panneau des véhicules clients, sans
   * passer par la cascade.
   *
   * C'est le chemin le plus court et celui qui sera le plus
   * emprunté : le gestionnaire voit « SKODA FABIA 1.4 TDI, 3
   * clients » et clique.
   */
  ajouterDepuisConfiguration(c: Configuration): void {
    if (!c.id_modele) {
      alert(
        `⚠️ ${c.affiche_marque || c.marque} n'est pas dans votre référentiel de marques et modèles. ` +
          'Ajoutez-le, puis relancez le rattrapage.',
      );
      return;
    }

    const ligne: Compatibilite = {
      id_modele: c.id_modele,
      id_configuration: c.id,
      marque: c.affiche_marque || c.marque || '',
      modele: c.affiche_modele || c.modele || '',
      version: c.libelle,
      annee_min: c.annee_min,
      annee_max: c.annee_max,
      motorisation: null,
    };

    if (this.compatibilites.some((x) => this.cle(x) === this.cle(ligne))) {
      alert('⚠️ Ce véhicule est déjà dans la liste.');
      return;
    }

    this.compatibilites.push(ligne);
    this.cdr.markForCheck();
  }

  /** Déjà retenue ? Pour griser le bouton du panneau. */
  dejaRetenue(c: Configuration): boolean {
    return this.compatibilites.some(
      (x) => x.id_configuration === c.id && x.id_modele === c.id_modele,
    );
  }

  retirerCompatibilite(index: number): void {
    this.compatibilites.splice(index, 1);
  }

  // ==========================================================
  //  IMAGES
  // ==========================================================
  onFileSelect(event: any, fieldName: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file, fieldName);
    input.value = '';
  }

  onDragOver(event: DragEvent, fieldName: string): void {
    event.preventDefault();
    this.dragTarget = fieldName;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragTarget = null;
  }

  onDrop(event: DragEvent, fieldName: string): void {
    event.preventDefault();
    this.dragTarget = null;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file, fieldName);
  }

  private handleFile(file: File, fieldName: string): void {
    if (!file.type.startsWith('image/')) {
      alert('⚠️ Seules les images JPG ou PNG sont acceptées.');
      return;
    }
    if (file.size > this.MAX_SIZE) {
      alert('⚠️ Image trop lourde : 2 Mo maximum.');
      return;
    }

    this.selectedFiles[fieldName] = file;
    this.fileNames[fieldName] = file.name;

    const reader = new FileReader();
    reader.onload = () => {
      this.previews[fieldName] = reader.result as string;
      this.syncGallery();
      this.cdr.markForCheck(); // FileReader est asynchrone : meme probleme
    };
    reader.readAsDataURL(file);
  }

  removeImage(fieldName: string): void {
    delete this.selectedFiles[fieldName];
    delete this.previews[fieldName];
    delete this.fileNames[fieldName];
    this.syncGallery();
  }

  private syncGallery(): void {
    this.gallery = this.slots.map((s) => this.previews[s]).filter((src): src is string => !!src);

    if (!this.activeImage || !this.gallery.includes(this.activeImage)) {
      this.activeImage = this.gallery[0] ?? null;
    }
  }

  // ==========================================================
  //  INDICATEURS
  // ==========================================================
  get totalFields(): number {
    return Object.keys(this.initialData).length + 1; // +1 pour les compatibilités
  }

  get filledCount(): number {
    const champs = Object.values(this.pieceData).filter(
      (v) => v !== null && v !== undefined && v !== '',
    ).length;
    return champs + (this.compatibilites.length > 0 ? 1 : 0);
  }

  get completion(): number {
    return Math.round((this.filledCount / this.totalFields) * 100);
  }

  get isLowStock(): boolean {
    const q = Number(this.pieceData.quantite);
    return q > 0 && q < 3;
  }

  /** Combien de compatibilités sont précises plutôt que larges */
  get nbPrecises(): number {
    return this.compatibilites.filter((c) => c.id_configuration).length;
  }

  // ==========================================================
  //  ENVOI
  // ==========================================================
  onSubmit(): void {
    if (!this.pieceData.description) {
      alert('⚠️ La désignation de la pièce est obligatoire.');
      return;
    }

    if (this.compatibilites.length === 0) {
      alert('⚠️ Ajoutez au moins un véhicule compatible.');
      return;
    }

    if (
      !this.selectedFiles['img_principale'] ||
      !this.selectedFiles['img1'] ||
      !this.selectedFiles['img2']
    ) {
      alert("⚠️ Attention : L'image principale et les images 1 et 2 sont obligatoires !");
      return;
    }

    const formData = new FormData();

    // Champs simples
    Object.keys(this.pieceData).forEach((key) => {
      const value = this.pieceData[key];
      formData.append(key, value !== null && value !== undefined ? value.toString() : '');
    });

    // Colonnes historiques de `pieces` : on y met le premier véhicule,
    // ce qui garde la page d'accueil client fonctionnelle.
    const principal = this.compatibilites[0];
    formData.append('marque', principal.marque);
    formData.append('modele', principal.modele);
    formData.append('annee', principal.annee_min ? String(principal.annee_min) : '');

    // Compatibilités structurées, lues par le contrôleur
    formData.append(
      'compatibilites',
      JSON.stringify(
        this.compatibilites.map((c) => ({
          id_modele: c.id_modele,
          id_configuration: c.id_configuration,
          annee_min: c.annee_min,
          annee_max: c.annee_max,
          motorisation: c.motorisation,
        })),
      ),
    );

    Object.keys(this.selectedFiles).forEach((key) => {
      formData.append(key, this.selectedFiles[key]);
    });

    console.log('🚀 Envoi vers Cloudinary et la base de données...');
    this.saving = true;

    this.http.post(`${environment.apiUrl}/pieces/ajouter`, formData).subscribe({
      next: (res: any) => {
        console.log('✅ Succès :', res);
        this.saving = false;
        this.resetForm();
        this.cdr.markForCheck();
        alert(`Succès : ${res.message} (${res.compatibilites} véhicule(s) rattaché(s))`);
      },
      error: (err) => {
        console.error("❌ Erreur lors de l'envoi :", err);
        this.saving = false;
        this.cdr.markForCheck();
        const errorMsg =
          err.error?.message || 'Le serveur ne répond pas. Vérifiez votre connexion.';
        alert('Erreur : ' + errorMsg);
      },
    });
  }

  resetForm(): void {
    this.pieceData = { ...this.initialData };
    this.compatibilites = [];
    this.selection = {
      id_marque: '',
      id_modele: '',
      id_configuration: '',
      annee_min: '',
      annee_max: '',
      motorisation: '',
    };
    this.modelesDisponibles = [];
    this.versions = [];
    this.sousCategories = [];
    this.selectedFiles = {};
    this.previews = {};
    this.fileNames = {};
    this.gallery = [];
    this.activeImage = null;
    this.vinSaisi = '';
    this.vinMessage = '';
    this.vinErreur = false;
  }
}
