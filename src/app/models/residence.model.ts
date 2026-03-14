// Modèles pour la gestion des résidences
export interface ResidenceRef {
  docId: string;
  name: string;
  city?: string;
  address?: string;
}

export interface Residence extends ResidenceRef {
  description?: string;
  nbBatiments?: number;
  nbAppartements?: number;
  createdAt?: Date;
  createdBy?: string;
  updatedAt?: Date;
}
