import { Injectable } from '@angular/core';
import { ChargeRepartitionService } from '../../charges/services/charge-repartition.service';
import { ChargeService } from '../../charges/services/charge.service';
import { DetteService } from './dette.service';
import { CacheService } from '../../../core/services/cache.service';
import { AppartementService } from '../../appartements/services/appartement.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { Charge } from '../../../models/charge.model';
import { CreateDettePayload, Dette } from '../../../models/dette.model';

export interface GenerationMoisResult {
  success: boolean;
  dejaGenere: boolean;
  nombreDettesCrees: number;
  chargesTraitees: number;
  chargesSansCreation: string[];
  erreurs: Array<{ charge: string; erreur: string }>;
}

export interface GenerationAnnuelleResult {
  success: boolean;
  totalDettesCrees: number;
  resultatsParMois: Record<number, GenerationMoisResult>;
}

@Injectable({ providedIn: 'root' })
export class DetteGenerationService {
  constructor(
    private readonly detteService: DetteService,
    private readonly chargeService: ChargeService,
    private readonly repartitionService: ChargeRepartitionService,
    private readonly cache: CacheService,
    private readonly appartementService: AppartementService,
    private readonly userService: UserService,
  ) {}

  /**
   * Génère toutes les dettes pour un mois donné.
   * ✅ CORRIGÉ : Ajout du paramètre residenceId pour filtrer les charges
   */
  async genererDettesduMois(
    annee?: number,
    mois?: number,
    residenceId?: string | null,  // ← NOUVEAU paramètre
    userId?: string,
  ): Promise<GenerationMoisResult> {
    const maintenant = new Date();
    const anneeRef = annee ?? maintenant.getFullYear();
    const moisRef  = mois  ?? maintenant.getMonth() + 1;

    console.log(`🔄 Génération dettes ${moisRef}/${anneeRef} pour résidence: ${residenceId || 'TOUTES'}`);

    // ✅ CORRECTION : Charger les charges avec filtrage par résidence
    let toutesCharges = this.cache.getCharges();
    if (!toutesCharges) {
      toutesCharges = await this.chargeService.list(residenceId); // ← Passer residenceId
      this.cache.setCharges(toutesCharges);
    }
    const chargesActives = toutesCharges.filter(c =>
      this.estChargeActive(c, anneeRef, moisRef),
    );

    console.log(`📊 ${chargesActives.length} charges actives`);

    // 2. Pré-charger la carte inversée appartementId → userId
    let users = this.userService.getAll();
    if (!users.length) users = await this.userService.loadFromFirestore();
    const apptToUser = new Map<string, string>(
      users
        .filter(u => u.appartementId)
        .map(u => [String(u.appartementId), typeof u.id === 'string' ? u.id : String(u.id)]),
    );

    // 3. Charger les dettes existantes pour ce mois
    const dettesExistantes = await this.detteService.getByPeriode(anneeRef, moisRef);

    const existantesSet = new Set<string>(
      dettesExistantes.flatMap(d => {
        const entries: string[] = [d.id];
        if (d.chargeId && d.appartementId) entries.push(`${d.chargeId}|${d.appartementId}`);
        return entries;
      }),
    );

    let chargesTraitees = 0;
    let totalGenere = 0;
    const erreurs: Array<{ charge: string; erreur: string }> = [];
    const chargesSansCreation: string[] = [];

    // 4. Pour chaque charge, générer les dettes manquantes
    for (const charge of chargesActives) {
      try {
        const { dettesCreees } = await this.genererDettesPourCharge(
          charge, anneeRef, moisRef, existantesSet, apptToUser, userId,
        );
        chargesTraitees++;
        totalGenere += dettesCreees.length;

        if (dettesCreees.length === 0) {
          chargesSansCreation.push(charge.libelle);
        }
      } catch (error: any) {
        console.error(`❌ Charge "${charge.libelle}":`, error);
        erreurs.push({ charge: charge.libelle, erreur: error.message ?? 'Erreur inconnue' });
      }
    }

    console.log(`✨ Terminé: ${totalGenere} dettes créées`);

    return {
      success: totalGenere > 0 && erreurs.length === 0,
      dejaGenere: dettesExistantes.length > 0 && totalGenere === 0,
      nombreDettesCrees: totalGenere,
      chargesTraitees,
      chargesSansCreation,
      erreurs,
    };
  }

  /**
   * ✅ CORRIGÉ : Ajout du paramètre residenceId
   */
  async genererDettesAnnuelles(
    annee: number,
    residenceId?: string | null,  // ← NOUVEAU paramètre
    userId?: string
  ): Promise<GenerationAnnuelleResult> {
    const resultatsParMois: Record<number, GenerationMoisResult> = {};
    let totalDettesCrees = 0;
    let succesGlobal = true;

    for (let m = 1; m <= 12; m++) {
      const res = await this.genererDettesduMois(annee, m, residenceId, userId);
      resultatsParMois[m] = res;
      totalDettesCrees += res.nombreDettesCrees;
      if (!res.success && !res.dejaGenere) succesGlobal = false;
    }

    return { success: succesGlobal, totalDettesCrees, resultatsParMois };
  }

  async genererDettesManquantes(
    dateDebut: Date,
    dateFin: Date,
    residenceId?: string | null,
    userId?: string,
  ): Promise<{ total: number; par_mois: Record<string, number> }> {
    const par_mois: Record<string, number> = {};
    let total = 0;
    const current = new Date(dateDebut);
    current.setDate(1);

    while (current <= dateFin) {
      const a = current.getFullYear();
      const m = current.getMonth() + 1;
      const key = `${a}-${String(m).padStart(2, '0')}`;
      const res = await this.genererDettesduMois(a, m, residenceId, userId);
      par_mois[key] = res.nombreDettesCrees;
      total += res.nombreDettesCrees;
      current.setMonth(current.getMonth() + 1);
    }

    return { total, par_mois };
  }

  async dettesExistentPourMois(annee: number, mois: number): Promise<boolean> {
    const dettes = await this.detteService.getByAnnee(annee);
    return dettes.some(d => d.mois === mois);
  }

  // ── Privées ──────────────────────────────────────────────────────────────────

  private async genererDettesPourCharge(
    charge: Charge,
    annee: number,
    mois: number,
    existantesSet: Set<string>,
    apptToUser: Map<string, string>,
    userId?: string,
  ): Promise<{ dettesCreees: Dette[] }> {
    const chargeNormalisee: Charge = charge.scope === 'parking'
      ? { ...charge, mode_repartition: 'INDIVIDUEL' as any }
      : charge;

    const calcul = await this.repartitionService.calculerRepartition(chargeNormalisee);
    const dateEcheance = new Date(annee, mois, 0).toISOString();

    const payloads: CreateDettePayload[] = [];

    for (const rep of calcul.repartitions) {
      const key = `${charge.id}|${rep.appartementId}`;
      const detteId = `DET-${annee}-${String(mois).padStart(2, '0')}-${rep.appartementId}-${charge.id}`;
      if (existantesSet.has(key) || existantesSet.has(detteId)) continue;

      const coproprietaireId = await this.resolveCoproprietaireId(rep.appartementId, rep.coproprietaireId, apptToUser);

      if (!coproprietaireId) {
        console.warn(`${charge.libelle}: aucun coproprietaire trouvé pour appartement ${rep.appartementId}`);
      }

      const montantFixe = rep.montant_mensuel ?? 0;
      if (montantFixe <= 0) {
        console.warn(`${charge.libelle}: montant nul pour appartement ${rep.appartementId} — ignoré`);
        continue;
      }

      payloads.push({
        appartementId: rep.appartementId,
        coproprietaireId: coproprietaireId || 'UNKNOWN',
        chargeId: charge.id,
        annee,
        mois,
        montant_original: montantFixe,
        date_echeance: dateEcheance,
        notes: `${charge.libelle} — ${mois}/${annee}`,
      });

      existantesSet.add(key);
    }

    if (payloads.length === 0) return { dettesCreees: [] };

    const dettesCreees = await this.detteService.createBatch(payloads, userId);
    console.log(`✅ "${charge.libelle}": ${dettesCreees.length} dettes créées`);
    return { dettesCreees };
  }

  private estChargeActive(charge: Charge, annee: number, mois: number): boolean {
    if (charge.statut !== 'ACTIVE') return false;

    const dateDebut = new Date(charge.date_debut);
    const dateTest  = new Date(annee, mois - 1, 1);
    if (dateTest < dateDebut) return false;

    if (charge.date_fin) {
      const dateFin = new Date(charge.date_fin);
      if (dateTest > dateFin) return false;
    }

    return this.respecteFrequence(charge, annee, mois);
  }

  private respecteFrequence(charge: Charge, annee: number, mois: number): boolean {
    switch (charge.frequence) {
      case 'MENSUELLE':     return true;
      case 'TRIMESTRIELLE': return [1, 4, 7, 10].includes(mois);
      case 'ANNUELLE': {
        const debut = new Date(charge.date_debut);
        return mois === debut.getMonth() + 1;
      }
      case 'PONCTUELLE': return false;
      default:           return true;
    }
  }

  private async resolveCoproprietaireId(
    appartementId: string,
    fallback?: string,
    apptToUser?: Map<string, string>,
  ): Promise<string> {
    if (fallback) return fallback;

    let appartements = this.cache.getAppartements() ?? [];
    let apt = appartements.find(a => a.docId === appartementId);
    if (!apt) {
      const fetched = await this.appartementService.getById(appartementId);
      if (fetched) {
        apt = fetched;
        appartements = appartements.length ? [...appartements, fetched] : [fetched];
        this.cache.setAppartements(appartements);
      }
    }
    const fromApt = apt ? (apt.proprietaireId || apt.locataireId || '') : '';
    if (fromApt) return fromApt;

    return apptToUser?.get(appartementId) ?? '';
  }
}