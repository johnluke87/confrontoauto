import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Catalog } from '../../core/services/catalog';
import { CatalogRow } from '../../models/catalog-row';
import { ConfidenceBadge } from '../../shared/confidence-badge/confidence-badge';
import {
  applyFilters,
  applySorts,
  cellText,
  Column,
  COLUMNS,
  ColumnKey,
  DEFAULT_VISIBLE,
  EMPTY_FILTERS,
  enumValue,
  Filters,
  Range,
  Sort,
  toCsv,
} from './catalog-table';

const STORAGE_KEY = 'confronto-auto.archivio.v1';
const PAGE_SIZES = [50, 100, 250, 1000];

interface SavedState {
  visible: ColumnKey[];
  sorts: Sort[];
  filters: Filters;
  pageSize: number;
}

function loadState(): Partial<SavedState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Archivio: il LISTONE di tutte le auto. Una riga per versione, filtri su ogni colonna,
 * ordinamento su più colonne (clic = ordina, Maiusc+clic = aggiunge un ordinamento), colonne a scelta, CSV.
 */
@Component({
  selector: 'app-catalog-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTooltipModule,
    ConfidenceBadge,
  ],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  private catalog = inject(Catalog);
  private router = inject(Router);

  protected readonly allColumns = COLUMNS;
  protected readonly pageSizes = PAGE_SIZES;

  protected data = rxResource({ stream: () => this.catalog.catalogRows() });

  // le scelte dell'utente restano nel browser (colonne, ordinamento, filtri)
  private saved = loadState();
  protected visible = signal<ColumnKey[]>(this.saved.visible ?? DEFAULT_VISIBLE);
  protected sorts = signal<Sort[]>(this.saved.sorts ?? [{ key: 'brand', dir: 1 }, { key: 'model', dir: 1 }]);
  protected filters = signal<Filters>({ ...EMPTY_FILTERS, ...this.saved.filters });
  protected pageSize = signal(this.saved.pageSize ?? 100);
  protected page = signal(0);

  constructor() {
    effect(() => {
      const state: SavedState = { visible: this.visible(), sorts: this.sorts(), filters: this.filters(), pageSize: this.pageSize() };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // navigazione privata o spazio pieno: pazienza, si riparte dai valori predefiniti
      }
    });
  }

  protected columns = computed(() => this.allColumns.filter((c) => this.visible().includes(c.key)));
  private rows = computed<CatalogRow[]>(() => (this.data.hasValue() ? this.data.value() : []));

  /** I valori possibili di ogni colonna "enum" (dai dati), con il nome da mostrare. */
  protected options = computed(() => {
    const result = new Map<ColumnKey, { value: string; label: string; count: number }[]>();
    for (const column of this.allColumns.filter((c) => c.type === 'enum')) {
      const counts = new Map<string, number>();
      for (const row of this.rows()) {
        const value = enumValue(row, column.key);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      result.set(
        column.key,
        [...counts.entries()]
          .map(([value, count]) => ({ value, count, label: value === '' ? '(non indicato)' : (column.labels?.[value] ?? value) }))
          .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : a.label.localeCompare(b.label, 'it'))),
      );
    }
    return result;
  });

  protected filtered = computed(() => applySorts(applyFilters(this.rows(), this.filters()), this.sorts()));
  protected modelCount = computed(() => new Set(this.filtered().map((r) => r.modelId)).size);
  protected totalModels = computed(() => new Set(this.rows().map((r) => r.modelId)).size);
  protected pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  /** Le righe della pagina corrente, con i testi delle celle già pronti. */
  protected pageRows = computed(() => {
    const page = Math.min(this.page(), this.pageCount() - 1);
    const columns = this.columns();
    return this.filtered()
      .slice(page * this.pageSize(), (page + 1) * this.pageSize())
      .map((row) => ({ row, cells: columns.map((c) => cellText(row, c)) }));
  });

  protected activeFilterCount = computed(() => {
    const f = this.filters();
    return (
      (f.search.trim() ? 1 : 0) +
      Object.values(f.text).filter((v) => v?.trim()).length +
      Object.values(f.enums).filter((v) => v?.length).length +
      Object.values(f.ranges).filter((r) => r && (r.min !== null || r.max !== null)).length
    );
  });

  protected labelOf(key: ColumnKey): string {
    return this.allColumns.find((c) => c.key === key)?.label ?? key;
  }

  // ---- ordinamento ----

  /** Clic: ordina solo per questa colonna (di nuovo = inverte). Maiusc+clic: aggiunge/inverte questa come livello in più. */
  protected sortBy(column: Column, event: MouseEvent): void {
    const current = this.sorts();
    const existing = current.find((s) => s.key === column.key);
    if (event.shiftKey) {
      this.sorts.set(
        existing ? current.map((s) => (s.key === column.key ? { ...s, dir: (s.dir * -1) as 1 | -1 } : s)) : [...current, { key: column.key, dir: 1 }],
      );
    } else {
      this.sorts.set([{ key: column.key, dir: existing && current.length === 1 ? ((existing.dir * -1) as 1 | -1) : 1 }]);
    }
    this.page.set(0);
  }

  protected sortIndex(key: ColumnKey): number {
    return this.sorts().findIndex((s) => s.key === key);
  }

  protected removeSort(key: ColumnKey): void {
    this.sorts.update((sorts) => sorts.filter((s) => s.key !== key));
  }

  protected toggleSortDir(key: ColumnKey): void {
    this.sorts.update((sorts) => sorts.map((s) => (s.key === key ? { ...s, dir: (s.dir * -1) as 1 | -1 } : s)));
  }

  // ---- filtri ----

  private updateFilters(change: (f: Filters) => Filters): void {
    this.filters.update(change);
    this.page.set(0);
  }

  protected setSearch(value: string): void {
    this.updateFilters((f) => ({ ...f, search: value }));
  }

  protected setText(key: ColumnKey, value: string): void {
    this.updateFilters((f) => ({ ...f, text: { ...f.text, [key]: value } }));
  }

  protected setEnum(key: ColumnKey, values: string[]): void {
    this.updateFilters((f) => ({ ...f, enums: { ...f.enums, [key]: values } }));
  }

  protected setRange(key: ColumnKey, side: keyof Range, raw: string): void {
    const text = raw.trim().replace(',', '.');
    const value = text === '' || !Number.isFinite(Number(text)) ? null : Number(text);
    this.updateFilters((f) => ({ ...f, ranges: { ...f.ranges, [key]: { min: null, max: null, ...f.ranges[key], [side]: value } } }));
  }

  protected rangeValue(key: ColumnKey, side: keyof Range): string {
    const value = this.filters().ranges[key]?.[side];
    return value === null || value === undefined ? '' : String(value);
  }

  protected clearFilters(): void {
    this.updateFilters(() => EMPTY_FILTERS);
  }

  // ---- colonne ----

  protected toggleColumn(key: ColumnKey, shown: boolean): void {
    // mantengo l'ordine delle colonne come in COLUMNS
    const set = new Set(this.visible());
    shown ? set.add(key) : set.delete(key);
    this.visible.set(this.allColumns.map((c) => c.key).filter((k) => set.has(k)));
  }

  protected showColumns(which: 'all' | 'default'): void {
    this.visible.set(which === 'all' ? this.allColumns.map((c) => c.key) : DEFAULT_VISIBLE);
  }

  // ---- pagine, apertura, CSV ----

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
  }

  protected goTo(page: number): void {
    this.page.set(Math.max(0, Math.min(page, this.pageCount() - 1)));
  }

  protected open(row: CatalogRow): void {
    this.router.navigate(['/catalog/model', row.modelId]);
  }

  protected exportCsv(): void {
    // BOM all'inizio: così Excel legge bene gli accenti
    const blob = new Blob(['﻿' + toCsv(this.filtered(), this.columns())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `confronto-auto-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
