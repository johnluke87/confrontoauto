import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Catalog } from '../../core/services/catalog';
import { Brand } from '../../models/catalog';

/** Solo amministratori: quali marchi l'aggiornamento automatico deve seguire. */
@Component({
  selector: 'app-admin-brands-page',
  imports: [DatePipe, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './admin-brands-page.html',
  styleUrl: './admin-brands-page.scss',
})
export class AdminBrandsPage {
  private catalog = inject(Catalog);

  protected brands = rxResource({ stream: () => this.catalog.brands() });
  protected filter = signal('');
  protected saving = signal(false);
  protected saveError = signal<string | null>(null);

  protected visible = computed(() => {
    const all = this.brands.hasValue() ? this.brands.value() : [];
    const text = this.filter().trim().toLowerCase();
    return text === '' ? all : all.filter((b) => b.name.toLowerCase().includes(text));
  });

  protected enabledCount = computed(() => (this.brands.hasValue() ? this.brands.value().filter((b) => b.enabled).length : 0));

  protected toggle(brand: Brand, enabled: boolean): void {
    this.save([brand.id], enabled);
  }

  /** "Attiva tutti" / "Disattiva tutti" valgono per i marchi visibili (cioè quelli filtrati). */
  protected setAllVisible(enabled: boolean): void {
    const ids = this.visible()
      .filter((b) => b.enabled !== enabled)
      .map((b) => b.id);
    if (ids.length > 0) {
      this.save(ids, enabled);
    }
  }

  private save(ids: number[], enabled: boolean): void {
    this.saving.set(true);
    this.saveError.set(null);
    this.catalog.setBrandsEnabled(ids, enabled).subscribe({
      next: (brands) => {
        this.brands.set(brands); // il server risponde con la lista aggiornata: niente seconda richiesta
        this.saving.set(false);
      },
      error: () => {
        this.saveError.set('Salvataggio non riuscito, riprova');
        this.brands.reload(); // rimetto le checkbox com'erano davvero
        this.saving.set(false);
      },
    });
  }
}
