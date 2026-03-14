// src/app/models/paiementAllocation.model.ts

export interface PaiementAllocation {
  id: string;
  paiementId: string;
  detteId: string;
  montant_alloue: number;
  ordre_priorite: number;
  date_allocation: string;
  createdAt: string;  // ✅ Propriété requise
}

export interface CreatePaiementAllocationPayload {
  paiementId: string;
  detteId: string;
  montant_alloue: number;
  ordre_priorite: number;
  date_allocation?: string;
}

export interface PaiementAllocationResult {
  paiementId: string;
  montant_total: number;
  montant_alloue: number;
  montant_restant: number;
  allocations: PaiementAllocation[];
  dettes_soldees: string[];
  dettes_partielles: string[];
}

export interface AllocationStats {
  total_allocations: number;
  total_montant_alloue: number;
  nombre_dettes_soldees: number;
  nombre_dettes_partielles: number;
  anciennete_moyenne_jours: number;
}