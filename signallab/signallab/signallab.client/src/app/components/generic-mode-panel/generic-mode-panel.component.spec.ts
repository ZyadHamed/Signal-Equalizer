import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GenericModePanelComponent } from './generic-mode-panel.component';

describe('GenericModePanelComponent', () => {
  let component: GenericModePanelComponent;
  let fixture: ComponentFixture<GenericModePanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GenericModePanelComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GenericModePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
