import { Dette } from './dette.model';

/**
 * CompteAppartement - Vue synthétique du compte d'un appartement
 * 
 * OBJECTIF:
 * Donner une vue claire et rapide de la situation financière d'un appartement:
 * - Combien il doit au total
 * - Répartition par année (arriérés 2025, 2026, etc.)
 * - Historique des paiements
 * - Prochaines échéances
 */

export interface CompteAppartement {
  id: string;
  appartementId: string;
  appartement_numero: string;
  coproprietaireId: string;
  coproprietaire_nom: string;
  
  // Synthèse par année
  arrieres_par_annee: {
    [annee: string]: ArrieresAnnee;
  };
  
  // Totaux globaux
  total_du_original: number;       // Total de toutes les dettes originales
  total_paye: number;              // Total payé
  total_restant: number;           // Total restant à payer
  solde: number;                   // Positif = crédit, Négatif = dette
  
  // Statistiques
  nombre_dettes_totales: number;
  nombre_dettes_impayees: number;
  nombre_dettes_partielles: number;
  dette_plus_ancienne?: {
    annee: number;
    mois: number;
    montant: number;
  };
  
  // Prochaines échéances
  prochaines_echeances: DetteEcheance[];
  
  // Dernière mise à jour
  derniere_maj: string;
  updatedAt: string;
}

/**
 * Arriérés pour une année donnée
 */
export interface ArrieresAnnee {
  annee: number;
  montant_du_original: number;
  montant_paye: number;
  montant_restant: number;
  nombre_mois_total: number;
  nombre_mois_impayes: number;
  mois_impayes: number[];          // Liste des mois impayés
  mois_partiels: number[];         // Liste des mois partiellement payés
  dettes: Dette[];                 // Détail des dettes
}

/**
 * Échéance à venir
 */
export interface DetteEcheance {
  detteId: string;
  annee: number;
  mois: number;
  montant: number;
  date_echeance: string;
  jours_restants: number;
  est_en_retard: boolean;
}

/**
 * Payload pour mettre à jour un compte
 */
export interface UpdateComptePayload {
  total_paye?: number;
  total_restant?: number;
  solde?: number;
  derniere_maj?: string;
}

/**
 * Stats globales des comptes
 */
export interface ComptesStats {
  nombre_comptes_total: number;
  nombre_comptes_a_jour: number;       // Solde = 0
  nombre_comptes_en_credit: number;    // Solde > 0
  nombre_comptes_en_dette: number;     // Solde < 0
  total_arrieres_global: number;
  arrieres_par_annee: {
    [annee: string]: number;
  };
  taux_recouvrement: number;           // % des dettes payées
}

/**
 * Historique de paiement
 */
export interface HistoriquePaiement {
  paiementId: string;
  date_paiement: string;
  montant: number;
  mode_paiement: string;
  dettes_affectees: {
    detteId: string;
    annee: number;
    mois: number;
    montant_alloue: number;
  }[];
}