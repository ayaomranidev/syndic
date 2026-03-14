import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { Appartement, AppartementService } from '../../appartements/services/appartement.service';
import { Batiment, BatimentService } from '../../batiments/services/batiment.service';
import { Residence, ResidenceService } from '../../residences/services/residence.service';
import { User, UserRole, UserService, UserStatus } from '../services/coproprietaire.service';
import { Auth } from '../../../core/services/auth';

type FormState =
  Partial<User> & {
    password?: string;
    autoPassword?: boolean;
    passwordVisible?: boolean;
    residenceId?: string;
    batimentId?: string;
    appartementId?: string | null;
    date_entree?: string;
    date_sortie?: string;
  };

@Component({
  selector: 'app-coproprietaires',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './coproprietaires.component.html',
  styleUrls: ['./coproprietaires.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoproprietairesComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);
  private readonly appartementService = inject(AppartementService);
  private readonly batimentService = inject(BatimentService);
  private readonly residenceService = inject(ResidenceService);
  private readonly datePipe = inject(DatePipe);
  readonly currentUserId = '1';
  isResidenceAdmin = false;
  currentResidenceId: string | null = null;
  currentResidenceName: string | null = null;

  private batimentResidenceId(b: Batiment): string | null {
    return (b.residenceDocId || (b as any).residenceId || null) as string | null;
  }

  private appartementResidenceId(a: Appartement): string | null {
    return (a.residenceDocId || (a as any).residenceId || null) as string | null;
  }

  readonly residencesOptions = signal<Residence[]>([]);
  readonly batimentsOptions = signal<Batiment[]>([]);
  readonly appartementsOptions = signal<Appartement[]>([]);

  // Liste des rôles disponibles
  readonly roleOptions: UserRole[] = [
    'ADMIN',
    'ADMIN_RESIDENCE',
    'COPROPRIETAIRE', 
    'LOCATAIRE', 
    'TRESORIER', 
    'PRESIDENT', 
    'GARDIEN'
  ];
  
  readonly showRoleDropdown = signal(false);
  readonly users = signal<User[]>(this.userService.getAll());
  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | UserStatus>('all');
  readonly roleFilter = signal<'all' | UserRole>('all');
  readonly isModalOpen = signal(false);
  readonly editingId = signal<string | number | null>(null);
  readonly ascenseurWarning = signal<string | null>(null);
  readonly detailUser = signal<User | null>(null);
  
  // ✅ CORRIGÉ: Afficher la sélection de résidence UNIQUEMENT pour ADMIN_RESIDENCE
  readonly showResidenceSelection = computed(() => {
    const roles = this.form().roles || [];
    // Seul ADMIN_RESIDENCE a besoin de sélectionner une résidence
    // ADMIN (global) n'en a pas besoin car il voit tout
    return roles.includes('ADMIN_RESIDENCE');
  });

  readonly form = signal<FormState>({
    name: '',
    email: '',
    roles: ['COPROPRIETAIRE'],
    role: 'COPROPRIETAIRE',
    status: 'active',
    phone: '',
    residence: '',
    batiment: '',
    lot: '',
    etage: undefined,
    hasParking: false,
    hasAscenseur: false,
    password: '',
    autoPassword: true,
    passwordVisible: false,
    residenceId: undefined,
    batimentId: undefined,
    appartementId: null,
    date_entree: '',
    createdAt: new Date().toISOString(),
  });

  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    const role = this.roleFilter();

    return this.users().filter((user) => {
      const matchesSearch =
        !term ||
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term);
      const matchesStatus = status === 'all' || user.status === status;
      const matchesRole = role === 'all' || this.rolesOf(user).includes(role);
      return matchesSearch && matchesStatus && matchesRole;
    });
  });

  readonly stats = computed(() => {
    const snapshot = this.users();
    const total = snapshot.length;
    const actifs = snapshot.filter((u) => u.status === 'active').length;
    const admins = snapshot.filter((u) => this.rolesOf(u).includes('ADMIN')).length;
    const adminResidences = snapshot.filter((u) => this.rolesOf(u).includes('ADMIN_RESIDENCE')).length;
    const copro = snapshot.filter((u) => this.rolesOf(u).includes('COPROPRIETAIRE')).length;
    return { total, actifs, admins, adminResidences, copro };
  });

  roleLabel(role: UserRole) {
    const labels: Record<UserRole, string> = {
      COPROPRIETAIRE: 'Copropriétaire',
      LOCATAIRE: 'Locataire',
      TRESORIER: 'Trésorier',
      PRESIDENT: 'Président',
      GARDIEN: 'Gardien',
      ADMIN: 'Administrateur Global',
      ADMIN_RESIDENCE: 'Admin Résidence'
    };
    return labels[role];
  }

  roleClass(role: UserRole) {
    const classes: Record<UserRole, string> = {
      COPROPRIETAIRE: 'badge badge-blue',
      LOCATAIRE: 'badge badge-green',
      TRESORIER: 'badge badge-amber',
      PRESIDENT: 'badge badge-purple',
      GARDIEN: 'badge badge-orange',
      ADMIN: 'badge badge-red',
      ADMIN_RESIDENCE: 'badge badge-purple'
    };
    return classes[role];
  }

  statusClass(status: UserStatus) {
    return status === 'active' ? 'badge badge-green' : 'badge badge-gray';
  }

  setRoles(selected: UserRole[]) {
    let roles = (selected || []).filter(Boolean);
    if (this.isResidenceAdmin) {
      roles = roles.filter((r) => r !== 'ADMIN');
    }
    if (!roles.length) {
      window.alert('Sélectionnez au moins un rôle.');
      return;
    }
    this.form.update((current) => ({ ...current, roles, role: roles[0] }));
    this.showRoleDropdown.set(false);
  }

  toggleRole(role: UserRole, checked: boolean) {
    const currentRoles = this.form().roles || [];
    const set = new Set<UserRole>(currentRoles);
    if (checked) {
      set.add(role);
    } else {
      set.delete(role);
    }
    this.setRoles(Array.from(set));
  }

  roleSummary() {
    const roles = this.form().roles || [];
    return roles.length ? roles.map((r) => this.roleLabel(r)).join(', ') : 'Sélectionnez un rôle';
  }

  setStatus(value: string) {
    this.updateForm('status', value as UserStatus);
  }

  setRoleFilter(value: string) {
    this.roleFilter.set(value as UserRole | 'all');
  }

  async ngOnInit() {
    try {
      await firstValueFrom(this.auth.currentUser$.pipe(filter(Boolean), take(1)));
      const current = this.auth.currentUser;
      if (current) {
        const roles = current.roles || (current.role ? [current.role] : []);
        this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
        this.currentResidenceId = this.isResidenceAdmin
          ? (current.residenceId || (current as any).residenceDocId || null)
          : null;
        this.currentResidenceName = this.isResidenceAdmin ? (current.residence || null) : null;
      }
      await Promise.all([this.refreshFromFirestore(), this.loadReferenceData()]);
      if (this.isResidenceAdmin && this.currentResidenceId) {
        this.onResidenceChange(this.currentResidenceId);
      }
    } catch (err) {
      console.error('Chargement initial impossible (auth ou Firestore)', err);
    }
  }

  private async loadReferenceData() {
    try {
      const [residences, batiments, appartements] = await Promise.all([
        this.residenceService.loadFromFirestore(),
        this.batimentService.loadFromFirestore(),
        this.appartementService.loadAppartements(),
      ]);
      const scopedResidences = this.isResidenceAdmin && this.currentResidenceId
        ? residences.filter((r) => r.docId === this.currentResidenceId)
        : residences;

      const scopedBatiments = this.isResidenceAdmin && this.currentResidenceId
        ? batiments.filter((b) => this.batimentResidenceId(b) === this.currentResidenceId)
        : batiments;

      const scopedAppartements = this.isResidenceAdmin && this.currentResidenceId
        ? appartements.filter((a) => this.appartementResidenceId(a) === this.currentResidenceId)
        : appartements;

      this.residencesOptions.set(scopedResidences);
      this.batimentsOptions.set(scopedBatiments);
      this.appartementsOptions.set(scopedAppartements);
    } catch (err) {
      console.error('Impossible de charger les résidences/bâtiments/appartements', err);
    }
  }

  private async refreshFromFirestore() {
    try {
      const fetched = await this.userService.loadFromFirestore();
      const scoped = this.isResidenceAdmin && this.currentResidenceId
        ? fetched.filter((u) => {
            const byId = !!u.residenceId && u.residenceId === this.currentResidenceId;
            const byName =
              !u.residenceId &&
              !!u.residence &&
              !!this.currentResidenceName &&
              u.residence.trim().toLowerCase() === this.currentResidenceName.trim().toLowerCase();
            return byId || byName;
          })
        : fetched;
      this.users.set(scoped);
    } catch (err: any) {
      console.error('Impossible de charger les utilisateurs Firestore', err);
      const cached = this.userService.getAll();
      const scoped = this.isResidenceAdmin && this.currentResidenceId
        ? cached.filter((u) => {
            const byId = !!u.residenceId && u.residenceId === this.currentResidenceId;
            const byName =
              !u.residenceId &&
              !!u.residence &&
              !!this.currentResidenceName &&
              u.residence.trim().toLowerCase() === this.currentResidenceName.trim().toLowerCase();
            return byId || byName;
          })
        : cached;
      this.users.set(scoped);
    }
  }

  toNumber(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  batimentsForSelection() {
    const resId = this.form().residenceId;
    const options = this.batimentsOptions();
    return resId ? options.filter((b) => this.batimentResidenceId(b) === resId) : options;
  }

  appartementsForSelection() {
    const { residenceId, batimentId } = this.form();
    const options = this.appartementsOptions();
    const isCreation = !this.editingId();
    return options.filter((a) => {
      const matchResidence = !residenceId || this.appartementResidenceId(a) === residenceId;
      const matchBatiment = !batimentId || a.batimentDocId === batimentId;
      const matchStatut = !isCreation || a.statut === 'vacant';
      return matchResidence && matchBatiment && matchStatut;
    });
  }

  etageOptions() {
    const values = this.appartementsForSelection().map((a) => a.etage);
    return Array.from(new Set(values)).sort((a, b) => a - b);
  }

  onResidenceChange(docId: string | undefined) {
    if (this.isResidenceAdmin && this.currentResidenceId) {
      docId = this.currentResidenceId;
    }
    const residence = docId ? this.residencesOptions().find((r) => r.docId === docId) : undefined;
    this.updateForm('residenceId', docId);
    this.updateForm('residence', residence?.name || '');
    this.updateForm('batimentId', undefined);
    this.updateForm('batiment', '');
    this.updateForm('appartementId', null);
    this.updateForm('lot', '');
    this.updateForm('etage', undefined);
  }

  onBatimentChange(docId: string | undefined) {
    const batiment = docId ? this.batimentsOptions().find((b) => b.docId === docId) : undefined;
    if (batiment) {
      const residence = batiment.residenceDocId
        ? this.residencesOptions().find((r) => r.docId === batiment.residenceDocId)
        : undefined;
      this.updateForm('residenceId', residence?.docId || batiment.residenceDocId);
      this.updateForm('residence', residence?.name || batiment.residenceName || '');
    }
    this.updateForm('batimentId', docId);
    this.updateForm('batiment', batiment?.name || '');
    this.updateForm('appartementId', null);
    this.updateForm('lot', '');
    this.updateForm('etage', undefined);
  }

  onAppartementChange(docId: string | undefined) {
    const appartement = docId ? this.appartementsOptions().find((a) => a.docId === docId) : undefined;
    if (appartement) {
      const batiment = appartement.batimentDocId
        ? this.batimentsOptions().find((b) => b.docId === appartement.batimentDocId)
        : undefined;
      const residence = appartement.residenceDocId
        ? this.residencesOptions().find((r) => r.docId === appartement.residenceDocId)
        : undefined;
      this.updateForm('residenceId', residence?.docId ?? appartement.residenceDocId ?? undefined);
      this.updateForm('residence', residence?.name || appartement.residenceName || '');
      this.updateForm('batimentId', batiment?.docId ?? appartement.batimentDocId ?? undefined);
      this.updateForm('batiment', batiment?.name || appartement.batimentName || '');
      this.updateForm('lot', appartement.numero);
      this.updateForm('etage', appartement.etage);
      this.updateForm('hasParking',
        Boolean(appartement.hasParking || (appartement.caracteristiques || []).includes('Parking')));
      this.updateForm('hasAscenseur',
        Boolean(appartement.hasAscenseur || (appartement.caracteristiques || []).includes('Ascenseur')));
    } else {
      this.updateForm('appartementId', null);
      this.updateForm('lot', '');
      this.updateForm('hasParking', false);
      this.updateForm('hasAscenseur', false);
    }
    this.updateForm('appartementId', docId ?? null);
  }

  openModal(user?: User) {
    this.detailUser.set(null);
    if (user) {
      const residenceId =
        user.residenceId ||
        (user as any).residenceDocId ||
        this.residencesOptions().find((r) => r.name === user.residence)?.docId ||
        (this.isResidenceAdmin ? this.currentResidenceId || undefined : undefined);
      const batimentId = this.batimentsOptions().find((b) => b.name === user.batiment)?.docId;
      const apt = this.appartementsOptions().find((a) => a.numero === user.lot);
      const appartementId = apt?.docId;
      const hasParking = apt
        ? Boolean(apt.hasParking || (apt.caracteristiques || []).includes('Parking'))
        : Boolean(user.hasParking);
      const hasAscenseur = apt
        ? Boolean(apt.hasAscenseur || (apt.caracteristiques || []).includes('Ascenseur'))
        : Boolean(user.hasAscenseur);
      const roles = this.rolesOf(user);
      this.editingId.set(user.id);
      this.form.set({
        ...user,
        hasParking,
        hasAscenseur,
        roles,
        role: roles[0],
        residenceId,
        batimentId,
        appartementId,
        date_entree: user.date_entree || '',
        date_sortie: user.date_sortie || '',
        password: '',
        autoPassword: false,
        passwordVisible: false,
      });
    } else {
      this.editingId.set(null);
      this.resetForm();
      if (this.isResidenceAdmin && this.currentResidenceId) {
        this.onResidenceChange(this.currentResidenceId);
      }
    }
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.ascenseurWarning.set(null);
    this.resetForm();
  }

  openDetail(user: User) {
    this.detailUser.set(user);
  }

  closeDetail() {
    this.detailUser.set(null);
  }

  toggleAscenseur() {
    const willEnable = !this.form().hasAscenseur;
    if (willEnable) {
      const batId = this.form().batimentId;
      const bat = batId ? this.batimentsOptions().find(b => b.docId === batId) : undefined;
      if (bat && !bat.hasElevator) {
        this.ascenseurWarning.set(`Le bâtiment "${bat.name}" ne dispose pas d'ascenseur. Vérifiez la configuration du bâtiment.`);
      } else {
        this.ascenseurWarning.set(null);
      }
    } else {
      this.ascenseurWarning.set(null);
    }
    this.updateForm('hasAscenseur', willEnable);
  }

  updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    this.form.update((current) => ({ ...current, [key]: value }));
  }

  async saveUser() {
    const data = this.form();
    const name = (data.name || '').trim();
    const email = (data.email || '').trim();
    if (!name || !email) {
      window.alert('Nom et email sont requis.');
      return;
    }

    // ✅ CORRIGÉ: Validation uniquement pour ADMIN_RESIDENCE
    const roles = data.roles || [];
    if (this.isResidenceAdmin && roles.some((r) => r === 'ADMIN')) {
      window.alert('Un admin de résidence ne peut pas attribuer un rôle administrateur global.');
      return;
    }

    if (roles.includes('ADMIN_RESIDENCE') && !data.residenceId) {
      window.alert('Pour un administrateur de résidence, vous devez sélectionner une résidence.');
      return;
    }

    const password = data.password || '';
    if (!this.editingId() && !password && !data.autoPassword) {
      window.alert('Mot de passe requis.');
      return;
    }

    if (data.appartementId) {
      const conflict = this.users().find(
        (u) => u.appartementId === data.appartementId && String(u.id) !== String(this.editingId())
      );
      if (conflict) {
        window.alert(`Cet appartement est déjà attribué à "${conflict.name}". Chaque appartement ne peut avoir qu'un seul utilisateur.`);
        return;
      }
    }

    const finalPassword = this.editingId()
      ? undefined
      : (data.autoPassword ? this.generatePassword() : password);

    const primaryRole = roles[0] || 'COPROPRIETAIRE';

    const existing = this.editingId()
      ? this.users().find((u) => String(u.id) === String(this.editingId()))
      : undefined;

    const payload: User = {
      id: this.editingId() ?? this.nextId(),
      name,
      email,
      roles,
      role: primaryRole,
      status: (data.status as UserStatus) || 'active',
      phone: data.phone?.trim() || '',
      residence: data.residence?.trim() || '',
      residenceId: data.residenceId, // Important pour ADMIN_RESIDENCE, ignoré pour ADMIN
      batiment: data.batiment?.trim() || '',
      lot: data.lot?.trim() || '',
      etage: data.etage,
      hasParking: data.hasParking,
      hasAscenseur: data.hasAscenseur,
      date_entree: data.date_entree || '',
      date_sortie: data.date_sortie || '',
      createdAt: data.createdAt || new Date().toISOString(),
      fullname: data.fullname || name,
      availableRoles: roles,
      firebaseUid: existing?.firebaseUid,
      appartementId: data.appartementId ?? existing?.appartementId ?? null,
    };

    if (this.isResidenceAdmin && this.currentResidenceId) {
      const ownResidence = this.residencesOptions().find((r) => r.docId === this.currentResidenceId);
      payload.residenceId = this.currentResidenceId;
      payload.residence = ownResidence?.name || payload.residence || '';
    }

    try {
      if (this.editingId()) {
        const updated = await this.userService.updateAndPersist(this.editingId()!, payload);
        if (!updated) {
          window.alert('Utilisateur introuvable.');
          return;
        }
      } else {
        const created = await this.userService.createAndPersist({ ...payload, password: finalPassword! });
        if (data.appartementId) {
          try {
            await this.appartementService.updateAppartement(data.appartementId, { statut: 'occupé' as any });
            const appartements = await this.appartementService.loadAppartements();
            this.appartementsOptions.set(appartements);
          } catch (e) {
            console.error('Impossible de mettre à jour le statut de l\'appartement', e);
          }
        }
      }
      
      this.users.set(this.userService.getAll());
      this.closeModal();
      window.alert(this.editingId() ? 'Utilisateur mis à jour.' : 'Utilisateur créé.');
    } catch (err) {
      console.error(err);
      window.alert('Opération impossible: ' + (err as Error).message);
    }
  }

  async deleteUser(id: User['id']) {
    if (String(id) === this.currentUserId) {
      window.alert('Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    const ok = window.confirm('Supprimer cet utilisateur ?');
    if (!ok) return;
    try {
      const done = await this.userService.deleteAndPersist(id);
      if (!done) {
        window.alert('Utilisateur introuvable.');
        return;
      }
      this.users.set(this.userService.getAll());
    } catch (err) {
      console.error(err);
      window.alert('Suppression impossible: ' + (err as Error).message);
    }
  }

  async toggleStatus(user: User) {
    const newStatus: UserStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await this.userService.updateAndPersist(user.id, { status: newStatus });
      this.users.set(this.userService.getAll());
    } catch (err) {
      console.error(err);
      window.alert('Changement de statut impossible: ' + (err as Error).message);
    }
  }

  private resetForm() {
    this.form.set({
      name: '',
      email: '',
      roles: ['COPROPRIETAIRE'],
      role: 'COPROPRIETAIRE',
      status: 'active',
      phone: '',
      residence: '',
      batiment: '',
      lot: '',
      etage: undefined,
      hasParking: false,
      hasAscenseur: false,
      password: '',
      autoPassword: true,
      passwordVisible: false,
      residenceId: undefined,
      batimentId: undefined,
      appartementId: null,
      date_entree: '',
      createdAt: new Date().toISOString(),
    });
    if (this.isResidenceAdmin && this.currentResidenceId) {
      const ownResidence = this.residencesOptions().find((r) => r.docId === this.currentResidenceId);
      this.form.update((current) => ({
        ...current,
        residenceId: this.currentResidenceId || undefined,
        residence: ownResidence?.name || '',
      }));
    }
  }

  generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.updateForm('password', res);
    this.updateForm('autoPassword', false);
    this.updateForm('passwordVisible', true);
    return res;
  }

  private nextId() {
    const ids = this.users()
      .map((u) => (typeof u.id === 'number' ? u.id : Number.parseInt(String(u.id), 10)))
      .filter((id) => Number.isFinite(id)) as number[];
    return ids.length ? Math.max(...ids) + 1 : 1;
  }

  private rolesOf(user: User): UserRole[] {
    if (user.roles?.length) {
      return user.roles;
    }
    return user.role ? [user.role] : [];
  }

  formatDate(value: User['createdAt'], format: string): string {
    if (value === null || value === undefined) {
      return '—';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return this.datePipe.transform(date, format, undefined, 'fr') ?? '—';
  }

  isCurrentUser(user: User): boolean {
    return String(user.id) === this.currentUserId;
  }
}