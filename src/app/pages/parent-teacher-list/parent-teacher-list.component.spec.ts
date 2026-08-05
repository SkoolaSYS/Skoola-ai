import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ParentTeacherListComponent } from './parent-teacher-list.component';

describe('ParentTeacherListComponent', () => {
  let component: ParentTeacherListComponent;
  let fixture: ComponentFixture<ParentTeacherListComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ParentTeacherListComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ParentTeacherListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
