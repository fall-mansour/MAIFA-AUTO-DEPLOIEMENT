// src/app/components/password/password.component.ts
import { Component } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { PasswordService } from '../../password.service';

@Component({
  selector: 'app-password',
  standalone: true,
  imports: [RouterModule, FormsModule, CommonModule],
  templateUrl: './password.html',
  styleUrl: './password.scss'
})
export class PasswordComponent {
  email: string = '';
  newPassword: string = '';
  confirmPassword: string = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  passwordStrength: 'weak' | 'medium' | 'strong' | '' = '';
  passwordStrengthText: string = '';

  constructor(
    private router: Router,
    private passwordService: PasswordService
  ) {}

  updatePasswordStrength() {
    const pwd = this.newPassword;
    let strength = 0;
    let text = '';

    if (pwd.length >= 6) strength++;
    if (pwd.length >= 8) strength++;
    if (/[A-Z]/.test(pwd)) strength++;
    if (/[0-9]/.test(pwd)) strength++;
    if (/[^A-Za-z0-9]/.test(pwd)) strength++;

    if (strength <= 2) {
      this.passwordStrength = 'weak';
      text = 'Faible';
    } else if (strength <= 4) {
      this.passwordStrength = 'medium';
      text = 'Moyen';
    } else {
      this.passwordStrength = 'strong';
      text = 'Très fort';
    }

    this.passwordStrengthText = text;
  }

  onSubmit() {
    this.errorMessage = '';
    this.successMessage = '';
    this.isLoading = true;

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Les mots de passe ne correspondent pas';
      this.isLoading = false;
      return;
    }

    this.passwordService.updatePassword(this.email, this.newPassword).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMessage = 'Mot de passe mis à jour ! Redirection...';
        setTimeout(() => this.router.navigate(['/connexion']), 2000);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || 'Erreur lors de la mise à jour';
      }
    });
  }
}
