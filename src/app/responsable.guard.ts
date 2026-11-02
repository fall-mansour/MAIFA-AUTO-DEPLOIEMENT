import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Réserve une route au responsable.
 *
 * Ce garde n'est qu'un confort d'interface : il évite d'afficher
 * une page qui renverrait des 403. La vraie protection est côté
 * serveur, dans exigerRole('responsable'), et elle ne doit jamais
 * en dépendre : un garde Angular se contourne en changeant une
 * valeur dans le navigateur.
 */
export const responsableGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.estResponsable()) return true;

  // Un gestionnaire connecté est renvoyé vers son tableau de bord,
  // pas vers la page de connexion : il est bien authentifié, c'est
  // seulement cette page qui ne le concerne pas.
  if (session.estConnecte()) {
    return router.createUrlTree(['/Dashboard']);
  }

  return router.createUrlTree(['/login']);
};
