/*import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { PaiementAllocation } from '../../../models/paiementAllocation.model';

@Injectable({
  providedIn: 'root',
})
export class PaiementAllocationService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);
  private readonly allocationsCol = collection(this.db, 'paiement_allocations');

  /**
   * Crée une allocation entre un paiement et une dette
   *//*
  async create(allocation: Omit<PaiementAllocation, 'id' | 'createdAt'>): Promise<PaiementAllocation> {
    const id = this.generateId();
    const now = new Date().toISOString();

    const newAllocation: PaiementAllocation = {
      id,
      paiementId: allocation.paiementId,
      detteId: allocation.detteId,
      montant_alloue: allocation.montant_alloue,
      ordre_priorite: allocation.ordre_priorite,
      date_allocation: allocation.date_allocation || now,
      createdAt: now,  // ✅ Propriété createdAt bien définie
    };

    const docRef = doc(this.db, 'paiement_allocations', id);
    await setDoc(docRef, {
      paiementId: newAllocation.paiementId,
      detteId: newAllocation.detteId,
      montant_alloue: newAllocation.montant_alloue,
      ordre_priorite: newAllocation.ordre_priorite,
      date_allocation: newAllocation.date_allocation,
      createdAt: serverTimestamp(), // Firestore timestamp
    });

    return newAllocation;
  }

  /**
   * Crée plusieurs allocations en une seule opération (batch)
   *//*
  async createBatch(allocations: Omit<PaiementAllocation, 'id' | 'createdAt'>[]): Promise<PaiementAllocation[]> {
    const batch = writeBatch(this.db);
    const now = new Date().toISOString();
    const createdAllocations: PaiementAllocation[] = [];

    for (const allocation of allocations) {
      const id = this.generateId();
      const newAllocation: PaiementAllocation = {
        id,
        paiementId: allocation.paiementId,
        detteId: allocation.detteId,
        montant_alloue: allocation.montant_alloue,
        ordre_priorite: allocation.ordre_priorite,
        date_allocation: allocation.date_allocation || now,
        createdAt: now,  // ✅ Propriété createdAt bien définie
      };

      const docRef = doc(this.db, 'paiement_allocations', id);
      batch.set(docRef, {
        paiementId: newAllocation.paiementId,
        detteId: newAllocation.detteId,
        montant_alloue: newAllocation.montant_alloue,
        ordre_priorite: newAllocation.ordre_priorite,
        date_allocation: newAllocation.date_allocation,
        createdAt: serverTimestamp(),
      });
      
      createdAllocations.push(newAllocation);
    }

    await batch.commit();
    return createdAllocations;
  }

  /**
   * Récupère toutes les allocations d'un paiement
   *//*
  async getByPaiement(paiementId: string): Promise<PaiementAllocation[]> {
    const q = query(this.allocationsCol, where('paiementId', '==', paiementId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => this.fromFirestore(d.id, d.data()));
  }

  /**
   * Récupère toutes les allocations d'une dette
   *//*
  async getByDette(detteId: string): Promise<PaiementAllocation[]> {
    const q = query(this.allocationsCol, where('detteId', '==', detteId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => this.fromFirestore(d.id, d.data()));
  }

  /**
   * Récupère toutes les allocations (avec pagination optionnelle)
   *//*
  async getAll(limit?: number): Promise<PaiementAllocation[]> {
    const q = limit 
      ? query(this.allocationsCol)
      : query(this.allocationsCol);
    
    const snapshot = await getDocs(q);
    let allocations = snapshot.docs.map((d) => this.fromFirestore(d.id, d.data()));
    
    // Trier par date (plus récent d'abord)
    allocations = allocations.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    return limit ? allocations.slice(0, limit) : allocations;
  }

  /**
   * Calcule le total alloué à une dette
   *//*
  async getTotalAllouePourDette(detteId: string): Promise<number> {
    const allocations = await this.getByDette(detteId);
    return allocations.reduce((sum, a) => sum + a.montant_alloue, 0);
  }

  /**
   * Calcule le total alloué pour un paiement
   *//*
  async getTotalAllouePourPaiement(paiementId: string): Promise<number> {
    const allocations = await this.getByPaiement(paiementId);
    return allocations.reduce((sum, a) => sum + a.montant_alloue, 0);
  }

  /**
   * Vérifie si un paiement a déjà été alloué à une dette
   *//*
  async existeAllocation(paiementId: string, detteId: string): Promise<boolean> {
    const q = query(
      this.allocationsCol, 
      where('paiementId', '==', paiementId), 
      where('detteId', '==', detteId)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  }

  /**
   * Récupère les allocations pour un copropriétaire (via ses dettes)
   *//*
  async getByCoproprietaire(coproprietaireId: string): Promise<PaiementAllocation[]> {
    // Note: Cette méthode nécessite de joindre avec les dettes
    // Pour l'instant, on retourne un tableau vide
    // Idéalement, il faudrait faire une requête plus complexe
    console.warn('getByCoproprietaire non implémenté - nécessite une jointure');
    return [];
  }

  /**
   * Supprime une allocation
   *//*
  async delete(id: string): Promise<void> {
    const docRef = doc(this.db, 'paiement_allocations', id);
    await setDoc(docRef, { deleted: true, deletedAt: serverTimestamp() }, { merge: true });
    // Ou pour une suppression physique :
    // await deleteDoc(docRef);
  }

  /**
   * Supprime toutes les allocations d'un paiement
   *//*
  async deleteByPaiement(paiementId: string): Promise<number> {
    const allocations = await this.getByPaiement(paiementId);
    if (allocations.length === 0) return 0;

    const batch = writeBatch(this.db);
    allocations.forEach(alloc => {
      const docRef = doc(this.db, 'paiement_allocations', alloc.id);
      batch.delete(docRef);
    });

    await batch.commit();
    return allocations.length;
  }

  // ============================================
  // MÉTHODES PRIVÉES
  // ============================================

  private generateId(): string {
    return `ALLOC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private fromFirestore(id: string, data: any): PaiementAllocation {
    return {
      id,
      paiementId: data.paiementId || '',
      detteId: data.detteId || '',
      montant_alloue: data.montant_alloue || 0,
      ordre_priorite: data.ordre_priorite || 0,
      date_allocation: data.date_allocation || '',
      createdAt: this.toIsoString(data.createdAt) || new Date().toISOString(),
    };
  }

  private toIsoString(value: any): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (value.toDate) return value.toDate().toISOString();
    return undefined;
  }
}*/