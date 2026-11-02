import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Import } from './import';

describe('Import', () => {
  let component: Import;
  let fixture: ComponentFixture<Import>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Import]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Import);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
