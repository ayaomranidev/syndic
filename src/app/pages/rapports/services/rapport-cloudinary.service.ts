/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  rapport-cloudinary.service.ts                              ║
 * ║  Génération de rapports PDF/Excel + Upload Cloudinary       ║
 * ║  Côté client — pas de backend                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * DÉPENDANCES À INSTALLER :
 *   npm install jspdf jspdf-autotable xlsx
 *   npm install --save-dev @types/jspdf
 */

import { Injectable } from '@angular/core';
import { CloudinaryService }         from '../../../shared/services/cloudinary.service';
import { DocumentCloudinaryService } from '../../../pages/documents/services/document-cloudinary.service';

// Types locaux pour ne pas importer les vraies libs ici
// (elles sont importées dynamiquement pour le lazy loading)
export interface LigneRapportPaiement {
  appartement: string;
  proprietaire: string;
  mois: string;
  montantDu: number;
  montantPaye: number;
  statut: 'Payé' | 'Impayé' | 'Retard' | 'Partiel';
  dateReglement?: string;
  modePaiement?: string;
  reference?: string;
}

export interface LigneRapportDette {
  appartement: string;
  proprietaire: string;
  periode: string;
  montantOriginal: number;
  montantPaye: number;
  montantRestant: number;
  statut: 'PAYEE' | 'PARTIELLEMENT_PAYEE' | 'IMPAYEE';
  nbMoisRetard: number;
}

export interface ParamsRapport {
  titre: string;
  soustitre?: string;
  residenceNom: string;
  periode: string;           // Ex: "Janvier 2025" ou "2025"
  generePar: string;         // Nom de l'admin
  userId: string;            // UID Firebase pour Cloudinary
  residenceId?: string;
  sauvegarderCloudinary?: boolean;   // false = téléchargement local uniquement
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class RapportCloudinaryService {

  constructor(
    private readonly cloudinary:  CloudinaryService,
    private readonly documentSvc: DocumentCloudinaryService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  //  RAPPORTS PDF
  // ═══════════════════════════════════════════════════════════

  /**
   * Génère un rapport PDF des paiements et l'uploade sur Cloudinary.
   *
   * USAGE depuis PaiementsComponent :
   *   await this.rapportService.genererRapportPaiementsPDF(
   *     lignes,
   *     { titre: 'Rapport paiements', residenceNom: 'Résidence Le Parc Royal',
   *       periode: 'Janvier 2025', generePar: 'Admin', userId: user.uid }
   *   );
   */
  async genererRapportPaiementsPDF(
    lignes: LigneRapportPaiement[],
    params: ParamsRapport,
  ): Promise<{ url?: string; blob: Blob }> {

    // Import dynamique pour ne pas alourdir le bundle principal
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // ── En-tête ──
    this.ajouterEntetePDF(doc, params);

    // ── Tableau des paiements ──
    const totalDu    = lignes.reduce((s, l) => s + l.montantDu, 0);
    const totalPaye  = lignes.reduce((s, l) => s + l.montantPaye, 0);
    const tauxRecouvrement = totalDu > 0 ? Math.round((totalPaye / totalDu) * 100) : 0;

    autoTable(doc, {
      startY: 55,
      head: [[
        'Appartement', 'Propriétaire', 'Mois',
        'Montant dû (DT)', 'Montant payé (DT)', 'Statut',
        'Date règlement', 'Mode', 'Référence',
      ]],
      body: lignes.map(l => [
        l.appartement,
        l.proprietaire,
        l.mois,
        l.montantDu.toFixed(2),
        l.montantPaye.toFixed(2),
        l.statut,
        l.dateReglement || '—',
        l.modePaiement || '—',
        l.reference || '—',
      ]),
      foot: [[
        `Total (${lignes.length} lignes)`, '', '',
        `${totalDu.toFixed(2)}`, `${totalPaye.toFixed(2)}`,
        `Taux: ${tauxRecouvrement}%`, '', '', '',
      ]],
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      didDrawCell: (data: any) => {
        // Colorer la cellule statut
        if (data.section === 'body' && data.column.index === 5) {
          const statut = data.cell.text[0];
          if (statut === 'Payé')    doc.setFillColor(220, 252, 231);
          if (statut === 'Impayé')  doc.setFillColor(254, 226, 226);
          if (statut === 'Retard')  doc.setFillColor(254, 243, 199);
          if (statut === 'Partiel') doc.setFillColor(237, 233, 254);
        }
      },
    });

    // ── Pied de page ──
    this.ajouterPiedPagePDF(doc, params);

    // ── Générer le blob ──
    const blob = doc.output('blob');
    const nomFichier = `rapport-paiements-${params.periode.replace(/\s/g, '-')}.pdf`;

    // ── Téléchargement local (toujours) ──
    this.telechargerBlob(blob, nomFichier);

    // ── Upload Cloudinary (optionnel) ──
    let urlCloudinary: string | undefined;
    if (params.sauvegarderCloudinary !== false) {
      try {
        const fichier = new File([blob], nomFichier, { type: 'application/pdf' });
        const docSauve = await this.documentSvc.uploadEtSauvegarder(
          fichier,
          'syndic/rapports',
          {
            nom:         `Rapport paiements — ${params.periode}`,
            categorie:   'rapport_financier',
            uploadePar:  params.userId,
            residenceId: params.residenceId,
            description: `Rapport généré le ${new Date().toLocaleDateString('fr-FR')} par ${params.generePar}`,
            visibilite:  'admin',
            tags:        ['rapport', 'paiements', params.periode],
          },
        );
        urlCloudinary = docSauve.url;
      } catch (err) {
        console.warn('[Rapport] Upload Cloudinary échoué, fichier téléchargé localement.', err);
      }
    }

    return { url: urlCloudinary, blob };
  }

  // ─── Rapport des dettes ────────────────────────────────────────────────────

  async genererRapportDettesPDF(
    lignes: LigneRapportDette[],
    params: ParamsRapport,
  ): Promise<{ url?: string; blob: Blob }> {

    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    this.ajouterEntetePDF(doc, params);

    const totalRestant = lignes.reduce((s, l) => s + l.montantRestant, 0);
    const nbImpayees   = lignes.filter(l => l.statut === 'IMPAYEE').length;

    autoTable(doc, {
      startY: 55,
      head: [[
        'Appartement', 'Propriétaire', 'Période',
        'Montant dû', 'Payé', 'Restant',
        'Statut', 'Mois retard',
      ]],
      body: lignes.map(l => [
        l.appartement,
        l.proprietaire,
        l.periode,
        `${l.montantOriginal.toFixed(2)} DT`,
        `${l.montantPaye.toFixed(2)} DT`,
        `${l.montantRestant.toFixed(2)} DT`,
        this.labelStatutDette(l.statut),
        l.nbMoisRetard,
      ]),
      foot: [[
        `${lignes.length} dettes`, '', '',
        '', '', `${totalRestant.toFixed(2)} DT`,
        `${nbImpayees} impayées`, '',
      ]],
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    this.ajouterPiedPagePDF(doc, params);

    const blob = doc.output('blob');
    const nomFichier = `rapport-dettes-${params.periode.replace(/\s/g, '-')}.pdf`;
    this.telechargerBlob(blob, nomFichier);

    let urlCloudinary: string | undefined;
    if (params.sauvegarderCloudinary !== false) {
      try {
        const fichier = new File([blob], nomFichier, { type: 'application/pdf' });
        const docSauve = await this.documentSvc.uploadEtSauvegarder(
          fichier, 'syndic/rapports',
          {
            nom: `Rapport dettes — ${params.periode}`,
            categorie: 'rapport_financier',
            uploadePar: params.userId,
            residenceId: params.residenceId,
            visibilite: 'admin',
            tags: ['rapport', 'dettes', params.periode],
          },
        );
        urlCloudinary = docSauve.url;
      } catch { /* silence */ }
    }

    return { url: urlCloudinary, blob };
  }

  // ═══════════════════════════════════════════════════════════
  //  RAPPORTS EXCEL
  // ═══════════════════════════════════════════════════════════

  /**
   * Génère un rapport Excel des paiements + l'uploade sur Cloudinary.
   *
   * USAGE depuis PaiementsComponent :
   *   await this.rapportService.genererRapportPaiementsExcel(
   *     lignes,
   *     { titre: 'Paiements 2025', residenceNom: '...', periode: 'Janvier 2025',
   *       generePar: 'Admin', userId: user.uid }
   *   );
   */
  async genererRapportPaiementsExcel(
    lignes: LigneRapportPaiement[],
    params: ParamsRapport,
  ): Promise<{ url?: string; blob: Blob }> {

    const XLSX = await import('xlsx');

    // ── Données du tableau ──
    const entetes = [
      'Appartement', 'Propriétaire', 'Mois',
      'Montant dû (DT)', 'Montant payé (DT)', 'Statut',
      'Date règlement', 'Mode paiement', 'Référence',
    ];

    const donnees = lignes.map(l => [
      l.appartement, l.proprietaire, l.mois,
      l.montantDu, l.montantPaye, l.statut,
      l.dateReglement || '', l.modePaiement || '', l.reference || '',
    ]);

    // Ligne de totaux
    const totalDu   = lignes.reduce((s, l) => s + l.montantDu, 0);
    const totalPaye = lignes.reduce((s, l) => s + l.montantPaye, 0);
    donnees.push([
      'TOTAL', '', '',
      totalDu, totalPaye, `Taux: ${Math.round((totalPaye / totalDu) * 100)}%`,
      '', '', `${lignes.length} lignes`,
    ]);

    // ── Créer le classeur ──
    const classeur = XLSX.utils.book_new();

    // Feuille Info
    const infoData = [
      ['Rapport', params.titre],
      ['Résidence', params.residenceNom],
      ['Période', params.periode],
      ['Généré le', new Date().toLocaleDateString('fr-FR')],
      ['Généré par', params.generePar],
    ];
    const feuilleInfo = XLSX.utils.aoa_to_sheet(infoData);
    XLSX.utils.book_append_sheet(classeur, feuilleInfo, 'Informations');

    // Feuille Données
    const feuilleData = XLSX.utils.aoa_to_sheet([entetes, ...donnees]);
    // Largeurs colonnes
    feuilleData['!cols'] = [
      { wch: 15 }, { wch: 25 }, { wch: 15 },
      { wch: 16 }, { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 15 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(classeur, feuilleData, 'Paiements');

    // ── Générer le blob ──
    const buffer = XLSX.write(classeur, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const nomFichier = `rapport-paiements-${params.periode.replace(/\s/g, '-')}.xlsx`;
    this.telechargerBlob(blob, nomFichier);

    // ── Upload Cloudinary ──
    let urlCloudinary: string | undefined;
    if (params.sauvegarderCloudinary !== false) {
      try {
        const fichier = new File([blob], nomFichier, {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const docSauve = await this.documentSvc.uploadEtSauvegarder(
          fichier, 'syndic/rapports',
          {
            nom: `Rapport paiements Excel — ${params.periode}`,
            categorie: 'rapport_financier',
            uploadePar: params.userId,
            residenceId: params.residenceId,
            visibilite: 'admin',
            tags: ['rapport', 'excel', 'paiements', params.periode],
          },
        );
        urlCloudinary = docSauve.url;
      } catch { /* silence */ }
    }

    return { url: urlCloudinary, blob };
  }

  // ═══════════════════════════════════════════════════════════
  //  REÇU DE PAIEMENT PDF
  // ═══════════════════════════════════════════════════════════

  /**
   * Génère un reçu de paiement PDF et l'uploade sur Cloudinary.
   * L'URL retournée peut être sauvegardée dans Firestore (payment.recuUrl).
   *
   * USAGE depuis PaiementsComponent.savePaymentWithFifo() :
   *   const recu = await this.rapportService.genererRecuPaiement({
   *     reference: 'PAY-2025-0012',
   *     appartement: 'C1-2-05',
   *     proprietaire: 'Mohamed Ben Ali',
   *     montant: 120,
   *     datePaiement: '2025-01-15',
   *     modePaiement: 'virement',
   *     mois: 'Janvier 2025',
   *     userId: user.uid,
   *     residenceNom: 'Résidence Le Parc Royal',
   *     generePar: 'Admin',
   *   });
   *   // Sauvegarder recu.url dans payment.recuUrl (Firestore)
   */
  async genererRecuPaiement(params: {
    reference: string;
    appartement: string;
    proprietaire: string;
    telephone?: string;
    montant: number;
    datePaiement: string;
    modePaiement: string;
    mois: string;
    userId: string;
    residenceNom: string;
    generePar: string;
    residenceId?: string;
    appartementId?: string;
    coproprietaireId?: string;
    paiementId?: string;
  }): Promise<{ url?: string; blob: Blob }> {

    const { jsPDF } = await import('jspdf');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; // Largeur A4

    // ── Fond en-tête ──
    doc.setFillColor(16, 185, 129); // Emerald
    doc.rect(0, 0, W, 45, 'F');

    // ── Logo/Titre ──
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('SyndicPro', 20, 22);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(params.residenceNom, 20, 30);

    // ── Badge "REÇU OFFICIEL" ──
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(W - 70, 10, 55, 24, 3, 3, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('REÇU OFFICIEL', W - 42.5, 21, { align: 'center' });
    doc.setFontSize(8);
    doc.text(`N° ${params.reference}`, W - 42.5, 28, { align: 'center' });

    // ── Montant en grand ──
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(42);
    doc.setFont('helvetica', 'bold');
    doc.text(`${params.montant.toFixed(2)} DT`, W / 2, 80, { align: 'center' });

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Montant reçu', W / 2, 90, { align: 'center' });

    // ── Séparateur ──
    doc.setDrawColor(226, 232, 240);
    doc.line(20, 98, W - 20, 98);

    // ── Informations ──
    const infoY = 110;
    const col1  = 25;
    const col2  = 110;

    const infos: [string, string][] = [
      ['Copropriétaire',   params.proprietaire],
      ['Appartement',      params.appartement],
      ['Période',          params.mois],
      ['Date de paiement', params.datePaiement],
      ['Mode de paiement', params.modePaiement],
      ['Référence',        params.reference],
    ];
    if (params.telephone) infos.splice(2, 0, ['Téléphone', params.telephone]);

    infos.forEach(([label, valeur], i) => {
      const y = infoY + i * 14;
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(label, col1, y);

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(String(valeur), col2, y);

      // Ligne de séparation légère
      doc.setDrawColor(241, 245, 249);
      doc.line(col1, y + 3, W - col1, y + 3);
    });

    // ── Mention légale ──
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const mentionY = infoY + infos.length * 14 + 15;
    doc.text(
      'Ce reçu atteste du paiement des charges de copropriété. Document généré automatiquement.',
      W / 2, mentionY, { align: 'center', maxWidth: 160 }
    );

    // ── Cachet ──
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(col1, mentionY + 10, 80, 22, 3, 3, 'FD');
    doc.setTextColor(16, 185, 129);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('✓ PAIEMENT VALIDÉ', col1 + 40, mentionY + 19, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text(`Par : ${params.generePar}`, col1 + 40, mentionY + 26, { align: 'center' });

    // ── Pied de page ──
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text(
      `Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`,
      W / 2, 285, { align: 'center' }
    );

    const blob = doc.output('blob');
    const nomFichier = `recu-${params.reference}.pdf`;
    this.telechargerBlob(blob, nomFichier);

    // ── Upload Cloudinary ──
    let urlCloudinary: string | undefined;
    try {
      const fichier = new File([blob], nomFichier, { type: 'application/pdf' });
      const docSauve = await this.documentSvc.uploadEtSauvegarder(
        fichier, 'syndic/recus',
        {
          nom:               `Reçu ${params.reference} — ${params.proprietaire}`,
          categorie:         'recu_paiement',
          uploadePar:        params.userId,
          residenceId:       params.residenceId,
          appartementId:     params.appartementId,
          coproprietaireId:  params.coproprietaireId,
          paiementId:        params.paiementId,
          visibilite:        'tous',   // Copropriétaire peut voir son reçu
          tags:              ['recu', params.mois, params.appartement],
        },
      );
      urlCloudinary = docSauve.url;
    } catch (err) {
      console.warn('[Reçu] Upload Cloudinary échoué, reçu téléchargé localement.', err);
    }

    return { url: urlCloudinary, blob };
  }

  // ═══════════════════════════════════════════════════════════
  //  RAPPORTS GÉNÉRIQUES (téléchargement local uniquement)
  // ═══════════════════════════════════════════════════════════

  /**
   * Génère un PDF générique avec les colonnes et données fournies.
   * Pas d'upload Cloudinary — téléchargement local uniquement.
   */
  async genererRapportGeneriquePDF(
    headers: string[],
    rows: string[][],
    params: ParamsRapport,
    headerColor: [number, number, number] = [16, 185, 129],
  ): Promise<{ blob: Blob }> {
    const { jsPDF }            = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    this.ajouterEntetePDF(doc, params);

    autoTable(doc, {
      startY: 55,
      head: [headers],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: headerColor, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    this.ajouterPiedPagePDF(doc, params);

    const blob = doc.output('blob');
    const slug = (params.titre || 'rapport').replace(/\s+/g, '-').toLowerCase();
    this.telechargerBlob(blob, `${slug}-${params.periode.replace(/\s/g, '-')}.pdf`);
    return { blob };
  }

  /**
   * Génère un Excel générique avec les colonnes et données fournies.
   * Pas d'upload Cloudinary — téléchargement local uniquement.
   */
  async genererRapportGeneriqueExcel(
    headers: string[],
    rows: (string | number)[][],
    params: ParamsRapport,
    sheetName = 'Données',
  ): Promise<{ blob: Blob }> {
    const XLSX = await import('xlsx');
    const classeur = XLSX.utils.book_new();

    // Feuille info
    const feuilleInfo = XLSX.utils.aoa_to_sheet([
      ['Rapport',    params.titre],
      ['Résidence',  params.residenceNom],
      ['Période',    params.periode],
      ['Généré le',  new Date().toLocaleDateString('fr-FR')],
      ['Généré par', params.generePar],
    ]);
    XLSX.utils.book_append_sheet(classeur, feuilleInfo, 'Informations');

    // Feuille données
    const feuilleData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    feuilleData['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(classeur, feuilleData, sheetName);

    const buffer = XLSX.write(classeur, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const slug = (params.titre || 'rapport').replace(/\s+/g, '-').toLowerCase();
    this.telechargerBlob(blob, `${slug}-${params.periode.replace(/\s/g, '-')}.xlsx`);
    return { blob };
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  private ajouterEntetePDF(doc: any, params: ParamsRapport): void {
    const W = doc.internal.pageSize.getWidth();

    // Bandeau vert
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, W, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('SyndicPro', 15, 14);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(params.residenceNom, 15, 21);
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} — Par ${params.generePar}`, 15, 27);

    // Titre du rapport
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(params.titre, 15, 45);

    if (params.soustitre) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(params.soustitre, 15, 52);
    }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Période : ${params.periode}`, W - 15, 45, { align: 'right' });
  }

  private ajouterPiedPagePDF(doc: any, params: ParamsRapport): void {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const nbPages = doc.internal.getNumberOfPages();

    for (let i = 1; i <= nbPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(226, 232, 240);
      doc.line(15, H - 15, W - 15, H - 15);
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.text(`SyndicPro — ${params.residenceNom}`, 15, H - 8);
      doc.text(`Page ${i} / ${nbPages}`, W - 15, H - 8, { align: 'right' });
      doc.text(params.titre, W / 2, H - 8, { align: 'center' });
    }
  }

  private telechargerBlob(blob: Blob, nomFichier: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private labelStatutDette(statut: string): string {
    switch (statut) {
      case 'PAYEE':               return 'Soldée';
      case 'PARTIELLEMENT_PAYEE': return 'Partielle';
      case 'IMPAYEE':             return 'Impayée';
      default:                    return statut;
    }
  }
}
