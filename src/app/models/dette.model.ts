// ==================== TYPES & ENUMS ====================

export type DetteStatus = 'IMPAYEE' | 'PARTIELLEMENT_PAYEE' | 'PAYEE' | 'ANNULEE';
export type DettePriorite = 'URGENTE' | 'NORMALE' | 'FAIBLE';

// ==================== INTERFACE PRINCIPALE ====================

export interface Dette {
  id: string;
  
  // Relations
  appartementId: string;
  coproprietaireId: string; // OBLIGATOIRE - ne jamais null
  chargeId: string;
  repartitionId?: string;
  
  // ✅ NOUVEAU: Pour filtrage par résidence (ADMIN_RESIDENCE)
  residenceId?: string;       // ID de la résidence (pour filtrage)
  
  // Logique temporelle (CRITIQUE pour le système)
  annee: number;
  mois: number;
  montant_original: number;
  montant_paye: number;
  montant_restant: number;
  
  // Dates
  date_creation: string;
  date_echeance: string;
  date_dernier_rappel?: string;
  date_solde?: string;
  
  // Statut et priorité
  statut: DetteStatus;
  priorite: DettePriorite;
  
  // Gestion
  nb_relances: number;
  penalite?: number;
  interets?: number;
  paiement_ids: string[];
  
  // Métadonnées
  notes?: string;
  created_at: string;
  updated_at: string;
  updated_by?: string;
}

// ==================== PAYLOADS ====================

export interface CreateDettePayload {
  appartementId: string;
  coproprietaireId?: string;
  chargeId: string;
  repartitionId?: string;
  
  // ✅ NOUVEAU: Pour propager la résidence depuis l'appartement
  residenceId?: string;       // ID de la résidence (pour filtrage)
  
  annee: number;
  mois: number;
  montant_original: number;
  date_echeance: string;
  notes?: string;
}

export interface UpdateDettePayload {
  montant_paye?: number;
  montant_restant?: number;
  statut?: DetteStatus;
  priorite?: DettePriorite;
  nb_relances?: number;
  date_dernier_rappel?: string;
  date_solde?: string;
  penalite?: number;
  interets?: number;
  paiement_ids?: string[];
  notes?: string;
}

// ==================== STATS ====================

export interface DetteStats {
  total_du: number;
  total_paye: number;
  total_restant: number;
  par_annee: {
    [annee: string]: {
      total_original: number;
      total_paye: number;
      total_restant: number;
      nombre_mois: number;
      mois_impayes: number[];
    };
  };
  par_priorite: {
    URGENTE: number;
    NORMALE: number;
    FAIBLE: number;
  };
  nombre_dettes: number;
  nombre_dettes_impayees: number;
  nombre_dettes_partiellement_payees: number;
  nombre_dettes_payees: number;
  dette_plus_ancienne: {
    annee: number;
    mois: number;
    montant: number;
  } | null;
}

// ==================== FONCTIONS UTILITAIRES ====================

/**
 * Calcule le montant restant après un paiement
 */
export function calculerMontantRestant(dette: Dette): number {
  return Math.max(0, dette.montant_original - dette.montant_paye);
}

/**
 * Met à jour le statut d'une dette selon son montant restant
 */
export function mettreAJourStatut(dette: Dette): DetteStatus {
  if (dette.montant_restant <= 0) return 'PAYEE';
  if (dette.montant_paye > 0) return 'PARTIELLEMENT_PAYEE';
  return 'IMPAYEE';
}

/**
 * Calcule la priorité d'une dette selon son ancienneté
 */
export function calculerPriorite(dette: Dette): DettePriorite {
  const maintenant = new Date();
  const echeance = new Date(dette.date_echeance);
  const joursRetard = Math.floor((maintenant.getTime() - echeance.getTime()) / (1000 * 60 * 60 * 24));
  
  if (joursRetard > 90) return 'URGENTE';
  if (joursRetard > 30) return 'NORMALE';
  return 'FAIBLE';
}

/**
 * Vérifie si une dette est en retard
 */
export function estEnRetard(dette: Dette): boolean {
  const maintenant = new Date();
  const echeance = new Date(dette.date_echeance);
  return maintenant > echeance && dette.montant_restant > 0;
}

/**
 * Groupe les dettes par année
 */
export function grouperDettesParAnnee(dettes: Dette[]): Map<number, Dette[]> {
  const grouped = new Map<number, Dette[]>();
  
  dettes.forEach(dette => {
    const existing = grouped.get(dette.annee) || [];
    existing.push(dette);
    grouped.set(dette.annee, existing);
  });
  
  return grouped;
}

/**
 * Calcule les arriérés par année (montants restants)
 */
export function calculerArrieresParAnnee(dettes: Dette[]): { [annee: string]: number } {
  const arrieres: { [annee: string]: number } = {};
  
  dettes.forEach(dette => {
    if (dette.montant_restant > 0) {
      const anneeStr = dette.annee.toString();
      arrieres[anneeStr] = (arrieres[anneeStr] || 0) + dette.montant_restant;
    }
  });
  
  return arrieres;
}

/**
 * Trie les dettes par priorité de paiement (les plus anciennes d'abord)
 * CRUCIAL pour l'affectation des paiements
 */
export function trierDettesParPriorite(dettes: Dette[]): Dette[] {
  return [...dettes].sort((a, b) => {
    // D'abord par année (anciennes d'abord)
    if (a.annee !== b.annee) return a.annee - b.annee;
    // Puis par mois (anciens d'abord)
    if (a.mois !== b.mois) return a.mois - b.mois;
    // Puis par montant restant (plus gros d'abord)
    return b.montant_restant - a.montant_restant;
  });
}

/**
 * Filtre les dettes impayées ou partiellement payées
 */
export function filtrerDettesNonSoldees(dettes: Dette[]): Dette[] {
  return dettes.filter(d => 
    d.statut === 'IMPAYEE' || d.statut === 'PARTIELLEMENT_PAYEE'
  );
}

/**
 * Calcule le total dû
 */
export function calculerTotalDu(dettes: Dette[]): number {
  return dettes.reduce((sum, d) => sum + d.montant_restant, 0);
}

/**
 * Formate une période (année + mois) en texte
 */
export function formatterPeriode(annee: number, mois: number): string {
  const date = new Date(annee, mois - 1, 1);
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// ==================== CONSTANTS ====================

export const DETTE_STATUS_LABELS: Record<DetteStatus, string> = {
  'IMPAYEE': 'Impayée',
  'PARTIELLEMENT_PAYEE': 'Partiellement payée',
  'PAYEE': 'Payée',
  'ANNULEE': 'Annulée'
};

export const DETTE_PRIORITE_LABELS: Record<DettePriorite, string> = {
  'URGENTE': 'Urgente',
  'NORMALE': 'Normale',
  'FAIBLE': 'Faible'
};