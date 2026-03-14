import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Appartement,
  AppartementService,
  AppartementStatus,
  AppartementType,
  BatimentRef,
  ResidenceRef,
} from '../services/appartement.service';
import { UserService } from '../../coproprietaires/services/coproprietaire.service';
import { Auth } from '../../../core/services/auth';

@Component({
  selector: 'app-appartements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './appartements.component.html',
  styleUrls: ['./appartements.component.css'],
  providers: [AppartementService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppartementsComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly auth = inject(Auth);

  appartements: Appartement[] = [];
  filteredAppartements: Appartement[] = [];
  residences: ResidenceRef[] = [];
  batiments: BatimentRef[] = [];

  userNameByAptId: Record<string, string> = {};

  searchTerm = '';
  statusFilter: 'all' | AppartementStatus = 'all';
  residenceFilter: 'all' | string = 'all';
  batimentFilter: 'all' | string = 'all';

  isModalOpen = false;
  editingDocId: string | null = null;
  detailAppartement: Appartement | null = null;

  isResidenceAdmin = false;
  currentResidenceId: string | null = null;

  form: Partial<Appartement> = {
    numero: '',
    surface: 0,
    nombrePieces: 1,
    etage: 0,
    batimentDocId: undefined,
    residenceDocId: undefined,
    type: 'T2',
    statut: 'vacant',
    chargesMensuelles: 0,
    quotePart: 1,
    caracteristiques: [],
  };

  availableFloors: number[] = [];
  ascenseurWarning: string | null = null;

  readonly caracteristiquesOptions: string[] = [
    'Balcon', 'Terrasse', 'Jardin', 'Cave', 'Parking', 'Ascenseur',
    'Double garage', 'Cuisine equipee', 'Salle de bain neuve',
    'Chauffage individuel', 'Climatisation', 'Piscine', 'Vue mer/montagne',
  ];

  readonly statusLabel: Record<AppartementStatus, string> = {
    'occupé': 'Occupé',
    vacant: 'Vacant',
    en_renovation: 'En rénovation',
  };

  constructor(private svc: AppartementService, private cdr: ChangeDetectorRef) {}

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private residenceIdOf(a: Partial<Appartement>): string | null {
    return (a.residenceDocId || a.residenceId || null) as string | null;
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  async ngOnInit(): Promise<void> {
    try {
      await this.loadUserData();
      await Promise.all([
        this.loadResidences(),
        this.loadBatiments(),
        this.loadAppartements(),
        this.userService.loadFromFirestore(),
      ]);

      this.buildUserNameMap();
      this.applyFilters();
    } catch (error) {
      console.error('Erreur lors de l\'initialisation:', error);
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ✅ CORRECTION DÉFINITIVE : Utiliser getAll() et filtrer
  private async loadUserData(): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) {
      console.warn('Aucun utilisateur connecté');
      return;
    }

    try {
      // Récupérer tous les utilisateurs et trouver celui correspondant à l'ID
      const allUsers = this.userService.getAll();
      const userData = allUsers.find(u => u.id === firebaseUser.id);
      
      if (userData) {
        const roles = userData.roles || [];
        this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
        this.currentResidenceId = this.isResidenceAdmin ? userData.residenceId || null : null;
        
        console.log('✅ Données utilisateur chargées:', {
          id: firebaseUser.id,
          isResidenceAdmin: this.isResidenceAdmin,
          currentResidenceId: this.currentResidenceId,
          roles
        });

        if (this.isResidenceAdmin && this.currentResidenceId) {
          this.residenceFilter = this.currentResidenceId;
        }
      }
    } catch (error) {
      console.error('Erreur lors du chargement des données utilisateur:', error);
    }
  }

  // ==========================================================================
  // CHARGEMENTS
  // ==========================================================================

  private buildUserNameMap(): void {
    this.userNameByAptId = {};
    const allUsers = this.userService.getAll();
    for (const user of allUsers) {
      if (user.appartementId) {
        this.userNameByAptId[user.appartementId] = user.name;
      }
    }
  }

  getUserName(aptDocId?: string): string {
    if (!aptDocId) return '';
    return this.userNameByAptId[aptDocId] || '';
  }

  async loadResidences(): Promise<void> {
    try {
      const list = await this.svc.loadResidences();
      this.residences = this.isResidenceAdmin && this.currentResidenceId
        ? list.filter((r) => r.docId === this.currentResidenceId)
        : list;
      
      if (this.isResidenceAdmin && this.currentResidenceId) {
        this.form.residenceDocId = this.currentResidenceId;
      }
    } catch (err) {
      console.error('loadResidences failed', err);
    }
  }

  async loadBatiments(residenceDocId?: string | null): Promise<void> {
    try {
      const targetResidence = this.isResidenceAdmin && this.currentResidenceId
        ? this.currentResidenceId
        : residenceDocId;
      
      this.batiments = await this.svc.loadBatiments(targetResidence);
      this.updateAvailableFloors();
    } catch (err) {
      console.error('loadBatiments failed', err);
    }
  }

  async loadAppartements(): Promise<void> {
    try {
      const list = await this.svc.loadAppartements();
      this.appartements = this.isResidenceAdmin && this.currentResidenceId
        ? list.filter((a) => this.residenceIdOf(a) === this.currentResidenceId)
        : list;
      
      this.filteredAppartements = [...this.appartements];
    } catch (err) {
      console.error('loadAppartements failed', err);
    }
  }

  // ==========================================================================
  // MODAL
  // ==========================================================================

  openDetail(appartement: Appartement): void {
    this.detailAppartement = appartement;
    this.cdr.markForCheck();
  }

  closeDetail(): void {
    this.detailAppartement = null;
    this.cdr.markForCheck();
  }

  private resetForm(): void {
    const defaultResidenceId = this.isResidenceAdmin && this.currentResidenceId
      ? this.currentResidenceId
      : (this.batiments[0]?.residenceDocId || this.residences[0]?.docId);

    const defaultBatimentId = this.isResidenceAdmin && this.currentResidenceId
      ? (this.batiments.find((b) => b.residenceDocId === this.currentResidenceId)?.docId)
      : this.batiments[0]?.docId;

    this.form = {
      numero: '',
      surface: 0,
      nombrePieces: 1,
      etage: 0,
      batimentDocId: defaultBatimentId,
      residenceDocId: defaultResidenceId,
      type: 'T2',
      statut: 'vacant',
      chargesMensuelles: 0,
      quotePart: 1,
      caracteristiques: [],
    };
    this.updateAvailableFloors();
  }

  openModal(appartement?: Appartement): void {
    if (appartement) {
      if (
        this.isResidenceAdmin &&
        this.currentResidenceId &&
        this.residenceIdOf(appartement) !== this.currentResidenceId
      ) {
        alert('Vous ne pouvez modifier que les appartements de votre résidence.');
        return;
      }

      this.editingDocId = appartement.docId || null;
      this.form = { ...appartement };
      this.form.residenceDocId = appartement.residenceDocId || (appartement as any).residenceId || undefined;

      // Synchroniser les caractéristiques
      const caracts = this.form.caracteristiques || [];
      if (Boolean(appartement.hasParking) && !caracts.includes('Parking')) {
        this.form.caracteristiques = [...caracts, 'Parking'];
      } else if (!appartement.hasParking && caracts.includes('Parking')) {
        this.form.caracteristiques = caracts.filter((c) => c !== 'Parking');
      }
      
      const caractsAfter = this.form.caracteristiques || [];
      if (Boolean(appartement.hasAscenseur) && !caractsAfter.includes('Ascenseur')) {
        this.form.caracteristiques = [...caractsAfter, 'Ascenseur'];
      } else if (!appartement.hasAscenseur && caractsAfter.includes('Ascenseur')) {
        this.form.caracteristiques = caractsAfter.filter((c) => c !== 'Ascenseur');
      }
    } else {
      this.editingDocId = null;
      this.resetForm();
    }

    this.updateAvailableFloors();
    this.isModalOpen = true;
    this.cdr.markForCheck();
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.editingDocId = null;
    this.ascenseurWarning = null;
    this.resetForm();
    this.cdr.markForCheck();
  }

  // ==========================================================================
  // FILTRES
  // ==========================================================================

  onSearch(value: string): void {
    this.searchTerm = value || '';
    this.applyFilters();
  }

  setStatusFilter(value: 'all' | AppartementStatus): void {
    this.statusFilter = value;
    this.applyFilters();
  }

  setResidenceFilter(value: 'all' | string): void {
    this.residenceFilter = this.isResidenceAdmin && this.currentResidenceId
      ? this.currentResidenceId
      : value;
    this.applyFilters();
  }

  setBatimentFilter(value: 'all' | string): void {
    this.batimentFilter = value;
    this.applyFilters();
  }

  private applyFilters(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredAppartements = this.appartements.filter((a) => {
      const matchSearch = !term || a.numero.toLowerCase().includes(term);
      const matchStatus = this.statusFilter === 'all' || a.statut === this.statusFilter;
      const matchResidence = this.residenceFilter === 'all' || this.residenceIdOf(a) === this.residenceFilter;
      const matchBatiment = this.batimentFilter === 'all' || a.batimentDocId === this.batimentFilter;
      return matchSearch && matchStatus && matchResidence && matchBatiment;
    });
    this.cdr.markForCheck();
  }

  // ==========================================================================
  // FORMULAIRE
  // ==========================================================================

  get hasParking(): boolean {
    return (this.form.caracteristiques || []).includes('Parking');
  }

  get hasAscenseur(): boolean {
    return (this.form.caracteristiques || []).includes('Ascenseur');
  }

  toggleParking(): void {
    this.toggleCaracteristique('Parking');
  }

  toggleAscenseur(): void {
    const willEnable = !(this.form.caracteristiques || []).includes('Ascenseur');
    if (willEnable) {
      const bat = this.batiments.find((b) => b.docId === this.form.batimentDocId);
      if (bat && !bat.hasElevator) {
        this.ascenseurWarning = `Le bâtiment "${bat.name}" ne dispose pas d'ascenseur.`;
      } else {
        this.ascenseurWarning = null;
      }
    } else {
      this.ascenseurWarning = null;
    }
    this.toggleCaracteristique('Ascenseur');
    this.cdr.markForCheck();
  }

  toggleCaracteristique(caracteristique: string): void {
    const list = this.form.caracteristiques || [];
    const exists = list.includes(caracteristique);
    this.form.caracteristiques = exists
      ? list.filter((c) => c !== caracteristique)
      : [...list, caracteristique];
  }

  async onResidenceChange(residenceDocId: string | null): Promise<void> {
    if (this.isResidenceAdmin && this.currentResidenceId) {
      residenceDocId = this.currentResidenceId;
    }
    this.form.residenceDocId = residenceDocId || undefined;
    await this.loadBatiments(residenceDocId || undefined);
    
    const firstBat = this.batiments.find(
      (b) => !residenceDocId || b.residenceDocId === residenceDocId,
    );
    this.form.batimentDocId = firstBat?.docId;
    this.updateAvailableFloors();
    this.applyFilters();
    this.cdr.markForCheck();
  }

  onBatimentChange(batimentDocId: string | null): void {
    this.form.batimentDocId = batimentDocId || undefined;
    this.updateAvailableFloors();
    this.cdr.markForCheck();
  }

  onEtageChange(etage: number): void { 
    this.form.etage = Number(etage) || 0; 
  }
  
  setType(value: string): void { 
    this.form.type = value as AppartementType; 
  }
  
  setStatut(value: string): void { 
    this.form.statut = value as AppartementStatus; 
  }
  
  toNumber(value: unknown): number { 
    return Number(value); 
  }

  private updateAvailableFloors(): void {
    const bat = this.batiments.find((b) => b.docId === this.form.batimentDocId);
    const floors = bat?.floors ?? 0;
    this.availableFloors = floors > 0
      ? Array.from({ length: floors }, (_, i) => i + 1)
      : [];
  }

  getBatimentName(docId: string): string {
    if (!docId) return 'Bâtiment';
    return this.batiments.find((b) => b.docId === docId)?.name || 'Bâtiment';
  }

  getResidenceName(docId: string): string {
    if (!docId) return 'Résidence';
    return this.residences.find((r) => r.docId === docId)?.name || 'Résidence';
  }

  // ==========================================================================
  // SAUVEGARDE
  // ==========================================================================

  async saveAppartement(): Promise<void> {
    const resolvedResidenceId = this.isResidenceAdmin && this.currentResidenceId
      ? this.currentResidenceId
      : (this.form.residenceDocId || null);

    const payload: Appartement = {
      numero: (this.form.numero || '').trim(),
      surface: Number(this.form.surface) || 0,
      nombrePieces: Number(this.form.nombrePieces) || 1,
      etage: Number(this.form.etage) || 0,
      batimentDocId: this.form.batimentDocId,
      batimentName: this.getBatimentName(this.form.batimentDocId || ''),
      residenceDocId: resolvedResidenceId || undefined,
      residenceId: resolvedResidenceId || undefined,
      residenceName: this.getResidenceName(resolvedResidenceId || ''),
      type: (this.form.type as AppartementType) || 'T2',
      statut: (this.form.statut as AppartementStatus) || 'vacant',
      chargesMensuelles: Number(this.form.chargesMensuelles) || 0,
      quotePart: Number(this.form.quotePart) || 0,
      proprietaireId: this.form.proprietaireId,
      locataireId: this.form.locataireId,
      caracteristiques: [...new Set(this.form.caracteristiques || [])],
    };

    if (!payload.numero) {
      alert("Le numéro d'appartement est requis.");
      return;
    }

    try {
      const hasParking = Boolean(payload.caracteristiques.includes('Parking'));
      const hasAscenseur = Boolean(payload.caracteristiques.includes('Ascenseur'));

      if (this.editingDocId) {
        await this.svc.updateAppartement(this.editingDocId, payload);
        this.appartements = this.appartements.map((a) =>
          a.docId === this.editingDocId ? { ...a, ...payload } : a,
        );
        await this.syncParkingToUsers(this.editingDocId, payload.numero, hasParking);
        await this.syncAscenseurToUsers(this.editingDocId, payload.numero, hasAscenseur);
      } else {
        const created = await this.svc.addAppartement(payload);
        this.appartements = [created, ...this.appartements];
      }

      this.applyFilters();
      this.closeModal();
    } catch (err) {
      console.error('saveAppartement failed', err);
      alert('Erreur lors de la sauvegarde : ' + (err as Error).message);
    }
  }

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  async deleteAppartement(appartement: Appartement): Promise<void> {
    if (
      this.isResidenceAdmin &&
      this.currentResidenceId &&
      this.residenceIdOf(appartement) !== this.currentResidenceId
    ) {
      alert('Vous ne pouvez supprimer que les appartements de votre résidence.');
      return;
    }
    
    if (!appartement.docId) return;
    
    const confirmation = window.confirm('Supprimer cet appartement ?');
    if (!confirmation) return;
    
    try {
      await this.svc.deleteAppartement(appartement.docId);
      this.appartements = this.appartements.filter((a) => a.docId !== appartement.docId);
      this.applyFilters();
      this.cdr.markForCheck();
    } catch (err) {
      console.error('deleteAppartement failed', err);
    }
  }

  // ==========================================================================
  // SYNC USERS
  // ==========================================================================

  private async syncAscenseurToUsers(
    aptDocId: string,
    aptNumero: string,
    hasAscenseur: boolean,
  ): Promise<void> {
    try {
      const allUsers = this.userService.getAll();
      const linkedUsers = allUsers.filter(
        (u) => u.appartementId === aptDocId || u.lot === aptNumero,
      );
      
      for (const user of linkedUsers) {
        if (Boolean(user.hasAscenseur) !== hasAscenseur) {
          await this.userService.updateAndPersist(user.id, { hasAscenseur });
        }
      }
    } catch (err) {
      console.error('syncAscenseurToUsers failed', err);
    }
  }

  private async syncParkingToUsers(
    aptDocId: string,
    aptNumero: string,
    hasParking: boolean,
  ): Promise<void> {
    try {
      const allUsers = this.userService.getAll();
      const linkedUsers = allUsers.filter(
        (u) => u.appartementId === aptDocId || u.lot === aptNumero,
      );
      
      for (const user of linkedUsers) {
        if (Boolean(user.hasParking) !== hasParking) {
          await this.userService.updateAndPersist(user.id, { hasParking });
        }
      }
    } catch (err) {
      console.error('syncParkingToUsers failed', err);
    }
  }
}