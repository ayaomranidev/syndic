import { ChangeDetectionStrategy, Component, OnInit, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { BudgetService, LigneBudget, BudgetAnnuel, BudgetCategorie, LigneType, LigneStatut } from '../services/budget.service';
import { PaginationService } from '../../../shared/services/pagination.service';

@Component({
  selector: 'app-budget',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './budget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetComponent implements OnInit {

  readonly annee        = signal(new Date().getFullYear());
  readonly lignes       = signal<LigneBudget[]>([]);
  readonly loading      = signal(true);
  readonly typeFilter   = signal<LigneType | 'tous'>('tous');
  readonly catFilter    = signal<BudgetCategorie | 'toutes'>('toutes');
  readonly showModal    = signal(false);
  readonly saving       = signal(false);
  readonly editId       = signal<string | null>(null);

  readonly annees    = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2];
  readonly categories: BudgetCategorie[] = ['ENTRETIEN','CHARGES_COMMUNES','TRAVAUX','ASSURANCE','ADMINISTRATION','RESERVE','AUTRE'];
  readonly statuts: LigneStatut[]        = ['PREVU','ENGAGE','PAYE','ANNULE'];

  readonly form = new FormGroup({
    type:         new FormControl<LigneType>('DEPENSE', Validators.required),
    categorie:    new FormControl<BudgetCategorie>('CHARGES_COMMUNES', Validators.required),
    libelle:      new FormControl('', Validators.required),
    description:  new FormControl(''),
    montantPrevu: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    montantReel:  new FormControl<number | null>(null),
    statut:       new FormControl<LigneStatut>('PREVU', Validators.required),
    mois:         new FormControl<number | null>(null),
    fournisseur:  new FormControl(''),
    dateEcheance: new FormControl(''),
  });

  // Computed
  readonly budget = computed<BudgetAnnuel>(() => this.svc.calculerBudget(this.lignes(), this.annee()));

  readonly filteredLignes = computed<LigneBudget[]>(() => {
    let l = this.lignes();
    if (this.typeFilter() !== 'tous')    l = l.filter(x => x.type === this.typeFilter());
    if (this.catFilter()  !== 'toutes')  l = l.filter(x => x.categorie === this.catFilter());
    return l;
  });

  readonly parCategorie = computed(() => {
    const map = new Map<BudgetCategorie, { prevu: number; reel: number; count: number }>();
    for (const l of this.lignes().filter(x => x.type === 'DEPENSE')) {
      const e = map.get(l.categorie) ?? { prevu: 0, reel: 0, count: 0 };
      e.prevu += l.montantPrevu; e.reel += (l.montantReel ?? 0); e.count++;
      map.set(l.categorie, e);
    }
    return map;
  });

  readonly totalFiltrePrevu = computed(() => this.filteredLignes().reduce((s, l) => s + l.montantPrevu, 0));
  readonly totalFiltreReel  = computed(() => this.filteredLignes().reduce((s, l) => s + (l.montantReel ?? 0), 0));

  constructor(private readonly svc: BudgetService, public readonly pagination: PaginationService<LigneBudget>) {}
  async ngOnInit() { await this.load(); }

  // Sync filtered items into pagination service (use effect to avoid computed writes)
  private readonly _syncPagination = effect(() => {
    this.pagination.setItems(this.filteredLignes());
  });

  setPage(page: number) { this.pagination.setPage(page); }
  setPageSize(size: number) { this.pagination.setPageSize(size); }

  async load() {
    this.loading.set(true);
    try { this.lignes.set(await this.svc.getByAnnee(this.annee())); }
    catch { this.lignes.set(this.getSeedData()); }
    finally { this.loading.set(false); }
  }

  async changeAnnee(a: number) { this.annee.set(a); await this.load(); }

  openCreate() { this.editId.set(null); this.form.reset({ type:'DEPENSE', categorie:'CHARGES_COMMUNES', statut:'PREVU', montantPrevu:0 }); this.showModal.set(true); }
  openEdit(l: LigneBudget) {
    this.editId.set(l.id ?? null);
    this.form.patchValue({ type:l.type, categorie:l.categorie, libelle:l.libelle, description:l.description, montantPrevu:l.montantPrevu, montantReel:l.montantReel??null, statut:l.statut, mois:l.mois??null, fournisseur:l.fournisseur, dateEcheance:l.dateEcheance });
    this.showModal.set(true);
  }

  async submit() {
    if (!this.form.valid) return;
    this.saving.set(true);
    const v = this.form.value;
    const data: Omit<LigneBudget,'id'|'createdAt'|'updatedAt'> = {
      annee: this.annee(), type: v.type!, categorie: v.categorie!, libelle: v.libelle!,
      description: v.description || undefined, montantPrevu: v.montantPrevu!, montantReel: v.montantReel ?? undefined,
      statut: v.statut!, mois: v.mois ?? undefined, fournisseur: v.fournisseur || undefined, dateEcheance: v.dateEcheance || undefined,
    };
    try {
      const id = this.editId();
      if (id) {
        await this.svc.update(id, data);
        this.lignes.update(l => l.map(x => x.id === id ? { ...x, ...data, id } : x));
      } else {
        const created = await this.svc.create(data);
        this.lignes.update(l => [created, ...l]);
      }
      this.showModal.set(false);
    } finally { this.saving.set(false); }
  }

  async supprimer(l: LigneBudget) {
    if (!l.id) return;
    await this.svc.delete(l.id);
    this.lignes.update(list => list.filter(x => x.id !== l.id));
  }

  closeModal() { this.showModal.set(false); }

  // Helpers
  catLabel(c: BudgetCategorie) { return BudgetService.catLabel(c); }
  catIcon(c: BudgetCategorie)  { return BudgetService.catIcon(c); }
  catColor(c: BudgetCategorie) { return BudgetService.catColor(c); }

  statutColor(s: LigneStatut): string {
    return { PREVU:'bg-blue-100 text-blue-800', ENGAGE:'bg-amber-100 text-amber-800', PAYE:'bg-emerald-100 text-emerald-800', ANNULE:'bg-red-100 text-red-800' }[s] ?? '';
  }
  formatMontant(v: number): string { return (v ?? 0).toLocaleString('fr-TN', { minimumFractionDigits:0, maximumFractionDigits:0 }) + ' DT'; }
  barWidth(reel: number, prevu: number): number { return prevu > 0 ? Math.min(100, Math.round((reel / prevu) * 100)) : 0; }
  moisLabel(m: number): string { return ['','Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'][m] ?? ''; }

  private getSeedData(): LigneBudget[] {
    const cats: BudgetCategorie[] = ['ENTRETIEN','CHARGES_COMMUNES','TRAVAUX','ASSURANCE','ADMINISTRATION'];
    return cats.flatMap((cat, i) => ([
      { id:`s${i}a`, annee:this.annee(), mois:undefined, categorie:cat, type:'DEPENSE' as LigneType, libelle:`Budget ${BudgetService.catLabel(cat)}`, montantPrevu:1000*(i+1), montantReel:800*(i+1), statut:'PAYE' as LigneStatut },
      { id:`s${i}b`, annee:this.annee(), mois:undefined, categorie:cat, type:'DEPENSE' as LigneType, libelle:`Prévu ${BudgetService.catLabel(cat)} Q4`, montantPrevu:500*(i+1), montantReel:undefined, statut:'PREVU' as LigneStatut },
    ]));
  }
}