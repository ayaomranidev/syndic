import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'relativeTime', standalone: true, pure: false })
export class RelativeTimePipe implements PipeTransform {
  transform(value: Date | any): string {
    if (!value) return '';
    const date = value instanceof Date ? value : (value.toDate ? value.toDate() : new Date(value));
    const now   = new Date();
    const diff  = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60)        return 'À l\'instant';
    if (diff < 3600)      return `Il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400)     return `Il y a ${Math.floor(diff / 3600)}h`;
    if (diff < 172800)    return 'Hier';
    if (diff < 604800)    return `Il y a ${Math.floor(diff / 86400)}j`;
    return date.toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}