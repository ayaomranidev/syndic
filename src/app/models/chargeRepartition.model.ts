import { ModeRepartition, ChargeScope } from './charge.model';

export interface ChargeRepartition {
  id: string;
  chargeId: string;
  residenceId?: string;
  date_calcul: string;
  montant_total: number;
  mode_repartition: ModeRepartition;
  scope: ChargeScope;
  repartitions: RepartitionAppartement[];
  createdAt: string;
  createdBy?: string;
}

export interface RepartitionAppartement {
  appartementId: string;
  appartement_numero: string;
  coproprietaireId: string;
  coproprietaire_nom?: string;
  quote_part: number;
  total_quote_parts: number;
  pourcentage: number;
  montant_mensuel: number;
  montant_annuel?: number;
  consommation?: number;
  prix_unitaire?: number;
  montant_calcule?: number;
  notes?: string;
}

export interface CreateChargeRepartitionPayload {
  chargeId: string;
  montant_total: number;
  mode_repartition: ModeRepartition;
  scope: ChargeScope;
  buildingIds?: string[];
  apartmentIds?: string[];
  floors?: number[];
}

export interface RepartitionCalculResult {
  repartitions: RepartitionAppartement[];
  montant_total: number;
  nombre_appartements: number;
  montant_moyen: number;
  montant_min: number;
  montant_max: number;
  total_quote_parts: number;
}

/**
 * Stats de répartition — CORRIGÉ
 * Ajout de montant_minimal_dt et montant_maximal_dt (montants réels en DT)
 * Conservation des quote_parts (tantièmes bruts) pour info technique
 */
export interface RepartitionStats {
  nombre_appartements_concernes: number;
  montant_total_reparti: number;
  montant_moyen_par_appartement: number;
  // Montants réels en DT pour l'affichage
  montant_minimal_dt: number;
  montant_maximal_dt: number;
  // Tantièmes bruts (info technique)
  quote_part_minimale: number;
  quote_part_maximale: number;
  repartition_par_batiment?: {
    [batimentId: string]: {
      nombre_appartements: number;
      montant_total: number;
      pourcentage_total: number;
    };
  };
}