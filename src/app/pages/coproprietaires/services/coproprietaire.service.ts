import { Injectable } from '@angular/core';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  getFirestore, doc, setDoc, deleteDoc,
  collection, getDocs, getDoc,
} from 'firebase/firestore';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { firebaseConfig } from '../../../../environments/firebase';
import {
  User as ModelUser,
  UserRole as ModelUserRole,
  UserStatus as ModelUserStatus,
  UserStats as ModelUserStats,
} from '../../../models/user.model';

export type UserRole    = ModelUserRole;
export type UserStatus  = ModelUserStatus;
export type UserStats   = ModelUserStats;
export type User        = ModelUser;

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly app       = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly adminApp: FirebaseApp = this.ensureAdminApp();
  private readonly auth      = getAuth(this.app);
  private readonly adminAuth = getAuth(this.adminApp);
  private readonly db        = getFirestore(this.app);

  private data: User[] = [];

  getAll(): User[] {
    return [...this.data];
  }

  // ==========================================================================
  // LECTURE
  // ==========================================================================

  async loadFromFirestore(): Promise<User[]> {
    const snapshot = await getDocs(collection(this.db, 'users'));
    const users: User[] = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Partial<User> & { selectedRole?: UserRole };
      const legacyResidenceDocId = (data as any).residenceDocId as string | undefined;
      const roles = this.normalizeRoles(data.selectedRole ?? data.role, data.availableRoles ?? data.roles);
      const primaryRole = roles[0];
      const name = data.name || data.fullname || data.email || 'Utilisateur';
      return {
        id:             docSnap.id,
        firebaseUid:    docSnap.id,
        name,
        fullname:       data.fullname        || name,
        email:          data.email           || '',
        roles,
        role:           primaryRole,
        status:         data.status          || 'active',
        phone:          data.phone           || '',
        residenceId:    data.residenceId     || legacyResidenceDocId,
        residence:      data.residence       || '',
        batiment:       data.batiment        || '',
        lot:            data.lot             || '',
        etage:          data.etage           ?? undefined,
        hasParking:     data.hasParking      ?? false,
        hasAscenseur:   data.hasAscenseur    ?? false,
        appartementId:  data.appartementId   ?? null,
        date_entree:    data.date_entree     || '',
        date_sortie:    data.date_sortie     || '',
        createdAt:      data.createdAt       ?? null,
        updatedAt:      data.updatedAt       ?? null,
        availableRoles: data.availableRoles  ?? roles,
      } satisfies User;
    });
    this.data = users;
    return this.getAll();
  }

  async getById(id: string): Promise<User | null> {
    try {
      const ref  = doc(this.db, 'users', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const data = snap.data() as Partial<User>;
      const legacyResidenceDocId = (data as any).residenceDocId as string | undefined;
      const roles = this.normalizeRoles(data.role, data.roles);
      const name  = data.name || data.fullname || data.email || 'Utilisateur';
      return {
        id:             snap.id,
        firebaseUid:    snap.id,
        name,
        fullname:       data.fullname        || name,
        email:          data.email           || '',
        roles,
        role:           roles[0],
        status:         data.status          || 'active',
        phone:          data.phone           || '',
        residenceId:    data.residenceId     || legacyResidenceDocId,
        residence:      data.residence       || '',
        batiment:       data.batiment        || '',
        lot:            data.lot             || '',
        etage:          data.etage           ?? undefined,
        hasParking:     data.hasParking      ?? false,
        hasAscenseur:   data.hasAscenseur    ?? false,
        appartementId:  data.appartementId   ?? null,
        date_entree:    data.date_entree     || '',
        date_sortie:    data.date_sortie     || '',
        createdAt:      data.createdAt       ?? null,
        updatedAt:      data.updatedAt       ?? null,
        availableRoles: data.availableRoles  ?? roles,
      } satisfies User;
    } catch (error) {
      console.error('❌ Erreur getById:', error);
      return null;
    }
  }

  // ==========================================================================
  // CRÉATION (locale uniquement)
  // ==========================================================================

  create(payload: Partial<User>): User {
    const roles = this.normalizeRoles(payload.role, payload.roles);
    const user: User = {
      id:             payload.id            ?? this.nextId(),
      name:           payload.name          || 'Nouvel utilisateur',
      email:          payload.email         || 'email@exemple.com',
      roles,
      role:           roles[0],
      status:         payload.status        || 'active',
      phone:          payload.phone,
      residence:      payload.residence,
      batiment:       payload.batiment,
      lot:            payload.lot,
      createdAt:      payload.createdAt     || new Date().toISOString(),
      fullname:       payload.fullname      || payload.name,
      hasParking:     payload.hasParking    ?? false,
      hasAscenseur:   payload.hasAscenseur  ?? false,
      availableRoles: payload.availableRoles ?? roles,
      firebaseUid:    payload.firebaseUid,
      appartementId:  payload.appartementId ?? null,
      date_entree:    payload.date_entree   || '',
      date_sortie:    payload.date_sortie   || '',
    };
    this.data = [user, ...this.data];
    return user;
  }

  // ==========================================================================
  // CRÉATION Firebase Auth + Firestore
  // ==========================================================================

  async createAndPersist(payload: Partial<User> & { password: string }): Promise<User> {
    const email       = payload.email  || 'email@exemple.com';
    const name        = payload.name   || 'Nouvel utilisateur';
    const roles       = this.normalizeRoles(payload.role, payload.roles);
    const primaryRole = roles[0];
    const status      = payload.status || 'active';
    const password    = payload.password;

    const cred = await createUserWithEmailAndPassword(this.adminAuth, email, password);
    const uid  = cred.user.uid;

    const profileDoc: Record<string, any> = {
      email,
      fullname:       name,
      name,
      availableRoles: roles,
      selectedRole:   primaryRole,
      status,
      phone:          payload.phone        || '',
      residence:      payload.residence    || '',
      residenceName:  payload.residence    || '',
      batiment:       payload.batiment     || '',
      lot:            payload.lot          || '',
      etage:          payload.etage        ?? null,
      hasParking:     payload.hasParking   ?? false,
      hasAscenseur:   payload.hasAscenseur ?? false,
      createdAt:      payload.createdAt    || new Date().toISOString(),
      roles,
      date_entree:    payload.date_entree  || '',
      date_sortie:    payload.date_sortie  || '',
    };

    // CORRECTION : n'écrire residenceId/residenceDocId que si une valeur est présente.
    // Évite d'écrire null dans Firestore et de bloquer la règle canManageUserData.
    if (payload.residenceId) {
      profileDoc['residenceId']    = payload.residenceId;
      profileDoc['residenceDocId'] = payload.residenceId;
    }

    await setDoc(doc(this.db, 'users', uid), profileDoc, { merge: true });
    await signOut(this.adminAuth);

    const user: User = {
      id:             uid,
      firebaseUid:    uid,
      name,
      email,
      roles,
      role:           primaryRole,
      status,
      phone:          profileDoc['phone'],
      residence:      profileDoc['residence'],
      residenceId:    profileDoc['residenceId'] || undefined,
      batiment:       profileDoc['batiment'],
      lot:            profileDoc['lot'],
      etage:          profileDoc['etage']        || undefined,
      hasParking:     profileDoc['hasParking'],
      hasAscenseur:   profileDoc['hasAscenseur'],
      createdAt:      profileDoc['createdAt'],
      fullname:       name,
      availableRoles: roles,
      date_entree:    profileDoc['date_entree'],
      date_sortie:    profileDoc['date_sortie'],
    };

    this.data = [user, ...this.data];
    return user;
  }

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * CORRECTION : updateAndPersist n'écrase plus residenceId par null.
   *
   * Problème précédent :
   *   residenceId: updated.residenceId || null
   *   → si updated.residenceId est undefined, écrit null dans Firestore.
   *   → la règle Firestore canManageUserData(resource.data) lit null → REFUS.
   *
   * Fix :
   *  - On ne met à jour residenceId/residenceDocId que si une valeur est disponible.
   *  - Si l'utilisateur n'a pas de residenceId (legacy), on ne touche pas à ce champ.
   */
  async updateAndPersist(id: number | string, patch: Partial<User>): Promise<User | undefined> {
    const idx = this.data.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return undefined;

    const existing = this.data[idx];
    const roles     = this.normalizeRoles(patch.role ?? existing.role, patch.roles ?? existing.roles);
    const updated: User = { ...existing, ...patch, roles, role: roles[0] };
    this.data[idx] = updated;

    if (updated.firebaseUid) {
      const profileDoc: Record<string, any> = {
        email:          updated.email           || '',
        fullname:       updated.name,
        name:           updated.name,
        availableRoles: updated.roles,
        selectedRole:   updated.role,
        status:         updated.status,
        phone:          updated.phone           || '',
        residence:      updated.residence       || '',
        residenceName:  updated.residence       || '',
        batiment:       updated.batiment        || '',
        lot:            updated.lot             || '',
        etage:          updated.etage           ?? null,
        hasParking:     updated.hasParking      ?? false,
        hasAscenseur:   updated.hasAscenseur    ?? false,
        roles:          updated.roles,
        date_entree:    updated.date_entree     || '',
        date_sortie:    updated.date_sortie     || '',
        updatedAt:      new Date().toISOString(),
      };

      // CORRECTION : n'écrire residenceId/residenceDocId que si une valeur est présente.
      // Cela évite d'écrire null sur un utilisateur qui n'avait pas de résidence,
      // ce qui bloquerait la règle Firestore lors du prochain update.
      const effectiveResidenceId = updated.residenceId || (updated as any).residenceDocId;
      if (effectiveResidenceId) {
        profileDoc['residenceId']    = effectiveResidenceId;
        profileDoc['residenceDocId'] = effectiveResidenceId;
      }

      // Si l'appartementId est défini, l'inclure aussi
      if (updated.appartementId !== undefined) {
        profileDoc['appartementId'] = updated.appartementId;
      }

      await setDoc(doc(this.db, 'users', updated.firebaseUid), profileDoc, { merge: true });
    }

    return updated;
  }

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  async deleteAndPersist(id: number | string): Promise<boolean> {
    const user = this.data.find((u) => String(u.id) === String(id));
    if (!user) return false;

    this.data = this.data.filter((u) => String(u.id) !== String(id));

    if (user.firebaseUid) {
      await deleteDoc(doc(this.db, 'users', user.firebaseUid));
    }

    return true;
  }

  // ==========================================================================
  // MÉTHODES LOCALES (sans Firestore)
  // ==========================================================================

  update(id: number | string, patch: Partial<User>): User | undefined {
    const idx = this.data.findIndex((u) => String(u.id) === String(id));
    if (idx === -1) return undefined;
    const existing = this.data[idx];
    const roles     = this.normalizeRoles(patch.role ?? existing.role, patch.roles ?? existing.roles);
    this.data[idx]  = { ...existing, ...patch, roles, role: roles[0] };
    return this.data[idx];
  }

  delete(id: number | string): boolean {
    const before = this.data.length;
    this.data = this.data.filter((u) => String(u.id) !== String(id));
    return this.data.length < before;
  }

  toggleStatus(id: number | string): User | undefined {
    const user = this.data.find((u) => String(u.id) === String(id));
    if (!user) return undefined;
    user.status = user.status === 'active' ? 'inactive' : 'active';
    return user;
  }

  getStats(): UserStats {
    const total = this.data.length;
    return {
      total,
      actifs:          this.data.filter((u) => u.status === 'active').length,
      adminResidences: this.data.filter((u) => this.hasRole(u, 'ADMIN_RESIDENCE')).length,
      admins:          this.data.filter((u) => this.hasRole(u, 'ADMIN')).length,
      coproprietaires: this.data.filter((u) => this.hasRole(u, 'COPROPRIETAIRE')).length,
      locataires:      this.data.filter((u) => this.hasRole(u, 'LOCATAIRE')).length,
    };
  }

  // ==========================================================================
  // MÉTHODES PRIVÉES
  // ==========================================================================

  private normalizeRoles(primary?: UserRole, roles?: UserRole[] | unknown): UserRole[] {
    const asArray  = Array.isArray(roles) ? roles.filter(Boolean) as UserRole[] : [];
    const selected = primary ?? asArray[0];
    const merged   = selected ? [selected, ...asArray] : asArray;
    const unique   = Array.from(new Set(merged));
    return unique.length ? unique : ['COPROPRIETAIRE'];
  }

  private hasRole(user: User, role: UserRole) {
    return user.roles?.includes(role) || user.role === role;
  }

  private nextId(): number {
    const numericIds = this.data
      .map((u) => (typeof u.id === 'number' ? u.id : Number.parseInt(String(u.id), 10)))
      .filter((id) => Number.isFinite(id)) as number[];
    return numericIds.length ? Math.max(...numericIds) + 1 : 1;
  }

  private ensureAdminApp(): FirebaseApp {
    const existing = getApps().find((candidate) => candidate.name === 'admin');
    if (existing) return existing;
    return initializeApp(firebaseConfig, 'admin');
  }
}