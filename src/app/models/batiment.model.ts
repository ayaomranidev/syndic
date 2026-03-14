// src/app/models/batiment.model.ts
export interface Batiment {
  id: number;
  nom: string;
  residenceId: number;
  residenceNom: string;
  adresse: string;
  nombreEtages: number;
  nombreAppartements: number;
  anneeConstruction: number;
  type: 'Appartement' | 'Bureau' | 'Mixte';
  ascenseur: boolean;
  parking: boolean;
  gardien: boolean;
  dateMiseEnService: string;
  statut: 'actif' | 'maintenance' | 'inactif';
  caracteristiques: string[];
  chargesMensuelles?: number;
  fondsTravaux?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BatimentStats {
  totalBatiments: number;
  batimentsActifs: number;
  totalAppartements: number;
  avecAscenseur: number;
  avecParking: number;
  avecGardien: number;
  repartitionParType: {
    type: string;
    count: number;
    pourcentage: number;
  }[];
}

export interface CreateBatimentDto {
  nom: string;
  residenceId: number;
  adresse: string;
  nombreEtages: number;
  nombreAppartements: number;
  anneeConstruction: number;
  type: 'Appartement' | 'Bureau' | 'Mixte';
  ascenseur: boolean;
  parking: boolean;
  gardien: boolean;
  dateMiseEnService: string;
  statut: 'actif' | 'maintenance' | 'inactif';
  caracteristiques: string[];
}

export interface UpdateBatimentDto extends Partial<CreateBatimentDto> {}