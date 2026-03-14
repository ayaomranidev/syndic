import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-immeuble-view',
  imports: [CommonModule],
  templateUrl: './immeuble-view.html',
  styleUrl: './immeuble-view.css',
})
export class ImmeubleView {
  @Input() id?: string | null;
}
