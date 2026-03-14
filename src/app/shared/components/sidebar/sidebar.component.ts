import { HostListener, ViewChild, ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { RouterModule } from '@angular/router';

// ── Votre service auth existant ─────────────────────────────────────────
import { Auth } from '../../../core/services/auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Type local — items de navigation
// ─────────────────────────────────────────────────────────────────────────────
interface NavItem {
  path: string;
  icon: string;
  label: string;
  badge?: string | number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Composant
// ─────────────────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, AsyncPipe, RouterModule],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sidebar-shell' },
})
export class SidebarComponent {
  // --- État de la sidebar ---
  isSidebarVisible = signal(true);
  
  // --- Menu du footer ---
  isFooterMenuOpen = false;

  @ViewChild('footerMenu') footerMenu?: ElementRef;

  // ── Stream utilisateur ───────────────────────────────────────────
  readonly user$ = inject(Auth).currentUser$;

  // ── Items navigation ────────────────────────────────────────────
  readonly gestionItems: NavItem[] = [
    { path: '/residences',      icon: '🏘️', label: 'Résidences'      },
    { path: '/batiments',       icon: '🏢', label: 'Bâtiments'        },
    { path: '/appartements',    icon: '🏠', label: 'Appartements'     },
    { path: '/coproprietaires', icon: '👥', label: 'Copropriétaires'  },
  ];

  readonly financesItems: NavItem[] = [
    { path: '/paiements', icon: '💳', label: 'Paiements' },
    { path: '/charges',   icon: '🧾', label: 'Charges'   },
    { path: '/dette',     icon: '💰', label: 'Dettes'    },
    { path: '/budget',    icon: '📈', label: 'Budget'    },
  ];

  readonly documentsItems: NavItem[] = [
    { path: '/documents', icon: '📁', label: 'Documents' },
    { path: '/reunions',  icon: '🗓️', label: 'Réunions'  },
    { path: '/rapports',  icon: '📊', label: 'Rapports'  },
  ];

  // ── Injection ──────────────────────────────────────────────────────
  private readonly auth = inject(Auth);

  // ── Gestion de la persistance du state ────────────────────────────
  constructor() {
    // Récupérer l'état sauvegardé
    const savedState = localStorage.getItem('sidebarVisible');
    if (savedState !== null) {
      this.isSidebarVisible.set(savedState === 'true');
    }

    // Adapter automatiquement sur mobile
    this.checkScreenSize();
    window.addEventListener('resize', () => this.checkScreenSize());

    // Écouter les toggles dispatchés depuis le header (CustomEvent)
    window.addEventListener('toggleSidebar', () => this.toggleSidebar());
  }

  // ── Méthodes publiques ────────────────────────────────────────────

  /** Toggle la visibilité de la sidebar */
  toggleSidebar(): void {
    this.isSidebarVisible.update(value => {
      const newValue = !value;
      // Sauvegarder la préférence
      localStorage.setItem('sidebarVisible', String(newValue));
      return newValue;
    });
  }

  /** Afficher/masquer la sidebar */
  showSidebar(): void {
    this.isSidebarVisible.set(true);
    localStorage.setItem('sidebarVisible', 'true');
  }

  hideSidebar(): void {
    this.isSidebarVisible.set(false);
    localStorage.setItem('sidebarVisible', 'false');
  }

  /** Toggle menu footer */
  toggleFooterMenu(): void {
    this.isFooterMenuOpen = !this.isFooterMenuOpen;
  }

  /** Déconnexion */
  logout(): void {
    this.auth.logout();
  }

  /** Raccourci clavier pour toggle (Ctrl+B) */
  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'b') {
      event.preventDefault();
      this.toggleSidebar();
    }
  }

  /** Fermer le menu footer au clic outside */
  @HostListener('document:click', ['$event'])
  closeFooterMenu(event: Event): void {
    if (this.footerMenu && !this.footerMenu.nativeElement.contains(event.target)) {
      this.isFooterMenuOpen = false;
    }
  }

  /** Vérifier la taille de l'écran */
  private checkScreenSize(): void {
    if (window.innerWidth < 768) { // Mobile
      this.isSidebarVisible.set(false);
    } else {
      // Restaurer la préférence sur desktop
      const savedState = localStorage.getItem('sidebarVisible');
      if (savedState !== null) {
        this.isSidebarVisible.set(savedState === 'true');
      } else {
        this.isSidebarVisible.set(true); // Visible par défaut sur desktop
      }
    }
  }

  /** Obtenir le libellé du rôle */
  getRoleLabel(role: string): string {
    const roles: Record<string, string> = {
      'COPROPRIETAIRE': 'Copropriétaire',
      'SYNDIC': 'Syndic',
      'ADMIN': 'Administrateur',
      'GESTIONNAIRE': 'Gestionnaire'
    };
    return roles[role] || role || 'Utilisateur';
  }
}