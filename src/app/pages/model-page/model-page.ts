import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { Catalog } from '../../core/services/catalog';
import { BODY_TYPE_LABELS, CarSource, FUEL_LABELS, Powertrain, TrimFeature } from '../../models/car';
import { ConfidenceBadge } from '../../shared/confidence-badge/confidence-badge';
import { Sourced } from '../../shared/sourced/sourced';

/** Scheda di un modello: versioni con prezzi e motori, misure, dotazioni per allestimento. Ogni dato con la sua fonte. */
@Component({
  selector: 'app-model-page',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, MatButtonModule, MatIconModule, MatSlideToggleModule, RouterLink, ConfidenceBadge, Sourced],
  templateUrl: './model-page.html',
  styleUrl: './model-page.scss',
})
export class ModelPage {
  private catalog = inject(Catalog);

  // dal percorso /catalog/model/:id
  readonly id = input.required<string>();

  protected fuels = FUEL_LABELS;
  protected bodyTypes = BODY_TYPE_LABELS;
  protected showUnavailable = signal(false);

  protected model = rxResource({ params: () => Number(this.id()), stream: ({ params }) => this.catalog.model(params) });

  protected sources = computed(() => new Map<number, CarSource>(this.model.hasValue() ? this.model.value().sources.map((s) => [s.id, s]) : []));

  /** Le versioni con allestimento e motore già "attaccati", pronte per la tabella. */
  protected rows = computed(() => {
    if (!this.model.hasValue()) {
      return [];
    }
    const m = this.model.value();
    const trims = new Map(m.trims.map((t) => [t.id, t.name]));
    const powertrains = new Map(m.powertrains.map((p) => [p.id, p]));
    return m.variants
      .filter((v) => v.available || this.showUnavailable())
      .map((v) => ({ variant: v, trim: trims.get(v.trimId) ?? '?', powertrain: powertrains.get(v.powertrainId) as Powertrain }));
  });

  protected unavailableCount = computed(() => (this.model.hasValue() ? this.model.value().variants.filter((v) => !v.available).length : 0));

  /** Le misure: di solito uguali per tutte le versioni, prendo la prima che le ha. */
  protected dimensions = computed(() => (this.model.hasValue() ? (this.model.value().variants.find((v) => v.lengthMm !== null) ?? null) : null));

  /** Matrice dotazioni: solo le dotazioni di cui sappiamo qualcosa, per ogni allestimento. */
  protected featureMatrix = computed(() => {
    if (!this.model.hasValue()) {
      return [];
    }
    const m = this.model.value();
    const byKey = new Map<string, TrimFeature>(m.trimFeatures.map((f) => [`${f.trimId}|${f.code}`, f]));
    const known = new Set(m.trimFeatures.map((f) => f.code));
    return m.features
      .filter((f) => known.has(f.code))
      .map((f) => ({ name: f.name, cells: m.trims.map((t) => byKey.get(`${t.id}|${f.code}`) ?? null) }));
  });

  protected packageName(id: number | null): string {
    return (this.model.hasValue() && this.model.value().packages.find((p) => p.id === id)?.name) || 'pacchetto';
  }

  protected consumptionUnit(p: Powertrain): string {
    return { l_100km: 'l/100 km', kg_100km: 'kg/100 km', kwh_100km: 'kWh/100 km' }[p.consumptionUnit ?? 'l_100km'];
  }
}
