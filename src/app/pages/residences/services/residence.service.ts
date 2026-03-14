import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, serverTimestamp, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';

export interface Residence {
  id: number;
  docId?: string;
  name: string;
  city?: string;
  address?: string;
  buildings?: number;
  apartments?: number;
  annualCharges?: string;
  fund?: string;
  manager?: string;
  status?: 'Actif' | 'En attente' | 'Audit';
  createdAt?: string;
  createdBy?: string;
}

@Injectable({ providedIn: 'root' })
export class ResidenceService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);

  private data: Residence[] = [];

  getAll(): Residence[] {
    return [...this.data];
  }

  async loadFromFirestore(): Promise<Residence[]> {
    const snapshot = await getDocs(collection(this.db, 'residences'));
    let idx = 1;
    const res: Residence[] = snapshot.docs.map((docSnap) => {
      const d = docSnap.data() as any;
      return {
        id: idx++,
        docId: docSnap.id,
        name: d.name || 'Résidence',
        city: d.city || d.ville || '',
        address: d.address || d.adresse || '',
        buildings: d.buildings ?? 0,
        apartments: d.apartments ?? 0,
        annualCharges: d.annualCharges || '',
        fund: d.fund || '',
        manager: d.manager || '',
        status: (d.status as Residence['status']) || 'Actif',
        createdAt: d.createdAt || new Date().toISOString(),
        createdBy: d.createdBy || undefined,
      };
    });
    if (!res.length) {
      // Keep seeded data when Firestore is empty
      return this.getAll();
    }
    this.data = res;
    return this.getAll();
  }

  create(payload: Partial<Residence>): Residence {
    const r: Residence = {
      id: this.nextId(),
      name: payload.name || 'Nouvelle résidence',
      city: payload.city,
      address: payload.address,
      buildings: payload.buildings ?? 0,
      apartments: payload.apartments ?? 0,
      annualCharges: payload.annualCharges || '',
      fund: payload.fund || '',
      manager: payload.manager || '',
      status: payload.status || 'Actif',
      createdAt: payload.createdAt || new Date().toISOString(),
      createdBy: payload.createdBy,
    };
    this.data = [r, ...this.data];
    return r;
  }

  async createAndPersist(payload: Partial<Residence>): Promise<Residence> {
    const p: any = payload as any;
    const profile = {
      name: payload.name || 'Nouvelle résidence',
      city: payload.city || p.ville || '',
      address: payload.address || p.adresse || '',
      buildings: payload.buildings ?? 0,
      apartments: payload.apartments ?? 0,
      annualCharges: payload.annualCharges || '',
      fund: payload.fund || '',
      manager: payload.manager || '',
      status: payload.status || 'Actif',
      createdAt: serverTimestamp(),
      createdBy: payload.createdBy || null,
    } as any;

    const ref = await addDoc(collection(this.db, 'residences'), profile);

    const created: Residence = {
      id: this.nextId(),
      docId: ref.id,
      name: profile.name,
      city: profile.city,
      address: profile.address,
      buildings: profile.buildings,
      apartments: profile.apartments,
      annualCharges: profile.annualCharges,
      fund: profile.fund,
      manager: profile.manager,
      status: profile.status,
      createdAt: new Date().toISOString(),
      createdBy: profile.createdBy || undefined,
    };

    this.data = [created, ...this.data];
    return created;
  }

  async updateAndPersist(residence: Residence): Promise<Residence> {
    // Update local cache first
    this.data = this.data.map((r) => (r.id === residence.id ? { ...r, ...residence } : r));

    if (residence.docId) {
      const ref = doc(this.db, 'residences', residence.docId);
      await updateDoc(ref, {
        name: residence.name,
        city: residence.city,
        address: residence.address,
        buildings: residence.buildings,
        apartments: residence.apartments,
        annualCharges: residence.annualCharges,
        fund: residence.fund,
        manager: residence.manager,
        status: residence.status,
        updatedAt: serverTimestamp(),
      });
    }

    return { ...residence };
  }

  async deleteAndPersist(residence: Residence): Promise<void> {
    this.data = this.data.filter((r) => r.id !== residence.id);

    if (residence.docId) {
      const ref = doc(this.db, 'residences', residence.docId);
      await deleteDoc(ref);
    }
  }

  private nextId(): number {
    const ids = this.data.map((r) => r.id);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }
}
