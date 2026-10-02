import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/services/auth';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);

  protected form = inject(NonNullableFormBuilder).group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected submitting = signal(false);
  protected errorMessage = signal<string | null>(null);
  protected hidePassword = signal(true);

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched(); // mostra subito gli errori dei campi vuoti
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const { username, password } = this.form.getRawValue();
    this.auth.login(username, password).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (error: HttpErrorResponse) => {
        // I messaggi del PHP sono pensati per essere mostrati ("Utente o password non validi", "Troppi tentativi...")
        this.errorMessage.set(error.error?.error ?? 'Accesso non riuscito, riprova');
        this.submitting.set(false);
      },
    });
  }
}