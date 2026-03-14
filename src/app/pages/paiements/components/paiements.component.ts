import {
  ChangeDetectionStrategy, Component, OnInit, OnDestroy,
  computed, signal, inject, effect
} from '@angular/core';
import { PaginationService } from '../../../shared/services/pagination.service';
import { CommonModule } from '@angular/common';
import {
  FormsModule, ReactiveFormsModule,
  FormGroup, FormControl, Validators
} from '@angular/forms';
import { RouterModule } from '@angular/router';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../../../../environments/firebase';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { Charge } from '../../../models/charge.model';
import { ChargeService } from '../../charges/services/charge.service';
import { PaiementService, PaymentMode } from '../services/paiement.service';
import { PaiementAffectationService } from '../services/paiement-affectation.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { AppartementService, Appartement } from '../../appartements/services/appartement.service';
import { CalculMensuelService } from '../services/calcul-mensuel.service';
import { DetteService } from '../../dette/services/dette.service';
import { Dette } from '../../../models/dette.model';
import { RecuService, RecuData } from '../services/recu.service';
import { AlerteService } from '../../notifications/services/alerte.service';
import { Auth } from '../../../core/services/auth';

type CellStatus = 'paid' | 'unpaid' | 'late' | 'partial';

interface MonthColumn { key: string; label: string; }

interface PaymentCell {
  status: CellStatus;
  amount: number;
  paidAmount?: number;
  date?: string;
  dueDate?: string;
  modePaiement?: string;
  reference?: string;
  recuUrl?: string;
  paymentId?: string; // ID du paiement Firestore
}

interface ApartmentRow {
  id: string;           // appartementId Firestore (docId)
  batiment?: string;
  floor: string;
  apartment: string;   // numéro affiché
  owner: string;
  ownerId?: string;    // ID du propriétaire
  locataire?: string;
  phone: string;
  email?: string;
  hasParking: boolean;
  hasAscenseur?: boolean;
  baseCharge: number;
  ancien?: number;
  payments: Record<string, PaymentCell>;
}

interface ExpenseCard { label: string; amount: number; month: string; color: string; }
interface ToastMsg   { id: number; type: 'success' | 'error' | 'info'; message: string; }

@Component({
  selector: 'app-paiements',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './paiements.component.html',
  styleUrls: ['./paiements.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaiementsComponent implements OnInit {

  private readonly startDate  = new Date(2025, 0, 1);
  private readonly monthCount = 14;
  private readonly parkingExtra = 25;
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly currentYear = new Date().getFullYear();
  private isResidenceAdmin = false;
  private currentResidenceId: string | null = null;

  constructor(
    private readonly chargeService:      ChargeService,
    private readonly paiementService:    PaiementService,
    private readonly affectationService: PaiementAffectationService,
    private readonly userService:        UserService,
    private readonly appartementService: AppartementService,
    private readonly calculMensuelService: CalculMensuelService,
    private readonly detteService:       DetteService,
    private readonly alerteService:     AlerteService,
    private readonly recuService:       RecuService,
    private readonly auth:              Auth,
    public readonly pagination: PaginationService<ApartmentRow>
  ) {}

  // Event handler reference for removal
  private montantsUpdatedHandler = () => { this.refreshData(); };

  readonly months = this.buildMonths();
  readonly selectedYear = signal<string>('');
  readonly selectedMonth = signal<string | null>(null);
  // month selected for edit modal (stores full key 'YYYY-MM')
  readonly editSelectedMonth = signal<string | null>(null);

  // Options for month filter (month number only)
  readonly monthOptions = [
    { value: '01', label: 'Janv' },
    { value: '02', label: 'Févr' },
    { value: '03', label: 'Mars' },
    { value: '04', label: 'Avr' },
    { value: '05', label: 'Mai' },
    { value: '06', label: 'Juin' },
    { value: '07', label: 'Juil' },
    { value: '08', label: 'Août' },
    { value: '09', label: 'Sept' },
    { value: '10', label: 'Oct' },
    { value: '11', label: 'Nov' },
    { value: '12', label: 'Déc' },
  ];

  readonly years = computed(() => {
    // unique years from months
    return Array.from(new Set(this.months.map(m => m.key.split('-')[0]))).sort();
  });

  readonly monthsForYear = computed(() => {
    const y = this.selectedYear();
    return y ? this.months.filter(m => m.key.startsWith(y + '-')) : this.months;
  });

  /** Columns to display based on selected year/month */
  readonly visibleMonths = computed(() => {
    const selMonth = this.selectedMonth(); // 'MM' or null
    const selYear = this.selectedYear();   // 'YYYY' or ''
    if (selMonth) {
      // If a year is also selected, show that exact year-month; otherwise show this month across all years
      if (selYear) return this.months.filter(m => m.key === `${selYear}-${selMonth}`);
      return this.months.filter(m => m.key.endsWith(`-${selMonth}`));
    }
    if (selYear) {
      return this.months.filter(m => m.key.startsWith(selYear + '-'));
    }
    return this.months;
  });

  // Signaux
  readonly rows           = signal<ApartmentRow[]>([]);
  readonly search         = signal('');
  readonly statusFilter   = signal<'all' | 'late' | 'up_to_date'>('all');
  readonly activeDetail   = signal<string | null>(null);
  readonly activeAction   = signal<'detail' | 'edit' | 'relance' | 'recu' | null>(null);
  readonly toasts         = signal<ToastMsg[]>([]);
  readonly selectedRowId  = signal<string | null>(null);
  readonly charges        = signal<Charge[]>([]);
  readonly expenses       = signal<ExpenseCard[]>([]);
  readonly showDetailModal  = signal(false);
  readonly showEditModal    = signal(false);
  readonly showRelanceModal = signal(false);
  readonly showRecuModal    = signal(false);
  readonly generatingPdf     = signal(false);
  readonly sendingRelance    = signal(false);
  readonly selectedPayment  = signal<any>(null);
  // `selectedMonth` already declared above (used for year/month filters)
  readonly activeActionMenu = signal<string | null>(null);
  readonly showFullDetailModal = signal(false);
  readonly selectedRowForDetail = signal<ApartmentRow | null>(null);
  readonly activeMonthMenu = signal<{ rowId: string; monthKey: string } | null>(null);
  readonly activeGlobalMenu = signal<string | null>(null);
  readonly dateNow = Date.now();

  // Cache des paiements par appartement et mois
  private paymentsCache = new Map<string, Map<string, PaymentCell>>();

  // Flag pour éviter le rechargement automatique à chaque navigation
  private dataLoaded = false;

  /** Détail des charges pour la tranche affichée dans le modal */
  readonly selectedChargesBreakdown = signal<{ chargeId: string; libelle: string; montant: number; mode: string }[]>([]);

  readonly editForm = new FormGroup({
    coproprietaire: new FormControl({ value: '', disabled: true }),
    lot:            new FormControl({ value: '', disabled: true }),
    charge:         new FormControl({ value: '', disabled: true }),
    montant:        new FormControl('', [Validators.required, Validators.min(0)]),
    datePaiement:   new FormControl('', Validators.required),
    modePaiement:   new FormControl('', Validators.required),
    reference:      new FormControl(''),
    statut:         new FormControl('', Validators.required),
  });

  readonly filteredRows = computed(() => {
    const term   = this.search().trim().toLowerCase();
    const filter = this.statusFilter();
    return this.rows().filter(row => {
      const matchSearch = !term ||
        row.apartment.toLowerCase().includes(term) ||
        row.owner.toLowerCase().includes(term) ||
        (row.batiment || '').toLowerCase().includes(term);
      const { resteDu, retards } = this.computeRowCounters(row);
      const matchFilter = filter === 'all' ||
        (filter === 'late'       && (resteDu > 0 || retards > 0)) ||
        (filter === 'up_to_date' && resteDu === 0 && retards === 0);
      return matchSearch && matchFilter;
    });
  });

  // Synchronise la pagination avec le résultat filtré
  readonly paginationEffect = effect(() => {
    this.pagination.setItems(this.filteredRows());
  });

  readonly stats = computed(() => {
    const rows         = this.rows();
    const totalDue     = rows.reduce((a, r) => a + this.computeRowDue(r), 0);
    const totalPaid    = rows.reduce((a, r) => a + this.computeRowPaid(r), 0);
    const totalUnpaid  = Math.max(totalDue - totalPaid, 0);
    const expensesTotal = this.expenses().reduce((a, e) => a + e.amount, 0);
    const balance      = totalPaid - expensesTotal;
    const collectionRate = totalDue ? (totalPaid / totalDue) * 100 : 0;
    const overdueCount = rows.filter(r => this.computeRowCounters(r).retards > 0).length;
    return { totalCollected: totalPaid, expensesTotal, balance, collectionRate, totalUnpaid, overdueCount };
  });

  readonly unpaidByFloor = computed(() => {
    const result: { floor: string; unpaid: number; due: number }[] = [];
    this.rows().forEach(row => {
      let entry = result.find(r => r.floor === row.floor);
      if (!entry) { entry = { floor: row.floor, unpaid: 0, due: 0 }; result.push(entry); }
      entry.due    += this.computeRowDue(row);
      entry.unpaid += Math.max(this.computeRowDue(row) - this.computeRowPaid(row), 0);
    });
    return result.sort((a, b) => a.floor.localeCompare(b.floor));
  });

  readonly today = this.formatFullDate(new Date());

  // ── Lifecycle ───────────────────────────────────────────────────────────────

async ngOnInit() {
  // ✅ CORRIGÉ : Utiliser l'observable pour attendre l'auth
  await firstValueFrom(this.auth.currentUser$.pipe(filter(Boolean), take(1)));
  
  const firebaseUser = this.auth.currentUser;
  if (firebaseUser) {
    try {
      // ✅ Lire depuis Firestore (collection users)
      const userData = await this.userService.getById(String(firebaseUser.id));
      
      if (userData) {
        const roles = userData.roles || [];
        this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
        this.currentResidenceId = this.isResidenceAdmin ? userData.residenceId || null : null;
        
        console.log('✅ Données utilisateur chargées:', {
          isResidenceAdmin: this.isResidenceAdmin,
          currentResidenceId: this.currentResidenceId,
          roles
        });
      } else {
        console.warn('Utilisateur non trouvé dans Firestore pour ID:', firebaseUser.id);
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

  // Ne charger que la première fois
  if (this.dataLoaded) return;
  await this.loadCharges();
  await this.loadFromFirestore();
  this.dataLoaded = true;

  // Écouter les mises à jour externes
  try {
    window.addEventListener('montants:updated', this.montantsUpdatedHandler);
  } catch (e) {
    // ignore
  }
}

  ngOnDestroy() {
    try { window.removeEventListener('montants:updated', this.montantsUpdatedHandler); } catch (e) {}
  }

  /** Rafraîchissement manuel des données (bouton Refresh) */
  async refreshData() {
    this.dataLoaded = false;
    this.calculMensuelService.clearCache();
    await this.loadCharges();
    await this.loadFromFirestore();
    this.dataLoaded = true;
  }
clearCache(): void {
  this.paymentsCache.clear();
  this.calculMensuelService.clearCache();
}
  // ── Chargement principal ─────────────────────────────────────────────────────

  private async loadFromFirestore() {
    // Vider le cache des montants mensuels pour recalculer depuis Firestore
    this.calculMensuelService.clearCache();
    try {
      // 1. Charger les appartements
      const allAppartements = await this.appartementService.loadAppartements();
      const appartements = this.isResidenceAdmin && this.currentResidenceId
        ? allAppartements.filter((a: any) => (a.residenceDocId || a.residenceId) === this.currentResidenceId)
        : allAppartements;

      // 2. Charger les utilisateurs
      let users: any[] = [];
      try {
        users = await this.userService.loadFromFirestore?.() ?? this.userService.getAll();
      } catch { users = this.userService.getAll(); }

      if (this.isResidenceAdmin && this.currentResidenceId) {
        const appartementIdsInResidence = new Set(
          appartements.map((a: any) => String(a.docId || '')).filter(Boolean)
        );
        users = users.filter((u: any) => {
          const byResidenceId = (u.residenceId || (u as any).residenceDocId) === this.currentResidenceId;
          const byAppartement = u.appartementId ? appartementIdsInResidence.has(String(u.appartementId)) : false;
          return byResidenceId || byAppartement;
        });
      }

      console.log('=== CHARGEMENT DES DONNÉES ===');
      console.log(`${appartements.length} appartements chargés`);
      console.log(`${users.length} utilisateurs chargés`);
      
      // Debug : afficher les premiers appartements et users pour diagnostic
      console.log('[Debug] Premiers appartements:', appartements.slice(0, 3).map(a => ({ docId: a.docId, numero: a.numero, proprietaireId: a.proprietaireId })));
      console.log('[Debug] Premiers utilisateurs:', users.slice(0, 3).map((u: any) => ({ id: u.id, firebaseUid: u.firebaseUid, name: u.name, appartementId: u.appartementId, lot: u.lot })));

      // Map uid → user + reverse map appartementId → user
      const userByUid = new Map<string, any>();
      const userById = new Map<string, any>();
      const userByEmail = new Map<string, any>();
      const userByAppartementId = new Map<string, any>();
      
      users.forEach(u => {
        if (u.firebaseUid) userByUid.set(u.firebaseUid, u);
        if (u.id) userById.set(String(u.id), u);
        if (u.email) userByEmail.set(u.email.toLowerCase(), u);
        if (u.appartementId) userByAppartementId.set(String(u.appartementId), u);
      });

      // 3. Pré-calculer les montants Firestore pour tous les mois
      const montantsParMois = new Map<string, Map<string, number>>();
      for (const month of this.months) {
        const [annee, mois] = month.key.split('-').map(Number);
        const m = await this.calculMensuelService.getMontantsPourTousAppartements(annee, mois);
        montantsParMois.set(month.key, m);
      }

      // 4. Charger les paiements Firestore
      const paiements = await this.paiementService.loadFromFirestore();
      
      // Indexer les paiements par appartementId + mois
      this.paymentsCache.clear();
      paiements.forEach(p => {
        if (!p.appartementId || !p.mois || !p.annee) return;
        
        const monthKey = `${p.annee}-${String(p.mois).padStart(2, '0')}`;
        
        if (!this.paymentsCache.has(p.appartementId)) {
          this.paymentsCache.set(p.appartementId, new Map());
        }
        
        const monthMap = this.paymentsCache.get(p.appartementId)!;
        const existing = monthMap.get(monthKey);
        if (existing) {
          // Cumuler les montants payés pour le même mois (tous les versements additionnés)
          // Ne PAS toucher existing.amount — il sera remplacé par monthAmount (montant DÛ) plus bas
          existing.paidAmount = Math.round(((existing.paidAmount ?? 0) + p.amount) * 100) / 100;
          // Conserver le statut 'paid' si l'un des versements l'est
          if (p.status === 'paid') existing.status = 'paid' as CellStatus;
          existing.date = p.datePaiement || existing.date;
          existing.modePaiement = p.modePaiement || existing.modePaiement;
          existing.reference = p.reference || existing.reference;
          existing.recuUrl = p.recuUrl || existing.recuUrl;
          existing.paymentId = p.docId || existing.paymentId;
        } else {
          monthMap.set(monthKey, {
            status: p.status as CellStatus,
            amount: p.amount,
            paidAmount: p.amount,
            date: p.datePaiement || '',
            dueDate: p.dueDate || '',
            modePaiement: p.modePaiement || 'carte',
            reference: p.reference || '',
            recuUrl: p.recuUrl || '',
            paymentId: p.docId,
          });
        }
      });

      // 5. Charger les dettes pour vérifier les statuts réels
      const toutesDettes = await this.detteService.getAll(false, this.auth.currentUser || undefined);
      const dettesParAppartement = new Map<string, Map<string, Dette>>();
      
      toutesDettes.forEach(dette => {
        if (!dette.appartementId) return;
        const monthKey = `${dette.annee}-${String(dette.mois).padStart(2, '0')}`;
        
        if (!dettesParAppartement.has(dette.appartementId)) {
          dettesParAppartement.set(dette.appartementId, new Map());
        }
        dettesParAppartement.get(dette.appartementId)!.set(monthKey, dette);
      });

      // 6. Construire les lignes (uniquement les appartements occupés / ayant un utilisateur)
      const rows: ApartmentRow[] = [];

      for (const apt of appartements) {
        if (!apt.docId) continue;

        // Exclure les appartements vacants (sans propriétaire ni locataire assigné)
        if (apt.statut === 'vacant' && !apt.proprietaireId && !apt.locataireId
            && !userByAppartementId.has(apt.docId)) {
          continue;
        }

        // Résolution du propriétaire
        const propId = apt.proprietaireId || (apt as any).coproprietaireId || '';
        let owner = null;
        let ownerName = `Propriétaire ${apt.numero}`;
        let ownerEmail = '';
        let ownerPhone = '';

        if (propId) {
          owner = userByUid.get(propId);
          if (!owner) {
            const propIdNum = parseInt(propId, 10);
            if (!isNaN(propIdNum)) {
              owner = userById.get(propIdNum.toString()) || userById.get(propId);
            } else {
              owner = userById.get(propId);
            }
          }
          if (!owner && propId.includes('@')) {
            owner = userByEmail.get(propId.toLowerCase());
          }
        }

        // Fallback : recherche inversée par appartementId sur l'utilisateur
        if (!owner && apt.docId) {
          owner = userByAppartementId.get(apt.docId);
        }
        // Fallback : recherche par numéro d'appartement dans le champ lot/appartementId
        if (!owner && apt.numero) {
          owner = users.find((u: any) => 
            u.lot === apt.numero || 
            String(u.appartementId) === apt.numero
          ) || null;
        }

        if (!owner && propId) {
          console.warn(`[Paiements] Propriétaire introuvable pour apt "${apt.numero}" (docId=${apt.docId}, proprietaireId=${propId})`);
        }

        if (owner) {
          ownerName = owner.name || owner.fullname || owner.displayName || owner.username || `Propriétaire ${apt.numero}`;
          ownerEmail = owner.email || '';
          ownerPhone = owner.phone || '';
        }

        const hasParking = Boolean(apt.hasParking || (apt as any).parking || (apt.caracteristiques || []).includes('Parking'));
        const hasAscenseur = Boolean(apt.hasAscenseur || (apt.caracteristiques || []).includes('Ascenseur'));

        // Construire les cellules de paiement pour chaque mois
        const payments: Record<string, PaymentCell> = {};
        const aptPayments = this.paymentsCache.get(apt.docId) || new Map();
        const aptDettes = dettesParAppartement.get(apt.docId) || new Map();

        for (const month of this.months) {
          const montantsMois = montantsParMois.get(month.key);
          const montantBase  = montantsMois?.get(apt.docId) ?? 150;
          const monthAmount  = Math.round(montantBase * 100) / 100;

          // Vérifier s'il y a un paiement existant
          const paiement = aptPayments.get(month.key);
          
          // Vérifier la dette correspondante
          const dette = aptDettes.get(month.key);
          
          if (paiement) {
            // Montant cumulé de tous les versements du mois
            const paidAmt = Math.round((paiement.paidAmount ?? paiement.amount ?? 0) * 100) / 100;

            // ── Source de vérité : statut Firestore de la dette ──────────────────
            // Si la dette dit PAYEE → c'est soldé, même si paidAmt < monthAmount
            // (ex : charge parking ajoutée après, montantDû recalculé à la hausse)
            let finalStatus: CellStatus;
            if (dette?.statut === 'PAYEE') {
              finalStatus = 'paid';
            } else if (monthAmount > 0 && paidAmt >= monthAmount) {
              finalStatus = 'paid';
            } else if (paidAmt > 0) {
              finalStatus = 'partial';
            } else {
              finalStatus = 'unpaid';
            }

            payments[month.key] = {
              ...paiement,
              amount: monthAmount,
              paidAmount: paidAmt,
              status: finalStatus,
            };
          } else if (dette) {
            // Déterminer le statut basé sur la dette
            let status: CellStatus = 'unpaid';
            if (dette.statut === 'PAYEE') status = 'paid';
            else if (dette.statut === 'PARTIELLEMENT_PAYEE') status = 'partial';
            
            payments[month.key] = {
              status,
              amount: monthAmount,
              paidAmount: dette.montant_paye,
              date: '',
              dueDate: dette.date_echeance || this.getDueDate(month.key),
              modePaiement: undefined,
              reference: '',
              recuUrl: '',
            };
          } else {
            // Aucun paiement ni dette
            // Si montant = 0 (proratisation : utilisateur pas encore emménagé), marquer comme payé
            const cellStatus: CellStatus = monthAmount === 0 ? 'paid' : 'unpaid';
            payments[month.key] = {
              status: cellStatus,
              amount: monthAmount,
              paidAmount: 0,
              date: '',
              dueDate: this.getDueDate(month.key),
              modePaiement: undefined,
              reference: '',
              recuUrl: '',
            };
          }
        }

        rows.push({
          id:         apt.docId,
          batiment:   apt.batimentName || apt.batimentDocId || 'Immeuble',
          floor:      String((apt as any).etage ?? (apt as any).floor ?? 'RDC'),
          apartment:  apt.numero,
          owner:      ownerName,
          ownerId:    propId,
          phone:      ownerPhone || (apt as any).phone || '',
          email:      ownerEmail,
          hasParking,
          hasAscenseur,
          baseCharge: 150,
          payments,
        });
      }

      console.log(`${rows.length} lignes générées`);
      this.rows.set(rows);

    } catch (err) {
      console.error('Erreur chargement Firestore:', err);
      this.pushToast('error', 'Erreur lors du chargement des données');
    }
  }

  // ── Actions UI ────────────────────────────────────────────────────────────

  setFilter(f: 'all' | 'late' | 'up_to_date') { this.statusFilter.set(f); }
  clearSearch() { this.search.set(''); }

  toggleDetail(rowId: string) {
    this.activeDetail.set(this.activeDetail() === rowId ? null : rowId);
    this.activeAction.set(null);
  }

  openDetail(row: ApartmentRow) { this.activeDetail.set(row.id); this.activeAction.set('detail'); }
  openEditView(row: ApartmentRow) { this.activeDetail.set(row.id); this.activeAction.set('edit'); }

  openRelance(row: ApartmentRow) {
    const hasUnpaid = Object.values(row.payments).some(p => p.status === 'unpaid' || p.status === 'late');
    if (hasUnpaid) { this.activeDetail.set(row.id); this.activeAction.set('relance'); }
    else this.pushToast('info', 'Aucun impayé pour ce copropriétaire');
  }

  openRecu(row: ApartmentRow) {
    const hasPaid = Object.values(row.payments).some(p => p.status === 'paid');
    if (hasPaid) { this.activeDetail.set(row.id); this.activeAction.set('recu'); }
    else this.pushToast('info', 'Aucun paiement trouvé pour générer un reçu');
  }

  handleHistoryClick(row: ApartmentRow, monthKey: string, action: string | null) {
    const payment    = row.payments[monthKey];
    const monthLabel = this.months.find(m => m.key === monthKey)?.label || monthKey;
    
    this.showFullDetailModal.set(false);
    
    switch (action) {
      case 'edit':   
        this.openEditModal(row, payment, monthKey, monthLabel); 
        break;
      case 'relance':
        if (payment.status === 'unpaid' || payment.status === 'late')
          this.openRelanceModal(row, payment, monthKey, monthLabel);
        else {
          this.pushToast('info', 'Ce paiement est déjà réglé');
          this.showFullDetailModal.set(true);
        }
        break;
      case 'recu':
        if (payment.status === 'paid') 
          this.openRecuModal(row, payment, monthKey, monthLabel);
        else {
          this.pushToast('info', 'Seuls les paiements effectués ont un reçu');
          this.showFullDetailModal.set(true);
        }
        break;
      default: 
        this.openDetailModal(row, payment, monthKey, monthLabel);
    }
  }

  openDetailModal(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    const totalDue = payment?.amount || row.baseCharge;
    const paidAmt = payment?.paidAmount ?? 0;
    this.selectedPayment.set({
      coproprietaire: row.owner, 
      locataire: row.locataire,
      lot: `${row.floor} - ${row.apartment}`,
      charge: `Charges mensuelles - ${monthLabel}`,
      montant: totalDue,
      montantDu: totalDue,
      paidAmount: paidAmt,
      resteAPayer: Math.round(Math.max(0, totalDue - paidAmt) * 100) / 100,
      datePaiement: payment?.date || this.formatDateFromMonthKey(monthKey),
      modePaiement: payment?.modePaiement || 'Non spécifié',
      reference: payment?.reference || 'N/A',
      statut: payment?.status || 'unpaid',
      recuUrl: payment?.recuUrl, 
      monthLabel,
      email: row.email,
    });
    this.showDetailModal.set(true);
    // Charger le détail des charges en arrière-plan
    this.loadChargesBreakdown(row.id, monthKey);
  }

  openEditModal(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    this.selectedRowId.set(row.id);
    this.editSelectedMonth.set(monthKey);

    const paidAmt = payment?.paidAmount ?? 0;
    const totalDue = payment?.amount || row.baseCharge;
    const reste = Math.round(Math.max(0, totalDue - paidAmt) * 100) / 100;

    this.selectedPayment.set({
      coproprietaire: row.owner,
      lot: `${row.floor} - ${row.apartment}`,
      charge: `Charges mensuelles - ${monthLabel}`,
      monthLabel,
      paymentId: payment.paymentId,
      paidAmount: paidAmt,
      resteAPayer: reste,
      montantDu: totalDue,
      statut: payment?.status || 'unpaid',
    });
    
    this.editForm.patchValue({
      coproprietaire: row.owner,
      lot: `${row.floor} - ${row.apartment}`,
      charge: `Charges mensuelles - ${monthLabel}`,
      montant: String(payment?.status === 'partial' ? reste : totalDue),
      datePaiement: payment?.date || this.formatDateFromMonthKey(monthKey),
      modePaiement: payment?.modePaiement || 'carte',
      reference: payment?.reference || '',
      statut: payment?.status || 'unpaid',
    });
    this.showEditModal.set(true);
    // Charger le détail des charges en arrière-plan
    this.loadChargesBreakdown(row.id, monthKey);
  }

  openRelanceModal(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    this.selectedPayment.set({
      coproprietaire: row.owner, 
      email: row.email,
      montant: payment.amount,
      charge: `Charges mensuelles - ${monthLabel}`,
      dateEcheance: payment.dueDate || this.getDueDate(monthKey),
    });
    this.showRelanceModal.set(true);
  }

  openRecuModal(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    this.selectedPayment.set({
      coproprietaire: row.owner,
      lot: `${row.floor} - ${row.apartment}`,
      charge: `Charges mensuelles - ${monthLabel}`,
      montant: payment.amount,
      datePaiement: payment.date || this.formatDateFromMonthKey(monthKey),
      modePaiement: payment.modePaiement || 'carte',
      reference: payment.reference || this.generateReference(),
      statut: 'paid', 
      recuNumero: `R-${Date.now()}`,
    });
    this.showRecuModal.set(true);
  }

  closeModals() {
    this.showDetailModal.set(false);
    this.showEditModal.set(false);
    this.showRelanceModal.set(false);
    this.showRecuModal.set(false);
    this.showFullDetailModal.set(false);
    this.selectedPayment.set(null);
    this.selectedChargesBreakdown.set([]);
    this.selectedRowId.set(null);
    this.editSelectedMonth.set(null);
    this.selectedRowForDetail.set(null);
    this.editForm.reset();
    this.activeActionMenu.set(null);
  }

  /** Charge en arrière-plan le détail des charges pour le modal */
  private loadChargesBreakdown(aptDocId: string, monthKey: string): void {
    this.selectedChargesBreakdown.set([]); // reset pendant le chargement
    const [annee, mois] = monthKey.split('-').map(Number);
    this.calculMensuelService
      .getChargesBreakdown(aptDocId, annee, mois)
      .then(breakdown => this.selectedChargesBreakdown.set(breakdown))
      .catch(() => this.selectedChargesBreakdown.set([]));
  }

  toggleActionMenu(rowId: string) {
    if (this.activeActionMenu() === rowId) {
      this.activeActionMenu.set(null);
    } else {
      this.activeActionMenu.set(rowId);
    }
  }

  closeActionMenu() {
    this.activeActionMenu.set(null);
  }

  closeMonthMenu() {
    this.activeMonthMenu.set(null);
  }

  toggleGlobalActionMenu(rowId: string) {
    if (this.activeGlobalMenu() === rowId) {
      this.activeGlobalMenu.set(null);
    } else {
      this.activeGlobalMenu.set(rowId);
    }
  }

  closeGlobalMenu() {
    this.activeGlobalMenu.set(null);
  }

  openDetailModalFromRow(row: ApartmentRow) {
    this.selectedRowForDetail.set(row);
    this.activeAction.set('detail');
    this.showFullDetailModal.set(true);
    this.closeGlobalMenu();
  }

  openEditModalFromRow(row: ApartmentRow) {
    this.selectedRowForDetail.set(row);
    this.activeAction.set('edit');
    this.showFullDetailModal.set(true);
    this.closeGlobalMenu();
  }

  openRelanceModalFromRow(row: ApartmentRow) {
    const hasUnpaid = Object.values(row.payments).some(p => p.status === 'unpaid' || p.status === 'late');
    if (hasUnpaid) {
      this.selectedRowForDetail.set(row);
      this.activeAction.set('relance');
      this.showFullDetailModal.set(true);
      this.closeGlobalMenu();
    } else {
      this.pushToast('info', 'Aucun impayé pour ce copropriétaire');
    }
  }

  openRecuModalFromRow(row: ApartmentRow) {
    const hasPaid = Object.values(row.payments).some(p => p.status === 'paid');
    if (hasPaid) {
      this.selectedRowForDetail.set(row);
      this.activeAction.set('recu');
      this.showFullDetailModal.set(true);
      this.closeGlobalMenu();
    } else {
      this.pushToast('info', 'Aucun paiement trouvé pour générer un reçu');
    }
  }

  handleRelanceClick(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    if (payment.status === 'unpaid' || payment.status === 'late') {
      this.openRelanceModal(row, payment, monthKey, monthLabel);
    } else {
      this.pushToast('info', 'Ce paiement est déjà réglé');
    }
  }

  handleRecuClick(row: ApartmentRow, payment: PaymentCell, monthKey: string, monthLabel: string) {
    if (payment.status === 'paid') {
      this.openRecuModal(row, payment, monthKey, monthLabel);
    } else {
      this.pushToast('info', 'Seuls les paiements effectués ont un reçu');
    }
  }

  openMonthMenuFromDetail(row: ApartmentRow, monthKey: string, event: MouseEvent) {
    event.stopPropagation();
    this.selectedRowForDetail.set(row);
    this.activeMonthMenu.set({ rowId: row.id, monthKey });
  }

  toggleMonthMenu(rowId: string, monthKey: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.activeMonthMenu()?.rowId === rowId && this.activeMonthMenu()?.monthKey === monthKey) {
      this.activeMonthMenu.set(null);
    } else {
      this.activeMonthMenu.set({ rowId, monthKey });
    }
  }

  async savePaymentWithFifo() {
    if (!this.editForm.valid) return;
    const v        = this.editForm.getRawValue();
    const rowId    = this.selectedRowId();
    const monthKey = this.editSelectedMonth();
    if (!rowId || !monthKey) { this.pushToast('error', 'Sélection invalide'); return; }

    const row = this.rows().find(r => r.id === rowId);
    if (!row) { this.pushToast('error', 'Appartement introuvable'); return; }

    const amount = Number(v.montant);
    const statut = (v.statut as CellStatus) || 'unpaid';
    const datePaiement = v.datePaiement || this.formatDateFromMonthKey(monthKey);
    
    // Extraire l'année et le mois du monthKey
    const [annee, mois] = monthKey.split('-').map(Number);

    try {
      // Chercher l'ID du copropriétaire — row.ownerId est déjà l'ID du propriétaire
      // de l'appartement tel que stocké dans Firestore (apt.proprietaireId).
      // On enrichit uniquement si l'ID est absent (appartement sans propriétaire lié).
      let coproprietaireId: string = row.ownerId || '';
      if (!coproprietaireId) {
        try {
          const users = await this.userService.loadFromFirestore?.() ?? this.userService.getAll();
          const user  = users.find(u =>
            (u.email && row.email && u.email.toLowerCase() === row.email.toLowerCase()) ||
            u.name === row.owner ||
            u.fullname === row.owner
          );
          coproprietaireId = user?.firebaseUid || user?.id?.toString() || '';
        } catch {
          // lookup optionnel — on continue sans ID
        }
      }

      // ─── RÈGLE DE SAUVEGARDE ─────────────────────────────────────────────────
      // Si le mois était PARTIAL : on crée TOUJOURS un nouveau paiement (complément).
      // On ne modifie JAMAIS le paiement existant partiellement payé :
      //   update(paymentId, {amount:40}) écraserait 1250 DT → dette recalcule
      //   à l'envers : reste = 1250 DT → boucle infinie.
      const wasPartial = this.selectedPayment()?.statut === 'partial';

      const existingPayment = (this.selectedPayment()?.paymentId && !wasPartial)
        ? await this.paiementService.update(this.selectedPayment().paymentId, {
            amount,
            datePaiement,
            modePaiement: this.normalizePaymentMode(v.modePaiement),
            reference: v.reference || this.generateReference(),
            status: statut === 'paid' ? 'paid' : statut === 'late' ? 'overdue' : 'pending',
          })
        : await this.paiementService.create({
            appartementId: rowId,
          residenceId: this.currentResidenceId || undefined,
            coproprietaireId,
            amount,
            datePaiement,
            date: datePaiement,
            dueDate: datePaiement,
            modePaiement: this.normalizePaymentMode(v.modePaiement),
            reference: v.reference || this.generateReference(),
            status: statut === 'paid' ? 'paid' : statut === 'late' ? 'overdue' : 'pending',
            label: wasPartial
              ? `Complément ${monthKey} - ${row.apartment}`
              : `Paiement ${monthKey} - ${row.apartment}`,
            mois,
            annee,
          });

      if (!existingPayment) {
        this.pushToast('error', 'Erreur lors de la sauvegarde du paiement');
        return;
      }

      const paiement = existingPayment;

      // ── Rattrapage ciblé de la dette ─────────────────────────────────────────
      // paiementService.create(status='paid') déclenche déjà le FIFO automatique
      // (affectationSvc interne). On fait ici uniquement un rattrapage si la dette
      // existe par appartementId/mois mais n'a pas encore été liée au paiement.
      if (paiement.status === 'paid') {
        try {
          const paiementDocId = paiement.docId || String(paiement.id);
          const dette = await this.detteService.getByAppartementAndMonth(rowId, annee, mois);

          if (dette && dette.statut !== 'PAYEE') {
            const dejaLiee = dette.paiement_ids?.includes(paiementDocId);
            if (!dejaLiee) {
              // FIFO auto n'a pas trouvé cette dette (coproprietaireId manquant) → rattrapage
              await this.detteService.affecterPaiement(dette.id, amount, paiementDocId);
              console.log(`✅ Dette ${dette.id} rattrapée manuellement`);
            }
          }
          // Pas de else : si aucune dette, le FIFO interne a déjà géré par coproprietaireId
        } catch (syncErr) {
          console.warn('[Paiements] Rattrapage dette échoué:', syncErr);
        }
      }

      const statusLabel = paiement.status === 'paid' ? 'enregistré et affecté aux dettes' : 'enregistré';
      this.pushToast('success', `Paiement de ${amount} DT ${statusLabel}`);

      // Recharger les données pour mettre à jour l'affichage
      await this.loadFromFirestore();
      
      this.closeModals();
    } catch (err) {
      console.error('Erreur paiement:', err);
      this.pushToast('error', 'Erreur lors de l\'enregistrement');
    }
  }

  async sendRelance() {
    const p = this.selectedPayment();
    if (!p) return;
    this.sendingRelance.set(true);
    try {
      const alerte = {
        titre: `Relance — ${p.charge || 'Paiement'}`,
        message: `${p.coproprietaire || 'Copropriétaire'}, votre paiement de ${this.formatCurrency(p.montant || 0)} est en attente.`,
        destinataireId: (p.coproprietaireId || p.userId || ''),
        type: 'relance',
        meta: { paiementId: p.id || p.docId || null, dateEcheance: p.dateEcheance || null },
        createdAt: new Date(),
      } as any;
      await this.alerteService.create(alerte);
      this.pushToast('success', 'Relance envoyée avec succès');
      this.closeModals();
    } catch (err) {
      console.error('[Relance] Erreur:', err);
      this.pushToast('error', 'Erreur lors de l\'envoi de la relance');
    } finally {
      this.sendingRelance.set(false);
    }
  }

  downloadRecu(url: string)  { window.open(url, '_blank'); }
  async downloadRecuPDF() {
    const p = this.selectedPayment();
    if (!p) return;
    this.generatingPdf.set(true);
    try {
      const data: RecuData = {
        recuNumero: p.recuNumero ?? this.recuService.genererNumeroRecu(),
        datePaiement: p.datePaiement ?? new Date().toISOString(),
        coproprietaire: p.coproprietaire ?? '',
        lot: p.lot ?? '',
        charge: p.charge ?? '',
        montant: p.montant ?? 0,
        modePaiement: p.modePaiement ?? 'unknown',
        reference: p.reference ?? '',
        statut: p.statut ?? 'paid',
      };
      await this.recuService.telechargerRecu(data);
    } catch (err) {
      console.error('[Reçu] Erreur génération PDF:', err);
      this.pushToast('error', 'Erreur lors de la génération du reçu');
    } finally {
      this.generatingPdf.set(false);
    }
  }
  printHistory(row: ApartmentRow) { window.print(); }
  exportHistoryPDF(row: ApartmentRow) { this.pushToast('info', 'Génération du PDF...'); }

  // ── Calculs ───────────────────────────────────────────────────────────────

  cellClass(cell: PaymentCell): string {
    if (!cell || cell.amount === 0) return 'cell cell-empty';
    if (cell.status === 'paid')    return 'cell cell-paid';
    if (cell.status === 'late')    return 'cell cell-late';
    if (cell.status === 'partial') return 'cell cell-partial';
    return 'cell cell-unpaid';
  }

  cellLabel(cell: PaymentCell): string {
    if (!cell || cell.amount === 0) return '—';
    if (cell.status === 'paid')    return 'Payé';
    if (cell.status === 'late')    return 'Retard';
    if (cell.status === 'partial') return 'Partiel';
    return 'Impayé';
  }

  computeRowPaid(row: ApartmentRow): number {
    return Object.values(row.payments).reduce((a, c) => {
      if (c.status === 'paid')    return a + c.amount;
      if (c.status === 'partial') return a + (c.paidAmount ?? c.amount / 2);
      return a;
    }, 0);
  }

  private computeRowDue(row: ApartmentRow): number {
    return Object.values(row.payments).reduce((a, c) => a + (c.amount || 0), 0);
  }

  // Compute totals limited to a provided set of month keys (or visibleMonths if omitted)
  computeRowPaidForMonths(row: ApartmentRow, monthKeys?: string[]): number {
    const keys = monthKeys ?? this.visibleMonths().map(m => m.key);
    return keys.reduce((sum, k) => {
      const c = row.payments[k];
      if (!c) return sum;
      if (c.status === 'paid') return sum + c.amount;
      if (c.status === 'partial') return sum + (c.paidAmount ?? c.amount / 2);
      return sum;
    }, 0);
  }

  computeRowDueForMonths(row: ApartmentRow, monthKeys?: string[]): number {
    const keys = monthKeys ?? this.visibleMonths().map(m => m.key);
    return keys.reduce((sum, k) => sum + ((row.payments[k]?.amount) || 0), 0);
  }

  computeRowCounters(row: ApartmentRow) {
    const totalDue = this.computeRowDue(row);
    const paid     = this.computeRowPaid(row);
    const retards  = Object.values(row.payments).filter(c => c.amount > 0 && (c.status === 'late' || c.status === 'unpaid')).length;

    const arrearsMap = new Map<number, { year: number; due: number; paid: number; unpaid: number; months: number; unpaidMonths: number }>();
    Object.entries(row.payments).forEach(([key, cell]) => {
      const year = Number(key.split('-')[0]);
      if (!arrearsMap.has(year)) arrearsMap.set(year, { year, due: 0, paid: 0, unpaid: 0, months: 0, unpaidMonths: 0 });
      const b = arrearsMap.get(year)!;
      const due  = cell.amount || 0;
      const p    = cell.status === 'paid' ? due : cell.status === 'partial' ? (cell.paidAmount ?? due / 2) : 0;
      const unp  = Math.max(due - p, 0);
      b.due += due; b.paid += p; b.unpaid += unp; b.months++;
      if (unp > 0) b.unpaidMonths++;
    });

    const arrearsByYear   = Array.from(arrearsMap.values()).sort((a, b) => a.year - b.year);
    const arrearsPastYears = arrearsByYear.filter(i => i.year < this.currentYear).reduce((a, i) => a + i.unpaid, 0);

    return { totalDue, paid, resteDu: Math.max(totalDue - paid, 0), retards, arrearsPastYears, arrearsByYear };
  }

  getArrearsByYear(row: ApartmentRow) { return this.computeRowCounters(row).arrearsByYear; }
  getTotalExpenses()  { return this.expenses().reduce((a, e) => a + e.amount, 0); }
  getAverageExpenses() { return this.months.length ? this.getTotalExpenses() / this.months.length : 0; }

  // ── Formatage ─────────────────────────────────────────────────────────────

  formatAmount(v: number)   { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1); }
  formatCurrency(v: number) { return `${(v || 0).toLocaleString('fr-TN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DT`; }

  getStatusLabel(s: string): string {
    return ({ paid: '✅ Payé', late: '⏳ Retard', partial: '⚠️ Partiel', unpaid: '❌ Impayé' } as any)[s] || s;
  }

  getModePaiementLabel(m: string): string {
    return ({ carte: 'Carte bancaire', virement: 'Virement', especes: 'Espèces', cheque: 'Chèque' } as any)[m] || m;
  }

  // ── Charges / Dépenses ────────────────────────────────────────────────────

  private async loadCharges() {
    try {
      const data = await this.chargeService.list();
      this.charges.set(data);
      if (data.length) {
        const palette = ['#059669', '#2563EB', '#8B5CF6', '#F59E0B', '#DC2626', '#0EA5E9'];
        this.expenses.set(data.map((c, i) => ({
          label: c.libelle, amount: c.montant || 0,
          month: this.formatMonthLabel(c.date_debut),
          color: palette[i % palette.length],
        })));
      } else {
        this.expenses.set([]);
      }
    } catch { this.expenses.set([]); }
  }

  // ── Utilitaires ───────────────────────────────────────────────────────────

  private normalizePaymentMode(v: string | null | undefined): PaymentMode {
    const allowed: PaymentMode[] = ['especes','cheque','virement','carte','prelevement'];
    const lower = (v || '').toLowerCase();
    return allowed.includes(lower as PaymentMode) ? (lower as PaymentMode) : 'carte';
  }

  private getDueDate(monthKey: string | null): string {
    if (!monthKey) return this.todayIso();
    const [year, month] = monthKey.split('-');
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    return `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  }

  formatDateRelance(value?: string | Date | null): string {
    if (!value) return '—';
    const d = this.toDateValue(value) || new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private formatDateFromMonthKey(mk: string): string {
    const [y, m] = mk.split('-');
    return `${y}-${m}-15`;
  }

  private generateReference(): string {
    return `TXN-${Math.floor(Math.random() * 1_000_000)}`;
  }

  private buildMonths(): MonthColumn[] {
    const months: MonthColumn[] = [];
    // Ensure the generated months include the current month (so UI shows up-to-date tranche)
    const now = new Date();
    const monthsSinceStart = (now.getFullYear() - this.startDate.getFullYear()) * 12 + (now.getMonth() - this.startDate.getMonth());
    // monthsSinceStart is 0-based (0 means only the start month). We want to include current month => +1
    const needed = monthsSinceStart + 1;
    const monthsToGenerate = Math.max(this.monthCount, needed);

    for (let i = 0; i < monthsToGenerate; i++) {
      const d = new Date(this.startDate);
      d.setMonth(this.startDate.getMonth() + i);
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('fr-TN', { month: 'short', year: '2-digit' })
        .replace('.', '').replace(/^(\w)/, m => m.toUpperCase());
      months.push({ key, label });
    }
    return months;
  }

  private toMonthKey(raw?: string, dueDate?: unknown): string {
    if (typeof raw === 'string' && raw.includes('-')) return raw.slice(0, 7);
    const d = this.toDateValue(dueDate || raw);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private toDateValue(value: unknown): Date | null {
    if (!value) return null;
    if (typeof value === 'object' && (value as any).toDate) return (value as any).toDate();
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const clean = value.includes('T') ? value.split('T')[0] : value;
      const parts = clean.split(/[-/]/).map(Number);
      if (parts.length === 3) {
        return clean.includes('-') ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(parts[2], parts[1] - 1, parts[0]);
      }
    }
    return null;
  }

  private normalizeStatus(raw: string): CellStatus {
    const v = raw.toLowerCase();
    if (v.includes('paid') || v.includes('pay') || v === 'valide') return 'paid';
    if (v.includes('partial') || v.includes('partiel'))            return 'partial';
    if (v.includes('late') || v.includes('retard') || v === 'overdue') return 'late';
    return 'unpaid';
  }

  private todayIso()           { return new Date().toISOString().split('T')[0]; }
  private formatFullDate(d: Date) { return d.toLocaleDateString('fr-TN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); }
  private formatMonthLabel(iso: string): string {
    const d = this.toDateValue(iso) || new Date();
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }).replace('.', '');
  }

  private pushToast(type: 'success' | 'error' | 'info', message: string) {
    const id = Date.now();
    this.toasts.update(l => [...l, { id, type, message }]);
    setTimeout(() => this.toasts.update(l => l.filter(t => t.id !== id)), 5000);
  }

  // Méthodes pour la vue grille
  readonly batiments = computed<string[]>(() => {
    const set = new Set<string>();
    this.rows().forEach(r => { if (r.batiment) set.add(r.batiment); });
    return Array.from(set).sort();
  });

  readonly floors = computed<string[]>(() => {
    const order = ['RDC', '1er', '2ème', '3ème', '4ème', '5ème', '6ème', '7ème', '8ème', '9ème'];
    const set = new Set<string>();
    this.filteredRows().forEach(r => { if (r.floor) set.add(r.floor); });
    return Array.from(set).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      return a.localeCompare(b);
    });
  });

  getRowsByFloor(floor: string): ApartmentRow[] {
    return this.filteredRows().filter(r => r.floor === floor);
  }

  getMonthTotal(monthKey: string): number {
    return this.filteredRows().reduce((sum, row) => {
      const cell = row.payments[monthKey];
      if (!cell) return sum;
      if (cell.status === 'paid')    return sum + cell.amount;
      if (cell.status === 'partial') return sum + (cell.paidAmount ?? cell.amount / 2);
      return sum;
    }, 0);
  }
  // Ajoutez cette méthode pour réinitialiser tous les filtres
resetAllFilters() {
  this.search.set('');
  this.setFilter('all');
  this.selectedYear.set('');
  this.selectedMonth.set(null);
}
}