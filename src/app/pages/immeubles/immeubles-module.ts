import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ImmeublesRoutingModule } from './immeubles-routing-module';
import { ImmeublesList } from './components/immeubles-list/immeubles-list';
import { ImmeubleView } from './components/immeuble-view/immeuble-view';
import { ImmeubleForm } from './components/immeuble-form/immeuble-form';

@NgModule({
  imports: [
    CommonModule,
    ImmeublesRoutingModule,
    ImmeublesList,
    ImmeubleView,
    ImmeubleForm,
  ]
})
export class ImmeublesModule { }
