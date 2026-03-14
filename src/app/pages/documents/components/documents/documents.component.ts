/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  documents.component.ts  — VERSION CLOUDINARY               ║
 * ║  Chemin : src/app/pages/documents/                          ║
 * ║                                                             ║
 * ║  CHANGEMENTS vs version originale :                         ║
 * ║  ✅ Inject CloudinaryService (validation + miniatures)      ║
 * ║  ✅ openFile/downloadFile prennent DocumentCopro (pas url)  ║
 * ║  ✅ getMiniatureUrl() → URL Cloudinary optimisée            ║
 * ║  ✅ Prévisualisation locale images (FileReader)             ║
 * ║  ✅ executeDelete() sans fileUrl (Firestore only)           ║
 * ║  ✅ Validation fichier côté client avant submitUpload()     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit,
  computed, signal, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  DocumentService,
  DocumentCopro,
  DocumentCategorie,
  DocumentPayload,
} from '../../services/document.service';
import { CloudinaryService } from '../../../../shared/services/cloudinary.service';
import { Auth } from '../../../../core/services/auth';

type ViewMode  = 'grille' | 'liste';
type SortField = 'date' | 'titre' | 'taille' | 'categorie';
interface ToastMsg { id: number; type: 'success' | 'error' | 'info'; message: string; }

@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './documents.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsComponent implements OnInit {

  private readonly auth = inject(Auth);
  private readonly cdr  = inject(ChangeDetectorRef);

  // ── Données ───────────────────────────────────────────────────────────────
  readonly documents      = signal<DocumentCopro[]>([]);
  readonly loading        = signal(true);
  readonly uploadProgress = signal<number>(0);
  readonly uploading      = signal(false);
  readonly selectedFile   = signal<File | null>(null);
  readonly previewUrl     = signal<string | null>(null); // ← NOUVEAU : aperçu local image

  // ── UI ────────────────────────────────────────────────────────────────────
  readonly searchTerm        = signal('');
  readonly selectedCategorie = signal<DocumentCategorie | 'toutes'>('toutes');
  readonly selectedStatut    = signal<'ACTIF' | 'ARCHIVE' | 'tous'>('ACTIF');
  readonly selectedAnnee     = signal<number | 'toutes'>('toutes');
  readonly sortField         = signal<SortField>('date');
  readonly sortDesc          = signal(true);
  readonly viewMode          = signal<ViewMode>('grille');
  readonly pageCurrent       = signal(1);
  readonly pageSize          = signal(12);

  // ── Modals ────────────────────────────────────────────────────────────────
  readonly showUploadModal   = signal(false);
  readonly showDetailModal   = signal(false);
  readonly showDeleteConfirm = signal(false);
  readonly selectedDoc       = signal<DocumentCopro | null>(null);
  readonly toasts            = signal<ToastMsg[]>([]);

  // ── Formulaire upload ─────────────────────────────────────────────────────
  readonly uploadForm = new FormGroup({
    titre:       new FormControl('', [Validators.required, Validators.minLength(3)]),
    description: new FormControl(''),
    categorie:   new FormControl<DocumentCategorie>('AUTRE', Validators.required),
    annee:       new FormControl<number | null>(new Date().getFullYear()),
    mois:        new FormControl<number | null>(null),
    tags:        new FormControl(''),
  });

  readonly categories: DocumentCategorie[] = ['PV_AG', 'CONTRAT', 'REGLEMENT', 'FACTURE', 'RECU', 'AUTRE'];
  readonly moisLabels = [
    '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];

  // ── Computed : filtre + tri ───────────────────────────────────────────────
  readonly filteredDocuments = computed<DocumentCopro[]>(() => {
    let docs = this.documents();
    if (this.selectedStatut() !== 'tous')
      docs = docs.filter(d => d.statut === this.selectedStatut());
    if (this.selectedCategorie() !== 'toutes')
      docs = docs.filter(d => d.categorie === this.selectedCategorie());
    if (this.selectedAnnee() !== 'toutes')
      docs = docs.filter(d => d.annee === this.selectedAnnee());
    const term = this.searchTerm().toLowerCase().trim();
    if (term)
      docs = docs.filter(d =>
        d.titre.toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term) ||
        (d.tags || []).some(t => t.toLowerCase().includes(term)) ||
        d.fileName.toLowerCase().includes(term)
      );
    return [...docs].sort((a, b) => {
      let cmp = 0;
      switch (this.sortField()) {
        case 'date': {
          const timeA = this.createdAtMs(a);
          const timeB = this.createdAtMs(b);
          cmp = timeA - timeB;
          break;
        }
        case 'titre':     cmp = a.titre.localeCompare(b.titre); break;
        case 'taille':    cmp = (a.fileSize || 0) - (b.fileSize || 0); break;
        case 'categorie': cmp = a.categorie.localeCompare(b.categorie); break;
      }
      return this.sortDesc() ? -cmp : cmp;
    });
  });

  // ── Computed : pagination ─────────────────────────────────────────────────
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredDocuments().length / this.pageSize()))
  );
  readonly pagedDocuments = computed<DocumentCopro[]>(() => {
    const start = (this.pageCurrent() - 1) * this.pageSize();
    return this.filteredDocuments().slice(start, start + this.pageSize());
  });
  readonly pageNumbers = computed<number[]>(() => {
    const total = this.totalPages(), cur = this.pageCurrent();
    const start = Math.max(1, cur - 2), end = Math.min(total, start + 4);
    const p: number[] = [];
    for (let i = start; i <= end; i++) p.push(i);
    return p;
  });
  readonly firstIndex = computed(() =>
    this.filteredDocuments().length === 0 ? 0 : (this.pageCurrent() - 1) * this.pageSize() + 1
  );
  readonly lastIndex = computed(() =>
    Math.min(this.pageCurrent() * this.pageSize(), this.filteredDocuments().length)
  );

  // ── Computed : KPIs ───────────────────────────────────────────────────────
  readonly kpiTotal = computed(() => this.documents().filter(d => d.statut === 'ACTIF').length);
  readonly kpiParCategorie = computed(() => {
    const map = new Map<DocumentCategorie, number>();
    for (const d of this.documents().filter(d => d.statut === 'ACTIF'))
      map.set(d.categorie, (map.get(d.categorie) ?? 0) + 1);
    return map;
  });
  readonly kpiTotalSize = computed(() =>
    this.documents().reduce((s, d) => s + (d.fileSize || 0), 0)
  );
  readonly anneesDisponibles = computed<number[]>(() => {
    const s = new Set<number>();
    this.documents().forEach(d => { if (d.annee) s.add(d.annee); });
    return Array.from(s).sort((a, b) => b - a);
  });

  constructor(
    private readonly documentService:  DocumentService,
    public  readonly cloudinaryService: CloudinaryService, // public → accessible dans le template
  ) {}

  async ngOnInit() { await this.loadDocuments(); }

  // ── Chargement ────────────────────────────────────────────────────────────

  async loadDocuments() {
    this.loading.set(true);
    try {
      this.documents.set(await this.documentService.getAll());
    } catch {
      this.pushToast('error', 'Impossible de charger les documents.');
    } finally {
      this.loading.set(false);
      this.cdr.markForCheck();
    }
  }

  // ── Filtres & navigation ──────────────────────────────────────────────────

  onSearch(e: Event)   { this.searchTerm.set((e.target as HTMLInputElement).value); this.pageCurrent.set(1); }
  clearSearch()        { this.searchTerm.set(''); this.pageCurrent.set(1); }
  setCategorie(c: DocumentCategorie | 'toutes') { this.selectedCategorie.set(c); this.pageCurrent.set(1); }
  setStatut(s: 'ACTIF' | 'ARCHIVE' | 'tous')   { this.selectedStatut.set(s); this.pageCurrent.set(1); }
  setAnnee(a: number | 'toutes')                { this.selectedAnnee.set(a); this.pageCurrent.set(1); }
  setSort(f: SortField) {
    this.sortField() === f
      ? this.sortDesc.update(v => !v)
      : (this.sortField.set(f), this.sortDesc.set(true));
  }
  setView(v: ViewMode) { this.viewMode.set(v); }
  goToPage(p: number)  { if (p >= 1 && p <= this.totalPages()) this.pageCurrent.set(p); }
  prevPage()           { this.goToPage(this.pageCurrent() - 1); }
  nextPage()           { this.goToPage(this.pageCurrent() + 1); }
  resetFilters() {
    this.searchTerm.set(''); this.selectedCategorie.set('toutes');
    this.selectedStatut.set('ACTIF'); this.selectedAnnee.set('toutes');
    this.sortField.set('date'); this.sortDesc.set(true); this.pageCurrent.set(1);
  }

  // Convertit createdAt en timestamp numérique pour les tris (gère string | Date | Firestore Timestamp)
  private createdAtMs(d: DocumentCopro): number {
    const c: any = d.createdAt;
    if (!c) return 0;
    if (typeof c === 'string') {
      const t = Date.parse(c);
      return Number.isNaN(t) ? 0 : t;
    }
    if (c instanceof Date) return c.getTime();
    if (typeof c.toDate === 'function') return c.toDate().getTime(); // Firestore Timestamp
    return 0;
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  openUploadModal() {
    this.uploadForm.reset({ categorie: 'AUTRE', annee: new Date().getFullYear() });
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.uploadProgress.set(0);
    this.showUploadModal.set(true);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;

    // ✅ Validation immédiate côté client via CloudinaryService
    const erreur = this.cloudinaryService.validerFichier(file, {
      tailleMaxMo: 10,
      typesAcceptes: [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',
      ],
    });
    if (erreur) { this.pushToast('error', erreur); return; }

    this.selectedFile.set(file);

    // Pré-remplir le titre avec le nom du fichier (sans extension)
    if (!this.uploadForm.get('titre')?.value) {
      this.uploadForm.patchValue({
        titre: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
      });
    }

    // ✅ Prévisualisation locale pour les images (avant upload)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => { this.previewUrl.set(reader.result as string); this.cdr.markForCheck(); };
      reader.readAsDataURL(file);
    } else {
      this.previewUrl.set(null);
    }
  }

  async submitUpload() {
    if (!this.uploadForm.valid || !this.selectedFile()) return;

    const v = this.uploadForm.value;
    const payload: DocumentPayload = {
      titre:       v.titre!,
      description: v.description || undefined,
      categorie:   v.categorie as DocumentCategorie,
      annee:       v.annee || undefined,
      mois:        v.mois || undefined,
      tags:        v.tags ? v.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
      uploaderNom: this.auth.currentUser?.name || this.auth.currentUser?.email || 'Inconnu',
      uploaderId:  this.auth.currentUser?.firebaseUid || undefined,
    };

    this.uploading.set(true);
    this.uploadProgress.set(0);

    try {
      // ✅ DocumentService.create() → CloudinaryService.upload() → Firestore addDoc()
      const docCreated = await this.documentService.create(payload, this.selectedFile()!, (p) => {
        this.uploadProgress.set(p);
        this.cdr.markForCheck();
      });

      this.documents.update(list => [docCreated, ...list]);
      this.showUploadModal.set(false);
      this.pushToast('success', `✅ "${docCreated.titre}" uploadé sur Cloudinary et sauvegardé.`);

    } catch (e: any) {
      this.pushToast('error', e?.message || "Erreur lors de l'upload.");
    } finally {
      this.uploading.set(false);
      this.uploadProgress.set(0);
      this.selectedFile.set(null);
      this.previewUrl.set(null);
      this.cdr.markForCheck();
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  openDetail(doc: DocumentCopro)    { this.selectedDoc.set(doc); this.showDetailModal.set(true); }
  confirmDelete(doc: DocumentCopro) { this.selectedDoc.set(doc); this.showDeleteConfirm.set(true); }

  async executeDelete() {
    const d = this.selectedDoc();
    if (!d?.id) return;
    try {
      // ✅ Suppression Firestore + log orphan Cloudinary (suppression serveur requise)
      await this.documentService.delete(d.id, d.cloudinaryId);
      this.documents.update(list => list.filter(x => x.id !== d.id));
      this.pushToast('success', `Document "${d.titre}" supprimé de la base. Asset Cloudinary orphelin logué.`);
    } catch {
      this.pushToast('error', 'Erreur lors de la suppression.');
    } finally {
      this.showDeleteConfirm.set(false);
      this.showDetailModal.set(false);
      this.selectedDoc.set(null);
      this.cdr.markForCheck();
    }
  }

  async archiverDoc(doc: DocumentCopro) {
    if (!doc.id) return;
    try {
      await this.documentService.archiver(doc.id);
      this.documents.update(list => list.map(d => d.id === doc.id ? { ...d, statut: 'ARCHIVE' } : d));
      this.pushToast('success', `Document "${doc.titre}" archivé.`);
      this.showDetailModal.set(false);
    } catch { this.pushToast('error', "Erreur lors de l'archivage."); }
    this.cdr.markForCheck();
  }

  /**
   * ✅ Ouvre le fichier dans un nouvel onglet via l'URL Cloudinary directe.
   * Compatible : PDF (rendu natif navigateur), images, Excel (téléchargement).
   */
  openFile(doc: DocumentCopro) {
    window.open(doc.fileUrl, '_blank');
  }

  /**
   * ✅ Téléchargement forcé via URL Cloudinary fl_attachment.
   * Le navigateur déclenche la boîte de téléchargement sans ouvrir l'onglet.
   */
  downloadFile(doc: DocumentCopro) {
    const url = this.documentService.getUrlTelechargement(doc);
    const a   = document.createElement('a');
    a.href = url; a.download = doc.fileName; a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /**
   * ✅ URL miniature Cloudinary optimisée :
   * - Image → WebP redimensionné
   * - PDF   → première page en JPG
   * - Autre → '' (icône fallback)
   */
  getMiniatureUrl(doc: DocumentCopro): string {
    return this.documentService.getUrlMiniature(doc, 300);
  }

  closeModals() {
    this.showUploadModal.set(false); this.showDetailModal.set(false);
    this.showDeleteConfirm.set(false); this.selectedDoc.set(null);
    this.uploading.set(false); this.uploadProgress.set(0);
    this.selectedFile.set(null); this.previewUrl.set(null);
  }

  // ── Helpers UI ────────────────────────────────────────────────────────────

  getCategorieLabel(c: DocumentCategorie): string { return DocumentService.getCategorieLabel(c); }
  getCategorieIcon(c: DocumentCategorie): string  { return DocumentService.getCategorieIcon(c); }
  getCategorieColor(c: DocumentCategorie): string { return DocumentService.getCategorieColor(c); }
  formatFileSize(b: number): string               { return DocumentService.formatFileSize(b); }

  formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  getFileIcon(mime: string): string {
    if (mime === 'application/pdf')                           return '📄';
    if (mime.startsWith('image/'))                           return '🖼️';
    if (mime.includes('word') || mime.includes('document'))  return '📝';
    if (mime.includes('sheet') || mime.includes('excel'))    return '📊';
    if (mime.includes('zip')  || mime.includes('compressed')) return '🗜️';
    return '📁';
  }

  isPreviewable(mime: string): boolean {
    return mime === 'application/pdf' || mime.startsWith('image/');
  }

  sortIndicator(field: SortField): string {
    if (this.sortField() !== field) return '';
    return this.sortDesc() ? ' ↓' : ' ↑';
  }

  private pushToast(type: 'success' | 'error' | 'info', message: string) {
    const id = Date.now();
    this.toasts.update(l => [...l, { id, type, message }]);
    setTimeout(() => this.toasts.update(l => l.filter(t => t.id !== id)), 5000);
  }
}