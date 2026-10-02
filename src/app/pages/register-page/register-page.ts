import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/services/auth';

// Stesse regole del PHP (validate_new_credentials in auth.php): avvisiamo subito, il server ricontrolla comunque.
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
const PASSWORD_MIN = 12;

/** Validatore di GRUPPO: guarda due campi insieme (password e conferma) invece di uno solo. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './register-page.html',
  // stesso aspetto della pagina di login: riuso il suo foglio di stile
  styleUrl: '../login-page/login-page.scss',
})
export class RegisterPage {
  private auth = inject(Auth);
  private router = inject(Router);

  protected passwordMin = PASSWORD_MIN;

  protected form = inject(NonNullableFormBuilder).group(
    {
      username: ['', [Validators.required, Validators.pattern(USERNAME_PATTERN)]],
      password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN)]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  protected submitting = signal(false);
  protected errorMessage = signal<string | null>(null);
  protected hidePassword = signal(true);

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const { username, password } = this.form.getRawValue();
    this.auth.register(username, password).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (error: HttpErrorResponse) => {
        // es. "Questo nome utente è già in uso", "Troppi tentativi da questa rete..."
        this.errorMessage.set(error.error?.error ?? 'Registrazione non riuscita, riprova');
        this.submitting.set(false);
      },
    });
  }
}
