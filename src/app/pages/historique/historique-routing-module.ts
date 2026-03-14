import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HistoriqueList } from './components/historique-list/historique-list';

const routes: Routes = [
  { path: '', component: HistoriqueList },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HistoriqueRoutingModule { }
