import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoriqueRoutingModule } from './historique-routing-module';
import { HistoriqueList } from './components/historique-list/historique-list';

@NgModule({
  imports: [
    CommonModule,
    HistoriqueRoutingModule,
    HistoriqueList,
  ]
})
export class HistoriqueModule { }
