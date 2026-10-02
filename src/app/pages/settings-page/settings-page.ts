import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Catalog } from '../../core/services/catalog';
import { UserSettingsService } from '../../core/services/user-settings';
import { FuelGroup } from '../../models/catalog';
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
  imports: [DecimalPipe, MatCardModule, MatFormFieldModule, MatSelectModule, ConfidenceBadge],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
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
