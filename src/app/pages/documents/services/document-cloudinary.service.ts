/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  document-cloudinary.service.ts                             ║
 * ║  Gestion des documents : Upload Cloudinary + CRUD Firestore ║
 * ║  Couplage : Cloudinary (fichiers) + Firestore (métadonnées) ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { Injectable, inject } from '@angular/core';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { firebaseConfig }           from '../../../../environments/firebase';
import {
  CloudinaryService,
  DocumentCloudinary,
  CloudinaryDossier,
  CloudinaryUploadResult,
} from '../../../shared/services/cloudinary.service';
import { AlerteService } from '../../notifications/services/alerte.service';

// ── Types étendus ─────────────────────────────────────────────────────────────

export type CategorieDocument =
  | 'pv_reunion'          // Procès-verbaux de réunions
  | 'contrat'             // Contrats (entretien, assurance...)
  | 'facture'             // Factures de charges
  | 'recu_paiement'       // Reçus de paiement copropriétaires
  | 'rapport_financier'   // Rapports financiers exportés
  | 'reglement'           // Règlement de copropriété
  | 'assurance'           // Documents d'assurance
  | 'convocation'         // Convocations aux réunions
  | 'justificatif'        // Justificatifs divers
  | 'photo'               // Photos résidences/appartements
  | 'avatar'              // Photos de profil
  | 'autre';

export interface DocumentFirestore extends DocumentCloudinary {
  id: string;             // ID Firestore auto-généré
  categorie: CategorieDocument;
  visibilite: 'admin' | 'tous';   // Qui peut voir ce document
  archived: boolean;
}

export interface FiltresDocuments {
  residenceId?: string;
  appartementId?: string;
  coproprietaireId?: string;
  paiementId?: string;
  categorie?: CategorieDocument;
  type?: DocumentCloudinary['type'];
  visibilite?: 'admin' | 'tous';
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class DocumentCloudinaryService {

  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly db  = getFirestore(this.app);
  private readonly docsCol = collection(this.db, 'documents');
  private readonly alerteSvc = inject(AlerteService);

  constructor(private readonly cloudinary: CloudinaryService) {}

  // ─── UPLOAD + SAUVEGARDER EN FIRESTORE ────────────────────────────────────

  /**
   * Upload un fichier vers Cloudinary ET sauvegarde les métadonnées dans Firestore.
   * C'est LA méthode principale à appeler depuis vos composants.
   *
   * USAGE :
   *   const doc = await this.documentService.uploadEtSauvegarder(
   *     fichier,
   *     'syndicpro/recus',
   *     {
   *       nom: 'Reçu paiement janvier 2025',
   *       categorie: 'recu_paiement',
   *       paiementId: 'PAY-2025-0012',
   *       appartementId: 'apt123',
   *       uploadePar: user.uid,
   *     }
   *   );
   *   // doc.url → URL permanente Cloudinary
   */
  async uploadEtSauvegarder(
    fichier: File,
    dossier: CloudinaryDossier,
    metadonnees: {
      nom: string;
      categorie: CategorieDocument;
      uploadePar: string;
      residenceId?: string;
      appartementId?: string;
      coproprietaireId?: string;
      paiementId?: string;
      description?: string;
      visibilite?: 'admin' | 'tous';
      tags?: string[];
    },
  ): Promise<DocumentFirestore> {

    // 1. Valider le fichier
    const erreurValidation = this.cloudinary.validerFichier(fichier, {
      tailleMaxMo: 10,
      typesAcceptes: [
        'image/jpeg', 'image/png', 'image/webp',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
    });
    if (erreurValidation) throw new Error(erreurValidation);

    // 2. Upload vers Cloudinary
    const cloudResult: CloudinaryUploadResult = await this.cloudinary.upload(
      fichier,
      dossier,
      metadonnees.uploadePar,
    );

    // 3. Construire l'objet document
    const document: Omit<DocumentFirestore, 'id'> = {
      nom:               metadonnees.nom || fichier.name,
      type:              this.cloudinary.getTypeDocument(fichier.type),
      dossier,
      categorie:         metadonnees.categorie,
      cloudinaryId:      cloudResult.public_id,
      deleteToken:       cloudResult.delete_token,
      url:               cloudResult.secure_url,
      taille:            cloudResult.bytes,
      format:            cloudResult.format,
      residenceId:       metadonnees.residenceId,
      appartementId:     metadonnees.appartementId,
      coproprietaireId:  metadonnees.coproprietaireId,
      paiementId:        metadonnees.paiementId,
      uploadePar:        metadonnees.uploadePar,
      description:       metadonnees.description,
      tags:              metadonnees.tags,
      visibilite:        metadonnees.visibilite ?? 'admin',
      archived:          false,
      createdAt:         new Date().toISOString(),
    };

    // 4. Sauvegarder dans Firestore (collection 'documents')
    const docRef = await addDoc(this.docsCol, {
      ...document,
      createdAt: serverTimestamp(),
    });

    // 5. Créer une alerte : nouveau document uploadé
    this.alerteSvc.alerteNouveauDocument({
      documentId: docRef.id,
      nomDocument: metadonnees.nom || fichier.name,
      categorie: metadonnees.categorie,
      uploadePar: metadonnees.uploadePar,
    }).catch(err => console.error('[Alerte] Erreur nouveau document:', err));

    return { ...document, id: docRef.id };
  }

  // ─── LIRE les documents ────────────────────────────────────────────────────

  /** Charge tous les documents selon des filtres optionnels */
  async chargerDocuments(filtres: FiltresDocuments = {}): Promise<DocumentFirestore[]> {
    let q: any = this.docsCol;
    const conditions: any[] = [where('archived', '==', false)];

    if (filtres.residenceId)      conditions.push(where('residenceId', '==', filtres.residenceId));
    if (filtres.appartementId)    conditions.push(where('appartementId', '==', filtres.appartementId));
    if (filtres.coproprietaireId) conditions.push(where('coproprietaireId', '==', filtres.coproprietaireId));
    if (filtres.paiementId)       conditions.push(where('paiementId', '==', filtres.paiementId));
    if (filtres.categorie)        conditions.push(where('categorie', '==', filtres.categorie));
    if (filtres.type)             conditions.push(where('type', '==', filtres.type));
    if (filtres.visibilite)       conditions.push(where('visibilite', '==', filtres.visibilite));

    q = query(this.docsCol, ...conditions, orderBy('createdAt', 'desc'));

    const snap = await getDocs(q);
    return snap.docs.map(d => this.fromFirestore(d.id, d.data()));
  }

  /** Charge un document par son ID Firestore */
  async chargerParId(id: string): Promise<DocumentFirestore | null> {
    const snap = await getDoc(doc(this.db, 'documents', id));
    if (!snap.exists()) return null;
    return this.fromFirestore(snap.id, snap.data());
  }

  /** Charge les reçus de paiement d'un appartement */
  async chargerRecusPaiement(appartementId: string): Promise<DocumentFirestore[]> {
    return this.chargerDocuments({ appartementId, categorie: 'recu_paiement' });
  }

  /** Charge les PV et convocations d'une résidence */
  async chargerDocumentsReunion(residenceId: string): Promise<DocumentFirestore[]> {
    const q = query(
      this.docsCol,
      where('residenceId', '==', residenceId),
      where('categorie', 'in', ['pv_reunion', 'convocation']),
      where('archived', '==', false),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => this.fromFirestore(d.id, d.data()));
  }

  /** Charge les rapports financiers */
  async chargerRapports(): Promise<DocumentFirestore[]> {
    return this.chargerDocuments({ categorie: 'rapport_financier' });
  }

  // ─── MODIFIER / ARCHIVER ──────────────────────────────────────────────────

  /** Met à jour les métadonnées d'un document (pas le fichier lui-même) */
  async modifierMetadonnees(
    id: string,
    payload: Partial<Pick<DocumentFirestore, 'nom' | 'description' | 'categorie' | 'visibilite' | 'tags'>>,
  ): Promise<void> {
    await updateDoc(doc(this.db, 'documents', id), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
  }

  /** Archive un document (ne le supprime pas de Cloudinary) */
  async archiver(id: string): Promise<void> {
    await updateDoc(doc(this.db, 'documents', id), {
      archived: true,
      archivedAt: serverTimestamp(),
    });
  }

  /** Supprime définitivement le document de Firestore ET de Cloudinary */
  async supprimer(id: string): Promise<void> {
    // 1. Récupérer les infos du doc pour retrouver le cloudinaryId
    const docSnap = await getDoc(doc(this.db, 'documents', id));
    const data = docSnap.exists() ? docSnap.data() : null;
    const cloudinaryId = data?.['cloudinaryId'] as string | undefined;
    const fileType = data?.['fileType'] || data?.['type'] || '';

    // 2. Supprimer de Firestore
    await deleteDoc(doc(this.db, 'documents', id));

    // 3. Cloudinary : suppression impossible côté client (nécessite API secret).
    //    On log le public_id orphelin pour nettoyage ultérieur.
    if (cloudinaryId) {
      this.cloudinary.logOrphanedAsset(cloudinaryId);
    }
  }

  // ─── Helpers URL Cloudinary ───────────────────────────────────────────────

  /** URL miniature d'un document (pour les grilles de prévisualisation) */
  getUrlMiniature(document: DocumentFirestore, largeur = 300): string {
    if (document.type === 'pdf') {
      return this.cloudinary.getUrlPreviewPdf(document.cloudinaryId, largeur);
    }
    if (document.type === 'image') {
      return this.cloudinary.getUrlTransformee(document.cloudinaryId, {
        largeur,
        hauteur: Math.round(largeur * 0.7),
        recadrage: 'fill',
        format: 'webp',
        qualite: 'auto',
      });
    }
    return ''; // Excel/Word : pas de prévisualisation
  }

  /** URL de téléchargement forcé */
  getUrlTelechargement(document: DocumentFirestore): string {
    return this.cloudinary.getUrlTelechargement(document.cloudinaryId, document.nom);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private fromFirestore(id: string, data: any): DocumentFirestore {
    return {
      id,
      nom:               data.nom || 'Sans titre',
      type:              data.type || 'autre',
      dossier:           data.dossier || 'syndicpro/documents',
      categorie:         data.categorie || 'autre',
      cloudinaryId:      data.cloudinaryId || '',
      deleteToken:       data.deleteToken,
      url:               data.url || '',
      taille:            Number(data.taille) || 0,
      format:            data.format || '',
      residenceId:       data.residenceId,
      appartementId:     data.appartementId,
      coproprietaireId:  data.coproprietaireId,
      paiementId:        data.paiementId,
      uploadePar:        data.uploadePar || '',
      description:       data.description,
      tags:              data.tags || [],
      visibilite:        data.visibilite || 'admin',
      archived:          data.archived || false,
      createdAt:         data.createdAt?.toDate
        ? data.createdAt.toDate().toISOString()
        : data.createdAt || new Date().toISOString(),
    };
  }
}
