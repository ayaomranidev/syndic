/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  alerte.service.ts  — SyndicPro · SERVICE CENTRAL NOTIFICATIONS v2         ║
 * ║  Chemin : src/app/pages/notifications/services/alerte.service.ts           ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  where,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  writeBatch,
  limit,
  getCountFromServer,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { Auth } from '../../../core/services/auth';

// ═══════════════════════════════════════════════════════════════
//  TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export type AlerteType =
  | 'IMPAYÉ'
  | 'BUDGET'
  | 'REUNION'
  | 'DOCUMENT'
  | 'MAINTENANCE'
  | 'SYSTEME'
  | 'VOTE'
  | 'CHARGE'
  | 'RELANCE'
  | 'BIENVENUE';

export type AlertePriorite = 'CRITIQUE' | 'HAUTE' | 'NORMALE' | 'INFO';

export interface Alerte {
  id?: string;
  type: AlerteType;
  priorite: AlertePriorite;
  titre: string;
  message: string;
  destinataireId?: string;
  lue: boolean;
  archivee?: boolean;
  lienLabel?: string;
  lienUrl?: string;
  entityId?: string;
  entityType?: 'paiement' | 'reunion' | 'document' | 'charge' | 'maintenance' | 'budget';
  meta?: Record<string, string | number | boolean>;
  createdAt?: Date | any;
}

// ─── Payloads ────────────────────────────────────────────────

export interface PayloadPaiementValide {
  destinataireId: string;
  paiementId: string;
  montant: number;
  payerName: string;
  mois?: string;
}

export interface PayloadPaiementRetard {
  destinataireId: string;
  paiementId: string;
  montant: number;
  dateEcheance: string;
  payerName: string;
  moisRetard?: number;
}

export interface PayloadPaiementPartiel {
  destinataireId: string;
  paiementId: string;
  montantTotal: number;
  montantPaye: number;
  payerName: string;
}

export interface PayloadPaiementRejete {
  destinataireId: string;
  paiementId: string;
  montant: number;
  payerName: string;
  motifRejet?: string;
}

export interface PayloadRelance {
  destinataireId: string;
  paiementId: string;
  montant: number;
  payerName: string;
  moisRetard?: number;
  message?: string;
  typeRelance: 'doux' | 'ferme' | 'urgent';
}

export interface PayloadNouvelleCharge {
  chargeId: string;
  chargeLibelle: string;
  chargeType: 'FIXE' | 'VARIABLE' | 'TRAVAUX';
  montant: number;
  destinatairesIds: string[];
  notifIndividuelle: boolean;
}

export interface PayloadReunion {
  reunionId: string;
  titre: string;
  dateReunion: string;
  lieu: string;
  typeReunion?: string;
  participantIds: string[];
  notifierTous?: boolean;
  ordre?: string;
}

export interface PayloadDocument {
  documentId: string;
  nomDocument: string;
  categorie: string;
  uploadePar: string;
  destinatairesIds?: string[];
  lienUrl?: string;
}

export interface PayloadMaintenance {
  maintenanceId: string;
  titre: string;
  description?: string;
  priorite: AlertePriorite;
  demandeurId?: string;
  technicienId?: string;
  statut?: string;
}

export interface PayloadBudget {
  residenceNom: string;
  budgetTotal: number;
  depensesActuelles: number;
  pourcentage: number;
  annee?: number;
}

// ═══════════════════════════════════════════════════════════════
//  SERVICE
// ═══════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class AlerteService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly COL = 'alertes';
  private readonly auth = inject(Auth);

  // ── Signals réactifs ────────────────────────────────────────
  private readonly _alertesNonLues  = signal<Alerte[]>([]);
  private readonly _loading         = signal(false);
  private _unsubscribe: Unsubscribe | null = null;
  private _retryAttempts = 0;
  private readonly _maxRetryAttempts = 6;
  private readonly _retryDelayMs = 15000; // 15s

  readonly alertesNonLues  = this._alertesNonLues.asReadonly();
  readonly nbNonLues       = computed(() => this._alertesNonLues().length);
  readonly loading         = this._loading.asReadonly();
  readonly hasCritique     = computed(() =>
    this._alertesNonLues().some(a => a.priorite === 'CRITIQUE')
  );

  private getCurrentUserId(): string | undefined {
    const user = this.auth?.currentUser;
    if (user) {
      return user.firebaseUid || String(user.id);
    }

    // Fallback to Firebase Auth in case profile hydration is not finished yet.
    const fbUid = getAuth(this.app).currentUser?.uid;
    return fbUid || undefined;
  }

  private canReadAllAlertes(): boolean {
    const user = this.auth?.currentUser;
    if (!user) return false;
    const roles = user.roles || (user.role ? [user.role] : []);
    return roles.includes('ADMIN');
  }

  private getEffectiveUserId(userId?: string): string | undefined {
    return userId || this.getCurrentUserId();
  }

  // ═══════════════════════════════════════════════════
  //  LECTURE
  // ═══════════════════════════════════════════════════

  async getAll(limitCount = 100): Promise<Alerte[]> {
    const effectiveUserId = this.getEffectiveUserId();
    const constraints: any[] = [orderBy('createdAt', 'desc'), limit(limitCount)];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) return [];
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => this.mapDoc(d));
  }

  async getParDestinataire(userId: string, limitCount = 50): Promise<Alerte[]> {
    const q = query(
      collection(this.db, this.COL),
      where('destinataireId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => this.mapDoc(d));
  }

  async getNonLues(userId?: string): Promise<Alerte[]> {
    const effectiveUserId = this.getEffectiveUserId(userId);
    const constraints: any[] = [where('lue', '==', false), orderBy('createdAt', 'desc')];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) return [];
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    } else if (effectiveUserId) {
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => this.mapDoc(d));
  }

  async countNonLues(userId?: string): Promise<number> {
    const effectiveUserId = this.getEffectiveUserId(userId);
    const constraints: any[] = [where('lue', '==', false)];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) return 0;
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    } else if (effectiveUserId) {
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    const snap = await getCountFromServer(q);
    return snap.data().count;
  }

  // ═══════════════════════════════════════════════════
  //  TEMPS RÉEL (onSnapshot)
  // ═══════════════════════════════════════════════════

  startEcoute(userId?: string): void {
    this.stopEcoute();
    const effectiveUserId = this.getEffectiveUserId(userId);
    const constraints: any[] = [where('lue', '==', false), orderBy('createdAt', 'desc'), limit(50)];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) {
        this._alertesNonLues.set([]);
        return;
      }
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    } else if (effectiveUserId) {
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    this._unsubscribe = onSnapshot(q, (snap) => {
      this._retryAttempts = 0;
      this._alertesNonLues.set(snap.docs.map(d => this.mapDoc(d)));
    }, (err) => {
      console.error('AlerteService.startEcoute onSnapshot error:', err);
      // If index is building, retry a few times with a delay
      if (err && (err.code === 'failed-precondition' || err.message?.includes('requires an index'))) {
        if (this._retryAttempts < this._maxRetryAttempts) {
          this._retryAttempts++;
          console.warn(`Index building — retrying startEcoute in ${this._retryDelayMs}ms (attempt ${this._retryAttempts}/${this._maxRetryAttempts})`);
          setTimeout(() => this.startEcoute(userId), this._retryDelayMs);
        } else {
          console.error('AlerteService: max retry attempts reached for startEcoute');
        }
      }
    });
  }

  stopEcoute(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  ecouterNonLues(callback: (alertes: Alerte[]) => void, userId?: string): Unsubscribe {
    const effectiveUserId = this.getEffectiveUserId(userId);
    const constraints: any[] = [where('lue', '==', false), orderBy('createdAt', 'desc'), limit(50)];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) {
        callback([]);
        return () => {};
      }
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    } else if (effectiveUserId) {
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => this.mapDoc(d)));
    }, (err) => {
      console.error('AlerteService.ecouterNonLues onSnapshot error:', err);
    });
  }

  // ═══════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════

  async marquerLue(id: string): Promise<void> {
    await updateDoc(doc(this.db, this.COL, id), { lue: true });
  }

  async marquerToutesLues(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const batch = writeBatch(this.db);
    ids.forEach(id => batch.update(doc(this.db, this.COL, id), { lue: true }));
    await batch.commit();
  }

  async archiverAlerte(id: string): Promise<void> {
    await updateDoc(doc(this.db, this.COL, id), { lue: true, archivee: true });
  }

  async supprimer(id: string): Promise<void> {
    await deleteDoc(doc(this.db, this.COL, id));
  }

  async supprimerToutesLues(userId?: string): Promise<number> {
    const effectiveUserId = this.getEffectiveUserId(userId);
    const constraints: any[] = [where('lue', '==', true)];
    if (!this.canReadAllAlertes()) {
      if (!effectiveUserId) return 0;
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    } else if (effectiveUserId) {
      constraints.unshift(where('destinataireId', '==', effectiveUserId));
    }
    const q = query(collection(this.db, this.COL), ...constraints);
    const snap = await getDocs(q);
    const batch = writeBatch(this.db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  }

  // ═══════════════════════════════════════════════════
  //  CRÉATION
  // ═══════════════════════════════════════════════════

  async create(data: Omit<Alerte, 'id' | 'createdAt'>): Promise<string> {
    const clean: Record<string, any> = { createdAt: serverTimestamp() };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) clean[k] = v;
    }
    const ref = await addDoc(collection(this.db, this.COL), clean);
    return ref.id;
  }

  private async createBatch(items: Omit<Alerte, 'id' | 'createdAt'>[]): Promise<void> {
    const CHUNK = 400;
    for (let i = 0; i < items.length; i += CHUNK) {
      const batch = writeBatch(this.db);
      items.slice(i, i + CHUNK).forEach(item => {
        const ref = doc(collection(this.db, this.COL));
        const clean: Record<string, any> = { createdAt: serverTimestamp() };
        for (const [k, v] of Object.entries(item)) {
          if (v !== undefined && v !== null) clean[k] = v;
        }
        batch.set(ref, clean);
      });
      await batch.commit();
    }
  }

  // ═══════════════════════════════════════════════════
  //  MÉTHODES SPÉCIFIQUES PAR TYPE
  // ═══════════════════════════════════════════════════

  // ── PAIEMENTS ──
  async alertePaiementValide(p: PayloadPaiementValide): Promise<string> {
    const moisLabel = p.mois ? ` (${p.mois})` : '';
    return this.create({
      type: 'IMPAYÉ', priorite: 'INFO',
      titre: `Paiement confirmé — ${p.payerName}`,
      message: `Votre paiement de ${p.montant.toFixed(2)} DT${moisLabel} a bien été enregistré et validé. Merci !`,
      lienUrl: '/paiements', lienLabel: 'Consulter mes paiements',
      lue: false,
      destinataireId: p.destinataireId,
      entityId: p.paiementId, entityType: 'paiement',
      meta: { montant: p.montant, mois: p.mois ?? '' },
    });
  }

  async alerteRetardPaiement(p: PayloadPaiementRetard): Promise<string> {
    const retardLabel = p.moisRetard && p.moisRetard > 1 ? ` (${p.moisRetard} mois de retard)` : '';
    return this.create({
      type: 'IMPAYÉ', priorite: 'HAUTE',
      titre: `⚠️ Retard de paiement — ${p.payerName}`,
      message: `Le paiement de ${p.montant.toFixed(2)} DT (échéance ${p.dateEcheance}) est en retard${retardLabel}. Veuillez régulariser votre situation.`,
      lienUrl: '/paiements', lienLabel: 'Régulariser',
      lue: false,
      destinataireId: p.destinataireId,
      entityId: p.paiementId, entityType: 'paiement',
      meta: { montant: p.montant, moisRetard: p.moisRetard ?? 1 },
    });
  }

  async alertePaiementPartiel(p: PayloadPaiementPartiel): Promise<string> {
    const reste = p.montantTotal - p.montantPaye;
    return this.create({
      type: 'IMPAYÉ', priorite: 'NORMALE',
      titre: `Paiement partiel reçu — ${p.payerName}`,
      message: `Un paiement partiel de ${p.montantPaye.toFixed(2)} DT a été enregistré. Reste à régler : ${reste.toFixed(2)} DT.`,
      lienUrl: '/paiements', lienLabel: 'Voir le solde',
      lue: false,
      destinataireId: p.destinataireId,
      entityId: p.paiementId, entityType: 'paiement',
      meta: { montantPaye: p.montantPaye, resteAPayer: reste },
    });
  }

  async alertePaiementRejete(p: PayloadPaiementRejete): Promise<string> {
    const motif = p.motifRejet ? ` Motif : "${p.motifRejet}".` : '';
    return this.create({
      type: 'IMPAYÉ', priorite: 'HAUTE',
      titre: `Paiement rejeté — ${p.payerName}`,
      message: `Votre paiement de ${p.montant.toFixed(2)} DT a été rejeté.${motif} Contactez le syndic pour plus d'informations.`,
      lienUrl: '/paiements', lienLabel: 'Voir le paiement',
      lue: false,
      destinataireId: p.destinataireId,
      entityId: p.paiementId, entityType: 'paiement',
    });
  }

  async alerteRelance(p: PayloadRelance): Promise<string> {
    const prioriteMap: Record<PayloadRelance['typeRelance'], AlertePriorite> = {
      doux: 'NORMALE', ferme: 'HAUTE', urgent: 'CRITIQUE',
    };
    const titreMap: Record<PayloadRelance['typeRelance'], string> = {
      doux:   `💌 Rappel de paiement`,
      ferme:  `📋 Relance de paiement`,
      urgent: `🚨 Mise en demeure de paiement`,
    };
    const defaultMsg: Record<PayloadRelance['typeRelance'], string> = {
      doux:   `Vous avez un paiement de ${p.montant.toFixed(2)} DT en attente. Merci de régulariser votre situation prochainement.`,
      ferme:  `Un paiement de ${p.montant.toFixed(2)} DT est toujours en attente${p.moisRetard ? ` depuis ${p.moisRetard} mois` : ''}. Veuillez procéder au règlement dans les plus brefs délais.`,
      urgent: `Malgré nos relances précédentes, votre dette de ${p.montant.toFixed(2)} DT reste impayée. Une action légale peut être engagée sans régularisation immédiate.`,
    };
    return this.create({
      type: 'RELANCE', priorite: prioriteMap[p.typeRelance],
      titre: titreMap[p.typeRelance],
      message: p.message || defaultMsg[p.typeRelance],
      lienUrl: '/paiements', lienLabel: 'Payer maintenant',
      lue: false,
      destinataireId: p.destinataireId,
      entityId: p.paiementId, entityType: 'paiement',
      meta: { typeRelance: p.typeRelance, montant: p.montant },
    });
  }

  async alerteImpayesMensuels(opts: {
    nbImpayees: number;
    totalDu: number;
    adminId?: string;
  }): Promise<string> {
    return this.create({
      type: 'IMPAYÉ', priorite: opts.nbImpayees > 5 ? 'CRITIQUE' : 'HAUTE',
      titre: `Récapitulatif mensuel — ${opts.nbImpayees} impayé(s)`,
      message: `Ce mois, ${opts.nbImpayees} paiement(s) n'ont pas été réglés. Total en attente : ${opts.totalDu.toFixed(2)} DT.`,
      lienUrl: '/paiements', lienLabel: 'Gérer les impayés',
      lue: false,
      destinataireId: opts.adminId,
      meta: { nbImpayees: opts.nbImpayees, totalDu: opts.totalDu },
    });
  }

  // ── CHARGES ──
  async alerteNouvelleCharge(p: PayloadNouvelleCharge): Promise<void> {
    const typeLabel: Record<string, string> = { FIXE: 'fixe', VARIABLE: 'variable', TRAVAUX: 'travaux' };
    const base: Omit<Alerte, 'id' | 'createdAt'> = {
      type: 'CHARGE', priorite: 'NORMALE',
      titre: `Nouvelle charge : ${p.chargeLibelle}`,
      message: `Une charge ${typeLabel[p.chargeType] ?? p.chargeType} de ${p.montant.toFixed(2)} DT a été enregistrée et sera répartie selon vos tantièmes.`,
      lienUrl: '/charges', lienLabel: 'Voir les charges',
      lue: false,
      entityId: p.chargeId, entityType: 'charge',
      meta: { montant: p.montant, chargeType: p.chargeType },
    };

    if (p.notifIndividuelle && p.destinatairesIds.length > 0) {
      await this.createBatch(p.destinatairesIds.map(uid => ({ ...base, destinataireId: uid })));
    } else {
      await this.create(base);
    }
  }

  // ── RÉUNIONS ──
  async alerteNouvelleReunion(p: PayloadReunion): Promise<void> {
    const typeLabel = p.typeReunion ? ` (${p.typeReunion})` : '';
    const base: Omit<Alerte, 'id' | 'createdAt'> = {
      type: 'REUNION', priorite: 'NORMALE',
      titre: `📅 Nouvelle réunion : ${p.titre}`,
      message: `Une réunion${typeLabel} est prévue le ${p.dateReunion} à ${p.lieu}. Votre présence est attendue.${p.ordre ? ` Ordre du jour : ${p.ordre}` : ''}`,
      lienUrl: '/reunions', lienLabel: 'Voir la réunion',
      lue: false,
      entityId: p.reunionId, entityType: 'reunion',
    };

    if (p.notifierTous) {
      await this.create(base);
    } else if (p.participantIds.length > 0) {
      await this.createBatch(p.participantIds.map(uid => ({ ...base, destinataireId: uid })));
    }
  }

  async alerteRappelReunion(p: PayloadReunion): Promise<void> {
    const base: Omit<Alerte, 'id' | 'createdAt'> = {
      type: 'REUNION', priorite: 'HAUTE',
      titre: `⏰ Rappel : "${p.titre}" demain`,
      message: `La réunion "${p.titre}" a lieu demain ${p.dateReunion} à ${p.lieu}. Pensez à préparer vos questions.`,
      lienUrl: '/reunions', lienLabel: 'Détails de la réunion',
      lue: false,
      entityId: p.reunionId, entityType: 'reunion',
    };

    if (p.participantIds.length > 0) {
      await this.createBatch(p.participantIds.map(uid => ({ ...base, destinataireId: uid })));
    } else {
      await this.create(base);
    }
  }

  async alerteStatutReunion(opts: {
    reunionId: string;
    titre: string;
    nouveauStatut: string;
    participantIds?: string[];
  }): Promise<void> {
    const statusLabel: Record<string, string> = {
      ANNULEE:    'annulée',
      REPORTEE:   'reportée',
      TERMINEE:   'terminée',
      EN_COURS:   'en cours',
      CONFIRMEE:  'confirmée',
    };
    const label = statusLabel[opts.nouveauStatut] ?? opts.nouveauStatut;
    const base: Omit<Alerte, 'id' | 'createdAt'> = {
      type: 'REUNION', priorite: opts.nouveauStatut === 'ANNULEE' ? 'HAUTE' : 'NORMALE',
      titre: `Réunion ${label} — ${opts.titre}`,
      message: `La réunion "${opts.titre}" a été ${label}.`,
      lienUrl: '/reunions', lienLabel: 'Voir la réunion',
      lue: false,
      entityId: opts.reunionId, entityType: 'reunion',
    };

    if (opts.participantIds && opts.participantIds.length > 0) {
      await this.createBatch(opts.participantIds.map(uid => ({ ...base, destinataireId: uid })));
    } else {
      await this.create(base);
    }
  }

  async alerteVote(opts: {
    reunionId: string;
    titrePoint: string;
    adminId?: string;
  }): Promise<string> {
    return this.create({
      type: 'VOTE', priorite: 'HAUTE',
      titre: `🗳️ Vote requis : ${opts.titrePoint}`,
      message: `Un vote est nécessaire pour le point "${opts.titrePoint}". Organisez le vote lors de la prochaine réunion.`,
      lienUrl: '/reunions', lienLabel: 'Gérer le vote',
      lue: false,
      destinataireId: opts.adminId,
      entityId: opts.reunionId, entityType: 'reunion',
    });
  }

  // ── DOCUMENTS ──
  async alerteNouveauDocument(p: PayloadDocument): Promise<void> {
    const base: Omit<Alerte, 'id' | 'createdAt'> = {
      type: 'DOCUMENT', priorite: 'INFO',
      titre: `📄 Nouveau document disponible`,
      message: `"${p.nomDocument}" (${p.categorie}) a été déposé par ${p.uploadePar}. Consultez-le dans l'espace documentaire.`,
      lienUrl: p.lienUrl ?? '/documents', lienLabel: 'Télécharger le document',
      lue: false,
      entityId: p.documentId, entityType: 'document',
    };

    const ids = p.destinatairesIds ?? [];
    if (ids.length > 0) {
      await this.createBatch(ids.map(uid => ({ ...base, destinataireId: uid })));
    } else {
      await this.create(base);
    }
  }

  // ── MAINTENANCE ──
  async alerteDemandeMaintenance(p: PayloadMaintenance): Promise<string> {
    return this.create({
      type: 'MAINTENANCE', priorite: p.priorite,
      titre: `🔧 Demande de travaux : ${p.titre}`,
      message: `Une demande d'intervention a été enregistrée${p.description ? ` : ${p.description}` : ''}. Elle sera traitée dans les meilleurs délais.`,
      lienUrl: '/maintenance', lienLabel: 'Suivre la demande',
      lue: false,
      destinataireId: p.demandeurId,
      entityId: p.maintenanceId, entityType: 'maintenance',
    });
  }

  async alerteStatutMaintenance(p: PayloadMaintenance): Promise<string> {
    const statutLabel: Record<string, string> = {
      EN_COURS:   'prise en charge',
      TERMINEE:   'terminée',
      ANNULEE:    'annulée',
      EN_ATTENTE: 'en attente',
      PLANIFIEE:  'planifiée',
    };
    const label = p.statut ? (statutLabel[p.statut] ?? p.statut) : 'mise à jour';
    return this.create({
      type: 'MAINTENANCE', priorite: p.priorite,
      titre: `Intervention ${label} — ${p.titre}`,
      message: `La demande d'intervention "${p.titre}" est désormais ${label}.`,
      lienUrl: '/maintenance', lienLabel: 'Voir l\'intervention',
      lue: false,
      destinataireId: p.demandeurId,
      entityId: p.maintenanceId, entityType: 'maintenance',
    });
  }

  async alerteContratExpiration(opts: {
    contratNom: string;
    dateExpiration: string;
    joursRestants: number;
    adminId?: string;
  }): Promise<string> {
    const isUrgent = opts.joursRestants < 15;
    return this.create({
      type: 'MAINTENANCE', priorite: isUrgent ? 'HAUTE' : 'NORMALE',
      titre: `${isUrgent ? '🚨' : '⚠️'} Contrat expirant — ${opts.contratNom}`,
      message: `Le contrat "${opts.contratNom}" arrive à expiration le ${opts.dateExpiration} (dans ${opts.joursRestants} jour${opts.joursRestants > 1 ? 's' : ''}). Pensez à le renouveler.`,
      lienUrl: '/charges', lienLabel: 'Voir le contrat',
      lue: false,
      destinataireId: opts.adminId,
      meta: { joursRestants: opts.joursRestants },
    });
  }

  // ── BUDGET ──
  async alerteSeuilBudget(p: PayloadBudget): Promise<string> {
    return this.create({
      type: 'BUDGET', priorite: p.pourcentage >= 90 ? 'CRITIQUE' : 'HAUTE',
      titre: `Budget ${p.pourcentage.toFixed(0)}% consommé — ${p.residenceNom}`,
      message: `Le budget ${p.annee ?? ''} de ${p.residenceNom} est utilisé à ${p.pourcentage.toFixed(0)}%. Dépenses actuelles : ${p.depensesActuelles.toFixed(2)} DT / ${p.budgetTotal.toFixed(2)} DT.`,
      lienUrl: '/budget', lienLabel: 'Voir le budget',
      lue: false,
      meta: { pourcentage: p.pourcentage, budgetTotal: p.budgetTotal },
    });
  }

  async alerteBudgetDepasse(p: PayloadBudget): Promise<string> {
    const depassement = p.depensesActuelles - p.budgetTotal;
    return this.create({
      type: 'BUDGET', priorite: 'CRITIQUE',
      titre: `🚨 Budget dépassé — ${p.residenceNom}`,
      message: `Le budget ${p.annee ?? ''} de ${p.residenceNom} est dépassé de ${depassement.toFixed(2)} DT (${p.pourcentage.toFixed(0)}% consommé). Une révision est nécessaire.`,
      lienUrl: '/budget', lienLabel: 'Réviser le budget',
      lue: false,
      meta: { depassement, pourcentage: p.pourcentage },
    });
  }

  // ── SYSTÈME ──
  async alerteBienvenue(opts: { destinataireId: string; fullname: string; role: string }): Promise<string> {
    return this.create({
      type: 'BIENVENUE', priorite: 'INFO',
      titre: `👋 Bienvenue sur SyndicPro, ${opts.fullname} !`,
      message: `Votre compte a été créé avec le rôle "${opts.role}". Complétez votre profil pour profiter de toutes les fonctionnalités.`,
      lienUrl: '/profil', lienLabel: 'Compléter mon profil',
      lue: false,
      destinataireId: opts.destinataireId,
    });
  }

  async alerteSysteme(opts: {
    titre: string;
    message: string;
    priorite?: AlertePriorite;
    destinataireId?: string;
    lienUrl?: string;
    lienLabel?: string;
  }): Promise<string> {
    return this.create({
      type: 'SYSTEME', priorite: opts.priorite ?? 'INFO',
      titre: opts.titre,
      message: opts.message,
      lienUrl: opts.lienUrl,
      lienLabel: opts.lienLabel,
      lue: false,
      destinataireId: opts.destinataireId,
    });
  }

  // ═══════════════════════════════════════════════════
  //  HELPERS STATIQUES (templates)
  // ═══════════════════════════════════════════════════

  static prioriteColor(p: AlertePriorite): string {
    return {
      CRITIQUE: 'bg-red-50 text-red-800 border-red-200',
      HAUTE:    'bg-orange-50 text-orange-800 border-orange-200',
      NORMALE:  'bg-blue-50 text-blue-800 border-blue-200',
      INFO:     'bg-slate-50 text-slate-700 border-slate-200',
    }[p] ?? '';
  }

  static prioriteBadge(p: AlertePriorite): string {
    return {
      CRITIQUE: 'bg-red-100 text-red-700',
      HAUTE:    'bg-orange-100 text-orange-700',
      NORMALE:  'bg-blue-100 text-blue-700',
      INFO:     'bg-slate-100 text-slate-600',
    }[p] ?? '';
  }

  static prioriteLabel(p: AlertePriorite): string {
    return { CRITIQUE: 'Critique', HAUTE: 'Haute', NORMALE: 'Normale', INFO: 'Info' }[p] ?? p;
  }

  static prioriteIcon(p: AlertePriorite): string {
    return { CRITIQUE: '🔴', HAUTE: '🟠', NORMALE: '🔵', INFO: '⚪' }[p] ?? '⚪';
  }

  static typeIcon(t: AlerteType): string {
    return {
      IMPAYÉ:      '💳',
      BUDGET:      '💰',
      REUNION:     '📅',
      DOCUMENT:    '📄',
      MAINTENANCE: '🔧',
      SYSTEME:     '⚙️',
      VOTE:        '🗳️',
      CHARGE:      '🧾',
      RELANCE:     '📮',
      BIENVENUE:   '👋',
    }[t] ?? '🔔';
  }

  static typeLabel(t: AlerteType): string {
    return {
      IMPAYÉ:      'Paiement',
      BUDGET:      'Budget',
      REUNION:     'Réunion',
      DOCUMENT:    'Document',
      MAINTENANCE: 'Maintenance',
      SYSTEME:     'Système',
      VOTE:        'Vote',
      CHARGE:      'Charge',
      RELANCE:     'Relance',
      BIENVENUE:   'Bienvenue',
    }[t] ?? t;
  }

  static typeColor(t: AlerteType): string {
    return {
      IMPAYÉ:      'text-red-600 bg-red-50',
      BUDGET:      'text-yellow-600 bg-yellow-50',
      REUNION:     'text-blue-600 bg-blue-50',
      DOCUMENT:    'text-indigo-600 bg-indigo-50',
      MAINTENANCE: 'text-orange-600 bg-orange-50',
      SYSTEME:     'text-slate-600 bg-slate-50',
      VOTE:        'text-purple-600 bg-purple-50',
      CHARGE:      'text-teal-600 bg-teal-50',
      RELANCE:     'text-rose-600 bg-rose-50',
      BIENVENUE:   'text-emerald-600 bg-emerald-50',
    }[t] ?? 'text-slate-600 bg-slate-50';
  }

  // ── Mapping interne ────────────────────────────
  private mapDoc(d: any): Alerte {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data['createdAt']?.toDate ? data['createdAt'].toDate() : data['createdAt'],
    } as Alerte;
  }
}