import { Paiement } from './../../../models/paiement.model';
import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DetteService } from '../services/dette.service';
import { User, UserService } from '../../coproprietaires/services/coproprietaire.service';
import { AppartementService, Appartement } from '../../appartements/services/appartement.service';
import { ChargeService } from '../../charges/services/charge.service';
import { PaiementService } from '../../paiements/services/paiement.service';
import { Auth } from '../../../core/services/auth';
import {
  Dette,
  DetteStatus,
  DettePriorite,
} from '../../../models/dette.model';

type TabType = 'toutes' | 'impayees' | 'partielles' | 'payees';

interface DetteGroupee {
  id: string;
  appartementId: string;
  coproprietaireId: string;
  annee: number;
  mois: number;
  dettesDetail: Dette[];
  montant_original_total: number;
  montant_paye_total: number;
  montant_restant_total: number;
  statut: DetteStatus;
  priorite: DettePriorite;
  date_echeance: string;
  nb_relances: number;
}

interface VueCoproprietaire {
  coproprietaireId: string;
  appartementId: string;
  groupes: DetteGroupee[];
  arrieresAnneePrec: number;
  courantAnneeCourante: number;
  totalDu: number;
  statut: DetteStatus;
  priorite: DettePriorite;
}

@Component({
  selector: 'app-dettes',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './dette.component.html',
  styleUrls: ['./dette.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DettesComponent implements OnInit {

  readonly anneeCourante = new Date().getFullYear();

  // ── Données brutes ──────────────────────────────────────────────────────────
  readonly dettes       = signal<Dette[]>([]);
  readonly users        = signal<User[]>([]);
  readonly loading      = signal(true);
  readonly saving       = signal(false);

  readonly usersMapByUid           = signal<Map<string, User>>(new Map());
  readonly usersMapById            = signal<Map<string, User>>(new Map());
  readonly usersMapByEmail         = signal<Map<string, User>>(new Map());
  readonly usersMapByAppartementId = signal<Map<string, User>>(new Map());
  readonly usersMapByLot           = signal<Map<string, User>>(new Map());
  readonly apptMapById             = signal<Map<string, Appartement>>(new Map());
  readonly chargesMap      = signal<Map<string, string>>(new Map());

  // ── États UI ──────────────────────────────────────────────────────────────
  readonly selectedTab    = signal<TabType>('toutes');
  readonly searchTerm     = signal('');
  readonly selectedAnnee  = signal<number | 'toutes'>('toutes');
  readonly selectedCoproprietaire = signal<string | 'tous'>('tous');

  // ── Pagination ────────────────────────────────────────────────────────────
  readonly pageSize    = signal(10);
  readonly pageCurrent = signal(1);

  // ── Modals ────────────────────────────────────────────────────────────────
  readonly showGroupeModal  = signal(false);
  readonly showEditModal    = signal(false);
  readonly showRelanceModal = signal(false);
  readonly selectedVue      = signal<VueCoproprietaire | null>(null);
  readonly editingDette     = signal<Dette | null>(null);

  constructor(
    private readonly detteService:       DetteService,
    private readonly userService:        UserService,
    private readonly appartementService: AppartementService,
    private readonly chargeService:      ChargeService,
    private readonly paiementService:    PaiementService,
    private readonly auth:               Auth,
  ) {}

  async ngOnInit() { await this.loadData(); }

  // ── Chargement ─────────────────────────────────────────────────────────────

  private async loadData() {
    this.loading.set(true);
    try {
      console.log('🔍 Tentative de chargement des dettes...');
      
      const [dettes, users, appartements, charges] = await Promise.all([
        this.detteService.getAll(true, this.auth.currentUser as any),
        this.loadUsers(),
        this.appartementService.loadAppartements(),
        this.chargeService.list(),
      ]);

      console.log('📊 Résultats:', {
        dettesLength: dettes.length,
        usersLength: users.length,
        appartementsLength: appartements.length,
        chargesLength: charges.length
      });

      // Afficher un exemple de dette pour voir la structure
      if (dettes.length > 0) {
        console.log('🔍 Exemple de dette:', dettes[0]);
        console.log('🔍 coproprietaireId exemple:', dettes[0].coproprietaireId);
      }

      // Afficher un exemple d'utilisateur
      if (users.length > 0) {
        console.log('🔍 Exemple utilisateur:', users[0]);
        console.log('🔍 UID utilisateur exemple:', users[0].firebaseUid || users[0].id);
      }

      // Maps pour les utilisateurs
      const byUid    = new Map<string, User>();
      const byId     = new Map<string, User>();
      const byEmail  = new Map<string, User>();
      const byApptId = new Map<string, User>();
      const byLot    = new Map<string, User>();
      
      for (const u of users) {
        if (u.firebaseUid) byUid.set(u.firebaseUid, u);
        if (u.id)          byId.set(String(u.id), u);
        if (u.email)       byEmail.set(u.email.toLowerCase(), u);
        if ((u as any).appartementId) byApptId.set(String((u as any).appartementId), u);
        if ((u as any).lot)           byLot.set(String((u as any).lot), u);
      }
      
      this.usersMapByUid.set(byUid);
      this.usersMapById.set(byId);
      this.usersMapByEmail.set(byEmail);
      this.usersMapByAppartementId.set(byApptId);
      this.usersMapByLot.set(byLot);
      this.users.set(users);

      // Map des appartements
      const apptMap = new Map<string, Appartement>();
      for (const a of appartements) { 
        if (a.docId) apptMap.set(a.docId, a); 
      }
      this.apptMapById.set(apptMap);

      // Map des charges
      const chargeMap = new Map<string, string>();
      for (const c of charges) chargeMap.set(c.id, c.libelle);
      this.chargesMap.set(chargeMap);

      // Tenter d'inférer en mémoire les `appartementId` manquants depuis la map des appartements
      const dettesAvecAppart = this.infererAppartementIdPourDettes(dettes);
      const dettesFiltrees     = this.filtrerDettesSansAppartement(dettesAvecAppart);
      const dettesNormalisees  = this.enrichirDettesAvecCoproprietaire(dettesFiltrees);
      this.dettes.set(dettesNormalisees);
      
      // Vérifier la construction des vues
      console.log('🔍 Vues copropriétaires construites:', this.vuesCoproprietaires().length);
      if (this.vuesCoproprietaires().length > 0) {
        console.log('🔍 Première vue:', this.vuesCoproprietaires()[0]);
      } else {
        console.warn('⚠️ Aucune vue construite. Vérifiez la correspondance des IDs.');
        
        // Afficher les IDs des dettes pour déboguer
        const dettesAvecId = dettes.filter(d => d.coproprietaireId && d.coproprietaireId !== '');
        console.log(`📊 Dettes avec coproprietaireId: ${dettesAvecId.length}/${dettes.length}`);
        
        if (dettesAvecId.length === 0) {
          console.warn('⚠️ Toutes les dettes ont coproprietaireId vide !');
          console.log('🔍 Solution temporaire : utilisation de la map des appartements pour associer');
        }
      }

    } catch (e) {
      console.error('❌ Erreur chargement dettes:', e);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUsers(): Promise<User[]> {
    try {
      const fs = await this.userService.loadFromFirestore?.();
      if (fs?.length) return fs;
    } catch { /* ignore */ }
    return this.userService.getAll();
  }

  // ── Computed: groupes de dettes ────────────────────────────────────────────

  readonly dettesGroupees = computed<DetteGroupee[]>(() => {
    const map = new Map<string, DetteGroupee>();

    for (const d of this.dettes()) {
      // S'assurer que l'appartementId existe
      if (!d.appartementId) {
        console.warn('⚠️ Dette sans appartementId:', d);
        continue;
      }

      const coproId = this.resolveCoproprietaireId(d);
      const cle = `${d.appartementId}|${d.annee}|${d.mois}`;
      if (!map.has(cle)) {
        map.set(cle, {
          id: cle,
          appartementId: d.appartementId,
          coproprietaireId: coproId,
          annee: d.annee,
          mois: d.mois,
          dettesDetail: [],
          montant_original_total: 0,
          montant_paye_total: 0,
          montant_restant_total: 0,
          statut: 'PAYEE',
          priorite: 'FAIBLE',
          date_echeance: d.date_echeance,
          nb_relances: 0,
        });
      }
      const g = map.get(cle)!;
      g.dettesDetail.push(d);
      g.montant_original_total += d.montant_original;
      g.montant_paye_total     += d.montant_paye;
      g.montant_restant_total  += d.montant_restant;
      g.nb_relances            += d.nb_relances || 0;
      g.statut   = this.worstStatus(g.statut, d.statut);
      g.priorite = this.highestPriority(g.priorite, d.priorite);
      
      // Mettre à jour coproprietaireId si nécessaire (prendre le premier non vide)
      if (!g.coproprietaireId || g.coproprietaireId === 'inconnu') {
        g.coproprietaireId = coproId;
      }
    }

    const result = Array.from(map.values())
      .sort((a, b) => (b.annee - a.annee) || (b.mois - a.mois));
    
    console.log(`🔍 ${result.length} groupes de dettes créés`);
    return result;
  });

  readonly vuesCoproprietaires = computed<VueCoproprietaire[]>(() => {
    const map = new Map<string, VueCoproprietaire>();

    for (const g of this.dettesGroupees()) {
      // Utiliser l'appartementId comme clé si coproprietaireId est vide
      let key = `${g.coproprietaireId}|${g.appartementId}`;
      
      // Si pas de coproprietaireId, utiliser seulement l'appartementId
      if (!g.coproprietaireId || g.coproprietaireId === '' || g.coproprietaireId === 'inconnu') {
        key = `appt_${g.appartementId}`;
      }
      
      if (!map.has(key)) {
        map.set(key, {
          coproprietaireId: g.coproprietaireId || 'inconnu',
          appartementId: g.appartementId,
          groupes: [],
          arrieresAnneePrec: 0,
          courantAnneeCourante: 0,
          totalDu: 0,
          statut: 'PAYEE',
          priorite: 'FAIBLE',
        });
      }
      const vue = map.get(key)!;
      vue.groupes.push(g);
      vue.totalDu += g.montant_restant_total;
      if (g.annee < this.anneeCourante) {
        vue.arrieresAnneePrec += g.montant_restant_total;
      } else {
        vue.courantAnneeCourante += g.montant_restant_total;
      }
      vue.statut   = this.worstStatus(vue.statut, g.statut);
      vue.priorite = this.highestPriority(vue.priorite, g.priorite);
    }

    const result = Array.from(map.values())
      // N'afficher que les appartements qui ont un utilisateur lié
      .filter(vue => {
        // Vérifier si un utilisateur est associé à cet appartement
        const hasUser =
          this.usersMapByAppartementId().has(vue.appartementId) ||
          (vue.coproprietaireId && vue.coproprietaireId !== 'inconnu' && vue.coproprietaireId !== '') ||
          (() => {
            const appt = this.apptMapById().get(vue.appartementId);
            if (!appt) return false;
            return !!(appt.proprietaireId || appt.locataireId) ||
                   this.usersMapByLot().has(appt.numero);
          })();
        return hasUser;
      })
      .sort((a, b) => b.totalDu - a.totalDu);
    
    console.log(`🔍 ${result.length} vues copropriétaires créées`);
    return result;
  });

  readonly filteredVues = computed<VueCoproprietaire[]>(() => {
    let vues = this.vuesCoproprietaires();

    switch (this.selectedTab()) {
      case 'impayees':   vues = vues.filter(v => v.statut === 'IMPAYEE'); break;
      case 'partielles': vues = vues.filter(v => v.statut === 'PARTIELLEMENT_PAYEE'); break;
      case 'payees':     vues = vues.filter(v => v.statut === 'PAYEE'); break;
    }

    const term = this.searchTerm().toLowerCase().trim();
    if (term) {
      vues = vues.filter(v =>
        this.getUserLabel(v.coproprietaireId).toLowerCase().includes(term) ||
        this.getAppartementLabel(v.appartementId).toLowerCase().includes(term)
      );
    }

    if (this.selectedAnnee() !== 'toutes') {
      const annee = this.selectedAnnee() as number;
      vues = vues.filter(v => v.groupes.some(g => g.annee === annee));
    }

    if (this.selectedCoproprietaire() !== 'tous') {
      const target = this.selectedCoproprietaire();
      vues = vues.filter(v => this.matchesUserId(v.coproprietaireId, target));
    }

    console.log(`🔍 ${vues.length} vues après filtres`);
    return vues;
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredVues().length / this.pageSize()))
  );

  readonly pageNumbers = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.pageCurrent();
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end   = Math.min(total, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  readonly pagedVues = computed<VueCoproprietaire[]>(() => {
    const start = (this.pageCurrent() - 1) * this.pageSize();
    return this.filteredVues().slice(start, start + this.pageSize());
  });

  readonly firstIndexOnPage = computed(() =>
    this.filteredVues().length === 0 ? 0 : (this.pageCurrent() - 1) * this.pageSize() + 1
  );

  readonly lastIndexOnPage = computed(() =>
    Math.min(this.pageCurrent() * this.pageSize(), this.filteredVues().length)
  );

  // ── KPIs ───────────────────────────────────────────────────────────────────

  readonly anneesDisponibles = computed(() => {
    const s = new Set<number>();
    this.dettes().forEach(d => s.add(d.annee));
    return Array.from(s).sort((a, b) => b - a);
  });

  readonly kpiArrieresAnneePrec = computed(() =>
    this.vuesCoproprietaires().reduce((s, v) => s + v.arrieresAnneePrec, 0)
  );

  readonly kpiCourantAnneeCourante = computed(() =>
    this.vuesCoproprietaires().reduce((s, v) => s + v.courantAnneeCourante, 0)
  );

  readonly kpiTotalDu = computed(() =>
    this.vuesCoproprietaires().reduce((s, v) => s + v.totalDu, 0)
  );

  readonly kpiTauxRecouvrement = computed(() => {
    const groupes = this.dettesGroupees();
    const totalOrig = groupes.reduce((s, g) => s + g.montant_original_total, 0);
    const totalPaye = groupes.reduce((s, g) => s + g.montant_paye_total, 0);
    return totalOrig ? Math.round((totalPaye / totalOrig) * 100) : 0;
  });

  readonly dettesImpayeesCount   = computed(() => this.vuesCoproprietaires().filter(v => v.statut === 'IMPAYEE').length);
  readonly dettesPartiellesCount = computed(() => this.vuesCoproprietaires().filter(v => v.statut === 'PARTIELLEMENT_PAYEE').length);
  readonly dettesPayeesCount     = computed(() => this.vuesCoproprietaires().filter(v => v.statut === 'PAYEE').length);

  readonly pageTotalArrieresPrec = computed(() =>
    this.pagedVues().reduce((s, v) => s + v.arrieresAnneePrec, 0)
  );

  readonly pageTotalCourant = computed(() =>
    this.pagedVues().reduce((s, v) => s + v.courantAnneeCourante, 0)
  );

  readonly pageTotalDu = computed(() =>
    this.pagedVues().reduce((s, v) => s + v.totalDu, 0)
  );

  // ── Formulaires ───────────────────────────────────────────────────────────
  readonly editForm = new FormGroup({
    montant_paye:  new FormControl<number>(0, [Validators.required, Validators.min(0.01)]),
    date_paiement: new FormControl(this.todayIso(), Validators.required),
    mode_paiement: new FormControl('carte', Validators.required),
    reference:     new FormControl(''),
    notes:         new FormControl(''),
  });

  readonly relanceForm = new FormGroup({
    message:       new FormControl('', Validators.required),
    envoyer_email: new FormControl(true),
    envoyer_sms:   new FormControl(false),
  });

  // ── Lookup ─────────────────────────────────────────────────────────────────

  getUser(id: string): User | undefined {
    if (!id || id === 'inconnu') return undefined;
    return this.usersMapByUid().get(id) ||
           this.usersMapById().get(id) ||
           this.usersMapByEmail().get(id.toLowerCase());
  }

  /** Résout le nom d'affichage d'une VueCoproprietaire en utilisant toutes les sources disponibles */
  getVueCoproNom(vue: VueCoproprietaire): string {
    const resolveName = (u: User) =>
      u.name || u.fullname || (u as any).displayName || (u as any).username || u.email || '';

    // 1. Essayer via coproprietaireId (Firebase UID ou ID doc)
    const viaId = this.getUserLabel(vue.coproprietaireId);
    if (!viaId.startsWith('ID:') && viaId !== 'Propriétaire non assigné') return viaId;

    // 2. Recherche inversée : user.appartementId === vue.appartementId (docId)
    const byApptDocId = this.usersMapByAppartementId().get(vue.appartementId);
    if (byApptDocId) { const n = resolveName(byApptDocId); if (n) return n; }

    // 3. Recherche via appt.numero : user.lot === appt.numero  (même logique que le tableau paiements)
    const appt = this.apptMapById().get(vue.appartementId);
    if (appt?.numero) {
      const byLot = this.usersMapByLot().get(appt.numero);
      if (byLot) { const n = resolveName(byLot); if (n) return n; }

      // 4. user.appartementId stocke le numéro (pas le docId)
      const byApptNum = this.usersMapByAppartementId().get(appt.numero);
      if (byApptNum) { const n = resolveName(byApptNum); if (n) return n; }

      // 5. Recherche linéaire par lot ou numéro (dernier recours avant fallback générique)
      const match = this.users().find((u: any) =>
        u.lot === appt.numero || String(u.appartementId) === appt.numero
      );
      if (match) { const n = resolveName(match); if (n) return n; }
    }

    // 6. Fallback gracieux : numéro d'appartement
    if (appt) return `Propriétaire ${appt.numero}`;
    return 'Propriétaire inconnu';
  }

  getVueCoproInitiales(vue: VueCoproprietaire): string {
    const nom = this.getVueCoproNom(vue);
    if (!nom || nom === 'Propriétaire inconnu') return '?';
    return nom.split(' ').filter(p => p).map(p => p[0]).join('').substring(0, 2).toUpperCase();
  }

  getVueCoproEmail(vue: VueCoproprietaire): string {
    const appt = this.apptMapById().get(vue.appartementId);
    const u = this.getUser(vue.coproprietaireId) ||
              this.usersMapByAppartementId().get(vue.appartementId) ||
              (appt?.numero ? this.usersMapByLot().get(appt.numero) : undefined) ||
              this.users().find((u: any) => appt?.numero && (u.lot === appt.numero || String(u.appartementId) === appt.numero));
    return u?.email || '';
  }

  getUserLabel(id: string): string {
    if (!id || id === 'inconnu') {
      return 'Propriétaire non assigné';
    }
    const u = this.getUser(id);
    if (u) return u.name || u.fullname || (u as any).displayName || (u as any).username || u.email || id;

    // Recherche inversée : user.appartementId === id
    const byAppt = this.usersMapByAppartementId().get(id);
    if (byAppt) return byAppt.name || byAppt.fullname || (byAppt as any).displayName || (byAppt as any).username || byAppt.email || id;

    // Si l'ID est un appartementId, essayer via proprietaireId puis recherche inversée
    const appt = this.apptMapById().get(id);
    if (appt) {
      const ownerId = appt.proprietaireId || appt.locataireId;
      if (ownerId) {
        const owner = this.getUser(String(ownerId)) ||
                      this.usersMapByAppartementId().get(String(ownerId));
        if (owner) return owner.name || owner.fullname || (owner as any).displayName || (owner as any).username || owner.email || String(ownerId);
      }
      // Fallback gracieux : numéro d'appartement
      return `Propriétaire ${appt.numero}`;
    }

    // Dernier recours : ID tronqué
    return `ID: ${id.substring(0, 8)}...`;
  }

  getUserInitiales(id: string): string {
    if (!id || id === 'inconnu') return '??';
    const label = this.getUserLabel(id);
    if (label.startsWith('ID:') || label === 'Propriétaire non assigné') return '??';
    return label.split(' ').filter(p => p).map(p => p[0]).join('').substring(0, 2).toUpperCase();
  }

  getAppartement(id: string): Appartement | undefined {
    return this.apptMapById().get(id);
  }

  getAppartementLabel(id: string): string {
    if (!id) return 'Appartement inconnu';
    const a = this.getAppartement(id);
    return a ? `Appt. ${a.numero}` : `ID: ${id.substring(0, 8)}...`;
  }

  getChargeLabel(id: string): string {
    return this.chargesMap().get(id) ?? id;
  }

  // ── Filtres & Navigation ───────────────────────────────────────────────────

  setTab(tab: TabType) {
    this.selectedTab.set(tab);
    this.pageCurrent.set(1);
  }

  onSearch(e: Event) {
    this.searchTerm.set((e.target as HTMLInputElement).value);
    this.pageCurrent.set(1);
  }

  clearSearch() { 
    this.searchTerm.set(''); 
    this.pageCurrent.set(1); 
  }

  setAnneeFilter(a: number | 'toutes') {
    this.selectedAnnee.set(a);
    this.pageCurrent.set(1);
  }

  setCoproprietaireFilter(id: string | 'tous') {
    this.selectedCoproprietaire.set(id);
    this.pageCurrent.set(1);
  }

  resetFilters() {
    this.searchTerm.set('');
    this.selectedTab.set('toutes');
    this.selectedAnnee.set('toutes');
    this.selectedCoproprietaire.set('tous');
    this.pageCurrent.set(1);
  }

  goToPage(p: number) {
    if (p >= 1 && p <= this.totalPages()) this.pageCurrent.set(p);
  }

  prevPage() { this.goToPage(this.pageCurrent() - 1); }
  nextPage() { this.goToPage(this.pageCurrent() + 1); }

  private matchesUserId(detteUserId: string, filterId: string): boolean {
    if (detteUserId === filterId) return true;
    const u = this.getUser(detteUserId);
    return !!u && (u.firebaseUid === filterId || String(u.id) === filterId);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  ouvrirDetailVue(vue: VueCoproprietaire) {
    this.selectedVue.set(vue);
    this.showGroupeModal.set(true);
  }

  openEdit(dette: Dette) {
    console.log('💰 Ouverture modal édition pour dette:', dette);
    this.editingDette.set(dette);
    this.editForm.patchValue({
      montant_paye: dette.montant_restant,
      date_paiement: this.todayIso(),
      mode_paiement: 'carte',
      reference: this.generateReference(),
      notes: `Paiement pour ${this.formatPeriode(dette.annee, dette.mois)}`,
    });
    this.showEditModal.set(true);
  }

  async savePayment() {
    if (!this.editForm.valid || !this.editingDette()) {
      console.warn('⚠️ Formulaire invalide ou dette non sélectionnée');
      return;
    }

    const dette = this.editingDette()!;
    const formValues = this.editForm.value;
    const montantPaye = Number(formValues.montant_paye) || 0;

    if (montantPaye <= 0 || montantPaye > dette.montant_restant) {
      alert(`Le montant doit être entre 0.01 et ${dette.montant_restant} DT`);
      return;
    }

    this.saving.set(true);

    try {
      const coproId = this.resolveCoproprietaireId(dette);
      console.log(`💰 Enregistrement paiement de ${montantPaye} DT pour dette ${dette.id} (copro: ${coproId})`);

      // 1. Créer le paiement en 'pending' pour éviter l'affectation automatique
      const paiement = await this.paiementService.create({
        appartementId: dette.appartementId,
        coproprietaireId: coproId,
        amount: montantPaye,
        datePaiement: formValues.date_paiement || this.todayIso(),
        modePaiement: formValues.mode_paiement as any,
        reference: formValues.reference || this.generateReference(),
        status: 'pending',
        label: `Paiement ${this.formatPeriode(dette.annee, dette.mois)}`,
        mois: dette.mois,
        annee: dette.annee,
        notes: formValues.notes || undefined,
      });

      console.log('✅ Paiement créé:', paiement);

      // 2. Affecter le montant directement à la dette par son ID
      const detteMaj = await this.detteService.affecterPaiement(
        dette.id,
        montantPaye,
        paiement.docId!,
      );

      console.log('✅ Dette mise à jour:', detteMaj);

      // 3. Marquer le paiement comme 'paid'
      await this.paiementService.update(paiement.docId!, { status: 'paid' });

      await this.loadData();
      this.closeModals();
      alert(`✅ Paiement de ${montantPaye} DT enregistré avec succès`);

    } catch (err) {
      console.error('❌ Erreur lors du paiement:', err);
      alert('Erreur lors de l\'enregistrement du paiement');
    } finally {
      this.saving.set(false);
    }
  }

  openRelanceVue(vue: VueCoproprietaire) {
    const dettesCandidates = vue.groupes.flatMap(g => g.dettesDetail)
      .filter(d => d.statut !== 'PAYEE');
    
    if (!dettesCandidates.length) return;
    
    const dette = dettesCandidates.sort((a, b) => (a.annee - b.annee) || (a.mois - b.mois))[0];
    this.setupRelanceMessage(dette);
    this.showRelanceModal.set(true);
  }

  async sendRelance() {
    if (!this.relanceForm.valid) return;
    
    try {
      console.log('📧 Envoi relance:', this.relanceForm.value);
      this.closeModals();
      alert('✅ Relance envoyée avec succès');
    } catch (err) {
      console.error('❌ Erreur envoi relance:', err);
    }
  }

  async marquerVuePayee(vue: VueCoproprietaire) {
    const total = vue.totalDu;
    if (!confirm(`Marquer toutes les dettes de ${this.formatMontant(total)} comme payées ?`)) return;

    this.saving.set(true);
    
    try {
      const dettes = vue.groupes.flatMap(g => g.dettesDetail);
      
      for (const dette of dettes) {
        if (dette.statut !== 'PAYEE') {
          await this.detteService.marquerCommeSoldee(dette.id);
        }
      }
      
      await this.loadData();
      this.closeModals();
      alert(`✅ ${dettes.length} dette(s) marquée(s) comme payée(s)`);
      
    } catch (err) {
      console.error('❌ Erreur:', err);
      alert('Erreur lors du marquage des dettes');
    } finally {
      this.saving.set(false);
    }
  }

  closeModals() {
    this.showGroupeModal.set(false);
    this.showEditModal.set(false);
    this.showRelanceModal.set(false);
    this.selectedVue.set(null);
    this.editingDette.set(null);
    this.editForm.reset();
  }

  // ── Utilitaires ─────────────────────────────────────────────────────────────

  private resolveCoproprietaireId(dette: Dette): string {
    const direct = (dette.coproprietaireId || '').trim();
    if (direct && !direct.startsWith('appt_')) return direct;

    const appt = dette.appartementId ? this.apptMapById().get(dette.appartementId) : undefined;
    const fallback = appt?.proprietaireId || appt?.locataireId;

    if (fallback) {
      console.warn(`⚠️ Dette ${dette.id} sans coproprietaireId, fallback vers ${fallback} (appartement ${dette.appartementId})`);
      return String(fallback);
    }

    return 'inconnu';
  }

  private worstStatus(a: DetteStatus, b: DetteStatus): DetteStatus {
    const order: DetteStatus[] = ['IMPAYEE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'ANNULEE'];
    return order.indexOf(a) <= order.indexOf(b) ? a : b;
  }

  private highestPriority(a: DettePriorite, b: DettePriorite): DettePriorite {
    const order: DettePriorite[] = ['URGENTE', 'NORMALE', 'FAIBLE'];
    return order.indexOf(a) <= order.indexOf(b) ? a : b;
  }

  getStatusLabel(s: DetteStatus): string {
    const labels: Record<DetteStatus, string> = {
      IMPAYEE: 'Impayé',
      PARTIELLEMENT_PAYEE: 'Partiel',
      PAYEE: 'À jour',
      ANNULEE: 'Annulé'
    };
    return labels[s] || s;
  }

  getStatusClasses(s: DetteStatus): string {
    const classes: Record<DetteStatus, string> = {
      IMPAYEE: 'bg-red-100 text-red-800',
      PARTIELLEMENT_PAYEE: 'bg-amber-100 text-amber-800',
      PAYEE: 'bg-emerald-100 text-emerald-800',
      ANNULEE: 'bg-slate-100 text-slate-600',
    };
    return classes[s] || 'bg-slate-100 text-slate-600';
  }

  isHighArrears(vue: VueCoproprietaire): boolean {
    return vue.arrieresAnneePrec > 0;
  }

  isCritical(vue: VueCoproprietaire): boolean {
    return vue.priorite === 'URGENTE';
  }

  formatMontant(m: number): string {
    return (m || 0).toLocaleString('fr-TN', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }) + ' DT';
  }

  formatPeriode(annee: number, mois: number): string {
    const date = new Date(annee, mois - 1, 1);
    return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  formatDate(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  }

  private todayIso(): string {
    return new Date().toISOString().split('T')[0];
  }

  private generateReference(): string {
    return `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  /**
   * Écarte les dettes qui n'ont pas d'appartementId (données invalides)
   * et journalise combien ont été ignorées pour alerter.
   */
  private filtrerDettesSansAppartement(dettes: Dette[]): Dette[] {
    const valides = dettes.filter(d => d.appartementId && d.appartementId.trim() !== '');
    const ignores = dettes.length - valides.length;
    if (ignores > 0) {
      console.warn(`⚠️ ${ignores} dette(s) ignorée(s) car sans appartementId`);
    }
    return valides;
  }

  /**
   * Essaye d'inférer en mémoire l'appartementId des dettes qui en sont dépourvues
   * en recherchant un appartement dont le proprietaireId/locataireId correspond au coproprietaireId.
   * Ne modifie rien en base, journalise les inférences automatiques.
   */
  private infererAppartementIdPourDettes(dettes: Dette[]): Dette[] {
    if (!this.apptMapById().size) return dettes;

    const appartements = Array.from(this.apptMapById().values());

    return dettes.map(d => {
      if (d.appartementId && d.appartementId.trim() !== '') return d;
      if (!d.coproprietaireId || d.coproprietaireId.trim() === '') return d;

      const candidats = appartements.filter(a =>
        String(a.proprietaireId) === String(d.coproprietaireId) ||
        String(a.locataireId) === String(d.coproprietaireId)
      );

      if (candidats.length === 1 && candidats[0].docId) {
        console.warn(`⚠️ Dette ${d.id}: appartementId absent — inféré en mémoire vers ${candidats[0].docId}`);
        return { ...d, appartementId: candidats[0].docId };
      }

      return d;
    });
  }

  /**
   * Enrichit les dettes avec un coproprietaireId si manquant, en se basant sur l'appartement
   * (proprietaireId puis locataireId). N'écrit rien en base, uniquement en mémoire pour l'affichage.
   */
  private enrichirDettesAvecCoproprietaire(dettes: Dette[]): Dette[] {
    if (!this.apptMapById().size) return dettes;

    return dettes.map(d => {
      if (d.coproprietaireId && d.coproprietaireId.trim() !== '') return d;
      const appt = d.appartementId ? this.apptMapById().get(d.appartementId) : undefined;
      const fallback = appt?.proprietaireId || appt?.locataireId;
      if (!fallback) return d;
      console.warn(`⚠️ Dette ${d.id} enrichie en mémoire avec copro ${fallback} (appartement ${d.appartementId})`);
      return { ...d, coproprietaireId: String(fallback) };
    });
  }

  private setupRelanceMessage(dette?: Dette) {
    const u = dette ? this.getUser(dette.coproprietaireId) : null;
    const destinataire = u?.name || 'Propriétaire';
    this.relanceForm.patchValue({
      message: `Objet: Relance de paiement - Charges de copropriété

Bonjour ${destinataire},

Nous n'avons pas reçu votre paiement de ${dette ? this.formatMontant(dette.montant_restant) : '[MONTANT]'} pour la période ${dette ? this.formatPeriode(dette.annee, dette.mois) : '[PÉRIODE]'}.

Merci de régulariser votre situation dans les plus brefs délais.

Cordialement,
Le syndic`,
    });
  }
}