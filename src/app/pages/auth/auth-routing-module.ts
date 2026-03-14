import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Login } from './login/login';

const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'role-selection', loadComponent: () => import('./role-selection/role-selection').then(m => m.RoleSelection) },
  { path: 'reset-password', loadComponent: () => import('./reset-password/reset-password').then(m => m.ResetPassword) },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuthRoutingModule {}