import { Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Confidence } from '../../models/catalog';

const LABELS: Record<Confidence, string> = {
  official: 'Dato ufficiale',
  verified: 'Verificato',
  estimate: 'Stima',
  missing: 'Dato mancante',
};

/** Il pallino colorato dell'affidabilità; passandoci sopra si vedono la fonte e la frase da cui viene il dato. */
@Component({
  selector: 'app-confidence-badge',
  imports: [MatTooltipModule],
  template: `<span
    class="badge"
    [class]="confidence()"
    [matTooltip]="tooltip()"
    matTooltipClass="tooltip-fonte"
    tabindex="0"
    [attr.aria-label]="tooltip()"
  ></span>`,
  styles: `
    .badge {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      vertical-align: middle;
      cursor: help;
      flex-shrink: 0;
    }
    .official { background: #2e9d4f; }
    .verified { background: #e0b400; }
    .estimate { background: #ef7d1a; }
    .missing { background: #d93a3a; }
  `,
})
export class ConfidenceBadge {
  readonly confidence = input.required<Confidence>();
  // titolo della fonte (o null se non c'è)
  readonly source = input<{ title: string } | null | undefined>(null);
  readonly quote = input<string | null | undefined>(null);

  protected tooltip = computed(() => {
    const parts = [LABELS[this.confidence()]];
    const source = this.source();
    if (source) {
      parts.push(`fonte: ${source.title}`);
    }
    const quote = this.quote();
    if (quote) {
      parts.push(`«${quote}»`);
    }
    return parts.join(' · ');
  });
}
