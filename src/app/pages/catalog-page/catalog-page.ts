import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { Catalog } from '../../core/services/catalog';
import { BODY_TYPE_LABELS } from '../../models/car';

/** Archivio: i modelli di un marchio. Il marchio scelto sta nell'indirizzo (?brand=12), così il "indietro" funziona. */
@Component({
  selector: 'app-catalog-page',
  imports: [CurrencyPipe, DatePipe, MatFormFieldModule, MatSelectModule, RouterLink],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  private catalog = inject(Catalog);
  private router = inject(Router);

  // arriva dal query param ?brand= (withComponentInputBinding in app.config.ts)
  readonly brand = input<string>();

  protected bodyTypes = BODY_TYPE_LABELS;
  protected brandId = computed(() => Number(this.brand()) || undefined);

  protected brands = rxResource({ stream: () => this.catalog.brands() });
  // con brandId undefined rxResource resta fermo: nessuna richiesta finché non scegli un marchio
  protected models = rxResource({ params: () => this.brandId(), stream: ({ params }) => this.catalog.models(params) });

  // prima i marchi con modelli in archivio
  protected sortedBrands = computed(() =>
    this.brands.hasValue() ? [...this.brands.value()].sort((a, b) => Number(b.models > 0) - Number(a.models > 0) || a.name.localeCompare(b.name)) : [],
  );

  protected selectBrand(id: number): void {
    this.router.navigate([], { queryParams: { brand: id } });
  }
}
