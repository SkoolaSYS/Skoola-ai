import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';

interface TeacherMessage {
  sender_role: 'parent' | 'teacher';
  message: string;
  created_at?: string;
}

interface TeacherInfo {
  id: number;
  name: string;
  email?: string;
}

@Component({
  selector: 'app-teacher-chat',
  templateUrl: './teacher-chat.component.html',
  styleUrls: ['./teacher-chat.component.css']
})
export class TeacherChatComponent implements OnInit, OnDestroy {
  teacherId!: number;
  studentId!: number;

  parentEmail = '';

  userMessage = '';
  messages: TeacherMessage[] = [];

  teacherName = 'Teacher';

  private messageInterval: any;
  private apiUrl = 'http://localhost:5000';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Get teacher ID from the URL path
    this.teacherId = Number(
      this.route.snapshot.paramMap.get('teacherId')
    );

    // Get student ID from the URL path
    this.studentId = Number(
      this.route.snapshot.paramMap.get('studentId')
    );

    // Get logged-in parent email from ?email=
    this.route.queryParamMap.subscribe(params => {
      this.parentEmail = params.get('email') || '';

      console.log('Parent email:', this.parentEmail);
      console.log('Teacher ID:', this.teacherId);
      console.log('Student ID:', this.studentId);

      if (
        !this.parentEmail ||
        !this.teacherId ||
        !this.studentId
      ) {
        console.error(
          'Missing parent email, teacher ID, or student ID'
        );

        return;
      }

      this.loadTeacherInfo();
      this.loadMessages();

      if (this.messageInterval) {
        clearInterval(this.messageInterval);
      }

      this.messageInterval = setInterval(() => {
        this.loadMessages();
      }, 3000);
    });
  }

  loadTeacherInfo(): void {
    if (!this.teacherId) {
      return;
    }

    this.http
      .get<TeacherInfo>(
        `${this.apiUrl}/teachers/${this.teacherId}`
      )
      .subscribe(
        (res) => {
          this.teacherName = res.name;
        },
        (error) => {
          console.error(
            'Failed to load teacher information:',
            error
          );

          this.teacherName = 'Teacher';
        }
      );
  }

  loadMessages(): void {
    if (
      !this.parentEmail ||
      !this.teacherId ||
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

    this.http
      .get<TeacherMessage[]>(url)
      .subscribe(
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
      !this.parentEmail ||
      !this.teacherId ||
      !this.studentId
    ) {
      console.error(
        'Cannot send because parent email, teacher ID, or student ID is missing'
      );

      return;
    }

    this.http
      .post(`${this.apiUrl}/parent-teacher-messages`, {
        parentEmail: this.parentEmail,
        teacherId: this.teacherId,
        studentId: this.studentId,
        senderRole: 'parent',
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