import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from './environnement';
import { SessionService, Utilisateur } from './session.service';

/**
 * Appels HTTP liés à l'authentification.
 *
 * La session elle-même (jeton, échéance, profil) est gérée par
 * SessionService, qui en est la seule source de vérité. Ce service
 * ne stocke plus rien dans le localStorage : deux systèmes en
 * parallèle finissaient toujours par diverger.
 */
@Injectable({
  providedIn: 'root',
})
export class ConnexionService {
  // ⚠️ Doit correspondre au montage dans server.js :
  //    app.use('/api/connexion', connexionRoutes);
  private apiUrl = `${environment.apiUrl}/connexion`;

  private session = inject(SessionService);

  constructor(private http: HttpClient) {}

  /**
   * Connexion par mot de passe.
   * Renvoie { token, expiration, user } ; c'est le composant qui
   * appelle ensuite session.connecter(res).
   */
  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(this.apiUrl, { email, password });
  }

  /** Connexion ou inscription via Google, avec le jeton d'identité */
  loginGoogle(credential: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/google`, { credential });
  }

  /**
   * Vérifie auprès du serveur que la session est toujours valable.
   * Utile au démarrage de l'application : le jeton peut avoir été
   * révoqué ou le compte supprimé depuis la dernière visite.
   */
  verifierSession(): Observable<{ user: Utilisateur }> {
    return this.http.get<{ user: Utilisateur }>(`${this.apiUrl}/moi`);
  }

  deconnexion(): void {
    this.session.deconnecter();
  }

  // ==========================================================
  //  COMPATIBILITÉ
  //  Ces deux méthodes délèguent à SessionService. Elles sont
  //  conservées le temps de migrer les composants qui les appellent.
  // ==========================================================

  /** @deprecated utiliser session.estConnecte() */
  isLoggedIn(): boolean {
    return this.session.estConnecte();
  }

  /** @deprecated utiliser session.utilisateur() */
  getCurrentUser(): Utilisateur | null {
    return this.session.utilisateur();
  }
}
