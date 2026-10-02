import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from './api';
import { Auth } from './services/auth';
/**
Cos'è un interceptor: una funzione da cui passa ogni richiesta HTTP dell'app, sia all'andata sia al ritorno. Qui lo usiamo al ritorno: se il server dice 401, cioè "non ti conosco più", ti riporta al login, senza dover gestire il caso in ogni singolo componente.
Due eccezioni:
per /auth/me il 401 è normale (lo gestisce già check());
per /auth/login un 401 significa "password sbagliata", e il messaggio lo mostrerà la pagina di login.
**/
/** Se l'API risponde 401 (sessione scaduta o revocata), torna alla pagina di login. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(API_BASE_URL);
  // Eventuali chiamate ad altri siti non ci riguardano.
  if (!req.url.startsWith(api)) {
    return next(req);
  }

  // inject() va chiamato qui, non dentro catchError (lì non saremmo più nel "contesto di injection").
  const auth = inject(Auth);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const isAuthCall = req.url.endsWith('/auth/me') || req.url.endsWith('/auth/login');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthCall) {
        auth.sessionExpired();
        router.navigateByUrl('/login');
      }
      return throwError(() => error); // l'errore continua comunque verso chi ha fatto la richiesta
    }),
  );
};