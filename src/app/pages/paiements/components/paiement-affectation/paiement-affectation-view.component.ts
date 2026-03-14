import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  computed,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PaiementService,
  Payment,
  PaymentMode,
} from '../../services/paiement.service';
import { PaiementAffectationService } from '../../services/paiement-affectation.service';
import { DetteService } from '../../../dette/services/dette.service';
import { UserService } from '../../../coproprietaires/services/coproprietaire.service';

import { PaiementAllocation } from '../../../../models/paiementAllocation.model';
import { Dette } from '../../../../models/dette.model';

// ─── ViewModels ───────────────────────────────────────────────────────────────

export interface AllocationViewModel {
  allocation: PaiementAllocation;
  dette: Dette | null;
}

export interface CoproViewModel {
  id: string;   // firebaseUid ou id.toString()
  nom: string;
  email: string;
}

// ─── Composant ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-paiement-affectation-view',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, DatePipe],
  templateUrl: './paiement-affectation-view.component.html',
  // ✅ Pas de styleUrls — tout en classes Tailwind
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaiementAffectationViewComponent implements OnInit {

  // ── Signaux formulaire ────────────────────────────────────────────────────
  readonly paiementIdInput  = signal('');
  readonly montant          = signal<number>(0);
  readonly datePaiement     = signal(new Date().toISOString().split('T')[0]);
  readonly modePaiement     = signal<PaymentMode>('virement');
  readonly reference        = signal('');
  readonly coproSelectionne = signal<string>('');
  readonly isLoading        = signal(false);
  readonly isSaving         = signal(false);

  // ── Messages ──────────────────────────────────────────────────────────────
  readonly error  = signal<string | null>(null);
  readonly info   = signal<string | null>(null);
  readonly succes = signal<string | null>(null);

  // ── Données chargées ──────────────────────────────────────────────────────
  readonly copros      = signal<CoproViewModel[]>([]);
  readonly paiements   = signal<Payment[]>([]);
  readonly allocations = signal<AllocationViewModel[]>([]);

  // ── Résultat dernière affectation ─────────────────────────────────────────
  readonly dernierResultat = signal<{
    montantAlloue: number;
    montantRestant: number;
    soldeAvant: number;
    soldeApres: number;
  } | null>(null);

  // ── Computed KPIs ─────────────────────────────────────────────────────────
  readonly montantAlloueTotal = computed(() =>
    this.allocations().reduce((s, i) => s + i.allocation.montant_alloue, 0),
  );

  readonly dettesSoldees = computed(() =>
    this.allocations().filter(i => i.dette?.statut === 'PAYEE').length,
  );

  readonly dettesPartielles = computed(() =>
    this.allocations().filter(i => i.dette?.statut === 'PARTIELLEMENT_PAYEE').length,
  );

  readonly paiementSelectionne = computed(() =>
    this.paiements().find(
      p => p.docId === this.paiementIdInput() || p.reference === this.paiementIdInput()
    ) ?? null,
  );

  readonly soldeActuel = computed(() => {
    const res = this.dernierResultat();
    if (res) return res.soldeAvant;
    return this.paiements()
      .filter(p => p.status !== 'paid')
      .reduce((s, p) => s + p.amount, 0);
  });

  readonly soldeApres = computed(() => {
    const res = this.dernierResultat();
    if (res) return res.soldeApres;
    return Math.max(this.soldeActuel() - this.montant(), 0);
  });

  // ─── Constructor ──────────────────────────────────────────────────────────
  constructor(
    private readonly paiementService:    PaiementService,
    private readonly affectationService: PaiementAffectationService,
    private readonly detteService:       DetteService,
    private readonly userService:        UserService,
    private readonly cdr:                ChangeDetectorRef,
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  async ngOnInit(): Promise<void> {
    await this.chargerCopros();
  }

  // ─── Chargement copropriétaires ───────────────────────────────────────────
  async chargerCopros(): Promise<void> {
    try {
      const users = await (
        this.userService.loadFromFirestore?.() ??
        Promise.resolve(this.userService.getAll())
      );
      const list: CoproViewModel[] = users
        .filter((u: any) => u.firebaseUid || u.id)
        .map((u: any) => ({
          id:    u.firebaseUid || String(u.id),
          nom:   u.name || u.fullname || u.email || 'Inconnu',
          email: u.email || '',
        }));
      this.copros.set(list);
    } catch (err) {
      console.error('Erreur chargement copros:', err);
    }
    this.cdr.markForCheck();
  }

  // ─── Sélection copropriétaire ─────────────────────────────────────────────
  async onCoproChange(coproId: string): Promise<void> {
    this.coproSelectionne.set(coproId);
    this.allocations.set([]);
    this.paiementIdInput.set('');
    this.dernierResultat.set(null);
    this.info.set(null);
    this.error.set(null);
    this.succes.set(null);

    if (!coproId) { this.paiements.set([]); return; }

    try {
      const tous = await this.paiementService.loadFromFirestore();
      const filtre = tous.filter(p => p.coproprietaireId === coproId);
      this.paiements.set(filtre);
      this.reference.set(this.paiementService.buildReference());
    } catch (err) {
      console.error('Erreur chargement paiements:', err);
    }
    this.cdr.markForCheck();
  }

  // ─── Sélection d'un paiement existant ────────────────────────────────────
  async onPaiementChange(idOrRef: string): Promise<void> {
    this.paiementIdInput.set(idOrRef);
    this.allocations.set([]);
    this.info.set(null);
    this.error.set(null);

    if (!idOrRef) return;

    const p = this.paiementSelectionne();
    if (p) {
      this.montant.set(p.amount);
      this.datePaiement.set(p.datePaiement || new Date().toISOString().split('T')[0]);
      if (p.modePaiement) this.modePaiement.set(p.modePaiement);
      if (p.reference)    this.reference.set(p.reference);
    }

    await this.chargerAllocations(idOrRef);
  }

  // ─── Charger allocations d'un paiement ───────────────────────────────────
  async chargerAllocations(paiementId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const rawAllocations = await this.affectationService.getByPaiement(paiementId);

      if (!rawAllocations.length) {
        this.info.set('Aucune allocation enregistrée pour ce paiement.');
        this.allocations.set([]);
        return;
      }

      const details: AllocationViewModel[] = [];
      for (const allocation of rawAllocations) {
        const dette = allocation.detteId
          ? await this.detteService.getById(allocation.detteId)
          : null;
        details.push({ allocation, dette: dette ?? null });
      }

      details.sort((a, b) => a.allocation.ordre_priorite - b.allocation.ordre_priorite);
      this.allocations.set(details);
      this.info.set(null);
    } catch (err) {
      console.error('Erreur chargement allocations:', err);
      this.error.set((err as Error).message || 'Impossible de charger les allocations.');
    } finally {
      this.isLoading.set(false);
      this.cdr.markForCheck();
    }
  }

  // ─── Valider l'affectation ────────────────────────────────────────────────
  async validerAffectation(): Promise<void> {
    const coproId = this.coproSelectionne();
    const montant = this.montant();

    this.error.set(null);
    this.succes.set(null);

    if (!coproId) {
      this.error.set('Veuillez sélectionner un copropriétaire.');
      return;
    }
    if (!montant || montant <= 0) {
      this.error.set('Le montant doit être supérieur à 0 DT.');
      return;
    }

    this.isSaving.set(true);
    const soldeAvant = this.soldeActuel();

    try {
      const copro = this.copros().find(c => c.id === coproId);

      // 1. Créer le paiement Firestore
      const paiement = await this.paiementService.create({
        label:            `Paiement ${this.datePaiement()} — ${copro?.nom ?? 'Copropriétaire'}`,
        amount:           montant,
        date:             this.datePaiement(),
        dueDate:          this.datePaiement(),
        status:           'paid',
        payer:            copro?.nom ?? '',
        coproprietaireId: coproId,
        datePaiement:     this.datePaiement(),
        modePaiement:     this.modePaiement(),
        reference:        this.reference() || this.paiementService.buildReference(),
        statutWorkflow:   'valide',
      });

      // 2. FIFO : affecter sur les dettes
      const resultat = await this.affectationService.affecterPaiement(
        paiement.docId!,
        coproId,
        montant,
      );

      // 3. Mettre à jour l'UI
      this.paiementIdInput.set(paiement.docId!);
      this.dernierResultat.set({
        montantAlloue:  resultat.montant_alloue,
        montantRestant: resultat.montant_restant,
        soldeAvant,
        soldeApres: Math.max(soldeAvant - resultat.montant_alloue, 0),
      });

      // 4. Recharger les allocations créées
      await this.chargerAllocations(paiement.docId!);

      // 5. Rafraîchir la liste paiements du copro
      const tous = await this.paiementService.loadFromFirestore();
      this.paiements.set(tous.filter(p => p.coproprietaireId === coproId));

      this.succes.set(
        resultat.montant_alloue > 0
          ? `Affectation validée : ${resultat.montant_alloue.toFixed(2)} DT alloués — ` +
            `${resultat.dettes_soldees.length} dette(s) soldée(s)` +
            (resultat.montant_restant > 0
              ? `, ${resultat.montant_restant.toFixed(2)} DT non affectés.`
              : '.')
          : `Paiement de ${montant.toFixed(2)} DT enregistré. Aucune dette en cours pour ce copropriétaire.`,
      );

      // Préparer une nouvelle référence
      this.reference.set(this.paiementService.buildReference());

    } catch (err: any) {
      console.error('Erreur affectation:', err);
      this.error.set(err?.message || 'Erreur lors de la validation.');
    } finally {
      this.isSaving.set(false);
      this.cdr.markForCheck();
    }
  }

  // ─── Helpers UI ───────────────────────────────────────────────────────────

  setMode(mode: PaymentMode): void { this.modePaiement.set(mode); }

  genererReference(): void { this.reference.set(this.paiementService.buildReference()); }

  largeurBarre(montantAlloue: number): number {
    const total = this.montant() || this.montantAlloueTotal() || 1;
    return Math.min(Math.round((montantAlloue / total) * 100), 100);
  }

  modeLabel(mode: PaymentMode | undefined): string {
    const map: Record<PaymentMode, string> = {
      virement: 'Virement', cheque: 'Chèque',
      especes: 'Espèces', carte: 'Carte', prelevement: 'Prélèvement',
    };
    return mode ? (map[mode] ?? mode) : '—';
  }

  badgeDetteClass(statut: string | undefined): string {
    switch (statut) {
      case 'PAYEE':               return 'bg-emerald-100 text-emerald-700';
      case 'PARTIELLEMENT_PAYEE': return 'bg-violet-100 text-violet-700';
      case 'IMPAYEE':             return 'bg-red-100 text-red-600';
      default:                    return 'bg-slate-100 text-slate-500';
    }
  }

  labelStatut(statut: string | undefined): string {
    switch (statut) {
      case 'PAYEE':               return 'Soldé';
      case 'PARTIELLEMENT_PAYEE': return 'Partiel';
      case 'IMPAYEE':             return 'Impayé';
      default:                    return statut ?? '—';
    }
  }

  pourcentagePaye(dette: Dette | null): number {
    if (!dette || !dette.montant_original) return 0;
    return Math.round((dette.montant_paye / dette.montant_original) * 100);
  }
}