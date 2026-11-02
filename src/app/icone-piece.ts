import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Pictogrammes dessines au trait pour les familles de pieces.
 *
 * SVG en ligne plutot que des emojis ou des images : le rendu reste
 * net a toute taille, prend la couleur du texte parent, et n'ajoute
 * aucun fichier a telecharger.
 *
 * Usage : <app-icone-piece [slug]="cat.slug"></app-icone-piece>
 */
@Component({
  selector: 'app-icone-piece',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      [ngSwitch]="slug"
    >
      <!-- MOTORISATION : bloc moteur avec piston -->
      <g *ngSwitchCase="'moteur'">
        <path d="M10 22h6V14h8v8h5l6 5v11H10z" />
        <path d="M16 14v-4h8v4" />
        <path d="M20 22v-8" />
        <path d="M35 27h4v7h-4" />
        <path d="M14 38v-6h6v6" />
      </g>

      <!-- FREINAGE : disque ventile et etrier -->
      <g *ngSwitchCase="'freinage'">
        <circle cx="22" cy="24" r="14" />
        <circle cx="22" cy="24" r="5" />
        <path d="M22 10v4M22 34v4M8 24h4M32 24h4" />
        <path d="M36 17h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4z" />
      </g>

      <!-- SUSPENSION : amortisseur a ressort -->
      <g *ngSwitchCase="'suspension'">
        <path d="M24 6v6" />
        <circle cx="24" cy="8" r="3" />
        <path d="M18 14h12v5H18z" />
        <path d="M18 21h12M18 25h12M18 29h12M18 33h12" />
        <path d="M21 36h6v5h-6z" />
        <path d="M24 41v2" />
      </g>

      <!-- TRANSMISSION : engrenages -->
      <g *ngSwitchCase="'transmission'">
        <circle cx="19" cy="20" r="8" />
        <circle cx="19" cy="20" r="3" />
        <path d="M19 8v4M19 28v4M7 20h4M27 20h4M11 12l3 3M27 28l-3-3" />
        <circle cx="33" cy="33" r="6" />
        <circle cx="33" cy="33" r="2" />
        <path d="M33 25v2M33 39v2M25 33h2M39 33h2" />
      </g>

      <!-- DIRECTION : volant et biellette -->
      <g *ngSwitchCase="'direction'">
        <circle cx="20" cy="20" r="12" />
        <circle cx="20" cy="20" r="3" />
        <path d="M20 8v9M9 26l8-4M31 26l-8-4" />
        <path d="M29 30l8 8" />
        <circle cx="39" cy="40" r="3" />
      </g>

      <!-- ELECTRICITE : batterie -->
      <g *ngSwitchCase="'electronique'">
        <path d="M8 18h32v20H8z" />
        <path d="M14 18v-4h6v4M28 18v-4h6v4" />
        <path d="M16 28h6M19 25v6" />
        <path d="M28 28h6" />
        <path d="M8 33h32" />
      </g>

      <!-- ECLAIRAGE : phare avec faisceau -->
      <g *ngSwitchCase="'eclairage'">
        <path d="M8 16c8-4 14-4 18 0s4 12 0 16-10 4-18 0z" />
        <circle cx="17" cy="24" r="5" />
        <path d="M32 18h8M32 24h10M32 30h8" />
      </g>

      <!-- CARROSSERIE : aile et portiere -->
      <g *ngSwitchCase="'carrosserie'">
        <path d="M6 30l4-10c1-2 3-3 5-3h14c3 0 5 2 7 4l6 6v6H6z" />
        <circle cx="15" cy="33" r="4" />
        <circle cx="33" cy="33" r="4" />
        <path d="M22 17v10" />
        <path d="M26 22h4" />
      </g>

      <!-- PEINTURE : bombe aerosol -->
      <g *ngSwitchCase="'entretien'">
        <path d="M18 16h12v26H18z" />
        <path d="M20 16v-4h8v4" />
        <path d="M22 12V8h4v4" />
        <path d="M18 24h12" />
        <path d="M34 10c1 1 1 3 0 4M38 8c2 2 2 6 0 8" />
      </g>

      <!-- FILTRATION : filtre a huile -->
      <g *ngSwitchCase="'filtration'">
        <path d="M14 14h20v26a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z" />
        <path d="M16 14V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5" />
        <path d="M14 21h20M14 28h20M14 35h20" />
        <path d="M21 7V5h6v2" />
      </g>

      <!-- REFROIDISSEMENT : radiateur -->
      <g *ngSwitchCase="'refroidissement'">
        <path d="M8 12h32v24H8z" />
        <path d="M14 12v24M20 12v24M26 12v24M32 12v24" />
        <path d="M8 20h32M8 28h32" />
        <path d="M20 8h8v4" />
      </g>

      <!-- ECHAPPEMENT : silencieux et sortie -->
      <g *ngSwitchCase="'echappement'">
        <path d="M6 24h8l4-6h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H18l-4-6H6z" />
        <circle cx="38" cy="26" r="4" />
        <path d="M22 18v12M28 18v12" />
      </g>

      <!-- PNEUMATIQUE : pneu avec sculpture -->
      <g *ngSwitchCase="'pneumatique'">
        <circle cx="24" cy="24" r="16" />
        <circle cx="24" cy="24" r="7" />
        <path d="M24 8v9M24 31v9M8 24h9M31 24h9" />
        <path d="M13 13l6 6M35 35l-6-6M35 13l-6 6M13 35l6-6" />
      </g>

      <!-- HABITACLE : siege -->
      <g *ngSwitchCase="'habitacle'">
        <path d="M14 10h12a4 4 0 0 1 4 4v14H14z" />
        <path d="M10 28h26a3 3 0 0 1 3 3v5H10z" />
        <path d="M14 36v6M35 36v6" />
        <path d="M18 16h8" />
      </g>

      <!-- CLIMATISATION : flocon et ventilateur -->
      <g *ngSwitchCase="'climatisation'">
        <path d="M18 6v24M8 12l20 12M28 12L8 24" />
        <circle cx="32" cy="32" r="9" />
        <path d="M32 23v9l7 4" />
        <path d="M18 30v4" />
      </g>

      <!-- EMBRAYAGE : disque d'embrayage -->
      <g *ngSwitchCase="'embrayage'">
        <circle cx="24" cy="24" r="15" />
        <circle cx="24" cy="24" r="6" />
        <circle cx="24" cy="24" r="2" />
        <path d="M24 9v6M24 33v6M9 24h6M33 24h6" />
        <path d="M13 13l4 4M35 35l-4-4M35 13l-4 4M13 35l4-4" />
      </g>

      <!-- OUTILLAGE : cle et tournevis -->
      <g *ngSwitchCase="'outillage'">
        <path d="M14 8a6 6 0 0 0-4 10l-4 4 6 6 4-4a6 6 0 0 0 10-4" />
        <path d="M30 40l8-8" />
        <path d="M34 12l6 6-4 4-6-6z" />
        <path d="M30 16L14 32l-4 4 4 4 4-4 16-16" />
      </g>

      <!-- Par defaut : boulon -->
      <g *ngSwitchDefault>
        <path d="M24 8l12 7v14l-12 7-12-7V15z" />
        <circle cx="24" cy="22" r="6" />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
})
export class IconePiece {
  /** Slug de la famille : moteur, freinage, suspension... */
  @Input() slug = '';
}
