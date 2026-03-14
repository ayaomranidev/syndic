import { ChangeDetectionStrategy, Component, OnInit, computed, signal, effect, inject } from '@angular/core';
import { PaginationService } from '../../../../shared/services/pagination.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { DetteService } from '../../services/dette.service';
import { ChargeService } from '../../../charges/services/charge.service';
import { AppartementService } from '../../../appartements/services/appartement.service';
import { Auth } from '../../../../core/services/auth';
import { UserService } from '../../../coproprietaires/services/coproprietaire.service';
import { Dette } from '../../../../models/dette.model';

type StatutFilter = 'all' | 'IMPAYEE' | 'PARTIELLEMENT_PAYEE' | 'PAYEE';

interface ResumeAnnee {
  annee: number;
  dettes: Dette[];
  totalOriginal: number;
  totalPaye: number;
  totalRestant: number;
  impayees: number;
  partielles: number;
  payees: number;
}

@Component({
  selector: 'app-dette-par-annee',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dette-par-annee.component.html',
  styleUrls: ['./dette-par-annee.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetteParAnneeComponent implements OnInit {
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly detteService = inject(DetteService);
  private readonly chargeService = inject(ChargeService);
  private readonly appartementService = inject(AppartementService);

  // Service de pagination
  readonly pagination = new PaginationService<Dette>();

  // Année courante
  readonly currentYear = new Date().getFullYear();

  // ✅ AJOUT : Gestion des rôles
  private isResidenceAdmin = false;
  private currentResidenceId: string | null = null;
  private currentUser: any = null;

  // Signaux principaux
  readonly resumeParAnnee    = signal<ResumeAnnee[]>([]);
  readonly anneeSelectionnee = signal<number | null>(null);
  readonly statutFiltre      = signal<StatutFilter>('all');
  readonly isLoading         = signal(false);
  readonly error             = signal<string | null>(null);

  // Maps pour les libellés
  readonly appartementsMap = signal<Map<string, string>>(new Map());
  readonly chargesMap      = signal<Map<string, string>>(new Map());

  // Années disponibles triées
  readonly anneesDisponibles = computed(() =>
    this.resumeParAnnee().map(r => r.annee).sort((a, b) => b - a)
  );

  // Résumé de l'année sélectionnée
  readonly resumeSelectionne = computed<ResumeAnnee | null>(() => {
    const target = this.anneeSelectionnee();
    if (target === null) return null;
    return this.resumeParAnnee().find(r => r.annee === target) ?? null;
  });

  // Lignes filtrées selon l'année et le statut
  readonly filteredRows = computed<Dette[]>(() => {
    const resume = this.resumeSelectionne();
    if (!resume) return [];
    const f = this.statutFiltre();
    return f === 'all' ? resume.dettes : resume.dettes.filter(d => d.statut === f);
  });

  // Synchronisation pagination avec les lignes filtrées
  readonly paginationEffect = effect(() => {
    this.pagination.setItems(this.filteredRows());
  });

  // KPIs globaux
  readonly kpiTotal = computed(() => 
    this.resumeParAnnee().reduce((s, r) => s + r.totalOriginal, 0)
  );
  
  readonly kpiPaye = computed(() => 
    this.resumeParAnnee().reduce((s, r) => s + r.totalPaye, 0)
  );
  
  readonly kpiRestant = computed(() => 
    this.resumeParAnnee().reduce((s, r) => s + r.totalRestant, 0)
  );
  
  readonly kpiTaux = computed(() => {
    const total = this.kpiTotal();
    return total ? Math.round((this.kpiPaye() / total) * 100) : 0;
  });

  // Totaux du filtre actif
  readonly totalFiltreOriginal = computed(() =>
    this.filteredRows().reduce((s: number, d: Dette) => s + (d.montant_original || 0), 0)
  );
  
  readonly totalFiltrePaye = computed(() =>
    this.filteredRows().reduce((s: number, d: Dette) => s + (d.montant_paye || 0), 0)
  );
  
  readonly totalFiltreRestant = computed(() =>
    this.filteredRows().reduce((s: number, d: Dette) => s + (d.montant_restant || 0), 0)
  );

  async ngOnInit(): Promise<void> {
    await this.loadUserData();
    await this.chargerDettes();
  }

  // ✅ NOUVELLE MÉTHODE : Charger les données utilisateur
  private async loadUserData(): Promise<void> {
    try {
      await firstValueFrom(this.auth.currentUser$.pipe(filter(Boolean), take(1)));
      const firebaseUser = this.auth.currentUser;
      
      if (firebaseUser) {
        this.currentUser = firebaseUser;
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

  /**
   * Vérifie si une année est l'année courante
   */
  isCurrentYear(annee: number): boolean {
    return annee === this.currentYear;
  }

  /**
   * Charge toutes les dettes depuis Firestore avec filtrage par rôle
   */
  async chargerDettes(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // ✅ CORRECTION : Passer currentUser pour le filtrage
      const dettes = await this.detteService.getAll(true, this.currentUser);
      
      // Chargement des références
      const [appartements, charges] = await Promise.all([
        this.appartementService.loadAppartements(),
        this.chargeService.list(this.currentResidenceId), // ← Filtrer par résidence
      ]);

      // Construction des maps pour les libellés
      this.appartementsMap.set(
        new Map(appartements.map(a => [a.docId ?? '', `Appt ${a.numero}`]))
      );
      this.chargesMap.set(
        new Map(charges.map(c => [c.id, c.libelle]))
      );

      // Regroupement par année
      const regroupement = new Map<number, Dette[]>();
      for (const d of dettes) {
        const annee = d.annee || new Date(d.date_creation).getFullYear();
        if (!regroupement.has(annee)) regroupement.set(annee, []);
        regroupement.get(annee)!.push(d);
      }

      // Construction des résumés par année
      const resumes: ResumeAnnee[] = Array.from(regroupement.entries())
        .map(([annee, liste]) => ({
          annee,
          dettes: liste.sort((a, b) => a.mois - b.mois),
          totalOriginal: liste.reduce((s, d) => s + (d.montant_original || 0), 0),
          totalPaye: liste.reduce((s, d) => s + (d.montant_paye || 0), 0),
          totalRestant: liste.reduce((s, d) => s + (d.montant_restant || 0), 0),
          impayees: liste.filter(d => d.statut === 'IMPAYEE').length,
          partielles: liste.filter(d => d.statut === 'PARTIELLEMENT_PAYEE').length,
          payees: liste.filter(d => d.statut === 'PAYEE').length,
        }))
        .sort((a, b) => b.annee - a.annee);

      this.resumeParAnnee.set(resumes);

      // Sélection automatique de la première année
      if (resumes.length && this.anneeSelectionnee() === null) {
        this.anneeSelectionnee.set(resumes[0].annee);
      }
    } catch (err) {
      console.error('Erreur chargement dettes:', err);
      this.error.set('Impossible de charger les dettes. Vérifiez votre connexion.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Sélectionne une année à afficher
   */
  choisirAnnee(annee: number | null): void {
    this.anneeSelectionnee.set(annee);
  }

  /**
   * Applique un filtre de statut
   */
  choisirFiltre(statut: StatutFilter): void {
    this.statutFiltre.set(statut);
  }

  // Méthodes de pagination
  nextPage(): void {
    this.pagination.setPage(this.pagination.currentPage() + 1);
  }

  prevPage(): void {
    this.pagination.setPage(this.pagination.currentPage() - 1);
  }

  setPage(page: number): void {
    this.pagination.setPage(page);
  }

  /**
   * Retourne le libellé d'un appartement à partir de son ID
   */
  getAppartementLabel(id: string): string {
    return this.appartementsMap().get(id) ?? `Appartement ${id.substring(0, 6)}...`;
  }

  /**
   * Retourne le libellé d'une charge à partir de son ID
   */
  getChargeLabel(id: string): string {
    return this.chargesMap().get(id) ?? id;
  }

  /**
   * Formate un numéro de mois en libellé
   */
  formatMois(mois: number): string {
    const date = new Date(2000, Math.max(0, mois - 1), 1);
    return date.toLocaleDateString('fr-TN', { month: 'long' });
  }

  /**
   * Formate un montant en DT
   */
  formatMontant(v: number): string {
    return (v || 0).toLocaleString('fr-TN', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 0 
    }) + ' DT';
  }

  /**
   * Calcule le pourcentage payé pour un résumé d'année
   */
  getPourcentagePaye(resume: ResumeAnnee): number {
    return resume.totalOriginal
      ? Math.round((resume.totalPaye / resume.totalOriginal) * 100)
      : 0;
  }

  /**
   * Retourne la classe CSS pour la barre de progression
   */
  getProgressBarClass(pct: number): string {
    if (pct >= 80) return 'bg-emerald-500';
    if (pct >= 40) return 'bg-amber-400';
    return 'bg-red-500';
  }

  /**
   * Retourne la classe CSS pour le texte du pourcentage
   */
  getPercentageTextClass(pct: number): string {
    if (pct >= 80) return 'text-emerald-700';
    if (pct >= 40) return 'text-amber-600';
    return 'text-red-600';
  }

  /**
   * Retourne l'icône et la classe pour le statut
   */
  getStatutDisplay(statut: string): { icon: string; text: string; class: string } {
    switch (statut) {
      case 'PAYEE':
        return { 
          icon: '✓', 
          text: 'Soldée', 
          class: 'text-emerald-500 text-lg' 
        };
      case 'PARTIELLEMENT_PAYEE':
        return { 
          icon: '◑', 
          text: 'Partielle', 
          class: 'text-amber-500 text-lg' 
        };
      default:
        return { 
          icon: '⚠', 
          text: 'Impayée', 
          class: 'text-red-500 text-lg' 
        };
    }
  }

  /**
   * Retourne la classe CSS pour le badge de priorité
   */
  getPrioriteClass(priorite: string): string {
    switch (priorite) {
      case 'URGENTE':
        return 'bg-red-100 text-red-800';
      case 'NORMALE':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }
}