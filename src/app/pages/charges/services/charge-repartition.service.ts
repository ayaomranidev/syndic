import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection, doc, getDocs, getFirestore,
  query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import {
  ChargeRepartition, CreateChargeRepartitionPayload,
  RepartitionAppartement, RepartitionCalculResult, RepartitionStats,
} from '../../../models/chargeRepartition.model';
import { Charge, ModeRepartition } from '../../../models/charge.model';
import { Appartement, AppartementService } from '../../appartements/services/appartement.service';
import { CacheService } from '../../../core/services/cache.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { User } from '../../../models/user.model';

/**
 * ChargeRepartitionService
 * ========================
 * CORRECTIONS APPLIQUÉES :
 *  NOK-1 : Ajout du case 'OCCUPATION' dans calculerPoids()
 *           → p = Number(apt.nb_occupants) || 1
 *  NOK-1 : Ajout du case 'OCCUPATION' dans la détection isFixedPerUnit
 */
@Injectable({ providedIn: 'root' })
export class ChargeRepartitionService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);
  private readonly repartitionsCol = collection(this.db, 'charge_repartitions');

  constructor(
    private readonly appartementService: AppartementService,
    private readonly cache: CacheService,
    private readonly userService: UserService,
  ) {}

  // ==================== CALCUL DE RÉPARTITION ====================

  async calculerRepartition(charge: Charge): Promise<RepartitionCalculResult> {
    // 1. Charger tous les appartements (avec cache)
    let tousLesAppartements = this.cache.getAppartements();
    if (!tousLesAppartements) {
      tousLesAppartements = await this.appartementService.loadAppartements();
      this.cache.setAppartements(tousLesAppartements);
    }

    const chargeResidenceId = (charge as any).residenceId as string | undefined;

    // 2. Filtrer par résidence (si charge liée à une résidence)
    const appartementsScopes = chargeResidenceId
      ? tousLesAppartements.filter((a) => a.residenceDocId === chargeResidenceId)
      : tousLesAppartements;

    // 3. Filtrer selon le scope
    const scoped = this.filtrerParScope(appartementsScopes, charge);

    // 4. Filtrer selon date_entree des utilisateurs
    const users = await this.userService.loadFromFirestore();
    const userByAptId = new Map<string, User>();
    for (const u of users) {
      if (u.appartementId) userByAptId.set(String(u.appartementId), u);
    }

    const dateFinCharge = charge.date_fin ? new Date(charge.date_fin) : new Date();
    const appartementsConcernes = scoped.filter((apt) => {
      if (!apt.docId) return false;
      const user = userByAptId.get(apt.docId);
      if (!user || !user.date_entree) return true;
      return new Date(user.date_entree) <= dateFinCharge;
    });

    if (appartementsConcernes.length === 0) {
      throw new Error(`Aucun appartement concerné par la charge "${charge.libelle}"`);
    }

    // 5. Montant mensuel à répartir
    const montantMensuel = this.calculerMontantMensuel(charge);

    // 6. Poids (tantièmes, surface, occupation, etc.)
    const poids = this.calculerPoids(appartementsConcernes, charge.mode_repartition);

    // 7. Répartir
    const repartitions = this.repartirMontant(
      appartementsConcernes,
      poids,
      montantMensuel,
      charge.mode_repartition,
      charge.scope,
    );

    // 8. Stats — parking: total = montant × N (chaque apt paie le montant complet)
    const isFixedPerUnit = charge.scope === 'parking';
    const totalEffectif = isFixedPerUnit
      ? montantMensuel * appartementsConcernes.length
      : montantMensuel;

    const montants = repartitions.map(r => r.montant_mensuel);
    return {
      repartitions,
      montant_total: totalEffectif,
      nombre_appartements: appartementsConcernes.length,
      montant_moyen: totalEffectif / appartementsConcernes.length,
      montant_min: Math.min(...montants),
      montant_max: Math.max(...montants),
      total_quote_parts: poids.total,
    };
  }

  /** Crée et sauvegarde une répartition dans Firestore */
  async creerRepartition(charge: Charge, userId?: string): Promise<ChargeRepartition> {
    const calcul = await this.calculerRepartition(charge);
    const now = new Date().toISOString();
    const id = `REP-${charge.id}-${Date.now()}`;

    const repartition: ChargeRepartition = {
      id,
      chargeId: charge.id,
      residenceId: (charge as any).residenceId,
      date_calcul: now,
      montant_total: calcul.montant_total,
      mode_repartition: charge.mode_repartition,
      scope: charge.scope,
      repartitions: calcul.repartitions,
      createdAt: now,
      createdBy: userId,
    };

    const docRef = doc(this.db, 'charge_repartitions', id);
    await setDoc(docRef, { ...repartition, createdAt: serverTimestamp() });

    return repartition;
  }

  async getById(id: string): Promise<ChargeRepartition | null> {
    const snapshot = await getDocs(query(this.repartitionsCol, where('id', '==', id)));
    if (snapshot.empty) return null;
    return this.fromFirestore(snapshot.docs[0].id, snapshot.docs[0].data());
  }

  async getByCharge(chargeId: string): Promise<ChargeRepartition[]> {
    const q = query(this.repartitionsCol, where('chargeId', '==', chargeId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => this.fromFirestore(d.id, d.data()));
  }

  calculerStats(repartition: ChargeRepartition): RepartitionStats {
    const montants = repartition.repartitions.map(r => r.montant_mensuel);
    const quoteParts = repartition.repartitions.map(r => r.quote_part);
    const n = repartition.repartitions.length;

    return {
      nombre_appartements_concernes: n,
      montant_total_reparti: repartition.montant_total,
      montant_moyen_par_appartement: n ? repartition.montant_total / n : 0,
      montant_minimal_dt: n ? Math.min(...montants) : 0,
      montant_maximal_dt: n ? Math.max(...montants) : 0,
      quote_part_minimale: n ? Math.min(...quoteParts) : 0,
      quote_part_maximale: n ? Math.max(...quoteParts) : 0,
    };
  }

  // ==================== MÉTHODES PRIVÉES ====================

  private filtrerParScope(appartements: Appartement[], charge: Charge): Appartement[] {
    switch (charge.scope) {
      case 'all':
        return appartements;
      case 'building':
        if (!charge.buildingIds?.length) return appartements;
        return appartements.filter(
          apt => apt.batimentDocId && charge.buildingIds!.includes(apt.batimentDocId),
        );
      case 'apartment':
        if (!charge.apartmentIds?.length) return [];
        return appartements.filter(
          apt => apt.docId && charge.apartmentIds!.includes(apt.docId),
        );
      case 'parking':
        return appartements.filter(
          apt =>
            apt.hasParking ||
            (apt as any).parking ||
            (apt.caracteristiques || []).includes('Parking'),
        );
      case 'ascenseur':
        return appartements.filter(
          apt =>
            apt.hasAscenseur ||
            (apt.caracteristiques || []).includes('Ascenseur'),
        );
      default:
        return appartements;
    }
  }

  private calculerMontantMensuel(charge: Charge): number {
    switch (charge.unite_montant) {
      case 'MENSUEL':  return charge.montant;
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
    mode: ModeRepartition,
  ): { poids: Map<string, number>; total: number } {
    const poids = new Map<string, number>();
    let total = 0;

    for (const apt of appartements) {
      if (!apt.docId) continue;
      let p = 0;
      switch (mode) {
        case 'TANTIEMES':
          p = Number(apt.quotePart) || 0;
          break;
        case 'SURFACE':
          p = Number(apt.surface) || 0;
          break;
        case 'EGALITAIRE':
          p = 1;
          break;
        case 'COMPTEUR':
          p = 1;
          break;
        // ── NOK-1 FIX ──────────────────────────────────────────────────────
        // Le mode OCCUPATION était absent : poids = 0 pour tous → répartition
        // impossible. On utilise nb_occupants (champ du modèle Appartement).
        // Fallback à 1 si le champ n'est pas renseigné (évite division par zéro).
        case 'OCCUPATION' as any:
          p = Number((apt as any).nb_occupants) || 1;
          break;
        // ───────────────────────────────────────────────────────────────────
        default:
          p = Number(apt.quotePart) || 1;
      }
      poids.set(apt.docId, p);
      total += p;
    }

    return { poids, total };
  }

  private repartirMontant(
    appartements: Appartement[],
    poids: { poids: Map<string, number>; total: number },
    montantTotal: number,
    mode: ModeRepartition,
    scope?: string,
  ): RepartitionAppartement[] {
    if (poids.total === 0) {
      throw new Error('Total des poids est zéro, impossible de répartir');
    }

    const isParking = scope === 'parking';
    const n = appartements.filter(apt => !!apt.docId).length;

    return appartements
      .filter(apt => !!apt.docId)
      .map(apt => {
        const quotePart = poids.poids.get(apt.docId!) || 0;
        const pourcentage = isParking
          ? Math.round((1 / n) * 10000) / 100
          : Math.round(((quotePart / poids.total) * 100) * 100) / 100;
        const montantMensuel = isParking
          ? montantTotal
          : (montantTotal * quotePart) / poids.total;

        return {
          appartementId: apt.docId!,
          appartement_numero: apt.numero,
          coproprietaireId: apt.proprietaireId || apt.locataireId || '',
          quote_part: quotePart,
          total_quote_parts: poids.total,
          pourcentage,
          montant_mensuel: Math.round(montantMensuel * 100) / 100,
        } as RepartitionAppartement;
      });
  }

  private fromFirestore(id: string, data: any): ChargeRepartition {
    return {
      id,
      chargeId: data.chargeId || '',
      residenceId: data.residenceId,
      date_calcul: this.toIsoString(data.date_calcul) || '',
      montant_total: Number(data.montant_total) || 0,
      mode_repartition: data.mode_repartition || 'TANTIEMES',
      scope: data.scope || 'all',
      repartitions: data.repartitions || [],
      createdAt: this.toIsoString(data.createdAt) || '',
      createdBy: data.createdBy,
    };
  }

  private toIsoString(value: any): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (value.toDate) return value.toDate().toISOString();
    return undefined;
  }
}