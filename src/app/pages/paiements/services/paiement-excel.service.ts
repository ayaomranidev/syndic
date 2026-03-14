// services/paiement-excel.service.ts
import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  getFirestore,
  setDoc,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { firebaseConfig } from '../../../../environments/firebase';

export interface PaiementExcel {
  id?: string;
  etage: string;
  numeroAppart: string;
  proprietaire: string;
  telephone: string;
  historique: { [date: string]: number };
  totalPaye: number;
  ancienLocataire: number;
  resteAPayer: number;
  nbMoisRetard: number;
  bloc: 'C1' | 'C2';
  type: 'appartement' | 'parking';
  chargeMensuelle?: number;
  importDate?: string;
  derniereMiseAJour?: string;
}

export interface DepenseCopro {
  id?: string;
  bloc: 'C1' | 'C2';
  categorie: string;
  attribut: string;
  historiqueDepenses: { [date: string]: number };
  totalDepense: number;
}

export interface EtatTresorerie {
  bloc: 'C1' | 'C2';
  totalCollecte: number;
  totalDepenses: number;
  soldeCaisse: number;
  collecteMensuelle: { [date: string]: number };
  depensesMensuelles: { [date: string]: number };
  soldeMensuel: { [date: string]: number };
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class PaiementExcelService {
  private readonly app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  private readonly firestore = getFirestore(this.app);
  private readonly expectedDates: string[] = this.buildExpectedDates();

  /**
   * Import du fichier Excel Tasnim C1/C2
   */
  async importerFichierExcel(file: File): Promise<{
    appartements: PaiementExcel[];
    depenses: DepenseCopro[];
    tresoreries: EtatTresorerie[];
  }> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    const resultats: PaiementExcel[] = [];
    const depensesResult: DepenseCopro[] = [];
    
    // Traiter chaque feuille (C1 et C2)
    for (const sheetName of workbook.SheetNames) {
      if (sheetName.includes('C1') || sheetName.includes('C2')) {
        const bloc = sheetName.includes('C1') ? 'C1' : 'C2';
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        const { appartements, depenses } = this.extraireAppartementsEtDepenses(data as any[][], bloc);
        resultats.push(...appartements);
        depensesResult.push(...depenses);
      }
    }
    
    // Sauvegarder dans Firestore
    for (const app of resultats) {
      await this.sauvegarderAppartement(app);
    }
    for (const dep of depensesResult) {
      await this.sauvegarderDepense(dep);
    }

    // Calculer états de trésorerie par bloc
    const tresoreries = ['C1', 'C2'].map((bloc) =>
      this.calculerEtatTresorerie(
        resultats.filter((a) => a.bloc === bloc),
        depensesResult.filter((d) => d.bloc === bloc),
        bloc as 'C1' | 'C2'
      )
    );

    for (const etat of tresoreries) {
      const ref = doc(this.firestore, 'etat_tresorerie', etat.bloc);
      await setDoc(ref, etat, { merge: true });
    }
    
    return {
      appartements: resultats,
      depenses: depensesResult,
      tresoreries,
    };
  }

  /**
   * Extraire appartements/parkings et dépenses d'une feuille
   */
  private extraireAppartementsEtDepenses(rows: any[][], bloc: 'C1' | 'C2') {
    const appartements: PaiementExcel[] = [];
    const depenses: DepenseCopro[] = [];

    // Trouver la ligne d'en-tête (dates)
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[1] === 'ETAGE' && row[2] === 'N° APPART') {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex === -1) return { appartements, depenses };

    const headerRow = rows[headerRowIndex];
    const datesFromSheet: string[] = [];
    for (let col = 5; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (cell && typeof cell === 'string' && cell.includes('-')) {
        datesFromSheet.push(cell.split(' ')[0]);
      }
    }
    const dates = datesFromSheet.length ? datesFromSheet : this.expectedDates;

    // Lignes des appartements / parkings jusqu'aux totaux
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;

      const etage = row[1];
      const numeroAppart = row[2];
      const proprietaire = row[3] || '';
      const telephone = row[4] || '';

      const numeroStr = (numeroAppart || '').toString();

      // Stop when hitting empty rows before expenses
      if (!numeroStr) continue;

      // Skip totals markers or expense section headers
      const lower = numeroStr.toString().toLowerCase();
      if (lower.includes('total') || lower.includes('gardien') || lower.includes('steg')) {
        continue;
      }

      const historique: { [date: string]: number } = {};
      for (let col = 5; col < row.length && col - 5 < dates.length; col++) {
        const date = dates[col - 5];
        const valeur = row[col];
        if (valeur && !valeur.toString().startsWith('=')) {
          const num = Number(valeur) || 0;
          if (num) historique[date] = num;
        }
      }

      const totalPaye = Object.values(historique).reduce((sum, val) => sum + val, 0);

      // Trouver "Reste à payer" (colonne BN typiquement)
      const resteAPayer = this.findNumeric(row, ['Reste à payer']);
      const ancienLocataire = this.findNumeric(row, ['ancien', 'Ancien locataire']);

      const type: 'appartement' | 'parking' = numeroStr.startsWith('P') ? 'parking' : 'appartement';
      const chargeMensuelle = type === 'parking' ? 5 : this.chargeMensuelle(numeroStr);
      const nbMoisRetard = chargeMensuelle ? Math.round(resteAPayer / chargeMensuelle) : 0;

      appartements.push({
        id: `${bloc}-${numeroStr}`,
        etage: etage?.toString() || '',
        numeroAppart: numeroStr,
        proprietaire: proprietaire.toString(),
        telephone: telephone.toString(),
        historique,
        totalPaye,
        ancienLocataire,
        resteAPayer,
        nbMoisRetard,
        bloc,
        type,
        chargeMensuelle,
        importDate: new Date().toISOString(),
        derniereMiseAJour: new Date().toISOString(),
      });
    }

    // Dépenses: rechercher lignes où la colonne 2 contient une catégorie connue
    const categories = this.depenseCategories();
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;
      const label = (row[1] || row[2] || '').toString().toUpperCase();
      const cat = categories.find((c) => c.match.test(label));
      if (!cat) continue;

      const historiqueDepenses: { [date: string]: number } = {};
      for (let col = 5; col < row.length && col - 5 < dates.length; col++) {
        const date = dates[col - 5];
        const valeur = row[col];
        if (valeur && !valeur.toString().startsWith('=')) {
          const num = Number(valeur) || 0;
          if (num) historiqueDepenses[date] = num;
        }
      }
      const totalDepense = Object.values(historiqueDepenses).reduce((s, v) => s + v, 0);
      depenses.push({
        bloc,
        categorie: cat.label,
        attribut: cat.key,
        historiqueDepenses,
        totalDepense,
      });
    }

    return { appartements, depenses };
  }

  /**
   * Sauvegarder un appartement dans Firestore
   */
  private async sauvegarderAppartement(appartement: PaiementExcel) {
    const collectionRef = collection(this.firestore, 'historique_paiements');
    const q = query(collectionRef, where('numeroAppart', '==', appartement.numeroAppart), where('bloc', '==', appartement.bloc));
    const snapshot = await getDocs(q);

    const payload = {
      ...appartement,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (snapshot.empty) {
      await addDoc(collectionRef, payload);
      return;
    }

    const existing = snapshot.docs[0];
    const ref = doc(this.firestore, 'historique_paiements', existing.id);
    await updateDoc(ref, payload);
  }

  private async sauvegarderDepense(depense: DepenseCopro) {
    const collectionRef = collection(this.firestore, 'depenses_copro');
    const q = query(collectionRef, where('bloc', '==', depense.bloc), where('categorie', '==', depense.categorie));
    const snapshot = await getDocs(q);
    const payload = {
      ...depense,
      updatedAt: new Date(),
    };

    if (snapshot.empty) {
      await addDoc(collectionRef, payload);
      return;
    }
    const existing = snapshot.docs[0];
    const ref = doc(this.firestore, 'depenses_copro', existing.id);
    await updateDoc(ref, payload);
  }

  async chargerTous(): Promise<PaiementExcel[]> {
    const collectionRef = collection(this.firestore, 'historique_paiements');
    const snapshot = await getDocs(collectionRef);
    return snapshot.docs.map((d): PaiementExcel => ({ id: d.id, ...(d.data() as PaiementExcel) }));
  }

  private buildExpectedDates(): string[] {
    const dates: string[] = [];
    let year = 2018;
    let month = 10; // Oct 2018
    while (year < 2023 || (year === 2023 && month <= 6)) {
      const m = `${month}`.padStart(2, '0');
      dates.push(`${year}-${m}-01`);
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
    return dates;
  }

  private chargeMensuelle(numeroAppart: string): number {
    // Heuristique : 35 pour les lots 02 ou 03, 25 sinon
    if (/-(02|03)$/i.test(numeroAppart)) return 35;
    return 25;
  }

  private findNumeric(row: any[], markers: string[]): number {
    for (const cell of row) {
      if (!cell) continue;
      const str = cell.toString().toLowerCase();
      if (markers.some((m) => str.includes(m.toLowerCase()))) {
        const idx = row.indexOf(cell);
        const val = Number(row[idx + 1]) || 0;
        return val;
      }
    }
    // fallback: try last numeric cell
    for (let i = row.length - 1; i >= 0; i--) {
      const num = Number(row[i]);
      if (!Number.isNaN(num)) return num;
    }
    return 0;
  }

  private depenseCategories() {
    return [
      { key: 'depense_gardien', label: 'GARDIEN', match: /gardien/i },
      { key: 'depense_femme_menage', label: 'FEMME DE MENAGE', match: /menage/i },
      { key: 'depense_steg', label: 'STEG', match: /steg/i },
      { key: 'depense_divers', label: 'DIVERS DEPENSES', match: /divers/i },
      { key: 'depense_nettoyage', label: 'PRODUITS NETTOYAGES', match: /nettoyage/i },
      { key: 'depense_reparation', label: 'REPARATION', match: /repar/i },
      { key: 'depense_ascenseur', label: 'ENTRETIENT ASCENSSEUR', match: /ascens/i },
      { key: 'depense_achats', label: 'DIVERS ACHATS', match: /achats/i },
      { key: 'depense_nakib', label: 'NAKIB AKKARI', match: /nakib/i },
      { key: 'depense_onas', label: 'ONAS', match: /onas/i },
      { key: 'depense_travaux', label: 'TRAVAUX', match: /travaux/i },
      { key: 'depense_jardinage', label: 'JARDINAGE', match: /jardin/i },
      { key: 'depense_camera', label: 'CAMERA', match: /camera/i },
      { key: 'depense_rampe', label: 'rampe escalier', match: /rampe/i },
      { key: 'depense_internet', label: 'INTERNET', match: /internet/i },
      { key: 'depense_papier', label: 'FRAIS PAPIER', match: /papier/i },
      { key: 'depense_digicode', label: 'DIGICODE', match: /digicode/i },
      { key: 'depense_puit', label: 'RACCORDEMENT PUIT', match: /puit/i },
      { key: 'depense_vase', label: 'VASE D\'EXPANSION', match: /vase/i },
      { key: 'depense_communication', label: 'COMMUNICATION', match: /communic/i },
    ];
  }

  private calculerEtatTresorerie(apps: PaiementExcel[], deps: DepenseCopro[], bloc: 'C1' | 'C2'): EtatTresorerie {
    const collecteMensuelle: { [date: string]: number } = {};
    const depensesMensuelles: { [date: string]: number } = {};

    for (const app of apps) {
      Object.entries(app.historique || {}).forEach(([date, montant]) => {
        collecteMensuelle[date] = (collecteMensuelle[date] || 0) + (montant || 0);
      });
    }

    for (const dep of deps) {
      Object.entries(dep.historiqueDepenses || {}).forEach(([date, montant]) => {
        depensesMensuelles[date] = (depensesMensuelles[date] || 0) + (montant || 0);
      });
    }

    const totalCollecte = Object.values(collecteMensuelle).reduce((s, v) => s + v, 0);
    const totalDepenses = Object.values(depensesMensuelles).reduce((s, v) => s + v, 0);
    const soldeCaisse = totalCollecte - totalDepenses;

    const soldeMensuel: { [date: string]: number } = {};
    const allDates = Array.from(new Set([...Object.keys(collecteMensuelle), ...Object.keys(depensesMensuelles)]));
    allDates.sort();
    for (const date of allDates) {
      soldeMensuel[date] = (collecteMensuelle[date] || 0) - (depensesMensuelles[date] || 0);
    }

    return {
      bloc,
      totalCollecte,
      totalDepenses,
      soldeCaisse,
      collecteMensuelle,
      depensesMensuelles,
      soldeMensuel,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Obtenir l'historique complet pour affichage
   */
  getHistoriqueParBloc(appartements: PaiementExcel[], bloc: 'C1' | 'C2') {
    const filtre = appartements.filter(a => a.bloc === bloc);
    
    // Grouper par étage
    const parEtage: { [key: string]: PaiementExcel[] } = {};
    filtre.forEach(app => {
      if (!parEtage[app.etage]) parEtage[app.etage] = [];
      parEtage[app.etage].push(app);
    });
    
    return {
      bloc,
      appartements: filtre,
      parEtage,
      totalImpayes: filtre.reduce((sum, a) => sum + a.resteAPayer, 0),
      totalPaye: filtre.reduce((sum, a) => sum + a.totalPaye, 0)
    };
  }
}