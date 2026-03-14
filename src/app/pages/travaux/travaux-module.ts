import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { TravauxRoutingModule } from './travaux-routing-module';
import { TravauxList } from './components/travaux-list/travaux-list';
import { TravailView } from './components/travail-view/travail-view';
import { TravailForm } from './components/travail-form/travail-form';
@NgModule({
  imports: [
    CommonModule,
    TravauxRoutingModule,
    TravauxList,
    TravailView,
    TravailForm,
  ]
})
export class TravauxModule { }

