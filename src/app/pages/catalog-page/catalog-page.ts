import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/services/auth';
import { Catalog } from '../../core/services/catalog';
import { BODY_TYPE_LABELS, ModelSummary } from '../../models/car';

interface BrandGroup {
  brandId: number;
  brand: string;
  models: ModelSummary[];
}

/** Archivio: TUTTE le auto in archivio, raggruppate per marchio in ordine alfabetico. */
@Component({
  selector: 'app-catalog-page',
  imports: [CurrencyPipe, DatePipe, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule, RouterLink],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  protected auth = inject(Auth);
  private catalog = inject(Catalog);

  protected bodyTypes = BODY_TYPE_LABELS;

  protected models = rxResource({ stream: () => this.catalog.models() });
  protected brands = rxResource({ stream: () => this.catalog.brands() });

  // ricerca veloce: filtra per marchio, modello o carrozzeria ("kia", "puma", "suv")
  protected filter = signal('');
  protected queueMessage = signal<string | null>(null);

  protected groups = computed<BrandGroup[]>(() => {
    const text = this.filter().trim().toLowerCase();
    const groups = new Map<number, BrandGroup>();
    for (const m of this.models.hasValue() ? this.models.value() : []) {
      const haystack = `${m.brand} ${m.name} ${m.bodyType ? this.bodyTypes[m.bodyType] : ''}`.toLowerCase();
      if (text !== '' && !haystack.includes(text)) {
        continue;
      }
      let group = groups.get(m.brandId);
      if (!group) {
        group = { brandId: m.brandId, brand: m.brand, models: [] };
        groups.set(m.brandId, group);
      }
      group.models.push(m);
    }
    return [...groups.values()]; // il server li manda già ordinati per marchio
  });

  protected totalShown = computed(() => this.groups().reduce((sum, g) => sum + g.models.length, 0));

  /** Marchi attivi di cui non abbiamo ancora l'elenco dei modelli (l'agent non ci è ancora arrivato o il sito blocca). */
  protected brandsWithoutModels = computed(() =>
    this.brands.hasValue() ? this.brands.value().filter((b) => b.enabled && b.models === 0).map((b) => b.name) : [],
  );

  /** "Cerca subito": i modelli di questo marchio passano davanti agli altri alla prossima esecuzione dell'agent. */
  protected researchBrandNow(group: BrandGroup): void {
    this.catalog.researchNow({ brandId: group.brandId }).subscribe({
      next: ({ queued }) => {
        this.queueMessage.set(`${group.brand}: ${queued} modelli in coda, l'agent li fa per primi alla prossima esecuzione.`);
        this.models.reload();
      },
      error: () => this.queueMessage.set('Non sono riuscito a metterli in coda, riprova'),
    });
  }
}
