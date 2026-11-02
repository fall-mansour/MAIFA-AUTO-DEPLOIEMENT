import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { SessionService } from './session.service';

/**
 * Protège les pages de gestion.
 *
 * ⚠️ Un garde côté navigateur ne fait que masquer l'interface : la vraie
 * protection est le middleware exigerRole() côté serveur, qui refuse
 * les données à qui n'a pas le rôle. Les deux sont nécessaires.
 */
export const gestionnaireGuard: CanActivateFn = (route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.estGestionnaire()) return true;

  router.navigate(['/login'], { queryParams: { retour: state.url } });
  return false;
};
