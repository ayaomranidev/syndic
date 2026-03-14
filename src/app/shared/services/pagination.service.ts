import { Injectable, Signal, signal, computed, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PaginationService<T> {
  private _pageSize = signal(10);
  private _currentPage = signal(1);
  private _items = signal<T[]>([]);

  setItems(items: T[]) {
    this._items.set(items);
  }

  // Reset la page à 1 automatiquement quand les items changent
  private readonly resetPageEffect = effect(() => {
    this._currentPage.set(1);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this._items();
  });

  setPageSize(size: number) {
    this._pageSize.set(size);
    this._currentPage.set(1);
  }

  setPage(page: number) {
    const total = this.totalPages();
    if (page < 1 || page > total) return;
    this._currentPage.set(page);
  }

  pageSize = () => this._pageSize();
  currentPage = () => this._currentPage();
  totalPages = computed(() => {
    const total = this._items().length;
    return Math.max(1, Math.ceil(total / this._pageSize()));
  });
  pagedItems = computed(() => {
    const all = this._items();
    const start = (this._currentPage() - 1) * this._pageSize();
    return all.slice(start, start + this._pageSize());
  });
}
