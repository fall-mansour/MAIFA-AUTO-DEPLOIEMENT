import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Ajoutpieces } from './ajoutpieces';

describe('Ajoutpieces', () => {
  let component: Ajoutpieces;
  let fixture: ComponentFixture<Ajoutpieces>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Ajoutpieces]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Ajoutpieces);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
