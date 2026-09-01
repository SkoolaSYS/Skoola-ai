import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';

interface Message {
  id?: number;
  sender_role: 'parent' | 'teacher';
  message: string;

  attachment_name?: string;
  attachment_path?: string;
  attachment_type?: string;
  document_id?: number;

  created_at?: string;
}

interface Teacher {
  id: number;
  name: string;
  email: string;
}

@Component({
  selector: 'app-teacher-parent-chat',
  templateUrl: './teacher-parent-chat.component.html',
  styleUrls: ['./teacher-parent-chat.component.css']
})
export class TeacherParentChatComponent
  implements OnInit, OnDestroy {

  teacherEmail = '';
  teacherId = 0;

  parentEmail = '';
  studentId = 0;

  userMessage = '';
  messages: Message[] = [];

  private messageInterval: any;
  private apiUrl = '/api';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.teacherEmail = params.get('email') || '';
      this.parentEmail = params.get('parentEmail') || '';
      this.studentId = Number(params.get('studentId'));

      console.log('Teacher email:', this.teacherEmail);
      console.log('Parent email:', this.parentEmail);
      console.log('Student ID:', this.studentId);

      if (
        !this.teacherEmail ||
        !this.parentEmail ||
        !this.studentId
      ) {
        console.error(
          'Missing teacher email, parent email, or student ID in URL'
        );

        return;
      }

      this.loadTeacherByEmail();
    });
  }

  loadTeacherByEmail(): void {
    const url =
      `${this.apiUrl}/teacher-by-email` +
      `?email=${encodeURIComponent(this.teacherEmail)}`;

    this.http.get<Teacher>(url).subscribe(
      (teacher) => {
        this.teacherId = teacher.id;

        console.log('Teacher ID:', this.teacherId);

        this.loadMessages();

        if (this.messageInterval) {
          clearInterval(this.messageInterval);
        }

        this.messageInterval = setInterval(() => {
          this.loadMessages();
        }, 3000);
      },
      (error) => {
        console.error(
          'Failed to find teacher account:',
          error
        );

        console.error(
          'Backend error:',
          error.error
        );
      }
    );
  }

  loadMessages(): void {
    if (
      !this.teacherId ||
      !this.parentEmail ||
      !this.studentId
    ) {
      return;
    }

    const url =
      `${this.apiUrl}/parent-teacher-messages` +
      `?parentEmail=${encodeURIComponent(this.parentEmail)}` +
      `&teacherId=${this.teacherId}` +
      `&studentId=${this.studentId}`;

    console.log('Loading messages from:', url);

    this.http.get<Message[]>(url).subscribe(
      (res) => {
        this.messages = res;
      },
      (error) => {
        console.error(
          'Failed to load messages:',
          error
        );

        console.error(
          'Backend error:',
          error.error
        );
      }
    );
  }

  sendMessage(): void {
    const text = this.userMessage.trim();

    if (!text) {
      return;
    }

    if (
      !this.teacherId ||
      !this.parentEmail ||
      !this.studentId
    ) {
      console.error(
        'Cannot send message because chat information is missing'
      );

      return;
    }

    this.http
      .post(`${this.apiUrl}/parent-teacher-messages`, {
        parentEmail: this.parentEmail,
        teacherId: this.teacherId,
        studentId: this.studentId,
        senderRole: 'teacher',
        message: text
      })
      .subscribe(
        () => {
          this.userMessage = '';
          this.loadMessages();
        },
        (error) => {
          console.error(
            'Failed to send message:',
            error
          );

          console.error(
            'Backend error:',
            error.error
          );
        }
      );
  }

  ngOnDestroy(): void {
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
    }
  }
}