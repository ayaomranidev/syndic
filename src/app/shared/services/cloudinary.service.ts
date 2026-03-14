/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  cloudinary.service.ts                                      ║
 * ║  Chemin : src/app/shared/services/cloudinary.service.ts     ║
 * ║  Upload direct côté client — pas de backend nécessaire      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CONFIGURATION CLOUDINARY (à faire 1 seule fois) :
 * ─────────────────────────────────────────────────
 * 1. https://cloudinary.com → Sign Up Free
 * 2. Dashboard → Settings → Upload → Add upload preset
 *    - Signing Mode  : "Unsigned"  ← OBLIGATOIRE
 *    - Preset name   : "syndicpro"
 *    - Folder        : "syndic"
 *    - Allowed formats : jpg,jpeg,png,webp,pdf,xlsx,xls,doc,docx
 *    - Max file size : 10485760 (10 Mo)
 * 3. Copier votre Cloud Name depuis le Dashboard
 * 4. Remplacer CLOUDINARY_CLOUD_NAME ci-dessous
 */

import { Injectable, signal } from '@angular/core';

// ══ CONFIGURATION — À PERSONNALISER ══════════════════════════════════════════
export const CLOUDINARY_CLOUD_NAME    = 'ddp41xqud';     // Votre cloud name
export const CLOUDINARY_UPLOAD_PRESET = 'syndicpro';    // Preset créé dans le dashboard (mode UNSIGNED)
export const CLOUDINARY_BASE_URL      = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}`;

// ══ TYPES ════════════════════════════════════════════════════════════════════

export type CloudinaryDossier =
  | 'syndic/documents'
  | 'syndic/recus'
  | 'syndic/rapports'
  | 'syndic/photos'
  | 'syndic/avatars'
  | 'syndic/justificatifs'
  | 'syndic/reunions';

export interface CloudinaryUploadResult {
  public_id:         string;
  secure_url:        string;
  url:               string;
  format:            string;
  resource_type:     string;
  bytes:             number;
  width?:            number;
  height?:           number;
  created_at:        string;
  original_filename: string;
  pages?:            number;
  version:           number;
  version_id:        string;
  delete_token?: string; // présent si le preset a "return_delete_token" activé

}

export interface DocumentCloudinary {
  nom:               string;
  type:              'pdf' | 'image' | 'excel' | 'autre';
  dossier:           CloudinaryDossier;
  cloudinaryId:      string;   // public_id → pour les transformations URL
  deleteToken?:      string;   // token de suppression renvoyé par Cloudinary (optionnel)
  url:               string;   // secure_url → à stocker dans Firestore
  taille:            number;
  format:            string;
  residenceId?:      string;
  appartementId?:    string;
  coproprietaireId?: string;
  paiementId?:       string;
  uploadePar:        string;
  createdAt:         string;
  description?:      string;
  tags?:             string[];
}

export interface ProgressionUpload {
  fichier:    string;
  progression: number;
  statut:     'en_cours' | 'termine' | 'erreur';
  url?:       string;
  erreur?:    string;
}

// ══ SERVICE ══════════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class CloudinaryService {

  readonly uploadsEnCours = signal<ProgressionUpload[]>([]);
  readonly isUploading    = signal(false);

  // ── Upload principal ──────────────────────────────────────────────────────

  async upload(
    fichier:  File,
    dossier:  CloudinaryDossier,
    userId:   string,
  ): Promise<CloudinaryUploadResult> {

    this.isUploading.set(true);

    const item: ProgressionUpload = { fichier: fichier.name, progression: 0, statut: 'en_cours' };
    this.uploadsEnCours.update(l => [...l, item]);

    try {
      const resourceType = this.getResourceType(fichier.type);
      const formData     = new FormData();
      formData.append('file',           fichier);
      formData.append('upload_preset',  CLOUDINARY_UPLOAD_PRESET);
      formData.append('folder',         dossier);
      formData.append('tags',           `syndicpro,${userId},${fichier.type.split('/')[0]}`);
      formData.append('context',        `uploaded_by=${userId}|original_name=${fichier.name}`);

      // DEBUG: Vérifier que l'upload_preset est bien envoyé
      console.debug('[Cloudinary] Upload preset:', CLOUDINARY_UPLOAD_PRESET);
      console.debug('[Cloudinary] Dossier:', dossier);
      
      const endpoint = `${CLOUDINARY_BASE_URL}/${resourceType}/upload`;
      console.debug('[Cloudinary] Endpoint:', endpoint);
      
      const result   = await this.xhrUpload(endpoint, formData, fichier.name);

      this.uploadsEnCours.update(l => l.map(i =>
        i.fichier === fichier.name ? { ...i, progression: 100, statut: 'termine', url: result.secure_url } : i
      ));
      return result;

    } catch (err) {
      console.error('[Cloudinary] Erreur upload:', err);
      this.uploadsEnCours.update(l => l.map(i =>
        i.fichier === fichier.name ? { ...i, statut: 'erreur', erreur: (err as Error).message } : i
      ));
      throw err;
    } finally {
      this.isUploading.set(false);
      setTimeout(() => this.uploadsEnCours.update(l => l.filter(i => i.fichier !== fichier.name)), 3500);
    }
  }

  // ── Helpers URL ───────────────────────────────────────────────────────────

  getUrlTransformee(
    publicId: string,
    options: {
      largeur?:   number;
      hauteur?:   number;
      recadrage?: 'fill' | 'fit' | 'thumb' | 'scale';
      format?:    'webp' | 'jpg' | 'png' | 'auto';
      qualite?:   'auto' | number;
      page?:      number;
    } = {},
  ): string {
    const { largeur, hauteur, recadrage = 'fill', format = 'auto', qualite = 'auto', page } = options;
    const t: string[] = [];
    if (largeur || hauteur) {
      let s = `c_${recadrage}`;
      if (largeur) s += `,w_${largeur}`;
      if (hauteur) s += `,h_${hauteur}`;
      t.push(s);
    }
    t.push(`f_${format}`, `q_${qualite}`);
    if (page) t.push(`pg_${page}`);
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${t.join('/')}/${publicId}`;
  }

  getUrlAvatar(publicId: string, taille = 80): string {
    return this.getUrlTransformee(publicId, { largeur: taille, hauteur: taille, recadrage: 'thumb', format: 'webp', qualite: 'auto' });
  }

  getUrlPreviewPdf(publicId: string, largeur = 400): string {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fit,w_${largeur},f_jpg,q_auto,pg_1/${publicId}`;
  }

  getUrlTelechargement(publicId: string, nomFichier: string): string {
    const name = encodeURIComponent(nomFichier);
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload/fl_attachment:${name}/${publicId}`;
  }

  /**
   * ⚠️ La suppression Cloudinary nécessite une signature côté serveur
   * (API key + secret). Impossible depuis le frontend.
   * Les fichiers orphelins peuvent être nettoyés via :
   *  - Le dashboard Cloudinary (Media Library → Delete)
   *  - Un script Node.js avec cloudinary.uploader.destroy(publicId)
   *  - Une Firebase Cloud Function déclenchée sur suppression Firestore
   */
  logOrphanedAsset(publicId: string): void {
    console.warn(
      `[Cloudinary] Fichier orphelin (non supprimé de Cloudinary) : ${publicId}. ` +
      `Supprimez-le manuellement depuis le dashboard ou via un script serveur.`
    );
  }

  // ── Validation ────────────────────────────────────────────────────────────

  validerFichier(
    fichier: File,
    options: { tailleMaxMo?: number; typesAcceptes?: string[] } = {},
  ): string | null {
    const { tailleMaxMo = 10, typesAcceptes } = options;
    const tailleMo = fichier.size / (1024 * 1024);
    if (tailleMo > tailleMaxMo)
      return `Fichier trop volumineux : ${tailleMo.toFixed(1)} Mo (max ${tailleMaxMo} Mo)`;
    if (typesAcceptes && !typesAcceptes.includes(fichier.type))
      return `Type non autorisé : ${fichier.type}`;
    return null;
  }

  // ── Utilitaires ───────────────────────────────────────────────────────────

  getResourceType(mimeType: string): 'image' | 'video' | 'raw' | 'auto' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    // 'auto' évite le 401 sur /raw/upload quand le preset n'autorise pas raw
    return 'auto';
  }

  getTypeDocument(mimeType: string): DocumentCloudinary['type'] {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('image/'))  return 'image';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'excel';
    return 'autre';
  }

  formatTaille(bytes: number): string {
    if (bytes < 1024)        return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  getIcone(type: DocumentCloudinary['type'], format: string): string {
    if (type === 'pdf')                    return '📄';
    if (type === 'image')                  return '🖼️';
    if (type === 'excel' || format === 'xlsx') return '📊';
    return '📎';
  }

  // ── XHR avec suivi de progression ────────────────────────────────────────

  private xhrUpload(url: string, formData: FormData, nomFichier: string): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const p = Math.round((e.loaded / e.total) * 100);
          this.uploadsEnCours.update(l => l.map(i => i.fichier === nomFichier ? { ...i, progression: p } : i));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as CloudinaryUploadResult);
        } else {
          console.error('[Cloudinary] upload failed', xhr.status, xhr.responseText);
          let errMsg = `Erreur HTTP ${xhr.status}`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body && body.error && body.error.message) errMsg = body.error.message;
          } catch (e) {
            // ignore parse errors, keep generic message
          }
          reject(new Error(errMsg));
        }
      });

      xhr.addEventListener('error', () => reject(new Error("Erreur réseau lors de l'upload")));
      xhr.open('POST', url);
      xhr.send(formData);
    });
  }
}