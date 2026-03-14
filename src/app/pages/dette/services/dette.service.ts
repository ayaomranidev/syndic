import { Injectable } from '@angular/core';
import { 
  initializeApp, 
  getApps, 
  getApp 
} from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { Charge } from '../../../models/charge.model';
import { Appartement, AppartementService } from '../../appartements/services/appartement.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { User } from '../../../models/user.model';
import { 
  Dette, 
  CreateDettePayload, 
  UpdateDettePayload,
  DetteStatus,
  DettePriorite,
  DetteStats,
  calculerArrieresParAnnee,
  trierDettesParPriorite
} from '../../../models/dette.model';

// Fonctions utilitaires pour les rôles (importées depuis user.model)
const isGlobalAdmin = (user: User): boolean => {
  return (user.roles || []).includes('ADMIN');
};

const isAdminForResidence = (user: User, residenceId: string): boolean => {
  if (isGlobalAdmin(user)) return true;
  return (
    (user.roles || []).includes('ADMIN_RESIDENCE') &&
    user.residenceId === residenceId
  );
};

@Injectable({
  providedIn: 'root'
})
export class DetteService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);
  private readonly dettesCol = collection(this.db, 'dettes');
  
  // Cache
  private dettesCache: Map<string, Dette[]> = new Map();
  private allDettesCache: Dette[] | null = null;
  private lastFetch: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 secondes

  constructor(
    private readonly appartementService: AppartementService,
    private readonly userService: UserService,
  ) {}

  // ============================================
  // MÉTHODES DE RECHERCHE ET LISTAGE
  // ============================================

  /**
   * ✅ CORRIGÉ: Ajout du paramètre currentUser pour le filtrage par rôle
   */
  async getAll(forceRefresh: boolean = false, currentUser?: User): Promise<Dette[]> {
    const now = Date.now();
    
    // Cache global uniquement pour SUPER_ADMIN ou sans utilisateur
    if (!currentUser || isGlobalAdmin(currentUser)) {
      if (!forceRefresh && this.allDettesCache && (now - this.lastFetch) < this.CACHE_DURATION) {
        return this.allDettesCache;
      }
    }

    try {
      console.log('📥 Chargement des dettes depuis Firestore...');
      
      // ✅ Construction de la requête avec filtrage selon le rôle
      let q;
      if (!currentUser || isGlobalAdmin(currentUser)) {
        // SUPER_ADMIN ou appel sans contexte → toutes les dettes (tri en mémoire)
        q = query(this.dettesCol);
      } else if ((currentUser.roles || []).includes('ADMIN_RESIDENCE') && currentUser.residenceId) {
        // ADMIN_RESIDENCE → dettes des appartements de sa résidence
        // NOTE: removed orderBy to avoid requiring a composite index for residenceId + order fields
        q = query(
          this.dettesCol,
          where('residenceId', '==', currentUser.residenceId)
        );
      } else {
        // COPROPRIETAIRE / LOCATAIRE → uniquement ses propres dettes
        // Removed orderBy to avoid composite index requirement; sort in-memory instead
        q = query(
          this.dettesCol,
          where('coproprietaireId', '==', String(currentUser.firebaseUid || currentUser.id))
        );
      }
      
      const snapshot = await getDocs(q);
      
      const dettes: Dette[] = [];
      
      // Ne pas vider tout le cache, seulement mettre à jour
      snapshot.docs.forEach(doc => {
        const dette = this.fromFirestore(doc.id, doc.data());
        dettes.push(dette);
        
        // Mettre à jour le cache par copropriétaire
        if (!this.dettesCache.has(dette.coproprietaireId)) {
          this.dettesCache.set(dette.coproprietaireId, []);
        }
        const cached = this.dettesCache.get(dette.coproprietaireId)!;
        const existingIndex = cached.findIndex(d => d.id === dette.id);
        if (existingIndex >= 0) {
          cached[existingIndex] = dette;
        } else {
          cached.push(dette);
        }
      });
      
      // Ne stocker en cache global que pour SUPER_ADMIN
      if (!currentUser || isGlobalAdmin(currentUser)) {
        this.allDettesCache = dettes;
        this.lastFetch = now;
      }
      
      console.log(`✅ ${dettes.length} dettes chargées`);
      return dettes.sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    } catch (error) {
      console.error('❌ Erreur lors du chargement des dettes:', error);
      return this.allDettesCache || [];
    }
  }

  async getById(id: string): Promise<Dette | null> {
    try {
      const ref = doc(this.db, 'dettes', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return this.fromFirestore(snap.id, snap.data());
    } catch (error) {
      console.error('❌ Erreur lors du chargement de la dette:', error);
      return null;
    }
  }

  async getByCoproprietaire(coproprietaireId: string, includePayees: boolean = false): Promise<Dette[]> {
    // Vérifier le cache d'abord
    const cached = this.dettesCache.get(coproprietaireId);
    if (cached) {
      let dettes = [...cached];
      if (!includePayees) {
        dettes = dettes.filter(d => d.statut !== 'PAYEE' && d.statut !== 'ANNULEE');
      }
      return dettes.sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    }

    try {
      const q = query(
        this.dettesCol,
        where('coproprietaireId', '==', coproprietaireId)
      );

      const snapshot = await getDocs(q);
      let dettes = snapshot.docs.map(doc => this.fromFirestore(doc.id, doc.data()));
      
      // Mettre en cache
      this.dettesCache.set(coproprietaireId, dettes);
      
      if (!includePayees) {
        dettes = dettes.filter(d => d.statut !== 'PAYEE' && d.statut !== 'ANNULEE');
      }
      
      return dettes.sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    } catch (error) {
      console.error('❌ Erreur lors du chargement des dettes du copropriétaire:', error);
      return [];
    }
  }

  async getDettesNonSoldees(coproprietaireId: string): Promise<Dette[]> {
    return this.getByCoproprietaire(coproprietaireId, false);
  }

  async getByAnnee(annee: number): Promise<Dette[]> {
    try {
      const q = query(
        this.dettesCol,
        where('annee', '==', annee)
      );
      const snapshot = await getDocs(q);
      const dettes = snapshot.docs.map(doc => this.fromFirestore(doc.id, doc.data()));
      return dettes.sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    } catch (error) {
      console.error('❌ Erreur lors du chargement des dettes par année:', error);
      return [];
    }
  }

  async getByAppartement(appartementId: string): Promise<Dette[]> {
    try {
      const q = query(
        this.dettesCol,
        where('appartementId', '==', appartementId)
      );
      const snapshot = await getDocs(q);
      const dettes = snapshot.docs.map(doc => this.fromFirestore(doc.id, doc.data()));
      return dettes.sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    } catch (error) {
      console.error('❌ Erreur lors du chargement des dettes par appartement:', error);
      return [];
    }
  }

  async getByPeriode(annee: number, mois: number): Promise<Dette[]> {
    try {
      const q = query(
        this.dettesCol,
        where('annee', '==', annee),
        where('mois', '==', mois)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => this.fromFirestore(doc.id, doc.data()));
    } catch (error) {
      console.error('❌ Erreur lors du chargement des dettes par période:', error);
      return [];
    }
  }

  async getByAppartementAndMonth(
    appartementId: string,
    annee: number,
    mois: number,
    chargeId?: string,
  ): Promise<Dette | null> {
    try {
      const conditions: any[] = [
        where('appartementId', '==', appartementId),
        where('annee', '==', annee),
        where('mois', '==', mois),
      ];
      if (chargeId) conditions.push(where('chargeId', '==', chargeId));
      const q = query(this.dettesCol, ...conditions);
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        // Fallback: sans filtre chargeId si la dette existe pour cet appartement/période
        if (chargeId) return this.getByAppartementAndMonth(appartementId, annee, mois);
        return null;
      }
      return this.fromFirestore(snapshot.docs[0].id, snapshot.docs[0].data());
    } catch (error) {
      console.error('❌ Erreur lors du chargement de la dette:', error);
      return null;
    }
  }

  // ============================================
  // MÉTHODES DE CRÉATION
  // ============================================

  async create(payload: CreateDettePayload, userId?: string): Promise<Dette> {
    // Validation stricte
    this.validerPayload(payload);

    try {
      const now = new Date().toISOString();
      const id = this.generateId(payload.annee, payload.mois, payload.appartementId, payload.chargeId);
      
      // Vérifier si la dette existe déjà
      const existing = await this.getById(id);
      if (existing) {
        throw new Error(`Une dette existe déjà pour ${payload.mois}/${payload.annee} (appartement ${payload.appartementId})`);
      }

      const detteObj: any = {
        id,
        appartementId: payload.appartementId,
        chargeId: payload.chargeId,
        repartitionId: payload.repartitionId,
        residenceId: payload.residenceId, // ✅ NOUVEAU: pour filtrage ADMIN_RESIDENCE
        annee: payload.annee,
        mois: payload.mois,
        montant_original: payload.montant_original,
        montant_paye: 0,
        montant_restant: payload.montant_original,
        date_creation: now,
        date_echeance: payload.date_echeance,
        statut: 'IMPAYEE',
        priorite: this.calculerPrioriteInitiale(payload.date_echeance),
        nb_relances: 0,
        paiement_ids: [],
        notes: payload.notes,
        created_at: now,
        updated_at: now,
        updated_by: userId
      };

      if (payload.coproprietaireId) {
        detteObj.coproprietaireId = payload.coproprietaireId;
      }

      console.log(`📝 Création dette: ${id} - ${payload.montant_original} DT (copro: ${payload.coproprietaireId})`);
      
      const docRef = doc(this.db, 'dettes', id);
      await setDoc(docRef, this.sanitizeForFirestore({
        ...detteObj,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      }));

      // Invalider le cache
      if (payload.coproprietaireId) this.dettesCache.delete(payload.coproprietaireId);
      this.allDettesCache = null;

      return detteObj as Dette;
    } catch (error) {
      console.error('❌ Erreur lors de la création de la dette:', error);
      throw error;
    }
  }

  async createBatch(dettes: CreateDettePayload[], userId?: string): Promise<Dette[]> {
    if (!dettes.length) return [];

    const batch = writeBatch(this.db);
    const now = new Date().toISOString();
    const createdDettes: Dette[] = [];
    const coprosImpactes = new Set<string>();

    for (const payload of dettes) {
      try {
        this.validerPayload(payload);
        
        const id = this.generateId(payload.annee, payload.mois, payload.appartementId, payload.chargeId);
        
        // Vérifier si la dette existe déjà
        const existing = await this.getById(id);
        if (existing) {
          console.log(`Dette existante ignorée: ${id}`);
          continue;
        }
        
        const detteObj: any = {
          id,
          appartementId: payload.appartementId,
          chargeId: payload.chargeId,
          repartitionId: payload.repartitionId,
          residenceId: payload.residenceId, // ✅ NOUVEAU: pour filtrage ADMIN_RESIDENCE
          annee: payload.annee,
          mois: payload.mois,
          montant_original: payload.montant_original,
          montant_paye: 0,
          montant_restant: payload.montant_original,
          date_creation: now,
          date_echeance: payload.date_echeance,
          statut: 'IMPAYEE',
          priorite: this.calculerPrioriteInitiale(payload.date_echeance),
          nb_relances: 0,
          paiement_ids: [],
          notes: payload.notes,
          created_at: now,
          updated_at: now,
          updated_by: userId
        };

        if (payload.coproprietaireId) {
          detteObj.coproprietaireId = payload.coproprietaireId;
        }

        const docRef = doc(this.db, 'dettes', id);
        batch.set(docRef, this.sanitizeForFirestore({
          ...detteObj,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }));

        createdDettes.push(detteObj as Dette);
        if (payload.coproprietaireId) coprosImpactes.add(payload.coproprietaireId);
      } catch (error) {
        console.error(`❌ Erreur création dette pour appartement ${payload.appartementId}:`, error);
      }
    }

    if (createdDettes.length > 0) {
      await batch.commit();
      
      // Invalider le cache
      coprosImpactes.forEach(coproId => this.dettesCache.delete(coproId));
      this.allDettesCache = null;
    }
    
    return createdDettes;
  }

  async createBatchFromCharge(charge: Charge, userId?: string): Promise<Dette[]> {
    try {
      // 1. Récupérer tous les appartements
      const appartements = await this.appartementService.loadAppartements();
      
      // 2. Filtrer selon le scope
      const appartementsConcernes = this.filterAppartementsByScope(appartements, charge);
      
      if (appartementsConcernes.length === 0) {
        console.warn('⚠️ Aucun appartement concerné par cette charge');
        return [];
      }

      // 3. Calculer le montant mensuel
      const montantMensuel = this.calculerMontantMensuel(charge);
      
      // 4. Calculer les poids
      const poids = this.calculerPoids(appartementsConcernes, charge.mode_repartition);
      
      if (poids.total === 0) {
        console.warn('⚠️ Total des poids est zéro, impossible de répartir');
        return [];
      }

      // 5. Calculer la durée
      const dureeMois = charge.duree_mois || 1;
      const dateDebut = new Date(charge.date_debut);

      // 5bis. Charger les utilisateurs pour la proratisation
      const users = await this.userService.loadFromFirestore();
      const userByAptId = new Map<string, User>();
      for (const u of users) {
        if (u.appartementId) {
          userByAptId.set(String(u.appartementId), u);
        }
      }
      
      // 6. Créer les payloads
      const dettesPayload: CreateDettePayload[] = [];

      for (let i = 0; i < dureeMois; i++) {
        const dateMois = new Date(dateDebut);
        dateMois.setMonth(dateDebut.getMonth() + i);
        const annee = dateMois.getFullYear();
        const mois = dateMois.getMonth() + 1;
        const dateEcheance = new Date(annee, mois, 0).toISOString().split('T')[0];

        for (const appartement of appartementsConcernes) {
          if (!appartement.docId) continue;

          // Vérifier la présence de l'utilisateur (proratisation)
          const prorata = this.verifierPresenceUtilisateur(
            userByAptId.get(appartement.docId),
            annee,
            mois,
          );
          if (prorata <= 0) continue;

          // ← CORRECTION : mode INDIVIDUEL (parking/ascenseur) → montant fixe complet par appartement
          // Pour les autres modes : répartition proportionnelle normale
          let montant: number;
          if ((charge.mode_repartition as any) === 'INDIVIDUEL' || charge.scope === 'parking') {
            // Mode INDIVIDUEL (ou scope parking) : chaque appartement paie le montant COMPLET
            montant = montantMensuel;
          } else {
            const quotePart = poids.poids.get(appartement.docId) || 0;
            montant = poids.total > 0 ? (montantMensuel * quotePart) / poids.total : 0;
          }

          // Appliquer le prorata
          montant = montant * prorata;

          if (montant <= 0) continue;

          // Résoudre le copropriétaire (undefined si absent)
          const coproId = this.resoudreCoproprietaireId(appartement);

          const payload: CreateDettePayload = {
            appartementId: appartement.docId,
            chargeId: charge.id,
            residenceId: appartement.residenceDocId, // ✅ NOUVEAU: propager residenceId
            annee,
            mois,
            montant_original: Math.round(montant * 100) / 100,
            date_echeance: dateEcheance,
            notes: `${charge.libelle} - ${mois}/${annee}`,
          };

          if (coproId) payload.coproprietaireId = coproId;

          dettesPayload.push(payload);
        }
      }

      if (dettesPayload.length === 0) {
        return [];
      }

      return await this.createBatch(dettesPayload, userId);
    } catch (error) {
      console.error('❌ Erreur lors de la création des dettes depuis la charge:', error);
      throw error;
    }
  }

  // ============================================
  // MÉTHODES DE MISE À JOUR
  // ============================================

  async update(id: string, payload: UpdateDettePayload, userId?: string): Promise<Dette | null> {
    try {
      const dette = await this.getById(id);
      if (!dette) {
        console.error(`❌ Dette non trouvée: ${id}`);
        return null;
      }

      console.log(`📝 Mise à jour dette ${id}:`, payload);

      const ref = doc(this.db, 'dettes', id);
      const updateData: any = {};

      // Gestion du paiement
      if (payload.montant_paye !== undefined) {
        const nouveauPaye = (dette.montant_paye || 0) + payload.montant_paye;
        updateData.montant_paye = nouveauPaye;
        updateData.montant_restant = Math.max(0, dette.montant_original - nouveauPaye);
        
        if (updateData.montant_restant <= 0) {
          updateData.statut = 'PAYEE';
          updateData.date_solde = new Date().toISOString();
        } else if (nouveauPaye > 0) {
          updateData.statut = 'PARTIELLEMENT_PAYEE';
        }
      }

      // Ajout d'un paiement
      if (payload.paiement_ids && payload.paiement_ids.length > 0) {
        const currentIds = dette.paiement_ids || [];
        updateData.paiement_ids = [...new Set([...currentIds, ...payload.paiement_ids])];
      }

      // Autres champs
      if (payload.priorite) updateData.priorite = payload.priorite;
      if (payload.nb_relances !== undefined) updateData.nb_relances = payload.nb_relances;
      if (payload.date_dernier_rappel) updateData.date_dernier_rappel = payload.date_dernier_rappel;
      if (payload.notes !== undefined) updateData.notes = payload.notes;
      if (payload.penalite !== undefined) updateData.penalite = payload.penalite;
      if (payload.interets !== undefined) updateData.interets = payload.interets;

      updateData.updated_at = serverTimestamp();
      if (userId) updateData.updated_by = userId;

      await updateDoc(ref, updateData);
      
      // Invalider le cache
      this.dettesCache.delete(dette.coproprietaireId);
      this.allDettesCache = null;

      return await this.getById(id);
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour de la dette:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const dette = await this.getById(id);
      if (!dette) return false;

      const ref = doc(this.db, 'dettes', id);
      await deleteDoc(ref);
      
      // Invalider le cache
      this.dettesCache.delete(dette.coproprietaireId);
      this.allDettesCache = null;
      
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la suppression de la dette:', error);
      return false;
    }
  }

async deleteByCharge(chargeId: string): Promise<number> {
  try {
    const q = query(this.dettesCol, where('chargeId', '==', chargeId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return 0;

    const batch = writeBatch(this.db);
    const coprosImpactes = new Set<string>();
    
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      
      const coproId = data['coproprietaireId'];
      if (coproId && typeof coproId === 'string') {
        coprosImpactes.add(coproId);
      }
      
      batch.delete(docSnap.ref);
    });
    
    await batch.commit();
    
    // Invalider le cache
    coprosImpactes.forEach(coproId => this.dettesCache.delete(coproId));
    this.allDettesCache = null;
    
    return snapshot.size;
  } catch (error) {
    console.error('❌ Erreur lors de la suppression des dettes liées à la charge:', error);
    return 0;
  }
}

  // ============================================
  // MÉTHODES DE PAIEMENT
  // ============================================

  async affecterPaiement(
    detteId: string, 
    montant: number, 
    paiementId: string,
    userId?: string
  ): Promise<Dette | null> {
    try {
      const dette = await this.getById(detteId);
      if (!dette) return null;

      const montantAAffecter = Math.min(montant, dette.montant_restant);
      console.log(`💰 Affectation ${montantAAffecter} DT à la dette ${detteId}`);

      const updated = await this.update(detteId, {
        montant_paye: montantAAffecter,
        paiement_ids: [paiementId]
      }, userId);

      // Reverse sync: mettre à jour le statut du paiement dans Firestore
      if (updated && paiementId) {
        const statusPaiement = updated.statut === 'PAYEE' ? 'paid'
          : updated.statut === 'PARTIELLEMENT_PAYEE' ? 'partial'
          : 'pending';
        try {
          const paiRef = doc(this.db, 'paiements', paiementId);
          await updateDoc(paiRef, {
            status: statusPaiement,
            statutWorkflow: statusPaiement === 'paid' ? 'valide' : 'en_attente',
            updated_at: serverTimestamp(),
          });
        } catch (_) { /* paiement may not be a Firestore doc */ }
      }

      return updated;
    } catch (error) {
      console.error('❌ Erreur lors de l\'affectation du paiement:', error);
      return null;
    }
  }

  async affecterPaiementFIFO(
    coproprietaireId: string, 
    montant: number, 
    paiementId: string,
    userId?: string
  ): Promise<{
    success: boolean;
    montantAlloue: number;
    dettesImpactees: string[];
    restantNonAlloue: number;
  }> {
    console.log(`💰 Affectation FIFO pour copropriétaire ${coproprietaireId} - Montant: ${montant} DT`);
    
    if (montant <= 0) {
      return { success: false, montantAlloue: 0, dettesImpactees: [], restantNonAlloue: montant };
    }

    const dettes = await this.getByCoproprietaire(coproprietaireId, false);
    if (!dettes.length) {
      return { success: false, montantAlloue: 0, dettesImpactees: [], restantNonAlloue: montant };
    }

    const dettesTriees = trierDettesParPriorite(dettes);

    let restant = montant;
    const dettesImpactees: string[] = [];

    for (const dette of dettesTriees) {
      if (restant <= 0) break;

      const aAffecter = Math.min(restant, dette.montant_restant);
      
      const updated = await this.affecterPaiement(dette.id, aAffecter, paiementId, userId);

      if (updated) {
        dettesImpactees.push(dette.id);
        restant -= aAffecter;
      }
    }

    const montantAlloue = montant - restant;

    return {
      success: montantAlloue > 0,
      montantAlloue,
      dettesImpactees,
      restantNonAlloue: restant
    };
  }

  async marquerCommeSoldee(detteId: string, userId?: string): Promise<Dette | null> {
    const dette = await this.getById(detteId);
    if (!dette) return null;

    const ref = doc(this.db, 'dettes', detteId);
    await updateDoc(ref, {
      montant_paye: dette.montant_original,
      montant_restant: 0,
      statut: 'PAYEE',
      date_solde: new Date().toISOString(),
      updated_at: serverTimestamp(),
      updated_by: userId || null
    });

    this.dettesCache.delete(dette.coproprietaireId);
    this.allDettesCache = null;
    
    return this.getById(detteId);
  }

  async ajouterRelance(detteId: string, userId?: string): Promise<Dette | null> {
    const dette = await this.getById(detteId);
    if (!dette) return null;

    return this.update(detteId, {
      nb_relances: (dette.nb_relances || 0) + 1,
      date_dernier_rappel: new Date().toISOString()
    }, userId);
  }

  async incrementerRelances(coproprietaireId: string, userId?: string): Promise<void> {
    const dettes = await this.getByCoproprietaire(coproprietaireId, false);
    if (!dettes.length) return;

    const batch = writeBatch(this.db);

    dettes.forEach((dette) => {
      const ref = doc(this.db, 'dettes', dette.id);
      batch.update(ref, {
        nb_relances: (dette.nb_relances || 0) + 1,
        date_dernier_rappel: new Date().toISOString(),
        updated_at: serverTimestamp(),
        updated_by: userId || null
      });
    });

    await batch.commit();
    
    this.dettesCache.delete(coproprietaireId);
    this.allDettesCache = null;
  }

  // ============================================
  // STATISTIQUES
  // ============================================

  async getStats(coproprietaireId: string): Promise<DetteStats> {
    const dettes = await this.getByCoproprietaire(coproprietaireId, true);
    
    const stats: DetteStats = {
      total_du: 0,
      total_paye: 0,
      total_restant: 0,
      par_annee: {},
      par_priorite: {
        URGENTE: 0,
        NORMALE: 0,
        FAIBLE: 0
      },
      nombre_dettes: dettes.length,
      nombre_dettes_impayees: 0,
      nombre_dettes_partiellement_payees: 0,
      nombre_dettes_payees: 0,
      dette_plus_ancienne: null
    };

    let anneePlusAncienne = Number.MAX_SAFE_INTEGER;
    let moisPlusAncien = 13;

    dettes.forEach(dette => {
      stats.total_du += dette.montant_original;
      stats.total_paye += dette.montant_paye;
      stats.total_restant += dette.montant_restant;

      const anneeStr = dette.annee.toString();
      if (!stats.par_annee[anneeStr]) {
        stats.par_annee[anneeStr] = {
          total_original: 0,
          total_paye: 0,
          total_restant: 0,
          nombre_mois: 0,
          mois_impayes: []
        };
      }
      
      stats.par_annee[anneeStr].total_original += dette.montant_original;
      stats.par_annee[anneeStr].total_paye += dette.montant_paye;
      stats.par_annee[anneeStr].total_restant += dette.montant_restant;
      stats.par_annee[anneeStr].nombre_mois++;
      
      if (dette.montant_restant > 0) {
        stats.par_annee[anneeStr].mois_impayes.push(dette.mois);
      }

      stats.par_priorite[dette.priorite]++;

      if (dette.statut === 'IMPAYEE') stats.nombre_dettes_impayees++;
      else if (dette.statut === 'PARTIELLEMENT_PAYEE') stats.nombre_dettes_partiellement_payees++;
      else if (dette.statut === 'PAYEE') stats.nombre_dettes_payees++;

      if (dette.annee < anneePlusAncienne || 
          (dette.annee === anneePlusAncienne && dette.mois < moisPlusAncien)) {
        anneePlusAncienne = dette.annee;
        moisPlusAncien = dette.mois;
        stats.dette_plus_ancienne = {
          annee: dette.annee,
          mois: dette.mois,
          montant: dette.montant_restant
        };
      }
    });

    return stats;
  }

  async getArrieresParAnnee(coproprietaireId: string): Promise<{ [annee: string]: number }> {
    const dettes = await this.getByCoproprietaire(coproprietaireId, false);
    return calculerArrieresParAnnee(dettes);
  }

  async getTotalRestant(coproprietaireId: string): Promise<number> {
    const dettes = await this.getByCoproprietaire(coproprietaireId, false);
    return dettes.reduce((sum, dette) => sum + dette.montant_restant, 0);
  }

  // ============================================
  // MÉTHODES PRIVÉES
  // ============================================

  /**
   * Vérifie si un utilisateur est présent pour un mois donné et retourne
   * un coefficient de prorata (0 = absent, 1 = mois complet, 0..1 = partiel).
   */
  private verifierPresenceUtilisateur(
    user: User | undefined,
    annee: number,
    mois: number,
  ): number {
    if (!user || !user.date_entree) return 1;

    const premierJour = new Date(annee, mois - 1, 1);
    const dernierJour = new Date(annee, mois, 0);
    const nbJoursMois = dernierJour.getDate();
    const dateEntree = new Date(user.date_entree);

    // L'utilisateur n'a pas encore emménagé à cette période
    if (dateEntree > dernierJour) return 0;

    // Vérifier date_sortie si elle existe
    if (user.date_sortie) {
      const dateSortie = new Date(user.date_sortie);
      if (dateSortie < premierJour) return 0;

      // Sortie dans le mois courant
      if (dateSortie <= dernierJour) {
        const jourSortie = dateSortie.getDate();
        const joursPresents = Math.max(1, jourSortie);
        // Combiner avec l'entrée si elle est aussi dans ce mois
        if (dateEntree >= premierJour) {
          const jourEntree = dateEntree.getDate();
          const jours = Math.max(1, jourSortie - jourEntree + 1);
          return Math.round((jours / nbJoursMois) * 100) / 100;
        }
        return Math.round((joursPresents / nbJoursMois) * 100) / 100;
      }
    }

    // Entrée dans le mois courant → prorata
    if (dateEntree >= premierJour && dateEntree <= dernierJour) {
      const jourEntree = dateEntree.getDate();
      const joursRestants = nbJoursMois - jourEntree + 1;
      return Math.round((joursRestants / nbJoursMois) * 100) / 100;
    }

    // L'utilisateur était déjà là avant ce mois → mois complet
    return 1;
  }

  private resoudreCoproprietaireId(appartement: Appartement): string | undefined {
    if (appartement.proprietaireId && appartement.proprietaireId.trim() !== '') {
      return appartement.proprietaireId;
    }

    if (appartement.locataireId && appartement.locataireId.trim() !== '') {
      return appartement.locataireId;
    }

    console.warn(`⚠️ Appartement ${appartement.docId} (${appartement.numero}) sans propriétaire ni locataire`);
    // Retourner undefined pour signaler qu'il n'y a pas de coproprietaire connu
    return undefined;
  }

  private validerPayload(payload: CreateDettePayload): void {
    const erreurs: string[] = [];

    if (!payload.appartementId || payload.appartementId.trim() === '') {
      erreurs.push('appartementId est requis');
    }

    if (!payload.coproprietaireId || payload.coproprietaireId.trim() === '') {
      console.warn(`⚠️ Dette créée sans coproprietaireId pour appartement ${payload.appartementId}`);
    }

    if (!payload.chargeId || payload.chargeId.trim() === '') {
      erreurs.push('chargeId est requis');
    }

    if (!payload.annee || payload.annee < 2000 || payload.annee > 2100) {
      erreurs.push('année invalide');
    }

    if (!payload.mois || payload.mois < 1 || payload.mois > 12) {
      erreurs.push('mois invalide');
    }

    if (!payload.montant_original || payload.montant_original <= 0) {
      erreurs.push('montant_original doit être > 0');
    }

    if (!payload.date_echeance) {
      erreurs.push('date_echeance est requise');
    }

    if (erreurs.length > 0) {
      throw new Error(`Validation échouée: ${erreurs.join(', ')}`);
    }
  }

  private calculerPrioriteInitiale(dateEcheance: string): DettePriorite {
    const maintenant = new Date();
    const echeance = new Date(dateEcheance);
    const joursRestants = Math.floor((echeance.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24));
    
    if (joursRestants < 0) return 'URGENTE';
    if (joursRestants < 15) return 'NORMALE';
    return 'FAIBLE';
  }

  private generateId(annee: number, mois: number, appartementId: string, chargeId: string): string {
    return `DET-${annee}-${String(mois).padStart(2, '0')}-${appartementId}-${chargeId}`;
  }

  private filterAppartementsByScope(appartements: Appartement[], charge: Charge): Appartement[] {
    const chargeResidenceId = (charge as any).residenceId as string | undefined;
    const scopedByResidence = chargeResidenceId
      ? appartements.filter((a) => a.residenceDocId === chargeResidenceId)
      : appartements;

    if (charge.scope === 'all') return scopedByResidence;
    
    if (charge.scope === 'building' && charge.buildingIds?.length) {
      return scopedByResidence.filter(a => a.batimentDocId && charge.buildingIds!.includes(a.batimentDocId));
    }
    
    if (charge.scope === 'apartment' && charge.apartmentIds?.length) {
      return scopedByResidence.filter(a => a.docId && charge.apartmentIds!.includes(a.docId));
    }

    if (charge.scope === 'parking') {
      return scopedByResidence.filter(a =>
        a.hasParking ||
        (a as any).parking ||
        (a.caracteristiques || []).includes('Parking')
      );
    }

    if (charge.scope === 'ascenseur') {
      return scopedByResidence.filter(a =>
        a.hasAscenseur ||
        (a.caracteristiques || []).includes('Ascenseur')
      );
    }
    
    return [];
  }

  private calculerMontantMensuel(charge: Charge): number {
    switch (charge.unite_montant) {
      case 'MENSUEL': return charge.montant;
      case 'ANNUELLE': return charge.montant / 12;
      case 'TOTAL':
        return charge.duree_mois && charge.duree_mois > 0
          ? charge.montant / charge.duree_mois
          : charge.montant;
      default: return charge.montant;
    }
  }

  private calculerPoids(
    appartements: Appartement[],
    mode: string
  ): { poids: Map<string, number>; total: number } {
    const poids = new Map<string, number>();
    let total = 0;

    appartements.forEach(apt => {
      let poid = 0;

      switch (mode) {
        case 'TANTIEMES':
          poid = Number(apt.quotePart) || 0;
          break;
        case 'SURFACE':
          poid = Number(apt.surface) || 0;
          break;
        case 'EGALITAIRE':
          poid = 1;
          break;
        case 'OCCUPATION':
          poid = Number((apt as any).nb_occupants) || 1;
          break;
        case 'INDIVIDUEL':
          poid = 1;
          break;
        default:
          poid = Number(apt.quotePart) || 0;
      }

      if (apt.docId) {
        poids.set(apt.docId, poid);
        total += poid;
      }
    });

    return { poids, total };
  }

  private sanitizeForFirestore(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const out: any = {};
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v !== undefined && v !== null) out[k] = v;
    });
    return out;
  }

  /**
   * ✅ CORRIGÉ: Ajout du champ residenceId dans le mapping Firestore
   */
  private fromFirestore(id: string, data: any): Dette {
    return {
      id,
      appartementId: data.appartementId || '',
      coproprietaireId: data.coproprietaireId || '',
      chargeId: data.chargeId || '',
      repartitionId: data.repartitionId,
      residenceId: data.residenceId, // ✅ NOUVEAU: pour filtrage ADMIN_RESIDENCE
      annee: data.annee || 0,
      mois: data.mois || 0,
      montant_original: data.montant_original || 0,
      montant_paye: data.montant_paye || 0,
      montant_restant: data.montant_restant || 0,
      date_creation: this.toIsoString(data.date_creation) || '',
      date_echeance: this.toIsoString(data.date_echeance) || '',
      date_dernier_rappel: this.toIsoString(data.date_dernier_rappel),
      date_solde: this.toIsoString(data.date_solde),
      statut: data.statut || 'IMPAYEE',
      priorite: data.priorite || 'NORMALE',
      nb_relances: data.nb_relances || 0,
      penalite: data.penalite,
      interets: data.interets,
      paiement_ids: data.paiement_ids || [],
      notes: data.notes,
      created_at: this.toIsoString(data.created_at) || '',
      updated_at: this.toIsoString(data.updated_at) || '',
      updated_by: data.updated_by
    };
  }

  private toIsoString(value: any): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (value.toDate) return value.toDate().toISOString();
    return undefined;
  }

  async reconcilierPaiementsPourDettes(dettes: Dette[], userId?: string): Promise<void> {
    if (!dettes || dettes.length === 0) return;

    try {
      const paiementsCol = collection(this.db, 'paiements');

      for (const dette of dettes) {
        if (!dette.appartementId) continue;

        const start = new Date(dette.annee, dette.mois - 1, 1).toISOString();
        const nextStart = new Date(dette.annee, dette.mois, 1).toISOString();

        const q = query(
          paiementsCol,
          where('appartementId', '==', dette.appartementId),
          where('date', '>=', start),
          where('date', '<', nextStart)
        );

        const snap = await getDocs(q);
        if (snap.empty) continue;

        let somme = 0;
        const ids: string[] = [];

        snap.docs.forEach(pSnap => {
          const p = pSnap.data() as any;
          const allocs = p.allocations || [];
          if (Array.isArray(allocs) && allocs.length > 0) return;
          const montant = Number(p.amount || 0);
          if (montant > 0) {
            somme += montant;
            ids.push(pSnap.id);
          }
        });

        if (somme > 0) {
          await this.update(dette.id, { montant_paye: somme, paiement_ids: ids }, userId);
          console.log(`🔗 Dette ${dette.id}: ${somme} DT rattachés depuis paiements (${ids.length})`);
        }
      }
    } catch (error) {
      console.error('❌ Erreur lors de la réconciliation paiements→dettes:', error);
      throw error;
    }
  }

  invalidateCache(coproprietaireId?: string): void {
    if (coproprietaireId) {
      this.dettesCache.delete(coproprietaireId);
    } else {
      this.dettesCache.clear();
      this.allDettesCache = null;
    }
    console.log('🔄 Cache des dettes invalidé');
  }
}