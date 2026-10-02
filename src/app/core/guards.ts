import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { Auth } from './services/auth';

/** Pagine riservate: se non sei collegato, vai al login. */
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(Auth)
    .check()
    .pipe(map((loggedIn) => loggedIn || router.createUrlTree(['/login'])));
};

/** Pagine di amministrazione: il server ricontrolla comunque (403), qui evitiamo solo di mostrarle. */
export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(Auth);
  return auth.check().pipe(map(() => auth.isAdmin() || router.createUrlTree(['/'])));
};

/** Pagina di login: se sei già collegato, non ha senso mostrartela. */
export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(Auth)
    .check()
    .pipe(map((loggedIn) => (loggedIn ? router.createUrlTree(['/']) : true)));
};
