import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
  { path: 'auth', loadChildren: () => import('./pages/auth/auth-module').then(m => m.AuthModule) },
  { path: 'dashboard', loadChildren: () => import('./pages/dashboard/dashboard-module').then(m => m.DashboardModule), canActivate: [authGuard] },
  { path: 'residences', loadChildren: () => import('./pages/residences/residences.module').then(m => m.ResidencesModule), canActivate: [authGuard] },
  { path: 'appartements', loadComponent: () => import('./pages/appartements/components/appartements.component').then(m => m.AppartementsComponent), canActivate: [authGuard] },
  { path: 'coproprietaires', loadComponent: () => import('./pages/coproprietaires/components/coproprietaires.component').then(m => m.CoproprietairesComponent), canActivate: [authGuard] },
  { path: 'paiements', loadComponent: () => import('./pages/paiements/components/paiements.component').then(m => m.PaiementsComponent), canActivate: [authGuard] },
  { path: 'paiements/affectation', loadComponent: () => import('./pages/paiements/components/paiement-affectation/paiement-affectation-view.component').then(m => m.PaiementAffectationViewComponent), canActivate: [authGuard], title: 'Affectation des paiements' },
  { path: 'generation-dettes', loadComponent: () => import('./pages/dette/components/generation-dettes/generation-dettes.component').then(m => m.GenerationDettesComponent), canActivate: [authGuard], title: 'Génération des dettes' },
  { path: 'dettes/par-annee', loadComponent: () => import('./pages/dette/components/dette-par-annee/dette-par-annee.component').then(m => m.DetteParAnneeComponent), canActivate: [authGuard], title: 'Dettes par année' },
  { path: 'charges', loadComponent: () => import('./pages/charges/components/charges.component').then(m => m.ChargesComponent), canActivate: [authGuard], title: 'Charges communes' },
  { path: 'charges/repartition', loadComponent: () => import('./pages/charges/components/charge-repartition/charge-repartition-view.component').then(m => m.ChargeRepartitionViewComponent), canActivate: [authGuard], title: 'Répartition des charges' },
  { path: 'historique-paiements', loadComponent: () => import('./pages/paiements/components/historique-paiements/historique-paiements.component').then(m => m.HistoriquePaiementsComponent), canActivate: [authGuard], title: 'Historique des paiements - Tasnim' },
  { path: 'batiments', loadComponent: () => import('./pages/batiments/components').then(m => m.BatimentsComponent), canActivate: [authGuard] },
  { path: 'profile', loadComponent: () => import('./pages/profile/components/profile-view/profile-view').then(m => m.ProfileView), canActivate: [authGuard] },
  { path: 'dette', loadComponent: () => import('./pages/dette/components/dette.component').then(m => m.DettesComponent), canActivate: [authGuard], title: 'Dettes' },
  { path: 'documents', loadComponent: () => import('./pages/documents/components/documents/documents.component').then(m => m.DocumentsComponent), canActivate: [authGuard], title: 'Documents' },
  { path: 'rapports', loadComponent: () => import('./pages/rapports/components/rapports.component').then(m => m.RapportsComponent), canActivate: [authGuard], title: 'Rapports' },
  { path: 'reunions', loadComponent: () => import('./pages/reunions/components/reunions.component').then(m => m.ReunionsComponent), canActivate: [authGuard], title: 'Réunions' },
  { path: 'budget', loadComponent: () => import('./pages/budget-depenses/components/budget.component').then(m => m.BudgetComponent), canActivate: [authGuard], title: 'Budget' },
  { path: 'notification', loadComponent: () => import('./pages/notifications/components/alertes.component').then(m => m.AlertesComponent), canActivate: [authGuard], title: 'Notifications' },
  { path: 'settings', loadComponent: () => import('./pages/parametres/components/parametres/parametres.component').then(m => m.ParametresComponent), canActivate: [authGuard], title: 'Paramètres' },
  

  { path: '', redirectTo: 'auth', pathMatch: 'full' },
  { path: '**', redirectTo: 'auth' }
];
