import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/services/auth';
import { Catalog } from '../../core/services/catalog';

/** Per ora una pagina "a che punto siamo": il confronto vero arriva con le prossime tappe. */
@Component({
  selector: 'app-home-page',
  imports: [MatCardModule, MatButtonModule, RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected auth = inject(Auth);
  private catalog = inject(Catalog);

  protected brands = rxResource({ stream: () => this.catalog.brands() });

  protected stats = computed(() => {
    // value() in errore lancia un'eccezione: prima controllo hasValue()
    const brands = this.brands.hasValue() ? this.brands.value() : [];
    return {
      brands: brands.length,
      enabled: brands.filter((b) => b.enabled).length,
      models: brands.reduce((sum, b) => sum + b.models, 0),
    };
  });
}
