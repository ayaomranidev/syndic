// ==================== ENUMS ====================

export type ChargeType = 'FIXE' | 'TRAVAUX' | 'VARIABLE';
export type ChargeScope = 'all' | 'building' | 'apartment' | 'parking'| 'ascenseur'; 
export type ChargeCategorie = 
  | 'COURANTE' 
  | 'ASCENSEUR' 
  | 'GARDIEN' 
  | 'ENTRETIEN' 
  | 'ASSURANCE'
  | 'EAU'
  | 'ELECTRICITE'
  | 'GAZ'
  | 'AUTRE';
  
export type UniteMontant = 'MENSUEL' | 'TOTAL' | 'M3' | 'KWH' | 'ANNUELLE';
export type Frequence = 'MENSUELLE' | 'TRIMESTRIELLE' | 'ANNUELLE' | 'PONCTUELLE';
export type ModeRepartition = 'TANTIEMES' | 'EGALITAIRE' | 'SURFACE' | 'COMPTEUR';
export type StatutCharge = 'ACTIVE' | 'TERMINE' | 'SUSPENDUE' | 'PLANIFIEE';
export type UrgenceLevel = 'BASSE' | 'MOYENNE' | 'HAUTE' | 'CRITIQUE';

// ==================== BASE CHARGE INTERFACE ====================

export interface BaseCharge {
  id: string;
  libelle: string;
  description?: string;
  type_charge: ChargeType;
  categorie: ChargeCategorie;
  montant: number;
  unite_montant: UniteMontant;
  date_debut: string; // ISO yyyy-mm-dd
  date_fin?: string; // ISO yyyy-mm-dd
  duree_mois?: number;
  frequence: Frequence;
  mode_repartition: ModeRepartition;
  statut: StatutCharge;
  
  // Scope et ciblage
  scope: ChargeScope;
  building?: string; // Legacy field
  buildingIds?: string[];
  apartmentIds?: string[];
  floors?: number[];
  applicable_parking?: boolean;
  parkingIds?: string[];
  
  // Métadonnées communes
  notes?: string;
  created_by?: string;
  createdAt?: string;
  updatedAt?: string;
  active?: boolean;
}

// ==================== CHARGE FIXE ====================

export interface ChargeFixe extends BaseCharge {
  type_charge: 'FIXE';
  unite_montant: 'MENSUEL' | 'ANNUELLE';
  
  // Champs spécifiques aux charges fixes
  contrat_id?: string;
  fournisseur?: string;
  reconduction_auto?: boolean;
  date_prochain_renouvellement?: string;
  conditions_resiliation?: string;
}

// ==================== CHARGE TRAVAUX ====================

export interface ChargeTravaux extends BaseCharge {
  type_charge: 'TRAVAUX';
  unite_montant: 'TOTAL';
  frequence: 'PONCTUELLE';
  
  // Champs spécifiques aux travaux
  date_panne?: string; // ISO yyyy-mm-dd
  urgence?: UrgenceLevel;
  intervenant?: string;
  pieces_remplacees?: string[]; // Liste des pièces
  devis_id?: string;
  devis_montant?: number;
  facture_id?: string;
  facture_montant?: number;
  duree_intervention?: number; // en heures
  garantie_mois?: number;
  date_intervention?: string;
  photos?: string[]; // URLs des photos
  cause_panne?: string;
}

// ==================== CHARGE VARIABLE (Consommation) ====================

export interface ChargeVariable extends BaseCharge {
  type_charge: 'VARIABLE';
  unite_montant: 'M3' | 'KWH' | 'MENSUEL';
  mode_repartition: 'COMPTEUR' | 'TANTIEMES';
  
  // Champs spécifiques aux charges variables
  compteur_general?: string; // Numéro du compteur général
  index_debut?: number;
  index_fin?: number;
  consommation_totale?: number;
  prix_unitaire?: number; // Prix par unité (m3, kwh, etc.)
  fournisseur?: string;
  numero_contrat?: string;
  periode_releve?: string; // Ex: "Janvier 2025"
  
  // Pour la répartition par compteur individuel
  releves_individuels?: ReleverCompteur[];
}

export interface ReleverCompteur {
  appartement_id: string;
  appartement_numero: string;
  compteur_numero?: string;
  index_precedent: number;
  index_actuel: number;
  consommation: number;
  montant_calcule?: number;
  date_releve?: string;
  photo_compteur?: string;
}

// ==================== UNION TYPE ====================

export type Charge = ChargeFixe | ChargeTravaux | ChargeVariable;

// ==================== PAYLOAD TYPES ====================

export type ChargeFixePayload = Omit<ChargeFixe, 'id' | 'createdAt' | 'updatedAt'> & 
  Partial<Pick<ChargeFixe, 'createdAt' | 'updatedAt'>>;

export type ChargeTravauxPayload = Omit<ChargeTravaux, 'id' | 'createdAt' | 'updatedAt'> & 
  Partial<Pick<ChargeTravaux, 'createdAt' | 'updatedAt'>>;

export type ChargeVariablePayload = Omit<ChargeVariable, 'id' | 'createdAt' | 'updatedAt'> & 
  Partial<Pick<ChargeVariable, 'createdAt' | 'updatedAt'>>;

export type ChargePayload = ChargeFixePayload | ChargeTravauxPayload | ChargeVariablePayload;

// ==================== HELPER TYPES ====================

export interface ChargeStats {
  totalAnnual: number;
  totalMonthly: number;
  fixesTotal: number;
  travauxTotal: number;
  variablesTotal: number;
  count: number;
  countByType: {
    FIXE: number;
    TRAVAUX: number;
    VARIABLE: number;
  };
}

export type ChargeCard = Charge & {
  endDate?: string;
  rangeLabel: string;
  statusLabel?: string;
  urgenceLabel?: string;
};

// ==================== CONSTANTS ====================

export const CHARGE_CATEGORIES: Record<ChargeCategorie, string> = {
  COURANTE: 'Courante',
  ASCENSEUR: 'Ascenseur',
  GARDIEN: 'Gardien',
  ENTRETIEN: 'Entretien',
  ASSURANCE: 'Assurance',
  EAU: 'Eau',
  ELECTRICITE: 'Électricité',
  GAZ: 'Gaz',
  AUTRE: 'Autre'
};

export const URGENCE_LABELS: Record<UrgenceLevel, string> = {
  BASSE: 'Basse',
  MOYENNE: 'Moyenne',
  HAUTE: 'Haute',
  CRITIQUE: 'Critique'
};

export const STATUT_LABELS: Record<StatutCharge, string> = {
  ACTIVE: 'Active',
  TERMINE: 'Terminée',
  SUSPENDUE: 'Suspendue',
  PLANIFIEE: 'Planifiée'
};