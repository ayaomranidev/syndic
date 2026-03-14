import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ImmeublesList } from './components/immeubles-list/immeubles-list';
import { ImmeubleView } from './components/immeuble-view/immeuble-view';
import { ImmeubleForm } from './components/immeuble-form/immeuble-form';

const routes: Routes = [
  { path: '', component: ImmeublesList },
  { path: 'new', component: ImmeubleForm },
  { path: ':id', component: ImmeubleView },
  { path: ':id/edit', component: ImmeubleForm },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ImmeublesRoutingModule { }
