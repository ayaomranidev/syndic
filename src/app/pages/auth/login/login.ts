import { Component, OnInit, HostBinding } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Auth } from '../../../core/services/auth';
import { UserRole } from '../../../models/user.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class Login implements OnInit {
  @HostBinding('class') hostClass = 'block w-full';
  
  loading = false;
  errorMessage = '';
  showPassword = false;

  // ✅ CORRIGÉ: ADMIN est global (pas de SUPER_ADMIN distinct)
  initialUsers = [
    { role: 'ADMIN_RESIDENCE' as UserRole, email: 'admin.residence@syndipro.fr', password: 'admin123' },
    { role: 'ADMIN' as UserRole, email: 'admin@syndipro.fr', password: 'admin123' },
    { role: 'COPROPRIETAIRE' as UserRole, email: 'aya.omrani@syndicplus.fr', password: 'coproprietaire123' },
    { role: 'COPROPRIETAIRE' as UserRole, email: 'jean.martin@syndicplus.fr', password: 'coproprietaire123' },
    { role: 'LOCATAIRE' as UserRole, email: 'sophie.bernard@syndicplus.fr', password: 'locataire123' },
    { role: 'TRESORIER' as UserRole, email: 'pierre.moreau@syndicplus.fr', password: 'tresorier123' },
    { role: 'PRESIDENT' as UserRole, email: 'catherine.leroy@syndicplus.fr', password: 'president123' },
    { role: 'GARDIEN' as UserRole, email: 'robert.dubois@syndicplus.fr', password: 'gardien123' },
  ];

  form: any;

  constructor(
    private fb: FormBuilder, 
    private auth: Auth, 
    private router: Router
  ) {
    this.form = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
      rememberMe: [false]
    });
  }

  ngOnInit() {
    this.checkScreenSize();
    window.addEventListener('resize', this.checkScreenSize.bind(this));
  }

  checkScreenSize() {
    // Optional logic if needed
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  // ✅ CORRIGÉ: Gestion de tous les rôles y compris les nouveaux
  handleQuickLogin(role: UserRole) {
    // Créer un dictionnaire des utilisateurs de test par rôle
    const testUsers: Partial<Record<UserRole, { email: string; password: string }>> = {
      ADMIN: this.initialUsers[1],
      ADMIN_RESIDENCE: this.initialUsers[0],
      COPROPRIETAIRE: this.initialUsers[2],
      LOCATAIRE: this.initialUsers[3],
      TRESORIER: this.initialUsers[4],
      PRESIDENT: this.initialUsers[5],
      GARDIEN: this.initialUsers[6],
    };

    const user = testUsers[role];
    if (user) {
      this.form.patchValue({ 
        email: user.email, 
        password: user.password,
        rememberMe: true 
      });
    }
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    
    const { email, password } = this.form.getRawValue();
    this.loading = true;
    this.errorMessage = '';
    
    this.auth.login(email!, password!).subscribe({
      next: (result) => {
        this.loading = false;
        if (result.requiresRoleSelection) {
          this.router.navigate(['/auth/role-selection']);
        } else {
          this.router.navigate(['/dashboard']);
        }
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.message || 'Identifiants incorrects.';
      },
    });
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.checkScreenSize.bind(this));
  }
}