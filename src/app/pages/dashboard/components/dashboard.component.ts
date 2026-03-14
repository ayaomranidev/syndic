import {
  ChangeDetectionStrategy, Component, OnInit,
  computed, signal, inject
} from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, of } from 'rxjs';

import { PaiementService }           from '../../paiements/services/paiement.service';
import { DetteService }              from '../../dette/services/dette.service';
import { ChargeService }             from '../../charges/services/charge.service';
import { UserService }               from '../../coproprietaires/services/coproprietaire.service';
import { AppartementService }        from '../../appartements/services/appartement.service';
import { CalculMensuelService }      from '../../paiements/services/calcul-mensuel.service';
import { DetteGenerationService }    from '../../dette/services/generation-dettes.service';

interface KpiStats {
  totalCollected:  number;
  chargesMois:     number;
  collectionRate:  number;
  totalUnpaid:     number;
  overdueCount:    number;
  totalDettes:     number;
  nbAppartements:  number;
  nbCoproprietaires: number;
  roles: { label: string; count: number }[];
}

interface ChartBar { label: string; amount: number; pct: number; }

interface ActivityItem {
  title:     string;
  timestamp: string;
  icon?:     string;
  iconBg?:   string;
  amount?:   string;
  badge?:    string;
  badgeClass?: string;
}

interface AlerteItem {
  level:   'red' | 'orange' | 'amber';
  message: string;
  action?: string;
  route?:  string;
  fn?:     () => void;
}

interface TopImpayes {
  owner: string;
  apartment: string;
  montant: number;
  nbMois: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, AsyncPipe],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {

  // ── Injections ──────────────────────────────────────────────
  private readonly paiementSvc    = inject(PaiementService);
  private readonly detteSvc       = inject(DetteService);
  private readonly chargeSvc      = inject(ChargeService);
  private readonly userSvc        = inject(UserService);
  private readonly appartementSvc = inject(AppartementService);
  private readonly calculSvc      = inject(CalculMensuelService);
  private readonly generationSvc  = inject(DetteGenerationService);

  // ── Données courantes ────────────────────────────────────────
  readonly today = new Date().toLocaleDateString('fr-TN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  private readonly NOW     = new Date();
  private readonly MOIS    = this.NOW.getMonth() + 1;
  private readonly ANNEE   = this.NOW.getFullYear();

  // ── Signaux ──────────────────────────────────────────────────
  readonly loading          = signal(true);
  readonly stats            = signal<KpiStats>({
    totalCollected:    0,
    chargesMois:       0,
    collectionRate:    0,
    totalUnpaid:       0,
    overdueCount:      0,
    totalDettes:       0,
    nbAppartements:    0,
    nbCoproprietaires: 0,
    roles: [],
  });

  readonly chartData        = signal<ChartBar[]>([]);
  readonly recentActivities = signal<ActivityItem[]>([]);
  readonly alertes          = signal<AlerteItem[]>([]);
  readonly topImpayes       = signal<TopImpayes[]>([]);
  readonly chargesPieData   = signal<{ label: string; color: string; pct: number; amount: number }[]>([]);

  // user$ observable (compatible avec code existant du HTML)
  readonly user$: Observable<{ fullname?: string } | null> = of(null);

  // ── Lifecycle ────────────────────────────────────────────────
  async ngOnInit() {
    try {
      await Promise.all([
        this.loadKpis(),
        this.loadChart(),
        this.loadActivities(),
        this.loadAlertes(),
        this.loadChargesPie(),
      ]);
    } catch (err) {
      console.error('[Dashboard] Erreur chargement:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── KPIs ─────────────────────────────────────────────────────
  private async loadKpis() {
    const [paiements, dettes, charges, users, appartements] = await Promise.all([
      this.paiementSvc.loadFromFirestore(),
      this.detteSvc.getAll(),
      this.chargeSvc.list(),
      this.safeLoadUsers(),
      this.appartementSvc.loadAppartements(),
    ]);

    // --- Total collecté (tous les paiements payés) ---
    const totalCollected = paiements
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + (p.amount || 0), 0);

    // --- Charges du mois courant ---
    const chargesActives = charges.filter(c => {
      if ('actif' in c && !c.actif) return false;
      const debut = c.date_debut ? new Date(c.date_debut) : null;
      const fin   = c.date_fin   ? new Date(c.date_fin)   : null;
      const now   = new Date();
      if (debut && debut > now) return false;
      if (fin   && fin   < now) return false;
      return true;
    });

    // Montant mensuel brut de toutes les charges actives
    const chargesMois = chargesActives.reduce((s, c) => {
      const m = c.montant || 0;
      if ((c as any).type_charge === 'FIXE') return s + m;
      if ((c as any).type_charge === 'VARIABLE') return s + m;
      return s; // TRAVAUX : ponctuel, on n'additionne pas au mensuel
    }, 0);

    // --- Dettes ---
    const dettesImpayees = dettes.filter(d => d.statut === 'IMPAYEE' || d.statut === 'PARTIELLEMENT_PAYEE');
    const totalUnpaid = dettesImpayees.reduce((s, d) => {
      const montantPaye = d.montant_paye || 0;
      return s + Math.max((d.montant_original || 0) - montantPaye, 0);
    }, 0);

    // Appartements distincts en impayé
    const aptsEnRetard = new Set(dettesImpayees.map(d => d.appartementId).filter(Boolean));
    const overdueCount = aptsEnRetard.size;

    // --- Taux de recouvrement ---
    const totalDu = paiements.reduce((s, p) => s + (p.amount || 0), 0);
    const collectionRate = totalDu > 0 ? Math.round((totalCollected / totalDu) * 100) : 0;

    // --- Rôles utilisateurs ---
    const roleCounts = new Map<string, number>();
    users.forEach(u => {
      const roles: string[] = Array.isArray(u.roles) ? u.roles : u.role ? [u.role] : ['COPROPRIETAIRE'];
      roles.forEach((r: string) => roleCounts.set(r, (roleCounts.get(r) || 0) + 1));
    });
    const roleLabels: Record<string, string> = {
      ADMIN: 'Admin', PRESIDENT: 'Président', TRESORIER: 'Trésorier',
      COPROPRIETAIRE: 'Copropriétaires', LOCATAIRE: 'Locataires',
    };
    const rolesArr = Array.from(roleCounts.entries()).map(([r, count]) => ({
      label: roleLabels[r] || r, count
    }));

    // --- Top impayés ---
    const aptMap = new Map(appartements.map(a => [a.docId, a]));
    const userMap = new Map<string, any>();
    users.forEach(u => {
      if (u.firebaseUid) userMap.set(u.firebaseUid, u);
      if (u.id) userMap.set(String(u.id), u);
    });

    const impayesParApt = new Map<string, { montant: number; nbMois: number; owner: string; apt: string }>();
    dettesImpayees.forEach(d => {
      const aptId = d.appartementId || '';
      const apt = aptMap.get(aptId);
      const montantRestant = Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0);
      const entry = impayesParApt.get(aptId) || {
        montant: 0, nbMois: 0,
        owner: apt?.proprietaireId ? (userMap.get(apt.proprietaireId)?.name || `Appt ${apt?.numero}`) : `Appt ${apt?.numero || aptId}`,
        apt: apt?.numero || aptId,
      };
      entry.montant += montantRestant;
      entry.nbMois  += 1;
      impayesParApt.set(aptId, entry);
    });

    const top5 = Array.from(impayesParApt.values())
      .sort((a, b) => b.montant - a.montant)
      .slice(0, 5)
      .map(e => ({ owner: e.owner, apartment: e.apt, montant: e.montant, nbMois: e.nbMois }));

    this.topImpayes.set(top5);

    this.stats.set({
      totalCollected,
      chargesMois,
      collectionRate,
      totalUnpaid,
      overdueCount,
      totalDettes:       dettes.length,
      nbAppartements:    appartements.length,
      nbCoproprietaires: users.length,
      roles: rolesArr,
    });
  }

  // ── Graphique 12 mois ────────────────────────────────────────
  private async loadChart() {
    const paiements = await this.paiementSvc.loadFromFirestore();

    // Grouper par mois (12 derniers mois)
    const bars: ChartBar[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(this.ANNEE, this.MOIS - 1 - i, 1);
      const annee = d.getFullYear();
      const mois  = d.getMonth() + 1;
      const label = d.toLocaleDateString('fr-TN', { month: 'short' })
        .replace('.', '').slice(0, 3);

      const amount = paiements
        .filter(p => p.annee === annee && p.mois === mois && p.status === 'paid')
        .reduce((s, p) => s + (p.amount || 0), 0);

      bars.push({ label, amount, pct: 0 });
    }

    const max = Math.max(...bars.map(b => b.amount), 1);
    bars.forEach(b => b.pct = Math.round((b.amount / max) * 100));
    this.chartData.set(bars);
  }

  // ── Activités récentes ───────────────────────────────────────
  private async loadActivities() {
    const paiements = await this.paiementSvc.loadFromFirestore();

    const sorted = [...paiements]
      .filter(p => p.datePaiement || p.date)
      .sort((a, b) => {
        const da = new Date(a.datePaiement || a.date || '').getTime();
        const db = new Date(b.datePaiement || b.date || '').getTime();
        return db - da;
      })
      .slice(0, 8);

    const activities: ActivityItem[] = sorted.map(p => {
      const isLate    = p.status === 'overdue';
      const isPaid    = p.status === 'paid';
      const isPartial = p.status === 'partial';

      const iconBg = isPaid
        ? 'bg-green-100 text-green-600'
        : isLate
          ? 'bg-red-100 text-red-500'
          : isPartial
            ? 'bg-amber-100 text-amber-600'
            : 'bg-slate-100 text-slate-500';

      const icon = isPaid ? 'check_circle' : isLate ? 'warning' : isPartial ? 'pending' : 'schedule';

      const badge = isPaid ? 'Payé' : isLate ? 'Retard' : isPartial ? 'Partiel' : 'En attente';
      const badgeClass = isPaid
        ? 'bg-green-100 text-green-700'
        : isLate
          ? 'bg-red-100 text-red-700'
          : isPartial
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600';

      const dateStr = p.datePaiement || p.date || '';
      const when = dateStr ? new Date(dateStr).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short' }) : '—';

      return {
        title:     p.label || `Paiement — Appt ${p.appartementId || ''}`,
        timestamp: when,
        icon,
        iconBg,
        amount:    `${(p.amount || 0).toLocaleString('fr-TN')} DT`,
        badge,
        badgeClass,
      };
    });

    this.recentActivities.set(activities);
  }

  // ── Alertes dynamiques ───────────────────────────────────────
  private async loadAlertes() {
    const alertes: AlerteItem[] = [];

    const [dettes, charges] = await Promise.all([
      this.detteSvc.getAll(),
      this.chargeSvc.list(),
    ]);

    // Alerte : dettes urgentes (> 3 mois)
    const dettesCritiques = dettes.filter(d => {
      if (d.statut === 'PAYEE') return false;
      const moisRetard = this.calculMoisRetard(d.annee, d.mois);
      return moisRetard >= 3;
    });
    if (dettesCritiques.length > 0) {
      alertes.push({
        level:   'red',
        message: `${dettesCritiques.length} dettes avec +3 mois de retard`,
        action:  'Voir les dettes urgentes →',
        route:   '/dette',
      });
    }

    // Alerte : impayés du mois courant
    const dettesMonthCurrent = dettes.filter(d =>
      d.annee === this.ANNEE && d.mois === this.MOIS && d.statut !== 'PAYEE'
    );
    if (dettesMonthCurrent.length > 0) {
      alertes.push({
        level:   'orange',
        message: `${dettesMonthCurrent.length} impayés pour le mois en cours`,
        action:  'Voir les dettes →',
        route:   '/dette',
      });
    }

    // Alerte : charges arrivant à échéance
    const nextMonth = new Date(this.ANNEE, this.MOIS, 1);
    const chargesEcheance = charges.filter(c => {
      if (!c.date_fin) return false;
      const fin = new Date(c.date_fin);
      return fin >= new Date() && fin <= nextMonth;
    });
    if (chargesEcheance.length > 0) {
      alertes.push({
        level:   'orange',
        message: `${chargesEcheance.length} contrat(s) arrivent à échéance ce mois`,
        action:  'Voir les contrats →',
        route:   '/charges',
      });
    }

    // Alerte : générer dettes du prochain mois
    alertes.push({
      level:   'amber',
      message: `Appels de fonds à générer pour ${this.nextMonthLabel()}`,
      action:  'Générer →',
      fn:      () => this.genererAppelFonds(),
    });

    this.alertes.set(alertes);
  }

  // ── Camembert charges ────────────────────────────────────────
  private async loadChargesPie() {
    const charges = await this.chargeSvc.list();
    const actives = charges.filter(c => 'actif' in c ? c.actif : true);

    const groups: Record<string, number> = {
      'Maintenance': 0,
      'Énergie': 0,
      'Assurances': 0,
      'Travaux': 0,
      'Autres': 0,
    };

    actives.forEach(c => {
      const m = c.montant || 0;
      const lib = (c.libelle || '').toLowerCase();
      if (lib.includes('ascenseur') || lib.includes('gardien') || lib.includes('nettoyage') || (c as any).type_charge === 'FIXE')
        groups['Maintenance'] += m;
      else if (lib.includes('eau') || lib.includes('électricité') || lib.includes('gaz') || lib.includes('energie'))
        groups['Énergie'] += m;
      else if (lib.includes('assurance'))
        groups['Assurances'] += m;
      else if ((c as any).type_charge === 'TRAVAUX')
        groups['Travaux'] += m;
      else
        groups['Autres'] += m;
    });

    const total = Object.values(groups).reduce((s, v) => s + v, 1);
    const colors = ['#1e3a5f', '#3b82f6', '#8b5cf6', '#f59e0b', '#94a3b8'];
    const pie = Object.entries(groups).map(([label, amount], i) => ({
      label,
      amount,
      color: colors[i],
      pct: Math.round((amount / total) * 100),
    })).filter(p => p.amount > 0);

    this.chargesPieData.set(pie);
  }

  // ── Helpers ──────────────────────────────────────────────────
  private async safeLoadUsers(): Promise<any[]> {
    try {
      return await (this.userSvc.loadFromFirestore?.() ?? Promise.resolve(this.userSvc.getAll()));
    } catch {
      return this.userSvc.getAll();
    }
  }

  private calculMoisRetard(annee?: number, mois?: number): number {
    if (!annee || !mois) return 0;
    return (this.ANNEE - annee) * 12 + (this.MOIS - mois);
  }

  private nextMonthLabel(): string {
    const d = new Date(this.ANNEE, this.MOIS, 1);
    return d.toLocaleDateString('fr-TN', { month: 'long', year: 'numeric' });
  }

  async genererAppelFonds() {
    try {
      await this.generationSvc.genererDettesduMois(this.ANNEE, this.MOIS + 1 > 12 ? 1 : this.MOIS + 1);
      // Rafraîchir les alertes
      await this.loadAlertes();
    } catch (err) {
      console.error('[Dashboard] Erreur génération appels de fonds:', err);
    }
  }

  formatMontant(v: number): string {
    if (!v) return '0 DT';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M DT`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k DT`;
    return `${v.toLocaleString('fr-TN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DT`;
  }

  naviguerVers(route: string | undefined) {
    if (route) window.location.href = route;
  }

  executerAction(item: AlerteItem) {
    if (item.fn) item.fn();
    else if (item.route) window.location.href = item.route;
  }

  alerteColor(level: string): string {
    return level === 'red'    ? 'bg-red-500'    :
           level === 'orange' ? 'bg-orange-400' : 'bg-amber-400';
  }

  alerteTextColor(level: string): string {
    return level === 'red'    ? 'text-red-600'    :
           level === 'orange' ? 'text-orange-600' : 'text-amber-600';
  }

  // Pour le SVG (accessible dans le template)
  readonly Math = Math;

  roleColor(role: string): string {
    const colors: Record<string, string> = {
      'Admin': 'bg-red-500',
      'Président': 'bg-purple-500',
      'Trésorier': 'bg-yellow-500',
      'Copropriétaires': 'bg-blue-500',
      'Locataires': 'bg-green-500',
      'Appartements': 'bg-[#1e3a5f]',
      'En impayé': 'bg-red-500',
      'Utilisateurs': 'bg-indigo-500'
    };
    return colors[role] || 'bg-slate-500';
  }

  roleIcon(role: string): string {
    const icons: Record<string, string> = {
      'Admin': 'security',
      'Président': 'stars',
      'Trésorier': 'account_balance',
      'Copropriétaires': 'home',
      'Locataires': 'key',
      'Appartements': 'apartment',
      'En impayé': 'warning',
      'Utilisateurs': 'group'
    };
    return icons[role] || 'person';
  }

  getRolePercentage(count: number): number {
    const total = this.stats().nbCoproprietaires || 1;
    return Math.round((count / total) * 100);
  }
}