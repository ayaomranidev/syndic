// Modèles pour la gestion des appartements et bâtiments
export type AppartementStatus = 'occupé' | 'vacant' | 'en_renovation';

export type AppartementType = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'Duplex' | 'Studio' | 'Maisonette';

export interface BatimentRef {
  docId: string;
  name: string;
  residenceDocId?: string | null;
  residenceName?: string;
  floors?: number;
}

export interface Appartement {
  docId?: string;
  numero: string;
  surface: number;
  nombrePieces: number;
  etage: number;
  batimentDocId?: string | null;
  batimentName?: string;
  residenceDocId?: string | null;
  residenceName?: string;
  type: AppartementType;
  statut: AppartementStatus;
  chargesMensuelles: number;
  quotePart: number;
  proprietaireId?: string | null;
  locataireId?: string | null;
  hasParking?: boolean;
  hasAscenseur?: boolean;
  caracteristiques: string[];
  createdAt?: Date;
  createdBy?: string;
}
