import { Injectable, inject } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { AlerteService } from '../../notifications/services/alerte.service';
import { PaiementAffectationService } from './paiement-affectation.service';
import { DetteService } from '../../dette/services/dette.service';
import { AppartementService } from '../../appartements/services/appartement.service';

export type PaymentStatus = 'paid' | 'pending' | 'overdue' | 'partial';
export type PaymentType = 'charge' | 'works' | 'fund' | 'special' | 'penalty';
export type PaymentMethod = 'bank_transfer' | 'check' | 'cash' | 'online';
export type PaymentMode = 'especes' | 'cheque' | 'virement' | 'carte' | 'prelevement';
export type PaymentWorkflowStatus = 'en_attente' | 'valide' | 'rejete';

export interface SimpleUser {
  id: number;
  name: string;
  role: 'COPROPRIETAIRE' | 'LOCATAIRE' | 'TRESORIER' | 'PRESIDENT' | 'ADMIN';
}

export interface Payment {
  id: number;
  docId?: string;
  label: string;
  amount: number;
  date: string; // JJ/MM/AAAA
  dueDate: string; // JJ/MM/AAAA
  status: PaymentStatus;
  payer: string;
  payerId: number;
  validatedBy: string | null;
  validatedById: number | null;
  type: PaymentType;
  category: string;
  reference: string;
  description: string;
  paymentMethod?: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
  // Champs métier syndic
  appartementId?: string;
  residenceId?: string;
  coproprietaireId?: string;
  chargeId?: string;
  datePaiement?: string; // ISO yyyy-mm-dd
  modePaiement?: PaymentMode;
  statutWorkflow?: PaymentWorkflowStatus;
  validePar?: string;
  dateValidation?: string; // ISO
  recuUrl?: string;
  mois?: number; // Mois du paiement
  annee?: number; // Année du paiement
  createdAt: string;
  updatedAt: string;
}

export interface PaymentStats {
  totalCollected: number;
  totalPending: number;
  totalOverdue: number;
  monthlyAverage: number;
  collectionRate: number;
  upcomingPayments: number;
  totalCount: number;
}

@Injectable({ providedIn: 'root' })
export class PaiementService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);
  private readonly paiementsCol = collection(this.db, 'paiements');
  private readonly alerteSvc = inject(AlerteService);
  private readonly affectationSvc = inject(PaiementAffectationService);
  private readonly detteService = inject(DetteService);
  private readonly appartementService = inject(AppartementService);

  private readonly users: SimpleUser[] = [
    { id: 1, name: 'Admin Système', role: 'ADMIN' },
    { id: 2, name: 'Aya Omrani', role: 'COPROPRIETAIRE' },
    { id: 3, name: 'Jean Martin', role: 'COPROPRIETAIRE' },
    { id: 4, name: 'Sophie Bernard', role: 'COPROPRIETAIRE' },
    { id: 5, name: 'Pierre Moreau', role: 'PRESIDENT' },
    { id: 6, name: 'Catherine Leroy', role: 'COPROPRIETAIRE' },
  ];

  private data: Payment[] = [];

  getAll(): Payment[] {
    return [...this.data];
  }

  getUsers(): SimpleUser[] {
    return [...this.users];
  }

  async loadFromFirestore(): Promise<Payment[]> {
    const q = query(this.paiementsCol, orderBy('dueDate'));
    const snapshot = await getDocs(q);
    let idx = 1;
    const payments: Payment[] = snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      return {
        id: idx++,
        docId: docSnap.id,
        label: d.label || 'Paiement',
        amount: Number(d.amount) || 0,
        date: this.toDisplayDate(d.date),
        dueDate: this.toDisplayDate(d.dueDate),
        status: (d.status as PaymentStatus) || 'pending',
        payer: d.payer || 'Inconnu',
        payerId: Number(d.payerId) || 0,
        validatedBy: d.validatedBy ?? null,
        validatedById: d.validatedById ?? null,
        type: (d.type as PaymentType) || 'charge',
        category: d.category || 'Charges courantes',
        reference: d.reference || this.buildReference(),
        description: d.description || '',
        paymentMethod: d.paymentMethod,
        receiptNumber: d.receiptNumber,
        notes: d.notes,
        appartementId: d.appartementId,
        coproprietaireId: d.coproprietaireId,
        chargeId: d.chargeId,
        datePaiement: this.toIsoDate(d.datePaiement),
        modePaiement: d.modePaiement,
        statutWorkflow: d.statutWorkflow,
        validePar: d.validePar,
        dateValidation: this.toIsoDate(d.dateValidation),
        recuUrl: d.recuUrl,
        mois: d.mois,
        annee: d.annee,
        createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || this.todayIso(),
        updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt || this.todayIso(),
      } as Payment;
    });

    if (payments.length) {
      this.data = payments;
    }
    return this.getAll();
  }

  async getByAppartementAndMonth(appartementId: string, mois: number, annee: number): Promise<Payment | null> {
    const q = query(
      this.paiementsCol,
      where('appartementId', '==', appartementId),
      where('mois', '==', mois),
      where('annee', '==', annee)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    const data = doc.data() as any;
    return {
      ...data,
      docId: doc.id,
      id: data.id || 0,
    } as Payment;
  }

// Dans paiement.service.ts, ajoutez/modifiez ces méthodes

async create(payload: Partial<Payment>): Promise<Payment> {
  const nowIso = this.todayIso();
  const payer = this.users.find((u) => u.id === payload.payerId);
  
  // Extraire le mois et l'année
  let mois: number | undefined = payload.mois;
  let annee: number | undefined = payload.annee;
  
  if (payload.datePaiement && (!mois || !annee)) {
    const date = new Date(payload.datePaiement);
    mois = date.getMonth() + 1;
    annee = date.getFullYear();
  }

  // Résolution de coproprietaireId (depuis le payload, ou depuis l'appartement Firestore)
  const resolvedCoproId = await this.resolveCoproprietaireId(payload);
  let resolvedResidenceId: string | undefined = payload.residenceId;
  if (!resolvedResidenceId && payload.appartementId) {
    try {
      const appartement = await this.appartementService.getById(payload.appartementId);
      resolvedResidenceId = appartement?.residenceDocId || undefined;
    } catch {
      // Non bloquant: la creation du paiement doit continuer meme si on ne peut pas enrichir residenceId.
    }
  }
  if (!resolvedCoproId) {
    console.warn(
      `[PaiementService] coproprietaireId introuvable pour appartementId="${payload.appartementId}". ` +
      'Le paiement sera enregistré sans lien propriétaire.'
    );
  }

  const base: Payment = {
    id: this.nextId(),
    label: payload.label?.trim() || 'Nouveau paiement',
    amount: Number(payload.amount) || 0,
    date: this.toIsoDate(payload.date) || nowIso,
    dueDate: this.toIsoDate(payload.dueDate) || nowIso,
    status: payload.status || 'pending',
    payer: payload.payer || payer?.name || 'Inconnu',
    payerId: payload.payerId || payer?.id || 0,
    validatedBy: payload.validatedBy ?? null,
    validatedById: payload.validatedById ?? null,
    type: (payload.type as PaymentType) || 'charge',
    category: payload.category || 'Charges courantes',
    reference: payload.reference || this.buildReference(),
    description: payload.description || '',
    paymentMethod: payload.paymentMethod,
    receiptNumber: payload.receiptNumber,
    notes: payload.notes,
    appartementId: payload.appartementId,
    residenceId: resolvedResidenceId,
    coproprietaireId: resolvedCoproId || undefined,
    chargeId: payload.chargeId,
    datePaiement: this.toIsoDate(payload.datePaiement),
    modePaiement: payload.modePaiement,
    statutWorkflow: payload.statutWorkflow || 'en_attente',
    validePar: payload.validePar,
    dateValidation: this.toIsoDate(payload.dateValidation),
    recuUrl: payload.recuUrl,
    mois,
    annee,
    createdAt: payload.createdAt || nowIso,
    updatedAt: payload.updatedAt || nowIso,
  };

  const docBody = this.clean({
    ...base,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ref = await addDoc(this.paiementsCol, docBody);
  const created: Payment = { ...base, docId: ref.id };
  this.data = [created, ...this.data];

  // 🔥 IMPORTANT: Si le paiement est 'paid', affecter immédiatement aux dettes
  if (created.status === 'paid' && created.amount > 0 && created.docId) {
    try {
      // Stratégie 1 : cibler la dette exacte si on a appartementId + mois + annee
      let affecte = false;
      if (created.appartementId && created.mois && created.annee) {
        const dette = await this.detteService.getByAppartementAndMonth(
          created.appartementId, created.annee, created.mois,
          created.chargeId,
        );
        if (dette && dette.statut !== 'PAYEE') {
          await this.detteService.affecterPaiement(dette.id, created.amount, created.docId);
          console.log(`✅ Paiement ${created.docId} affecté directement à la dette ${dette.id}`);
          affecte = true;
        }
      }
      // Stratégie 2 : FIFO par coproprietaireId si Stratégie 1 n'a rien trouvé
      if (!affecte && created.coproprietaireId) {
        await this.affectationSvc.affecterPaiement(
          created.docId,
          created.coproprietaireId,
          created.amount,
          undefined,
          { chargeId: created.chargeId, appartementId: created.appartementId },
        );
        console.log(`✅ Paiement ${created.docId} affecté aux dettes (FIFO)`);
      }
    } catch (err) {
      console.error('❌ Erreur lors de l\'affectation du paiement:', err);
    }
  }

  // Envoyer une notification
  if (created.coproprietaireId) {
    this.sendNotification(created, created.coproprietaireId);
  }

  return created;
}

async update(idOrDocId: number | string, patch: Partial<Payment>): Promise<Payment | undefined> {
  const idx = typeof idOrDocId === 'number'
    ? this.data.findIndex((p) => p.id === idOrDocId)
    : this.data.findIndex((p) => p.docId === idOrDocId);
  if (idx === -1) return undefined;

  const current = this.data[idx];
  const updated: Payment = { ...current, ...patch, updatedAt: patch.updatedAt || this.todayIso() };
  this.data[idx] = updated;

  const docId = current.docId;
  if (docId) {
    const ref = doc(this.db, 'paiements', docId);
    const body = this.clean({ ...patch, updatedAt: serverTimestamp() });
    await updateDoc(ref, body);
  }

  // 🔥 CRITIQUE: Si le statut change vers 'paid', synchroniser les dettes
  const statusChanged = patch.status && patch.status !== current.status;
  if (statusChanged && updated.status === 'paid') {
    try {
      const allocations = updated.docId ? await this.affectationSvc.getByPaiement(updated.docId) : [];
      if (!allocations.length) {
        // Stratégie 1 : cibler la dette exacte par appartementId + chargeId (si disponibles)
        // Prioritaire sur le FIFO — évite d'imputer sur la mauvaise dette
        let detteDirecteTrouvee = false;
        if (updated.appartementId && updated.mois && updated.annee) {
          const dette = await this.detteService.getByAppartementAndMonth(
            updated.appartementId, updated.annee, updated.mois,
            updated.chargeId,  // filtre optionnel par charge
          );
          if (dette && dette.statut !== 'PAYEE') {
            await this.detteService.affecterPaiement(dette.id, updated.amount, updated.docId!);
            console.log(`✅ Dette ${dette.id} synchronisée via update() direct`);
            detteDirecteTrouvee = true;
          }
        }

        // Stratégie 2 : FIFO par coproprietaireId (uniquement si Stratégie 1 n'a rien trouvé)
        if (!detteDirecteTrouvee) {
          const coproId = updated.coproprietaireId
            || await this.resolveCoproprietaireId(updated);
          if (coproId && updated.docId) {
            await this.affectationSvc.affecterPaiement(
              updated.docId, coproId, updated.amount,
              undefined,
              { chargeId: updated.chargeId, appartementId: updated.appartementId },
            );
            console.log(`✅ Paiement ${updated.docId} affecté aux dettes (FIFO) après mise à jour`);
          }
        }
      }
    } catch (err) {
      console.error('❌ Erreur affectation après mise à jour:', err);
    }
  }

  // Notification si changement de statut
  if (statusChanged && updated.coproprietaireId) {
    this.sendNotification(updated, updated.coproprietaireId);
  }

  return updated;
}

  private sendNotification(payment: Payment, destId: string) {
    const pId = payment.docId || String(payment.id);
    if (payment.status === 'paid') {
      this.alerteSvc.alertePaiementValide({
        destinataireId: destId,
        paiementId: pId,
        montant: payment.amount,
        payerName: payment.payer,
      }).catch(err => console.error('[Alerte] Erreur paiement validé:', err));
    } else if (payment.status === 'overdue') {
      this.alerteSvc.alerteRetardPaiement({
        destinataireId: destId,
        paiementId: pId,
        montant: payment.amount,
        dateEcheance: payment.dueDate,
        payerName: payment.payer,
      }).catch(err => console.error('[Alerte] Erreur retard paiement:', err));
    } else if (payment.status === 'partial') {
      this.alerteSvc.alertePaiementPartiel({
        destinataireId: destId,
        paiementId: pId,
        montantTotal: payment.amount,
        montantPaye: payment.amount / 2,
        payerName: payment.payer,
      }).catch(err => console.error('[Alerte] Erreur paiement partiel:', err));
    }
  }



  async delete(idOrDocId: number | string): Promise<boolean> {
    const before = this.data.length;
    this.data = this.data.filter((p) => (typeof idOrDocId === 'number' ? p.id !== idOrDocId : p.docId !== idOrDocId));
    if (typeof idOrDocId === 'string') {
      const ref = doc(this.db, 'paiements', idOrDocId);
      await deleteDoc(ref);
    }
    return this.data.length < before;
  }

  async markPaid(id: number, validatorName: string, validatorId: number): Promise<Payment | undefined> {
    const result = await this.update(id, {
      status: 'paid',
      validatedBy: validatorName,
      validatedById: validatorId,
      updatedAt: this.todayIso(),
    });

    if (result) {
      this.alerteSvc.alertePaiementValide({
        destinataireId: result.coproprietaireId || '',
        paiementId: result.docId || String(result.id),
        montant: result.amount,
        payerName: result.payer,
      }).catch(err => console.error('[Alerte] Erreur paiement validé:', err));
    }

    return result;
  }

  async markOverdue(id: number): Promise<Payment | undefined> {
    const result = await this.update(id, {
      status: 'overdue',
      updatedAt: this.todayIso(),
    });

    if (result) {
      this.alerteSvc.alerteRetardPaiement({
        destinataireId: result.coproprietaireId || '',
        paiementId: result.docId || String(result.id),
        montant: result.amount,
        dateEcheance: result.dueDate,
        payerName: result.payer,
      }).catch(err => console.error('[Alerte] Erreur retard paiement:', err));
    }

    return result;
  }

  async markPartial(id: number, montantPaye: number): Promise<Payment | undefined> {
    const result = await this.update(id, {
      status: 'partial',
      updatedAt: this.todayIso(),
    });

    if (result) {
      this.alerteSvc.alertePaiementPartiel({
        destinataireId: result.coproprietaireId || '',
        paiementId: result.docId || String(result.id),
        montantTotal: result.amount,
        montantPaye,
        payerName: result.payer,
      }).catch(err => console.error('[Alerte] Erreur paiement partiel:', err));
    }

    return result;
  }

  async updateStatutWorkflow(
    idOrDocId: number | string,
    nouveauStatut: PaymentWorkflowStatus,
    opts?: { validatorName?: string; validatorId?: number; motifRejet?: string; montantPaye?: number },
  ): Promise<Payment | undefined> {
    const statusMapping: Record<PaymentWorkflowStatus, PaymentStatus> = {
      en_attente: 'pending',
      valide: 'paid',
      rejete: 'overdue',
    };

    const patch: Partial<Payment> = {
      statutWorkflow: nouveauStatut,
      status: statusMapping[nouveauStatut] || 'pending',
      updatedAt: this.todayIso(),
    };

    if (nouveauStatut === 'valide' && opts?.validatorName) {
      patch.validatedBy = opts.validatorName;
      patch.validatedById = opts.validatorId ?? null;
      patch.dateValidation = this.todayIso();
    }

    const result = await this.update(idOrDocId, patch);

    if (result) {
      const destId = result.coproprietaireId || '';
      const pId = result.docId || String(result.id);

      if (nouveauStatut === 'valide') {
        this.alerteSvc.alertePaiementValide({
          destinataireId: destId,
          paiementId: pId,
          montant: result.amount,
          payerName: result.payer,
        }).catch(err => console.error('[Alerte] Erreur paiement validé (workflow):', err));
      } else if (nouveauStatut === 'rejete') {
        this.alerteSvc.alertePaiementRejete({
          destinataireId: destId,
          paiementId: pId,
          montant: result.amount,
          payerName: result.payer,
          motifRejet: opts?.motifRejet,
        }).catch(err => console.error('[Alerte] Erreur paiement rejeté (workflow):', err));
      }
    }

    return result;
  }

  buildReference() {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    return `PAY-${new Date().getFullYear()}-${suffix}`;
  }

  getStats(payments: Payment[]): PaymentStats {
    const totalCollected = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const totalPending = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    const totalOverdue = payments.filter((p) => p.status === 'overdue').reduce((s, p) => s + p.amount, 0);
    const totalCount = payments.length;
    const collectionRate = totalCount ? (totalCollected / (totalCollected + totalPending + totalOverdue)) * 100 : 0;
    const upcomingPayments = payments.filter((p) => p.status === 'pending').length;
    const monthlyAverage = totalCollected / 12;
    return {
      totalCollected,
      totalPending,
      totalOverdue,
      monthlyAverage,
      collectionRate,
      upcomingPayments,
      totalCount,
    };
  }

  async importFromXlsx(buffer: ArrayBuffer): Promise<{ created: Payment[]; skipped: { index: number; reason: string }[] }> {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const created: Payment[] = [];
    const skipped: { index: number; reason: string }[] = [];

    for (const [idx, row] of rows.entries()) {
      const normalized = this.normalizeRow(row);

      const label = this.pickFirst(normalized, ['libelle', 'libellé', 'label', 'designation']);
      const amountRaw = this.pickFirst(normalized, ['montant', 'amount', 'montantttc', 'montantht']);
      const payer = this.pickFirst(normalized, ['payeur', 'payer']);
      const payerIdRaw = this.pickFirst(normalized, ['payerid', 'idpayeur']);
      const dueDateRaw = this.pickFirst(normalized, ['echeance', 'écheance', 'duedate', 'due_date', 'due']);
      const dateRaw = this.pickFirst(normalized, ['date', 'paymentdate', 'date_paiement']);
      const statusRaw = this.pickFirst(normalized, ['statut', 'status']);
      const typeRaw = this.pickFirst(normalized, ['type']);
      const category = this.pickFirst(normalized, ['categorie', 'category']) || 'Charges courantes';
      const reference = this.pickFirst(normalized, ['reference', 'référence', 'ref']);
      const description = this.pickFirst(normalized, ['description']);

      const amount = this.parseAmount(amountRaw);
      const finalLabel = label || payer || reference || `Paiement ${idx + 1}`;

      if (!finalLabel || !amount) {
        skipped.push({ index: idx + 1, reason: 'Libellé ou montant manquant' });
        continue;
      }

      const payload: Partial<Payment> = {
        label: String(finalLabel),
        amount,
        payer: payer ? String(payer) : '',
        payerId: payerIdRaw ? Number(payerIdRaw) : undefined,
        dueDate: this.normalizeDate(dueDateRaw || ''),
        date: this.normalizeDate(dateRaw || ''),
        status: (String(statusRaw || '').toLowerCase() as PaymentStatus) || 'pending',
        type: (String(typeRaw || '').toLowerCase() as PaymentType) || 'charge',
        category: String(category),
        reference: reference ? String(reference) : '',
        description: description ? String(description) : '',
      };

      try {
        const createdPayment = await this.create(payload);
        created.push(createdPayment);
      } catch (err: any) {
        skipped.push({ index: idx + 1, reason: err?.message || 'Erreur inconnue' });
      }
    }

    return { created, skipped };
  }

  private normalizeRow(row: Record<string, any>) {
    const normalized: Record<string, any> = {};
    Object.entries(row).forEach(([key, value]) => {
      const k = this.normalizeKey(key);
      normalized[k] = value;
    });
    return normalized;
  }

  private normalizeKey(key: string) {
    return key
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  private pickFirst(obj: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== '') return obj[key];
    }
    return undefined;
  }

  private parseAmount(value: any): number {
    if (value === undefined || value === null) return 0;
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
    const cleaned = String(value).replace(/\s/g, '').replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private todayIso() {
    return new Date().toISOString().split('T')[0];
  }

  private nextId() {
    const ids = this.data.map((p) => p.id);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }

  private toIsoDate(value: string | undefined) {
    if (!value) return '';
    if (value.includes('-')) return value;
    if (value.includes('/')) {
      const [day, month, year] = value.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return value;
  }

  private toDisplayDate(value: any): string {
    if (!value) return this.todayIso();
    const raw = value?.toDate ? value.toDate() : value;
    if (typeof raw === 'string') {
      if (raw.includes('/')) return raw;
      if (raw.includes('-')) {
        const [y, m, d] = raw.split('-');
        return `${d}/${m}/${y}`;
      }
    }
    const d = new Date(raw);
    const day = `${d.getDate()}`.padStart(2, '0');
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  }

  private normalizeDate(value: any): string {
    if (!value) return this.todayIso();
    if (typeof value === 'string') {
      if (value.includes('/')) return value;
      if (value.includes('-')) {
        const [y, m, d] = value.split('-');
        return `${d}/${m}/${y}`;
      }
    }
    return this.toDisplayDate(value);
  }

  private async resolveCoproprietaireId(payload: Partial<Payment>): Promise<string | undefined> {
    if (payload.coproprietaireId) return payload.coproprietaireId;
    if (!payload.appartementId) return undefined;
    const appartement = await this.appartementService.getById(payload.appartementId);
    return appartement?.proprietaireId || appartement?.locataireId || undefined;
  }

  private clean<T extends Record<string, any>>(obj: T): T {
    const cleaned: any = {};
    Object.keys(obj).forEach((k) => {
      const v = (obj as any)[k];
      if (v !== undefined) cleaned[k] = v;
    });
    return cleaned as T;
  }

  // ============================================
  // TRANSACTION : mise à jour Paiement + Dettes
  // ============================================

  /**
   * Met à jour le statut d'un paiement ET toutes les dettes associées
   * dans une **transaction Firestore** (tout-ou-rien).
   *
   * Logique :
   *  - Si `newStatus === 'COMPLETED'` : pour chaque dette dans `allocations`,
   *    augmente `montant_paye`, recalcule `montant_restant` et passe le statut
   *    à 'PAYEE' (ou 'PARTIELLEMENT_PAYEE' si pas entièrement soldée).
   *  - Si `newStatus === 'CANCELLED'` : inverse l'opération (diminue `montant_paye`).
   *
   * @param paiementId  docId du paiement Firestore
   * @param newStatus   nouveau statut à appliquer ('COMPLETED' | 'CANCELLED' | …)
   */
  async updatePaiementAndDette(
    paiementId: string,
    newStatus: 'COMPLETED' | 'CANCELLED' | 'PENDING' | 'PARTIAL' | 'FAILED'
  ): Promise<void> {
    const paiementRef = doc(this.db, 'paiements', paiementId);

    await runTransaction(this.db, async (transaction) => {
      // 1. Lire le paiement dans la transaction
      const pSnap = await transaction.get(paiementRef);
      if (!pSnap.exists()) {
        throw new Error(`Paiement ${paiementId} introuvable`);
      }
      const pData = pSnap.data() as any;
      const oldStatus: string = pData.status || '';
      const amount: number = Number(pData.amount) || 0;
      const allocations: string[] = Array.isArray(pData.allocations) ? pData.allocations : [];

      // Rien à faire si le statut ne change pas
      if (oldStatus === newStatus) return;

      // 2. Lire toutes les dettes référencées
      const detteSnaps = await Promise.all(
        allocations.map(detteId => transaction.get(doc(this.db, 'dettes', detteId)))
      );

      // 3. Calculer les deltas selon la transition de statut
      const isCompleting  = newStatus === 'COMPLETED' && oldStatus !== 'COMPLETED';
      const isCancelling  = newStatus === 'CANCELLED' && oldStatus === 'COMPLETED';

      if (isCompleting || isCancelling) {
        // Répartir le montant sur les dettes (FIFO : par date_echeance)
        const detteDocs = detteSnaps
          .filter(s => s.exists())
          .map(s => ({ ref: s.ref, data: s.data() as any }))
          .sort((a, b) => (a.data.date_echeance || '').localeCompare(b.data.date_echeance || ''));

        let remaining = amount;

        for (const { ref, data } of detteDocs) {
          const origPaye    = Number(data.montant_paye     || 0);
          const origRestant = Number(data.montant_restant  || 0);
          const origTotal   = Number(data.montant_original || 0);

          // Combien imputer sur cette dette
          const applyAmount = Math.min(remaining, isCompleting ? origRestant : origPaye);
          if (applyAmount <= 0) continue;
          remaining -= applyAmount;

          let newPaye: number;
          let newRestant: number;

          if (isCompleting) {
            newPaye    = origPaye + applyAmount;
            newRestant = Math.max(0, origTotal - newPaye);
          } else {
            // Annulation → retirer le montant
            newPaye    = Math.max(0, origPaye - applyAmount);
            newRestant = origTotal - newPaye;
          }

          let newStatut: string;
          if (newRestant <= 0) {
            newStatut = 'PAYEE';
          } else if (newPaye > 0) {
            newStatut = 'PARTIELLEMENT_PAYEE';
          } else {
            newStatut = 'IMPAYEE';
          }

          transaction.update(ref, {
            montant_paye: newPaye,
            montant_restant: newRestant,
            statut: newStatut,
            ...(newStatut === 'PAYEE' ? { date_solde: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
          });
        }
      }

      // 4. Mettre à jour le paiement lui-même
      transaction.update(paiementRef, {
        status: newStatus === 'COMPLETED' ? 'paid'
              : newStatus === 'CANCELLED' ? 'overdue'
              : newStatus === 'PARTIAL'   ? 'partial'
              : 'pending',
        statutWorkflow: newStatus === 'COMPLETED' ? 'valide' : 'en_attente',
        updatedAt: new Date().toISOString(),
      });
    });

    // Invalider les caches
    this.detteService.invalidateCache();
    console.log(`✅ Transaction réussie : paiement ${paiementId} → ${newStatus}`);
  }
}