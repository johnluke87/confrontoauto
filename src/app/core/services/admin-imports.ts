import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportDetail, ImportList, ImportStatus, ResearchStatus } from '../../models/imports';
import { API_BASE_URL } from '../api';

/** Revisione dei dati arrivati dal Research agent (solo amministratori). */
@Injectable({
  providedIn: 'root',
})
export class AdminImports {
  private http = inject(HttpClient);
  private api = inject(API_BASE_URL);

  /** A che punto è il Research agent. */
  researchStatus(): Observable<ResearchStatus> {
    return this.http.get<ResearchStatus>(`${this.api}/admin/research-status`);
  }

  /** Libera tutti i lavori prenotati (dopo un'esecuzione interrotta). */
  unlock(): Observable<ResearchStatus & { released: number }> {
    return this.http.post<ResearchStatus & { released: number }>(`${this.api}/admin/research-unlock`, {});
  }

  /** Rimette subito in coda marchi e modelli falliti che aspettano un nuovo tentativo. */
  retry(): Observable<ResearchStatus & { requeued: number }> {
    return this.http.post<ResearchStatus & { requeued: number }>(`${this.api}/admin/research-retry`, {});
  }

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
