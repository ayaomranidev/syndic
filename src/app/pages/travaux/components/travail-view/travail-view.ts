import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-travail-view',
  imports: [CommonModule],
  templateUrl: './travail-view.html',
  styleUrl: './travail-view.css',
})
export class TravailView {
  @Input() id?: string | null;
}
