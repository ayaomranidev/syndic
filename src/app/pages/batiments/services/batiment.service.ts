import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, serverTimestamp, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';

export interface Batiment {
  id: number;
  docId?: string;
  name: string;
  residence?: string;
  residenceName?: string;
  residenceDocId?: string;
  residenceId?: string;
  floors?: number;
  apartmentsPerFloor?: number;
  units?: number;
  manager?: string;
  hasElevator?: boolean;
  status?: 'Actif' | 'En attente' | 'Audit' | 'Maintenance' | 'Inactif';
  createdAt?: string;
  createdBy?: string;
}

export interface Residence {
  docId: string;
  name: string;
  city?: string;
  address?: string;
}

@Injectable({ providedIn: 'root' })
export class BatimentService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);

  private data: Batiment[] = [];

  getAll(): Batiment[] {
    return [...this.data];
  }

  async loadFromFirestore(): Promise<Batiment[]> {
    const snapshot = await getDocs(collection(this.db, 'batiments'));
    let idx = 1;
    const list: Batiment[] = snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      const createdAtValue = d.createdAt?.toDate
        ? d.createdAt.toDate()
        : d.createdAt
        ? new Date(d.createdAt)
        : new Date();
      return {
        id: idx++,
        docId: docSnap.id,
        name: d.name || 'Bâtiment',
        residence: d.residence || '',
        residenceName: d.residenceName || d.residence || '',
        residenceDocId: d.residenceDocId || d.residenceId || undefined,
        residenceId: d.residenceId || d.residenceDocId || undefined,
        floors: d.floors ?? 0,
        apartmentsPerFloor: d.apartmentsPerFloor ?? d.unitsPerFloor ?? 0,
        units: d.units ?? 0,
        manager: d.manager || '',
        hasElevator: d.hasElevator ?? false,
        status: (d.status as Batiment['status']) || 'Actif',
        createdAt: createdAtValue,
        createdBy: d.createdBy || undefined,
      };
    });

    if (!list.length) {
      return this.getAll();
    }
    this.data = list;
    return this.getAll();
  }

  create(payload: Partial<Batiment>): Batiment {
    const b: Batiment = {
      id: this.nextId(),
      name: payload.name || 'Nouveau bâtiment',
      residence: payload.residence,
      floors: payload.floors ?? 0,
      apartmentsPerFloor: payload.apartmentsPerFloor ?? 0,
      units: payload.units ?? 0,
      manager: payload.manager || '',
      status: payload.status || 'Actif',
      createdAt: payload.createdAt || new Date().toISOString(),
      createdBy: payload.createdBy,
    };
    this.data = [b, ...this.data];
    return b;
  }

  async createAndPersist(payload: Partial<Batiment>): Promise<Batiment> {
    const effectiveResidenceId = payload.residenceDocId || (payload as any).residenceId || null;
    const docBody = {
      name: payload.name || 'Nouveau bâtiment',
      residence: payload.residence || '',
      residenceName: payload.residenceName || payload.residence || '',
      residenceDocId: effectiveResidenceId,
      residenceId: effectiveResidenceId,
      floors: payload.floors ?? 0,
      apartmentsPerFloor: payload.apartmentsPerFloor ?? 0,
      units: payload.units ?? 0,
      manager: payload.manager || '',
      hasElevator: payload.hasElevator ?? false,
      status: payload.status || 'Actif',
      createdAt: serverTimestamp(),
      createdBy: payload.createdBy || null,
    } as any;

    const ref = await addDoc(collection(this.db, 'batiments'), docBody);

    const created: Batiment = {
      id: this.nextId(),
      docId: ref.id,
      name: docBody.name,
      residence: docBody.residence,
      residenceName: docBody.residenceName,
      residenceDocId: docBody.residenceDocId,
      floors: docBody.floors,
      apartmentsPerFloor: docBody.apartmentsPerFloor,
      units: docBody.units,
      manager: docBody.manager,
      hasElevator: docBody.hasElevator,
      status: docBody.status,
      createdAt: new Date().toISOString(),
      createdBy: docBody.createdBy || undefined,
    };

    this.data = [created, ...this.data];
    return created;
  }

  async updateAndPersist(batiment: Batiment): Promise<Batiment> {
    this.data = this.data.map((b) => (b.id === batiment.id ? { ...b, ...batiment } : b));

    if (batiment.docId) {
      const ref = doc(this.db, 'batiments', batiment.docId);
      await updateDoc(ref, {
        name: batiment.name,
        residence: batiment.residence,
        residenceName: batiment.residenceName,
        residenceDocId: batiment.residenceDocId || batiment.residenceId || null,
        residenceId: batiment.residenceId || batiment.residenceDocId || null,
        floors: batiment.floors,
        apartmentsPerFloor: batiment.apartmentsPerFloor,
        units: batiment.units,
        manager: batiment.manager,
        hasElevator: batiment.hasElevator,
        status: batiment.status,
        updatedAt: serverTimestamp(),
      });
    }

    return { ...batiment };
  }

  async deleteAndPersist(batiment: Batiment): Promise<void> {
    this.data = this.data.filter((b) => b.id !== batiment.id);

    if (batiment.docId) {
      const ref = doc(this.db, 'batiments', batiment.docId);
      await deleteDoc(ref);
    }
  }

  private nextId(): number {
    const ids = this.data.map((b) => b.id);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }

  async loadResidences(): Promise<Residence[]> {
    const snapshot = await getDocs(collection(this.db, 'residences'));
    return snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      return {
        docId: docSnap.id,
        name: d.name || d.nom || 'Résidence',
        city: d.city || d.ville || '',
        address: d.address || d.adresse || '',
      } as Residence;
    });
  }
}