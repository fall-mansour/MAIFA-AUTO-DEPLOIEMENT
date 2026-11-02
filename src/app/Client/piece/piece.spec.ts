import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PieceDetail } from './piece';

describe('PieceDetail', () => {
  let component: PieceDetail;
  let fixture: ComponentFixture<PieceDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PieceDetail],
    }).compileComponents();

    fixture = TestBed.createComponent(PieceDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
