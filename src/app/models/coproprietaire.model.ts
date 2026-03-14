import { User } from './user.model';

export interface Coproprietaire extends User {
  role: 'COPROPRIETAIRE'; // fixe le rôle métier
  firstname: string;
  lastname: string;
  fullname?: string;
  lotNumber?: string; // numéro de lot/appartement
  immeubleId?: string;
  isOwner?: boolean;
  notes?: string;
}
