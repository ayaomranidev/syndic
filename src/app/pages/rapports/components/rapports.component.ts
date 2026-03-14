/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  rapports.component.ts — SyndicPro                                      ║
 * ║  12 types de rapports · Filtrage user/bâtiment/appartement/résidence    ║
 * ║  Génération PDF + Excel · Aperçu temps réel · Jobs avec progression     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';

import { Auth }               from '../../../core/services/auth';
import { PaiementService }    from '../../paiements/services/paiement.service';
import { DetteService }       from '../../dette/services/dette.service';
import { ChargeService }      from '../../charges/services/charge.service';
import { UserService }        from '../../coproprietaires/services/coproprietaire.service';
import { AppartementService } from '../../appartements/services/appartement.service';
import { PaiementAffectationService } from '../../paiements/services/paiement-affectation.service';

import {
  RapportCloudinaryService,
  LigneRapportPaiement,
  LigneRapportDette,
  ParamsRapport,
} from '../services/rapport-cloudinary.service';

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES PUBLICS
// ─────────────────────────────────────────────────────────────────────────────

export type TypeRapport =
  | 'paiements'
  | 'impayes'
  | 'recouvrement'
  | 'charges'
  | 'historique_charges'
  | 'fiche_user'
  | 'liste_users'
  | 'liste_appartements'
  | 'liste_batiments'
  | 'bilan_mensuel'
  | 'top_retardataires'
  | 'tableau_bord'
  | 'echeancier'
  | 'rapport_fifo'
  | 'fiche_batiment'
  | 'taux_occupation'
  | 'detail_charges_apt';

export type ScopeRapport     = 'tous' | 'residence' | 'batiment' | 'appartement' | 'user';
export type FormatExport     = 'pdf' | 'excel';
export type CategorieRapport = 'Financier' | 'Charges' | 'Annuaire' | 'Synthèse';

export interface RapportDef {
  id:          TypeRapport;
  icone:       string;
  titre:       string;
  description: string;
  categorie:   CategorieRapport;
  formats:     FormatExport[];
  /** null = tous les scopes supportés */
  scopes:      ScopeRapport[] | null;
  colonnes:    string[];
  accent:      string; // classe Tailwind bg-
}

export interface KpiRapport {
  totalDu:          number;
  totalPaye:        number;
  totalRestant:     number;
  tauxRecouvrement: number;
  nbDettesImpayees: number;
  nbPaiements:      number;
  nbAppartements:   number;
  nbUsers:          number;
  nbCharges:        number;
}

export interface ExportJob {
  id:          number;
  rapport:     string;
  format:      string;
  statut:      'en_cours' | 'pret' | 'erreur';
  progression: number;
  url?:        string;
  erreurMsg?:  string;
}

// Interfaces des options de sélection
interface AptOption {
  docId: string; numero: string; etage: number; surface: number;
  type?: string; statut?: string; batimentDocId?: string;
  batimentName?: string; residenceId?: string;
  proprietaireId?: string; locataireId?: string;
}
interface BatOption  { docId: string; nom: string; residenceId?: string; }
interface UserOption { id: string; name: string; email?: string; phone?: string; role?: string; appartementId?: string | null; }

// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSANT
// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-rapports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rapports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RapportsComponent implements OnInit {

  // ── Services ────────────────────────────────────────────────────────────────
  private readonly auth           = inject(Auth);
  private readonly paiementSvc    = inject(PaiementService);
  private readonly detteSvc       = inject(DetteService);
  private readonly chargeSvc      = inject(ChargeService);
  private readonly userSvc        = inject(UserService);
  private readonly appartementSvc = inject(AppartementService);
  private readonly rapportSvc     = inject(RapportCloudinaryService);
  private readonly affectationSvc = inject(PaiementAffectationService);

  private readonly NOW   = new Date();
  private readonly ANNEE = this.NOW.getFullYear();

  // ── État réactif ─────────────────────────────────────────────────────────
  readonly loading       = signal(true);
  readonly catFilter     = signal<string>('');
  readonly selectedType  = signal<TypeRapport>('paiements');
  readonly selectedAnnee = signal<number>(this.ANNEE);
  readonly selectedMois  = signal<number | null>(null);
  readonly formatExport  = signal<FormatExport>('pdf');
  readonly scope         = signal<ScopeRapport>('tous');
  readonly selectedUser  = signal<string>('');
  readonly selectedApt   = signal<string>('');
  readonly selectedBat   = signal<string>('');
  readonly selectedRes   = signal<string>('');
  readonly jobs          = signal<ExportJob[]>([]);
  readonly toast         = signal<{ msg: string; ok: boolean } | null>(null);
  readonly selectedColonnes = signal<Set<number>>(new Set());

  readonly kpis = signal<KpiRapport>({
    totalDu: 0, totalPaye: 0, totalRestant: 0,
    tauxRecouvrement: 0, nbDettesImpayees: 0, nbPaiements: 0,
    nbAppartements: 0, nbUsers: 0, nbCharges: 0,
  });

  // Options selects
  readonly aptOptions  = signal<AptOption[]>([]);
  readonly batOptions  = signal<BatOption[]>([]);
  readonly userOptions = signal<UserOption[]>([]);
  readonly resOptions  = signal<string[]>([]);

  // Cache données brutes
  private rawPaiements:    any[] = [];
  private rawDettes:       any[] = [];
  private rawCharges:      any[] = [];
  private rawAppartements: any[] = [];
  private rawUsers:        any[] = [];

  // ── Constantes UI ────────────────────────────────────────────────────────
  readonly annees = [this.ANNEE - 2, this.ANNEE - 1, this.ANNEE];

  readonly moisList = [
    { val: null, label: 'Toute l\'année' },
    { val:  1, label: 'Janvier' },    { val:  2, label: 'Février' },
    { val:  3, label: 'Mars' },       { val:  4, label: 'Avril' },
    { val:  5, label: 'Mai' },        { val:  6, label: 'Juin' },
    { val:  7, label: 'Juillet' },    { val:  8, label: 'Août' },
    { val:  9, label: 'Septembre' },  { val: 10, label: 'Octobre' },
    { val: 11, label: 'Novembre' },   { val: 12, label: 'Décembre' },
  ];

  readonly SCOPES_ALL: ScopeRapport[] = ['tous', 'residence', 'batiment', 'appartement', 'user'];

  // ── Catalogue des 17 rapports ─────────────────────────────────────────────
  readonly rapports: RapportDef[] = [

    // ═══ FINANCIER ══════════════════════════════════════════════════════════
    {
      id: 'paiements', icone: '💳', titre: 'Rapport des Paiements',
      description: 'Historique complet des paiements : montant dû, payé, mode, statut, référence. Filtrable par copropriétaire, appartement, bâtiment ou résidence entière.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Appartement', 'Propriétaire', 'Mois', 'Montant dû', 'Montant payé', 'Statut', 'Date règlement', 'Mode paiement', 'Référence'],
      accent: 'bg-emerald-500',
    },
    {
      id: 'impayes', icone: '🚨', titre: 'Rapport des Impayés',
      description: 'Analyse détaillée des dettes : montant original, payé, restant, nombre de mois de retard. Classé du plus ancien au plus récent.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Appartement', 'Propriétaire', 'Période', 'Montant original', 'Payé', 'Restant', 'Statut', 'Mois de retard'],
      accent: 'bg-red-500',
    },
    {
      id: 'recouvrement', icone: '📈', titre: 'Rapport de Recouvrement',
      description: 'Synthèse complète : taux de recouvrement, balance encaissé vs dû. Génère automatiquement 2 rapports (paiements + impayés) en un seul clic.',
      categorie: 'Financier', formats: ['pdf'], scopes: null,
      colonnes: ['Taux recouvrement', 'Total encaissé', 'Total impayé', 'Paiements', 'Dettes impayées'],
      accent: 'bg-indigo-500',
    },
    {
      id: 'bilan_mensuel', icone: '📊', titre: 'Bilan Mensuel (12 mois)',
      description: 'Évolution mensuelle sur 12 mois glissants : recettes vs charges, solde de trésorerie, tendance mois par mois.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Mois', 'Année', 'Recettes encaissées', 'Charges courantes', 'Statut balance', 'Solde mensuel', 'Impayés restants'],
      accent: 'bg-violet-500',
    },
    {
      id: 'top_retardataires', icone: '🏆', titre: 'Classement des Retardataires',
      description: 'Top 20 copropriétaires avec le plus de retard. Montant cumulé impayé, nombre de mois de retard, appartement. Trié par montant décroissant.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Rang', 'Copropriétaire', 'Appartement', 'Montant impayé cumulé', 'Mois de retard max', 'Sévérité'],
      accent: 'bg-orange-500',
    },
    {
      id: 'rapport_fifo', icone: '🔄', titre: 'Rapport FIFO — Affectations',
      description: 'Détail des affectations paiement → dette en FIFO : quel paiement a couvert quelle dette, montant alloué, ordre de priorité, date.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Paiement Réf', 'Appartement', 'Propriétaire', 'Dette Période', 'Montant alloué', 'Priorité', 'Date affectation'],
      accent: 'bg-blue-600',
    },
    {
      id: 'echeancier', icone: '📅', titre: 'Échéancier des Charges',
      description: 'Calendrier des prochaines échéances de charges : quelle charge, quel montant, quelle fréquence, quand. Triable par date.',
      categorie: 'Financier', formats: ['pdf', 'excel'], scopes: ['tous', 'residence', 'batiment', 'appartement'],
      colonnes: ['Charge', 'Type', 'Montant', 'Fréquence', 'Prochaine échéance', 'Périmètre', 'Statut'],
      accent: 'bg-fuchsia-500',
    },

    // ═══ CHARGES ════════════════════════════════════════════════════════════
    {
      id: 'charges', icone: '🧾', titre: 'Rapport des Charges',
      description: 'Toutes les charges actives : fixes (contrats), travaux et variables. Libellé, type, montant, fréquence, statut et périmètre d\'application.',
      categorie: 'Charges', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Libellé', 'Type', 'Catégorie', 'Montant', 'Fréquence', 'Statut', 'Périmètre', 'Date début'],
      accent: 'bg-amber-500',
    },
    {
      id: 'historique_charges', icone: '📋', titre: 'Charges par Appartement',
      description: 'Pour chaque appartement : liste des charges applicables, montant mensuel, propriétaire et solde impayé. Vue croisée appartement × charges.',
      categorie: 'Charges', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Appartement', 'Bâtiment / Étage', 'Propriétaire', 'Charges/mois', 'Type', 'Statut', 'Solde impayé', 'Surface'],
      accent: 'bg-teal-500',
    },
    {
      id: 'detail_charges_apt', icone: '🧮', titre: 'Détail Charges par Appartement',
      description: 'Pour chaque appartement, détail de chaque charge : libellé, type, montant réparti, mode de répartition. Vue croisée charge × appartement.',
      categorie: 'Charges', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Appartement', 'Propriétaire', 'Charge', 'Type', 'Montant total', 'Montant appt', 'Mode répartition', 'Fréquence'],
      accent: 'bg-yellow-600',
    },

    // ═══ ANNUAIRE ════════════════════════════════════════════════════════════
    {
      id: 'liste_users', icone: '👥', titre: 'Annuaire des Copropriétaires',
      description: 'Annuaire complet : nom, email, téléphone, rôle, appartement(s) associé(s), solde impayé actuel et statut du compte. Filtrable par bâtiment.',
      categorie: 'Annuaire', formats: ['pdf', 'excel'], scopes: null,
      colonnes: ['Nom', 'Email', 'Téléphone', 'Rôle', 'Appartement(s)', 'Solde impayé', 'Statut compte'],
      accent: 'bg-sky-500',
    },
    {
      id: 'liste_appartements', icone: '🏠', titre: 'Inventaire des Appartements',
      description: 'Fiche détaillée par appartement : numéro, bâtiment, étage, surface, type, statut d\'occupation, propriétaire, total charges et solde impayé.',
      categorie: 'Annuaire', formats: ['pdf', 'excel'], scopes: ['tous', 'residence', 'batiment'],
      colonnes: ['Numéro', 'Bâtiment / Étage', 'Surface', 'Type', 'Statut occupation', 'Propriétaire', 'Charges/mois', 'Solde impayé'],
      accent: 'bg-lime-600',
    },
    {
      id: 'liste_batiments', icone: '🏢', titre: 'Synthèse par Bâtiment',
      description: 'Vue consolidée par bâtiment : nombre d\'appartements, taux d\'occupation, total charges, total impayés et taux de recouvrement propre à chaque bâtiment.',
      categorie: 'Annuaire', formats: ['pdf', 'excel'], scopes: ['tous', 'residence'],
      colonnes: ['Bâtiment', 'Nb appartements', 'Taux occupation', 'Charges/mois', 'Total impayé', 'Taux recouvrement'],
      accent: 'bg-cyan-500',
    },
    {
      id: 'taux_occupation', icone: '📉', titre: 'Rapport Taux d\'Occupation',
      description: 'Appartements occupés vs vacants, par bâtiment : taux d\'occupation, nombre de vacants, surface vacante vs totale.',
      categorie: 'Annuaire', formats: ['pdf', 'excel'], scopes: ['tous', 'residence', 'batiment'],
      colonnes: ['Bâtiment', 'Total appts', 'Occupés', 'Vacants', 'Taux occupation', 'Surface totale', 'Surface vacante'],
      accent: 'bg-gray-500',
    },

    // ═══ SYNTHÈSE ════════════════════════════════════════════════════════════
    {
      id: 'fiche_user', icone: '🪪', titre: 'Fiche Copropriétaire',
      description: 'Rapport individuel complet : coordonnées, appartement(s), historique de tous les paiements, dettes impayées et solde actuel. Sélectionnez un copropriétaire.',
      categorie: 'Synthèse', formats: ['pdf'], scopes: ['user'],
      colonnes: ['Informations personnelles', 'Appartement(s)', 'Historique paiements', 'Impayés & dettes', 'Solde total'],
      accent: 'bg-pink-500',
    },
    {
      id: 'fiche_batiment', icone: '🏗️', titre: 'Fiche Bâtiment',
      description: 'Rapport complet d\'un bâtiment : liste des appartements, charges affectées, taux d\'occupation, copropriétaires, impayés cumulés.',
      categorie: 'Synthèse', formats: ['pdf'], scopes: ['batiment'],
      colonnes: ['Appartement', 'Propriétaire', 'Étage / Surface', 'Impayés (DT)', 'Charges/mois (DT)', 'Statut', 'Type', 'Nb charges'],
      accent: 'bg-stone-500',
    },
    {
      id: 'tableau_bord', icone: '🗺️', titre: 'Tableau de Bord Complet',
      description: 'Rapport multi-sections : paiements + impayés + inventaire appartements + annuaire copropriétaires. Génère 4 documents PDF en un seul clic.',
      categorie: 'Synthèse', formats: ['pdf'], scopes: null,
      colonnes: ['KPIs financiers', 'Paiements détaillés', 'Impayés & retards', 'Inventaire appartements', 'Annuaire copropriétaires'],
      accent: 'bg-rose-500',
    },
  ];

  // ── Computed ──────────────────────────────────────────────────────────────

  readonly categories = computed<string[]>(() =>
    Array.from(new Set(this.rapports.map(r => r.categorie)))
  );

  readonly filteredRapports = computed(() => {
    const f = this.catFilter();
    return f ? this.rapports.filter(r => r.categorie === f) : this.rapports;
  });

  readonly selectedRapport = computed(() =>
    this.rapports.find(r => r.id === this.selectedType()) ?? null
  );

  readonly availableScopes = computed<ScopeRapport[]>(() => {
    const r = this.selectedRapport();
    return (!r || !r.scopes) ? this.SCOPES_ALL : r.scopes;
  });

  readonly scopeLabel = computed<string>(() => {
    const sc = this.scope();
    if (sc === 'user') {
      const u = this.userOptions().find(u => u.id === this.selectedUser());
      return u ? u.name : 'Copropriétaire';
    }
    if (sc === 'appartement') {
      const a = this.aptOptions().find(a => a.docId === this.selectedApt());
      return a ? `Appt ${a.numero}` : 'Appartement';
    }
    if (sc === 'batiment') {
      const b = this.batOptions().find(b => b.docId === this.selectedBat());
      return b ? b.nom : 'Bâtiment';
    }
    if (sc === 'residence') return this.selectedRes() || 'Résidence';
    return 'Toute la résidence';
  });

  readonly periodLabel = computed<string>(() => {
    const m = this.selectedMois();
    if (!m) return `Année ${this.selectedAnnee()}`;
    return `${this.moisList.find(ml => ml.val === m)?.label} ${this.selectedAnnee()}`;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async ngOnInit() {
    try {
      const [paiements, dettes, charges, appartements] = await Promise.all([
        this.paiementSvc.loadFromFirestore(),
        this.detteSvc.getAll(),
        this.chargeSvc.list(),
        this.appartementSvc.loadAppartements(),
      ]);

      this.rawPaiements    = paiements;
      this.rawDettes       = dettes;
      this.rawCharges      = charges;
      this.rawAppartements = appartements;

      try {
        this.rawUsers = await (this.userSvc.loadFromFirestore?.() ?? Promise.resolve(this.userSvc.getAll()));
      } catch {
        this.rawUsers = this.userSvc.getAll();
      }

      // Options de filtrage
      this.aptOptions.set(
        (appartements as any[]).map(a => ({
          docId: a.docId, numero: a.numero,
          etage: a.etage ?? 0, surface: a.surface ?? 0,
          type: a.type || '—', statut: a.statut || 'vacant',
          batimentDocId: a.batimentDocId, batimentName: a.batimentName,
          residenceId: a.residenceId || a.residenceDocId,
          proprietaireId: a.proprietaireId, locataireId: a.locataireId,
        }))
      );

      const batsMap = new Map<string, BatOption>();
      (appartements as any[]).forEach(a => {
        if (a.batimentDocId && !batsMap.has(a.batimentDocId)) {
          batsMap.set(a.batimentDocId, {
            docId: a.batimentDocId,
            nom: a.batimentName || a.batimentDocId,
            residenceId: a.residenceId || a.residenceDocId,
          });
        }
      });
      this.batOptions.set(Array.from(batsMap.values()));

      const resSet = new Set<string>(
        (appartements as any[]).map(a => a.residenceId || a.residenceDocId).filter(Boolean)
      );
      this.resOptions.set(Array.from(resSet));

      this.userOptions.set(
        this.rawUsers.map((u: any) => ({
          id:           u.firebaseUid || String(u.id),
          name:         u.name || u.fullname || u.email || '—',
          email:        u.email || '',
          phone:        u.phone || '',
          role:         u.role || u.roles?.[0] || '—',
          appartementId: u.appartementId ?? null,
        }))
      );

      // Init column selection for default type
      const defRap = this.rapports.find(r => r.id === this.selectedType());
      if (defRap) this.selectedColonnes.set(new Set(defRap.colonnes.map((_, i) => i)));

      this.recalculerKpis();
    } catch (err) {
      console.error('[Rapports] Erreur ngOnInit:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Sélection ────────────────────────────────────────────────────────────

  selectType(t: TypeRapport) {
    this.selectedType.set(t);
    if (t === 'fiche_user') {
      this.scope.set('user');
    } else if (t === 'fiche_batiment') {
      this.scope.set('batiment');
    } else {
      const r = this.rapports.find(r => r.id === t);
      if (r?.scopes && !r.scopes.includes(this.scope())) {
        this.scope.set(r.scopes[0]);
      }
    }
    // Init all columns selected for this report
    const rd = this.rapports.find(r => r.id === t);
    if (rd) this.selectedColonnes.set(new Set(rd.colonnes.map((_, i) => i)));
    this.recalculerKpis();
  }

  onScopeChange(sc: ScopeRapport) {
    this.scope.set(sc);
    // Reset des valeurs enfants
    this.selectedUser.set('');
    this.selectedApt.set('');
    this.selectedBat.set('');
    this.selectedRes.set('');
    this.recalculerKpis();
  }

  onFiltreChange() { this.recalculerKpis(); }

  toggleColonne(idx: number) {
    this.selectedColonnes.update(s => {
      const next = new Set(s);
      if (next.has(idx)) {
        if (next.size > 1) next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  toggleAllColonnes() {
    const r = this.selectedRapport();
    if (!r) return;
    if (this.selectedColonnes().size === r.colonnes.length) {
      this.selectedColonnes.set(new Set([0]));
    } else {
      this.selectedColonnes.set(new Set(r.colonnes.map((_, i) => i)));
    }
  }

  private filterByColumns(headers: string[], rows: string[][]): { headers: string[]; rows: string[][] } {
    const sel = this.selectedColonnes();
    if (sel.size === 0 || sel.size >= headers.length) return { headers, rows };
    const indices = Array.from(sel).sort((a, b) => a - b);
    return {
      headers: indices.map(i => headers[i]),
      rows: rows.map(row => indices.map(i => row[i] ?? '—')),
    };
  }

  // ── Calcul IDs appartements filtrés ──────────────────────────────────────

  private aptIdsFiltres(): Set<string> | null {
    const sc   = this.scope();
    const apts = this.rawAppartements as any[];

    if (sc === 'tous') return null;

    if (sc === 'appartement') {
      const id = this.selectedApt();
      return id ? new Set([id]) : null;
    }
    if (sc === 'batiment') {
      const bid = this.selectedBat();
      if (!bid) return null;
      return new Set(apts.filter(a => a.batimentDocId === bid).map(a => a.docId));
    }
    if (sc === 'residence') {
      const rid = this.selectedRes();
      if (!rid) return null;
      return new Set(apts.filter(a => (a.residenceId || a.residenceDocId) === rid).map(a => a.docId));
    }
    if (sc === 'user') {
      const uid = this.selectedUser();
      if (!uid) return null;
      return new Set(apts.filter(a => a.proprietaireId === uid || a.locataireId === uid).map(a => a.docId));
    }
    return null;
  }

  // ── Recalcul KPIs ────────────────────────────────────────────────────────

  private recalculerKpis() {
    const annee  = this.selectedAnnee();
    const mois   = this.selectedMois();
    const aptIds = this.aptIdsFiltres();

    const pF = (this.rawPaiements as any[]).filter(p =>
      p.annee === annee &&
      (mois === null || p.mois === mois) &&
      (!aptIds || aptIds.has(p.appartementId))
    );

    const dF = (this.rawDettes as any[]).filter(d =>
      d.annee === annee &&
      (mois === null || d.mois === mois) &&
      (!aptIds || aptIds.has(d.appartementId))
    );

    const aF = aptIds
      ? (this.rawAppartements as any[]).filter(a => aptIds.has(a.docId))
      : this.rawAppartements;

    const uF = aptIds
      ? this.rawUsers.filter((u: any) => {
          const uid = u.firebaseUid || String(u.id);
          return (this.rawAppartements as any[]).some(a =>
            aptIds.has(a.docId) && (a.proprietaireId === uid || a.locataireId === uid)
          );
        })
      : this.rawUsers;

    const totalPaye    = pF.filter(p => p.status === 'paid').reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const totalDu      = dF.reduce((s: number, d: any) => s + (d.montant_original || d.montantDu || 0), 0);
    const totalRestant = dF.filter(d => d.statut !== 'PAYEE')
      .reduce((s: number, d: any) => s + Math.max((d.montant_original || d.montantDu || 0) - (d.montant_paye || 0), 0), 0);

    this.kpis.set({
      totalDu,
      totalPaye,
      totalRestant,
      tauxRecouvrement: totalDu > 0 ? Math.round((totalPaye / totalDu) * 100) : 0,
      nbDettesImpayees: dF.filter(d => d.statut !== 'PAYEE').length,
      nbPaiements:      pF.length,
      nbAppartements:   aF.length,
      nbUsers:          uF.length,
      nbCharges:        this.rawCharges.length,
    });
  }

  // ── Maps de résolution ───────────────────────────────────────────────────

  private buildUserMap(): Map<string, any> {
    const m = new Map<string, any>();
    this.rawUsers.forEach((u: any) => {
      if (u.firebaseUid) m.set(u.firebaseUid, u);
      if (u.id) m.set(String(u.id), u);
    });
    return m;
  }

  private buildAptMap(): Map<string, any> {
    const m = new Map<string, any>();
    (this.rawAppartements as any[]).forEach(a => { if (a.docId) m.set(a.docId, a); });
    return m;
  }

  private moisLabel(m: number | null): string {
    return this.moisList.find(ml => ml.val === m)?.label ?? '—';
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  BUILDERS DE LIGNES
  // ─────────────────────────────────────────────────────────────────────────

  private buildLignesPaiements(aptIds: Set<string> | null, annee: number, mois: number | null): LigneRapportPaiement[] {
    const uMap = this.buildUserMap();
    const aMap = this.buildAptMap();

    return (this.rawPaiements as any[])
      .filter(p =>
        p.annee === annee &&
        (mois === null || p.mois === mois) &&
        (!aptIds || aptIds.has(p.appartementId))
      )
      .sort((a, b) => (b.annee * 100 + b.mois) - (a.annee * 100 + a.mois))
      .map(p => {
        const apt   = aMap.get(p.appartementId);
        const owner = apt?.proprietaireId
          ? (uMap.get(apt.proprietaireId)?.name || '—')
          : (p.payer || '—');
        const paid  = p.status === 'paid'    ? (p.amount || 0)
                    : p.status === 'partial' ? (p.montantPaye || Math.round((p.amount || 0) / 2))
                    : 0;
        return {
          appartement:   apt?.numero || p.appartementId || '—',
          proprietaire:  owner,
          mois:          `${this.moisLabel(p.mois)} ${p.annee || annee}`,
          montantDu:     p.amount || 0,
          montantPaye:   paid,
          statut:        p.status === 'paid'    ? 'Payé' as const
                       : p.status === 'partial' ? 'Partiel' as const
                       : p.status === 'overdue' ? 'Retard' as const
                       : 'Impayé' as const,
          dateReglement: p.datePaiement || p.date || '',
          modePaiement:  p.modePaiement || p.paymentMethod || '',
          reference:     p.reference || '',
        } satisfies LigneRapportPaiement;
      });
  }

  private buildLignesDettes(aptIds: Set<string> | null, annee: number, mois: number | null): LigneRapportDette[] {
    const uMap = this.buildUserMap();
    const aMap = this.buildAptMap();
    const now  = new Date();

    return (this.rawDettes as any[])
      .filter(d =>
        d.annee === annee &&
        (mois === null || d.mois === mois) &&
        (!aptIds || aptIds.has(d.appartementId))
      )
      .map(d => {
        const apt   = aMap.get(d.appartementId);
        const owner = apt?.proprietaireId ? (uMap.get(apt.proprietaireId)?.name || '—') : '—';
        const ori   = d.montant_original || d.montantDu || 0;
        const pay   = d.montant_paye || 0;
        const ret   = Math.max(
          (now.getFullYear() - (d.annee || annee)) * 12 + (now.getMonth() + 1 - (d.mois || 1)), 0
        );
        return {
          appartement:     apt?.numero || d.appartementId || '—',
          proprietaire:    owner,
          periode:         `${this.moisLabel(d.mois)} ${d.annee || annee}`,
          montantOriginal: ori,
          montantPaye:     pay,
          montantRestant:  Math.max(ori - pay, 0),
          statut:          d.statut || 'IMPAYEE',
          nbMoisRetard:    ret,
        } satisfies LigneRapportDette;
      })
      .sort((a, b) => b.nbMoisRetard - a.nbMoisRetard);
  }

  /** Lignes annuaire copropriétaires, adaptées au format LigneRapportPaiement */
  private buildLignesUsers(aptIds: Set<string> | null): LigneRapportPaiement[] {
    return this.rawUsers
      .map((u: any) => {
        const uid   = u.firebaseUid || String(u.id);
        const apts  = (this.rawAppartements as any[]).filter(a =>
          (a.proprietaireId === uid || a.locataireId === uid) &&
          (!aptIds || aptIds.has(a.docId))
        );
        if (aptIds && apts.length === 0) return null;
        const solde = (this.rawDettes as any[])
          .filter(d => apts.some((a: any) => a.docId === d.appartementId) && d.statut !== 'PAYEE')
          .reduce((s: number, d: any) => s + Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0), 0);
        return {
          appartement:   apts.map((a: any) => `Appt ${a.numero}`).join(', ') || '—',
          proprietaire:  u.name || u.fullname || u.email || '—',
          mois:          u.email || '—',
          montantDu:     solde,
          montantPaye:   0,
          statut:        solde > 0 ? 'Impayé' as const : 'Payé' as const,
          dateReglement: u.phone || '',
          modePaiement:  u.role || u.roles?.[0] || '—',
          reference:     u.status || 'active',
        } satisfies LigneRapportPaiement;
      })
      .filter(Boolean) as LigneRapportPaiement[];
  }

  /** Lignes inventaire appartements, adaptées au format LigneRapportPaiement */
  private buildLignesAppartements(aptIds: Set<string> | null): LigneRapportPaiement[] {
    const uMap = this.buildUserMap();

    return (this.rawAppartements as any[])
      .filter(a => !aptIds || aptIds.has(a.docId))
      .map(a => {
        const owner       = a.proprietaireId ? (uMap.get(a.proprietaireId)?.name || '—') : '—';
        const solde       = (this.rawDettes as any[])
          .filter(d => d.appartementId === a.docId && d.statut !== 'PAYEE')
          .reduce((s: number, d: any) => s + Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0), 0);
        const chargesApt  = (this.rawCharges as any[]).filter(c => {
          if (c.scope === 'all') return true;
          if (c.scope === 'building') return c.buildingIds?.includes(a.batimentDocId);
          if (c.scope === 'apartment') return c.apartmentIds?.includes(a.docId);
          return false;
        });
        const totalC = chargesApt.reduce((s: number, c: any) => s + (c.montant || 0), 0);
        return {
          appartement:   a.numero,
          proprietaire:  owner,
          mois:          `${a.batimentName || '—'} — Ét.${a.etage ?? '—'}`,
          montantDu:     solde,
          montantPaye:   totalC,
          statut:        solde > 0 ? 'Impayé' as const : 'Payé' as const,
          dateReglement: `${a.surface || '—'} m²`,
          modePaiement:  a.type || '—',
          reference:     a.statut || '—',
        } satisfies LigneRapportPaiement;
      });
  }

  /** Synthèse bâtiments */
  private buildLignesBatiments(aptIds: Set<string> | null): LigneRapportPaiement[] {
    return this.batOptions().map(bat => {
      const aptsB    = (this.rawAppartements as any[]).filter(a =>
        a.batimentDocId === bat.docId && (!aptIds || aptIds.has(a.docId))
      );
      const aptIdsB  = new Set(aptsB.map((a: any) => a.docId));
      const dettesB  = (this.rawDettes as any[]).filter(d => aptIdsB.has(d.appartementId));
      const totalDu  = dettesB.reduce((s: number, d: any) => s + (d.montant_original || 0), 0);
      const totalPay = dettesB.reduce((s: number, d: any) => s + (d.montant_paye || 0), 0);
      const impayes  = dettesB.filter(d => d.statut !== 'PAYEE')
        .reduce((s: number, d: any) => s + Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0), 0);
      const taux     = totalDu > 0 ? Math.round((totalPay / totalDu) * 100) : 0;
      const chargesB = (this.rawCharges as any[]).filter(c => c.buildingIds?.includes(bat.docId) || c.scope === 'all');
      const totalC   = chargesB.reduce((s: number, c: any) => s + (c.montant || 0), 0);
      const occupes  = aptsB.filter((a: any) => a.statut !== 'vacant').length;

      return {
        appartement:   bat.nom,
        proprietaire:  `${occupes}/${aptsB.length} appts occupés`,
        mois:          `Recouvrement: ${taux}%`,
        montantDu:     impayes,
        montantPaye:   totalC,
        statut:        taux >= 80 ? 'Payé' as const : taux >= 50 ? 'Partiel' as const : 'Impayé' as const,
        dateReglement: `Recouvrement ${taux}%`,
        modePaiement:  `${chargesB.length} charges`,
        reference:     `${aptsB.length} appts`,
      } satisfies LigneRapportPaiement;
    });
  }

  /** Top 20 retardataires agrégés par propriétaire */
  private buildLignesTopRetardataires(aptIds: Set<string> | null): LigneRapportDette[] {
    const uMap = this.buildUserMap();
    const aMap = this.buildAptMap();
    const now  = new Date();

    const aggr = new Map<string, { nom: string; apt: string; montant: number; moisMax: number }>();

    (this.rawDettes as any[])
      .filter(d => d.statut !== 'PAYEE' && (!aptIds || aptIds.has(d.appartementId)))
      .forEach(d => {
        const apt   = aMap.get(d.appartementId);
        const uid   = apt?.proprietaireId || `anonime_${d.appartementId}`;
        const owner = uMap.get(uid)?.name || apt?.numero || '—';
        const ret   = Math.max(
          (now.getFullYear() - (d.annee || this.ANNEE)) * 12 + (now.getMonth() + 1 - (d.mois || 1)), 0
        );
        const reste = Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0);
        if (aggr.has(uid)) {
          const e = aggr.get(uid)!;
          e.montant += reste;
          e.moisMax  = Math.max(e.moisMax, ret);
        } else {
          aggr.set(uid, { nom: owner, apt: apt?.numero || '—', montant: reste, moisMax: ret });
        }
      });

    return Array.from(aggr.values())
      .sort((a, b) => b.montant - a.montant)
      .slice(0, 20)
      .map((e, i) => ({
        appartement:     e.apt,
        proprietaire:    `${i + 1}. ${e.nom}`,
        periode:         `${e.moisMax} mois de retard`,
        montantOriginal: e.montant,
        montantPaye:     0,
        montantRestant:  e.montant,
        statut:          e.moisMax >= 6 ? 'IMPAYEE' : 'PARTIELLEMENT_PAYEE',
        nbMoisRetard:    e.moisMax,
      } satisfies LigneRapportDette));
  }

  /** Bilan mensuel 12 mois glissants */
  private buildLignesBilanMensuel(aptIds: Set<string> | null): LigneRapportPaiement[] {
    const now = new Date();
    const lignes: LigneRapportPaiement[] = [];

    for (let i = 11; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const annee = d.getFullYear();
      const mois  = d.getMonth() + 1;
      const dateIso = `${annee}-${String(mois).padStart(2, '0')}-01`;

      const recettes = (this.rawPaiements as any[])
        .filter(p => p.annee === annee && p.mois === mois && p.status === 'paid' && (!aptIds || aptIds.has(p.appartementId)))
        .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      // Only sum charges active in this month and matching the scope
      const charges = (this.rawCharges as any[])
        .filter(c => {
          if (c.statut !== 'ACTIVE') return false;
          if (c.date_debut && c.date_debut > dateIso) return false;
          if (c.date_fin && c.date_fin < dateIso) return false;
          if (!aptIds) return true;
          if (c.scope === 'all') return true;
          if (c.scope === 'building') {
            return (this.rawAppartements as any[]).some(a => aptIds.has(a.docId) && c.buildingIds?.includes(a.batimentDocId));
          }
          if (c.scope === 'apartment') {
            return (this.rawAppartements as any[]).some(a => aptIds.has(a.docId) && c.apartmentIds?.includes(a.docId));
          }
          return true;
        })
        .reduce((s: number, c: any) => s + (c.montant || 0), 0);

      const dettesRestantes = (this.rawDettes as any[])
        .filter(det => det.annee === annee && det.mois === mois && det.statut !== 'PAYEE' && (!aptIds || aptIds.has(det.appartementId)))
        .reduce((s: number, det: any) => s + Math.max((det.montant_original || 0) - (det.montant_paye || 0), 0), 0);

      const balance = recettes - charges;

      lignes.push({
        appartement:   this.moisLabel(mois),
        proprietaire:  String(annee),
        mois:          `${this.moisLabel(mois)} ${annee}`,
        montantDu:     charges,
        montantPaye:   recettes,
        statut:        balance >= 0 ? 'Payé' as const : recettes > 0 ? 'Partiel' as const : 'Impayé' as const,
        dateReglement: `Balance: ${balance >= 0 ? '+' : ''}${Math.round(balance)} DT`,
        modePaiement:  `Impayés: ${Math.round(dettesRestantes)} DT`,
        reference:     '',
      });
    }
    return lignes;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  NOUVEAUX BUILDERS
  // ─────────────────────────────────────────────────────────────────────────

  /** Échéancier — charges actives avec prochaine échéance */
  private buildLignesEcheancier(aptIds: Set<string> | null): LigneRapportPaiement[] {
    const now = new Date();
    return (this.rawCharges as any[])
      .filter(c => {
        if (c.statut !== 'ACTIVE' && c.statut !== 'PLANIFIEE') return false;
        if (!aptIds) return true;
        if (c.scope === 'all') return true;
        if (c.scope === 'building') {
          return (this.rawAppartements as any[]).some(a => aptIds.has(a.docId) && c.buildingIds?.includes(a.batimentDocId));
        }
        if (c.scope === 'apartment') {
          return (this.rawAppartements as any[]).some(a => aptIds.has(a.docId) && c.apartmentIds?.includes(a.docId));
        }
        return true;
      })
      .map(c => {
        // Calculate next due date based on frequency
        let prochaine = c.date_debut || '—';
        if (c.date_debut) {
          const debut = new Date(c.date_debut);
          const freq  = c.frequence;
          const moisInterval = freq === 'TRIMESTRIELLE' ? 3 : freq === 'ANNUELLE' ? 12 : 1;
          const next = new Date(debut);
          while (next <= now) next.setMonth(next.getMonth() + moisInterval);
          if (c.date_fin && next > new Date(c.date_fin)) {
            prochaine = 'Terminée';
          } else {
            prochaine = next.toLocaleDateString('fr-FR');
          }
        }
        const scope = c.scope === 'all' ? 'Toute la résidence'
          : c.scope === 'building' ? `Bâtiment(s): ${(c.buildingIds || []).length}`
          : `Appt(s): ${(c.apartmentIds || []).length}`;
        return {
          appartement:   c.libelle || '—',
          proprietaire:  c.type_charge || '—',
          mois:          `${c.montant?.toFixed(2) || '0'} DT`,
          montantDu:     c.montant || 0,
          montantPaye:   0,
          statut:        c.statut === 'ACTIVE' ? 'Payé' as const : 'Impayé' as const,
          dateReglement: prochaine,
          modePaiement:  c.frequence || '—',
          reference:     scope,
        } satisfies LigneRapportPaiement;
      })
      .sort((a, b) => {
        const da = a.dateReglement === 'Terminée' ? '9999' : a.dateReglement;
        const db = b.dateReglement === 'Terminée' ? '9999' : b.dateReglement;
        return da.localeCompare(db);
      });
  }

  /** Rapport FIFO — Détail des affectations paiement → dette */
  private buildLignesFifo(aptIds: Set<string> | null, annee: number, mois: number | null): LigneRapportPaiement[] {
    const uMap = this.buildUserMap();
    const aMap = this.buildAptMap();
    const lignes: LigneRapportPaiement[] = [];

    // For each paiement, look at its allocations in dettes
    (this.rawPaiements as any[])
      .filter(p =>
        p.annee === annee &&
        (mois === null || p.mois === mois) &&
        (!aptIds || aptIds.has(p.appartementId))
      )
      .forEach(p => {
        const apt   = aMap.get(p.appartementId);
        const owner = apt?.proprietaireId ? (uMap.get(apt.proprietaireId)?.name || '—') : (p.payer || '—');
        // Find dettes that reference this paiement
        const dettesAffectees = (this.rawDettes as any[]).filter(d =>
          d.paiement_ids?.includes(p.docId)
        );
        if (dettesAffectees.length === 0) {
          // Paiement sans affectation
          lignes.push({
            appartement:   apt?.numero || p.appartementId || '—',
            proprietaire:  owner,
            mois:          p.reference || `PAY-${p.docId?.slice(0, 8) || ''}`,
            montantDu:     p.amount || 0,
            montantPaye:   0,
            statut:        'Impayé' as const,
            dateReglement: p.datePaiement || p.date || '—',
            modePaiement:  'Non affecté',
            reference:     '—',
          });
        } else {
          dettesAffectees.forEach((d, idx) => {
            lignes.push({
              appartement:   apt?.numero || p.appartementId || '—',
              proprietaire:  owner,
              mois:          p.reference || `PAY-${p.docId?.slice(0, 8) || ''}`,
              montantDu:     d.montant_paye || 0,
              montantPaye:   d.montant_paye || 0,
              statut:        d.statut === 'PAYEE' ? 'Payé' as const : 'Partiel' as const,
              dateReglement: p.datePaiement || p.date || '—',
              modePaiement:  `→ ${this.moisLabel(d.mois)} ${d.annee}`,
              reference:     `Priorité ${idx + 1}`,
            });
          });
        }
      });

    return lignes;
  }

  /** Fiche Bâtiment — Détail complet d'un bâtiment */
  private buildLignesFicheBatiment(batId: string): LigneRapportPaiement[] {
    const uMap   = this.buildUserMap();
    const aptsB  = (this.rawAppartements as any[]).filter(a => a.batimentDocId === batId);
    const lignes: LigneRapportPaiement[] = [];

    aptsB.forEach(a => {
      const owner = a.proprietaireId ? (uMap.get(a.proprietaireId)?.name || '—') : 'Vacant';
      const solde = (this.rawDettes as any[])
        .filter(d => d.appartementId === a.docId && d.statut !== 'PAYEE')
        .reduce((s: number, d: any) => s + Math.max((d.montant_original || 0) - (d.montant_paye || 0), 0), 0);
      const chargesApt = (this.rawCharges as any[]).filter(c => {
        if (c.statut !== 'ACTIVE') return false;
        if (c.scope === 'all') return true;
        if (c.scope === 'building') return c.buildingIds?.includes(batId);
        if (c.scope === 'apartment') return c.apartmentIds?.includes(a.docId);
        return false;
      });
      const totalC = chargesApt.reduce((s: number, c: any) => s + (c.montant || 0), 0);

      lignes.push({
        appartement:   `Appt ${a.numero}`,
        proprietaire:  owner,
        mois:          `Ét.${a.etage ?? '—'} — ${a.surface || '—'} m²`,
        montantDu:     solde,
        montantPaye:   totalC,
        statut:        a.statut === 'vacant' ? 'Impayé' as const : solde > 0 ? 'Retard' as const : 'Payé' as const,
        dateReglement: a.type || '—',
        modePaiement:  a.statut || '—',
        reference:     `${chargesApt.length} charges`,
      });
    });

    return lignes;
  }

  /** Taux d'occupation par bâtiment */
  private buildLignesTauxOccupation(aptIds: Set<string> | null): LigneRapportPaiement[] {
    return this.batOptions().map(bat => {
      const aptsB   = (this.rawAppartements as any[]).filter(a =>
        a.batimentDocId === bat.docId && (!aptIds || aptIds.has(a.docId))
      );
      const total   = aptsB.length;
      const occupes = aptsB.filter((a: any) => a.statut !== 'vacant').length;
      const vacants = total - occupes;
      const taux    = total > 0 ? Math.round((occupes / total) * 100) : 0;
      const surfTot = aptsB.reduce((s: number, a: any) => s + (a.surface || 0), 0);
      const surfVac = aptsB.filter((a: any) => a.statut === 'vacant')
        .reduce((s: number, a: any) => s + (a.surface || 0), 0);

      return {
        appartement:   bat.nom,
        proprietaire:  `${total} appts`,
        mois:          `${occupes} occupés / ${vacants} vacants`,
        montantDu:     surfTot,
        montantPaye:   surfTot - surfVac,
        statut:        taux >= 80 ? 'Payé' as const : taux >= 50 ? 'Partiel' as const : 'Impayé' as const,
        dateReglement: `Taux: ${taux}%`,
        modePaiement:  `${surfTot.toFixed(0)} m² total`,
        reference:     `${surfVac.toFixed(0)} m² vacant`,
      } satisfies LigneRapportPaiement;
    });
  }

  /** Détail charges par appartement — chaque charge × chaque appartement */
  private buildLignesDetailChargesApt(aptIds: Set<string> | null): LigneRapportPaiement[] {
    const uMap   = this.buildUserMap();
    const lignes: LigneRapportPaiement[] = [];

    const apts = (this.rawAppartements as any[]).filter(a => !aptIds || aptIds.has(a.docId));

    apts.forEach(a => {
      const owner = a.proprietaireId ? (uMap.get(a.proprietaireId)?.name || '—') : '—';
      const chargesApt = (this.rawCharges as any[]).filter(c => {
        if (c.statut !== 'ACTIVE') return false;
        if (c.scope === 'all') return true;
        if (c.scope === 'building') return c.buildingIds?.includes(a.batimentDocId);
        if (c.scope === 'apartment') return c.apartmentIds?.includes(a.docId);
        return false;
      });

      chargesApt.forEach(c => {
        // Calculate share for this apartment
        const totalTargetApts = c.scope === 'all'
          ? (this.rawAppartements as any[]).length
          : c.scope === 'building'
            ? (this.rawAppartements as any[]).filter((ap: any) => c.buildingIds?.includes(ap.batimentDocId)).length
            : (c.apartmentIds?.length || 1);
        const part = totalTargetApts > 0 ? (c.montant || 0) / totalTargetApts : 0;

        lignes.push({
          appartement:   `Appt ${a.numero}`,
          proprietaire:  owner,
          mois:          c.libelle || '—',
          montantDu:     c.montant || 0,
          montantPaye:   Math.round(part * 100) / 100,
          statut:        'Payé' as const,
          dateReglement: c.type_charge || '—',
          modePaiement:  c.mode_repartition || '—',
          reference:     c.frequence || '—',
        } satisfies LigneRapportPaiement);
      });
    });

    return lignes;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  GÉNÉRATION
  // ─────────────────────────────────────────────────────────────────────────

  async genererRapport() {
    const r = this.selectedRapport();
    if (!r) return;
    await this.generer(r, this.formatExport());
  }

  async genererDepuisCarte(r: RapportDef, fmt: FormatExport) {
    this.selectType(r.id);
    this.formatExport.set(fmt);
    await this.generer(r, fmt);
  }

  private async generer(r: RapportDef, fmt: FormatExport) {
    const jobId = Date.now();
    this.jobs.update(l => [{
      id: jobId, rapport: r.titre, format: fmt.toUpperCase(),
      statut: 'en_cours', progression: 0,
    }, ...l]);
    this.updateJobProgress(jobId, 15);

    try {
      const user      = this.auth.currentUser;
      const userId    = user?.firebaseUid || String(user?.id || 'admin');
      const generePar = user?.name || user?.email || 'Admin';
      const annee     = this.selectedAnnee();
      const mois      = this.selectedMois();
      const aptIds    = this.aptIdsFiltres();
      const periode   = this.periodLabel();
      const scope     = this.scopeLabel();

      const params: ParamsRapport = {
        titre:        r.titre,
        soustitre:    `${periode}${scope !== 'Toute la résidence' ? ' — ' + scope : ''}`,
        residenceNom: 'SyndicPro',
        periode,
        generePar,
        userId,
        sauvegarderCloudinary: false,
      };

      this.updateJobProgress(jobId, 35);

      // ── Build headers + rows per report type ──
      let allHeaders: string[] = [];
      let allRows: string[][] = [];
      let multiFile = false;

      switch (r.id) {

        case 'paiements': {
          const lg = this.buildLignesPaiements(aptIds, annee, mois);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
          break;
        }

        case 'impayes': {
          const lg = this.buildLignesDettes(aptIds, annee, mois);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.periode, l.montantOriginal.toFixed(2), l.montantPaye.toFixed(2), l.montantRestant.toFixed(2), l.statut, String(l.nbMoisRetard)]);
          break;
        }

        case 'recouvrement': {
          multiFile = true;
          this.updateJobProgress(jobId, 45);
          const ligP = this.buildLignesPaiements(aptIds, annee, mois);
          const hP = ['Appartement', 'Propriétaire', 'Mois', 'Montant dû (DT)', 'Montant payé (DT)', 'Statut', 'Date règlement', 'Mode', 'Référence'];
          const rP = ligP.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
          const fP = this.filterByColumns(hP, rP);
          await this.rapportSvc.genererRapportGeneriquePDF(fP.headers, fP.rows, { ...params, titre: `${r.titre} — Paiements` });

          const ligD = this.buildLignesDettes(aptIds, annee, mois);
          const hD = ['Appartement', 'Propriétaire', 'Période', 'Montant original', 'Payé', 'Restant', 'Statut', 'Mois retard'];
          const rD = ligD.map(l => [l.appartement, l.proprietaire, l.periode, l.montantOriginal.toFixed(2), l.montantPaye.toFixed(2), l.montantRestant.toFixed(2), l.statut, String(l.nbMoisRetard)]);
          const fD = this.filterByColumns(hD, rD);
          await this.rapportSvc.genererRapportGeneriquePDF(fD.headers, fD.rows, { ...params, titre: `${r.titre} — Impayés` }, [239, 68, 68]);
          break;
        }

        case 'bilan_mensuel': {
          const lg = this.buildLignesBilanMensuel(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.montantPaye.toFixed(2), l.montantDu.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—']);
          break;
        }

        case 'top_retardataires': {
          const lg = this.buildLignesTopRetardataires(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map((l, i) => [String(i + 1), l.proprietaire.replace(/^\d+\.\s*/, ''), l.appartement, l.montantRestant.toFixed(2), String(l.nbMoisRetard), l.nbMoisRetard >= 6 ? 'Critique' : l.nbMoisRetard >= 3 ? 'Élevé' : 'Modéré']);
          break;
        }

        case 'charges': {
          allHeaders = r.colonnes;
          allRows = (this.rawCharges as any[]).map(c => [
            c.libelle || '—', c.type_charge || '—', c.categorie || '—',
            `${(c.montant || 0).toFixed(2)} DT`, c.frequence || '—',
            c.statut || '—', c.scope || 'all', c.date_debut || '—',
          ]);
          break;
        }

        case 'historique_charges': {
          const lg = this.buildLignesAppartements(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.mois, l.proprietaire, l.montantPaye.toFixed(2), l.modePaiement || '—', l.statut, l.montantDu.toFixed(2), l.dateReglement || '—']);
          break;
        }

        case 'detail_charges_apt': {
          const lg = this.buildLignesDetailChargesApt(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.mois, l.dateReglement || '—', l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.modePaiement || '—', l.reference || '—']);
          break;
        }

        case 'liste_users': {
          const lg = this.buildLignesUsers(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.proprietaire, l.mois, l.dateReglement || '—', l.modePaiement || '—', l.appartement, l.montantDu.toFixed(2), l.reference || '—']);
          break;
        }

        case 'liste_appartements': {
          const lg = this.buildLignesAppartements(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.mois, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—', l.proprietaire, l.montantPaye.toFixed(2), l.montantDu.toFixed(2)]);
          break;
        }

        case 'liste_batiments': {
          const lg = this.buildLignesBatiments(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.reference || '—', l.proprietaire, l.montantPaye.toFixed(2), l.montantDu.toFixed(2), l.mois]);
          break;
        }

        case 'echeancier': {
          const lg = this.buildLignesEcheancier(aptIds);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.mois, l.modePaiement || '—', l.dateReglement || '—', l.reference || '—', l.statut]);
          break;
        }

        case 'rapport_fifo': {
          const lg = this.buildLignesFifo(aptIds, annee, mois);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.mois, l.appartement, l.proprietaire, l.modePaiement || '—', l.montantDu.toFixed(2), l.reference || '—', l.dateReglement || '—']);
          break;
        }

        case 'taux_occupation': {
          const lg = this.buildLignesTauxOccupation(aptIds);
          allHeaders = r.colonnes;
          const parts = (l: any) => (l.mois || '').split(' / ');
          allRows = lg.map(l => [l.appartement, l.proprietaire, parts(l)[0] || '—', parts(l)[1] || '—', l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
          break;
        }

        case 'fiche_user': {
          multiFile = true;
          const uid = this.selectedUser();
          const u   = this.rawUsers.find((u: any) => u.firebaseUid === uid || String(u.id) === uid);
          const nom = u?.name || u?.fullname || uid || '—';
          const uApts = (this.rawAppartements as any[]).filter(a => a.proprietaireId === uid || a.locataireId === uid);
          const uIds  = new Set(uApts.map((a: any) => a.docId));

          const ligP = this.buildLignesPaiements(uIds, annee, mois);
          const hP   = ['Appartement', 'Propriétaire', 'Mois', 'Montant dû (DT)', 'Montant payé (DT)', 'Statut', 'Date règlement', 'Mode', 'Référence'];
          const rP   = ligP.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
          await this.rapportSvc.genererRapportGeneriquePDF(hP, rP, { ...params, titre: `Fiche — ${nom} (Paiements)` });

          const ligD = this.buildLignesDettes(uIds, annee, mois);
          if (ligD.length) {
            const hD = ['Appartement', 'Propriétaire', 'Période', 'Montant original', 'Payé', 'Restant', 'Statut', 'Mois retard'];
            const rD = ligD.map(l => [l.appartement, l.proprietaire, l.periode, l.montantOriginal.toFixed(2), l.montantPaye.toFixed(2), l.montantRestant.toFixed(2), l.statut, String(l.nbMoisRetard)]);
            await this.rapportSvc.genererRapportGeneriquePDF(hD, rD, { ...params, titre: `Fiche — ${nom} (Impayés)` }, [239, 68, 68]);
          }
          break;
        }

        case 'fiche_batiment': {
          const bid = this.selectedBat();
          if (!bid) {
            this.pushToast('❌ Sélectionnez un bâtiment dans le périmètre', false);
            this.jobs.update(l => l.filter(j => j.id !== jobId));
            return;
          }
          const bat = this.batOptions().find(b => b.docId === bid);
          const lg  = this.buildLignesFicheBatiment(bid);
          allHeaders = r.colonnes;
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.reference || '—']);
          params.titre = `Fiche Bâtiment — ${bat?.nom || bid}`;
          break;
        }

        case 'tableau_bord': {
          multiFile = true;
          this.updateJobProgress(jobId, 40);
          const ligP = this.buildLignesPaiements(aptIds, annee, mois);
          const hP   = ['Appartement', 'Propriétaire', 'Mois', 'Montant dû (DT)', 'Montant payé (DT)', 'Statut', 'Date règlement', 'Mode', 'Référence'];
          const rP   = ligP.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
          await this.rapportSvc.genererRapportGeneriquePDF(hP, rP, { ...params, titre: 'Tableau de Bord — Paiements' });

          this.updateJobProgress(jobId, 55);
          const ligD = this.buildLignesDettes(aptIds, annee, mois);
          const hD   = ['Appartement', 'Propriétaire', 'Période', 'Montant original', 'Payé', 'Restant', 'Statut', 'Mois retard'];
          const rD   = ligD.map(l => [l.appartement, l.proprietaire, l.periode, l.montantOriginal.toFixed(2), l.montantPaye.toFixed(2), l.montantRestant.toFixed(2), l.statut, String(l.nbMoisRetard)]);
          await this.rapportSvc.genererRapportGeneriquePDF(hD, rD, { ...params, titre: 'Tableau de Bord — Impayés' }, [239, 68, 68]);

          this.updateJobProgress(jobId, 70);
          const ligA = this.buildLignesAppartements(aptIds);
          const hA   = ['Numéro', 'Bâtiment / Étage', 'Propriétaire', 'Charges/mois', 'Type', 'Statut', 'Solde impayé', 'Surface'];
          const rA   = ligA.map(l => [l.appartement, l.mois, l.proprietaire, l.montantPaye.toFixed(2), l.modePaiement || '—', l.statut, l.montantDu.toFixed(2), l.dateReglement || '—']);
          await this.rapportSvc.genererRapportGeneriquePDF(hA, rA, { ...params, titre: 'Tableau de Bord — Appartements' }, [6, 182, 212]);

          this.updateJobProgress(jobId, 85);
          const ligU = this.buildLignesUsers(aptIds);
          const hU   = ['Nom', 'Email', 'Téléphone', 'Rôle', 'Appartement(s)', 'Solde impayé', 'Statut compte'];
          const rU   = ligU.map(l => [l.proprietaire, l.mois, l.dateReglement || '—', l.modePaiement || '—', l.appartement, l.montantDu.toFixed(2), l.reference || '—']);
          await this.rapportSvc.genererRapportGeneriquePDF(hU, rU, { ...params, titre: 'Tableau de Bord — Copropriétaires' }, [14, 165, 233]);
          break;
        }

        default: {
          const lg = this.buildLignesPaiements(aptIds, annee, mois);
          allHeaders = ['Appartement', 'Propriétaire', 'Mois', 'Montant dû', 'Montant payé', 'Statut', 'Date', 'Mode', 'Réf'];
          allRows = lg.map(l => [l.appartement, l.proprietaire, l.mois, l.montantDu.toFixed(2), l.montantPaye.toFixed(2), l.statut, l.dateReglement || '—', l.modePaiement || '—', l.reference || '—']);
        }
      }

      // ── Generate with column filtering ──
      if (!multiFile && allHeaders.length > 0) {
        const { headers, rows } = this.filterByColumns(allHeaders, allRows);
        fmt === 'pdf'
          ? await this.rapportSvc.genererRapportGeneriquePDF(headers, rows, params)
          : await this.rapportSvc.genererRapportGeneriqueExcel(headers, rows, params);
      }

      this.updateJobProgress(jobId, 100);
      this.jobs.update(l => l.map(j =>
        j.id === jobId
          ? { ...j, statut: 'pret' as const, progression: 100 }
          : j
      ));
      this.pushToast(`✅ ${r.titre} généré avec succès`, true);

    } catch (err: any) {
      console.error('[Rapports]', err);
      this.jobs.update(l => l.map(j =>
        j.id === jobId
          ? { ...j, statut: 'erreur' as const, progression: 100, erreurMsg: err?.message || 'Erreur inconnue' }
          : j
      ));
      this.pushToast(`❌ Erreur lors de la génération`, false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  supprimerJob(id: number) { this.jobs.update(l => l.filter(j => j.id !== id)); }

  private updateJobProgress(jobId: number, prog: number) {
    this.jobs.update(l => l.map(j => j.id === jobId ? { ...j, progression: prog } : j));
  }

  private pushToast(msg: string, ok: boolean) {
    this.toast.set({ msg, ok });
    setTimeout(() => this.toast.set(null), 5000);
  }

  catIcon(cat: string): string {
    return ({ Financier: '📊', Charges: '🧾', Annuaire: '👥', Synthèse: '🗺️' } as any)[cat] ?? '📁';
  }

  formatMontant(v: number): string {
    if (!v && v !== 0) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M DT`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k DT`;
    return `${Math.round(v).toLocaleString('fr-TN')} DT`;
  }

  isScopeAvailable(sc: ScopeRapport): boolean {
    return this.availableScopes().includes(sc);
  }

  get chargesPreview(): any[]   { return this.rawCharges.slice(0, 8); }
  get aptsPreview(): AptOption[] { return this.aptOptions().slice(0, 5); }
  get usersPreview(): UserOption[] { return this.userOptions().slice(0, 5); }
}