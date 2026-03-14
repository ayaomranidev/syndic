import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class Historique {
  // Minimal CRUD-like stubs for future implementation
  async list(query?: any): Promise<any[]> {
    return [];
  }

  async get(id: string): Promise<any | null> {
    return null;
  }
}
