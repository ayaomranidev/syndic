import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  DocumentSnapshot,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { CacheService } from '../../../core/services/cache.service';

export type AppartementStatus = 'occupé' | 'vacant' | 'en_renovation';
export type AppartementType = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'Duplex' | 'Studio' | 'Maisonette';

export interface ResidenceRef {
  docId: string;
  name: string;
  city?: string;
  address?: string;
}

export interface BatimentRef {
  docId: string;
  name: string;
  residenceDocId?: string;
  residenceId?: string;
  floors?: number;
  residenceName?: string;
  hasElevator?: boolean;
}

export interface Appartement {
  docId?: string;
  numero: string;
  surface: number;
  nombrePieces: number;
  etage: number;
  batimentDocId?: string;
  batimentName?: string;
  residenceDocId?: string;
  residenceId?: string;
  residenceName?: string;
  type: AppartementType;
  statut: AppartementStatus;
  chargesMensuelles: number;
  quotePart: number;
  proprietaireId?: string;
  locataireId?: string;
  hasParking?: boolean;
  hasAscenseur?: boolean;
  caracteristiques: string[];
  createdAt?: Date;
  createdBy?: string;
}

@Injectable({ providedIn: 'root' })
export class AppartementService {
  constructor(private cache: CacheService) {
    // Initialisation dans le constructeur
    this.app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    this.db = getFirestore(this.app);
    this.appartementsCol = collection(this.db, 'appartements');
    this.residencesCol = collection(this.db, 'residences');
    this.batimentsCol = collection(this.db, 'batiments');
  }

  private readonly app;
  private readonly db;
  private readonly appartementsCol;
  private readonly residencesCol;
  private readonly batimentsCol;

  // ✅ CORRECTION : Méthode implémentée correctement
  async getBatiments(residenceDocId?: string | null): Promise<BatimentRef[]> {
    return this.loadBatiments(residenceDocId);
  }

  private toDate(value: any): Date {
    if (!value) return new Date();
    if (value.toDate) return value.toDate();
    return new Date(value);
  }

  async loadAppartements(): Promise<Appartement[]> {
    const q = query(this.appartementsCol, orderBy('numero'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => this.fromFirestore(docSnap));
  }

  async getById(docId: string): Promise<Appartement | null> {
    const ref = doc(this.db, 'appartements', docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return this.fromFirestore(snap);
  }

  async addAppartement(payload: Appartement): Promise<Appartement> {
    const hasParking = Boolean(payload.hasParking || (payload.caracteristiques || []).includes('Parking'));
    const hasAscenseur = Boolean(payload.hasAscenseur || (payload.caracteristiques || []).includes('Ascenseur'));
    const effectiveResidenceId = payload.residenceDocId || (payload as any).residenceId || null;

    const body = this.clean({
      ...payload,
      residenceDocId: effectiveResidenceId,
      residenceId: effectiveResidenceId,
      proprietaireId: payload.proprietaireId ?? null,
      locataireId: payload.locataireId ?? null,
      hasParking,
      hasAscenseur,
      createdAt: serverTimestamp(),
    });

    const ref = await addDoc(this.appartementsCol, body);
    try { 
      this.cache.clearAppartements(); 
      this.cache.clearRepartitions(); 
    } catch (e) { /* ignore */ }
    
    return { ...payload, docId: ref.id, hasParking, hasAscenseur, createdAt: new Date() };
  }

  async updateAppartement(docId: string, payload: Partial<Appartement>): Promise<void> {
    const ref = doc(this.db, 'appartements', docId);
    const hasParking = Boolean(payload.hasParking || (payload.caracteristiques || []).includes('Parking'));
    const hasAscenseur = Boolean(payload.hasAscenseur || (payload.caracteristiques || []).includes('Ascenseur'));

    // Résoudre residenceId depuis le payload en priorité, sinon lire le doc actuel
    let effectiveResidenceId: string | null =
      payload.residenceDocId || (payload as any).residenceId || null;

    if (!effectiveResidenceId) {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const existing = snap.data() as any;
          effectiveResidenceId = existing.residenceId || existing.residenceDocId || null;
        }
      } catch (e) {
        console.warn('[AppartementService] Impossible de lire le doc pour residenceId:', e);
      }
    }

    const updateBody: Record<string, any> = {
      ...payload,
      proprietaireId: payload.proprietaireId ?? null,
      locataireId: payload.locataireId ?? null,
      hasParking,
      hasAscenseur,
    };

    if (effectiveResidenceId) {
      updateBody['residenceDocId'] = effectiveResidenceId;
      updateBody['residenceId'] = effectiveResidenceId;
    }

    await updateDoc(ref, this.clean(updateBody));
    try { 
      this.cache.clearAppartements(); 
      this.cache.clearRepartitions(); 
    } catch (e) { /* ignore */ }
  }

  async deleteAppartement(docId: string): Promise<void> {
    const ref = doc(this.db, 'appartements', docId);
    await deleteDoc(ref);
    try { 
      this.cache.clearAppartements(); 
      this.cache.clearRepartitions(); 
    } catch (e) { /* ignore */ }
  }

  async loadResidences(): Promise<ResidenceRef[]> {
    const snapshot = await getDocs(this.residencesCol);
    return snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      return {
        docId: docSnap.id,
        name: d.name || d.nom || 'Résidence',
        city: d.city || d.ville || '',
        address: d.address || d.adresse || '',
      } as ResidenceRef;
    });
  }

  async loadBatiments(residenceDocId?: string | null): Promise<BatimentRef[]> {
    const q = query(this.batimentsCol, orderBy('name'));
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      return {
        docId: docSnap.id,
        name: d.name || d.nom || 'Bâtiment',
        residenceDocId: d.residenceDocId || d.residenceId || null,
        residenceId: d.residenceId || d.residenceDocId || null,
        residenceName: d.residenceName || d.residence || '',
        floors: Number(d.floors ?? d.nombreEtages ?? 0) || 0,
        hasElevator: d.hasElevator ?? d.ascenseur ?? false,
      } as BatimentRef;
    });
    
    if (!residenceDocId) return list;
    return list.filter((b) => (b.residenceDocId || b.residenceId || null) === residenceDocId);
  }

  private clean<T extends Record<string, any>>(obj: T): T {
    const cleaned: any = {};
    Object.keys(obj).forEach((k) => {
      const v = (obj as any)[k];
      if (v !== undefined) cleaned[k] = v;
    });
    return cleaned as T;
  }

  private fromFirestore(
    docSnap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
  ): Appartement {
    const d = docSnap.data() as any;
    return {
      docId: docSnap.id,
      numero: d.numero || 'Nouveau',
      surface: Number(d.surface) || 0,
      nombrePieces: Number(d.nombrePieces) || 1,
      etage: Number(d.etage) || 0,
      batimentDocId: d.batimentDocId || null,
      batimentName: d.batimentName || '',
      residenceDocId: d.residenceDocId || d.residenceId || null,
      residenceId: d.residenceId || d.residenceDocId || null,
      residenceName: d.residenceName || '',
      type: (d.type as AppartementType) || 'T2',
      statut: (d.statut as AppartementStatus) || 'vacant',
      chargesMensuelles: Number(d.chargesMensuelles) || 0,
      quotePart: Number(d.quotePart) || 0,
      proprietaireId: d.proprietaireId || d.proprietaire_id || d.coproprietaireId || undefined,
      locataireId: d.locataireId || d.locataire_id || undefined,
      hasParking: Boolean(d.hasParking || d.parking || (d.caracteristiques || []).includes('Parking')),
      hasAscenseur: Boolean(d.hasAscenseur || (d.caracteristiques || []).includes('Ascenseur')),
      caracteristiques: d.caracteristiques || [],
      createdAt: this.toDate(d.createdAt),
      createdBy: d.createdBy || undefined,
    };
  }
}