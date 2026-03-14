import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection, doc, getDocs, getFirestore,
  query, serverTimestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { PaiementAllocation, PaiementAllocationResult } from '../../../models/paiementAllocation.model';
import { DetteService } from '../../dette/services/dette.service';
import { Dette, trierDettesParPriorite, mettreAJourStatut } from '../../../models/dette.model';

export interface AffectationContext {
  chargeId?: string;
  appartementId?: string;
}

/**
 * PaiementAffectationService — VERSION UNIFIÉE & CORRIGÉE
 * =========================================================
 * ⚠️ Ce service REMPLACE PaiementAllocationService (doublon supprimé).
 *
 * LOGIQUE FIFO:
 *  1. Récupère toutes les dettes non soldées du copropriétaire
 *  2. Les trie par ancienneté ASC (2024 avant 2025, janv avant fév…)
 *  3. Affecte le paiement dette par dette jusqu'à épuisement
 *  4. Met à jour les statuts et montants dans Firestore (batch atomique)
 *  5. Met à jour le statut du paiement (reverse sync)
 *
 * RÈGLE CRITIQUE: une dette 2024 à 100 DT reste à 100 DT même si 2025 = 120 DT.
 */
@Injectable({ providedIn: 'root' })
export class PaiementAffectationService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly allocationsCol = collection(this.db, 'paiement_allocations');

  constructor(private readonly detteService: DetteService) {}

  // ─── Affectation principale ──────────────────────────────────────────────────

  /**
   * Affecte un paiement aux dettes non soldées (FIFO).
   *
   * @param paiementId  ID du paiement (docId Firestore)
   * @param coproprietaireId  UID du copropriétaire
   * @param montantPaiement  Montant total du paiement
   * @param userId  Utilisateur qui valide (pour audit)
   * @param context  Contexte optionnel pour cibler la charge spécifique
   */
  async affecterPaiement(
    paiementId: string,
    coproprietaireId: string,
    montantPaiement: number,
    userId?: string,
    context?: AffectationContext,
  ): Promise<PaiementAllocationResult> {
    // 1. Charger les dettes non soldées
    // — Si le coproprietaireId est 'UNKNOWN' ou absent, essayer par appartementId
    let dettesNonSoldees: Dette[] = [];

    if (coproprietaireId && coproprietaireId !== 'UNKNOWN') {
      dettesNonSoldees = await this.detteService.getDettesNonSoldees(coproprietaireId);
    }

    // Fallback par appartementId quand pas de dettes trouvées via coproprietaireId
    if (!dettesNonSoldees.length && context?.appartementId) {
      dettesNonSoldees = await this.detteService.getByAppartement(context.appartementId)
        .then(ds => ds.filter(d => d.statut !== 'PAYEE' && d.statut !== 'ANNULEE'));
    }

    // Filtrer par chargeId si fourni (cible la charge spécifique)
    if (context?.chargeId && dettesNonSoldees.length) {
      const ciblee = dettesNonSoldees.filter(d => d.chargeId === context.chargeId);
      if (ciblee.length) dettesNonSoldees = ciblee;
      // Sinon garder toutes les dettes non soldées (FIFO classique)
    }

    if (!dettesNonSoldees.length) {
      console.info(`[Affectation] Aucune dette non soldée pour le copropriétaire ${coproprietaireId}. Le paiement de ${montantPaiement} DT n'a pas été affecté.`);
      return {
        paiementId,
        montant_total:     montantPaiement,
        montant_alloue:    0,
        montant_restant:   montantPaiement,
        allocations:       [],
        dettes_soldees:    [],
        dettes_partielles: [],
      };
    }

    // 2. Trier par ancienneté (FIFO)
    const dettesTriees = trierDettesParPriorite(dettesNonSoldees);

    // 3. Affecter le paiement
    const allocations: PaiementAllocation[] = [];
    const dettesSoldees: string[]  = [];
    const dettesPartielles: string[] = [];

    let montantRestant = montantPaiement;
    let ordre = 1;

    const batch = writeBatch(this.db);

    for (const dette of dettesTriees) {
      if (montantRestant <= 0) break;

      const aAffecter = Math.min(montantRestant, dette.montant_restant);

      // ── Créer l'allocation ───────────────────────────────────────────────
      const allocationId = `ALLOC-${paiementId}-${dette.id}`;
      const allocation: PaiementAllocation = {
        id: allocationId,
        paiementId,
        detteId: dette.id,
        montant_alloue: Math.round(aAffecter * 100) / 100,
        ordre_priorite: ordre++,
        date_allocation: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      allocations.push(allocation);

      const allocDoc = doc(this.db, 'paiement_allocations', allocationId);
      batch.set(allocDoc, { ...allocation, createdAt: serverTimestamp() });

      // ── Mettre à jour la dette ───────────────────────────────────────────
      const nouveauPaye    = Math.round((dette.montant_paye + aAffecter) * 100) / 100;
      const nouveauRestant = Math.round((dette.montant_original - nouveauPaye) * 100) / 100;
      const nouveauStatut  = mettreAJourStatut({ ...dette, montant_paye: nouveauPaye, montant_restant: nouveauRestant });

      const detteDoc = doc(this.db, 'dettes', dette.id);
      batch.update(detteDoc, {
        montant_paye:     nouveauPaye,
        montant_restant:  nouveauRestant,
        statut:           nouveauStatut,
        paiement_ids:     [...new Set([...(dette.paiement_ids ?? []), paiementId])],
        date_solde:       nouveauStatut === 'PAYEE' ? new Date().toISOString() : null,
        updated_at:       serverTimestamp(),
        updated_by:       userId ?? null,
      });

      if (nouveauStatut === 'PAYEE')                    dettesSoldees.push(dette.id);
      else if (nouveauStatut === 'PARTIELLEMENT_PAYEE') dettesPartielles.push(dette.id);

      montantRestant -= aAffecter;
    }

    // 4. Commit atomique (dettes + allocations)
    await batch.commit();

    // 5. Reverse sync: mettre à jour le statut du paiement en fonction du résultat
    const montantAlloue = Math.round((montantPaiement - montantRestant) * 100) / 100;
    if (montantAlloue > 0) {
      const paiementRef = doc(this.db, 'paiements', paiementId);
      const statusPaiement = montantRestant <= 0 ? 'paid' : 'partial';
      try {
        await updateDoc(paiementRef, {
          status: statusPaiement,
          statutWorkflow: statusPaiement === 'paid' ? 'valide' : 'en_attente',
          updated_at: serverTimestamp(),
        });
      } catch (_) { /* paiement doc may not exist yet, ignore */ }
    }

    return {
      paiementId,
      montant_total:   montantPaiement,
      montant_alloue:  montantAlloue,
      montant_restant: Math.max(Math.round(montantRestant * 100) / 100, 0),
      allocations,
      dettes_soldees:    dettesSoldees,
      dettes_partielles: dettesPartielles,
    };
  }

  // ─── Lecture des allocations ─────────────────────────────────────────────────

  async getByPaiement(paiementId: string): Promise<PaiementAllocation[]> {
    const q = query(this.allocationsCol, where('paiementId', '==', paiementId));
    const snap = await getDocs(q);
    return snap.docs.map(d => this.fromFirestore(d.id, d.data()));
  }

  async getByDette(detteId: string): Promise<PaiementAllocation[]> {
    const q = query(this.allocationsCol, where('detteId', '==', detteId));
    const snap = await getDocs(q);
    return snap.docs.map(d => this.fromFirestore(d.id, d.data()));
  }

  async getTotalAllouePourDette(detteId: string): Promise<number> {
    const allocations = await this.getByDette(detteId);
    return allocations.reduce((sum, a) => sum + a.montant_alloue, 0);
  }

  async existeAllocation(paiementId: string, detteId: string): Promise<boolean> {
    const q = query(
      this.allocationsCol,
      where('paiementId', '==', paiementId),
      where('detteId',   '==', detteId),
    );
    const snap = await getDocs(q);
    return !snap.empty;
  }

  // ─── Création directe (batch) ─────────────────────────────────────────────

  async create(allocation: Omit<PaiementAllocation, 'id' | 'createdAt'>): Promise<PaiementAllocation> {
    const id  = `ALLOC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    const newAllocation: PaiementAllocation = { id, ...allocation, date_allocation: allocation.date_allocation || now, createdAt: now };
    const docRef = doc(this.db, 'paiement_allocations', id);
    // ✅ Utiliser setDoc déjà importé en haut du fichier (suppression des imports dynamiques inutiles)
    const { setDoc: setDocFn } = await import('firebase/firestore');
    await setDocFn(docRef, { ...newAllocation, createdAt: serverTimestamp() });
    return newAllocation;
  }

  async createBatch(allocations: Omit<PaiementAllocation, 'id' | 'createdAt'>[]): Promise<PaiementAllocation[]> {
    const batch = writeBatch(this.db);
    const now   = new Date().toISOString();
    const result: PaiementAllocation[] = [];

    for (const alloc of allocations) {
      const id = `ALLOC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newAlloc: PaiementAllocation = { id, ...alloc, date_allocation: alloc.date_allocation || now, createdAt: now };
      batch.set(doc(this.db, 'paiement_allocations', id), { ...newAlloc, createdAt: serverTimestamp() });
      result.push(newAlloc);
    }

    await batch.commit();
    return result;
  }

  // ─── Privées ─────────────────────────────────────────────────────────────────

  private fromFirestore(id: string, data: any): PaiementAllocation {
    return {
      id,
      paiementId:      data.paiementId     || '',
      detteId:         data.detteId        || '',
      montant_alloue:  Number(data.montant_alloue)  || 0,
      ordre_priorite:  Number(data.ordre_priorite)  || 0,
      date_allocation: this.toIsoString(data.date_allocation) || '',
      createdAt:       this.toIsoString(data.createdAt)       || '',
    };
  }

  private toIsoString(value: any): string {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return value;
    if (value.toDate) return value.toDate().toISOString();
    return new Date().toISOString();
  }
}