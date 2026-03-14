import { ChangeDetectionStrategy, Component, OnInit, computed, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ReunionService, Reunion, ReunionType, ReunionStatut, PointOdj, ParticipantReunion } from '../services/reunion.service';
import { UserService, User } from '../../coproprietaires/services/coproprietaire.service';
import { AppartementService, Appartement } from '../../appartements/services/appartement.service';
import { BatimentService, Batiment } from '../../batiments/services/batiment.service';
import { PaginationService } from '../../../shared/services/pagination.service';

export interface SelectableUser {
  userId: string;
  nom: string;
  role: string;
  appartement: string;
  appartementDocId: string;
  batimentDocId: string;
  batimentName: string;
  selected: boolean;
}

type TabFilter = 'toutes' | 'PLANIFIEE' | 'EN_COURS' | 'TERMINEE' | 'ANNULEE';

@Component({
  selector: 'app-reunions',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './reunions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ReunionService],
})
export class ReunionsComponent implements OnInit {

  private readonly userSvc  = inject(UserService);
  private readonly apptSvc  = inject(AppartementService);
  private readonly batSvc   = inject(BatimentService);

  readonly reunions    = signal<Reunion[]>([]);
  readonly loading     = signal(true);
  readonly tabFilter   = signal<TabFilter>('toutes');
  readonly searchTerm  = signal('');
  readonly selectedReunion = signal<Reunion | null>(null);

  readonly showCreateModal  = signal(false);
  readonly showDetailModal  = signal(false);
  readonly showPvModal      = signal(false);
  readonly savingPv         = signal(false);
  readonly creating         = signal(false);
  readonly pvText           = signal('');

  // ── Liste des utilisateurs sélectionnables pour les participants ──
  readonly selectableUsers  = signal<SelectableUser[]>([]);
  readonly participantSearch = signal('');

  readonly pagination = inject(PaginationService) as PaginationService<Reunion>;

  // ── Participant picker state ──
  readonly showParticipantList = signal(false);
  readonly participantScope = signal<'all' | 'batiment'>('all');
  readonly batimentsList = signal<{docId: string; name: string}[]>([]);
  readonly selectedBatimentFilter = signal<string>('');

  /** Utilisateurs filtrés par scope, bâtiment et recherche */
  readonly filteredUsers = computed(() => {
    let list = this.selectableUsers();
    const scope = this.participantScope();
    if (scope === 'batiment') {
      const batId = (this.selectedBatimentFilter() ?? '').toString().trim();
      if (batId) {
        const batName = this.batimentsList().find(b => b.docId === batId)?.name || '';
        list = list.filter(u => {
          const uBatId = (u.batimentDocId ?? '').toString().trim();
          const uBatName = (u.batimentName ?? '').toString().trim();
          return uBatId === batId || (uBatName && (uBatName === batName || uBatName === batId));
        });
      }
    }
    const term = this.participantSearch().toLowerCase().trim();
    if (term) {
      list = list.filter(u =>
        u.nom.toLowerCase().includes(term) ||
        u.appartement.toLowerCase().includes(term) ||
        u.role.toLowerCase().includes(term) ||
        u.batimentName.toLowerCase().includes(term)
      );
    }
    return list;
  });

  /** Tous les utilisateurs visibles sélectionnés ? */
  readonly allSelected = computed(() => {
    const list = this.filteredUsers();
    return list.length > 0 && list.every(u => u.selected);
  });

  readonly types: ReunionType[] = ['AG_ORDINAIRE','AG_EXTRAORDINAIRE','CONSEIL','TECHNIQUE','AUTRE'];

  // Formulaire création
  readonly form = new FormGroup({
    titre:       new FormControl('', [Validators.required, Validators.minLength(4)]),
    type:        new FormControl<ReunionType>('AG_ORDINAIRE', Validators.required),
    date:        new FormControl('', Validators.required),
    heureDebut:  new FormControl('09:00', Validators.required),
    heureFin:    new FormControl('11:00'),
    lieu:        new FormControl('', Validators.required),
    description: new FormControl(''),
    quorum:      new FormControl<number>(50),
  });

  // Points ODJ temporaires
  readonly odj = signal<PointOdj[]>([]);
  readonly nouveauPoint = signal({ titre: '', dureeMinutes: 15, necessite_vote: false });

  // Participants temporaires (construits lors du submit à partir des selectableUsers)
  readonly participants = signal<ParticipantReunion[]>([]);

  // Computed
  readonly filteredReunions = computed<Reunion[]>(() => {
    let list = this.reunions();
    if (this.tabFilter() !== 'toutes') list = list.filter(r => r.statut === this.tabFilter());
    const t = this.searchTerm().toLowerCase().trim();
    if (t) list = list.filter(r => r.titre.toLowerCase().includes(t) || r.lieu.toLowerCase().includes(t));
    return list;
  });

  // Sync filtered reunions into pagination service
  private readonly _syncPagination = effect(() => {
    const list = this.filteredReunions();
    this.pagination.setItems(list);
  });

  readonly kpiPlanifiees  = computed(() => this.reunions().filter(r => r.statut === 'PLANIFIEE').length);
  readonly kpiTerminees   = computed(() => this.reunions().filter(r => r.statut === 'TERMINEE').length);
  readonly kpiAnnulees    = computed(() => this.reunions().filter(r => r.statut === 'ANNULEE').length);
  readonly kpiProchaine   = computed<Reunion | null>(() => {
    const today = new Date().toISOString().split('T')[0];
    return this.reunions().find(r => r.date >= today && r.statut === 'PLANIFIEE') ?? null;
  });

  constructor(private readonly svc: ReunionService) {}

  async ngOnInit() {
    await Promise.all([this.load(), this.loadUsers()]);
  }

  /** Charge tous les utilisateurs + appartements + bâtiments pour la sélection */
  private async loadUsers() {
    const [users, appts, bats] = await Promise.all([
      this.userSvc.loadFromFirestore(),
      this.apptSvc.loadAppartements(),
      this.batSvc.loadFromFirestore(),
    ]);

    // Stocker la liste des bâtiments pour le filtre
    this.batimentsList.set(bats.map(b => ({ docId: b.docId || '', name: b.name })));

    // Mapper chaque user avec son appartement
    const apptMap = new Map<string, Appartement>();
    appts.forEach(a => {
      if (a.proprietaireId) apptMap.set(a.proprietaireId, a);
      if (a.locataireId) apptMap.set(a.locataireId, a);
    });
    const selectable: SelectableUser[] = users.map(u => {
      const appt = apptMap.get(String(u.id)) || apptMap.get(u.firebaseUid || '');
      // fallback to user.batiment if appartement doesn't contain batiment info
      const fallbackBat = (u as any).batiment || '';
      const batId = appt && appt.batimentDocId ? String(appt.batimentDocId) : (fallbackBat ? String(fallbackBat) : '');
      const batNameFromAppt = appt?.batimentName || '';
      const batNameFromList = bats.find(b => b.docId === String(batId))?.name || '';
      const batName = batNameFromAppt || batNameFromList || (typeof fallbackBat === 'string' ? fallbackBat : '');
      return {
        userId: String(u.id),
        nom: u.fullname || u.name || u.email,
        role: u.role || u.roles?.[0] || '',
        appartement: appt ? `Appt ${appt.numero}` : '',
        appartementDocId: appt?.docId || '',
        batimentDocId: batId,
        batimentName: batName,
        selected: false,
      };
    });
    this.selectableUsers.set(selectable);
  }

  async load() {
    this.loading.set(true);
    try { 
      this.reunions.set(await this.svc.getAll()); 
    } finally { 
      this.loading.set(false); 
    }
  }

  openCreate() {
    // Pré-remplir la date du jour au format YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    this.form.reset({ 
      titre: '',
      type: 'AG_ORDINAIRE', 
      date: today,
      heureDebut: '09:00', 
      heureFin: '11:00', 
      lieu: '',
      description: '',
      quorum: 50 
    });
    this.odj.set([]);
    this.participants.set([]);
    // Réinitialiser les sélections
    this.selectableUsers.update(list => list.map(u => ({ ...u, selected: false })));
    this.participantSearch.set('');
    this.showParticipantList.set(false);
    this.participantScope.set('all');
    this.selectedBatimentFilter.set('');
    this.showCreateModal.set(true);
  }

  ajouterPoint() {
    const p = this.nouveauPoint();
    if (!p.titre.trim()) return;
    this.odj.update(list => [...list, { 
      id: Date.now().toString(), 
      titre: p.titre, 
      dureeMinutes: p.dureeMinutes, 
      necessite_vote: p.necessite_vote 
    }]);
    this.nouveauPoint.set({ titre: '', dureeMinutes: 15, necessite_vote: false });
  }

  supprimerPoint(id: string) { 
    this.odj.update(l => l.filter(p => p.id !== id)); 
  }

  /** Cocher / décocher un utilisateur */
  toggleParticipant(userId: string) {
    this.selectableUsers.update(list =>
      list.map(u => u.userId === userId ? { ...u, selected: !u.selected } : u)
    );
  }

  /** Sélectionner / désélectionner tous les utilisateurs visibles (filtrés) */
  toggleAll() {
    const visible = new Set(this.filteredUsers().map(u => u.userId));
    const allVisibleSelected = this.filteredUsers().every(u => u.selected);
    this.selectableUsers.update(list =>
      list.map(u => visible.has(u.userId) ? { ...u, selected: !allVisibleSelected } : u)
    );
  }

  /** Toggle l'affichage de la liste des participants */
  toggleParticipantList() {
    this.showParticipantList.update(v => !v);
  }

  /** Change le scope de sélection des participants */
  onParticipantScopeChange(scope: 'all' | 'batiment') {
    this.participantScope.set(scope);
    this.selectedBatimentFilter.set('');
  }

  /** Filtre les participants par bâtiment */
  onBatimentFilterChange(docId: string) {
    this.selectedBatimentFilter.set(docId);
  }

  /** Nombre de participants sélectionnés */
  get selectedCount(): number {
    return this.selectableUsers().filter(u => u.selected).length;
  }

  async submitCreate() {
    if (!this.form.valid) return;
    this.creating.set(true);
    const v = this.form.value;
    try {
      // Construire la liste des participants à partir des users sélectionnés
      const selectedParticipants: ParticipantReunion[] = this.selectableUsers()
        .filter(u => u.selected)
        .map(u => ({
          userId: u.userId,
          nom: u.nom,
          role: u.role,
          present: false,
        }));

      const r = await this.svc.create({
        titre: v.titre!, 
        type: v.type!, 
        statut: 'PLANIFIEE',
        date: v.date!, 
        heureDebut: v.heureDebut!, 
        heureFin: v.heureFin || undefined,
        lieu: v.lieu!, 
        description: v.description || undefined,
        quorum: v.quorum || undefined,
        ordre_du_jour: this.odj(), 
        participants: selectedParticipants,
      });
      this.reunions.update(l => [r, ...l]);
      this.showCreateModal.set(false);
    } finally { 
      this.creating.set(false); 
    }
  }

  openDetail(r: Reunion) { 
    this.selectedReunion.set(r); 
    this.showDetailModal.set(true); 
  }

  openPv(r: Reunion) { 
    this.selectedReunion.set(r); 
    this.pvText.set(r.pvTexte || this.genererPvTemplate(r)); 
    this.showPvModal.set(true); 
  }

  async changerStatut(r: Reunion, s: ReunionStatut) {
    if (!r.id) return;
    await this.svc.changerStatut(r.id, s);
    this.reunions.update(l => l.map(x => x.id === r.id ? { ...x, statut: s } : x));
    if (this.selectedReunion()?.id === r.id) {
      this.selectedReunion.update(x => x ? { ...x, statut: s } : x);
    }
  }

  // ✅ Version simplifiée - Sauvegarde UNIQUEMENT dans Firestore (pas de PDF)
  async savePv() {
    const r = this.selectedReunion();
    if (!r?.id) return;
    
    this.savingPv.set(true);
    try {
      // Sauvegarder le texte du PV dans Firestore uniquement
      await this.svc.update(r.id, { pvTexte: this.pvText() });
      
      // Mettre à jour l'état local
      this.reunions.update(l => l.map(x =>
        x.id === r.id ? { ...x, pvTexte: this.pvText() } : x
      ));
      
      this.showPvModal.set(false);
    } finally {
      this.savingPv.set(false);
    }
  }

  async supprimerReunion(r: Reunion) {
    if (!r.id) return;
    await this.svc.delete(r.id);
    this.reunions.update(l => l.filter(x => x.id !== r.id));
    this.showDetailModal.set(false);
  }

  closeModals() { 
    this.showCreateModal.set(false); 
    this.showDetailModal.set(false); 
    this.showPvModal.set(false); 
  }

  // Helpers
  typeLabel(t: ReunionType)   { return ReunionService.typeLabel(t); }
  typeIcon(t: ReunionType)    { return ReunionService.typeIcon(t); }
  statutColor(s: ReunionStatut) { return ReunionService.statutColor(s); }
  statutLabel(s: ReunionStatut) { return ReunionService.statutLabel(s); }

  // Pagination helpers
  setPage(page: number): void { this.pagination.setPage(page); }
  setPageSize(size: number): void { this.pagination.setPageSize(size); }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', { 
      weekday:'long', 
      day:'2-digit', 
      month:'long', 
      year:'numeric' 
    });
  }

  formatDateCourt(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', { 
      day:'2-digit', 
      month:'short', 
      year:'numeric' 
    });
  }

  dureeTotale(odj: PointOdj[]): number { 
    return odj.reduce((s, p) => s + (p.dureeMinutes || 0), 0); 
  }

  private genererPvTemplate(r: Reunion): string {
    const lignesOdj = r.ordre_du_jour.map((p, i) => 
      `${i+1}. ${p.titre}${p.decision ? '\n   → Décision : ' + p.decision : ''}`
    ).join('\n');
    
    const lignesPart = r.participants
      .filter(p => p.present)
      .map(p => `  - ${p.nom}${p.role ? ' (' + p.role + ')' : ''}`)
      .join('\n');
    
    return `PROCÈS-VERBAL DE RÉUNION
══════════════════════════════════════════

Type         : ${this.typeLabel(r.type)}
Date         : ${this.formatDate(r.date)}
Heure        : ${r.heureDebut}${r.heureFin ? ' – ' + r.heureFin : ''}
Lieu         : ${r.lieu}

PARTICIPANTS PRÉSENTS :
${lignesPart || '  (à compléter)'}

ORDRE DU JOUR :
${lignesOdj || '  (à compléter)'}

DÉLIBÉRATIONS :
══════════════════════════════════════════
(Compléter les délibérations ici)

Fait à __________, le ${this.formatDateCourt(r.date)}
Signature du Secrétaire de séance : ________________`;
  }

  // Signal setters
  setNouveauPointTitre(value: string) {
    this.nouveauPoint.update(p => ({ ...p, titre: value }));
  }

  setNouveauPointDuree(value: string | number) {
    const num = typeof value === 'number' ? value : +value;
    this.nouveauPoint.update(p => ({ ...p, dureeMinutes: isNaN(num) ? 0 : num }));
  }

  setNouveauPointNecessiteVote(value: boolean) {
    this.nouveauPoint.update(p => ({ ...p, necessite_vote: !!value }));
  }


}