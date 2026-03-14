export interface HistoriqueTarif {
  id: string;
  chargeId: string;
  appartementId: string;
  
  // Évolution du montant dans le temps
  annee: number;
  montant_mensuel: number;
  
  // Période de validité
  date_debut: string;
  date_fin?: string;
  
  // Raison du changement
  motif?: string;               // "Augmentation travaux", "Inflation", etc.
  
  createdAt: string;
}