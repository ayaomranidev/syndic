/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  recu.service.ts                                                        ║
 * ║  Chemin : src/app/pages/paiements/services/recu.service.ts              ║
 * ║                                                                          ║
 * ║  Génère un reçu de paiement PDF moderne via jsPDF.                      ║
 * ║  → Design professionnel : bandeau couleur + grille + cachet vert        ║
 * ║  → Téléchargement direct dans le navigateur                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * INSTALLATION REQUISE :
 *   npm install jspdf
 *   npm install --save-dev @types/jspdf  (si nécessaire)
 */

import { Injectable } from '@angular/core';

export interface RecuData {
  recuNumero: string;          // ex: "R-20250801-001"
  datePaiement: string;        // ISO yyyy-mm-dd
  coproprietaire: string;      // nom complet
  lot: string;                 // ex: "2ème Étage - Apt 201"
  charge: string;              // libellé de la charge
  montant: number;             // en DT
  modePaiement: string;        // ex: "Virement bancaire"
  reference: string;           // référence du paiement
  statut: string;              // "Payé"
  residenceNom?: string;       // ex: "Résidence Tasnim"
  syndicatNom?: string;        // ex: "Syndicat de Copropriété"
  periodeLabel?: string;       // ex: "Juillet 2025"
  notes?: string;
}

const MODE_LABELS: Record<string, string> = {
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  especes: 'Espèces',
  carte: 'Carte bancaire',
  prelevement: 'Prélèvement automatique',
};

@Injectable({ providedIn: 'root' })
export class RecuService {

  // ── Couleurs de la charte graphique ─────────────────────────────────────
  // Use the app `primary` palette (tailwind `primary: #1a355b`) for receipts
  private readonly PRIMARY   = [26, 53, 91]    as [number,number,number]; // primary (#1a355b)
  private readonly DARK      = [15, 23, 42]    as [number,number,number]; // slate-900
  private readonly LIGHT_BG  = [248, 250, 252] as [number,number,number]; // slate-50
  private readonly BORDER    = [226, 232, 240] as [number,number,number]; // slate-200
  private readonly TEXT_MUTED= [100, 116, 139] as [number,number,number]; // slate-500
  // Badge / cachet now uses a light primary background and dark primary text
  private readonly SUCCESS_BG= [229, 238, 255] as [number,number,number]; // light primary
  private readonly SUCCESS_TX= [26, 53, 91]    as [number,number,number]; // dark primary

  /**
   * Génère et télécharge le reçu PDF.
   * Appelle dynamiquement jsPDF pour éviter d'alourdir le bundle initial.
   */
  async telechargerRecu(data: RecuData): Promise<void> {
    // Import dynamique de jsPDF
    const { jsPDF } = await import('jspdf');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = 210; // largeur page A4

    // ── 1. Bandeau supérieur coloré ────────────────────────────────────────
    doc.setFillColor(...this.PRIMARY);
    doc.rect(0, 0, pw, 38, 'F');

    // Logo / icône cercle blanc
    doc.setFillColor(255, 255, 255);
    doc.circle(20, 19, 9, 'F');
    doc.setFillColor(...this.PRIMARY);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('SP', 17, 22.5); // initiales SyndicPro

    // Titre reçu
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('REÇU DE PAIEMENT', 36, 16);

    // Nom résidence sous le titre
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...this.SUCCESS_BG);
    const syndicat = data.syndicatNom || 'Syndicat de Copropriété';
    const residence = data.residenceNom || 'SyndicPro';
    doc.text(`${syndicat} — ${residence}`, 36, 23);

    // Numéro de reçu (droite du bandeau)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('N°', pw - 55, 14);
    doc.setFontSize(13);
    doc.text(data.recuNumero, pw - 55, 22);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...this.SUCCESS_BG);
    doc.text(this.formatDate(data.datePaiement), pw - 55, 30);

    // ── 2. Section info copropriétaire ──────────────────────────────────────
    let y = 50;

    doc.setFillColor(...this.LIGHT_BG);
    doc.roundedRect(14, y, pw - 28, 34, 3, 3, 'F');
    doc.setDrawColor(...this.BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(14, y, pw - 28, 34, 3, 3, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...this.TEXT_MUTED);
    doc.text('COPROPRIÉTAIRE', 20, y + 8);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...this.DARK);
    doc.text(data.coproprietaire, 20, y + 17);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...this.TEXT_MUTED);
    doc.text(data.lot, 20, y + 25);

    // Période (droite)
    if (data.periodeLabel) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...this.TEXT_MUTED);
      doc.text('PÉRIODE', pw - 60, y + 8);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...this.DARK);
      doc.text(data.periodeLabel, pw - 60, y + 17);
    }

    y += 44;

    // ── 3. Tableau des détails ──────────────────────────────────────────────
    const lignes: [string, string][] = [
      ['Libellé de la charge', data.charge],
      ['Mode de paiement', MODE_LABELS[data.modePaiement] || data.modePaiement],
      ['Référence', data.reference],
      ['Date de paiement', this.formatDate(data.datePaiement)],
    ];

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...this.DARK);
    doc.text('Détails du paiement', 14, y);
    y += 6;

    for (let i = 0; i < lignes.length; i++) {
      const [label, value] = lignes[i];
      // Fond alterné
      if (i % 2 === 0) {
        doc.setFillColor(250, 252, 255);
        doc.rect(14, y - 4, pw - 28, 10, 'F');
      }
      doc.setDrawColor(...this.BORDER);
      doc.setLineWidth(0.2);
      doc.line(14, y + 6, pw - 14, y + 6);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...this.TEXT_MUTED);
      doc.text(label, 20, y + 2);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...this.DARK);
      doc.text(value, pw - 20, y + 2, { align: 'right' });
      y += 10;
    }

    y += 6;

    // ── 4. Bloc montant ─────────────────────────────────────────────────────
    doc.setFillColor(...this.PRIMARY);
    doc.roundedRect(14, y, pw - 28, 22, 4, 4, 'F');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...this.SUCCESS_BG);
    doc.text('MONTANT TOTAL PAYÉ', 20, y + 9);

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    const montantStr = `${this.formatMontant(data.montant)} DT`;
    doc.text(montantStr, pw - 20, y + 14, { align: 'right' });

    y += 32;

    // ── 5. Cachet / badge PAYÉ ──────────────────────────────────────────────
    doc.setFillColor(...this.SUCCESS_BG);
    doc.roundedRect(pw / 2 - 30, y, 60, 14, 7, 7, 'F');
    doc.setDrawColor(...this.PRIMARY);
    doc.setLineWidth(0.8);
    doc.roundedRect(pw / 2 - 30, y, 60, 14, 7, 7, 'S');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...this.SUCCESS_TX);
    doc.text('✓  PAIEMENT VALIDÉ', pw / 2, y + 9.5, { align: 'center' });

    y += 24;

    // ── 6. Notes (si présentes) ─────────────────────────────────────────────
    if (data.notes) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(...this.TEXT_MUTED);
      doc.text(`Note : ${data.notes}`, 14, y);
      y += 8;
    }

    // ── 7. Ligne de séparation + pied de page ──────────────────────────────
    const footerY = 275;
    doc.setDrawColor(...this.BORDER);
    doc.setLineWidth(0.4);
    doc.line(14, footerY, pw - 14, footerY);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...this.TEXT_MUTED);
    doc.text(
      `Ce document est généré automatiquement par SyndicPro — ${syndicat}`,
      pw / 2, footerY + 6, { align: 'center' }
    );
    doc.text(
      `Imprimé le ${this.formatDate(new Date().toISOString())} • Réf. ${data.recuNumero}`,
      pw / 2, footerY + 11, { align: 'center' }
    );

    // Filigrane discret (rotatif, centré)
    doc.setFontSize(60);
    doc.setTextColor(241, 245, 249); // slate-100
    doc.setFont('helvetica', 'bold');
    doc.text('PAYÉ', pw / 2, 160, { align: 'center', angle: 45 });

    // ── 8. Téléchargement ──────────────────────────────────────────────────
    const fileName = `recu_${data.recuNumero}_${data.coproprietaire.replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private formatDate(iso: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-TN', {
        day: '2-digit', month: 'long', year: 'numeric'
      });
    } catch { return iso; }
  }

  private formatMontant(v: number): string {
    return v.toLocaleString('fr-TN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Génère un numéro de reçu unique au format R-YYYYMMDD-XXXX
   */
  genererNumeroRecu(): string {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return `R-${date}-${rand}`;
  }
}
