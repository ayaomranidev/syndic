export type PaiementStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type PaiementMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CHECK' | 'ONLINE';

export interface Paiement {
  id: string;
  appartementId: string;
  coproprietaireId: string;
  chargeId?: string; // optionnel si paiement ciblé

  amount: number; // montant versé
  currency?: string; // e.g. 'DT'
  date: string; // ISO date du paiement
  dueDate?: string;
  status: PaiementStatus;
  method?: PaiementMethod;
  reference?: string;
  notes?: string;

  // Traçabilité et répartition
  allocations?: string[]; // liste des detteId imputées (détails dans PaiementAllocation)

  createdAt?: string;
  updatedAt?: string;
}
