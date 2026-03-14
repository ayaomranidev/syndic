import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Auth } from '../../../core/services/auth';
import { User, UserRole } from '../../../models/user.model';

interface RoleInfo {
  label: string;
  description: string;
  icon: string;
  color: string;
  permissions: string[];
}

@Component({
  selector: 'app-role-selection',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './role-selection.html',
  styleUrls: ['./role-selection.css'],
})
export class RoleSelection implements OnInit {
  @Input() user!: User;

  // ✅ CORRIGÉ: Ajout des informations pour ADMIN_RESIDENCE
  roleInfos: Record<UserRole, RoleInfo> = {
    ADMIN: {
      label: 'Administrateur',
      description: 'Administration complète du système',
      icon: '⚙️',
      color: 'bg-gradient-to-r from-red-500 to-red-600',
      permissions: [
        'Gérer tous les utilisateurs',
        'Configurer le système',
        'Gérer les résidences',
        'Superviser toutes les activités'
      ]
    },
    ADMIN_RESIDENCE: {
      label: 'Administrateur de Résidence',
      description: 'Gestion complète d\'une résidence spécifique',
      icon: '🏢',
      color: 'bg-gradient-to-r from-purple-500 to-purple-600',
      permissions: [
        'Gérer les bâtiments de la résidence',
        'Gérer les appartements',
        'Gérer les copropriétaires',
        'Créer et gérer les charges',
        'Suivre les paiements'
      ]
    },
    COPROPRIETAIRE: {
      label: 'Copropriétaire',
      description: 'Gestion de votre propriété, paiements, votes',
      icon: '🏠',
      color: 'bg-gradient-to-r from-blue-500 to-blue-600',
      permissions: [
        'Consulter mes paiements',
        'Signaler des problèmes',
        'Voter aux décisions',
        'Accéder aux documents'
      ]
    },
    LOCATAIRE: {
      label: 'Locataire',
      description: 'Gestion de votre logement, signalements',
      icon: '🔑',
      color: 'bg-gradient-to-r from-green-500 to-green-600',
      permissions: [
        'Signaler des réparations',
        'Consulter les documents',
        'Contacter le gardien',
        'Voir mes informations'
      ]
    },
    TRESORIER: {
      label: 'Trésorier',
      description: 'Gestion financière de la copropriété',
      icon: '💰',
      color: 'bg-gradient-to-r from-yellow-500 to-yellow-600',
      permissions: [
        'Valider les paiements',
        'Gérer les finances',
        'Générer des rapports',
        'Suivre les impayés'
      ]
    },
    PRESIDENT: {
      label: 'Président',
      description: 'Supervision et gestion de la copropriété',
      icon: '👔',
      color: 'bg-gradient-to-r from-purple-500 to-purple-600',
      permissions: [
        'Organiser les réunions',
        'Valider les travaux',
        'Superviser les décisions',
        'Coordonner le conseil syndical'
      ]
    },
    GARDIEN: {
      label: 'Gardien',
      description: 'Gestion des incidents et visiteurs',
      icon: '👷',
      color: 'bg-gradient-to-r from-orange-500 to-orange-600',
      permissions: [
        'Gérer les incidents',
        'Enregistrer les visiteurs',
        'Planifier les entretiens',
        'Signaler les urgences'
      ]
    }
  };

  constructor(private auth: Auth, private router: Router) {}

  ngOnInit() {
    if (!this.user) {
      const current = this.auth.currentUser;
      if (current) {
        this.user = current;
      } else {
        this.router.navigate(['/auth/login']);
      }
    }
  }

  selectRole(role: UserRole) {
    this.auth.selectRole(role).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        console.error('Role selection failed:', error);
      }
    });
  }

  logout() {
    this.auth.logout();
  }
}