import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';

/** Hiérarchie : client < gestionnaire < responsable */
export type Role = 'client' | 'gestionnaire' | 'responsable';

export interface Utilisateur {
  id: number;
  nom: string;
  prenom: string;
  mail: string;
  role: Role;
  telephone?: string;
  adresse?: string;
  vehicule?: string;
  avatar?: string;
}

interface SessionStockee {
  token: string;
  expiration: number; // millisecondes
  user: Utilisateur;
}

/**
 * Pages qui exigent une session de gestion. Une session qui expire
 * sur l'une d'elles renvoie vers la connexion ; ailleurs, on laisse
 * l'utilisateur où il est.
 */
const PAGES_PROTEGEES = ['/Dashboard', '/stock', '/ajoutpieces', '/commandes', '/import', '/suivi'];

/**
 * Session authentifiée par jeton signé côté serveur.
 *
 * Le jeton porte sa propre date d'expiration, vérifiée par le serveur
 * à chaque requête. Ce service en tient une copie pour deux usages :
 * afficher l'état de connexion, et déconnecter automatiquement à échéance
 * plutôt que de laisser l'utilisateur découvrir le problème sur une erreur.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly CLE = 'teranga_session';

  /** Avertissement affiché ce nombre de minutes avant l'échéance */
  private readonly ALERTE_MINUTES = 5;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  private _session = signal<SessionStockee | null>(null);
  private _bientotExpiree = signal(false);
  private minuteur?: any;
  private minuteurAlerte?: any;

  readonly utilisateur = computed(() => this._session()?.user ?? null);
  readonly estConnecte = computed(() => this._session() !== null);
  readonly prenom = computed(() => this._session()?.user.prenom ?? '');
  readonly bientotExpiree = this._bientotExpiree.asReadonly();

  readonly role = computed<Role | null>(() => this._session()?.user.role ?? null);

  /**
   * Accès à l'espace de gestion.
   *
   * Un responsable EST un gestionnaire : il voit le stock, les
   * commandes et l'import comme les autres. Comparer strictement à
   * 'gestionnaire' l'aurait exclu de son propre espace de gestion
   * dès son passage au nouveau rôle.
   */
  readonly estGestionnaire = computed(() => {
    const r = this._session()?.user.role;
    return r === 'gestionnaire' || r === 'responsable';
  });

  /** Accès au suivi des gestionnaires. Strict, lui. */
  readonly estResponsable = computed(() => this._session()?.user.role === 'responsable');

  /** Minutes restantes avant expiration, pour l'affichage */
  readonly minutesRestantes = computed(() => {
    const exp = this._session()?.expiration;
    if (!exp) return 0;
    return Math.max(0, Math.round((exp - Date.now()) / 60000));
  });

  constructor() {
    this.restaurer();
  }

  private get navigateur(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  // ==========================================================
  //  CONNEXION / DÉCONNEXION
  // ==========================================================

  /** Appelé après une réponse de /api/connexion */
  connecter(reponse: { token: string; expiration: number; user: Utilisateur }): void {
    const session: SessionStockee = {
      token: reponse.token,
      // Repli à 2h si le serveur n'a pas renvoyé l'échéance
      expiration: reponse.expiration || Date.now() + 2 * 60 * 60 * 1000,
      user: reponse.user,
    };

    this._session.set(session);
    this._bientotExpiree.set(false);

    if (this.navigateur) {
      try {
        localStorage.setItem(this.CLE, JSON.stringify(session));
      } catch (e) {
        console.warn('Session non conservée :', e);
      }
      this.programmerExpiration(session.expiration);
    }
  }

  /**
   * Met à jour le profil en session, sans toucher au jeton ni à son
   * échéance. Appelée après modification depuis la page profil :
   * l'en-tête du site affiche alors le nouveau nom immédiatement,
   * sans attendre une reconnexion.
   *
   * Le rôle en est volontairement exclu : il est porté par le jeton
   * signé, et le modifier ici donnerait des droits que le serveur
   * refuserait de toute façon, en laissant croire le contraire.
   */
  majUtilisateur(partiel: Partial<Omit<Utilisateur, 'role' | 'id'>>): void {
    const session = this._session();
    if (!session) return;

    const fusion: SessionStockee = {
      ...session,
      user: { ...session.user, ...partiel },
    };

    this._session.set(fusion);

    if (this.navigateur) {
      try {
        localStorage.setItem(this.CLE, JSON.stringify(fusion));
      } catch (e) {
        // Stockage indisponible : la session en mémoire reste à jour
        console.warn('Session non conservée :', e);
      }
    }
  }

  /**
   * Prolonge la session d'un client actif.
   *
   * Le serveur renvoie un jeton frais dans l'en-tête X-Nouveau-Jeton
   * dès que la moitié du quart d'heure est écoulée. L'intercepteur
   * le repère et appelle cette méthode : l'utilisateur ne voit rien,
   * sa session ne tombe que s'il cesse réellement d'agir.
   *
   * Les jetons de gestion ne sont jamais prolongés par le serveur :
   * leurs deux heures sont fermes.
   */
  prolonger(token: string, expiration: number): void {
    const session = this._session();
    if (!session || !token || !expiration) return;

    // Un en-tête rejoué ne doit pas raccourcir une session déjà
    // prolongée par une requête plus récente.
    if (expiration <= session.expiration) return;

    const fusion: SessionStockee = { ...session, token, expiration };

    this._session.set(fusion);
    this._bientotExpiree.set(false);

    if (this.navigateur) {
      try {
        localStorage.setItem(this.CLE, JSON.stringify(fusion));
      } catch {
        // Stockage indisponible : la session en mémoire reste à jour
      }
      this.programmerExpiration(expiration);
    }
  }

  /** @param expiree true si la déconnexion vient de l'échéance du jeton */
  deconnecter(expiree = false): void {
    this._session.set(null);
    this._bientotExpiree.set(false);
    this.annulerMinuteurs();

    if (this.navigateur) {
      localStorage.removeItem(this.CLE);

      if (expiree) {
        // On ne redirige que si la page en cours nécessitait une session
        const protegee = PAGES_PROTEGEES.some((p) => this.router.url.startsWith(p));
        if (protegee) this.router.navigate(['/login'], { queryParams: { expiree: 1 } });
      }
    }
  }

  /** Jeton pour l'en-tête Authorization, null si absent ou périmé */
  get jeton(): string | null {
    const s = this._session();
    if (!s) return null;

    if (s.expiration <= Date.now()) {
      this.deconnecter(true);
      return null;
    }
    return s.token;
  }

  // ==========================================================
  //  EXPIRATION
  // ==========================================================

  /** Deux minuteurs : un avertissement, puis la déconnexion */
  private programmerExpiration(expiration: number): void {
    this.annulerMinuteurs();

    const restant = expiration - Date.now();
    if (restant <= 0) return this.deconnecter(true);

    const avant = restant - this.ALERTE_MINUTES * 60 * 1000;
    if (avant > 0) {
      this.minuteurAlerte = setTimeout(() => this._bientotExpiree.set(true), avant);
    } else {
      this._bientotExpiree.set(true);
    }

    this.minuteur = setTimeout(() => this.deconnecter(true), restant);
  }

  private annulerMinuteurs(): void {
    if (this.minuteur) clearTimeout(this.minuteur);
    if (this.minuteurAlerte) clearTimeout(this.minuteurAlerte);
    this.minuteur = undefined;
    this.minuteurAlerte = undefined;
  }

  /** Relit la session au démarrage. Sans effet côté serveur (SSR). */
  private restaurer(): void {
    if (!this.navigateur) return;

    try {
      const brut = localStorage.getItem(this.CLE);
      if (!brut) return;

      const session: SessionStockee = JSON.parse(brut);

      // Jeton déjà périmé : on nettoie sans rediriger
      if (!session.token || session.expiration <= Date.now()) {
        localStorage.removeItem(this.CLE);
        return;
      }

      this._session.set(session);
      this.programmerExpiration(session.expiration);
    } catch {
      localStorage.removeItem(this.CLE);
    }
  }
}
