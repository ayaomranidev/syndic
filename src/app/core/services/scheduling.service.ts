import { Injectable } from '@angular/core';
import { DetteGenerationService } from '../../pages/dette/services/generation-dettes.service';

/**
 * Service de planification simple pour déclencher la génération mensuelle des dettes.
 * À appeler depuis une tâche planifiée (cron) ou un bouton admin.
 */
@Injectable({ providedIn: 'root' })
export class SchedulingService {
  constructor(private readonly detteGenerationService: DetteGenerationService) {}

  async genererMoisCourant(): Promise<void> {
    const now = new Date();
    await this.detteGenerationService.genererDettesduMois(
      now.getFullYear(),
      now.getMonth() + 1,
    );
  }
}
