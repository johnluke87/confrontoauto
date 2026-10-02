import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportDetail, ImportList, ImportStatus } from '../../models/imports';
import { API_BASE_URL } from '../api';

/** Revisione dei dati arrivati dal Research agent (solo amministratori). */
@Injectable({
  providedIn: 'root',
})
export class AdminImports {
  private http = inject(HttpClient);
  private api = inject(API_BASE_URL);

  list(status: ImportStatus): Observable<ImportList> {
    return this.http.get<ImportList>(`${this.api}/admin/imports`, { params: { status } });
  }

  get(id: number): Observable<ImportDetail> {
    return this.http.get<ImportDetail>(`${this.api}/admin/imports/${id}`);
  }

  approve(id: number): Observable<ImportDetail> {
    return this.http.post<ImportDetail>(`${this.api}/admin/imports/${id}/approve`, {});
  }

  reject(id: number): Observable<ImportDetail> {
    return this.http.post<ImportDetail>(`${this.api}/admin/imports/${id}/reject`, {});
  }
}
