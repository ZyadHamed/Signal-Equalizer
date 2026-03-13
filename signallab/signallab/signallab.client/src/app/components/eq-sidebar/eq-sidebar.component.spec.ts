import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EqSidebarComponent } from './eq-sidebar.component';

describe('EqSidebarComponent', () => {
  let component: EqSidebarComponent;
  let fixture: ComponentFixture<EqSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EqSidebarComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EqSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
