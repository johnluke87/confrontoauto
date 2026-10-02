import { Component, computed, input } from '@angular/core';
import { CarSource, FieldProvenance } from '../../models/car';
import { ConfidenceBadge } from '../confidence-badge/confidence-badge';

/**
 * Un valore con il suo pallino di affidabilità:  <app-sourced [p]="v.provenance['powerKw']" [sources]="sources">51 kW</app-sourced>
 * Se il dato non c'è (p assente) mostra il pallino rosso "mancante" e un trattino.
 */
@Component({
  selector: 'app-sourced',
  imports: [ConfidenceBadge],
  template: `
    @if (p(); as prov) {
      <ng-content />
      <app-confidence-badge [confidence]="prov.confidence" [source]="source()" [quote]="prov.quote" />
    } @else {
      <span class="manca">—</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .manca {
      opacity: 0.5;
    }
  `,
})
export class Sourced {
  readonly p = input<FieldProvenance | null | undefined>();
  readonly sources = input<Map<number, CarSource>>(new Map());

  protected source = computed(() => {
    const id = this.p()?.sourceId;
    return id == null ? null : (this.sources().get(id) ?? null);
  });
}
