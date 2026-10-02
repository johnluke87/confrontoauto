import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Auth } from '../../core/services/auth';
import { Catalog } from '../../core/services/catalog';
import { UserSettingsService } from '../../core/services/user-settings';
import { Confidence, FuelGroup, Parameter } from '../../models/catalog';
import { ConfidenceBadge } from '../../shared/confidence-badge/confidence-badge';

const FUEL_GROUP_LABELS: Record<FuelGroup, string> = {
  thermal: 'Benzina / diesel',
  lpg_cng: 'GPL / metano',
  hybrid: 'Ibride',
  plugin_hybrid: 'Ibride plug-in',
  electric: 'Elettriche',
};

@Component({
  selector: 'app-settings-page',
  imports: [DecimalPipe, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ConfidenceBadge],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected auth = inject(Auth);
  private catalog = inject(Catalog);
  private settingsApi = inject(UserSettingsService);

  protected fuelGroupLabels = FUEL_GROUP_LABELS;

  protected settings = rxResource({ stream: () => this.settingsApi.get() });
  protected regions = rxResource({ stream: () => this.catalog.regions() });
  protected parameters = rxResource({ stream: () => this.catalog.parameters() });

  // parte dal valore salvato sul server, ma l'utente lo può cambiare subito (prima che il salvataggio finisca)
  protected regionCode = linkedSignal(() => (this.settings.hasValue() ? this.settings.value().regionCode : 'VEN'));
  protected saving = signal(false);
  protected saveError = signal<string | null>(null);

  protected region = computed(() => {
    const regions = this.regions.hasValue() ? this.regions.value() : [];
    return regions.find((r) => r.code === this.regionCode()) ?? null;
  });

  // ---- modifica dei parametri (solo amministratori) ----
  protected readonly confidenceOptions: { value: Confidence; label: string }[] = [
    { value: 'official', label: 'Ufficiale' },
    { value: 'verified', label: 'Verificato' },
    { value: 'estimate', label: 'Stima' },
  ];
  protected editing = signal<string | null>(null);
  protected draftValue = signal('');
  protected draftConfidence = signal<Confidence>('verified');
  protected paramError = signal<string | null>(null);
  protected savingParam = signal(false);

  protected startEdit(p: Parameter): void {
    this.editing.set(p.code);
    this.draftValue.set(p.value === null ? '' : String(p.value).replace('.', ','));
    this.draftConfidence.set(p.confidence === 'missing' ? 'verified' : p.confidence);
    this.paramError.set(null);
  }

  protected saveParam(code: string): void {
    const text = this.draftValue().trim().replace(',', '.');
    const value = text === '' ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      this.paramError.set('Scrivi un numero, per esempio 1,99 (vuoto = mancante)');
      return;
    }
    this.savingParam.set(true);
    this.catalog.updateParameter(code, { value, confidence: this.draftConfidence() }).subscribe({
      next: (list) => {
        this.parameters.set(list); // il server risponde con l'elenco aggiornato
        this.editing.set(null);
        this.savingParam.set(false);
      },
      error: (error) => {
        this.paramError.set(error.error?.error ?? 'Salvataggio non riuscito');
        this.savingParam.set(false);
      },
    });
  }

  protected changeRegion(code: string): void {
    const previous = this.regionCode();
    this.regionCode.set(code);
    this.saving.set(true);
    this.saveError.set(null);
    this.settingsApi.update({ regionCode: code }).subscribe({
      next: () => this.saving.set(false),
      error: () => {
        this.regionCode.set(previous); // torno indietro: sul server non è cambiato niente
        this.saveError.set('Salvataggio non riuscito, riprova');
        this.saving.set(false);
      },
    });
  }
}
