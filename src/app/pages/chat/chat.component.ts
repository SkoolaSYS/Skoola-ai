import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;

  attachmentName?: string;
  attachmentType?: string;
  attachmentUrl?: string;

  actionType?: 'OPEN_TEACHER_LIST';
  actionLabel?: string;
}

interface TeacherAccount {
  id: number;
  name: string;
  email: string;
}

interface ChatResponse {
  reply: string;
  action?: string;
  teacher_id?: number;
  teacher_name?: string;
  student_id?: number;
  subject?: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit {
   @ViewChild('fileInput', { static: false })
  fileInput!: ElementRef<HTMLInputElement>;
  readonly apiUrl = 'http://72.61.151.99:5001';

  userMessage = '';
  loading = false;
  checkingAccount = true;

  selectedFile: File | null = null;
  selectedFileName = '';
  uploadingFile = false;

  messages: ChatMessage[] = [];

  loginEmail = '';

  userMode: 'parent' | 'teacher' | null = null;

  teacherUserId: number | null = null;
  teacherName = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
  this.route.queryParamMap.subscribe(params => {
    this.loginEmail =
      (params.get('email') || '').trim();

    console.log('Email received:', this.loginEmail);

    if (!this.loginEmail) {
      this.checkingAccount = false;

      this.messages = [
        {
          role: 'ai',
          text:
            'No email was provided. Please open the chat using your account email.'
        }
      ];

      return;
    }

    this.detectUserMode();
  });
}

  openTeacherList(): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(
        ['/parent/teachers'],
        {
          queryParams: {
            email: this.loginEmail
          }
        }
      )
    );

    this.router.navigateByUrl(url);
  }

  uploadTeacherDocument(optionalMessage: string): void {
  if (
    this.userMode !== 'teacher' ||
    this.teacherUserId === null ||
    !this.selectedFile
  ) {
    return;
  }

  const file = this.selectedFile;

  const formData = new FormData();

  formData.append('file', file);
  formData.append(
    'teacherId',
    this.teacherUserId.toString()
  );

  formData.append(
    'title',
    optionalMessage || file.name
  );
  formData.append('eventScope', 'school');

  this.messages.push({
    role: 'user',
    text: optionalMessage || `Uploaded ${file.name}`,
    attachmentName: file.name,
    attachmentType: file.type
  });

  this.userMessage = '';
  this.uploadingFile = true;
  this.loading = true;

  this.http.post<any>(
    `${this.apiUrl}/school-documents/upload`,
    formData
  ).subscribe({
    next: response => {
      this.uploadingFile = false;
      this.loading = false;

      this.selectedFile = null;
      this.selectedFileName = '';

      const eventCount =
        typeof response.eventsCreated === 'number'
          ? response.eventsCreated
          : Array.isArray(response.events)
            ? response.events.length
            : 0;

      let reply =
        response.message ||
        'The document was uploaded and processed successfully.';

      if (eventCount > 0) {
        reply +=
          ` I found ${eventCount} school event` +
          `${eventCount === 1 ? '' : 's'} and saved ` +
          'them for verification.';
      } else {
        reply +=
          ' I did not find any clearly dated school events.';
      }

      this.messages.push({
        role: 'ai',
        text: reply
      });
    },

    error: (error: HttpErrorResponse) => {
      this.uploadingFile = false;
      this.loading = false;

      console.error('Document upload error:', error);
      console.error('Backend response:', error.error);

      this.messages.push({
        role: 'ai',
        text:
          error.error?.details ||
          error.error?.message ||
          error.error?.error ||
          'The document could not be processed.'
      });
    }
  });
}

  /**
   * Checks whether the supplied email belongs to a teacher.
   *
   * If /teacher-by-email returns a teacher, teacher mode is used.
   * If it returns 404, the email is treated as a parent account.
   */
  detectUserMode(): void {
    this.checkingAccount = true;
    this.userMode = null;
    this.teacherUserId = null;
    this.teacherName = '';

    this.http.get<TeacherAccount>(
      `${this.apiUrl}/teacher-by-email`,
      {
        params: {
          email: this.loginEmail
        }
      }
    ).subscribe({
      next: teacher => {
        this.checkingAccount = false;
        this.userMode = 'teacher';
        this.teacherUserId = teacher.id;
        this.teacherName = teacher.name;

        console.log('Teacher mode activated:', teacher);

        this.messages = [
          {
            role: 'ai',
            text:
              `Hello ${teacher.name}! ` +
              'How can I help you with your classes today?'
          }
        ];
      },

      error: (error: HttpErrorResponse) => {
        this.checkingAccount = false;

        if (error.status === 404) {
          this.userMode = 'parent';

          console.log('Parent mode activated:', this.loginEmail);

          this.messages = [
            {
              role: 'ai',
              text: 'Hello! How can I help you regarding your child today?'
            },
            {
              role: 'ai',
              text: 'You can also chat directly with one of your child\'s teachers.',
              actionType: 'OPEN_TEACHER_LIST',
              actionLabel: 'Choose a teacher'
            }
          ];

          return;
        }

        console.error('Account detection error:', error);

        this.messages = [
          {
            role: 'ai',
            text:
              error.error?.message ||
              'Unable to identify this account.'
          }
        ];
      }
    });
  }

  openFilePicker(fileInput: HTMLInputElement): void {
  if (this.userMode !== 'teacher') {
    return;
  }

  fileInput.click();
}

onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;

  if (!input.files || input.files.length === 0) {
    return;
  }

  const file = input.files[0];

  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png'
  ];

  if (!allowedTypes.includes(file.type)) {
    alert('Only PDF, JPG, JPEG and PNG files are allowed.');

    input.value = '';
    return;
  }

  const maximumFileSize = 10 * 1024 * 1024;

  if (file.size > maximumFileSize) {
    alert('The file must be smaller than 10 MB.');

    input.value = '';
    return;
  }

  this.selectedFile = file;
  this.selectedFileName = file.name;
}

removeSelectedFile(fileInput: HTMLInputElement): void {
  this.selectedFile = null;
  this.selectedFileName = '';
  fileInput.value = '';
}

  sendMessage(): void {
    const text = this.userMessage.trim();

if (
  this.loading ||
  this.uploadingFile ||
  this.checkingAccount
) {
  return;
}

if (
  !text &&
  !(
    this.userMode === 'teacher' &&
    this.selectedFile
  )
) {
  return;
}

if (
  this.userMode === 'teacher' &&
  this.selectedFile
) {
  this.uploadTeacherDocument(text);
  return;
}

    if (!this.userMode) {
      this.messages.push({
        role: 'ai',
        text: 'Your account type could not be identified.'
      });

      return;
    }

    if (
      this.userMode === 'teacher' &&
      this.teacherUserId === null
    ) {
      this.messages.push({
        role: 'ai',
        text: 'Teacher account information is unavailable.'
      });

      return;
    }

    this.messages.push({
      role: 'user',
      text
    });

    this.userMessage = '';
    this.loading = true;

    const requestBody =
      this.userMode === 'teacher'
        ? {
            userId: this.teacherUserId,
            role: 'teacher',
            message: text
          }
        : {
            email: this.loginEmail,
            role: 'parent',
            message: text
          };

    console.log('Chat mode:', this.userMode);
    console.log('Sending chat request:', requestBody);

    this.http.post<ChatResponse>(
      `${this.apiUrl}/chat`,
      requestBody
    ).subscribe({
      next: response => {
        this.loading = false;

        this.messages.push({
          role: 'ai',
          text: response.reply || 'Sorry, I could not reply.'
        });

        if (
          this.userMode === 'parent' &&
          response.action === 'OPEN_TEACHER_CHAT' &&
          response.teacher_id &&
          response.student_id
        ) {
          this.openTeacherChat(
            response.teacher_id,
            response.student_id
          );
        }
      },

      error: (error: HttpErrorResponse) => {
        this.loading = false;

        console.error('Full chat error:', error);
        console.error('Backend response:', error.error);

        this.messages.push({
          role: 'ai',
          text:
            error.error?.sqlMessage ||
            error.error?.message ||
            error.error?.error ||
            'Something went wrong.'
        });
      }
    });
  }

  private openTeacherChat(
    teacherId: number,
    studentId: number
  ): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(
        [
          '/parent/teacher-chat',
          teacherId,
          studentId
        ],
        {
          queryParams: {
            email: this.loginEmail
          }
        }
      )
    );

    console.log('Opening teacher chat URL:', url);

    window.open(url, '_blank');
  }
}