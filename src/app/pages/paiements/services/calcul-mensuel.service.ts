import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { Charge } from '../../../models/charge.model';
import { AppartementService, Appartement } from '../../appartements/services/appartement.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { User } from '../../../models/user.model';

@Injectable({ providedIn: 'root' })
export class CalculMensuelService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db = getFirestore(this.app);
  
  private cache = new Map<string, Map<string, number>>();

  constructor(
    private readonly appartementService: AppartementService,
    private readonly userService: UserService,
  ) {}

  async getMontantsPourTousAppartements(annee: number, mois: number): Promise<Map<string, number>> {
    const cacheKey = `${annee}-${mois}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const montants = new Map<string, number>();

    try {
      const [charges, appartements, users] = await Promise.all([
        this.loadChargesActives(annee, mois),
        this.appartementService.loadAppartements(),
        this.userService.loadFromFirestore(),
      ]);

      // Construire la map aptId → User pour la proratisation
      const userByAptId = new Map<string, User>();
      for (const u of users) {
        if (u.appartementId) userByAptId.set(String(u.appartementId), u);
      }

      // Initialiser chaque appartement à 0
      appartements.forEach(apt => { if (apt.docId) montants.set(apt.docId, 0); });

      for (const charge of charges) {
        // ✅ CORRECTION: filtrer PAR SCOPE avant de calculer le total des poids
        const concerned = appartements.filter(apt => this.isAppartementConcerne(apt, charge));
        if (concerned.length === 0) continue;

        const montantMensuel = this.getMontantMensuel(charge);

        // Parking : montant fixe par appartement (pas de répartition)
        if (charge.scope === 'parking') {
          for (const apt of concerned) {
            if (!apt.docId) continue;
            const prorata = this.getProrata(userByAptId.get(apt.docId), annee, mois);
            if (prorata <= 0) continue;
            const prev = montants.get(apt.docId) || 0;
            montants.set(apt.docId, Math.round((prev + montantMensuel * prorata) * 100) / 100);
          }
          continue;
        }

        // Total des poids uniquement sur les appartements concernés
        const totalPoids = concerned.reduce(
          (sum, apt) => sum + this.getPoids(apt, charge.mode_repartition), 0
        );
        if (totalPoids === 0) continue;

        for (const apt of concerned) {
          if (!apt.docId) continue;
          const prorata = this.getProrata(userByAptId.get(apt.docId), annee, mois);
          if (prorata <= 0) continue;
          const poids = this.getPoids(apt, charge.mode_repartition);
          const share = (montantMensuel * poids) / totalPoids;
          const prev  = montants.get(apt.docId) || 0;
          montants.set(apt.docId, Math.round((prev + share * prorata) * 100) / 100);
        }
      }

      this.cache.set(cacheKey, montants);
      return montants;

    } catch (error) {
      console.error('❌ Erreur calcul mensuel:', error);
      return montants;
    }
  }

  /** Montant mensuel effectif selon l'unité de la charge */
  private getMontantMensuel(charge: Charge): number {
    switch (charge.unite_montant) {
      case 'ANNUELLE': return charge.montant / 12;
      case 'TOTAL':
        return (charge.duree_mois && charge.duree_mois > 0)
          ? charge.montant / charge.duree_mois
          : charge.montant;
      default: return charge.montant; // MENSUEL
    }
  }

  /** Poids d'un appartement selon le mode de répartition */
  private getPoids(apt: Appartement, mode: string): number {
    switch (mode) {
      case 'TANTIEMES': return Number(apt.quotePart) || 0;
      case 'SURFACE':   return Number(apt.surface)   || 0;
      case 'EGALITAIRE':
      case 'COMPTEUR':
      default:          return 1;
    }
  }

  private async loadChargesActives(annee: number, mois: number): Promise<Charge[]> {
    const col = collection(this.db, 'charges');
    const snapshot = await getDocs(col);
    
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Charge))
      .filter(charge => {
        const debut = new Date(charge.date_debut);
        const fin = charge.date_fin ? new Date(charge.date_fin) : null;
        const dateMois = new Date(annee, mois - 1, 15);
        
        return charge.statut === 'ACTIVE' &&
               debut <= dateMois &&
               (!fin || fin >= dateMois);
      });
  }

  private isAppartementConcerne(apt: Appartement, charge: Charge): boolean {
    const chargeResidenceId = (charge as any).residenceId as string | undefined;
    if (chargeResidenceId && apt.residenceDocId !== chargeResidenceId) {
      return false;
    }

    // Scope "parking" : seuls les appartements avec parking
    if (charge.scope === 'parking') {
      return Boolean(apt.hasParking || (apt as any).parking || (apt.caracteristiques || []).includes('Parking'));
    }

    // Scope "ascenseur" : seuls les appartements avec ascenseur
    if (charge.scope === 'ascenseur') {
      return Boolean(apt.hasAscenseur || (apt.caracteristiques || []).includes('Ascenseur'));
    }

    let isConcerned = false;
    if (charge.scope === 'all') {
      isConcerned = true;
    } else if (charge.scope === 'building' && charge.buildingIds) {
      isConcerned = charge.buildingIds.includes(apt.batimentDocId || '');
    } else if (charge.scope === 'apartment' && charge.apartmentIds) {
      isConcerned = charge.apartmentIds.includes(apt.docId || '');
    }

    // Si applicable_parking est coché, restreindre aux appartements avec parking
    if (isConcerned && charge.applicable_parking) {
      return Boolean(apt.hasParking || (apt as any).parking || (apt.caracteristiques || []).includes('Parking'));
    }

    return isConcerned;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Retourne le détail de chaque charge active appliquée à un appartement
   * pour un mois donné, avec le montant individuel calculé.
   */
  async getChargesBreakdown(
    aptDocId: string,
    annee: number,
    mois: number,
  ): Promise<{ chargeId: string; libelle: string; montant: number; mode: string }[]> {
    try {
      const [charges, appartements, users] = await Promise.all([
        this.loadChargesActives(annee, mois),
        this.appartementService.loadAppartements(),
        this.userService.loadFromFirestore(),
      ]);

      const apt = appartements.find(a => a.docId === aptDocId);
      if (!apt) return [];

      // Trouver l'utilisateur lié à cet appartement
      const user = users.find(u => String(u.appartementId) === aptDocId);
      const prorata = this.getProrata(user, annee, mois);
      if (prorata <= 0) return [];

      const result: { chargeId: string; libelle: string; montant: number; mode: string }[] = [];

      for (const charge of charges) {
        if (!this.isAppartementConcerne(apt, charge)) continue;

        const montantMens  = this.getMontantMensuel(charge);

        // Parking : montant fixe (pas de répartition)
        if (charge.scope === 'parking') {
          if (montantMens <= 0) continue;
          result.push({
            chargeId: charge.id,
            libelle:  charge.libelle,
            montant:  Math.round(montantMens * prorata * 100) / 100,
            mode:     charge.mode_repartition,
          });
          continue;
        }

        const concerned    = appartements.filter(a => this.isAppartementConcerne(a, charge));
        const totalPoids   = concerned.reduce((s, a) => s + this.getPoids(a, charge.mode_repartition), 0);
        if (totalPoids === 0) continue;

        const poids  = this.getPoids(apt, charge.mode_repartition);
        const montant = Math.round((montantMens * poids) / totalPoids * prorata * 100) / 100;
        if (montant <= 0) continue;

        result.push({
          chargeId: charge.id,
          libelle:  charge.libelle,
          montant,
          mode:     charge.mode_repartition,
        });
      }

      return result;
    } catch (err) {
      console.error('❌ getChargesBreakdown:', err);
      return [];
    }
  }

  /**
   * Coefficient de prorata basé sur date_entree/date_sortie de l'utilisateur.
   * 0 = pas encore emménagé ou déjà parti, 1 = mois complet, entre 0 et 1 = partiel.
   */
  private getProrata(user: User | undefined, annee: number, mois: number): number {
    if (!user || !user.date_entree) return 1;

    const premierJour = new Date(annee, mois - 1, 1);
    const dernierJour = new Date(annee, mois, 0);
    const nbJours = dernierJour.getDate();
    const dateEntree = new Date(user.date_entree);

    if (dateEntree > dernierJour) return 0;

    if (user.date_sortie) {
      const dateSortie = new Date(user.date_sortie);
      if (dateSortie < premierJour) return 0;
      if (dateSortie <= dernierJour) {
        const jourSortie = dateSortie.getDate();
        if (dateEntree >= premierJour) {
          const jours = Math.max(1, jourSortie - dateEntree.getDate() + 1);
          return Math.round((jours / nbJours) * 100) / 100;
        }
        return Math.round((jourSortie / nbJours) * 100) / 100;
      }
    }

    if (dateEntree >= premierJour && dateEntree <= dernierJour) {
      const joursRestants = nbJours - dateEntree.getDate() + 1;
      return Math.round((joursRestants / nbJours) * 100) / 100;
    }

    return 1;
  }
}