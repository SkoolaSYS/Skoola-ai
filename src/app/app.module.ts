import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ChatComponent } from './pages/chat/chat.component';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { TeacherChatComponent } from './pages/teacher-chat/teacher-chat.component';
import { TeacherParentChatComponent } from './pages/teacher-parent-chat/teacher-parent-chat.component';
import { ParentTeacherListComponent } from './pages/parent-teacher-list/parent-teacher-list.component';

@NgModule({
  declarations: [
    AppComponent,
    ChatComponent,
    TeacherChatComponent,
    TeacherParentChatComponent,
    ParentTeacherListComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
