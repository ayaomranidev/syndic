import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TravauxList } from './components/travaux-list/travaux-list';
import { TravailView } from './components/travail-view/travail-view';
import { TravailForm } from './components/travail-form/travail-form';

const routes: Routes = [
  { path: '', component: TravauxList },
  { path: 'new', component: TravailForm },
  { path: ':id', component: TravailView },
  { path: ':id/edit', component: TravailForm },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class TravauxRoutingModule { }
