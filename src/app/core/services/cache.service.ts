import { Injectable } from '@angular/core';
import { Appartement } from '../../pages//appartements/services/appartement.service';
import { Charge } from '../../models/charge.model';

/**
 * CacheService
 * ============
 * Service centralisé qui stocke en mémoire les données rarement modifiées.
 * Évite de recharger Appartements + Charges depuis Firestore à chaque calcul.
 *
 * UTILISATION:
 *   Toujours appeler via getAppartements() / getCharges() → si déjà en cache,
 *   retourne immédiatement sans aucun appel réseau.
 */
@Injectable({ providedIn: 'root' })
export class CacheService {
  private _appartements: Appartement[] | null = null;
  private _charges: Charge[] | null = null;
  private _repartitions = new Map<string, Map<string, number>>(); // chargeId → Map<appartId, montant>
  private _montantsParMois = new Map<string, Map<string, number>>(); // "annee-mois" → Map<appartId, total>

  // ─── Appartements ─────────────────────────────────────────────────────────
  hasAppartements(): boolean { return this._appartements !== null; }
  setAppartements(data: Appartement[]): void { this._appartements = data; }
  getAppartements(): Appartement[] | null { return this._appartements; }

  // ─── Charges ──────────────────────────────────────────────────────────────
  hasCharges(): boolean { return this._charges !== null; }
  setCharges(data: Charge[]): void { this._charges = data; }
  getCharges(): Charge[] | null { return this._charges; }

  // ─── Répartitions par charge ───────────────────────────────────────────────
  hasRepartition(chargeId: string): boolean { return this._repartitions.has(chargeId); }
  setRepartition(chargeId: string, data: Map<string, number>): void {
    this._repartitions.set(chargeId, data);
  }
  getRepartition(chargeId: string): Map<string, number> | undefined {
    return this._repartitions.get(chargeId);
  }

  // ─── Montants mensuels totaux ──────────────────────────────────────────────
  getMontantsMois(annee: number, mois: number): Map<string, number> | undefined {
    return this._montantsParMois.get(`${annee}-${mois}`);
  }
  setMontantsMois(annee: number, mois: number, data: Map<string, number>): void {
    this._montantsParMois.set(`${annee}-${mois}`, data);
  }

  // ─── Invalidation ─────────────────────────────────────────────────────────
  clearAll(): void {
    this._appartements = null;
    this._charges = null;
    this._repartitions.clear();
    this._montantsParMois.clear();
  }
  clearCharges(): void {
    this._charges = null;
    this._repartitions.clear();
    this._montantsParMois.clear();
  }
  
  // Invalidate appartements cache
  clearAppartements(): void {
    this._appartements = null;
  }
  
  // Invalidate repartitions cache (used when appartement properties change)
  clearRepartitions(): void {
    this._repartitions.clear();
    this._montantsParMois.clear();
  }
}