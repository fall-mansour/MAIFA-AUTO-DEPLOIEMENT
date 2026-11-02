import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { environment } from './environnement';

/**
 * Ajoute le jeton aux requêtes vers notre API, prolonge la session
 * des clients actifs, et gère les 401.
 *
 * À enregistrer dans app.config.ts :
 *   provideHttpClient(withFetch(), withInterceptors([authInterceptor]))
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);

  // On n'envoie le jeton qu'à notre propre API, jamais à Cloudinary ou ailleurs
  const versNotreApi = req.url.startsWith(environment.apiUrl);
  const jeton = versNotreApi ? session.jeton : null;

  const requete = jeton ? req.clone({ setHeaders: { Authorization: `Bearer ${jeton}` } }) : req;

  return next(requete).pipe(
    tap((evenement) => {
      if (!versNotreApi || !(evenement instanceof HttpResponse)) return;

      // Session client prolongée par le serveur.
      //
      // Le jeton d'un client ne vaut qu'un quart d'heure, mais le
      // serveur en glisse un frais dans la réponse dès que la moitié
      // du temps est écoulée. Le récupérer ici fait que la session
      // ne tombe que sur une vraie inactivité, pas en pleine
      // navigation. Les jetons de gestion ne sont jamais prolongés,
      // l'en-tête est simplement absent de leurs réponses.
      const nouveau = evenement.headers.get('X-Nouveau-Jeton');
      const echeance = Number(evenement.headers.get('X-Nouvelle-Expiration'));

      if (nouveau && Number.isFinite(echeance) && echeance > 0) {
        session.prolonger(nouveau, echeance);
      }
    }),

    catchError((err: HttpErrorResponse) => {
      // Jeton expiré ou invalide : on ferme proprement la session
      if (err.status === 401 && versNotreApi) {
        const code = err.error?.code;
        if (code === 'JETON_EXPIRE' || code === 'JETON_INVALIDE') {
          session.deconnecter(true);
        }
      }
      return throwError(() => err);
    }),
  );
};
