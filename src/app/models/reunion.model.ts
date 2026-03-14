export type ReunionStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export interface AgendaItem {
  id?: string;
  title: string;
  presenterId?: string;
  durationMinutes?: number;
  notes?: string;
}

export interface Reunion {
  id: string;
  title: string;
  date: string; // ISO date/time
  location?: string;
  status?: ReunionStatus;
  agenda?: AgendaItem[];
  attendeesIds?: string[];
  minutesUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface Reunion {
}
