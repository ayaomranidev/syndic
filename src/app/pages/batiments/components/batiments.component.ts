import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Batiment, BatimentService, Residence } from '../services/batiment.service';
import { Auth } from '../../../core/services/auth';

@Component({
  selector: 'app-batiments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './batiments.component.html',
  styleUrls: ['./batiments.component.css'],
  providers: [BatimentService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BatimentsComponent implements OnInit {
  batiments: Batiment[] = [];
  filteredBatiments: Batiment[] = [];
  residences: Residence[] = [];

  searchTerm = '';
  selectedResidence: string | null = null;
  selectedStatus: '' | 'Actif' | 'Maintenance' | 'Inactif' = '';
  selectedResidenceDetails: Residence | null = null;

  isModalOpen = false;
  editing: Batiment | null = null;
  detailBatiment: Batiment | null = null;

  form: Partial<Batiment & { area?: number; note?: string; hasElevator?: boolean }> = {};
  isResidenceAdmin = false;
  currentResidenceId: string | null = null;

  currentUser: any | null = null;

  private getBatimentResidenceId(b: Batiment): string | null {
    return b.residenceDocId || b.residenceId || null;
  }

  constructor(private svc: BatimentService, private auth: Auth, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.auth.currentUser$.subscribe(async (u) => {
      this.currentUser = u;
      if (u) {
        const roles = u.roles || (u.role ? [u.role] : []);
        this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
        this.currentResidenceId = this.isResidenceAdmin
          ? (u.residenceId || (u as any).residenceDocId || null)
          : null;
        if (this.isResidenceAdmin && this.currentResidenceId) {
          this.selectedResidence = this.currentResidenceId;
        }
        await Promise.all([this.refreshFromFirestore(), this.loadResidences()]);
      } else {
        this.isResidenceAdmin = false;
        this.currentResidenceId = null;
        this.batiments = this.svc.getAll();
        this.filteredBatiments = [...this.batiments];
      }
      this.cdr.markForCheck();
    });
  }

  openModal(b?: Batiment) {
    this.detailBatiment = null;
    if (b) {
      this.editing = b;
      this.form = { ...b };
      this.selectedResidence = b.residenceDocId || b.residenceId || null;
      this.selectedResidenceDetails = this.residences.find((r) => r.docId === this.selectedResidence) || null;
      this.form.residenceDocId = this.selectedResidence || undefined;
    } else {
      this.editing = null;
      this.form = {
        name: '',
        residence: '',
        floors: 0,
        apartmentsPerFloor: 0,
        units: 0,
        manager: '',
        status: 'Actif',
        hasElevator: false,
      };
      if (this.isResidenceAdmin && this.currentResidenceId) {
        this.selectedResidence = this.currentResidenceId;
        this.selectedResidenceDetails = this.residences.find((r) => r.docId === this.currentResidenceId) || null;
        this.form.residence = this.selectedResidenceDetails?.name || '';
        this.form.residenceDocId = this.currentResidenceId;
      } else {
        this.selectedResidence = null;
        this.selectedResidenceDetails = null;
      }
    }
    this.isModalOpen = true;
    this.cdr.markForCheck();
  }

  closeModal() {
    this.isModalOpen = false;
    this.editing = null;
    this.form = {};
    this.cdr.markForCheck();
  }

  async save() {
    if (this.isResidenceAdmin && this.currentResidenceId && this.selectedResidence !== this.currentResidenceId) {
      this.selectedResidence = this.currentResidenceId;
      this.selectedResidenceDetails = this.residences.find((r) => r.docId === this.currentResidenceId) || null;
    }

    const payload: Partial<Batiment> = {
      name: (this.form.name || '').trim() || 'Nouveau bâtiment',
      residence: (this.form.residence || '').trim() || '',
      residenceName: this.selectedResidenceDetails?.name || this.form.residence || '',
      residenceDocId: this.selectedResidence || undefined,
      residenceId: this.selectedResidence || undefined,
      floors: Number(this.form.floors || 0),
      apartmentsPerFloor: Number(this.form.apartmentsPerFloor || 0),
      units: Number(this.form.units || 0),
      manager: (this.form.manager || '').trim() || '',
      status: (this.form.status as Batiment['status']) || 'Actif',
      hasElevator: !!this.form.hasElevator,
    };

    // ← createdBy
    if (this.currentUser) {
      payload.createdBy = this.currentUser.uid || this.currentUser.email || 'unknown';
    }

    // ← S'assurer que le batiment a bien residenceDocId et residenceName
    if (this.isResidenceAdmin && this.currentResidenceId) {
      payload.residenceDocId = this.currentResidenceId;
      payload.residenceId = this.currentResidenceId;
      payload.residenceName = this.selectedResidenceDetails?.name || payload.residenceName || '';
      payload.residence = payload.residenceName;
    }

    try {
      if (this.editing) {
        const toUpdate: Batiment = { ...this.editing, ...payload } as Batiment;
        await this.svc.updateAndPersist(toUpdate);
        this.batiments = this.batiments.map((x) => (x.id === toUpdate.id ? toUpdate : x));
      } else {
        const created = await this.svc.createAndPersist(payload as Partial<Batiment>);
        this.batiments = [created, ...this.batiments];
      }
      this.applyFilters();
    } catch (err) {
      console.error('save batiment failed', err);
      if (!this.editing) {
        const local = this.svc.create(payload as Partial<Batiment>);
        this.batiments = [local, ...this.batiments];
        this.applyFilters();
      }
    }

    this.closeModal();
    this.cdr.markForCheck();
  }

  edit(b: Batiment) {
    if (this.isResidenceAdmin && this.currentResidenceId && this.getBatimentResidenceId(b) !== this.currentResidenceId) {
      alert('Vous ne pouvez modifier que les bâtiments de votre résidence.');
      return;
    }
    this.openModal(b);
  }

  openDetail(b: Batiment) {
    this.detailBatiment = b;
    this.cdr.markForCheck();
  }

  closeDetail() {
    this.detailBatiment = null;
    this.cdr.markForCheck();
  }

  async delete(b: Batiment) {
    if (this.isResidenceAdmin && this.currentResidenceId && this.getBatimentResidenceId(b) !== this.currentResidenceId) {
      alert('Vous ne pouvez supprimer que les bâtiments de votre résidence.');
      return;
    }
    if (!confirm(`Supprimer le bâtiment "${b.name}" ?`)) return;
    try {
      await this.svc.deleteAndPersist(b);
      this.batiments = this.batiments.filter((x) => x.id !== b.id);
      this.applyFilters();
      this.cdr.markForCheck();
    } catch (err) {
      console.error('delete batiment failed', err);
    }
  }

  async refreshFromFirestore() {
    try {
      const list = await this.svc.loadFromFirestore();
      this.batiments = this.isResidenceAdmin && this.currentResidenceId
        ? list.filter((b) => this.getBatimentResidenceId(b) === this.currentResidenceId)
        : list;
      this.applyFilters();
      this.cdr.markForCheck();
    } catch (err) {
      console.error('failed to load batiments', err);
      this.batiments = this.svc.getAll();
      this.applyFilters();
      this.cdr.markForCheck();
    }
  }

  async loadResidences() {
    try {
      const list = await this.svc.loadResidences();
      this.residences = this.isResidenceAdmin && this.currentResidenceId
        ? list.filter((r) => r.docId === this.currentResidenceId)
        : list;
      if (this.isResidenceAdmin && this.currentResidenceId) {
        this.selectedResidence = this.currentResidenceId;
      }
      if (this.selectedResidence) {
        this.selectedResidenceDetails = this.residences.find((r) => r.docId === this.selectedResidence) || null;
      }
      this.cdr.markForCheck();
    } catch (err) {
      console.error('failed to load residences', err);
    }
  }

  onResidenceChange(docId: string | null) {
    if (this.isResidenceAdmin && this.currentResidenceId) {
      docId = this.currentResidenceId;
    }
    this.selectedResidence = docId;
    this.selectedResidenceDetails = this.residences.find((r) => r.docId === docId) || null;
    this.form.residence = this.selectedResidenceDetails?.name || '';
    this.form.residenceDocId = docId || undefined;
  }

  onSearch(term: string) {
    this.searchTerm = term || '';
    this.applyFilters();
  }

  clearSearch() {
    this.searchTerm = '';
    this.applyFilters();
  }

  filterByResidence(docId: string | null) {
    this.selectedResidence = this.isResidenceAdmin && this.currentResidenceId
      ? this.currentResidenceId
      : (docId || null);
    this.applyFilters();
  }

  filterByStatus(status: '' | 'Actif' | 'Maintenance' | 'Inactif') {
    this.selectedStatus = status;
    this.applyFilters();
  }

  resetFilters() {
    this.searchTerm = '';
    this.selectedResidence = this.isResidenceAdmin && this.currentResidenceId ? this.currentResidenceId : null;
    this.selectedStatus = '';
    this.applyFilters();
  }

  applyFilters() {
    this.filteredBatiments = this.batiments.filter((b) => {
      const matchSearch = this.searchTerm
        ? (b.name || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          (b.residenceName || b.residence || '').toLowerCase().includes(this.searchTerm.toLowerCase())
        : true;

      const matchResidence = this.selectedResidence
        ? this.getBatimentResidenceId(b) === this.selectedResidence
        : true;

      const matchStatus = this.selectedStatus
        ? (b.status || '').toLowerCase() === this.selectedStatus.toLowerCase()
        : true;

      return matchSearch && matchResidence && matchStatus;
    });
    this.cdr.markForCheck();
  }

  getNewThisMonth(): number {
    return 0;
  }

  getTotalUnits(): number {
    return this.batiments.reduce((sum, b) => sum + (b.units || 0), 0);
  }

  getResidencesActives(): number {
    return this.residences.length;
  }

  getOccupancyRate(b: Batiment): number {
    if (!b.units || b.units === 0) return 0;
    return Math.min(100, Math.round((b.units * 0.94) * 100) / 100);
  }

  openImportModal() {
    alert('Import Excel non implémenté pour le moment.');
  }
}