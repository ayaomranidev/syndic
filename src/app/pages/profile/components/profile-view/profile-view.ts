import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProfileService, UpdateProfilePayload } from '../../services/profile';
import { User, UserRole } from '../../../../models/user.model';

@Component({
  selector: 'app-profile-view',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile-view.html',
  styleUrl: './profile-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileView {
  private readonly fb = inject(FormBuilder);
  private readonly profileService = inject(ProfileService);

  readonly loading = signal(true);
  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly isEditing = signal(false);
  readonly isChangingPassword = signal(false);
  readonly showCurrentPassword = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly profile = signal<User | null>(null);

  readonly profileForm = this.fb.group({
    fullname: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    residence: [''],
    batiment: [''],
    lot: [''],
  });

  readonly passwordForm = this.fb.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
  });

  readonly roleInfo = computed(() => this.computeRoleInfo(this.profile()?.role));

  constructor() {
    effect(() => {
      // trigger initial load
      this.loadProfile();
    }, { allowSignalWrites: true });
  }

  async loadProfile(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const user = await this.profileService.loadProfile();
      this.profile.set(user);
      this.profileForm.patchValue({
        fullname: user.fullname || '',
        email: user.email,
        phone: user.phone || '',
        residence: user.residence || '',
        batiment: user.batiment || '',
        lot: user.lot || '',
      });
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async saveProfile(): Promise<void> {
    this.message.set(null);
    this.error.set(null);
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const payload = this.profileForm.getRawValue() as UpdateProfilePayload;
    this.savingProfile.set(true);
    try {
      const updated = await this.profileService.updateProfile(payload);
      this.profile.set(updated);
      this.message.set('Profil mis à jour avec succès');
      this.isEditing.set(false);
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async changePassword(): Promise<void> {
    this.message.set(null);
    this.error.set(null);
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword, confirmPassword } = this.passwordForm.getRawValue();
    if (newPassword !== confirmPassword) {
      this.error.set('Les mots de passe doivent correspondre');
      return;
    }

    this.savingPassword.set(true);
    try {
      await this.profileService.changePassword(currentPassword!, newPassword!);
      this.message.set('Mot de passe mis à jour');
      this.isChangingPassword.set(false);
      this.passwordForm.reset();
      this.showCurrentPassword.set(false);
      this.showNewPassword.set(false);
      this.showConfirmPassword.set(false);
    } catch (err) {
      this.error.set(this.mapError(err));
    } finally {
      this.savingPassword.set(false);
    }
  }

  resetProfileForm(): void {
    const user = this.profile();
    if (!user) return;
    this.profileForm.patchValue({
      fullname: user.fullname || '',
      email: user.email,
      phone: user.phone || '',
      residence: user.residence || '',
      batiment: user.batiment || '',
      lot: user.lot || '',
    });
    this.isEditing.set(false);
  }

  private computeRoleInfo(role?: UserRole): { label: string; color: string } {
    switch (role) {
      case 'COPROPRIETAIRE':
        return { label: 'Copropriétaire', color: 'badge-blue' };
      case 'LOCATAIRE':
        return { label: 'Locataire', color: 'badge-green' };
      case 'TRESORIER':
        return { label: 'Trésorier', color: 'badge-amber' };
      case 'PRESIDENT':
        return { label: 'Président', color: 'badge-purple' };
      case 'GARDIEN':
        return { label: 'Gardien', color: 'badge-orange' };
      case 'ADMIN':
        return { label: 'Administrateur', color: 'badge-red' };
      default:
        return { label: 'Utilisateur', color: 'badge-gray' };
    }
  }

  asDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    return null;
  }

  private mapError(error: unknown): string {
    const code = (error as { code?: string; message?: string })?.code || '';
    if (code === 'auth/requires-recent-login') {
      return 'Veuillez vous reconnecter pour modifier ces informations.';
    }
    return (error as Error)?.message || 'Une erreur est survenue';
  }
}
