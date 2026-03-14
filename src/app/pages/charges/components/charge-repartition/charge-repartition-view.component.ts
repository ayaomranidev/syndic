import { ChangeDetectionStrategy, Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { ChargeService } from '../../services/charge.service';
import { ChargeRepartitionService } from '../../services/charge-repartition.service';
import { AppartementService } from '../../../appartements/services/appartement.service';
import { CalculMensuelService } from '../../../paiements/services/calcul-mensuel.service';
import { Auth } from '../../../../core/services/auth';
import { UserService } from '../../../coproprietaires/services/coproprietaire.service';
import { Charge } from '../../../../models/charge.model';
import { ChargeRepartition } from '../../../../models/chargeRepartition.model';

@Component({
  selector: 'app-charge-repartition-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './charge-repartition-view.component.html',
  styleUrls: ['./charge-repartition-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChargeRepartitionViewComponent implements OnInit {
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly chargeService = inject(ChargeService);
  private readonly repartitionService = inject(ChargeRepartitionService);
  private readonly appartementService = inject(AppartementService);
  private readonly calculMensuelService = inject(CalculMensuelService);

  readonly charges           = signal<Charge[]>([]);
  readonly repartitionsHistory = signal<ChargeRepartition[]>([]);
  readonly selectedChargeId  = signal<string | null>(null);
  readonly selectedRepartition = signal<ChargeRepartition | null>(null);
  readonly appartements = signal<any[]>([]);
  readonly isLoading         = signal(false);
  readonly error             = signal<string | null>(null);
  readonly success           = signal<string | null>(null);

  // ✅ AJOUT : Gestion des rôles
  private isResidenceAdmin = false;
  private currentResidenceId: string | null = null;

  readonly filteredRepartition = computed<ChargeRepartition | null>(() => {
    const rep = this.selectedRepartition();
    const charge = this.selectedCharge();
    if (!rep || !charge) return rep;
    if (charge.scope === 'ascenseur') {
      const apps = this.appartements() || [];
      const allowed = new Set(apps.filter(a => a.docId && (a.hasAscenseur || (a.caracteristiques || []).includes('Ascenseur'))).map(a => a.docId));
      return { ...rep, repartitions: rep.repartitions.filter(r => allowed.has(r.appartementId)) } as ChargeRepartition;
    }
    if (charge.scope === 'parking') {
      const apps = this.appartements() || [];
      const allowed = new Set(apps.filter(a => a.docId && (a.hasParking || (a.caracteristiques || []).includes('Parking'))).map(a => a.docId));
      return { ...rep, repartitions: rep.repartitions.filter(r => allowed.has(r.appartementId)) } as ChargeRepartition;
    }
    return rep;
  });

  readonly stats = computed(() => {
    const rep = this.filteredRepartition();
    if (!rep) return null;
    return this.repartitionService.calculerStats(rep);
  });

  readonly selectedCharge = computed<Charge | undefined>(() => {
    const id = this.selectedChargeId();
    return id ? this.charges().find(c => c.id === id) : undefined;
  });

  async ngOnInit(): Promise<void> {
    await this.loadUserData();
    await this.loadCharges();
    try {
      const apps = await this.appartementService.loadAppartements();
      this.appartements.set(apps || []);
    } catch (e) {
      this.appartements.set([]);
    }
    if (this.charges().length) {
      await this.onChargeChange(this.charges()[0].id);
    }
  }

  // ✅ NOUVELLE MÉTHODE : Charger les données utilisateur
  private async loadUserData(): Promise<void> {
    try {
      await firstValueFrom(this.auth.currentUser$.pipe(filter(Boolean), take(1)));
      const firebaseUser = this.auth.currentUser;
      
      if (firebaseUser) {
        const userData = await this.userService.getById(String(firebaseUser.id));
        
        if (userData) {
          const roles = userData.roles || [];
          this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
          this.currentResidenceId = this.isResidenceAdmin ? userData.residenceId || null : null;
          
          console.log('✅ Données utilisateur chargées:', {
            isResidenceAdmin: this.isResidenceAdmin,
            currentResidenceId: this.currentResidenceId
          });
        }
      }
    } catch (error) {
      console.error('Erreur chargement utilisateur:', error);
    }
  }

  async onChargeChange(chargeId: string): Promise<void> {
    this.selectedChargeId.set(chargeId);
    this.error.set(null);
    await this.loadRepartitionForCharge(chargeId);
  }

  async regenererRepartition(): Promise<void> {
    const charge = this.selectedCharge();
    if (!charge) { this.error.set('Veuillez sélectionner une charge.'); return; }

    this.isLoading.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      const currentUser = this.auth.currentUser;
      const userId = currentUser?.id ? String(currentUser.id) : undefined;
      const rep = await this.repartitionService.creerRepartition(charge, userId);
      await this.loadRepartitionForCharge(charge.id);
      try {
        this.calculMensuelService.clearCache();
        window.dispatchEvent(new CustomEvent('montants:updated'));
      } catch (e) {
        // ignore
      }
      this.success.set(`Répartition recalculée : ${rep.repartitions.length} appartements traités.`);
      setTimeout(() => this.success.set(null), 5000);
    } catch (err) {
      this.error.set((err as Error).message || 'Erreur lors du recalcul.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadCharges(): Promise<void> {
    this.isLoading.set(true);
    try {
      // ✅ CORRECTION : Filtrer les charges par résidence
      const data = await this.chargeService.list(this.currentResidenceId);
      this.charges.set(data.sort((a, b) => a.libelle.localeCompare(b.libelle)));
    } catch (err) {
      this.error.set('Impossible de charger les charges.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadRepartitionForCharge(chargeId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const historiques = await this.repartitionService.getByCharge(chargeId);
      const sorted = [...historiques].sort((a, b) =>
        (b.date_calcul || '').localeCompare(a.date_calcul || ''),
      );
      this.repartitionsHistory.set(sorted);
      this.selectedRepartition.set(sorted[0] ?? null);
      if (!sorted[0]) {
        this.error.set('Aucune répartition calculée. Cliquez sur "Recalculer".');
      }
    } catch (err) {
      this.error.set('Impossible de charger les répartitions.');
    } finally {
      this.isLoading.set(false);
    }
  }
}