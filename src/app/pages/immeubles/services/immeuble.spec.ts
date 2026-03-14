import { TestBed } from '@angular/core/testing';

import { Immeuble } from './immeuble';

describe('Immeuble', () => {
  let service: Immeuble;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Immeuble);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
