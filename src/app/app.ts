import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';
import { NavbarComponent } from './shared/components/navbar/navbar.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { NotificationPanelService } from './pages/notifications/services/notification-panel.service';
import { AlerteService } from './pages/notifications/services/alerte.service';
import { Auth } from './core/services/auth';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet, 
    NavbarComponent, 
    SidebarComponent
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  protected readonly title = signal('SyndicPro');
  showLayout = true;

  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  protected readonly notificationPanel = inject(NotificationPanelService);
  private readonly alerteService = inject(AlerteService);

  ngOnInit() {
    // Gérer l'affichage du layout (cacher sur les pages d'auth)
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.showLayout = !event.urlAfterRedirects.startsWith('/auth');
    });

    // Démarrer l'écoute des notifications quand l'utilisateur est connecté
    this.auth.currentUser$.subscribe(user => {
      if (user?.firebaseUid) {
        this.alerteService.startEcoute(user.firebaseUid);
      } else if (user?.id) {
        this.alerteService.startEcoute(String(user.id));
      } else {
        this.alerteService.stopEcoute();
      }
    });
  }
}