import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ResidencesRoutingModule } from './residences-routing.module';
import { ResidencesComponent } from './components/residences.component';

@NgModule({
  imports: [CommonModule, ResidencesRoutingModule, ResidencesComponent],
})
export class ResidencesModule {}
