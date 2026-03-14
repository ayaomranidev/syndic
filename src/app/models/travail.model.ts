export type TravailStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface Travail {
  id: string;
  title: string;
  description?: string;
  status: TravailStatus;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  requestedById?: string; // user id
  assignedToId?: string; // user or contractor id
  estimatedCost?: number;
  reportedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  attachments?: string[]; // urls
  commentsCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
export interface Travail {
}
