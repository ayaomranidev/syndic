import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
interface StatCard {
  title: string;
  value: string;
  delta: string;
  tone: 'primary' | 'success' | 'warning';
}
import { Residence, ResidenceService } from '../services/residence.service';
import { Auth } from '../../../core/services/auth';

@Component({
  selector: 'app-residences',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './residences.component.html',
  styleUrls: ['./residences.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResidencesComponent {
  currentYear = new Date().getFullYear();
  stats: StatCard[] = [
    { title: 'Résidences gérées', value: '18', delta: '+2 ce mois', tone: 'primary' },
    { title: 'Taux d\'occupation', value: '92%', delta: '+3 pts', tone: 'success' },
    { title: 'Incidents ouverts', value: '12', delta: '-5 vs. N-1', tone: 'warning' },
  ];
  residences: Residence[] = [];

  // Modal and form state
  isModalOpen = false;
  editingResidence: Residence | null = null;
  detailResidence: Residence | null = null;

  form: Partial<Residence & {
    year?: number;
    postal?: string;
    country?: string;
    area?: number;
    syndicPhone?: string;
    syndicEmail?: string;
    hasReglement?: boolean;
  }> = {
    year: this.currentYear,
    postal: '',
    country: 'France',
    area: 0,
    syndicPhone: '',
    syndicEmail: '',
    hasReglement: false,
  };

  constructor(private residenceService: ResidenceService, private auth: Auth, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    // Wait for auth state before attempting Firestore reads to avoid permission errors.
    this.auth.currentUser$.subscribe(async (u) => {
      if (u) {
        await this.refreshFromFirestore();
      } else {
        // no auth: keep local seeded data
        this.residences = this.residenceService.getAll();
      }
      this.cdr.markForCheck();
    });
  }

  openModal() {
    this.editingResidence = null;
    this.detailResidence = null;
    this.isModalOpen = true;
  }

  openDetail(res: Residence) {
    this.detailResidence = res;
    this.cdr.markForCheck();
  }

  closeDetail() {
    this.detailResidence = null;
    this.cdr.markForCheck();
  }

  closeModal() {
    this.isModalOpen = false;
    // reset minimal form fields (keep defaults)
    this.form = { year: this.currentYear, country: 'France', hasReglement: false };
    this.editingResidence = null;
  }

  async saveResidence() {
    // Basic copy and normalization
    const normalized: Partial<Residence> = {
      name: (this.form.name || '').trim() || 'Nouvelle résidence',
      city: (this.form.city || '').trim() || '-',
      address: (this.form.address || '').trim() || '-',
      buildings: Number(this.form.buildings || 0),
      apartments: Number(this.form.apartments || 0),
      annualCharges: String(this.form.annualCharges || '0'),
      fund: String(this.form.fund || '0'),
      manager: (this.form.manager || '').trim() || '-',
      status: 'Actif',
    };

    try {
      if (this.editingResidence) {
        const toUpdate: Residence = {
          ...this.editingResidence,
          ...normalized,
        } as Residence;
        await this.residenceService.updateAndPersist(toUpdate);
        this.residences = this.residences.map((r) => (r.id === toUpdate.id ? toUpdate : r));
      } else {
        const created = await this.residenceService.createAndPersist(normalized);
        this.residences = [created, ...this.residences];
      }
    } catch (err) {
      console.error('Failed to save residence:', err);
      if (!this.editingResidence) {
        const local = this.residenceService.create(normalized);
        this.residences = [local, ...this.residences];
      }
    }

    this.closeModal();
    this.cdr.markForCheck();
  }

  editResidence(res: Residence) {
    this.editingResidence = res;
    this.form = {
      name: res.name,
      city: res.city,
      address: res.address,
      buildings: res.buildings,
      apartments: res.apartments,
      annualCharges: res.annualCharges,
      fund: res.fund,
      manager: res.manager,
      status: res.status,
      hasReglement: false,
      country: 'France',
      year: this.currentYear,
    } as any;
    this.isModalOpen = true;
    this.cdr.markForCheck();
  }

  async deleteResidence(res: Residence) {
    const confirmed = confirm(`Supprimer la résidence "${res.name}" ?`);
    if (!confirmed) return;
    try {
      await this.residenceService.deleteAndPersist(res);
      this.residences = this.residences.filter((r) => r.id !== res.id);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to delete residence:', err);
    }
  }

  async refreshFromFirestore() {
    try {
      const list = await this.residenceService.loadFromFirestore();
      this.residences = list;
      this.cdr.markForCheck();
    } catch (err: any) {
      console.error('Failed to load residences from Firestore', err);
      // keep local seeded data
      this.residences = this.residenceService.getAll();
      this.cdr.markForCheck();
    }
  }
}
