import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, from, switchMap, catchError, throwError } from 'rxjs';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  onIdTokenChanged,
  getIdToken,
  getIdTokenResult,
  User as FirebaseUser,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { firebaseConfig } from '../../../environments/firebase';
import { User, UserRole } from '../../models/user.model';

export interface LoginResult {
  token: string;
  user: User;
  requiresRoleSelection?: boolean;
}

const SESSION_MAX_MS = 60 * 60 * 1000;
const TOKEN_CHECK_INTERVAL_MS = 60 * 1000;

@Injectable({ providedIn: 'root' })
export class Auth implements OnDestroy {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly auth = getAuth(this.app);
  private readonly db = getFirestore(this.app);

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  private initializedSubject = new BehaviorSubject<boolean>(false);
  public initialized$ = this.initializedSubject.asObservable();

  private loginTimestamp: number | null = null;
  private tokenCheckTimer: ReturnType<typeof setInterval> | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubTokenChanged: (() => void) | null = null;
  private loggingOut = false;

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  constructor(private router: Router, private ngZone: NgZone) {
    onAuthStateChanged(this.auth, async (fbUser) => {
      if (!fbUser) {
        this.clearTimers();
        this.currentUserSubject.next(null);
        this.initializedSubject.next(true);
        return;
      }
      const profile = await this.fetchUserProfile(fbUser);
      this.currentUserSubject.next(profile);
      this.initializedSubject.next(true);
      if (!this.tokenCheckTimer) {
        this.startTokenExpirationMonitor();
      }
    });

    this.unsubTokenChanged = onIdTokenChanged(this.auth, async (fbUser) => {
      if (!fbUser && this.currentUserSubject.value && !this.loggingOut) {
        this.ngZone.run(() => this.forceLogout('Session expirée'));
      }
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.unsubTokenChanged?.();
  }

  login(email: string, password: string): Observable<LoginResult> {
    return from(signInWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap(async (cred) => {
        const fbUser = cred.user;
        const token = await getIdToken(fbUser, true);
        const profile = await this.fetchUserProfile(fbUser);

        const requiresRoleSelection = (profile.availableRoles?.length || 0) > 1;

        this.currentUserSubject.next(profile);
        this.loginTimestamp = Date.now();
        this.startTokenExpirationMonitor();
        this.startSessionTimer();

        return { token, user: profile, requiresRoleSelection };
      }),
      catchError((err) => throwError(() => new Error(this.mapFirebaseError(err))))
    );
  }

  selectRole(role: UserRole): Observable<User> {
    return from(this.setSelectedRole(role)).pipe(
      catchError((err) => throwError(() => new Error(this.mapFirebaseError(err))))
    );
  }

  logout(): void {
    this.loggingOut = true;
    this.clearTimers();
    signOut(this.auth).finally(() => {
      this.currentUserSubject.next(null);
      this.loginTimestamp = null;
      this.loggingOut = false;
      this.router.navigate(['/auth/login']);
    });
  }

  async forgotPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (err) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  isAuthenticated(): boolean {
    return !!this.auth.currentUser;
  }

  private async setSelectedRole(role: UserRole): Promise<User> {
    const fbUser = this.auth.currentUser;
    if (!fbUser) throw new Error('Utilisateur non authentifié');

    const profile = await this.fetchUserProfile(fbUser);
    if (!profile.availableRoles?.includes(role)) {
      throw new Error('Rôle invalide pour cet utilisateur');
    }

    await updateDoc(doc(this.db, 'users', fbUser.uid), { selectedRole: role });
    const updated: User = { ...profile, role };
    this.currentUserSubject.next(updated);
    return updated;
  }

  private async fetchUserProfile(fbUser: FirebaseUser): Promise<User> {
    const ref = doc(this.db, 'users', fbUser.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const fallbackName = fbUser.displayName || fbUser.email || 'Utilisateur';
      const defaultRole: UserRole = 'COPROPRIETAIRE';
      await setDoc(
        ref,
        {
          email: fbUser.email,
          fullname: fallbackName,
          name: fallbackName,
          availableRoles: [defaultRole],
          roles: [defaultRole],
          selectedRole: defaultRole,
          status: 'active',
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return {
        id: fbUser.uid,
        firebaseUid: fbUser.uid,
        email: fbUser.email || '',
        fullname: fallbackName,
        name: fallbackName,
        roles: [defaultRole],
        role: defaultRole,
        availableRoles: [defaultRole],
        status: 'active',
        residenceId: undefined,
        residence: undefined,
        batiment: undefined,
        lot: undefined,
        phone: undefined,
        appartementId: null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        hasParking: false,
        etage: undefined,
      };
    }

    const data = snap.data() as Partial<User> & { availableRoles?: UserRole[]; selectedRole?: UserRole };
    const fallbackName = data.name || data.fullname || fbUser.displayName || fbUser.email || 'Utilisateur';
    const roles: UserRole[] = Array.isArray(data.roles) && data.roles.length
      ? (data.roles as UserRole[])
      : data.selectedRole
        ? [data.selectedRole]
        : ['COPROPRIETAIRE'];
    const role = data.role || data.selectedRole || roles[0];
    const status = data.status || 'active';

    return {
      id: fbUser.uid,
      firebaseUid: fbUser.uid,
      email: fbUser.email || '',
      fullname: fallbackName,
      name: fallbackName,
      role,
      roles,
      availableRoles: data.availableRoles || roles,
      status,
      residenceId: data.residenceId,
      residence: data.residence,
      batiment: data.batiment,
      lot: data.lot,
      phone: data.phone,
      appartementId: data.appartementId ?? null,
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
      hasParking: data.hasParking,
      etage: data.etage,
    };
  }

  private startTokenExpirationMonitor(): void {
    this.stopTokenCheckTimer();
    this.tokenCheckTimer = setInterval(() => {
      this.checkTokenValidity();
    }, TOKEN_CHECK_INTERVAL_MS);
  }

  private startSessionTimer(): void {
    this.stopSessionTimer();
    this.sessionTimer = setTimeout(() => {
      this.ngZone.run(() => this.forceLogout('Votre session a expiré après 1 heure. Veuillez vous reconnecter.'));
    }, SESSION_MAX_MS);
  }

  private async checkTokenValidity(): Promise<void> {
    const fbUser = this.auth.currentUser;
    if (!fbUser) {
      this.ngZone.run(() => this.forceLogout('Session expirée'));
      return;
    }
    try {
      const result = await getIdTokenResult(fbUser);
      const expirationTime = new Date(result.expirationTime).getTime();
      const now = Date.now();
      if (now >= expirationTime) {
        try {
          await getIdToken(fbUser, true);
        } catch {
          this.ngZone.run(() => this.forceLogout('Votre token a expiré et ne peut pas être renouvelé.'));
        }
      }
    } catch {
      this.ngZone.run(() => this.forceLogout('Impossible de vérifier votre session.'));
    }
  }

  async getTokenRemainingSeconds(): Promise<number> {
    const fbUser = this.auth.currentUser;
    if (!fbUser) return 0;
    try {
      const result = await getIdTokenResult(fbUser);
      const expirationTime = new Date(result.expirationTime).getTime();
      return Math.max(0, Math.floor((expirationTime - Date.now()) / 1000));
    } catch {
      return 0;
    }
  }

  async isTokenExpired(): Promise<boolean> {
    return (await this.getTokenRemainingSeconds()) <= 0;
  }

  private forceLogout(message: string): void {
    if (this.loggingOut) return;
    this.loggingOut = true;
    console.warn('[Auth]', message);
    this.clearTimers();
    signOut(this.auth).finally(() => {
      this.currentUserSubject.next(null);
      this.loginTimestamp = null;
      this.loggingOut = false;
      this.router.navigate(['/auth/login'], { queryParams: { sessionExpired: 'true' } });
    });
  }

  private clearTimers(): void {
    this.stopTokenCheckTimer();
    this.stopSessionTimer();
  }

  private stopTokenCheckTimer(): void {
    if (this.tokenCheckTimer) {
      clearInterval(this.tokenCheckTimer);
      this.tokenCheckTimer = null;
    }
  }

  private stopSessionTimer(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  private mapFirebaseError(error: unknown): string {
    const code = (error as { code?: string })?.code || '';
    switch (code) {
      case 'auth/user-not-found':
        return 'Aucun compte trouvé pour cet email';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Identifiants incorrects';
      case 'auth/invalid-email':
        return 'Adresse email invalide';
      case 'auth/too-many-requests':
        return 'Trop de tentatives, réessayez plus tard';
      case 'auth/network-request-failed':
        return 'Erreur réseau, vérifiez votre connexion';
      case 'auth/operation-not-allowed':
        return 'Opération non autorisée. Vérifiez la configuration Firebase.';
      default:
        return 'Erreur d\'authentification';
    }
  }
}