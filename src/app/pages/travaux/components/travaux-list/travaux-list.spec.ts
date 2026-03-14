import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TravauxList } from './travaux-list';

describe('TravauxList', () => {
  let component: TravauxList;
  let fixture: ComponentFixture<TravauxList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TravauxList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TravauxList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
