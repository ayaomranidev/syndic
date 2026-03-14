import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  toggleSidebar(): void {
    window.dispatchEvent(new CustomEvent('toggleSidebar'));
  }
}
