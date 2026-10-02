import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AdminImports } from '../../../core/services/admin-imports';
import { Evidence, ImportDetail, ImportIssue } from '../../../models/imports';

const VISIBLE_WARNINGS = 8;

/** Il dettaglio di un import: problemi trovati, dati arrivati, e (se da rivedere) i bottoni per decidere. */
@Component({
  selector: 'app-import-detail',
  imports: [CurrencyPipe, DecimalPipe, MatButtonModule, MatTooltipModule, RouterLink],
  templateUrl: './import-detail.html',
  styleUrl: './import-detail.scss',
})
export class ImportDetailPanel {
  private api = inject(AdminImports);

  readonly importId = input.required<number>();
  readonly decided = output<void>();

  protected detail = rxResource({ params: () => this.importId(), stream: ({ params }) => this.api.get(params) });
  protected busy = signal(false);
  protected actionError = signal<string | null>(null);
  protected showAllWarnings = signal(false);

  protected issues = computed(() => {
    const all: ImportIssue[] = this.detail.hasValue() ? this.detail.value().issues : [];
    const warnings = all.filter((i) => i.level === 'warning');
    return {
      blocking: all.filter((i) => i.level !== 'warning'),
      warnings: this.showAllWarnings() ? warnings : warnings.slice(0, VISIBLE_WARNINGS),
      hiddenWarnings: this.showAllWarnings() ? 0 : Math.max(0, warnings.length - VISIBLE_WARNINGS),
    };
  });

  // i dati che il server ha scartato: nella tabella li barro
  private droppedKeys = computed(() => new Set((this.detail.hasValue() ? this.detail.value().issues : []).map((i) => i.key).filter(Boolean)));

  protected droppedVariant(trim: string, powertrain: string, field: string): boolean {
    return this.droppedKeys().has(`variant:${trim.toLowerCase()}|${powertrain.toLowerCase()}:${field}`);
  }

  protected droppedPowertrain(name: string, field: string): boolean {
    return this.droppedKeys().has(`powertrain:${name.toLowerCase()}:${field}`);
  }

  protected trimNames = computed(() =>
    (this.detail.hasValue() ? (this.detail.value().payload.trims ?? []) : []).map((t) => (typeof t === 'string' ? t : t.name)),
  );

  /** Il valore di un dato {v, q, s} (o undefined se manca). */
  protected v(field: unknown): unknown {
    return (field as Evidence | undefined)?.v;
  }

  protected num(field: unknown): number | null {
    const value = (field as Evidence | undefined)?.v;
    return typeof value === 'number' ? value : null;
  }

  /** Testo del tooltip: la citazione e il numero della fonte. */
  protected quote(field: unknown): string {
    const e = field as Evidence | undefined;
    return e ? `«${e.q}» (fonte ${e.s})` : '';
  }

  protected approve(): void {
    this.decide(this.api.approve(this.importId()));
  }

  protected reject(): void {
    this.decide(this.api.reject(this.importId()));
  }

  private decide(request: Observable<ImportDetail>): void {
    this.busy.set(true);
    this.actionError.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.decided.emit();
      },
      error: (error) => {
        this.actionError.set(error.error?.error ?? 'Operazione non riuscita');
        this.busy.set(false);
      },
    });
  }
}
