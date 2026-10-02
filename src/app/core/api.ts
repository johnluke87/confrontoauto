import { InjectionToken } from '@angular/core';

// Percorso dell'API: relativo, quindi vale sia in sviluppo (passa dal proxy) sia in produzione (stesso sito).
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/extra/confronto-auto/api',
});