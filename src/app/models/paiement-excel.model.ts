// models/paiement-excel.model.ts
export interface PaiementExcel {
  // Identifiants
  id?: number;
  docId?: string;
  
  // Informations appartement
  etage: string;
  numeroAppart: string;
  proprietaire: string;
  telephone: string;
  
  // Historique des paiements par mois
  historique: {
    [date: string]: number; // "2018-10-01": 25, "2018-11-01": 13, etc.
  };
  
  // Totaux et calculs
  totalPaye: number;
  ancienLocataire: number;
  resteAPayer: number;
  nbMoisRetard: number;
  resteParEtage: number;
  
  // Métadonnées
  bloc: 'C1' | 'C2';
  type: 'appartement' | 'parking';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface HistoriqueGlobal {
  totalCollecte: number;
  totalImpayes: number;
  tauxRecouvrement: number;
  paiementsParMois: {
    mois: string;
    montant: number;
  }[];
  topImpayes: {
    appartement: string;
    montant: number;
  }[];
}