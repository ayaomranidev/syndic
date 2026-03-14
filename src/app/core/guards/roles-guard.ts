import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { filter, switchMap, take, map } from 'rxjs';
import { Auth } from '../services/auth';
import { UserRole, isGlobalAdmin, isAdminForResidence } from '../../models/user.model';

/**
 * rolesGuard — WARN-3 FIX
 * =======================
 * Guard précédemment vide (return true). Désormais :
 *  1. Attend l'initialisation de l'auth (initialized$).
 *  2. Lit l'utilisateur courant.
 *  3. Vérifie que l'utilisateur possède AU MOINS UN des rôles déclarés
 *     dans `data['roles']` sur la route.
 *  4. Pour ADMIN_RESIDENCE, vérifie en plus que la résidence demandée
 *     correspond à celle de l'utilisateur (si `data['residenceId']` est fourni).
 *
 * Usage dans app-routing.module.ts :
 *
 *   { path: 'admin', component: AdminComponent,
 *     canActivate: [authGuard, rolesGuard],
 *     data: { roles: ['ADMIN', 'ADMIN_RESIDENCE'] } }
 *
 *   { path: 'charges', component: ChargesComponent,
 *     canActivate: [authGuard, rolesGuard],
 *     data: { roles: ['ADMIN', 'ADMIN_RESIDENCE', 'TRESORIER'] } }
 */
export const rolesGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state) => {
  const auth   = inject(Auth);
  const router = inject(Router);

  // Rôles autorisés déclarés sur la route (ex: data: { roles: ['ADMIN_RESIDENCE'] })
  const allowedRoles: UserRole[] = route.data?.['roles'] ?? [];

  // Si aucun rôle n'est requis, laisser passer
  if (allowedRoles.length === 0) return true;

  return auth.initialized$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => auth.currentUser$.pipe(take(1))),
    map(user => {
      if (!user) {
        router.navigate(['/auth/login'], { queryParams: { redirect: state.url } });
        return false;
      }

      const userRoles: UserRole[] = user.roles || (user.role ? [user.role] : []);

      // ADMIN global a toujours accès
      if (isGlobalAdmin(user)) return true;

      // Vérifier si l'utilisateur possède au moins un rôle autorisé
      const hasRole = allowedRoles.some(r => userRoles.includes(r));
      if (!hasRole) {
        console.warn(`[rolesGuard] Accès refusé à "${state.url}" pour les rôles [${userRoles}]`);
        router.navigate(['/unauthorized']);
        return false;
      }

      // Pour ADMIN_RESIDENCE : vérifier la résidence si précisée sur la route
      if (
        userRoles.includes('ADMIN_RESIDENCE') &&
        !isGlobalAdmin(user) &&
        route.data?.['residenceId']
      ) {
        const routeResidenceId = route.data['residenceId'] as string;
        if (!isAdminForResidence(user, routeResidenceId)) {
          console.warn(
            `[rolesGuard] ADMIN_RESIDENCE ${user.id} n'a pas accès à la résidence ${routeResidenceId}`,
          );
          router.navigate(['/unauthorized']);
          return false;
        }
      }

      return true;
    }),
  );
};