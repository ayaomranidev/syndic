import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-immeuble-form',
  imports: [],
  templateUrl: './immeuble-form.html',
  styleUrl: './immeuble-form.css',
})
export class ImmeubleForm {
  @Output() saved = new EventEmitter<void>();
}
