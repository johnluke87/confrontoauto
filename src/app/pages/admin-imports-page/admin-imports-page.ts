import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { AdminImports } from '../../core/services/admin-imports';
import { ImportStatus } from '../../models/imports';
import { ImportDetailPanel } from './import-detail/import-detail';

/** Solo amministratori: cosa ha portato il Research agent, e cosa aspetta un controllo. */
@Component({
  selector: 'app-admin-imports-page',
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatIconModule, ImportDetailPanel],
  templateUrl: './admin-imports-page.html',
  styleUrl: './admin-imports-page.scss',
})
export class AdminImportsPage {
  private api = inject(AdminImports);

  protected readonly statuses: { value: ImportStatus; label: string }[] = [
    { value: 'review', label: 'Da rivedere' },
    { value: 'applied', label: 'Applicati' },
    { value: 'rejected', label: 'Scartati' },
    { value: 'failed', label: 'Falliti' },
  ];

  protected status = signal<ImportStatus>('review');
  protected expandedId = signal<number | null>(null);

  // params: quando cambia lo stato scelto, rxResource rifà la richiesta da solo
  protected list = rxResource({ params: () => this.status(), stream: ({ params }) => this.api.list(params) });

  protected research = rxResource({ stream: () => this.api.researchStatus() });
  protected unlocking = signal(false);
  protected unlockMessage = signal<string | null>(null);

  protected unlock(): void {
    this.unlocking.set(true);
    this.api.unlock().subscribe({
      next: (result) => {
        this.research.set(result);
        this.unlockMessage.set(`${result.released} lavori sbloccati: partono alla prossima esecuzione dell'agent.`);
        this.unlocking.set(false);
      },
      error: () => {
        this.unlockMessage.set('Non sono riuscito a sbloccarli, riprova');
        this.unlocking.set(false);
      },
    });
  }

  protected changeStatus(status: ImportStatus): void {
    this.status.set(status);
    this.expandedId.set(null);
  }

  protected toggle(id: number): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  /** Approvato o scartato: sparisce da "Da rivedere", ricarico l'elenco (e i conteggi). */
  protected onDecided(): void {
    this.expandedId.set(null);
    this.list.reload();
  }
}
