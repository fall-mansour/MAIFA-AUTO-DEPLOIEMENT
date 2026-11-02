import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from './environnement';
import { SessionService, Utilisateur } from './session.service';

/** Conservée pour compatibilité : l'interface de référence est Utilisateur */
export type User = Utilisateur;

/**
 * Création et gestion du compte client.
 *
 * La connexion est assurée par ConnexionService, et la session
 * (jeton, échéance, profil) par SessionService. Ce service ne
 * stocke rien lui-même : deux systèmes en parallèle finissaient
 * toujours par diverger.
 */
@Injectable({
  providedIn: 'root',
})
export class CompteService {
  private apiUrl = `${environment.apiUrl}/compte`;

  private session = inject(SessionService);

  constructor(private http: HttpClient) {}

  /** Création d'un compte client */
  inscription(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/register`, data);
  }

  /**
   * Mise à jour du profil depuis l'espace client.
   * Le jeton est ajouté automatiquement par authInterceptor.
   */
  majProfil(data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/profil`, data);
  }

  /** Vérifie si une adresse est déjà utilisée, avant l'envoi du formulaire */
  emailDisponible(mail: string): Observable<{ disponible: boolean }> {
    return this.http.get<{ disponible: boolean }>(
      `${this.apiUrl}/email-disponible?mail=${encodeURIComponent(mail)}`,
    );
  }

  deconnexion(): void {
    this.session.deconnecter();
  }

  // ==========================================================
  //  COMPATIBILITÉ
  //  Méthodes conservées le temps de migrer les composants qui
  //  les appellent encore.
  // ==========================================================

  /** @deprecated utiliser session.utilisateur() */
  getCurrentUser(): Utilisateur | null {
    return this.session.utilisateur();
  }

  /** @deprecated utiliser session.jeton */
  getToken(): string | null {
    return this.session.jeton;
  }

  /** @deprecated utiliser deconnexion() */
  logout(): void {
    this.session.deconnecter();
  }
}
