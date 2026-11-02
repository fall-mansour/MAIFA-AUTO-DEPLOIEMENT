import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * Boutons d'action flottants : WhatsApp et demande de piece.
 *
 * Reutilisable sur toutes les pages client. Le message WhatsApp est
 * pre-rempli pour lever la barriere du premier contact :
 *
 *   <app-boutons-flottants></app-boutons-flottants>
 *
 *   <app-boutons-flottants
 *     [message]="'Bonjour, je suis interesse par ' + piece.description"
 *   ></app-boutons-flottants>
 */
@Component({
  selector: 'app-boutons-flottants',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="flottants">
      <!-- Demande de piece : action secondaire, donc au-dessus et plus petite -->
      <a class="fab fab--form" routerLink="/demande" aria-label="Demander une pièce introuvable">
        <span class="fab__libelle">Demander une pièce</span>
        <span class="fab__rond">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M15 3v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
        </span>
      </a>

      <!-- WhatsApp : action principale -->
      <a
        class="fab fab--wa"
        [href]="lienWhatsApp"
        target="_blank"
        rel="noopener"
        aria-label="Nous écrire sur WhatsApp"
      >
        <span class="fab__libelle">Écrivez-nous sur WhatsApp</span>
        <span class="fab__rond">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
            <path
              d="M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1s-.8 1-1 1.2c-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.4.5-.6.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 1.5 2.4 3.7 3.4.5.2.9.4 1.2.5.7.2 1.3.2 1.8.1.5-.1 1.6-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.2-.2-.3-.4-.4z"
            />
            <path
              d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .9.9-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"
            />
          </svg>
        </span>
      </a>
    </div>
  `,
  styles: [
    `
      .flottants {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 900;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
      }

      .fab {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        animation: fabEntree 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      .fab--form {
        animation-delay: 0.15s;
      }

      /* Libelle masque par defaut, revele au survol sur grand ecran */
      .fab__libelle {
        max-width: 0;
        padding: 0;
        overflow: hidden;
        white-space: nowrap;
        border-radius: 9999px;
        background: white;
        color: #10275f;
        font-family: inherit;
        font-size: 0.86rem;
        font-weight: 600;
        line-height: 38px;
        opacity: 0;
        box-shadow: 0 4px 16px rgba(16, 39, 95, 0.16);
        transition:
          max-width 0.32s cubic-bezier(0.4, 0, 0.2, 1),
          opacity 0.22s ease,
          padding 0.32s ease;
      }

      .fab__rond {
        position: relative;
        display: grid;
        place-items: center;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        color: white;
        flex-shrink: 0;
        transition:
          transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
          box-shadow 0.22s ease;
      }

      .fab__rond svg {
        width: 26px;
        height: 26px;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* WhatsApp : couleur de la marque, taille pleine */
      .fab--wa .fab__rond {
        background: #25d366;
        box-shadow: 0 6px 20px rgba(37, 211, 102, 0.42);
      }

      /* Demande : action secondaire, legerement plus petite */
      .fab--form .fab__rond {
        width: 46px;
        height: 46px;
        background: linear-gradient(135deg, #1e3a8a, #1a56db);
        box-shadow: 0 5px 16px rgba(26, 86, 219, 0.36);
      }

      .fab--form .fab__rond svg {
        width: 21px;
        height: 21px;
        fill: none;
        stroke: currentColor;
      }

      .fab--form .fab__libelle {
        line-height: 34px;
        font-size: 0.83rem;
      }

      /* Survol : le libelle se deplie */
      .fab:hover .fab__libelle,
      .fab:focus-visible .fab__libelle {
        max-width: 240px;
        padding: 0 18px;
        opacity: 1;
      }

      .fab:hover .fab__rond {
        transform: scale(1.08);
      }

      .fab--wa:hover .fab__rond {
        box-shadow: 0 10px 28px rgba(37, 211, 102, 0.55);
      }

      .fab:active .fab__rond {
        transform: scale(0.95);
      }

      /* Pulsation discrete sur WhatsApp, pour attirer l'oeil sans agacer */
      .fab--wa .fab__rond::after {
        content: '';
        position: absolute;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        border: 2px solid #25d366;
        animation: fabPulse 2.6s ease-out infinite;
        pointer-events: none;
      }

      @keyframes fabPulse {
        0% {
          transform: scale(1);
          opacity: 0.6;
        }
        70%,
        100% {
          transform: scale(1.55);
          opacity: 0;
        }
      }

      @keyframes fabEntree {
        from {
          opacity: 0;
          transform: translateY(20px) scale(0.85);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      :host-context(.no-motion) .fab,
      :host-context(.no-motion) .fab__rond::after {
        animation: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .fab,
        .fab--wa .fab__rond::after {
          animation: none;
        }

        .fab__libelle,
        .fab__rond {
          transition-duration: 0.01ms;
        }
      }

      /* Mobile : icones seules, un peu plus compactes */
      @media (max-width: 767px) {
        .flottants {
          right: 14px;
          bottom: 14px;
          gap: 10px;
        }

        .fab__libelle {
          display: none;
        }

        .fab__rond {
          width: 50px;
          height: 50px;
        }

        .fab--wa .fab__rond::after {
          width: 50px;
          height: 50px;
        }

        .fab--form .fab__rond {
          width: 42px;
          height: 42px;
        }
      }
    `,
  ],
})
export class BoutonsFlottants {
  /** Numero professionnel, au format international sans espaces */
  private readonly NUMERO = '221781970151';

  /** Message pre-rempli. Surchargeable depuis la page appelante. */
  @Input() message = 'Bonjour Teranga Motors, je recherche une pièce pour mon véhicule.';

  /**
   * wa.me fonctionne aussi bien avec l'application installee
   * qu'avec WhatsApp Web, sans detection de plateforme.
   */
  get lienWhatsApp(): string {
    return `https://wa.me/${this.NUMERO}?text=${encodeURIComponent(this.message)}`;
  }
}
