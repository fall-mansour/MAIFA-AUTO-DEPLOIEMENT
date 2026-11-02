import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Suivigestionnaire } from './suivigestionnaire';

describe('Suivigestionnaire', () => {
  let component: Suivigestionnaire;
  let fixture: ComponentFixture<Suivigestionnaire>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Suivigestionnaire]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Suivigestionnaire);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
