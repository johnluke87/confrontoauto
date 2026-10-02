import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ModelDetail, ModelSummary } from '../../models/car';
import { Brand, Parameter, Region } from '../../models/catalog';
import { API_BASE_URL } from '../api';

/** Dati di riferimento: marchi, regioni con il bollo, parametri dei calcoli. */
@Injectable({
  providedIn: 'root',
})
export class Catalog {
  private http = inject(HttpClient);
  private api = inject(API_BASE_URL);

  brands(): Observable<Brand[]> {
    return this.http.get<Brand[]>(`${this.api}/brands`);
  }

  /** Solo amministratori: attiva/disattiva più marchi in una volta. Risponde con la lista aggiornata. */
  setBrandsEnabled(ids: number[], enabled: boolean): Observable<Brand[]> {
    return this.http.patch<Brand[]>(`${this.api}/admin/brands`, { ids, enabled });
  }

  regions(): Observable<Region[]> {
    return this.http.get<Region[]>(`${this.api}/regions`);
  }

  parameters(): Observable<Parameter[]> {
    return this.http.get<Parameter[]>(`${this.api}/parameters`);
  }

  models(brandId: number): Observable<ModelSummary[]> {
    return this.http.get<ModelSummary[]>(`${this.api}/models`, { params: { brandId } });
  }

  model(id: number): Observable<ModelDetail> {
    return this.http.get<ModelDetail>(`${this.api}/models/${id}`);
  }
}
