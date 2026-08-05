import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { TeacherParentChatComponent } from './teacher-parent-chat.component';

describe('TeacherParentChatComponent', () => {
  let component: TeacherParentChatComponent;
  let fixture: ComponentFixture<TeacherParentChatComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TeacherParentChatComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TeacherParentChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
