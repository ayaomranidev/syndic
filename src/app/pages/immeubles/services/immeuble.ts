import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class Immeuble {
  async list(query?: any): Promise<any[]> { return []; }
  async get(id: string): Promise<any | null> { return null; }
  async create(data: any): Promise<any> { return data; }
  async update(id: string, data: any): Promise<any> { return data; }
  async delete(id: string): Promise<void> {}
}
