import {
  ChangeDetectionStrategy, Component, OnInit,
  computed, signal, effect, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  Charge, ChargePayload, ChargeType,
  ChargeFixe, ChargeTravaux, ChargeVariable,
  ChargeCard, ChargeScope,
  ChargeFixePayload, ChargeTravauxPayload, ChargeVariablePayload,
  CHARGE_CATEGORIES, URGENCE_LABELS, STATUT_LABELS,
} from '../../../models/charge.model';
import {
  ChargeService, BatimentOption, AppartementOption, EtageOption,
  CHARGE_CRITICAL_FIELDS,
} from './../services/charge.service';
import { DetteService } from '../../dette/services/dette.service';
import { ChargeRepartitionService } from '../services/charge-repartition.service';
import { Auth } from '../../../core/services/auth';
import { UserService } from '../../coproprietaires/services/coproprietaire.service'; // ✅ AJOUTÉ

@Component({
  selector: 'app-charges',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './charges.component.html',
  styleUrls: ['./charges.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChargesComponent implements OnInit {

  // ── Toasts ──────────────────────────────────────────────────────────────────
  readonly toasts = signal<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  addToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    this.toasts.update(list => [...list, { id, message, type }]);
    setTimeout(() => this.toasts.update(list => list.filter(x => x.id !== id)), 4000);
  }

  clearSearch(el?: HTMLInputElement) {
    this.searchTerm.set('');
    try {
      if (el) el.value = '';
      else (document.querySelector('#searchInput') as HTMLInputElement | null)?.value === '';
    } catch (e) { /* ignore SSR */ }
  }

  // ── Onglet actif ─────────────────────────────────────────────────────────────
  readonly activeTab = signal<'TOUS' | ChargeType>('TOUS');

  // ── Données ──────────────────────────────────────────────────────────────────
  readonly charges            = signal<ChargeCard[]>([]);
  readonly loading            = signal(false);
  readonly editingId          = signal<string | null>(null);
  readonly showModal          = signal(false);
  readonly generatingDettesId = signal<string | null>(null);
  readonly formError          = signal<string | null>(null);

  private dataLoaded          = false;
  private isResidenceAdmin    = false;
  private currentResidenceId: string | null = null;

  // ── Données immobilières ──────────────────────────────────────────────────────
  readonly batiments            = signal<BatimentOption[]>([]);
  readonly appartements         = signal<AppartementOption[]>([]);
  readonly filteredAppartements = signal<AppartementOption[]>([]);
  readonly etagesMap            = signal<Map<string, EtageOption[]>>(new Map());
  readonly availableEtages      = signal<EtageOption[]>([]);

  // ── Constantes template ───────────────────────────────────────────────────────
  readonly CHARGE_CATEGORIES = CHARGE_CATEGORIES;
  readonly URGENCE_LABELS    = URGENCE_LABELS;
  readonly STATUT_LABELS     = STATUT_LABELS;

  // ── Services injectés ────────────────────────────────────────────────────────
  private readonly chargeService = inject(ChargeService);
  private readonly detteService = inject(DetteService);
  private readonly repartitionService = inject(ChargeRepartitionService);
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService); // ✅ AJOUTÉ

  // ── Filtres ────────────────────────────────────────────────────────────────────
  searchTerm       = signal<string>('');
  selectedCategory = signal<string>('');
  selectedStatus   = signal<string>('');

  // ── Computed — par type ───────────────────────────────────────────────────────
  readonly chargesFixes = computed(() =>
    this.charges().filter((c): c is ChargeCard & ChargeFixe => c.type_charge === 'FIXE'),
  );
  readonly travaux = computed(() =>
    this.charges().filter((c): c is ChargeCard & ChargeTravaux => c.type_charge === 'TRAVAUX'),
  );
  readonly chargesVariables = computed(() =>
    this.charges().filter((c): c is ChargeCard & ChargeVariable => c.type_charge === 'VARIABLE'),
  );

  // ── Computed — filtrés ────────────────────────────────────────────────────────
  readonly filteredCharges = computed(() =>
    this.charges().filter(c => this.matchesSearch(c) && this.matchesCategory(c) && this.matchesStatus(c)),
  );
  readonly filteredChargesFixes = computed(() =>
    this.chargesFixes().filter(c => this.matchesSearch(c) && this.matchesCategory(c) && this.matchesStatus(c)),
  );
  readonly filteredTravaux = computed(() =>
    this.travaux().filter(c => this.matchesSearch(c) && this.matchesCategory(c) && this.matchesStatus(c)),
  );
  readonly filteredChargesVariables = computed(() =>
    this.chargesVariables().filter(c => this.matchesSearch(c) && this.matchesCategory(c) && this.matchesStatus(c)),
  );

  // ── Computed — stats ──────────────────────────────────────────────────────────
  readonly stats = computed(() => {
    const fixesTotal     = this.chargesFixes().reduce((a, c) => a + (c.montant || 0) * (c.duree_mois || 12), 0);
    const travauxTotal   = this.travaux().reduce((a, c) => a + (c.montant || 0), 0);
    const variablesTotal = this.chargesVariables().reduce((a, c) => {
      if (c.consommation_totale && c.prix_unitaire) return a + c.consommation_totale * c.prix_unitaire;
      return a + (c.montant || 0);
    }, 0);
    return {
      totalAnnual:  fixesTotal + travauxTotal + variablesTotal,
      totalMonthly: this.chargesFixes().reduce((a, c) => a + (c.montant || 0), 0),
      fixesTotal, travauxTotal, variablesTotal,
      count: this.charges().length,
      countByType: {
        FIXE:     this.chargesFixes().length,
        TRAVAUX:  this.travaux().length,
        VARIABLE: this.chargesVariables().length,
      },
    };
  });

  // ── Formulaire ────────────────────────────────────────────────────────────────
  readonly form = new FormGroup({
    type_charge:       new FormControl<ChargeType>('FIXE', Validators.required),
    libelle:           new FormControl('', [Validators.required, Validators.minLength(3)]),
    description:       new FormControl(''),
    montant:           new FormControl<number>(0, [Validators.required, Validators.min(0)]),
    unite_montant:     new FormControl('MENSUEL', Validators.required),
    date_debut:        new FormControl(this.todayIso(), Validators.required),
    date_fin:          new FormControl(''),
    duree_mois:        new FormControl<number>(12, [Validators.min(1)]),
    frequence:         new FormControl('MENSUELLE', Validators.required),
    mode_repartition:  new FormControl('TANTIEMES', Validators.required),
    statut:            new FormControl('ACTIVE', Validators.required),
    categorie:         new FormControl('COURANTE', Validators.required),
    scope:                 new FormControl<ChargeScope>('all', Validators.required),
    batimentSelection:     new FormControl<string>('all'),
    batimentIds:           new FormControl<string[]>([]),
    floors:                new FormControl<number[]>([]),
    appartementSelection:  new FormControl<string>('all'),
    appartementIds:        new FormControl<string[]>([]),
    applicable_parking:    new FormControl(false),
    parkingIds:            new FormControl<string[]>([]),
    notes:                 new FormControl(''),
    // FIXE
    contrat_id:                   new FormControl(''),
    fournisseur:                  new FormControl(''),
    reconduction_auto:            new FormControl(false),
    date_prochain_renouvellement: new FormControl(''),
    conditions_resiliation:       new FormControl(''),
    // TRAVAUX
    date_panne:         new FormControl(''),
    urgence:            new FormControl('MOYENNE'),
    intervenant:        new FormControl(''),
    pieces_remplacees:  new FormControl<string[]>([]),
    devis_id:           new FormControl(''),
    devis_montant:      new FormControl<number>(0),
    facture_id:         new FormControl(''),
    facture_montant:    new FormControl<number>(0),
    duree_intervention: new FormControl<number>(0),
    garantie_mois:      new FormControl<number>(0),
    date_intervention:  new FormControl(''),
    photos:             new FormControl<string[]>([]),
    cause_panne:        new FormControl(''),
    // VARIABLE
    compteur_general:    new FormControl(''),
    index_debut:         new FormControl<number>(0),
    index_fin:           new FormControl<number>(0),
    consommation_totale: new FormControl<number>(0),
    prix_unitaire:       new FormControl<number>(0),
    numero_contrat:      new FormControl(''),
    periode_releve:      new FormControl(''),
  });

  constructor() {
    this.form.get('type_charge')?.valueChanges.subscribe(type => {
      this.updateFormValidators(type as ChargeType);
    });

    this.form.get('scope')?.valueChanges.subscribe(scope => {
      if (scope === 'all' || scope === 'parking' || scope === 'ascenseur') {
        this.form.patchValue({
          batimentSelection: 'all', batimentIds: [], floors: [],
          appartementSelection: 'all', appartementIds: [],
          applicable_parking: scope === 'parking',
        }, { emitEvent: false });
      } else if (scope === 'building') {
        this.form.patchValue({ appartementSelection: 'all', appartementIds: [] }, { emitEvent: false });
      }
    });

    this.form.get('batimentSelection')?.valueChanges.subscribe(selection => {
      if (selection === 'all') {
        this.form.patchValue({ batimentIds: [], floors: [] }, { emitEvent: false });
        this.availableEtages.set([]);
      }
    });

    this.form.get('batimentIds')?.valueChanges.subscribe(async ids => {
      if (ids && ids.length > 0) {
        await this.updateAvailableEtages(ids);
      } else {
        this.availableEtages.set([]);
        this.form.patchValue({ floors: [] }, { emitEvent: false });
      }
    });

    // Filtrer les appartements par bâtiments sélectionnés (dans la résidence courante)
    effect(() => {
      const batimentIds    = this.form.get('batimentIds')?.value || [];
      const allAppartements = this.appartements();
      if (batimentIds.length > 0) {
        this.filteredAppartements.set(
          allAppartements.filter(apt => apt.batimentDocId && batimentIds.includes(apt.batimentDocId)),
        );
      } else {
        this.filteredAppartements.set(allAppartements);
      }
    });

    this.form.get('date_debut')?.valueChanges.subscribe((deb: string | null) => {
      const fin = this.form.get('date_fin')?.value;
      if (deb && fin) { this.form.patchValue({ duree_mois: this.monthsBetween(deb, fin) }, { emitEvent: false }); this.formError.set(null); }
    });
    this.form.get('date_fin')?.valueChanges.subscribe((fin: string | null) => {
      const deb = this.form.get('date_debut')?.value;
      if (deb && fin) { this.form.patchValue({ duree_mois: this.monthsBetween(deb, fin) }, { emitEvent: false }); this.formError.set(null); }
    });
  }

  // ==========================================================================
  // LIFECYCLE - CORRIGÉ
  // ==========================================================================

async ngOnInit() {
  this.auth.currentUser$.subscribe(async (firebaseUser) => {
    if (firebaseUser) {
      try {
        // ✅ CORRIGÉ : Convertir en string
        const userId = String(firebaseUser.id);
        console.log('🔍 ID utilisateur converti:', userId);
        
        const userData = await this.userService.getById(userId);
        
        if (userData) {
          const roles = userData.roles || [];
          this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
          this.currentResidenceId = this.isResidenceAdmin ? userData.residenceId || null : null;
          
          console.log('✅ Données utilisateur chargées:', {
            id: userId,
            isResidenceAdmin: this.isResidenceAdmin,
            currentResidenceId: this.currentResidenceId,
            roles
          });
        } else {
          console.warn('Utilisateur non trouvé dans Firestore pour ID:', userId);
          this.isResidenceAdmin = false;
          this.currentResidenceId = null;
        }
      } catch (error) {
        console.error('Erreur chargement utilisateur:', error);
        this.isResidenceAdmin = false;
        this.currentResidenceId = null;
      }
    } else {
      this.isResidenceAdmin = false;
      this.currentResidenceId = null;
    }

    if (this.dataLoaded) return;
    await Promise.all([this.refresh(), this.loadPropertyData()]);
    this.dataLoaded = true;
  });
}

  async refreshData() {
    this.dataLoaded = false;
    await Promise.all([this.refresh(), this.loadPropertyData()]);
    this.dataLoaded = true;
  }

  // ==========================================================================
  // CHARGEMENT
  // ==========================================================================

  async loadPropertyData() {
    try {
      const [batiments, appartements] = await Promise.all([
        this.chargeService.getBatiments(this.currentResidenceId),
        this.chargeService.getAppartements(this.currentResidenceId),
      ]);
      this.batiments.set(batiments);
      this.appartements.set(appartements);
      this.filteredAppartements.set(appartements);
    } catch (error) {
      console.error('Error loading property data:', error);
    }
  }

  async updateAvailableEtages(batimentIds: string[]) {
    try {
      const etagesMap  = await this.chargeService.getEtagesByBatiments(batimentIds);
      this.etagesMap.set(etagesMap);
      const allEtages: EtageOption[] = [];
      etagesMap.forEach((etages, batimentDocId) =>
        etages.forEach(e => allEtages.push({ ...e, batimentDocId })),
      );
      this.availableEtages.set(allEtages);
    } catch (error) {
      console.error('Error updating etages:', error);
    }
  }

  async refresh() {
    this.loading.set(true);
    try {
      const data   = await this.chargeService.list(this.currentResidenceId);
      const mapped = data.map(c => this.toCard(c));
      this.charges.set(mapped.sort((a, b) => a.libelle.localeCompare(b.libelle)));
    } finally {
      this.loading.set(false);
    }
  }

  // ==========================================================================
  // MODAL
  // ==========================================================================

  switchTab(tab: 'TOUS' | ChargeType) { this.activeTab.set(tab); }

  openModal() {
    this.showModal.set(true);
    this.resetForm();
    const tab  = this.activeTab();
    const type: ChargeType = tab === 'TOUS' ? 'FIXE' : tab;
    this.form.patchValue({ type_charge: type });
  }

  openModalWithType(type: ChargeType) {
    this.form.patchValue({ type_charge: type });
    this.openModal();
  }

  closeModal() {
    this.showModal.set(false);
    this.resetForm();
  }

  // ==========================================================================
  // SAUVEGARDE - CORRIGÉE avec logs de débogage
  // ==========================================================================

  async save() {
    this.form.markAllAsTouched();
    this.formError.set(null);

    const validationError = this.validateForm();
    if (validationError) { this.formError.set(validationError); return; }
    if (!this.form.valid) return;

    // ✅ LOGS DE DÉBOGAGE
    console.log('🔍 DEBUG - Informations utilisateur:', {
      isResidenceAdmin: this.isResidenceAdmin,
      currentResidenceId: this.currentResidenceId,
      editingId: this.editingId()
    });

    const raw  = this.form.getRawValue();
    const type = raw.type_charge as ChargeType;

    const basePayload: any = {
      type_charge:        type,
      libelle:            raw.libelle?.trim()     || 'Charge',
      description:        raw.description?.trim() || '',
      montant:            Number(raw.montant)      || 0,
      unite_montant:      raw.unite_montant        || 'MENSUEL',
      date_debut:         raw.date_debut           || this.todayIso(),
      date_fin:           raw.date_fin             || undefined,
      duree_mois:         raw.duree_mois           ? Number(raw.duree_mois) : undefined,
      frequence:          raw.frequence            || 'MENSUELLE',
      mode_repartition:   raw.mode_repartition     || 'TANTIEMES',
      statut:             raw.statut               || 'ACTIVE',
      categorie:          raw.categorie            || 'COURANTE',
      scope:              raw.scope                || 'all',
      buildingIds:        raw.batimentSelection === 'specific' ? (raw.batimentIds    || []) : [],
      apartmentIds:       raw.appartementSelection === 'specific' ? (raw.appartementIds || []) : [],
      floors:             raw.floors               || [],
      applicable_parking: Boolean(raw.applicable_parking),
      parkingIds:         raw.parkingIds           || [],
      notes:              raw.notes                || '',
      // ✅ CORRECTION : Utiliser currentResidenceId (maintenant chargé depuis Firestore)
      residenceId:        this.currentResidenceId !== null && this.currentResidenceId !== undefined 
                          ? this.currentResidenceId 
                          : null,
    };

    if (type === 'FIXE') {
      basePayload.contrat_id                   = raw.contrat_id;
      basePayload.fournisseur                  = raw.fournisseur;
      basePayload.reconduction_auto            = raw.reconduction_auto;
      basePayload.date_prochain_renouvellement = raw.date_prochain_renouvellement;
      basePayload.conditions_resiliation       = raw.conditions_resiliation;
    } else if (type === 'TRAVAUX') {
      basePayload.date_panne         = raw.date_panne;
      basePayload.urgence            = raw.urgence;
      basePayload.intervenant        = raw.intervenant;
      basePayload.pieces_remplacees  = raw.pieces_remplacees || [];
      basePayload.devis_id           = raw.devis_id;
      basePayload.devis_montant      = raw.devis_montant;
      basePayload.facture_id         = raw.facture_id;
      basePayload.facture_montant    = raw.facture_montant;
      basePayload.duree_intervention = raw.duree_intervention;
      basePayload.garantie_mois      = raw.garantie_mois;
      basePayload.date_intervention  = raw.date_intervention;
      basePayload.photos             = raw.photos || [];
      basePayload.cause_panne        = raw.cause_panne;
    } else if (type === 'VARIABLE') {
      basePayload.compteur_general    = raw.compteur_general;
      basePayload.index_debut         = raw.index_debut;
      basePayload.index_fin           = raw.index_fin;
      basePayload.consommation_totale = raw.consommation_totale;
      basePayload.prix_unitaire       = raw.prix_unitaire;
      basePayload.fournisseur         = raw.fournisseur;
      basePayload.numero_contrat      = raw.numero_contrat;
      basePayload.periode_releve      = raw.periode_releve;
    }

    if (basePayload.date_debut && basePayload.date_fin) {
      try { basePayload.duree_mois = this.monthsBetween(basePayload.date_debut, basePayload.date_fin); }
      catch { /* ignorer */ }
    }

    // ✅ LOG DU PAYLOAD
    console.log('📦 Payload envoyé:', basePayload);

    const userId = this.auth.currentUser?.id ? String(this.auth.currentUser.id) : undefined;

    if (this.editingId()) {
      // ── UPDATE ────────────────────────────────────────────────────────────────
      let updatedCharge: Charge;
      let criticalFieldsChanged: string[] = [];

      try {
        console.log('🔄 Tentative update pour charge:', this.editingId());
        const result = await this.chargeService.update(this.editingId()!, basePayload, userId);
        updatedCharge = result.charge;
        criticalFieldsChanged = result.criticalFieldsChanged;
        console.log('✅ Update réussi:', result);
      } catch (err) {
        console.error('❌ Erreur update détaillée:', err);
        this.addToast('Erreur lors de la mise à jour.', 'error');
        return;
      }

      if (criticalFieldsChanged.length > 0) {
        try { await this.detteService.deleteByCharge(this.editingId()!); }
        catch (err) { console.warn('[Charges] Impossible de supprimer les anciennes dettes:', err); }
        try {
          await this.detteService.createBatchFromCharge(updatedCharge, userId);
          this.addToast(`Dettes régénérées (${criticalFieldsChanged.join(', ')})`, 'info');
        } catch (err) { console.warn('[Charges] Impossible de régénérer les dettes:', err); }
      } else {
        try { await this.detteService.createBatchFromCharge(updatedCharge, userId); }
        catch (err) { console.warn('[Charges] Impossible de compléter les dettes:', err); }
      }

    } else {
      // ── CREATE ────────────────────────────────────────────────────────────────
      let created: Charge;
      try {
        created = await this.chargeService.create(basePayload as ChargePayload);
      } catch (err) {
        console.error('[Charges] Erreur create:', err);
        this.addToast('Erreur lors de la création.', 'error');
        return;
      }

      try { await this.repartitionService.creerRepartition(created, userId); }
      catch (err) { console.warn('[Charges] Impossible de créer la répartition:', err); }

      try { await this.detteService.createBatchFromCharge(created, userId); }
      catch (err) { console.error('[Charges] Erreur génération dettes:', err); }

      this.addToast(`Charge « ${created.libelle} » créée.`, 'success');
    }

    await this.refresh();
    this.closeModal();
  }

  // ==========================================================================
  // ÉDITION
  // ==========================================================================

  edit(charge: ChargeCard) {
    this.editingId.set(charge.id);
    this.showModal.set(true);

    const batimentSelection    = charge.buildingIds?.length  ? 'specific' : 'all';
    const appartementSelection = charge.apartmentIds?.length ? 'specific' : 'all';

    this.form.patchValue({
      type_charge:         charge.type_charge,
      libelle:             charge.libelle,
      description:         charge.description     || '',
      montant:             charge.montant,
      unite_montant:       charge.unite_montant,
      date_debut:          charge.date_debut,
      date_fin:            charge.date_fin         || '',
      duree_mois:          charge.duree_mois,
      frequence:           charge.frequence,
      mode_repartition:    charge.mode_repartition,
      statut:              charge.statut,
      categorie:           charge.categorie,
      scope:               charge.scope,
      batimentSelection,
      batimentIds:         charge.buildingIds      || [],
      floors:              charge.floors           || [],
      appartementSelection,
      appartementIds:      charge.apartmentIds     || [],
      applicable_parking:  charge.applicable_parking || false,
      parkingIds:          charge.parkingIds       || [],
      notes:               charge.notes            || '',
    });

    if (charge.type_charge === 'FIXE') {
      const f = charge as ChargeFixe;
      this.form.patchValue({
        contrat_id: f.contrat_id || '', fournisseur: f.fournisseur || '',
        reconduction_auto: f.reconduction_auto || false,
        date_prochain_renouvellement: f.date_prochain_renouvellement || '',
        conditions_resiliation: f.conditions_resiliation || '',
      });
    } else if (charge.type_charge === 'TRAVAUX') {
      const t = charge as ChargeTravaux;
      this.form.patchValue({
        date_panne: t.date_panne || '', urgence: t.urgence || 'MOYENNE',
        intervenant: t.intervenant || '', pieces_remplacees: t.pieces_remplacees || [],
        devis_id: t.devis_id || '', devis_montant: t.devis_montant || 0,
        facture_id: t.facture_id || '', facture_montant: t.facture_montant || 0,
        duree_intervention: t.duree_intervention || 0, garantie_mois: t.garantie_mois || 0,
        date_intervention: t.date_intervention || '', photos: t.photos || [],
        cause_panne: t.cause_panne || '',
      });
    } else if (charge.type_charge === 'VARIABLE') {
      const v = charge as ChargeVariable;
      this.form.patchValue({
        compteur_general: v.compteur_general || '', index_debut: v.index_debut || 0,
        index_fin: v.index_fin || 0, consommation_totale: v.consommation_totale || 0,
        prix_unitaire: v.prix_unitaire || 0, fournisseur: v.fournisseur || '',
        numero_contrat: v.numero_contrat || '', periode_releve: v.periode_releve || '',
      });
    }

    if (charge.buildingIds?.length) {
      this.updateAvailableEtages(charge.buildingIds);
    }
  }

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  async remove(charge: ChargeCard) {
    if (!window.confirm(`Supprimer "${charge.libelle}" ?`)) return;
    await this.chargeService.remove(charge.id);
    await this.refresh();
    this.addToast(`Charge « ${charge.libelle} » supprimée.`, 'info');
  }

  // ==========================================================================
  // RÉGÉNÉRATION MANUELLE DES DETTES
  // ==========================================================================

  async regenererDettes(charge: ChargeCard) {
    if (this.generatingDettesId()) return;
    this.generatingDettesId.set(charge.id);
    try {
      const fullCharge = await this.chargeService.getById(charge.id);
      if (!fullCharge) { console.error('Charge introuvable:', charge.id); return; }
      const dettes = await this.detteService.createBatchFromCharge(fullCharge);
      const msg = dettes.length
        ? `✅ ${dettes.length} dette(s) générée(s) pour « ${charge.libelle} »`
        : `ℹ️ Toutes les dettes existent déjà pour « ${charge.libelle} »`;
      this.addToast(msg, dettes.length ? 'success' : 'info');
    } catch (err) {
      console.error('Erreur régénération dettes:', err);
      this.addToast('❌ Erreur lors de la génération des dettes.', 'error');
    } finally {
      this.generatingDettesId.set(null);
    }
  }

  // ==========================================================================
  // FILTRES ET HELPERS TEMPLATE
  // ==========================================================================

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onCategoryChange(event: Event) {
    this.selectedCategory.set((event.target as HTMLSelectElement).value);
  }

  onStatusChange(event: Event) {
    this.selectedStatus.set((event.target as HTMLSelectElement).value);
  }

  resetFilters() {
    this.searchTerm.set(''); this.selectedCategory.set(''); this.selectedStatus.set('');
    try {
      (document.querySelector('#searchInput')    as HTMLInputElement  | null)?.value === '';
      (document.querySelector('#categoryFilter') as HTMLSelectElement | null)?.value === '';
      (document.querySelector('#statusFilter')   as HTMLSelectElement | null)?.value === '';
    } catch { /* ignore */ }
  }

  isBatimentSelected(batimentDocId: string): boolean {
    return (this.form.get('batimentIds')?.value || []).includes(batimentDocId);
  }

  isAppartementSelected(appartementDocId: string): boolean {
    return (this.form.get('appartementIds')?.value || []).includes(appartementDocId);
  }

  isFloorSelected(floorNumber: number): boolean {
    return (this.form.get('floors')?.value || []).includes(floorNumber);
  }

  onBatimentChange(event: Event, batimentDocId: string) {
    const checked    = (event.target as HTMLInputElement).checked;
    const currentIds = this.form.get('batimentIds')?.value || [];
    this.form.patchValue({
      batimentIds: checked
        ? [...currentIds, batimentDocId]
        : currentIds.filter((id: string) => id !== batimentDocId),
    });
  }

  onFloorChange(event: Event, floorNumber: number) {
    const checked       = (event.target as HTMLInputElement).checked;
    const currentFloors = this.form.get('floors')?.value || [];
    this.form.patchValue({
      floors: checked
        ? [...currentFloors, floorNumber]
        : currentFloors.filter((n: number) => n !== floorNumber),
    });
  }

  onAppartementChange(event: Event, appartementDocId: string) {
    const checked    = (event.target as HTMLInputElement).checked;
    const currentIds = this.form.get('appartementIds')?.value || [];
    this.form.patchValue({
      appartementIds: checked
        ? [...currentIds, appartementDocId]
        : currentIds.filter((id: string) => id !== appartementDocId),
    });
  }

  onBatimentFilterChange(event: Event): void {
    const batimentDocId = (event.target as HTMLSelectElement).value;
    const all           = this.appartements();
    this.filteredAppartements.set(
      batimentDocId ? all.filter(a => a.batimentDocId === batimentDocId) : all,
    );
  }

  getBatimentName(batimentDocId: string | null): string {
    if (!batimentDocId) return 'N/A';
    return this.batiments().find(b => b.docId === batimentDocId)?.nom || 'N/A';
  }

  formatCurrency(value: number, devise = 'DT') {
    return `${Math.round(value).toLocaleString('fr-TN')} ${devise}`;
  }

  formatEtageLabel(numero: number): string {
    if (numero === 0) return 'RDC';
    if (numero < 0)   return `Sous-sol ${Math.abs(numero)}`;
    return `Étage ${numero}`;
  }

  // ==========================================================================
  // MÉTHODES PRIVÉES
  // ==========================================================================

  private validateForm(): string | null {
    const libelle = this.form.get('libelle');
    const montant = this.form.get('montant');
    const duree   = this.form.get('duree_mois');
    const dateDeb = this.form.get('date_debut')?.value;
    const dateFin = this.form.get('date_fin')?.value;

    if (libelle?.invalid) {
      if (libelle.errors?.['required'])  return 'Le libellé est requis.';
      if (libelle.errors?.['minlength']) return 'Le libellé doit contenir au moins 3 caractères.';
    }
    if (montant?.invalid) {
      if (montant.errors?.['required']) return 'Le montant est requis.';
      if (montant.errors?.['min'])      return 'Le montant doit être ≥ 0.';
    }
    if (duree?.invalid) return 'La durée en mois doit être ≥ 1.';
    if (dateDeb && dateFin) {
      try {
        if (new Date(dateFin).getTime() <= new Date(dateDeb).getTime()) {
          return 'La date de fin doit être strictement postérieure à la date de début.';
        }
      } catch { return 'Format de date invalide.'; }
    }
    return null;
  }

  private updateFormValidators(type: ChargeType) {
    const fieldsToReset = [
      'contrat_id', 'fournisseur', 'date_prochain_renouvellement',
      'date_panne', 'urgence', 'intervenant', 'devis_id',
      'compteur_general', 'prix_unitaire', 'periode_releve',
    ];
    fieldsToReset.forEach(f => {
      this.form.get(f)?.clearValidators();
      this.form.get(f)?.updateValueAndValidity();
    });
    if (type === 'FIXE')     this.form.get('unite_montant')?.setValue('MENSUEL');
    if (type === 'TRAVAUX')  { this.form.get('unite_montant')?.setValue('TOTAL'); this.form.get('frequence')?.setValue('PONCTUELLE'); }
    if (type === 'VARIABLE') this.form.get('mode_repartition')?.setValue('COMPTEUR');
  }

  private resetForm() {
    this.editingId.set(null);
    this.formError.set(null);
    const type: ChargeType = this.activeTab() === 'TOUS' ? 'FIXE' : this.activeTab() as ChargeType;

    this.form.reset({
      type_charge:      type,
      libelle: '', description: '',
      montant: 0,
      unite_montant:    type === 'FIXE' ? 'MENSUEL' : type === 'TRAVAUX' ? 'TOTAL' : 'M3',
      date_debut:       this.todayIso(), date_fin: '',
      duree_mois:       type === 'FIXE' ? 12 : 1,
      frequence:        type === 'TRAVAUX' ? 'PONCTUELLE' : 'MENSUELLE',
      mode_repartition: type === 'VARIABLE' ? 'COMPTEUR' : 'TANTIEMES',
      statut: 'ACTIVE', categorie: 'COURANTE', scope: 'all',
      batimentSelection: 'all', batimentIds: [], floors: [],
      appartementSelection: 'all', appartementIds: [],
      applicable_parking: false, parkingIds: [], notes: '',
      contrat_id: '', fournisseur: '', reconduction_auto: false,
      date_prochain_renouvellement: '', conditions_resiliation: '',
      date_panne: '', urgence: 'MOYENNE', intervenant: '', pieces_remplacees: [],
      devis_id: '', devis_montant: 0, facture_id: '', facture_montant: 0,
      duree_intervention: 0, garantie_mois: 0, date_intervention: '', photos: [], cause_panne: '',
      compteur_general: '', index_debut: 0, index_fin: 0,
      consommation_totale: 0, prix_unitaire: 0, numero_contrat: '', periode_releve: '',
    });
    this.availableEtages.set([]);
  }

  private toCard(charge: Charge): ChargeCard {
    const endDate = charge.date_fin || this.calculateEndDate(charge.date_debut, charge.duree_mois || 1);
    return {
      ...charge,
      endDate,
      rangeLabel:   `${this.formatMonthLabel(charge.date_debut)} → ${this.formatMonthLabel(endDate)}`,
      statusLabel:  STATUT_LABELS[charge.statut],
      urgenceLabel: charge.type_charge === 'TRAVAUX'
        ? URGENCE_LABELS[(charge as ChargeTravaux).urgence || 'MOYENNE']
        : undefined,
    };
  }

  private calculateEndDate(startIso: string, durationMonths: number): string {
    const [year, month] = startIso.split('-').map(Number);
    const start = new Date(year, (month || 1) - 1, 1);
    const end   = new Date(start);
    end.setMonth(start.getMonth() + Math.max(durationMonths, 1) - 1);
    end.setDate(new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate());
    return end.toISOString().slice(0, 10);
  }

  private monthsBetween(startIso: string, endIso: string): number {
    const s = new Date(startIso);
    const e = new Date(endIso);
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }

  private formatMonthLabel(isoDate: string): string {
    return new Date(isoDate)
      .toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
      .replace('.', '');
  }

  private todayIso(): string { return new Date().toISOString().slice(0, 10); }

  private matchesSearch(charge: any): boolean {
    const term = this.searchTerm().toLowerCase();
    if (!term) return true;
    return charge.libelle?.toLowerCase().includes(term) ||
           charge.description?.toLowerCase().includes(term) ||
           charge.fournisseur?.toLowerCase().includes(term);
  }

  private matchesCategory(charge: any): boolean {
    const cat = this.selectedCategory();
    return !cat || charge.categorie === cat;
  }

  private matchesStatus(charge: any): boolean {
    const st = this.selectedStatus();
    return !st || charge.statut === st;
  }
}