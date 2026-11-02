import { Component, EventEmitter, Output, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environnement';

// ============================================================
//  MAIFA-AUTO — RECHERCHE PAR NUMÉRO DE CHÂSSIS
//
//  FONCTIONNALITÉ D'ESSAI. Un seul fichier : gabarit et styles
//  sont en ligne. Pour la retirer, supprime ce fichier et les
//  deux lignes qu'il occupe dans acceuil.html / acceuil.ts.
//
//  Le composant ne remplace PAS les listes marque / modèle /
//  année : il les pré-remplit. Il émet ce qu'il a trouvé, le
//  parent décide quoi en faire. C'est voulu — l'API ne couvre
//  qu'une partie du parc sénégalais, et un raccourci de saisie
//  qui échoue laisse le client continuer normalement.
// ============================================================

export interface VehiculeVin {
  marque: string | null;
  modele: string | null;
  annee: number | null;
}

interface ReponseVin {
  valide: boolean;
  vin?: string;
  marque?: string | null;
  modele?: string | null;
  annee?: number | null;
  annees_possibles?: number[];
  annee_certaine?: boolean;
  pays?: string | null;
  controle_ok?: boolean | null;
  complet?: boolean;
  message?: string;
  details?: {
    // Renvoyés par vPIC comme par Vehicle Databases
    carrosserie?: string | null;
    motorisation?: string | null;
    carburant?: string | null;
    usine?: string | null;
    // Propres à Vehicle Databases : ils sont PAYÉS, donc affichés.
    // Sans ces quatre lignes, le crédit achèterait des données que
    // personne ne verrait jamais.
    puissance?: string | null;
    boite?: string | null;
    portes?: string | null;
    places?: string | null;
    transmission?: string | null;
    finition?: string | null;
  };
}

/** Réponse de POST /api/vin/extraire */
interface ExtractionVin {
  vin: string | null;
  score: number;
  confiance: 'haute' | 'moyenne' | 'faible' | 'aucune';
  marque?: string | null;
  message?: string;
}

@Component({
  selector: 'app-recherche-vin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="vin-bloc">
      <!-- ---------- Saisie ---------- -->
      <div class="vin-saisie">
        <div class="vin-champ" [class.erreur]="erreur">
          <svg
            class="vin-icone"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="7" width="18" height="10" rx="2"></rect>
            <path d="M7 11h2M11 11h2M15 11h2M7 14h10"></path>
          </svg>

          <input
            type="text"
            [(ngModel)]="vin"
            (ngModelChange)="auChangement()"
            (keyup.enter)="chercher()"
            maxlength="21"
            autocomplete="off"
            spellcheck="false"
            placeholder="Ex. VF3LCYHZ7JS123456"
            aria-label="Numéro de châssis (VIN)"
          />

          <span class="vin-compteur" [class.pleine]="longueur === 17"> {{ longueur }}/17 </span>
        </div>

        <button type="button" class="vin-btn" (click)="chercher()" [disabled]="chargement">
          <span *ngIf="!chargement">Identifier</span>
          <span *ngIf="chargement" class="vin-rond"></span>
        </button>
      </div>

      <!--
        PHOTO DE LA CARTE GRISE
        Masqué sur grand écran par la feuille de style : sur un
        ordinateur, taper dix-sept caractères est plus rapide que
        de chercher une photo.
      -->
      <label class="vin-photo" [class.is-off]="lecturePhoto">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          [disabled]="lecturePhoto"
          (change)="onPhotoChoisie($event)"
        />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="14" rx="2"></rect>
          <circle cx="12" cy="13" r="3.2"></circle>
          <path d="M8 6l1.5-2h5L16 6"></path>
        </svg>
        <span *ngIf="!lecturePhoto">Photographier le numéro sur la carte grise</span>
        <span *ngIf="lecturePhoto">{{ etapePhoto }}</span>
      </label>

      <p class="vin-erreur" *ngIf="erreurPhoto">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 8v4M12 16h.01"></path>
        </svg>
        {{ erreurPhoto }}
      </p>

      <p class="vin-lu" *ngIf="lectureConfiance && !erreurPhoto">
        <ng-container [ngSwitch]="lectureConfiance">
          <span *ngSwitchCase="'haute'">
            Numéro lu sur la photo. Vérifiez-le puis lancez la recherche.
          </span>
          <span *ngSwitchDefault>
            Numéro lu, mais la photo n’était pas très nette.
            <strong>Relisez-le caractère par caractère</strong> avant de continuer.
          </span>
        </ng-container>
      </p>

      <p class="vin-aide" *ngIf="!resultat && !erreur">
        17 caractères, sur la carte grise (champ E) ou au bas du pare-brise côté conducteur.
      </p>

      <!-- ---------- Erreur de saisie ---------- -->
      <p class="vin-erreur" *ngIf="erreur">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 8v4M12 16h.01"></path>
        </svg>
        {{ erreur }}
      </p>

      <!-- ---------- Résultat ---------- -->
      <div class="vin-resultat" *ngIf="resultat" [class.partiel]="!resultat.complet">
        <div class="vin-tete">
          <div class="vin-pastille" [class.ok]="resultat.complet">
            <svg
              *ngIf="resultat.complet"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5"></path>
            </svg>
            <svg
              *ngIf="!resultat.complet"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 8v4M12 16h.01"></path>
            </svg>
          </div>

          <div class="vin-titre">
            <strong *ngIf="resultat.marque">
              {{ resultat.marque }}<span *ngIf="resultat.modele"> {{ resultat.modele }}</span>
            </strong>
            <strong *ngIf="!resultat.marque">Véhicule non reconnu</strong>
            <span class="vin-sous">{{ resultat.message }}</span>
          </div>
        </div>

        <!-- Caractéristiques, quand l'API en a renvoyé -->
        <ul class="vin-faits" *ngIf="faits.length">
          <li *ngFor="let f of faits">
            <span>{{ f.libelle }}</span>
            <strong>{{ f.valeur }}</strong>
          </li>
        </ul>

        <!-- Année ambiguë : le code du millésime revient tous les 30 ans -->
        <div class="vin-choix" *ngIf="anneesAuChoix.length > 1">
          <p>Deux millésimes correspondent à ce numéro. Lequel est le bon&nbsp;?</p>
          <div class="vin-annees">
            <button
              type="button"
              *ngFor="let a of anneesAuChoix"
              [class.actif]="a === anneeRetenue"
              (click)="choisirAnnee(a)"
            >
              {{ a }}
            </button>
          </div>
        </div>

        <!-- Report vers les listes -->
        <div class="vin-actions" *ngIf="resultat.marque">
          <button type="button" class="vin-appliquer" (click)="appliquer()">
            Chercher les pièces de ce véhicule
          </button>
          <button type="button" class="vin-effacer" (click)="reinitialiser()">Recommencer</button>
        </div>
        <div class="vin-actions" *ngIf="!resultat.marque">
          <button type="button" class="vin-effacer" (click)="reinitialiser()">
            Essayer un autre numéro
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .vin-bloc {
        --navy: #12314b;
        --orange: #f2762e;
        --orange-700: #c25317;
        --dim: #647489;
        --ligne: #dfe5ee;
      }

      /* ---------- Saisie ---------- */
      .vin-saisie {
        display: flex;
        gap: 10px;
        align-items: stretch;
      }

      .vin-champ {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        padding: 0 14px;
        background: #fff;
        border: 1.5px solid var(--ligne);
        border-radius: 12px;
        transition:
          border-color 0.18s,
          box-shadow 0.18s;
      }
      .vin-champ:focus-within {
        border-color: var(--orange);
        box-shadow: 0 0 0 3px rgba(242, 118, 46, 0.14);
      }
      .vin-champ.erreur {
        border-color: #cc1f1f;
      }

      .vin-icone {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        color: var(--dim);
      }

      .vin-champ input {
        flex: 1;
        min-width: 0;
        padding: 14px 0;
        border: 0;
        outline: 0;
        background: transparent;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 1.4px;
        text-transform: uppercase;
        color: var(--navy);
        font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
      }
      .vin-champ input::placeholder {
        letter-spacing: 0.6px;
        font-weight: 500;
        text-transform: none;
        color: #9aa7b6;
        font-family: inherit;
      }

      .vin-compteur {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 700;
        color: #9aa7b6;
        font-variant-numeric: tabular-nums;
      }
      .vin-compteur.pleine {
        color: #077f55;
      }

      .vin-btn {
        flex: 0 0 auto;
        min-width: 124px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 24px;
        border: 0;
        border-radius: 12px;
        background: var(--orange);
        color: #081724;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition:
          background 0.18s,
          transform 0.12s;
      }
      .vin-btn:hover:not(:disabled) {
        background: var(--orange-700);
        color: #fff;
      }
      .vin-btn:active:not(:disabled) {
        transform: translateY(1px);
      }
      .vin-btn:disabled {
        opacity: 0.65;
        cursor: default;
      }

      .vin-rond {
        width: 17px;
        height: 17px;
        border: 2.4px solid rgba(8, 23, 36, 0.28);
        border-top-color: #081724;
        border-radius: 50%;
        animation: vin-tourne 0.7s linear infinite;
      }
      @keyframes vin-tourne {
        to {
          transform: rotate(360deg);
        }
      }

      /* ---------- Messages ---------- */
      .vin-aide {
        margin: 10px 2px 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--dim);
      }

      .vin-erreur {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        margin: 10px 2px 0;
        font-size: 13.5px;
        line-height: 1.5;
        font-weight: 600;
        color: #cc1f1f;
      }
      .vin-erreur svg {
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
        margin-top: 1px;
      }

      /* ---------- Résultat ---------- */
      .vin-resultat {
        margin-top: 14px;
        padding: 16px 18px;
        background: #ecfdf5;
        border: 1px solid #a7e8cd;
        border-radius: 12px;
      }
      .vin-resultat.partiel {
        background: #fff8f1;
        border-color: #f8c9a8;
      }

      .vin-tete {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .vin-pastille {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--orange);
        color: #fff;
      }
      .vin-pastille.ok {
        background: #077f55;
      }
      .vin-pastille svg {
        width: 17px;
        height: 17px;
      }

      .vin-titre {
        min-width: 0;
      }
      .vin-titre strong {
        display: block;
        font-size: 17px;
        line-height: 1.3;
        color: var(--navy);
      }
      .vin-sous {
        display: block;
        margin-top: 3px;
        font-size: 13.5px;
        line-height: 1.5;
        color: #40566f;
      }

      /* ---------- Caractéristiques ---------- */
      .vin-faits {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
        padding: 0;
        list-style: none;
      }
      .vin-faits li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 7px 12px;
        background: rgba(255, 255, 255, 0.75);
        border: 1px solid rgba(18, 49, 75, 0.08);
        border-radius: 8px;
      }
      .vin-faits span {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--dim);
      }
      .vin-faits strong {
        font-size: 13.5px;
        color: var(--navy);
      }

      /* ---------- Année ambiguë ---------- */
      .vin-choix {
        margin-top: 14px;
        padding-top: 13px;
        border-top: 1px solid rgba(18, 49, 75, 0.1);
      }
      .vin-choix p {
        margin: 0 0 8px;
        font-size: 13px;
        color: #40566f;
      }
      .vin-annees {
        display: flex;
        gap: 8px;
      }
      .vin-annees button {
        padding: 7px 18px;
        background: #fff;
        border: 1.5px solid var(--ligne);
        border-radius: 99px;
        font-size: 14px;
        font-weight: 700;
        color: var(--navy);
        cursor: pointer;
        font-variant-numeric: tabular-nums;
        transition:
          border-color 0.15s,
          background 0.15s;
      }
      .vin-annees button:hover {
        border-color: var(--orange);
      }
      .vin-annees button.actif {
        background: var(--navy);
        border-color: var(--navy);
        color: #fff;
      }

      /* ---------- Actions ---------- */
      .vin-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin-top: 15px;
      }
      .vin-appliquer,
      .vin-effacer {
        padding: 11px 20px;
        border-radius: 99px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition:
          background 0.16s,
          color 0.16s;
      }
      .vin-appliquer {
        border: 0;
        background: var(--navy);
        color: #fff;
      }
      .vin-appliquer:hover {
        background: #081724;
      }
      .vin-effacer {
        background: transparent;
        border: 1.5px solid var(--ligne);
        color: #40566f;
      }
      .vin-effacer:hover {
        border-color: var(--navy);
        color: var(--navy);
      }

      /* ---------- Photo de la carte grise ---------- */
      /*
        Caché au-dessus de 820 px : sur un ordinateur, taper
        dix-sept caractères va plus vite que de retrouver une
        photo dans ses dossiers.
      */
      .vin-photo {
        display: none;
      }

      @media (max-width: 820px) {
        .vin-photo {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          margin-top: 10px;
          padding: 13px 16px;
          border: 1.5px dashed var(--ligne);
          border-radius: 12px;
          background: #fff;
          font-size: 14px;
          font-weight: 700;
          color: var(--navy);
          cursor: pointer;
          text-align: center;
          transition:
            border-color 0.16s,
            background 0.16s;
        }

        .vin-photo input {
          position: absolute;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        }

        .vin-photo svg {
          flex: 0 0 auto;
          width: 19px;
          height: 19px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .vin-photo:active {
          border-color: var(--orange);
          background: #fff8f3;
        }

        .vin-photo.is-off {
          border-style: solid;
          border-color: var(--navy);
          background: var(--navy);
          color: #fff;
          cursor: default;
          pointer-events: none;
        }
      }

      .vin-lu {
        margin: 10px 2px 0;
        font-size: 13px;
        line-height: 1.5;
        color: #40566f;
      }
      .vin-lu strong {
        color: var(--orange-700);
      }

      /* ---------- Téléphone ---------- */
      @media (max-width: 560px) {
        .vin-saisie {
          flex-direction: column;
        }
        .vin-btn {
          min-width: 0;
          padding: 14px 24px;
        }
        .vin-champ input {
          font-size: 14px;
          letter-spacing: 1px;
        }
      }
    `,
  ],
})
export class RechercheVinComponent {
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef); // zoneless : rien ne se redessine tout seul

  /** Véhicule identifié, à reporter sur les listes marque / modèle / année */
  @Output() vehiculeTrouve = new EventEmitter<VehiculeVin>();

  vin = '';
  chargement = false;
  erreur = '';
  resultat: ReponseVin | null = null;
  anneeRetenue: number | null = null;

  // --- Lecture de la photo ---
  lecturePhoto = false;
  etapePhoto = '';
  erreurPhoto = '';
  lectureConfiance: string | null = null;

  /**
   * Tesseract, chargé depuis un CDN et SEULEMENT au premier appui
   * sur le bouton photo.
   *
   * Le moteur pèse quelques mégaoctets. L'inclure dans le paquet
   * de l'application le ferait télécharger à CHAQUE visiteur de
   * la page d'accueil, y compris aux neuf sur dix qui ne
   * photographieront jamais rien. Sur une connexion de Dakar, ce
   * serait payer très cher une fonctionnalité d'appoint.
   */
  private static readonly TESSERACT_CDN =
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  /**
   * Caractères que la reconnaissance a le droit de produire.
   *
   * I, O et Q sont volontairement ABSENTS : ils sont interdits
   * dans un numéro de châssis. En les retirant de l'alphabet, on
   * force le moteur à choisir 1 et 0 là où il hésitait, ce qui
   * supprime d'un coup les confusions les plus fréquentes.
   */
  private static readonly ALPHABET_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

  private readonly api = `${environment.apiUrl}/vin`;

  get longueur(): number {
    return this.vin.replace(/[^A-Za-z0-9]/g, '').length;
  }

  get anneesAuChoix(): number[] {
    if (!this.resultat || this.resultat.annee_certaine) return [];
    return this.resultat.annees_possibles || [];
  }

  /** Caractéristiques à afficher, dans l'ordre où elles intéressent un acheteur de pièces */
  get faits(): { libelle: string; valeur: string }[] {
    const r = this.resultat;
    if (!r) return [];

    const liste: { libelle: string; valeur: string }[] = [];
    const ajouter = (libelle: string, valeur?: string | number | null) => {
      if (valeur !== null && valeur !== undefined && String(valeur).trim() !== '') {
        liste.push({ libelle, valeur: String(valeur) });
      }
    };

    // Quand le millésime est ambigu, il est déjà présenté plus bas
    // sous forme de choix : l'afficher aussi ici le ferait lire deux fois.
    if (this.anneesAuChoix.length <= 1) {
      ajouter('Année', this.anneeRetenue ?? r.annee);
    }
    // Ordonnés par utilité réelle pour un acheteur de pièces : la
    // motorisation distingue une 1.4 HDi d'une 1.6, la boîte change
    // l'embrayage et le volant moteur. La finition et le nombre de
    // portes ferment la marche, ils ne changent presque jamais la
    // pièce.
    ajouter('Motorisation', r.details?.motorisation);
    ajouter('Puissance', r.details?.puissance ? `${r.details.puissance} ch` : null);
    ajouter('Carburant', r.details?.carburant);
    ajouter('Boîte', r.details?.boite);
    ajouter('Carrosserie', r.details?.carrosserie);
    ajouter('Transmission', r.details?.transmission);
    ajouter('Portes', r.details?.portes);
    ajouter('Places', r.details?.places);
    ajouter('Finition', r.details?.finition);
    ajouter('Assemblage', r.details?.usine || r.pays);

    return liste;
  }

  /** La saisie efface le résultat précédent : afficher l'ancien serait mentir */
  auChangement(): void {
    if (this.resultat || this.erreur) {
      this.resultat = null;
      this.erreur = '';
    }
    // Le bandeau « numéro lu sur la photo » ne survit pas à une
    // correction manuelle : il ne décrirait plus ce qu'on lit.
    this.lectureConfiance = null;
    this.erreurPhoto = '';
  }

  // ==========================================================
  //  PHOTO DE LA CARTE GRISE
  //
  //  Le client photographie la case du numéro de châssis. La
  //  reconnaissance de caractères tourne DANS SON NAVIGATEUR :
  //  la photo ne quitte jamais son téléphone, rien n'est stocké,
  //  et aucun crédit n'est consommé.
  //
  //  Seul le TEXTE reconnu part vers le serveur, qui y retrouve
  //  le numéro grâce à sa table des codes constructeur. Le
  //  résultat remplit le champ, qui reste modifiable : l'objectif
  //  est d'éviter dix-sept caractères de saisie, pas d'atteindre
  //  la certitude.
  // ==========================================================

  /** Charge le moteur une seule fois, à la demande */
  private async chargerMoteur(): Promise<any> {
    const fenetre = window as any;
    if (fenetre.Tesseract) return fenetre.Tesseract;

    await new Promise<void>((resoudre, rejeter) => {
      const balise = document.createElement('script');
      balise.src = RechercheVinComponent.TESSERACT_CDN;
      balise.async = true;
      balise.onload = () => resoudre();
      balise.onerror = () => rejeter(new Error('moteur introuvable'));
      document.head.appendChild(balise);
    });

    if (!fenetre.Tesseract) throw new Error('moteur non initialisé');
    return fenetre.Tesseract;
  }

  async onPhotoChoisie(event: Event): Promise<void> {
    const entree = event.target as HTMLInputElement;
    const fichier = entree.files?.[0];
    entree.value = ''; // permet de rephotographier le même cliché
    if (!fichier || this.lecturePhoto) return;

    if (!fichier.type.startsWith('image/')) {
      this.erreurPhoto = 'Ce fichier n’est pas une image.';
      this.cdr.markForCheck();
      return;
    }

    this.lecturePhoto = true;
    this.erreurPhoto = '';
    this.lectureConfiance = null;
    this.etapePhoto = 'Préparation…';
    this.cdr.markForCheck();

    let ouvrier: any = null;

    try {
      const Tesseract = await this.chargerMoteur();

      this.etapePhoto = 'Lecture de la photo…';
      this.cdr.markForCheck();

      ouvrier = await Tesseract.createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            this.etapePhoto = `Lecture… ${Math.round((m.progress || 0) * 100)} %`;
            this.cdr.markForCheck();
          }
        },
      });

      await ouvrier.setParameters({
        tessedit_char_whitelist: RechercheVinComponent.ALPHABET_VIN,
      });

      const { data } = await ouvrier.recognize(fichier);
      const texte = String(data?.text || '');

      this.etapePhoto = 'Recherche du numéro…';
      this.cdr.markForCheck();

      // Le serveur retrouve le VIN dans le texte : il a la table
      // des codes constructeur, inutile de la recopier ici.
      const r = await firstValueFrom(
        this.http.post<ExtractionVin>(`${this.api}/extraire`, { texte }),
      );

      if (r?.vin) {
        this.vin = r.vin;
        this.lectureConfiance = r.confiance;
        this.resultat = null;
        this.erreur = '';
      } else {
        this.erreurPhoto =
          'Aucun numéro de châssis reconnu. Cadrez la case du numéro de plus près, ' +
          'bien à plat et sans reflet, ou saisissez-le à la main.';
      }
    } catch (e: any) {
      this.erreurPhoto =
        e?.message === 'moteur introuvable'
          ? 'La lecture automatique n’a pas pu se charger. Vérifiez votre connexion, ' +
            'ou saisissez le numéro à la main.'
          : 'La lecture de la photo a échoué. Saisissez le numéro à la main.';
    } finally {
      // Le moteur occupe plusieurs mégaoctets de mémoire : sur un
      // téléphone modeste, ne pas le libérer finit par faire
      // fermer l'onglet par le système.
      try {
        await ouvrier?.terminate();
      } catch {
        /* rien à faire de plus */
      }
      this.lecturePhoto = false;
      this.etapePhoto = '';
      this.cdr.markForCheck();
    }
  }

  chercher(): void {
    const propre = this.vin.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    if (propre.length !== 17) {
      this.erreur =
        propre.length === 0
          ? 'Entrez le numéro de châssis de votre véhicule.'
          : `Il manque ${17 - propre.length} caractère${17 - propre.length > 1 ? 's' : ''} : un numéro de châssis en compte 17.`;
      if (propre.length > 17) {
        this.erreur = 'Un numéro de châssis compte exactement 17 caractères.';
      }
      this.resultat = null;
      return;
    }

    this.chargement = true;
    this.erreur = '';
    this.resultat = null;

    this.http.get<ReponseVin>(`${this.api}/${propre}`).subscribe({
      next: (reponse) => {
        this.resultat = reponse;
        this.anneeRetenue = reponse.annee ?? null;
        this.chargement = false;
        this.cdr.markForCheck();
      },
      error: (erreur) => {
        // Le serveur renvoie 400 avec un message lisible pour un VIN
        // mal formé : on l'affiche tel quel plutôt qu'un message générique.
        this.erreur =
          erreur?.error?.message ||
          (erreur?.status === 429
            ? 'Trop de recherches. Patientez une minute.'
            : 'Recherche indisponible. Choisissez votre véhicule dans les listes.');
        this.chargement = false;
        this.cdr.markForCheck();
      },
    });
  }

  choisirAnnee(annee: number): void {
    this.anneeRetenue = annee;
  }

  appliquer(): void {
    if (!this.resultat?.marque) return;
    this.vehiculeTrouve.emit({
      marque: this.resultat.marque,
      modele: this.resultat.modele ?? null,
      annee: this.anneeRetenue ?? this.resultat.annee ?? null,
    });
  }

  reinitialiser(): void {
    this.vin = '';
    this.resultat = null;
    this.erreur = '';
    this.anneeRetenue = null;
  }
}
