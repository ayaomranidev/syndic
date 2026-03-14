import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlerteService } from '../../../pages/notifications/services/alerte.service';
import { NotificationPanelService } from '../../../pages/notifications/services/notification-panel.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      (click)="toggle()"
      class="bell-btn"
      [class.has-notif]="nbNonLues() > 0"
      [class.critical]="hasCritique()"
      [attr.aria-label]="'Notifications (' + nbNonLues() + ' non lue(s))'">

      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.8"
           [class.bell-ring]="hasCritique()">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>

      @if (nbNonLues() > 0) {
        <span class="bell-badge" [class.critical]="hasCritique()">
          {{ nbNonLues() > 99 ? '99+' : nbNonLues() }}
        </span>
      }
    </button>
  `,
  styles: [`
    :host { display: inline-block; }

    .bell-btn {
      position: relative;
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      color: #64748b;
      cursor: pointer;
      transition: all 150ms ease;
    }

    .bell-btn:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #334155;
    }

    .bell-btn.has-notif {
      border-color: #bfdbfe;
      background: #eff6ff;
      color: #2563eb;
    }

    .bell-btn.critical {
      border-color: #fecaca;
      background: #fef2f2;
      color: #dc2626;
      animation: criticalShake 3s ease infinite;
    }

    @keyframes criticalShake {
      0%,90%,100% { transform: rotate(0deg); }
      92%          { transform: rotate(-8deg); }
      94%          { transform: rotate(8deg); }
      96%          { transform: rotate(-5deg); }
      98%          { transform: rotate(5deg); }
    }

    .bell-ring { animation: bellRing 2.5s ease infinite; }

    @keyframes bellRing {
      0%,80%,100% { transform: rotate(0deg); transform-origin: top center; }
      82%          { transform: rotate(-12deg); }
      86%          { transform: rotate(10deg); }
      90%          { transform: rotate(-6deg); }
      94%          { transform: rotate(4deg); }
    }

    .bell-badge {
      position: absolute;
      top: -6px; right: -6px;
      min-width: 18px; height: 18px;
      background: #2563eb;
      border: 2px solid white;
      border-radius: 50px;
      font-size: 9px; font-weight: 800;
      color: white;
      display: flex; align-items: center; justify-content: center;
      padding: 0 3px;
      font-family: system-ui, sans-serif;
      animation: badgeIn .25s cubic-bezier(.34,1.56,.64,1);
    }

    .bell-badge.critical {
      background: #ef4444;
      animation: badgeIn .25s cubic-bezier(.34,1.56,.64,1), badgePulse 1.5s ease infinite;
    }

    @keyframes badgeIn {
      from { transform: scale(0); }
      to   { transform: scale(1); }
    }

    @keyframes badgePulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.4); }
      50%      { box-shadow: 0 0 0 5px rgba(239,68,68,0); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent {
  private readonly alerteSvc = inject(AlerteService);
  private readonly panelSvc  = inject(NotificationPanelService);

  readonly nbNonLues  = this.alerteSvc.nbNonLues;
  readonly hasCritique = this.alerteSvc.hasCritique;

  toggle(): void { this.panelSvc.toggle(); }
}