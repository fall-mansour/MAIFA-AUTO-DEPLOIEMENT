import { ChangeDetectorRef, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environnement';

// ============================================================
//  IMPORT ET EXPORT EN MASSE
//
//  Parcours en trois écrans :
//    dépôt    → le gestionnaire choisit son fichier
//    aperçu   → il voit ce qui va se passer, et corrige
//    rapport  → ce qui a été fait, et ce qui reste à faire
//
//  Rien n'est écrit au stock avant le bouton « Appliquer ».
// ============================================================

/**
 * Les motifs d'une ligne portent 'texte', les anomalies du fichier
 * entier portent 'message'. Les deux transitent par la même liste
 * à l'affichage, d'où les deux champs facultatifs.
 */
interface Message {
  gravite: 'erreur' | 'avertissement' | 'information' | 'bloquant';
  champ?: string;
  onglet?: string;
  texte?: string;
  message?: string;
}

interface LigneImport {
  id: number;
  onglet: 'pieces' | 'compatibilites';
  ligne_fichier: number;
  statut: 'pret' | 'a_confirmer' | 'anomalie' | 'ignoree';
  action: 'creation' | 'maj' | 'aucune';
  donnees: any;
  resolution: any;
  messages: Message[];
  id_piece: number | null;
}

interface Synthese {
  pieces: {
    total: number;
    creations: number;
    mises_a_jour: number;
    pretes: number;
    a_confirmer: number;
    anomalies: number;
    brouillons: number;
  };
  compatibilites: {
    total: number;
    pretes: number;
    a_confirmer: number;
    anomalies: number;
    ignorees: number;
  };
}

interface Marque {
  id: number;
  nom: string;
}
interface Modele {
  id: number;
  modele: string;
}

type Etape = 'depot' | 'apercu' | 'rapport';
type Filtre = 'tous' | 'a_corriger' | 'pieces' | 'compatibilites';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './import.html',
  styleUrl: './import.scss',
})
export class ImportComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly api = environment.apiUrl;

  // --- Parcours ------------------------------------------------
  etape: Etape = 'depot';

  // --- Dépôt ---------------------------------------------------
  fichier: File | null = null;
  survol = false;

  // --- Aperçu --------------------------------------------------
  idLot: number | null = null;
  nomFichier = '';
  synthese: Synthese | null = null;
  lignes: LigneImport[] = [];
  anomaliesFichier: Message[] = [];
  filtre: Filtre = 'tous';

  // --- Rapport -------------------------------------------------
  rapport: any = null;

  // --- Référentiel, pour corriger une ligne --------------------
  marques: Marque[] = [];
  modelesParMarque = new Map<number, Modele[]>();
  /** Marque choisie dans le sélecteur de correction, par ligne */
  marqueChoisie = new Map<number, number>();

  // --- États ---------------------------------------------------
  enCours = false;
  messageErreur = '';
  messageInfo = '';

  // ==========================================================
  //  CYCLE DE VIE
  // ==========================================================
  ngOnInit(): void {
    this.chargerMarques();
  }

  private get navigateur(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  // ==========================================================
  //  DÉPÔT DU FICHIER
  // ==========================================================
  onFichierChoisi(evenement: Event): void {
    const entree = evenement.target as HTMLInputElement;
    this.retenirFichier(entree.files?.[0] ?? null);
  }

  onDragOver(evenement: DragEvent): void {
    evenement.preventDefault();
    this.survol = true;
  }

  onDragLeave(evenement: DragEvent): void {
    evenement.preventDefault();
    this.survol = false;
  }

  onDrop(evenement: DragEvent): void {
    evenement.preventDefault();
    this.survol = false;
    this.retenirFichier(evenement.dataTransfer?.files?.[0] ?? null);
  }

  private retenirFichier(fichier: File | null): void {
    this.messageErreur = '';

    if (!fichier) return;

    if (!/\.xlsx$/i.test(fichier.name)) {
      this.messageErreur =
        'Le fichier doit être un classeur Excel (.xlsx). ' +
        'Depuis un .xls ou un .csv, enregistrez-le d abord au format .xlsx.';
      this.cdr.markForCheck();
      return;
    }

    if (fichier.size > 10 * 1024 * 1024) {
      this.messageErreur = 'Fichier trop volumineux. Maximum 10 Mo.';
      this.cdr.markForCheck();
      return;
    }

    this.fichier = fichier;
    this.cdr.markForCheck();
  }

  retirerFichier(): void {
    this.fichier = null;
    this.messageErreur = '';
    this.cdr.markForCheck();
  }

  get tailleFichier(): string {
    if (!this.fichier) return '';
    const ko = this.fichier.size / 1024;
    return ko > 1024 ? `${(ko / 1024).toFixed(1)} Mo` : `${Math.round(ko)} Ko`;
  }

  // ==========================================================
  //  TÉLÉCHARGEMENTS
  //
  //  Passage par HttpClient et non par un lien direct : les routes
  //  sont protégées, et c'est l'intercepteur qui pose le jeton.
  // ==========================================================
  private telecharger(url: string, nom: string): void {
    if (!this.navigateur) return;

    this.enCours = true;
    this.messageErreur = '';

    this.http.get(url, { responseType: 'blob' }).subscribe({
      next: (donnees) => {
        const lien = document.createElement('a');
        lien.href = URL.createObjectURL(donnees);
        lien.download = nom;
        lien.click();
        URL.revokeObjectURL(lien.href);

        this.enCours = false;
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.enCours = false;
        this.messageErreur = this.lireErreur(err, 'Téléchargement impossible.');
        this.cdr.markForCheck();
      },
    });
  }

  telechargerModele(): void {
    this.telecharger(`${this.api}/import/modele`, 'modele-import-MAIFA-AUTO.xlsx');
  }

  exporterStock(): void {
    const jour = new Date().toISOString().slice(0, 10);
    this.telecharger(`${this.api}/import/export`, `stock-MAIFA-AUTO-${jour}.xlsx`);
  }

  // ==========================================================
  //  ANALYSE
  // ==========================================================
  analyser(): void {
    if (!this.fichier || this.enCours) return;

    const corps = new FormData();
    corps.append('fichier', this.fichier);

    this.enCours = true;
    this.messageErreur = '';

    this.http.post<any>(`${this.api}/import/analyser`, corps).subscribe({
      next: (reponse) => {
        this.idLot = reponse.id_lot;
        this.nomFichier = reponse.fichier;
        this.synthese = reponse.synthese;
        this.lignes = reponse.lignes || [];
        this.anomaliesFichier = reponse.anomalies_fichier || [];
        this.etape = 'apercu';
        this.filtre = this.nbACorriger > 0 ? 'a_corriger' : 'tous';
        this.enCours = false;
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.enCours = false;
        this.messageErreur = this.lireErreur(err, 'Le fichier n a pas pu être analysé.');
        this.anomaliesFichier = err.error?.anomalies || [];
        this.cdr.markForCheck();
      },
    });
  }

  // ==========================================================
  //  LECTURE DE L'APERÇU
  // ==========================================================
  get lignesAffichees(): LigneImport[] {
    switch (this.filtre) {
      case 'a_corriger':
        return this.lignes.filter(
          (l) => l.statut === 'anomalie' || l.statut === 'a_confirmer',
        );
      case 'pieces':
        return this.lignes.filter((l) => l.onglet === 'pieces');
      case 'compatibilites':
        return this.lignes.filter((l) => l.onglet === 'compatibilites');
      default:
        return this.lignes;
    }
  }

  get nbACorriger(): number {
    return this.lignes.filter(
      (l) => l.statut === 'anomalie' || l.statut === 'a_confirmer',
    ).length;
  }

  get nbAnomalies(): number {
    return this.lignes.filter((l) => l.statut === 'anomalie').length;
  }

  get nbApplicables(): number {
    return this.lignes.filter((l) => l.statut === 'pret' || l.statut === 'a_confirmer')
      .length;
  }

  /** Résumé d'une ligne, pour la colonne principale du tableau */
  libelle(ligne: LigneImport): string {
    const d = ligne.donnees || {};
    if (ligne.onglet === 'pieces') {
      return d.description || '(désignation absente)';
    }
    return `${d.marque || '?'} / ${d.modele || '?'}`;
  }

  /** Référence lisible d'une ligne */
  referenceLigne(ligne: LigneImport): string {
    const d = ligne.donnees || {};
    if (ligne.onglet === 'pieces') {
      return d.ref_interne || d.ref_oe || '';
    }
    return d.ref_piece || '';
  }

  etiquetteAction(ligne: LigneImport): string {
    if (ligne.onglet === 'compatibilites') return 'véhicule';
    return ligne.action === 'maj' ? 'mise à jour' : 'création';
  }

  /** Vrai si la ligne attend un choix de modèle du gestionnaire */
  attendModele(ligne: LigneImport): boolean {
    return ligne.onglet === 'compatibilites' && !ligne.resolution?.id_modele;
  }

  candidats(ligne: LigneImport): Modele[] {
    return ligne.resolution?.candidats_modele || [];
  }

  // ==========================================================
  //  CORRECTION D'UNE LIGNE
  // ==========================================================
  private chargerMarques(): void {
    this.http.get<Marque[]>(`${this.api}/modeles/marques`).subscribe({
      next: (donnees) => {
        this.marques = donnees;
        this.cdr.markForCheck();
      },
      error: () => {
        /* le référentiel n'est utile qu'à la correction : échec silencieux */
      },
    });
  }

  /** Charge les modèles d'une marque, une seule fois */
  onMarqueChoisie(ligne: LigneImport, idMarque: string | number): void {
    const id = Number(idMarque);
    this.marqueChoisie.set(ligne.id, id);

    if (!id || this.modelesParMarque.has(id)) {
      this.cdr.markForCheck();
      return;
    }

    this.http
      .get<Modele[]>(`${this.api}/modeles/marques/${id}/modeles`)
      .subscribe({
        next: (donnees) => {
          this.modelesParMarque.set(id, donnees);
          this.cdr.markForCheck();
        },
        error: () => this.cdr.markForCheck(),
      });
  }

  modelesDisponibles(ligne: LigneImport): Modele[] {
    const id = this.marqueChoisie.get(ligne.id);
    return id ? this.modelesParMarque.get(id) || [] : [];
  }

  /** Le gestionnaire retient un modèle pour cette ligne */
  choisirModele(ligne: LigneImport, idModele: string | number): void {
    const id = Number(idModele);
    if (!id) return;
    this.corriger(ligne, { id_modele: id });
  }

  ignorerLigne(ligne: LigneImport): void {
    this.corriger(ligne, { ignorer: true });
  }

  private corriger(ligne: LigneImport, corps: any): void {
    if (!this.idLot || this.enCours) return;

    this.enCours = true;

    this.http
      .patch<any>(`${this.api}/import/lots/${this.idLot}/lignes/${ligne.id}`, corps)
      .subscribe({
        next: (reponse) => {
          // Mise à jour sur place : on évite de recharger tout le lot
          // pour un seul changement.
          const cible = this.lignes.find((l) => l.id === ligne.id);
          if (cible) {
            cible.statut = reponse.statut ?? 'ignoree';
            if (reponse.resolution) cible.resolution = reponse.resolution;
            if (reponse.messages) cible.messages = reponse.messages;
          }
          this.enCours = false;
          this.cdr.markForCheck();
        },
        error: (err: HttpErrorResponse) => {
          this.enCours = false;
          this.messageErreur = this.lireErreur(err, 'Correction impossible.');
          this.cdr.markForCheck();
        },
      });
  }

  // ==========================================================
  //  APPLICATION
  // ==========================================================
  appliquer(): void {
    if (!this.idLot || this.enCours) return;

    const n = this.nbApplicables;
    const avertissement =
      this.nbAnomalies > 0
        ? `\n\n${this.nbAnomalies} ligne(s) en anomalie ne seront pas appliquées.`
        : '';

    if (
      !confirm(
        `Appliquer ${n} ligne(s) au stock ?${avertissement}\n\n` +
          'Cette opération ne peut pas être annulée automatiquement.',
      )
    ) {
      return;
    }

    this.enCours = true;
    this.messageErreur = '';

    this.http
      .post<any>(`${this.api}/import/lots/${this.idLot}/appliquer`, {})
      .subscribe({
        next: (reponse) => {
          this.rapport = reponse.rapport;
          this.etape = 'rapport';
          this.enCours = false;
          this.cdr.markForCheck();
        },
        error: (err: HttpErrorResponse) => {
          this.enCours = false;
          this.messageErreur = this.lireErreur(
            err,
            'L import a échoué. Aucune modification n a été conservée.',
          );
          this.cdr.markForCheck();
        },
      });
  }

  abandonner(): void {
    if (!this.idLot) return this.recommencer();

    if (!confirm('Abandonner cet import ? Le fichier analysé sera écarté.')) return;

    this.http.delete(`${this.api}/import/lots/${this.idLot}`).subscribe({
      next: () => this.recommencer(),
      error: () => this.recommencer(),
    });
  }

  recommencer(): void {
    this.etape = 'depot';
    this.fichier = null;
    this.idLot = null;
    this.nomFichier = '';
    this.synthese = null;
    this.lignes = [];
    this.anomaliesFichier = [];
    this.rapport = null;
    this.messageErreur = '';
    this.messageInfo = '';
    this.marqueChoisie.clear();
    this.cdr.markForCheck();
  }

  // ==========================================================
  //  OUTILS
  // ==========================================================
  private lireErreur(err: HttpErrorResponse, defaut: string): string {
    if (err.status === 0) {
      return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
    }
    if (err.status === 401 || err.status === 403) {
      return 'Votre session a expiré. Reconnectez-vous.';
    }
    if (err.status === 413) {
      return 'Fichier trop volumineux. Maximum 10 Mo.';
    }
    return err.error?.message || defaut;
  }

  trackLigne(_index: number, ligne: LigneImport): number {
    return ligne.id;
  }
}