import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImmeublesList } from './immeubles-list';

describe('ImmeublesList', () => {
  let component: ImmeublesList;
  let fixture: ComponentFixture<ImmeublesList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImmeublesList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImmeublesList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
