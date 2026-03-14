import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AlerteService, Alerte, AlerteType, AlertePriorite } from '../../../pages/notifications/services/alerte.service';
import { NotificationPanelService } from '../../../pages/notifications/services/notification-panel.service';
import { RelativeTimePipe } from '../../../pages/notifications/pipes/relative-time.pipe';

interface AlerteGroupe {
  label: string;
  items: Alerte[];
}

@Component({
  selector: 'app-notification-drawer',
  standalone: true,
  imports: [CommonModule, RelativeTimePipe],
  templateUrl: './notification-drawer.component.html',
  styleUrls: ['./notification-drawer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationDrawerComponent implements OnInit, OnDestroy {
  private readonly alerteSvc = inject(AlerteService);
  private readonly panelSvc  = inject(NotificationPanelService);
  private readonly router    = inject(Router);

  @ViewChild('listContainer') listContainer?: ElementRef<HTMLDivElement>;

  readonly isOpen       = this.panelSvc.isOpen;
  readonly loading      = signal(true);
  readonly loadingMore  = signal(false);
  readonly alertesToutes     = signal<Alerte[]>([]);
  readonly filtreStatut      = signal<'toutes' | 'non_lues'>('toutes');
  readonly filtreType        = signal<AlerteType | null>(null);

  readonly nbNonLues   = this.alerteSvc.nbNonLues;
  readonly hasCritique = this.alerteSvc.hasCritique;

  readonly nbLues = computed(() =>
    this.alertesToutes().filter(a => a.lue).length
  );

  readonly alertesAffichees = computed(() => {
    let list = this.alertesToutes();
    if (this.filtreStatut() === 'non_lues') list = list.filter(a => !a.lue);
    if (this.filtreType())                  list = list.filter(a => a.type === this.filtreType());
    return list;
  });

  readonly alertesGroupees = computed((): AlerteGroupe[] => {
    const items = this.alertesAffichees();
    const now   = new Date();
    const groupes: Map<string, Alerte[]> = new Map();

    for (const a of items) {
      const date  = a.createdAt instanceof Date ? a.createdAt : (a.createdAt?.toDate?.() ?? new Date());
      const diff  = Math.floor((now.getTime() - date.getTime()) / 86400000);
      const label = diff === 0 ? "Aujourd'hui"
                  : diff === 1 ? 'Hier'
                  : diff < 7   ? 'Cette semaine'
                  : diff < 30  ? 'Ce mois'
                  : date.toLocaleDateString('fr-TN', { month: 'long', year: 'numeric' });

      if (!groupes.has(label)) groupes.set(label, []);
      groupes.get(label)!.push(a);
    }

    return Array.from(groupes.entries()).map(([label, items]) => ({ label, items }));
  });

  readonly typesDisponibles = computed((): AlerteType[] => {
    const types = new Set(this.alertesToutes().map(a => a.type));
    return Array.from(types);
  });

  readonly hasMore = computed(() => this.alertesToutes().length >= 50 && this.alertesToutes().length < 200);

  private _pageSize = 50;
  private _unsubscribeRealtime: (() => void) | null = null;

  ngOnInit(): void {
    this.chargerAlertes();
    this._unsubscribeRealtime = this.alerteSvc.ecouterNonLues((nonLues) => {
      this.alertesToutes.update(current => {
        const lues     = current.filter(a => a.lue);
        const allItems = [...nonLues, ...lues];
        const seen = new Set<string>();
        return allItems.filter(a => {
          if (!a.id || seen.has(a.id)) return false;
          seen.add(a.id);
          return true;
        });
      });
    });
  }

  ngOnDestroy(): void {
    this._unsubscribeRealtime?.();
  }

  private async chargerAlertes(): Promise<void> {
    this.loading.set(true);
    try {
      const alertes = await this.alerteSvc.getAll(this._pageSize);
      this.alertesToutes.set(alertes);
    } catch (err) {
      console.error('[Drawer] Erreur chargement alertes:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async chargerPlus(): Promise<void> {
    this.loadingMore.set(true);
    try {
      this._pageSize += 50;
      const alertes = await this.alerteSvc.getAll(this._pageSize);
      this.alertesToutes.set(alertes);
    } finally {
      this.loadingMore.set(false);
    }
  }

  close(): void { this.panelSvc.close(); }

  async marquerLue(alerte: Alerte): Promise<void> {
    if (!alerte.id) return;
    await this.alerteSvc.marquerLue(alerte.id);
    this.alertesToutes.update(list =>
      list.map(a => a.id === alerte.id ? { ...a, lue: true } : a)
    );
  }

  async marquerToutesLues(): Promise<void> {
    const ids = this.alertesToutes().filter(a => !a.lue && a.id).map(a => a.id!);
    if (ids.length === 0) return;
    await this.alerteSvc.marquerToutesLues(ids);
    this.alertesToutes.update(list => list.map(a => ({ ...a, lue: true })));
  }

  async supprimer(alerte: Alerte): Promise<void> {
    if (!alerte.id) return;
    await this.alerteSvc.supprimer(alerte.id);
    this.alertesToutes.update(list => list.filter(a => a.id !== alerte.id));
  }

  async nettoyerLues(): Promise<void> {
    await this.alerteSvc.supprimerToutesLues();
    this.alertesToutes.update(list => list.filter(a => !a.lue));
  }

  onClickAlerte(alerte: Alerte): void {
    if (!alerte.lue) this.marquerLue(alerte);
    if (alerte.lienUrl) {
      this.router.navigateByUrl(alerte.lienUrl);
      this.close();
    }
  }

  onLink(alerte: Alerte): void {
    if (!alerte.lue) this.marquerLue(alerte);
    this.close();
  }

  voirToutes(): void {
    this.router.navigateByUrl('/notification');
    this.close();
  }
  voirHistorique(): void {
    this.router.navigateByUrl('/notification');
    this.close();
  }
  typeIcon(t: AlerteType): string    { return AlerteService.typeIcon(t); }
  typeLabel(t: AlerteType): string   { return AlerteService.typeLabel(t); }
  prioriteLabel(p: AlertePriorite): string { return AlerteService.prioriteLabel(p); }
}