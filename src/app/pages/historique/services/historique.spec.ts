import { TestBed } from '@angular/core/testing';

import { Historique } from './historique';

describe('Historique', () => {
  let service: Historique;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Historique);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
