import { Injectable, inject } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { AlerteService } from '../../notifications/services/alerte.service';

export type ReunionStatut = 'PLANIFIEE' | 'EN_COURS' | 'TERMINEE' | 'ANNULEE';
export type ReunionType   = 'AG_ORDINAIRE' | 'AG_EXTRAORDINAIRE' | 'CONSEIL' | 'TECHNIQUE' | 'AUTRE';

export interface PointOdj {
  id: string; titre: string; description?: string;
  dureeMinutes?: number; rapporteur?: string;
  necessite_vote: boolean; decision?: string;
  resultat_vote?: 'APPROUVE' | 'REFUSE' | 'AJOURNE';
}
export interface ParticipantReunion {
  userId: string; nom: string; role?: string; present: boolean; procuration?: string;
}
export interface Reunion {
  id?: string; titre: string; type: ReunionType; statut: ReunionStatut;
  date: string; heureDebut: string; heureFin?: string; lieu: string;
  description?: string; ordre_du_jour: PointOdj[];
  participants: ParticipantReunion[]; quorum?: number; quorumAtteint?: boolean;
  pvTexte?: string; pvUrl?: string; createdAt?: string; updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class ReunionService {
    // No static data array present. If you had any static Reunion[] or similar, it should be removed and initialized as an empty array.
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly COL = 'reunions';
  private readonly alerteSvc = inject(AlerteService);

  async getAll(): Promise<Reunion[]> {
    const q = query(collection(this.db, this.COL), orderBy('date', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Reunion));
  }
  async create(data: Omit<Reunion, 'id'|'createdAt'|'updatedAt'>): Promise<Reunion> {
    const now = new Date().toISOString();
    // Remove undefined fields because Firestore rejects undefined values
    const base = { ...data, statut: 'PLANIFIEE' } as Record<string, any>;
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined) payload[k] = v;
    }
    const ref = await addDoc(collection(this.db, this.COL), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const reunion = { id: ref.id, ...(payload as any) as Omit<Reunion, 'id'>, createdAt: now, updatedAt: now } as Reunion;

    // ── Alertes : ciblées par participant OU broadcast si "sélectionner tous" ──
    const participantIds = (data.participants || []).map(p => p.userId);
    this.alerteSvc.alerteNouvelleReunion({
      reunionId: ref.id,
      titre: data.titre,
      dateReunion: data.date,
      lieu: data.lieu,
      typeReunion: data.type,
      participantIds,
      notifierTous: participantIds.length === 0,
    }).catch(err => console.error('[Alerte] Erreur nouvelle réunion:', err));

    // ── Alertes de vote → ADMIN uniquement ──
    const pointsVote = (data.ordre_du_jour || []).filter(p => p.necessite_vote);
    for (const point of pointsVote) {
      this.alerteSvc.alerteVote({
        reunionId: ref.id,
        titrePoint: point.titre,
        // adminId sera undefined → l'admin verra l'alerte sans destinataireId
      }).catch(err => console.error('[Alerte] Erreur vote:', err));
    }

    return reunion;
  }
  async update(id: string, data: Partial<Reunion>): Promise<void> {
    // Strip undefined values before updating
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined) payload[k] = v;
    }
    await updateDoc(doc(this.db, this.COL, id), { ...payload, updatedAt: serverTimestamp() });
  }
  async changerStatut(id: string, statut: ReunionStatut): Promise<void> {
    await updateDoc(doc(this.db, this.COL, id), { statut, updatedAt: serverTimestamp() });

    // ── Alerte changement de statut ──
    this.alerteSvc.alerteStatutReunion({
      reunionId: id,
      titre: '', // Le titre sera affiché avec l'ID car on n'a pas le titre ici
      nouveauStatut: ReunionService.statutLabel(statut),
    }).catch(err => console.error('[Alerte] Erreur statut réunion:', err));
  }
  async delete(id: string): Promise<void> { await deleteDoc(doc(this.db, this.COL, id)); }

  static typeLabel(t: ReunionType): string {
    return { AG_ORDINAIRE:'AG Ordinaire', AG_EXTRAORDINAIRE:'AG Extraordinaire', CONSEIL:'Conseil Syndical', TECHNIQUE:'Réunion Technique', AUTRE:'Autre' }[t] ?? t;
  }
  static typeIcon(t: ReunionType): string {
    return { AG_ORDINAIRE:'🏛️', AG_EXTRAORDINAIRE:'⚡', CONSEIL:'👥', TECHNIQUE:'🔧', AUTRE:'📋' }[t] ?? '📋';
  }
  static statutColor(s: ReunionStatut): string {
    return { PLANIFIEE:'bg-blue-100 text-blue-800', EN_COURS:'bg-amber-100 text-amber-800', TERMINEE:'bg-emerald-100 text-emerald-800', ANNULEE:'bg-red-100 text-red-800' }[s] ?? '';
  }
  static statutLabel(s: ReunionStatut): string {
    return { PLANIFIEE:'Planifiée', EN_COURS:'En cours', TERMINEE:'Terminée', ANNULEE:'Annulée' }[s] ?? s;
  }
}
