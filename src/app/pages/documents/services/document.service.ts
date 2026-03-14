/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  document.service.ts  — VERSION CLOUDINARY                  ║
 * ║  Chemin : src/app/pages/documents/services/document.service ║
 * ║                                                             ║
 * ║  CHANGEMENTS vs version Firebase Storage :                  ║
 * ║  ✅ Supprimé : getStorage, uploadBytesResumable,            ║
 * ║              getDownloadURL, deleteObject                   ║
 * ║  ✅ Ajouté  : CloudinaryService.upload()                    ║
 * ║  ✅ Ajouté  : cloudinaryId dans DocumentCopro               ║
 * ║  ✅ Ajouté  : getUrlMiniature(), getUrlTelechargement()     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  addDoc, collection, deleteDoc, doc, getDoc,
  getDocs, getFirestore, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { firebaseConfig }    from '../../../../environments/firebase';
import { CloudinaryService, CloudinaryDossier } from '../../../shared/services/cloudinary.service';
import { AlerteService } from '../../notifications/services/alerte.service';

// ══ TYPES ════════════════════════════════════════════════════════════════════

export type DocumentCategorie =
  | 'PV_AG'
  | 'CONTRAT'
  | 'REGLEMENT'
  | 'FACTURE'
  | 'RECU'
  | 'AUTRE';

export type DocumentStatut = 'ACTIF' | 'ARCHIVE';

export interface DocumentCopro {
  id?:            string;
  titre:          string;
  description?:   string;
  categorie:      DocumentCategorie;
  statut:         DocumentStatut;
  // ── Champs Cloudinary (remplacent Firebase Storage URL) ──
  fileUrl:        string;    // secure_url Cloudinary (permanente)
  cloudinaryId:   string;    // public_id  Cloudinary (pour transformations)
  cloudinaryDeleteToken?: string; // token de suppression (preset doit l'exposer)
  fileName:       string;
  fileSize:       number;
  fileType:       string;
  // ── Métadonnées ──
  uploaderNom?:   string;
  uploaderId?:    string;
  annee?:         number;
  mois?:          number;
  tags?:          string[];
  createdAt?:     string;
  updatedAt?:     string;
}

export interface DocumentPayload {
  titre:        string;
  description?: string;
  categorie:    DocumentCategorie;
  annee?:       number;
  mois?:        number;
  tags?:        string[];
  uploaderNom?: string;
  uploaderId?:  string;
}

// Mapping catégorie → dossier Cloudinary
const DOSSIER_MAP: Record<DocumentCategorie, CloudinaryDossier> = {
  PV_AG:     'syndic/reunions',
  CONTRAT:   'syndic/documents',
  REGLEMENT: 'syndic/documents',
  FACTURE:   'syndic/documents',
  RECU:      'syndic/recus',
  AUTRE:     'syndic/documents',
};

// ══ SERVICE ══════════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class DocumentService {

  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly COL = 'documents';

  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly alerteSvc: AlerteService,
  ) {}

  // ── Lecture ───────────────────────────────────────────────────────────────

  async getAll(): Promise<DocumentCopro[]> {
    const q = query(collection(this.db, this.COL), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentCopro));
  }

  async getByCategorie(categorie: DocumentCategorie): Promise<DocumentCopro[]> {
    const q = query(
      collection(this.db, this.COL),
      where('categorie', '==', categorie),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentCopro));
  }

  // ── Création : upload Cloudinary + sauvegarde Firestore ──────────────────

  /**
   * 1. Valide le fichier
   * 2. Upload vers Cloudinary (XHR avec suivi de progression)
   * 3. Sauvegarde les métadonnées dans Firestore (collection 'documents')
   * 4. Retourne le DocumentCopro complet avec l'ID Firestore
   */
  async create(
    payload:     DocumentPayload,
    file:        File,
    onProgress?: (p: number) => void,
  ): Promise<DocumentCopro> {

    // Validation
    const erreur = this.cloudinary.validerFichier(file, { tailleMaxMo: 10 });
    if (erreur) throw new Error(erreur);

    onProgress?.(5);

    // Upload Cloudinary
    const dossier    = DOSSIER_MAP[payload.categorie] ?? 'syndicpro/documents';
    const uploaderId = payload.uploaderId || 'anonymous';
    const cloudResult = await this.cloudinary.upload(file, dossier, uploaderId);

    onProgress?.(85);

    // Sauvegarde Firestore
    const now  = new Date().toISOString();
    const data: Omit<DocumentCopro, 'id'> = {
      ...payload,
      fileUrl:      cloudResult.secure_url,  // ← URL Cloudinary permanente
      cloudinaryId: cloudResult.public_id,   // ← Pour getUrlMiniature() et getUrlTelechargement()
      cloudinaryDeleteToken: cloudResult.delete_token,
      fileName:     file.name,
      fileSize:     cloudResult.bytes,
      fileType:     file.type,
      statut:       'ACTIF',
      createdAt:    now,
      updatedAt:    now,
    };

    // Remove undefined fields because Firestore rejects undefined values
    const payloadForFirestore: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) payloadForFirestore[k] = v;
    }

    const docRef = await addDoc(collection(this.db, this.COL), {
      ...payloadForFirestore,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    onProgress?.(100);

    // ── Notification : nouveau document uploadé ──
    this.alerteSvc.alerteNouveauDocument({
      documentId: docRef.id,
      nomDocument: payload.titre,
      categorie: payload.categorie,
      uploadePar: payload.uploaderNom || 'Inconnu',
    }).catch(err => console.error('[Alerte] Erreur nouveau document:', err));

    return { id: docRef.id, ...(payloadForFirestore as any) } as DocumentCopro;
  }

  // ── Mise à jour ───────────────────────────────────────────────────────────

  async update(id: string, payload: Partial<DocumentPayload>): Promise<void> {
    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload || {})) {
      if (v !== undefined) sanitized[k] = v;
    }
    await updateDoc(doc(this.db, this.COL, id), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
  }

  async archiver(id: string): Promise<void> {
    await updateDoc(doc(this.db, this.COL, id), {
      statut:    'ARCHIVE',
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Supprime le document de Firestore ET de Cloudinary.
   */
  async delete(id: string, cloudinaryId?: string): Promise<void> {
    // 1. Si cloudinaryId non fourni, tenter de le récupérer depuis Firestore
    const docRef = doc(this.db, this.COL, id);
    if (!cloudinaryId) {
      const docSnap = await getDoc(docRef);
      const data = docSnap.exists() ? docSnap.data() : null;
      cloudinaryId = data?.['cloudinaryId'] as string | undefined;
    }

    // 2. Supprimer de Firestore
    await deleteDoc(docRef);

    // 3. Cloudinary : les fichiers ne peuvent pas être supprimés côté client (401).
    //    On log le public_id pour nettoyage manuel ou via script serveur.
    if (cloudinaryId) {
      this.cloudinary.logOrphanedAsset(cloudinaryId);
    }
  }

  // ── URL Cloudinary optimisées ─────────────────────────────────────────────

  /**
   * URL miniature optimisée :
   * - PDF  → première page rendue en image JPG
   * - Image → miniature WebP 300px recadrée
   * - Autres → '' (pas de prévisualisation possible)
   */
  getUrlMiniature(document: DocumentCopro, largeur = 300): string {
    if (!document.cloudinaryId) return document.fileUrl;
    if (document.fileType === 'application/pdf') {
      return this.cloudinary.getUrlPreviewPdf(document.cloudinaryId, largeur);
    }
    if (document.fileType.startsWith('image/')) {
      return this.cloudinary.getUrlTransformee(document.cloudinaryId, {
        largeur,
        hauteur:   Math.round(largeur * 0.7),
        recadrage: 'fill',
        format:    'webp',
        qualite:   'auto',
      });
    }
    return '';
  }

  /**
   * URL de téléchargement forcé (Content-Disposition: attachment).
   * Fonctionne pour PDF, images, Excel, Word.
   */
  getUrlTelechargement(document: DocumentCopro): string {
    if (!document.cloudinaryId) return document.fileUrl;
    return this.cloudinary.getUrlTelechargement(document.cloudinaryId, document.fileName);
  }

  // ── Helpers statiques UI ──────────────────────────────────────────────────

  static getCategorieLabel(c: DocumentCategorie): string {
    return ({
      PV_AG:     "Procès-verbaux d'AG",
      CONTRAT:   'Contrats & prestataires',
      REGLEMENT: 'Règlements',
      FACTURE:   'Factures & devis',
      RECU:      'Reçus de paiement',
      AUTRE:     'Autres',
    } as Record<DocumentCategorie, string>)[c] ?? c;
  }

  static getCategorieIcon(c: DocumentCategorie): string {
    return ({
      PV_AG:     '📋',
      CONTRAT:   '📝',
      REGLEMENT: '⚖️',
      FACTURE:   '🧾',
      RECU:      '💳',
      AUTRE:     '📁',
    } as Record<DocumentCategorie, string>)[c] ?? '📄';
  }

  static getCategorieColor(c: DocumentCategorie): string {
    return ({
      PV_AG:     'bg-blue-100 text-blue-800',
      CONTRAT:   'bg-purple-100 text-purple-800',
      REGLEMENT: 'bg-amber-100 text-amber-800',
      FACTURE:   'bg-orange-100 text-orange-800',
      RECU:      'bg-emerald-100 text-emerald-800',
      AUTRE:     'bg-slate-100 text-slate-600',
    } as Record<DocumentCategorie, string>)[c] ?? 'bg-slate-100 text-slate-600';
  }

  static formatFileSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
}