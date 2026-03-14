// components/historique-paiements/historique-paiements.component.ts
import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaiementExcelService, PaiementExcel } from '../../services/paiement-excel.service';

@Component({
  selector: 'app-historique-paiements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historique-paiements.component.html',
  styleUrls: ['./historique-paiements.component.css']
})
export class HistoriquePaiementsComponent implements OnInit {
  private excelService = inject(PaiementExcelService);
  
  // Signaux
  readonly tousAppartements = signal<PaiementExcel[]>([]);
  readonly blocActif = signal<'C1' | 'C2'>('C1');
  readonly messageImport = signal<string>('');
  readonly importReussi = signal<boolean>(false);
  
  // Données filtrées par bloc
  readonly appartementsFiltres = computed(() => {
    return this.tousAppartements().filter(a => a.bloc === this.blocActif());
  });
  
  // Liste des dates uniques (toutes les colonnes)
  readonly datesAffichage = computed(() => {
    const datesSet = new Set<string>();
    this.appartementsFiltres().forEach(app => {
      Object.keys(app.historique).forEach(date => datesSet.add(date));
    });
    return Array.from(datesSet).sort();
  });
  
  // Étages uniques
  readonly etages = computed(() => {
    const etages = new Set<string>();
    this.appartementsFiltres().forEach(app => {
      if (app.etage) etages.add(app.etage);
    });
    return Array.from(etages).sort((a, b) => {
      const order = ['R.D.C', '1 er Etage', '2 eme Etage', '3 eme Etage', '4 eme Etage', 'PARKING SOUS SOL'];
      return order.indexOf(a) - order.indexOf(b);
    });
  });
  
  // Appartements groupés par étage
  readonly appartementsParEtage = computed(() => {
    const group: { [key: string]: PaiementExcel[] } = {};
    this.appartementsFiltres().forEach(app => {
      if (!group[app.etage]) group[app.etage] = [];
      group[app.etage].push(app);
    });
    return group;
  });
  
  // Reste à payer par étage
  readonly resteParEtage = computed(() => {
    const reste: { [key: string]: number } = {};
    this.appartementsFiltres().forEach(app => {
      reste[app.etage] = (reste[app.etage] || 0) + app.resteAPayer;
    });
    return reste;
  });
  
  // Total par mois
  readonly totalParMois = computed(() => {
    const totals: { [date: string]: number } = {};
    this.appartementsFiltres().forEach(app => {
      Object.entries(app.historique).forEach(([date, montant]) => {
        totals[date] = (totals[date] || 0) + montant;
      });
    });
    return totals;
  });
  
  // Totaux généraux
  readonly totalGlobal = computed(() => {
    return this.appartementsFiltres().reduce((sum, a) => sum + a.totalPaye, 0);
  });
  
  readonly totalImpayes = computed(() => {
    return this.appartementsFiltres().reduce((sum, a) => sum + a.resteAPayer, 0);
  });
  
  // Statistiques
  readonly stats = computed(() => {
    const totalPaye = this.totalGlobal();
    const totalImpayes = this.totalImpayes();
    const totalGlobal = totalPaye + totalImpayes;
    
    return {
      totalPaye,
      totalImpayes,
      tauxRecouvrement: totalGlobal ? ((totalPaye / totalGlobal) * 100).toFixed(1) : 0,
      nbAppartements: this.appartementsFiltres().filter(a => a.type === 'appartement').length
    };
  });
  
  async ngOnInit() {
    await this.chargerDonnees();
  }
  
  async importerExcel(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;
    
    try {
      this.messageImport.set('⏳ Import en cours...');
      this.importReussi.set(false);
      
      const result = await this.excelService.importerFichierExcel(file);
      
      await this.chargerDonnees();
      
      this.messageImport.set(`✅ Import terminé : ${result.appartements.length} appartements importés`);
      this.importReussi.set(true);
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      console.error('Erreur import:', error);
      this.messageImport.set(`❌ Erreur: ${message}`);
      this.importReussi.set(false);
    } finally {
      input.value = '';
      
      // Effacer le message après 5 secondes
      setTimeout(() => {
        this.messageImport.set('');
      }, 5000);
    }
  }
  
  private async chargerDonnees() {
    try {
      const all = await this.excelService.chargerTous();
      this.tousAppartements.set(all);
      console.log('✅ Données chargées:', all.length);
    } catch (error) {
      console.error('❌ Erreur chargement:', error);
      this.tousAppartements.set(this.getDonneesTest());
    }
  }

  // Données de test pour vérifier l'affichage si Firestore est bloqué
  private getDonneesTest(): PaiementExcel[] {
    return [
      {
        etage: 'R.D.C',
        numeroAppart: 'C1-01',
        proprietaire: 'Dupont',
        telephone: '123456',
        historique: {
          '2018-10-01': 25,
          '2018-11-01': 13,
          '2018-12-01': 25,
        },
        totalPaye: 63,
        ancienLocataire: 0,
        resteAPayer: 100,
        nbMoisRetard: 4,
        bloc: 'C1',
        type: 'appartement',
      },
    ];
  }
  
  changerBloc(bloc: 'C1' | 'C2') {
    this.blocActif.set(bloc);
  }
  
  rafraichir() {
    this.chargerDonnees();
  }
}