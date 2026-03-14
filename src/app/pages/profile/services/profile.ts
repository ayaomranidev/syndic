import { Injectable } from '@angular/core';
import { getApps, getApp, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  User as FirebaseUser,
  getAuth,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { User, UserRole, UserStatus } from '../../../models/user.model';

export interface UpdateProfilePayload {
  fullname: string;
  email: string;
  phone?: string;
  residence?: string;
  batiment?: string;
  lot?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly auth = getAuth(this.app);
  private readonly db = getFirestore(this.app);

  async loadProfile(): Promise<User> {
    const fbUser = this.requireAuth();
    const ref = doc(this.db, 'users', fbUser.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const seed = {
        email: fbUser.email || '',
        fullname: fbUser.displayName || fbUser.email || 'Utilisateur',
        createdAt: serverTimestamp(),
      };
      await setDoc(ref, seed, { merge: true });
      return this.buildUserFromFirebase(fbUser, { ...seed, createdAt: new Date() });
    }

    const data = snap.data() as Partial<User>;
    return this.buildUserFromFirebase(fbUser, data);
  }

  async updateProfile(payload: UpdateProfilePayload): Promise<User> {
    const fbUser = this.requireAuth();
    const ref = doc(this.db, 'users', fbUser.uid);

    if (payload.email && payload.email !== fbUser.email) {
      await updateEmail(fbUser, payload.email);
    }

    await updateDoc(ref, {
      fullname: payload.fullname,
      phone: payload.phone || null,
      residence: payload.residence || null,
      batiment: payload.batiment || null,
      lot: payload.lot || null,
      updatedAt: serverTimestamp(),
    });

    return this.buildUserFromFirebase(fbUser, payload);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const fbUser = this.requireAuth();
    const credential = EmailAuthProvider.credential(fbUser.email ?? '', currentPassword);
    await reauthenticateWithCredential(fbUser, credential);
    await updatePassword(fbUser, newPassword);
  }

  private requireAuth(): FirebaseUser {
    const fbUser = this.auth.currentUser;
    if (!fbUser) throw new Error('Utilisateur non authentifié');
    return fbUser;
  }

  private buildUserFromFirebase(fbUser: FirebaseUser, data: Partial<User>): User {
    const fallbackRole: UserRole = (data.role as UserRole) || 'COPROPRIETAIRE';
    const roles: UserRole[] = Array.isArray(data.roles) && data.roles.length
      ? data.roles as UserRole[]
      : [fallbackRole];

    return {
      id: fbUser.uid,
      email: data.email || fbUser.email || '',
      fullname: data.fullname || fbUser.displayName || fbUser.email || 'Utilisateur',
      name: data.name || data.fullname || fbUser.displayName || fbUser.email || 'Utilisateur',
      role: data.role,
      availableRoles: data.availableRoles,
      roles,
      residence: data.residence,
      batiment: data.batiment,
      lot: data.lot,
      phone: data.phone,
      appartementId: data.appartementId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      status: (data.status as UserStatus) || 'active',
      hasParking: data.hasParking,
      etage: data.etage,
      firebaseUid: fbUser.uid,
      residenceId: data.residenceId,  // ✅ Ajout de residenceId
    };
  }
}