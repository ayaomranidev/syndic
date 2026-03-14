import { ChangeDetectionStrategy, Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { DetteGenerationService, GenerationAnnuelleResult, GenerationMoisResult } from '../../services/generation-dettes.service'; // ← Correction chemin
import { Auth } from '../../../../core/services/auth'; // ← Correction chemin
import { UserService } from '../../../coproprietaires/services/coproprietaire.service'; // ← Correction chemin

@Component({
  selector: 'app-generation-dettes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './generation-dettes.component.html',
  styleUrls: ['./generation-dettes.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationDettesComponent implements OnInit {
  private readonly auth = inject(Auth);
  private readonly userService = inject(UserService);
  private readonly generationService = inject(DetteGenerationService);

  annee = new Date().getFullYear();
  mois = new Date().getMonth() + 1;
  anneeAnnuelle = new Date().getFullYear();

  isGenerating = signal(false);
  resultatMois = signal<GenerationMoisResult | null>(null);
  resultatAnnee = signal<GenerationAnnuelleResult | null>(null);
  erreur = signal<string | null>(null);

  // Gestion des rôles
  private isResidenceAdmin = false;
  private currentResidenceId: string | null = null;

  moisListe = [
    { numero: 1, nom: 'Janvier' },
    { numero: 2, nom: 'Février' },
    { numero: 3, nom: 'Mars' },
    { numero: 4, nom: 'Avril' },
    { numero: 5, nom: 'Mai' },
    { numero: 6, nom: 'Juin' },
    { numero: 7, nom: 'Juillet' },
    { numero: 8, nom: 'Août' },
    { numero: 9, nom: 'Septembre' },
    { numero: 10, nom: 'Octobre' },
    { numero: 11, nom: 'Novembre' },
    { numero: 12, nom: 'Décembre' },
  ];

  async ngOnInit() {
    await this.loadUserData();
  }

  // Charger les données utilisateur
  private async loadUserData(): Promise<void> {
    try {
      await firstValueFrom(this.auth.currentUser$.pipe(filter(Boolean), take(1)));
      const firebaseUser = this.auth.currentUser;
      
      if (firebaseUser) {
        const userId = String(firebaseUser.id);
        const userData = await this.userService.getById(userId);
        
        if (userData) {
          const roles = userData.roles || [];
          this.isResidenceAdmin = roles.includes('ADMIN_RESIDENCE') && !roles.includes('ADMIN');
          this.currentResidenceId = this.isResidenceAdmin ? userData.residenceId || null : null;
          
          console.log('✅ Données utilisateur chargées:', {
            isResidenceAdmin: this.isResidenceAdmin,
            currentResidenceId: this.currentResidenceId
          });
        }
      }
    } catch (error) {
      console.error('Erreur chargement utilisateur:', error);
    }
  }

  async genererMois() {
    this.isGenerating.set(true);
    this.erreur.set(null);
    try {
      const resultat = await this.generationService.genererDettesduMois(
        this.annee, 
        this.mois, 
        this.currentResidenceId,
        this.auth.currentUser?.id ? String(this.auth.currentUser.id) : undefined
      );
      this.resultatMois.set(resultat);
    } catch (err) {
      console.error('Erreur:', err);
      this.erreur.set((err as Error).message || 'Une erreur est survenue pendant la génération.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  async genererAnnee() {
    this.isGenerating.set(true);
    this.erreur.set(null);
    try {
      const resultat = await this.generationService.genererDettesAnnuelles(
        this.anneeAnnuelle,
        this.currentResidenceId,
        this.auth.currentUser?.id ? String(this.auth.currentUser.id) : undefined
      );
      this.resultatAnnee.set(resultat);
    } catch (err) {
      console.error('Erreur:', err);
      this.erreur.set((err as Error).message || 'Une erreur est survenue pendant la génération annuelle.');
    } finally {
      this.isGenerating.set(false);
    }
  }
}