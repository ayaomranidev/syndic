import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Feature { title: string; description: string; color: string }

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './features.component.html',
  styleUrls: ['./features.component.css']
})
export class FeaturesComponent {
  features: Feature[] = [
    { title: 'Vitesse Éclair', description: "Optimisé pour des performances maximales.", color: 'bg-orange-500' },
    { title: 'Sécurité Avancée', description: "Protection de niveau bancaire pour vos données.", color: 'bg-blue-500' },
    { title: 'Portée Mondiale', description: "Déployez instantanément sur des serveurs aux quatre coins du monde.", color: 'bg-green-500' },
    { title: 'Analytique Précise', description: "Comprenez le comportement de vos utilisateurs.", color: 'bg-purple-500' },
    { title: '100% Mobile', description: "Une expérience fluide et réactive sur tous les appareils.", color: 'bg-pink-500' },
    { title: 'Collaboration', description: "Travaillez en temps réel avec votre équipe.", color: 'bg-indigo-500' }
  ];
}
