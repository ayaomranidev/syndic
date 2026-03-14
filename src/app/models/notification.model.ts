export type NotificationType = 'INFO' | 'ALERT' | 'REMINDER' | 'SYSTEM';

export interface NotificationModel {
  id: string;
  userId?: string; // target user
  title: string;
  message: string;
  type?: NotificationType;
  read?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  residenceId?: string; 

}
export interface Notification {
}
