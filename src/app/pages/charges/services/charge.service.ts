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
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import {
  Charge,
  ChargePayload,
  ChargeType,
  ChargeFixe,
  ChargeTravaux,
  ChargeVariable,
  ChargeFixePayload,
  ChargeTravauxPayload,
  ChargeVariablePayload,
} from '../../../models/charge.model';
import { DetteService } from '../../dette/services/dette.service';
import { AlerteService } from '../../notifications/services/alerte.service';

// ─── NOK-2 : Interface snapshot de version ──────────────────────────────────
/**
 * ⚠️ RÈGLE FIRESTORE OBLIGATOIRE (déjà dans firestore.rules) :
 *   match /charges/{chargeId}/versions/{versionId} { ... }
 */
export interface ChargeVersion {
  version:       number;
  snapshot:      Omit<Charge, 'id'>;
  effectiveFrom: string;
  effectiveTo?:  string;
  changedFields: string[];
  createdAt:     any;
  createdBy?:    string;
}

export const CHARGE_CRITICAL_FIELDS: readonly string[] = [
  'montant', 'mode_repartition', 'scope', 'unite_montant',
  'buildingIds', 'apartmentIds', 'frequence', 'date_debut', 'duree_mois',
];

export interface BatimentOption {
  name: string;
  docId: string;
  nom: string;
  residenceId?: string | number;
  nombreEtages?: number;
}

export interface AppartementOption {
  docId: string;
  numero: string;
  batimentDocId:  string | null;
  batimentName?:  string;
  residenceDocId?: string | null;
  etage:   number;
  surface: number;
  type:    string;
  statut?: string;
  hasParking?:   boolean;
  hasAscenseur?: boolean;
}

export interface EtageOption {
  numero: number;
  label:  string;
  batimentDocId: string;
}

@Injectable({ providedIn: 'root' })
export class ChargeService {
  private readonly app             = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db              = getFirestore(this.app);
  private readonly chargesCol      = collection(this.db, 'charges');
  private readonly batimentsCol    = collection(this.db, 'batiments');
  private readonly appartementsCol = collection(this.db, 'appartements');

  private readonly alerteSvc = inject(AlerteService);

  constructor(private readonly detteService: DetteService) {}

  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * CORRECTION audit WARN-2 : query Firestore directe au lieu de filtrage mémoire.
   * - residenceId fourni → charges de cette résidence + charges globales (null).
   * - residenceId absent → toutes les charges (ADMIN global).
   */
  async list(residenceId?: string | null): Promise<Charge[]> {
    if (residenceId) {
      const qOwn    = query(this.chargesCol, where('residenceId', '==', residenceId));
      const qGlobal = query(this.chargesCol, where('residenceId', '==', null));
      const [snapOwn, snapGlobal] = await Promise.all([getDocs(qOwn), getDocs(qGlobal)]);
      const seen   = new Set<string>();
      const result: Charge[] = [];
      [...snapOwn.docs, ...snapGlobal.docs].forEach(d => {
        if (!seen.has(d.id)) { seen.add(d.id); result.push(this.fromDoc(d.id, d.data() as any)); }
      });
      return result;
    }
    const snapshot = await getDocs(this.chargesCol);
    return snapshot.docs.map(d => this.fromDoc(d.id, d.data() as any));
  }

  async getById(id: string): Promise<Charge | null> {
    const snap = await getDoc(doc(this.db, 'charges', id));
    if (!snap.exists()) return null;
    return this.fromDoc(snap.id, snap.data() as any);
  }

  async listByType(type: ChargeType): Promise<Charge[]> {
    const q    = query(this.chargesCol, where('type_charge', '==', type));
    const snap = await getDocs(q);
    return snap.docs.map(d => this.fromDoc(d.id, d.data() as any));
  }

  async listChargesFixes():     Promise<ChargeFixe[]>     { return this.listByType('FIXE')     as Promise<ChargeFixe[]>;     }
  async listTravaux():           Promise<ChargeTravaux[]>  { return this.listByType('TRAVAUX')  as Promise<ChargeTravaux[]>;  }
  async listChargesVariables():  Promise<ChargeVariable[]> { return this.listByType('VARIABLE') as Promise<ChargeVariable[]>; }

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  async create(payload: ChargePayload): Promise<Charge> {
    const nowIso = new Date().toISOString();
    const body   = this.clean(this.toDocBody(payload));
    const id     = this.generateChargeId(payload.type_charge);
    const ref    = doc(this.db, 'charges', id);

    await setDoc(ref, body);
    await this.writeVersion(id, this.fromDoc(id, body), 1, nowIso, []);

    this.alerteSvc.alerteNouvelleCharge({
      chargeId:         id,
      chargeLibelle:    payload.libelle || 'Charge',
      chargeType:       payload.type_charge,
      montant:          Number(payload.montant) || 0,
      destinatairesIds: [],
      notifIndividuelle: false,
    }).catch(err => console.error('[Alerte] Erreur nouvelle charge:', err));

    return this.fromDoc(id, { ...body, createdAt: payload.createdAt || nowIso, updatedAt: payload.updatedAt || nowIso });
  }

  async createChargeFixe(payload: ChargeFixePayload):        Promise<ChargeFixe>     { return this.create({ ...payload, type_charge: 'FIXE' })     as Promise<ChargeFixe>;     }
  async createTravaux(payload: ChargeTravauxPayload):         Promise<ChargeTravaux>  { return this.create({ ...payload, type_charge: 'TRAVAUX' })  as Promise<ChargeTravaux>;  }
  async createChargeVariable(payload: ChargeVariablePayload): Promise<ChargeVariable> { return this.create({ ...payload, type_charge: 'VARIABLE' }) as Promise<ChargeVariable>; }

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  async update(
    id: string,
    patch: Partial<ChargePayload>,
    userId?: string,
  ): Promise<{ charge: Charge; criticalFieldsChanged: string[] }> {
    const ref    = doc(this.db, 'charges', id);
    const nowIso = new Date().toISOString();
    const current = await this.getById(id);
    const body: any = { updatedAt: serverTimestamp() };

    // ... (Tous les champs communs : libelle, description, montant, etc. - Inchangés) ...
    if (patch.libelle            !== undefined) body.libelle            = patch.libelle;
    if (patch.description        !== undefined) body.description        = patch.description;
    if (patch.montant            !== undefined) body.montant            = Number(patch.montant);
    if (patch.unite_montant      !== undefined) body.unite_montant      = patch.unite_montant;
    if (patch.date_debut         !== undefined) body.date_debut         = patch.date_debut;
    if (patch.date_fin           !== undefined) body.date_fin           = patch.date_fin;
    if (patch.duree_mois         !== undefined) body.duree_mois         = Number(patch.duree_mois);
    if (patch.frequence          !== undefined) body.frequence          = patch.frequence;
    if (patch.mode_repartition   !== undefined) body.mode_repartition   = patch.mode_repartition;
    if (patch.statut             !== undefined) body.statut             = patch.statut;
    if (patch.categorie          !== undefined) body.categorie          = patch.categorie;
    if (patch.scope              !== undefined) body.scope              = patch.scope;
    
    // ✅ CORRECTION CRITIQUE : residenceId
    // On s'assure qu'il est TOUJOURS présent dans le body.
    if ((patch as any).residenceId !== undefined) {
      body.residenceId = (patch as any).residenceId;
    } else if (current && (current as any).residenceId) {
      body.residenceId = (current as any).residenceId;
    }

    if (patch.buildingIds        !== undefined) body.buildingIds        = patch.buildingIds;
    if (patch.apartmentIds       !== undefined) body.apartmentIds       = patch.apartmentIds;
    if (patch.floors             !== undefined) body.floors             = patch.floors;
    if (patch.applicable_parking !== undefined) body.applicable_parking = patch.applicable_parking;
    if (patch.parkingIds         !== undefined) body.parkingIds         = patch.parkingIds;
    if (patch.notes              !== undefined) body.notes              = patch.notes;

    // ... (Logique spécifique FIXE/TRAVAUX/VARIABLE - Inchangée) ...
    if (patch.type_charge === 'FIXE') {
      const p = patch as Partial<ChargeFixePayload>;
      if (p.contrat_id                   !== undefined) body.contrat_id                   = p.contrat_id;
      if (p.fournisseur                  !== undefined) body.fournisseur                  = p.fournisseur;
      if (p.reconduction_auto            !== undefined) body.reconduction_auto            = p.reconduction_auto;
      if (p.date_prochain_renouvellement !== undefined) body.date_prochain_renouvellement = p.date_prochain_renouvellement;
      if (p.conditions_resiliation       !== undefined) body.conditions_resiliation       = p.conditions_resiliation;
    } else if (patch.type_charge === 'TRAVAUX') {
      const p = patch as Partial<ChargeTravauxPayload>;
      if (p.date_panne         !== undefined) body.date_panne         = p.date_panne;
      if (p.urgence            !== undefined) body.urgence            = p.urgence;
      if (p.intervenant        !== undefined) body.intervenant        = p.intervenant;
      if (p.pieces_remplacees  !== undefined) body.pieces_remplacees  = p.pieces_remplacees;
      if (p.devis_id           !== undefined) body.devis_id           = p.devis_id;
      if (p.devis_montant      !== undefined) body.devis_montant      = p.devis_montant;
      if (p.facture_id         !== undefined) body.facture_id         = p.facture_id;
      if (p.facture_montant    !== undefined) body.facture_montant    = p.facture_montant;
      if (p.duree_intervention !== undefined) body.duree_intervention = p.duree_intervention;
      if (p.garantie_mois      !== undefined) body.garantie_mois      = p.garantie_mois;
      if (p.date_intervention  !== undefined) body.date_intervention  = p.date_intervention;
      if (p.photos             !== undefined) body.photos             = p.photos;
      if (p.cause_panne        !== undefined) body.cause_panne        = p.cause_panne;
    } else if (patch.type_charge === 'VARIABLE') {
      const p = patch as Partial<ChargeVariablePayload>;
      if (p.compteur_general    !== undefined) body.compteur_general    = p.compteur_general;
      if (p.index_debut         !== undefined) body.index_debut         = p.index_debut;
      if (p.index_fin           !== undefined) body.index_fin           = p.index_fin;
      if (p.consommation_totale !== undefined) body.consommation_totale = p.consommation_totale;
      if (p.prix_unitaire       !== undefined) body.prix_unitaire       = p.prix_unitaire;
      if (p.fournisseur         !== undefined) body.fournisseur         = p.fournisseur;
      if (p.numero_contrat      !== undefined) body.numero_contrat      = p.numero_contrat;
      if (p.periode_releve      !== undefined) body.periode_releve      = p.periode_releve;
      if (p.releves_individuels !== undefined) body.releves_individuels = p.releves_individuels;
    }

    // ── Détection des changements critiques ───────────────────────────────────
    let criticalFieldsChanged: string[] = [];
    if (current) {
      const changedFields   = this.detectChangedFields(current, patch);
      criticalFieldsChanged = changedFields.filter(f => CHARGE_CRITICAL_FIELDS.includes(f));
    }

    // ✅ CORRECTION DE L'ORDRE :
    // 1. On met à jour le document PRINCIPAL en premier.
    // Cela "répare" le residenceId si le document était hérité (ancien).
    await updateDoc(ref, this.clean(body));

    // 2. Ensuite, on essaie d'écrire l'historique.
    // On le met dans un try/catch pour ne pas bloquer l'UI si l'écriture de l'historique échoue.
    if (criticalFieldsChanged.length > 0) {
      try {
        const versionsCol      = collection(this.db, 'charges', id, 'versions');
        const existingVersions = await getDocs(versionsCol);
        const nextVersion      = existingVersions.size + 1;
        
        if (existingVersions.size > 0) {
          const lastVersionDoc = existingVersions.docs
            .sort((a, b) => (b.data()['version'] || 0) - (a.data()['version'] || 0))[0];
          await updateDoc(lastVersionDoc.ref, { effectiveTo: nowIso });
        }
        await this.writeVersion(id, current!, nextVersion, nowIso, criticalFieldsChanged, userId);
      } catch (versionError) {
        console.warn('[ChargeService] Impossible d\'écrire l\'historique des versions (non bloquant) :', versionError);
      }
    }

    const updated = await this.getById(id);
    return {
      charge:               updated ?? this.fromDoc(id, { ...patch, updatedAt: nowIso }),
      criticalFieldsChanged,
    };
  }

  async remove(id: string): Promise<void> {
    await this.detteService.deleteByCharge(id);
    await deleteDoc(doc(this.db, 'charges', id));
  }

  // ==========================================================================
  // VERSIONNEMENT
  // ==========================================================================

  async getVersions(chargeId: string): Promise<ChargeVersion[]> {
    const versionsCol = collection(this.db, 'charges', chargeId, 'versions');
    const snapshot    = await getDocs(versionsCol);
    return snapshot.docs
      .map(d => d.data() as ChargeVersion)
      .sort((a, b) => b.version - a.version);
  }

  async getVersionAtDate(chargeId: string, date: string): Promise<ChargeVersion | null> {
    const versions = await this.getVersions(chargeId);
    return versions.find(v => {
      const from = new Date(v.effectiveFrom).getTime();
      const to   = v.effectiveTo ? new Date(v.effectiveTo).getTime() : Infinity;
      const d    = new Date(date).getTime();
      return from <= d && d < to;
    }) ?? null;
  }

  // ==========================================================================
  // BATIMENTS
  // ==========================================================================

  /**
   * CORRECTION : getBatiments filtre strictement par résidence pour ADMIN_RESIDENCE.
   * Quand residenceId est fourni, seuls les bâtiments de cette résidence sont retournés.
   * Cela garantit que le formulaire de charge n'affiche que les bâtiments
   * dont l'admin est responsable.
   */
  async getBatiments(residenceId?: string | null): Promise<BatimentOption[]> {
    try {
      const snapshot = await getDocs(this.batimentsCol);
      const list = snapshot.docs
        .map(d => {
          const data = d.data();
          const nom  = data['nom'] || data['name'] || data['libelle'] || '';
          return {
            docId:        d.id,
            nom,
            name:         nom,
            residenceId:  data['residenceId'] || data['residenceDocId'] || undefined,
            nombreEtages: Number(data['nombreEtages'] ?? data['floors'] ?? 0) || 0,
          } as BatimentOption;
        })
        .filter(b => b.nom)
        .sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

      if (!residenceId) return list;
      // Filtre strict : seuls les bâtiments appartenant à cette résidence
      return list.filter(b => String(b.residenceId || '') === String(residenceId));
    } catch (error) {
      console.error('Error fetching batiments:', error);
      return [];
    }
  }

  // ==========================================================================
  // APPARTEMENTS
  // ==========================================================================

  /**
   * CORRECTION : getAppartements filtre par résidence ET expose hasParking/hasAscenseur.
   *
   * Pour ADMIN_RESIDENCE :
   *  - scope "parking"   → n'affiche que les appts de SA résidence ayant un parking
   *  - scope "ascenseur" → n'affiche que les appts de SA résidence ayant un ascenseur
   *  - scope "building"  → n'affiche que les bâtiments de SA résidence
   *
   * Le filtrage se fait ici au niveau du service. Le composant charges.component.ts
   * passe currentResidenceId ce qui garantit l'isolation par résidence.
   */
  async getAppartements(residenceId?: string | null): Promise<AppartementOption[]> {
    try {
      const snapshot = await getDocs(this.appartementsCol);
      const list = snapshot.docs
        .map(d => {
          const data = d.data();
          return {
            docId:          d.id,
            numero:         data['numero']        || data['number'] || '',
            batimentDocId:  data['batimentDocId'] || data['batimentId'] || null,
            batimentName:   data['batimentName']  || '',
            residenceDocId: data['residenceDocId'] || data['residenceId'] || null,
            etage:          Number(data['etage'] ?? data['floor'] ?? 0) || 0,
            surface:        Number(data['surface'] ?? 0) || 0,
            type:           data['type'] || '',
            statut:         data['statut'] || 'vacant',
            // CORRECTION : exposer hasParking et hasAscenseur pour le filtrage scope
            hasParking:   Boolean(data['hasParking']   || (data['caracteristiques'] || []).includes('Parking')),
            hasAscenseur: Boolean(data['hasAscenseur'] || (data['caracteristiques'] || []).includes('Ascenseur')),
          } as AppartementOption;
        })
        .sort((a, b) => (a.numero || '').localeCompare(b.numero || ''));

      if (!residenceId) return list;
      // Filtre strict par résidence
      return list.filter((a: any) => String(a.residenceDocId || '') === String(residenceId));
    } catch (error) {
      console.error('Error fetching appartements:', error);
      return [];
    }
  }

  async getAppartementsByBatiment(batimentDocId: string): Promise<AppartementOption[]> {
    const all = await this.getAppartements();
    return all.filter(apt => apt.batimentDocId === batimentDocId);
  }

  async getAppartementsByBatimentInResidence(
    batimentDocId: string,
    residenceId: string | null,
  ): Promise<AppartementOption[]> {
    const all = await this.getAppartements(residenceId);
    return all.filter(apt => apt.batimentDocId === batimentDocId);
  }

  async getEtagesByBatiment(batimentDocId: string): Promise<EtageOption[]> {
    try {
      const appartements = await this.getAppartementsByBatiment(batimentDocId);
      const etagesSet    = new Set<number>();
      appartements.forEach(apt => {
        if (apt.etage !== undefined && apt.etage !== null) etagesSet.add(apt.etage);
      });
      return Array.from(etagesSet)
        .sort((a, b) => a - b)
        .map(num => ({ numero: num, label: this.formatEtageLabel(num), batimentDocId }));
    } catch (error) {
      console.error('Error fetching etages:', error);
      return [];
    }
  }

  async getEtagesByBatiments(batimentDocIds: string[]): Promise<Map<string, EtageOption[]>> {
    const result = new Map<string, EtageOption[]>();
    for (const docId of batimentDocIds) {
      result.set(docId, await this.getEtagesByBatiment(docId));
    }
    return result;
  }

  // ==========================================================================
  // MÉTHODES PRIVÉES
  // ==========================================================================

  private generateChargeId(type: ChargeType): string {
    const year      = new Date().getFullYear();
    const timestamp = Date.now();
    const random    = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const prefix    = ({ FIXE: 'CH-FIX', TRAVAUX: 'CH-TRAV', VARIABLE: 'CH-VAR' })[type];
    return `${prefix}-${year}-${timestamp}-${random}`;
  }

  private formatEtageLabel(numero: number): string {
    if (numero === 0) return 'RDC';
    if (numero < 0)   return `Sous-sol ${Math.abs(numero)}`;
    return `Étage ${numero}`;
  }

  private async writeVersion(
    chargeId: string,
    snapshot: Charge,
    version: number,
    effectiveFrom: string,
    changedFields: string[],
    createdBy?: string,
  ): Promise<void> {
    const versionsCol = collection(this.db, 'charges', chargeId, 'versions');
    const snapshotDoc = this.clean((({ id, ...rest }) => rest)(snapshot as any));
    const versionDoc  = this.clean({
      version,
      snapshot:     snapshotDoc,
      effectiveFrom,
      changedFields,
      createdAt:    serverTimestamp(),
      createdBy:    createdBy || (snapshot as any)?.created_by || null,
    }) as ChargeVersion;
    await addDoc(versionsCol, versionDoc);
  }

  private detectChangedFields(current: Charge, patch: Partial<ChargePayload>): string[] {
    const changed: string[] = [];
    for (const key of Object.keys(patch) as (keyof ChargePayload)[]) {
      const patchVal   = (patch as any)[key];
      const currentVal = (current as any)[key];
      if (patchVal !== undefined && JSON.stringify(patchVal) !== JSON.stringify(currentVal)) {
        changed.push(key);
      }
    }
    return changed;
  }

  private fromDoc(id: string, data: any): Charge {
    const base = {
      id,
      libelle:            data.libelle          || data.label     || 'Charge',
      description:        data.description,
      type_charge:        data.type_charge      || 'FIXE',
      categorie:          data.categorie        || data.category  || 'COURANTE',
      montant:            Number(data.montant   || data.amount)   || 0,
      unite_montant:      data.unite_montant    || 'MENSUEL',
      date_debut:         data.date_debut       || data.startDate || new Date().toISOString().slice(0, 10),
      date_fin:           data.date_fin         || data.endDate,
      duree_mois:         Number(data.duree_mois || data.durationMonths) || undefined,
      frequence:          data.frequence        || data.frequency || 'MENSUELLE',
      mode_repartition:   data.mode_repartition || 'TANTIEMES',
      statut:             data.statut           || data.status    || 'ACTIVE',
      scope:              data.scope            || 'all',
      building:           data.building,
      buildingIds:        data.buildingIds      || [],
      apartmentIds:       data.apartmentIds     || [],
      floors:             data.floors           || [],
      applicable_parking: Boolean(data.applicable_parking || data.appliesToParking),
      parkingIds:         data.parkingIds       || [],
      notes:              data.notes,
      residenceId:        data.residenceId,
      created_by:         data.created_by       || data.createdBy,
      createdAt:          this.normalizeDate(data.createdAt),
      updatedAt:          this.normalizeDate(data.updatedAt),
    };

    if (data.type_charge === 'FIXE') {
      return {
        ...base, type_charge: 'FIXE',
        contrat_id:                   data.contrat_id,
        fournisseur:                  data.fournisseur,
        reconduction_auto:            data.reconduction_auto,
        date_prochain_renouvellement: data.date_prochain_renouvellement,
        conditions_resiliation:       data.conditions_resiliation,
      } as ChargeFixe;
    } else if (data.type_charge === 'TRAVAUX') {
      return {
        ...base, type_charge: 'TRAVAUX',
        date_panne:         data.date_panne,
        urgence:            data.urgence,
        intervenant:        data.intervenant,
        pieces_remplacees:  data.pieces_remplacees || [],
        devis_id:           data.devis_id,
        devis_montant:      data.devis_montant,
        facture_id:         data.facture_id,
        facture_montant:    data.facture_montant,
        duree_intervention: data.duree_intervention,
        garantie_mois:      data.garantie_mois,
        date_intervention:  data.date_intervention,
        photos:             data.photos || [],
        cause_panne:        data.cause_panne,
      } as ChargeTravaux;
    } else if (data.type_charge === 'VARIABLE') {
      return {
        ...base, type_charge: 'VARIABLE',
        compteur_general:    data.compteur_general,
        index_debut:         data.index_debut,
        index_fin:           data.index_fin,
        consommation_totale: data.consommation_totale,
        prix_unitaire:       data.prix_unitaire,
        fournisseur:         data.fournisseur,
        numero_contrat:      data.numero_contrat,
        periode_releve:      data.periode_releve,
        releves_individuels: data.releves_individuels || [],
      } as ChargeVariable;
    }

    return base as Charge;
  }

  private toDocBody(payload: Partial<ChargePayload>): any {
    const nowIso = new Date().toISOString();
    const base: any = {
      libelle:           payload.libelle?.trim()        || 'Charge',
      description:       payload.description            || '',
      type_charge:       payload.type_charge            || 'FIXE',
      categorie:         payload.categorie              || 'COURANTE',
      montant:           Number(payload.montant)        || 0,
      unite_montant:     payload.unite_montant          || 'MENSUEL',
      date_debut:        payload.date_debut             || nowIso.slice(0, 10),
      date_fin:          payload.date_fin               || undefined,
      duree_mois:        payload.duree_mois             ? Number(payload.duree_mois) : undefined,
      frequence:         payload.frequence              || 'MENSUELLE',
      mode_repartition:  payload.mode_repartition       || 'TANTIEMES',
      statut:            payload.statut                 || 'ACTIVE',
      scope:             payload.scope                  || 'all',
      residenceId:       (payload as any).residenceId   || null,
      building:          payload.building               || null,
      buildingIds:       payload.buildingIds            || [],
      apartmentIds:      payload.apartmentIds           || [],
      floors:            payload.floors                 || [],
      applicable_parking: Boolean(payload.applicable_parking),
      parkingIds:        payload.parkingIds             || [],
      notes:             payload.notes                  || '',
      created_by:        payload.created_by             || null,
      createdAt:         payload.createdAt              || serverTimestamp(),
      updatedAt:         payload.updatedAt              || serverTimestamp(),
    };

    if (payload.type_charge === 'FIXE') {
      const p = payload as ChargeFixePayload;
      base.contrat_id                   = p.contrat_id;
      base.fournisseur                  = p.fournisseur;
      base.reconduction_auto            = p.reconduction_auto;
      base.date_prochain_renouvellement = p.date_prochain_renouvellement;
      base.conditions_resiliation       = p.conditions_resiliation;
    } else if (payload.type_charge === 'TRAVAUX') {
      const p = payload as ChargeTravauxPayload;
      base.date_panne         = p.date_panne;
      base.urgence            = p.urgence;
      base.intervenant        = p.intervenant;
      base.pieces_remplacees  = p.pieces_remplacees || [];
      base.devis_id           = p.devis_id;
      base.devis_montant      = p.devis_montant;
      base.facture_id         = p.facture_id;
      base.facture_montant    = p.facture_montant;
      base.duree_intervention = p.duree_intervention;
      base.garantie_mois      = p.garantie_mois;
      base.date_intervention  = p.date_intervention;
      base.photos             = p.photos || [];
      base.cause_panne        = p.cause_panne;
    } else if (payload.type_charge === 'VARIABLE') {
      const p = payload as ChargeVariablePayload;
      base.compteur_general    = p.compteur_general;
      base.index_debut         = p.index_debut;
      base.index_fin           = p.index_fin;
      base.consommation_totale = p.consommation_totale;
      base.prix_unitaire       = p.prix_unitaire;
      base.fournisseur         = p.fournisseur;
      base.numero_contrat      = p.numero_contrat;
      base.periode_releve      = p.periode_releve;
      base.releves_individuels = (p as any).releves_individuels || [];
    }

    return base;
  }

  private clean<T extends Record<string, any>>(obj: T): T {
    const out: any = {};
    Object.keys(obj).forEach(k => {
      if ((obj as any)[k] !== undefined) out[k] = (obj as any)[k];
    });
    return out as T;
  }

  private normalizeDate(value: any): string | undefined {
    if (!value)                                    return undefined;
    if (typeof value === 'object' && value.toDate) return value.toDate().toISOString();
    if (typeof value === 'string')                 return value;
    return undefined;
  }
}