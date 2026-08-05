import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ChatComponent } from './pages/chat/chat.component';
import { TeacherChatComponent } from './pages/teacher-chat/teacher-chat.component';
import { TeacherParentChatComponent } from './pages/teacher-parent-chat/teacher-parent-chat.component';
import { ParentTeacherListComponent } from './pages/parent-teacher-list/parent-teacher-list.component';

const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'chat', component: ChatComponent },
  {
    path: 'parent/teachers',
    component: ParentTeacherListComponent
  },
  {
    path: 'parent/teacher-chat/:teacherId/:studentId',
    component: TeacherChatComponent
  },
  {
    path: 'teacher/parent-chat',
    component: TeacherParentChatComponent
  }

];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
