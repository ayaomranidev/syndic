/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  fcm.service.ts                                             ║
 * ║  Firebase Cloud Messaging — Push Notifications              ║
 * ║  Gère le token FCM, permissions, et réception foreground    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import { Injectable, signal, computed } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  onMessage,
  Messaging,
} from 'firebase/messaging';
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { firebaseConfig, VAPID_KEY } from '../../../../environments/firebase';

// ── La clé VAPID est définie dans environments/firebase.ts ──

export interface FcmToken {
  token: string;
  userId: string;
  createdAt: any;
  userAgent: string;
  lastUsed: any;
}

@Injectable({ providedIn: 'root' })
export class FcmService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private messaging: Messaging | null = null;

  // ── Signals ───────────────────────────────────────────────────────────────
  private readonly _token        = signal<string | null>(null);
  private readonly _permission   = signal<NotificationPermission>('default');
  private readonly _lastMessage  = signal<any>(null);

  readonly token       = this._token.asReadonly();
  readonly permission  = this._permission.asReadonly();
  readonly lastMessage = this._lastMessage.asReadonly();
  readonly isSupported = computed(() => 'Notification' in window && 'serviceWorker' in navigator);

  // ── Initialiser le messaging ──────────────────────────────────────────────

  /**
   * Appeler cette méthode au démarrage de l'app (après login).
   * Elle demande la permission, récupère le token et écoute les messages foreground.
   */
  async init(userId: string): Promise<string | null> {
    if (!this.isSupported()) {
      console.warn('[FCM] Push notifications non supportées sur ce navigateur');
      return null;
    }

    try {
      // 1. Enregistrer le service worker
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[FCM] Service Worker enregistré:', registration.scope);

      // 2. Initialiser Firebase Messaging
      this.messaging = getMessaging(this.app);

      // 3. Demander permission
      const permission = await Notification.requestPermission();
      this._permission.set(permission);

      if (permission !== 'granted') {
        console.warn('[FCM] Permission refusée');
        return null;
      }

      // 4. Obtenir le token FCM
      const token = await getToken(this.messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        this._token.set(token);
        console.log('[FCM] Token obtenu:', token.substring(0, 20) + '...');

        // 5. Sauvegarder le token dans Firestore
        await this.saveToken(token, userId);

        // 6. Écouter les messages en premier plan (foreground)
        this.listenForegroundMessages();
      }

      return token;
    } catch (err) {
      console.error('[FCM] Erreur initialisation:', err);
      return null;
    }
  }

  // ── Sauvegarder le token dans Firestore ───────────────────────────────────

  /**
   * Collection `fcm_tokens` — chaque document = un token par device/navigateur.
   * Structure : { token, userId, createdAt, userAgent, lastUsed }
   */
  private async saveToken(token: string, userId: string): Promise<void> {
    const tokenDoc = doc(this.db, 'fcm_tokens', token);
    await setDoc(tokenDoc, {
      token,
      userId,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      lastUsed:  serverTimestamp(),
    }, { merge: true });
  }

  // ── Supprimer le token (lors du logout) ───────────────────────────────────

  async removeToken(): Promise<void> {
    const currentToken = this._token();
    if (currentToken) {
      try {
        await deleteDoc(doc(this.db, 'fcm_tokens', currentToken));
        this._token.set(null);
        console.log('[FCM] Token supprimé');
      } catch (err) {
        console.error('[FCM] Erreur suppression token:', err);
      }
    }
  }

  // ── Récupérer les tokens d'un utilisateur (pour envoyer depuis le serveur) ─

  async getTokensForUser(userId: string): Promise<string[]> {
    const q = query(
      collection(this.db, 'fcm_tokens'),
      where('userId', '==', userId),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data()['token'] as string);
  }

  // ── Écouter les messages en premier plan ──────────────────────────────────

  private listenForegroundMessages(): void {
    if (!this.messaging) return;

    onMessage(this.messaging, (payload) => {
      console.log('[FCM] Message foreground reçu:', payload);
      this._lastMessage.set(payload);

      // Afficher une notification native même en foreground
      const data = payload.notification || payload.data || {};
      if (Notification.permission === 'granted') {
        new Notification(data.title || 'SyndicPro', {
          body: data.body || 'Nouvelle notification',
          icon: '/favicon.ico',
          tag: 'syndic-foreground',
        });
      }
    });
  }

  // ── Vérifier si les notifications push sont activées ──────────────────────

  checkPermission(): NotificationPermission {
    if (!('Notification' in window)) return 'denied';
    const perm = Notification.permission;
    this._permission.set(perm);
    return perm;
  }
}
