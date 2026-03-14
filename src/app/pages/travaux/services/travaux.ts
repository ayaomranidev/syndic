import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TravauxService {
  async list(query?: any): Promise<any[]> { return []; }
  async get(id: string): Promise<any | null> { return null; }
  async create(payload: any): Promise<any> { return payload; }
  async update(id: string, payload: any): Promise<any> { return payload; }
  async delete(id: string): Promise<void> {}
}
