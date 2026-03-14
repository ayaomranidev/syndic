import { TestBed } from '@angular/core/testing';

import { Travail } from './travail';

describe('Travail', () => {
  let service: Travail;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Travail);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
