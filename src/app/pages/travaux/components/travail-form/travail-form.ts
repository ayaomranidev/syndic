import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-travail-form',
  imports: [],
  templateUrl: './travail-form.html',
  styleUrl: './travail-form.css',
})
export class TravailForm {
  @Output() saved = new EventEmitter<void>();
}
