import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '../services/auth';
import { filter, switchMap, take, map } from 'rxjs';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  return auth.initialized$.pipe(
    filter(Boolean),
    take(1),
    switchMap(() => auth.currentUser$.pipe(take(1))),
    map((user) => {
      if (!user) {
        router.navigate(['/auth/login'], { queryParams: { redirect: state.url } });
        return false;
      }

      if (!user.role && user.availableRoles && user.availableRoles.length > 1) {
        router.navigate(['/auth/role-selection'], { queryParams: { redirect: state.url } });
        return false;
      }

      return true;
    })
  );
};
