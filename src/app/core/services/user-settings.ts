import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { UserSettings } from '../../models/catalog';
import { API_BASE_URL } from '../api';

@Injectable({
  providedIn: 'root',
})
export class UserSettingsService {
  private http = inject(HttpClient);
  private api = inject(API_BASE_URL);

  get(): Observable<UserSettings> {
    return this.http.get<UserSettings>(`${this.api}/settings`);
  }

  update(changes: Partial<UserSettings>): Observable<UserSettings> {
    return this.http.patch<UserSettings>(`${this.api}/settings`, changes);
  }
}
