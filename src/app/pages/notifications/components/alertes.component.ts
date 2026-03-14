import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { RelativeTimePipe } from '../pipes/relative-time.pipe';
import {
  AlerteService,
  Alerte,
  AlerteType,
  AlertePriorite,
} from '../services/alerte.service';
import { PaginationService } from '../../../shared/services/pagination.service';

@Component({
  selector: 'app-alertes',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    RouterModule,
    RelativeTimePipe
  ],
  templateUrl: './alertes.component.html',
  styleUrls: ['./alertes.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertesComponent implements OnInit, OnDestroy {
  private readonly alerteSvc = inject(AlerteService);
  private readonly router    = inject(Router);
  readonly pagination = inject(PaginationService) as PaginationService<Alerte>;

  // États
  readonly loading    = signal(true);
  readonly alertes    = signal<Alerte[]>([]);
  readonly recherche  = signal('');
  readonly filtreStatut   = signal<'toutes' | 'non_lues' | 'lues'>('toutes');
  readonly filtreType     = signal<AlerteType | ''>('');
  readonly filtrePriorite = signal<AlertePriorite | ''>('');

  // Types disponibles pour les filtres
  readonly types: (AlerteType | 'toutes')[] = [
    'toutes', 'IMPAYÉ', 'BUDGET', 'REUNION', 'DOCUMENT', 
    'MAINTENANCE', 'SYSTEME', 'VOTE', 'CHARGE', 'RELANCE', 'BIENVENUE'
  ];
  
  readonly priorites: AlertePriorite[] = ['CRITIQUE', 'HAUTE', 'NORMALE', 'INFO'];

  private _unsubscribe: (() => void) | null = null;

  // Computed properties pour les KPI
  readonly nbNonLues  = computed(() => this.alertes().filter(a => !a.lue).length);
  readonly nbLues     = computed(() => this.alertes().filter(a => a.lue).length);
  readonly totalAlertes = computed(() => this.alertes().length);
  readonly nbCritiques  = computed(() => this.alertes().filter(a => a.priorite === 'CRITIQUE' && !a.lue).length);
  readonly nbHaute = computed(() => this.alertes().filter(a => a.priorite === 'HAUTE' && !a.lue).length);

  // Compteurs par type pour les badges dans la sidebar
  readonly compteurParType = computed(() => {
    const map = new Map<string, number>();
    this.alertes().filter(a => !a.lue).forEach(a => 
      map.set(a.type, (map.get(a.type) ?? 0) + 1)
    );
    return map;
  });

  // Alertes filtrées selon tous les critères
  readonly alertesFiltrees = computed(() => {
    let list = this.alertes();
    
    // Filtre par statut
    if (this.filtreStatut() === 'non_lues') list = list.filter(a => !a.lue);
    if (this.filtreStatut() === 'lues')     list = list.filter(a => a.lue);
    
    // Filtre par type
    if (this.filtreType())                   list = list.filter(a => a.type === this.filtreType());
    
    // Filtre par priorité
    if (this.filtrePriorite())                list = list.filter(a => a.priorite === this.filtrePriorite());

    // Recherche textuelle
    const q = this.recherche().toLowerCase().trim();
    if (q) {
      list = list.filter(a =>
        a.titre.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q)
      );
    }
    return list;
  });

  // Sync filtered alerts into pagination service (do not write signals inside computed)
  private readonly _syncPagination = effect(() => {
    const list = this.alertesFiltrees();
    this.pagination.setItems(list);
  });

  ngOnInit(): void {
    this.chargerAlertes();
    this._unsubscribe = this.alerteSvc.ecouterNonLues((nonLues) => {
      const nonLuesIds = new Set(nonLues.map(a => a.id));
      this.alertes.update(list =>
        list.map(a => ({
          ...a,
          lue: !nonLuesIds.has(a.id),
        }))
      );
    });
  }

  ngOnDestroy(): void {
    this._unsubscribe?.();
  }

  private async chargerAlertes(): Promise<void> {
    this.loading.set(true);
    try {
      const alertes = await this.alerteSvc.getAll(200);
      this.alertes.set(alertes);
    } catch (err) {
      console.error('[Alertes] Erreur chargement:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // Actions sur les alertes
  async marquerLue(alerte: Alerte): Promise<void> {
    if (!alerte.id || alerte.lue) return;
    await this.alerteSvc.marquerLue(alerte.id);
    this.alertes.update(list => list.map(a => a.id === alerte.id ? { ...a, lue: true } : a));
  }

  async marquerToutesLues(): Promise<void> {
    const ids = this.alertes().filter(a => !a.lue && a.id).map(a => a.id!);
    if (!ids.length) return;
    await this.alerteSvc.marquerToutesLues(ids);
    this.alertes.update(list => list.map(a => ({ ...a, lue: true })));
  }

  async supprimer(alerte: Alerte): Promise<void> {
    if (!alerte.id) return;
    await this.alerteSvc.supprimer(alerte.id);
    this.alertes.update(list => list.filter(a => a.id !== alerte.id));
  }

  async nettoyerLues(): Promise<void> {
    await this.alerteSvc.supprimerToutesLues();
    this.alertes.update(list => list.filter(a => !a.lue));
  }

  onClickAlerte(alerte: Alerte): void {
    if (!alerte.lue) this.marquerLue(alerte);
    if (!alerte.lienUrl) return;
    const lien = alerte.lienUrl as any;
    if (typeof lien === 'string') {
      if (lien.startsWith('http') || lien.startsWith('//')) {
        window.open(lien, '_blank');
      } else {
        this.router.navigateByUrl(lien);
      }
    } else if (Array.isArray(lien)) {
      this.router.navigate(lien);
    }
  }

  // Pagination helpers
  setPage(page: number): void { this.pagination.setPage(page); }
  setPageSize(size: number): void { this.pagination.setPageSize(size); }

  // Gestion des filtres
  setFilter(type: AlerteType | 'toutes'): void {
    this.filtreType.set(type === 'toutes' ? '' : type);
  }

  setStatut(statut: 'toutes' | 'non_lues' | 'lues'): void {
    this.filtreStatut.set(statut);
  }

  setPriorite(priorite: AlertePriorite | 'toutes'): void {
    this.filtrePriorite.set(priorite === 'toutes' ? '' : priorite);
  }

  reinitialiserFiltres(): void {
    this.recherche.set('');
    this.filtreType.set('');
    this.filtrePriorite.set('');
    this.filtreStatut.set('toutes');
  }

  // Helpers d'affichage (délégués au service)
  typeIcon(t: AlerteType): string          { return AlerteService.typeIcon(t); }
  typeLabel(t: AlerteType): string         { return AlerteService.typeLabel(t); }
  prioriteIcon(p: AlertePriorite): string  { return AlerteService.prioriteIcon(p); }
  prioriteLabel(p: AlertePriorite): string { return AlerteService.prioriteLabel(p); }
  prioriteColor(p: AlertePriorite): string { return AlerteService.prioriteColor(p); }
}