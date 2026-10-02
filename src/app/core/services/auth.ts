import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, Observable, of, tap } from 'rxjs';
import { API_BASE_URL } from '../api';

export interface AuthUser {
  username: string;
  // gli amministratori configurano i marchi e (tappa 2) rivedono i dati importati
  isAdmin: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private http = inject(HttpClient);
  private api = inject(API_BASE_URL);

  // undefined = non ho ancora chiesto al server; null = non collegato; oggetto = collegato
  private readonly currentUser = signal<AuthUser | null | undefined>(undefined);
  readonly user = this.currentUser.asReadonly();
  readonly isLoggedIn = computed(() => !!this.currentUser());
  readonly isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  /** Sono collegato? La prima volta lo chiede al server, poi usa quello che sa già. */
  check(): Observable<boolean> {
    if (this.currentUser() !== undefined) {
      return of(this.isLoggedIn());
    }
    return this.http.get<{ user: AuthUser }>(`${this.api}/auth/me`).pipe(
      tap((res) => this.currentUser.set(res.user)),
      map(() => true),
      catchError(() => {
        this.currentUser.set(null);
        return of(false);
      }),
    );
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.http
      .post<{ user: AuthUser }>(`${this.api}/auth/login`, { username, password })
      .pipe(
        map((res) => res.user),
        tap((user) => this.currentUser.set(user)),
      );
  }

  /** Crea un account nuovo: il server fa anche il login (imposta il cookie), quindi sei subito dentro. */
  register(username: string, password: string): Observable<AuthUser> {
    return this.http
      .post<{ user: AuthUser }>(`${this.api}/auth/register`, { username, password })
      .pipe(
        map((res) => res.user),
        tap((user) => this.currentUser.set(user)),
      );
  }

  logout(): Observable<unknown> {
    // finalize: anche se il server non risponde, per l'app non sei più collegato
    return this.http.post(`${this.api}/auth/logout`, {}).pipe(finalize(() => this.currentUser.set(null)));
  }

  /** Lo chiama l'interceptor quando il server risponde 401: la sessione è scaduta. */
  sessionExpired(): void {
    this.currentUser.set(null);
  }
}
