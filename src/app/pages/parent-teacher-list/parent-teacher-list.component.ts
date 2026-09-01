import { Component, OnInit } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse
} from '@angular/common/http';
import {
  ActivatedRoute,
  Router
} from '@angular/router';

interface ParentTeacher {
  user_id: number;
  teacher_id: number;

  teacher_name: string;
  teacher_email: string | null;
  school_id: number;

  student_id: number;
  student_name: string;
  student_class_name?: string;

  teacher_type?: string;
  subject?: string | null;

  profile_image?: string | null;
  last_message?: string | null;
  last_message_time?: string | null;
  unread_count?: number;
}

@Component({
  selector: 'app-parent-teacher-list',
  templateUrl: './parent-teacher-list.component.html',
  styleUrls: ['./parent-teacher-list.component.css']
})
export class ParentTeacherListComponent implements OnInit {
  readonly apiUrl = '/api';

  parentEmail = '';

  teachers: ParentTeacher[] = [];
  filteredTeachers: ParentTeacher[] = [];

  searchText = '';

  loading = true;
  errorMessage = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.parentEmail =
        (params.get('email') || '').trim();

      console.log(
        'Parent teacher list email:',
        this.parentEmail
      );

      if (!this.parentEmail) {
        this.loading = false;
        this.errorMessage =
          'Parent email was not provided.';

        return;
      }

      this.loadTeachers();
    });
  }

  loadTeachers(): void {
    this.loading = true;
    this.errorMessage = '';

    this.http.get<ParentTeacher[]>(
      `${this.apiUrl}/parent-school-teachers`,
      {
        params: {
          email: this.parentEmail
        }
      }
    ).subscribe({
      next: response => {
        this.loading = false;

        this.teachers = Array.isArray(response)
          ? response
          : [];

        this.filteredTeachers = [
          ...this.teachers
        ];

        console.log(
          'Teachers loaded:',
          this.teachers
        );
      },

      error: (error: HttpErrorResponse) => {
        this.loading = false;

        console.error(
          'Load teachers error:',
          error
        );

        console.error(
          'Backend response:',
          error.error
        );

        this.errorMessage =
          error.error?.message ||
          error.error?.error ||
          'Unable to load teachers.';
      }
    });
  }

  filterTeachers(): void {
    const value = this.searchText
      .trim()
      .toLowerCase();

    if (!value) {
      this.filteredTeachers = [
        ...this.teachers
      ];

      return;
    }

    this.filteredTeachers =
      this.teachers.filter(teacher => {
        const teacherName =
          teacher.teacher_name || '';

        const subject =
          teacher.subject || '';

        const teacherType =
          teacher.teacher_type || '';

        const studentName =
          teacher.student_name || '';

        return (
          teacherName
            .toLowerCase()
            .includes(value) ||
          subject
            .toLowerCase()
            .includes(value) ||
          teacherType
            .toLowerCase()
            .includes(value) ||
          studentName
            .toLowerCase()
            .includes(value)
        );
      });
  }

  openTeacherChat(
  teacher: ParentTeacher
): void {
  if (
    !teacher.user_id ||
    !teacher.student_id
  ) {
    return;
  }

  this.router.navigate(
    [
      '/parent/teacher-chat',
      teacher.user_id,
      teacher.student_id
    ],
    {
      queryParams: {
        email: this.parentEmail
      }
    }
  );
}

  goBack(): void {
    this.router.navigate(
      ['/chat'],
      {
        queryParams: {
          email: this.parentEmail
        }
      }
    );
  }

  retry(): void {
    this.loadTeachers();
  }

  getTeacherInitial(
    teacherName: string
  ): string {
    if (!teacherName) {
      return 'T';
    }

    const names = teacherName
      .trim()
      .split(/\s+/);

    if (names.length === 1) {
      return names[0]
        .charAt(0)
        .toUpperCase();
    }

    return (
      names[0].charAt(0) +
      names[names.length - 1].charAt(0)
    ).toUpperCase();
  }

  getTeacherRole(
  teacher: ParentTeacher
): string {
  if (teacher.subject) {
    return teacher.subject + ' Teacher';
  }

  return 'Teacher';
}

  getLastMessage(
    teacher: ParentTeacher
  ): string {
    if (teacher.last_message) {
      return teacher.last_message;
    }

    return 'Tap to start a conversation';
  }

  getUnreadCount(
    teacher: ParentTeacher
  ): number {
    return teacher.unread_count || 0;
  }

  trackByTeacher(
    index: number,
    teacher: ParentTeacher
  ): string {
    return (
      teacher.user_id +
      '-' +
      teacher.student_id
    );
  }
}