import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { CommonModule, AsyncPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';

// Services
import { Auth } from '../../../core/services/auth';
import { AlerteService } from '../../../pages/notifications/services/alerte.service';
import { NotificationPanelService } from '../../../pages/notifications/services/notification-panel.service';
import { FcmService } from '../../../pages/notifications/services/fcm.service';
import { NotificationDrawerComponent } from '../notification-drawer/notification-drawer.component';

interface TabItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

interface SearchResult {
  id: string;
  label: string;
  icon: string;
  link: string;
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, AsyncPipe, RouterModule, NotificationDrawerComponent],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'navbar-shell' },
})
export class NavbarComponent implements OnInit, OnDestroy {
  // États du menu
  isProfileOpen = false;
  isMobileMenuOpen = false;
  isTransparent = true;
  
  // États de recherche
  isSearching = false;
  searchResults: SearchResult[] = [];
  
  // Page courante pour le breadcrumb
  currentPage = 'Tableau de bord';

  // États UI
  isOpen = false;
  compact = true;

  // Streams et signaux
  readonly user$ = inject(Auth).currentUser$;
  readonly nonLuesCount = signal<number>(0);
  readonly hasCritique = signal<boolean>(false);

  // Tabs pour le menu mobile
  readonly allMobileTabs: TabItem[] = [
    { path: '/dashboard',       label: 'Tableau de bord',  icon: '📊', exact: true },
    { path: '/residences',      label: 'Résidences',        icon: '🏘️' },
    { path: '/batiments',       label: 'Bâtiments',         icon: '🏢' },
    { path: '/appartements',    label: 'Appartements',      icon: '🏠' },
    { path: '/coproprietaires', label: 'Copropriétaires',   icon: '👥' },
    { path: '/paiements',       label: 'Paiements',         icon: '💳' },
    { path: '/charges',         label: 'Charges',           icon: '🧾' },
    { path: '/dette',           label: 'Dettes',            icon: '💰' },
    { path: '/documents',       label: 'Documents',         icon: '📁' },
    { path: '/notifications',   label: 'Notifications',     icon: '🔔' },
  ];

  // Services
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly alerteSvc = inject(AlerteService);
  protected readonly panel = inject(NotificationPanelService);
  private readonly fcmSvc = inject(FcmService);

  private unsubscribeAlerts: (() => void) | null = null;

  ngOnInit() {
    // Écouter les alertes non lues
    this.unsubscribeAlerts = this.alerteSvc.ecouterNonLues((alertes) => {
      this.nonLuesCount.set(alertes.length);
      this.hasCritique.set(alertes.some(a => a.priorite === 'CRITIQUE'));
    });

    // Initialiser FCM
    this.user$.subscribe(user => {
      if (user?.firebaseUid) {
        this.fcmSvc.init(user.firebaseUid).catch(err =>
          console.warn('[FCM] Initialisation échouée:', err)
        );
      } else if (user?.id) {
        this.fcmSvc.init(String(user.id)).catch(err =>
          console.warn('[FCM] Initialisation échouée:', err)
        );
      }
    });

    // Gérer la navigation
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.compact = !event.urlAfterRedirects.startsWith('/auth');
      
      // Mettre à jour le fond de la navbar
      this.updateNavbarBackground();
      
      // Mettre à jour le breadcrumb
      this.updateCurrentPage(event.urlAfterRedirects);
    });

    // Écouter le scroll pour gérer la transparence
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.handleScroll.bind(this));
    }
  }

  ngOnDestroy(): void {
    if (this.unsubscribeAlerts) {
      this.unsubscribeAlerts();
      this.unsubscribeAlerts = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleScroll.bind(this));
    }
  }

  // Gestionnaires de menu
  toggleProfileMenu(): void {
    this.isProfileOpen = !this.isProfileOpen;
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  // Gestionnaires de recherche
  onSearchFocus(): void {
    this.isSearching = true;
  }

  onSearchBlur(): void {
    setTimeout(() => {
      this.isSearching = false;
    }, 200);
  }

  onSearchInput(query: string): void {
    if (!query.trim()) {
      this.searchResults = [];
      return;
    }
    
    // Simuler des résultats de recherche
    this.searchResults = [
      { id: '1', label: 'Résultats pour: ' + query, icon: '🔍', link: '/search' },
    ];
  }

  // Gestionnaire de scroll
  private handleScroll(): void {
    this.updateNavbarBackground();
  }

  private updateNavbarBackground(): void {
    if (typeof window !== 'undefined') {
      this.isTransparent = window.scrollY < 50;
    }
  }

  private updateCurrentPage(url: string): void {
    const segments = url.split('/').filter(s => s);
    if (segments.length > 0) {
      const page = '/' + segments[0];
      const tab = this.allMobileTabs.find(t => t.path === page);
      if (tab) {
        this.currentPage = tab.label;
      }
    }
  }

  // Utilitaires
  getRoleLabel(role: string): string {
    const roles: Record<string, string> = {
      'COPROPRIETAIRE': 'Copropriétaire',
      'SYNDIC': 'Syndic',
      'ADMIN': 'Administrateur',
      'GESTIONNAIRE': 'Gestionnaire'
    };
    return roles[role] || role || 'Utilisateur';
  }

  // Actions
  logout(): void {
    this.fcmSvc.removeToken().catch(() => {});
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }

  // 👇 MODIFIÉ: Ouvre le drawer des dernières notifications
  openNotificationDrawer(): void {
    this.panel.toggle();
  }

  // 👇 NOUVEAU: Navigue vers la page complète des notifications
  voirHistoriqueNotifications(): void {
    this.router.navigate(['/notification']);
    this.panel.close();
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
  }
}