import { Injectable } from '@angular/core';
import { of, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor() {}

  getStats(): Observable<any> {
    const stats = {
      totalCharges: 12500,
      pendingPayments: 8,
      openWorks: 3,
      nextMeeting: '2026-03-15',
      // admin-specific
      totalUsers: 7,
      activeUsers: 7,
      systemHealth: '100%',
      roles: [
        { key: 'coproprietaire', label: 'Copropriétaires', count: 2, color: 'bg-blue-500' },
        { key: 'locataire', label: 'Locataires', count: 1, color: 'bg-green-500' },
        { key: 'tresorier', label: 'Trésoriers', count: 1, color: 'bg-yellow-400' },
        { key: 'president', label: 'Présidents', count: 1, color: 'bg-purple-500' },
        { key: 'gardien', label: 'Gardiens', count: 1, color: 'bg-orange-500' },
        { key: 'admin', label: 'Admins', count: 1, color: 'bg-red-500' },
      ],
    };
    return of(stats);
  }

  getRecentActivities(): Observable<any[]> {
    const activities = [
      { title: 'Facture 2026-01 reçue', meta: '3 jours' },
      { title: 'Travail: Remplacement pompe', meta: 'En cours' },
      { title: 'Réunion programmée', meta: '15 mars 2026' },
    ];
    return of(activities);
  }

  getBudgetOverview(): Observable<any> {
    const budget = {
      totalExpense: 9800,
      lines: [
        { category: 'Entretien', amount: 4200 },
        { category: 'Électricité', amount: 2300 },
        { category: 'Assurance', amount: 1500 },
      ],
    };
    return of(budget);
  }
}

