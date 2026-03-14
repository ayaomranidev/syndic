import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';

export type BudgetCategorie = 'ENTRETIEN' | 'CHARGES_COMMUNES' | 'TRAVAUX' | 'ASSURANCE' | 'ADMINISTRATION' | 'RESERVE' | 'AUTRE';
export type LigneType = 'DEPENSE' | 'RECETTE';
export type LigneStatut = 'PREVU' | 'ENGAGE' | 'PAYE' | 'ANNULE';

export interface LigneBudget {
  id?: string;
  annee: number;
  mois?: number;
  categorie: BudgetCategorie;
  type: LigneType;
  libelle: string;
  description?: string;
  montantPrevu: number;
  montantReel?: number;
  statut: LigneStatut;
  fournisseur?: string;
  reference?: string;
  dateEcheance?: string;
  datePaiement?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BudgetAnnuel {
  annee: number;
  totalPrevu: number;
  totalReel: number;
  totalRecettes: number;
  totalDepenses: number;
  ecart: number;
  tauxConsommation: number;
  lignes: LigneBudget[];
}

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly COL = 'budget_lignes';
  // No static data array present. If you had any static LigneBudget[] or similar, it should be removed and initialized as an empty array.

  async getByAnnee(annee: number): Promise<LigneBudget[]> {
    const q = query(collection(this.db, this.COL), where('annee', '==', annee), orderBy('categorie'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as LigneBudget));
  }
  async create(data: Omit<LigneBudget,'id'|'createdAt'|'updatedAt'>): Promise<LigneBudget> {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(this.db, this.COL), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { id: ref.id, ...data, createdAt: now, updatedAt: now };
  }
  async update(id: string, data: Partial<LigneBudget>): Promise<void> {
    await updateDoc(doc(this.db, this.COL, id), { ...data, updatedAt: serverTimestamp() });
  }
  async delete(id: string): Promise<void> { await deleteDoc(doc(this.db, this.COL, id)); }

  calculerBudget(lignes: LigneBudget[], annee: number): BudgetAnnuel {
    const depenses = lignes.filter(l => l.type === 'DEPENSE');
    const recettes = lignes.filter(l => l.type === 'RECETTE');
    const totalPrevu    = depenses.reduce((s, l) => s + l.montantPrevu, 0);
    const totalReel     = depenses.reduce((s, l) => s + (l.montantReel ?? 0), 0);
    const totalRecettes = recettes.reduce((s, l) => s + (l.montantReel ?? l.montantPrevu), 0);
    const totalDepenses = totalReel;
    return { annee, totalPrevu, totalReel, totalRecettes, totalDepenses,
      ecart: totalPrevu - totalReel,
      tauxConsommation: totalPrevu ? Math.round((totalReel / totalPrevu) * 100) : 0,
      lignes };
  }

  static catLabel(c: BudgetCategorie): string {
    return { ENTRETIEN:'Entretien', CHARGES_COMMUNES:'Charges communes', TRAVAUX:'Travaux', ASSURANCE:'Assurance', ADMINISTRATION:'Administration', RESERVE:'Réserve', AUTRE:'Autre' }[c] ?? c;
  }
  static catIcon(c: BudgetCategorie): string {
    return { ENTRETIEN:'🔧', CHARGES_COMMUNES:'🏠', TRAVAUX:'🏗️', ASSURANCE:'🛡️', ADMINISTRATION:'📋', RESERVE:'💰', AUTRE:'📦' }[c] ?? '📦';
  }
  static catColor(c: BudgetCategorie): string {
    return { ENTRETIEN:'bg-blue-100 text-blue-800', CHARGES_COMMUNES:'bg-slate-100 text-slate-700', TRAVAUX:'bg-orange-100 text-orange-800', ASSURANCE:'bg-purple-100 text-purple-800', ADMINISTRATION:'bg-cyan-100 text-cyan-800', RESERVE:'bg-emerald-100 text-emerald-800', AUTRE:'bg-gray-100 text-gray-700' }[c] ?? '';
  }
}