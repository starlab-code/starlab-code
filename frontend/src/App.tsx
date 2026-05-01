import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "v0.1.0";
const PREVIEW_TOKEN = "__starlab_ui_preview__";

type UserRole = "teacher" | "student";
type Difficulty = "beginner" | "basic" | "intermediate";
type AssignmentType = "homework" | "classroom";
type HealthState = "checking" | "ok" | "down";
type AppTheme = "light" | "dark";
type View =
  | "home"
  | "problems"
  | "solve"
  | "assignments"
  | "submissions"
  | "live"
  | "manage"
  | "accounts";

type UserProfile = {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  primary_teacher_id: number | null;
  created_by_teacher_id: number | null;
  is_primary_teacher: boolean;
  class_name: string | null;
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: UserProfile;
};

type Category = {
  id: number;
  name: string;
  description: string;
};

type ClassroomOption = {
  name: string;
  student_count: number;
};

type TestCase = {
  id?: number;
  input_data: string;
  expected_output: string;
  is_public: boolean;
  note: string;
};

type ProblemCard = {
  id: number;
  title: string;
  short_description: string;
  category_id: number;
  category_name: string;
  difficulty: Difficulty;
  time_limit_seconds: number;
  supported_languages: string[];
};

type ProblemDetail = ProblemCard & {
  statement: string;
  input_description: string;
  output_description: string;
  constraints: string;
  sample_input: string;
  sample_output: string;
  starter_code_python: string;
  memory_limit_mb: number;
  public_testcases: TestCase[];
  all_testcases?: TestCase[] | null;
};

type Assignment = {
  id: number;
  title: string;
  problem_id: number;
  problem_title: string;
  category_name: string;
  student_id: number;
  student_name: string;
  teacher_name: string;
  assignment_type: AssignmentType;
  due_at: string | null;
  classroom_label: string | null;
  submitted: boolean;
};

type Submission = {
  id: number;
  problem_id: number;
  user_id: number;
  assignment_id: number | null;
  language: string;
  code: string;
  status: string;
  passed_tests: number;
  total_tests: number;
  runtime_ms: number;
  created_at: string;
};

type SubmissionFeedItem = {
  id: number;
  student_id: number;
  student_name: string;
  student_username: string;
  class_name: string | null;
  problem_id: number;
  problem_title: string;
  category_name: string;
  assignment_id: number | null;
  assignment_title: string | null;
  language: string;
  status: string;
  passed_tests: number;
  total_tests: number;
  runtime_ms: number;
  created_at: string;
};

type ExecutionResult = {
  index: number;
  status: string;
  stdout: string;
  stderr: string;
  expected: string;
  actual: string;
  runtime_ms: number;
};

type ExecutionResponse = {
  status: string;
  passed_tests: number;
  total_tests: number;
  results: ExecutionResult[];
};

type StreamState = {
  kind: "run" | "submit";
  total: number;
  completed: number;
  results: ExecutionResult[];
  done: boolean;
  summary: { status: string; passed_tests: number; total_tests: number; runtime_ms: number } | null;
};

type DashboardSummary = {
  assigned_count: number;
  completed_count: number;
  total_problems: number;
  categories: Category[];
};

type LeaderboardEntry = {
  rank: number;
  student_id: number;
  student_name: string;
  class_name: string | null;
  score: number;
  solved: number;
  attempts: number;
  accuracy: number;
  beginner_solved: number;
  basic_solved: number;
  intermediate_solved: number;
};

type ProblemEditorForm = {
  title: string;
  short_description: string;
  statement: string;
  input_description: string;
  output_description: string;
  constraints: string;
  category_id: number;
  difficulty: Difficulty;
  starter_code_python: string;
  sample_input: string;
  sample_output: string;
  time_limit_seconds: number;
  memory_limit_mb: number;
  testcases: TestCase[];
};

type AssignmentDraft = {
  title: string;
  assignment_type: AssignmentType;
  class_name: string;
  problem_id: number | null;
  due_at: string;
  classroom_label: string;
};

type ConfirmDialogConfig = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void | Promise<void>;
};

type StudentMoveDraft = {
  teacher_id: number;
  class_name: string;
};

type AssignmentGroup = {
  group_key: string;
  title: string;
  problem_id: number;
  problem_title: string;
  category_name: string;
  class_name: string;
  classroom_label: string | null;
  assignment_type: AssignmentType;
  due_at: string | null;
  created_at: string;
  total_students: number;
  completed_students: number;
  completion_rate: number;
  assignment_ids: number[];
};

type AssignmentGroupStudent = {
  assignment_id: number;
  student_id: number;
  student_name: string;
  student_username: string;
  class_name: string | null;
  submitted: boolean;
  best_status: string | null;
  best_passed: number;
  best_total: number;
  best_runtime_ms: number;
  attempts: number;
  last_submitted_at: string | null;
};

type RegisterDraft = {
  username: string;
  display_name: string;
  password: string;
  class_name: string;
};

type TeacherAccountDraft = {
  username: string;
  display_name: string;
  password: string;
};

type StudentAccountDraft = {
  username: string;
  display_name: string;
  password: string;
  class_name: string;
};

const emptyTestcase = (): TestCase => ({
  input_data: "",
  expected_output: "",
  is_public: true,
  note: "",
});

const emptyProblemForm = (categoryId = 0): ProblemEditorForm => ({
  title: "",
  short_description: "",
  statement: "",
  input_description: "",
  output_description: "",
  constraints: "",
  category_id: categoryId,
  difficulty: "beginner",
  starter_code_python: "import sys\ninput = sys.stdin.readline\n\n",
  sample_input: "",
  sample_output: "",
  time_limit_seconds: 2,
  memory_limit_mb: 128,
  testcases: [emptyTestcase()],
});

const emptyAssignmentDraft = (): AssignmentDraft => ({
  title: "",
  assignment_type: "homework",
  class_name: "",
  problem_id: null,
  due_at: "",
  classroom_label: "",
});

const emptyTeacherAccountDraft = (): TeacherAccountDraft => ({
  username: "",
  display_name: "",
  password: "",
});

const emptyStudentAccountDraft = (): StudentAccountDraft => ({
  username: "",
  display_name: "",
  password: "",
  class_name: "",
});

type PreviewData = {
  user: UserProfile;
  categories: Category[];
  classrooms: ClassroomOption[];
  teachers: UserProfile[];
  students: UserProfile[];
  problems: ProblemDetail[];
  assignments: Assignment[];
  assignmentGroups: AssignmentGroup[];
  groupDetail: AssignmentGroupStudent[];
  submissions: Submission[];
  feed: SubmissionFeedItem[];
  dashboard: DashboardSummary;
};

const previewCategories: Category[] = [
  { id: 1, name: "구현", description: "입출력과 조건 처리를 연습합니다." },
  { id: 2, name: "자료구조", description: "스택, 큐, 해시를 다룹니다." },
  { id: 3, name: "탐색", description: "완전탐색, BFS, DFS를 연습합니다." },
];

function previewDate(days: number, hours = 0) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString();
}

function previewTestcases(): TestCase[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    input_data: index < 2 ? `${index + 2} ${index + 4}` : `${index + 1}\n${index + 2}`,
    expected_output: index < 2 ? String(index + 6) : String(index + 3),
    is_public: index < 3,
    note: index < 3 ? "공개 예제" : "숨김 채점",
  }));
}

const previewProblems: ProblemDetail[] = [
  {
    id: 101,
    title: "두 수 더하기",
    short_description: "입력된 두 정수를 더해 출력합니다.",
    category_id: 1,
    category_name: "구현",
    difficulty: "beginner",
    time_limit_seconds: 2,
    supported_languages: ["python"],
    statement: "공백으로 구분된 두 정수 A와 B가 주어집니다. 두 수의 합을 출력하세요.",
    input_description: "첫째 줄에 정수 A와 B가 공백으로 주어집니다.",
    output_description: "A+B를 출력합니다.",
    constraints: "1 <= A, B <= 1,000",
    sample_input: "3 4",
    sample_output: "7",
    starter_code_python: "import sys\ninput = sys.stdin.readline\n\na, b = map(int, input().split())\nprint(a + b)\n",
    memory_limit_mb: 128,
    public_testcases: previewTestcases().slice(0, 3),
    all_testcases: previewTestcases(),
  },
  {
    id: 102,
    title: "괄호 균형 검사",
    short_description: "스택으로 올바른 괄호 문자열을 판별합니다.",
    category_id: 2,
    category_name: "자료구조",
    difficulty: "basic",
    time_limit_seconds: 2,
    supported_languages: ["python"],
    statement: "괄호 문자열이 올바른 순서로 닫히는지 확인하세요. 올바르면 YES, 아니면 NO를 출력합니다.",
    input_description: "첫째 줄에 괄호 문자열 S가 주어집니다.",
    output_description: "올바른 괄호 문자열이면 YES, 아니면 NO를 출력합니다.",
    constraints: "1 <= |S| <= 100,000",
    sample_input: "(()())",
    sample_output: "YES",
    starter_code_python: "s = input().strip()\nstack = []\n\nfor ch in s:\n    if ch == '(':\n        stack.append(ch)\n    else:\n        if not stack:\n            print('NO')\n            break\n        stack.pop()\nelse:\n    print('YES' if not stack else 'NO')\n",
    memory_limit_mb: 128,
    public_testcases: previewTestcases().slice(0, 3),
    all_testcases: previewTestcases(),
  },
  {
    id: 103,
    title: "미로 최단거리",
    short_description: "BFS로 시작점에서 도착점까지의 거리를 구합니다.",
    category_id: 3,
    category_name: "탐색",
    difficulty: "intermediate",
    time_limit_seconds: 3,
    supported_languages: ["python"],
    statement: "N x M 미로에서 1은 이동 가능, 0은 벽입니다. 좌상단에서 우하단까지의 최단거리를 구하세요.",
    input_description: "첫째 줄에 N, M이 주어지고 이어서 N개의 줄에 미로가 주어집니다.",
    output_description: "도착할 수 있으면 최단거리, 없으면 -1을 출력합니다.",
    constraints: "2 <= N, M <= 100",
    sample_input: "4 4\n1111\n0011\n1110\n0011",
    sample_output: "7",
    starter_code_python: "from collections import deque\nimport sys\ninput = sys.stdin.readline\n\n# BFS 풀이를 작성해 보세요.\n",
    memory_limit_mb: 256,
    public_testcases: previewTestcases().slice(0, 3),
    all_testcases: previewTestcases(),
  },
];

function asProblemCard(problem: ProblemDetail): ProblemCard {
  return {
    id: problem.id,
    title: problem.title,
    short_description: problem.short_description,
    category_id: problem.category_id,
    category_name: problem.category_name,
    difficulty: problem.difficulty,
    time_limit_seconds: problem.time_limit_seconds,
    supported_languages: problem.supported_languages,
  };
}

function makePreviewData(role: UserRole): PreviewData {
  const teacher: UserProfile = {
    id: 1,
    username: "preview_teacher",
    display_name: "김별 선생님",
    role: "teacher",
    primary_teacher_id: 1,
    created_by_teacher_id: null,
    is_primary_teacher: true,
    class_name: null,
  };
  const student: UserProfile = {
    id: 101,
    username: "preview_student",
    display_name: "이하늘",
    role: "student",
    primary_teacher_id: 1,
    created_by_teacher_id: 1,
    is_primary_teacher: false,
    class_name: "금요 2반",
  };
  const students: UserProfile[] = [
    student,
    { ...student, id: 102, username: "student_jun", display_name: "박준", class_name: "금요 2반" },
    { ...student, id: 103, username: "student_mina", display_name: "정미나", class_name: "토요 1반" },
  ];
  const assignments: Assignment[] = [
    {
      id: 301,
      title: "스택 기본 과제",
      problem_id: 102,
      problem_title: "괄호 균형 검사",
      category_name: "자료구조",
      student_id: role === "student" ? 101 : 101,
      student_name: "이하늘",
      teacher_name: "김별 선생님",
      assignment_type: "homework",
      due_at: previewDate(2),
      classroom_label: "금요 2반",
      submitted: role === "student" ? false : true,
    },
    {
      id: 302,
      title: "BFS 맛보기",
      problem_id: 103,
      problem_title: "미로 최단거리",
      category_name: "탐색",
      student_id: role === "student" ? 101 : 102,
      student_name: role === "student" ? "이하늘" : "박준",
      teacher_name: "김별 선생님",
      assignment_type: "classroom",
      due_at: previewDate(5),
      classroom_label: "금요 2반",
      submitted: false,
    },
  ];
  const submissions: Submission[] =
    role === "student"
      ? [
          {
            id: 401,
            problem_id: 101,
            user_id: 101,
            assignment_id: null,
            language: "python",
            code: previewProblems[0].starter_code_python,
            status: "accepted",
            passed_tests: 10,
            total_tests: 10,
            runtime_ms: 34,
            created_at: previewDate(-1),
          },
          {
            id: 402,
            problem_id: 102,
            user_id: 101,
            assignment_id: 301,
            language: "python",
            code: "s = input().strip()\nprint('YES')\n",
            status: "wrong_answer",
            passed_tests: 6,
            total_tests: 10,
            runtime_ms: 28,
            created_at: previewDate(-0.2),
          },
        ]
      : [
          {
            id: 501,
            problem_id: 101,
            user_id: 101,
            assignment_id: null,
            language: "python",
            code: previewProblems[0].starter_code_python,
            status: "accepted",
            passed_tests: 10,
            total_tests: 10,
            runtime_ms: 34,
            created_at: previewDate(-1),
          },
          {
            id: 502,
            problem_id: 102,
            user_id: 102,
            assignment_id: 301,
            language: "python",
            code: "print('YES')",
            status: "wrong_answer",
            passed_tests: 6,
            total_tests: 10,
            runtime_ms: 28,
            created_at: previewDate(-0.12),
          },
          {
            id: 503,
            problem_id: 103,
            user_id: 103,
            assignment_id: 302,
            language: "python",
            code: "# bfs",
            status: "runtime_error",
            passed_tests: 2,
            total_tests: 10,
            runtime_ms: 41,
            created_at: previewDate(-0.04),
          },
        ];

  const feed: SubmissionFeedItem[] = submissions.map((submission, index) => {
    const owner = students.find((item) => item.id === submission.user_id) ?? student;
    const problem = previewProblems.find((item) => item.id === submission.problem_id) ?? previewProblems[0];
    return {
      id: 700 + index,
      student_id: owner.id,
      student_name: owner.display_name,
      student_username: owner.username,
      class_name: owner.class_name,
      problem_id: problem.id,
      problem_title: problem.title,
      category_name: problem.category_name,
      assignment_id: submission.assignment_id,
      assignment_title: assignments.find((item) => item.id === submission.assignment_id)?.title ?? null,
      language: "python",
      status: submission.status,
      passed_tests: submission.passed_tests,
      total_tests: submission.total_tests,
      runtime_ms: submission.runtime_ms,
      created_at: submission.created_at,
    };
  });

  const assignmentGroups: AssignmentGroup[] = [
    {
      group_key: "preview-stack",
      title: "스택 기본 과제",
      problem_id: 102,
      problem_title: "괄호 균형 검사",
      category_name: "자료구조",
      class_name: "금요 2반",
      classroom_label: "금요 2반",
      assignment_type: "homework",
      due_at: previewDate(2),
      created_at: previewDate(-3),
      total_students: 2,
      completed_students: 1,
      completion_rate: 50,
      assignment_ids: [301],
    },
  ];

  const groupDetail: AssignmentGroupStudent[] = [
    {
      assignment_id: 301,
      student_id: 101,
      student_name: "이하늘",
      student_username: "preview_student",
      class_name: "금요 2반",
      submitted: true,
      best_status: "accepted",
      best_passed: 10,
      best_total: 10,
      best_runtime_ms: 34,
      attempts: 2,
      last_submitted_at: previewDate(-0.5),
    },
    {
      assignment_id: 302,
      student_id: 102,
      student_name: "박준",
      student_username: "student_jun",
      class_name: "금요 2반",
      submitted: true,
      best_status: "wrong_answer",
      best_passed: 6,
      best_total: 10,
      best_runtime_ms: 28,
      attempts: 1,
      last_submitted_at: previewDate(-0.12),
    },
  ];

  return {
    user: role === "teacher" ? teacher : student,
    categories: previewCategories,
    classrooms: [
      { name: "금요 2반", student_count: 2 },
      { name: "토요 1반", student_count: 1 },
    ],
    teachers: [teacher, { ...teacher, id: 2, username: "teacher_sub", display_name: "오로라 선생님", is_primary_teacher: false }],
    students,
    problems: previewProblems,
    assignments,
    assignmentGroups,
    groupDetail,
    submissions,
    feed,
    dashboard: {
      assigned_count: assignments.length,
      completed_count: role === "student" ? 1 : 3,
      total_problems: previewProblems.length,
      categories: previewCategories,
    },
  };
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error(data?.detail ?? "요청 처리 중 오류가 발생했습니다.");
  }
  return data as T;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: "맞았습니다",
  wrong_answer: "틀렸습니다",
  runtime_error: "런타임 에러",
  compile_error: "컴파일 에러",
  time_limit: "시간 초과",
  unsupported_language: "미지원 언어",
  passed: "통과",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function statusTone(status: string): "ok" | "bad" | "warn" | "neutral" {
  if (status === "accepted" || status === "passed") return "ok";
  if (status === "wrong_answer") return "bad";
  if (status === "runtime_error" || status === "time_limit" || status === "compile_error") return "warn";
  return "neutral";
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "입문",
  basic: "기초",
  intermediate: "응용",
};

function difficultyLabel(level: Difficulty) {
  return DIFFICULTY_LABELS[level];
}

function formatDate(value: string | null) {
  if (!value) return "기한 없음";
  const date = new Date(value);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// Server datetimes are UTC-naive (no Z suffix); append Z to force UTC interpretation.
function toUTC(iso: string): string {
  return iso.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "Z";
}

function timeAgo(iso: string) {
  const t = new Date(toUTC(iso)).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function formatHeaderClock(date: Date) {
  const dateText = date.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timeText = date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { dateText, timeText };
}

function formatStudyDuration(startedAt: number, now: Date) {
  const diff = Math.max(0, now.getTime() - startedAt);
  const totalMinutes = Math.floor(diff / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  return `${hours}시간 ${minutes}분`;
}

function readEditorWindowState() {
  if (typeof window === "undefined") {
    return { enabled: false, problemId: null as number | null };
  }
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("mode") === "editor";
  const rawProblemId = Number(params.get("problem"));
  return {
    enabled,
    problemId: Number.isFinite(rawProblemId) && rawProblemId > 0 ? rawProblemId : null,
  };
}

const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const PYTHON_BUILTINS = new Set([
  "abs",
  "all",
  "any",
  "dict",
  "enumerate",
  "float",
  "input",
  "int",
  "len",
  "list",
  "map",
  "max",
  "min",
  "print",
  "range",
  "reversed",
  "set",
  "sorted",
  "str",
  "sum",
  "tuple",
  "zip",
]);

const C_KEYWORDS = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if",
  "inline", "int", "long", "register", "return", "short", "signed",
  "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned",
  "void", "volatile", "while",
]);

const C_BUILTINS = new Set([
  "printf", "scanf", "sprintf", "sscanf", "fprintf", "fscanf",
  "malloc", "calloc", "realloc", "free",
  "strlen", "strcpy", "strncpy", "strcat", "strncat", "strcmp", "strncmp",
  "memcpy", "memset", "memmove",
  "fopen", "fclose", "fread", "fwrite",
  "abs", "atoi", "atof", "atol", "exit",
  "NULL", "EOF", "stdin", "stdout", "stderr",
]);

type HighlightToken = {
  text: string;
  tone: "text" | "comment" | "string" | "number" | "keyword" | "builtin" | "function";
};

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
}

function highlightPythonLine(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === "#") {
      tokens.push({ text: line.slice(index), tone: "comment" });
      break;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\" && end + 1 < line.length) {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push({ text: line.slice(index, end), tone: "string" });
      index = end;
      continue;
    }

    if (/\d/.test(char)) {
      let end = index + 1;
      while (end < line.length && /[\d_]/.test(line[end])) end += 1;
      if (line[end] === ".") {
        end += 1;
        while (end < line.length && /[\d_]/.test(line[end])) end += 1;
      }
      tokens.push({ text: line.slice(index, end), tone: "number" });
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) end += 1;
      const word = line.slice(index, end);
      let tone: HighlightToken["tone"] = "text";

      if (PYTHON_KEYWORDS.has(word)) {
        tone = "keyword";
      } else if (PYTHON_BUILTINS.has(word)) {
        tone = "builtin";
      } else {
        let probe = end;
        while (probe < line.length && /\s/.test(line[probe])) probe += 1;
        if (line[probe] === "(") tone = "function";
      }

      tokens.push({ text: word, tone });
      index = end;
      continue;
    }

    tokens.push({ text: char, tone: "text" });
    index += 1;
  }

  return tokens;
}

function highlightCLine(line: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === "#") {
      tokens.push({ text: line.slice(index), tone: "keyword" });
      break;
    }

    if (char === "/" && line[index + 1] === "/") {
      tokens.push({ text: line.slice(index), tone: "comment" });
      break;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\" && end + 1 < line.length) { end += 2; continue; }
        if (line[end] === quote) { end += 1; break; }
        end += 1;
      }
      tokens.push({ text: line.slice(index, end), tone: "string" });
      index = end;
      continue;
    }

    if (/\d/.test(char)) {
      let end = index + 1;
      while (end < line.length && /[\d_.xXa-fA-FuUlL]/.test(line[end])) end += 1;
      tokens.push({ text: line.slice(index, end), tone: "number" });
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) end += 1;
      const word = line.slice(index, end);
      let tone: HighlightToken["tone"] = "text";
      if (C_KEYWORDS.has(word)) {
        tone = "keyword";
      } else if (C_BUILTINS.has(word)) {
        tone = "builtin";
      } else {
        let probe = end;
        while (probe < line.length && /\s/.test(line[probe])) probe += 1;
        if (line[probe] === "(") tone = "function";
      }
      tokens.push({ text: word, tone });
      index = end;
      continue;
    }

    tokens.push({ text: char, tone: "text" });
    index += 1;
  }

  return tokens;
}

function renderHighlightedCode(code: string, language: "python" | "c" = "python") {
  const highlighter = language === "c" ? highlightCLine : highlightPythonLine;
  const lines = code.split("\n");
  return lines.map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {highlighter(line).map((token, tokenIndex) =>
        token.tone === "text" ? (
          <Fragment key={tokenIndex}>{token.text}</Fragment>
        ) : (
          <span key={tokenIndex} className={`tok tok-${token.tone}`}>
            {token.text}
          </span>
        ),
      )}
      {lineIndex < lines.length - 1 ? "\n" : line.length === 0 ? " " : null}
    </Fragment>
  ));
}

function DifficultyBadge({ level }: { level: Difficulty }) {
  return <span className={`tier tier-${level}`}>{difficultyLabel(level)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return <span className={`verdict verdict-${tone}`}>{statusLabel(status)}</span>;
}

function ThemeToggleIcon({ targetTheme }: { targetTheme: AppTheme }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (targetTheme === "dark") {
    return (
      <svg {...common} className="theme-toggle-icon">
        <path d="M20.5 14.2A7.7 7.7 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z" />
      </svg>
    );
  }

  return (
    <svg {...common} className="theme-toggle-icon">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2" />
      <path d="M12 19.2v2" />
      <path d="m4.5 4.5 1.4 1.4" />
      <path d="m18.1 18.1 1.4 1.4" />
      <path d="M2.8 12h2" />
      <path d="M19.2 12h2" />
      <path d="m4.5 19.5 1.4-1.4" />
      <path d="m18.1 5.9 1.4-1.4" />
    </svg>
  );
}

function ProfileRoleIcon({ role }: { role: UserRole }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (role === "teacher") {
    return (
      <svg {...common} className="profile-avatar-icon profile-avatar-icon-teacher">
        <rect x="12.1" y="4.3" width="8.2" height="8.2" rx="0.8" />
        <circle className="profile-avatar-icon-fill" cx="6.4" cy="5.9" r="2.4" />
        <path className="profile-avatar-icon-fill" d="M3.8 18.7v-7.9c0-1.4 1.1-2.5 2.5-2.5h0.2c1.4 0 2.5 1.1 2.5 2.5v7.9H7.4v-5.5h-2v5.5H3.8Z" />
        <path d="M8.4 10.6 11 12l3.6-2.4" />
      </svg>
    );
  }

  return (
    <svg {...common} className="profile-avatar-icon">
      <path d="M12 4 4 8l8 4 8-4-8-4Z" />
      <path d="M6.8 10.2v4.2c1.6 1.5 3.3 2.2 5.2 2.2s3.6-.7 5.2-2.2v-4.2" />
      <path d="M20 8v5" />
    </svg>
  );
}

function SideNavIcon({ view }: { view: View }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (view) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.8 12 3l9 7.8" />
          <path d="M5.5 10v10h13V10" />
          <path d="M9.5 20v-6h5v6" />
        </svg>
      );
    case "problems":
      return (
        <svg {...common}>
          <path d="M8 4h8l4 4v12H4V4h4z" />
          <path d="M15 4v5h5" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      );
    case "assignments":
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M9 8h6" />
          <path d="m9 13 1.5 1.5L15 10" />
          <path d="M9 18h6" />
        </svg>
      );
    case "submissions":
      return (
        <svg {...common}>
          <path d="M4 17.5V20h16v-2.5" />
          <path d="M12 4v11" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        </svg>
      );
    case "live":
      return (
        <svg {...common}>
          <path d="M4 12h4l2-6 4 12 2-6h4" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "manage":
      return (
        <svg {...common}>
          <path d="M12 3v3" />
          <path d="M12 18v3" />
          <path d="M4.8 7.2 7 9.4" />
          <path d="M17 14.6l2.2 2.2" />
          <circle cx="12" cy="12" r="4" />
          <path d="M3 12h3" />
          <path d="M18 12h3" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.8-3.2 2.8-5 5.5-5s4.7 1.8 5.5 5" />
          <path d="M16 7.5a2.5 2.5 0 1 1 .5 5" />
          <path d="M17 14.5c1.8.5 3 1.9 3.5 4.5" />
        </svg>
      );
    case "solve":
      return (
        <svg {...common}>
          <path d="m8 9-4 3 4 3" />
          <path d="m16 9 4 3-4 3" />
          <path d="m14 5-4 14" />
        </svg>
      );
    default:
      return null;
  }
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark starlab-logo ${className}`} aria-hidden="true">
      <img src="/starlab-logo.png" alt="" />
      <span className="logo-fallback">
        <span className="logo-red">ST</span>
        <span className="logo-star">A</span>
        <span className="logo-red">R</span>
        <span className="logo-gray">LAB</span>
      </span>
    </span>
  );
}

let _monoCharWidth: number | null = null;

function monoCharWidth(): number {
  if (_monoCharWidth !== null) return _monoCharWidth;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 7.5;
  ctx.font = '12.5px "JetBrains Mono", Consolas, monospace';
  _monoCharWidth = ctx.measureText("x").width;
  return _monoCharWidth;
}

const AC_LINE_H = 12.5 * 1.6;
const AC_PAD_T = 0.85 * 16;
const AC_PAD_L = 0.9 * 16;

type AcItem = { word: string; kind: "keyword" | "builtin" | "identifier" };

function buildAutocompletions(fragment: string, code: string, language: "python" | "c" = "python"): AcItem[] {
  if (fragment.length < 1) return [];
  const seen = new Set<string>();
  const result: AcItem[] = [];
  const keywords = language === "c" ? C_KEYWORDS : PYTHON_KEYWORDS;
  const builtins = language === "c" ? C_BUILTINS : PYTHON_BUILTINS;
  for (const word of keywords) {
    if (word.startsWith(fragment) && word !== fragment) {
      seen.add(word);
      result.push({ word, kind: "keyword" });
    }
  }
  for (const word of builtins) {
    if (word.startsWith(fragment) && word !== fragment) {
      seen.add(word);
      result.push({ word, kind: "builtin" });
    }
  }
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const w = m[0];
    if (w.startsWith(fragment) && w !== fragment && !seen.has(w) && !keywords.has(w) && !builtins.has(w)) {
      seen.add(w);
      result.push({ word: w, kind: "identifier" });
    }
  }
  return result.slice(0, 8);
}

function CodeEditor({
  value,
  onChange,
  language = "python",
}: {
  value: string;
  onChange: (next: string) => void;
  language?: "python" | "c";
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lines = value.split("\n");

  const [completions, setCompletions] = useState<AcItem[]>([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acPos, setAcPos] = useState<{ x: number; y: number } | null>(null);

  function syncScroll() {
    if (!gutterRef.current || !textareaRef.current || !highlightRef.current) return;
    gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }

  function calcDropdownPos(ta: HTMLTextAreaElement, code: string, pos: number) {
    const lns = code.slice(0, pos).split("\n");
    const lineIdx = lns.length - 1;
    const colIdx = lns[lineIdx].length;
    const rect = ta.getBoundingClientRect();
    const cw = monoCharWidth();
    return {
      x: rect.left + AC_PAD_L + colIdx * cw - ta.scrollLeft,
      y: rect.top + AC_PAD_T + lineIdx * AC_LINE_H - ta.scrollTop + AC_LINE_H + 4,
    };
  }

  function refreshCompletions() {
    const ta = textareaRef.current;
    if (!ta || ta.selectionStart !== ta.selectionEnd) { setCompletions([]); return; }
    const code = ta.value;
    const pos = ta.selectionStart;
    const lineStart = code.lastIndexOf("\n", pos - 1) + 1;
    if (code.slice(lineStart, pos).includes("#")) { setCompletions([]); return; }
    let start = pos;
    while (start > 0 && /[A-Za-z0-9_]/.test(code[start - 1])) start--;
    const fragment = code.slice(start, pos);
    const list = buildAutocompletions(fragment, code, language);
    setCompletions(list);
    setAcIndex(0);
    if (list.length > 0) setAcPos(calcDropdownPos(ta, code, pos));
  }

  function acceptCompletion(idx: number) {
    const ta = textareaRef.current;
    if (!ta) return;
    const code = ta.value;
    const pos = ta.selectionStart;
    let start = pos;
    while (start > 0 && /[A-Za-z0-9_]/.test(code[start - 1])) start--;
    onChange(code.slice(0, start) + completions[idx].word + code.slice(pos));
    setCompletions([]);
    const newPos = start + completions[idx].word.length;
    requestAnimationFrame(() => ta.setSelectionRange(newPos, newPos));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;

    if (completions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAcIndex(i => (i + 1) % completions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAcIndex(i => (i - 1 + completions.length) % completions.length); return; }
      if (e.key === "Escape") { setCompletions([]); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptCompletion(acIndex); return; }
    }

    const code = ta.value;
    const ss = ta.selectionStart;
    const se = ta.selectionEnd;

    if (e.key === "Tab") {
      e.preventDefault();
      onChange(code.slice(0, ss) + "    " + code.slice(se));
      requestAnimationFrame(() => ta.setSelectionRange(ss + 4, ss + 4));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = code.lastIndexOf("\n", ss - 1) + 1;
      const currentLine = code.slice(lineStart, ss);
      const indent = currentLine.match(/^(\s*)/)?.[1] ?? "";
      const extra = language === "c"
        ? /\{\s*$/.test(currentLine.trimEnd()) ? "    " : ""
        : /:\s*(#.*)?$/.test(currentLine.trimEnd()) ? "    " : "";
      const insert = "\n" + indent + extra;
      onChange(code.slice(0, ss) + insert + code.slice(se));
      requestAnimationFrame(() => ta.setSelectionRange(ss + insert.length, ss + insert.length));
      return;
    }

    if (e.key === "Backspace" && ss === se) {
      const lineStart = code.lastIndexOf("\n", ss - 1) + 1;
      const prefix = code.slice(lineStart, ss);
      if (prefix.length > 0 && /^ +$/.test(prefix)) {
        e.preventDefault();
        const remove = prefix.length % 4 === 0 ? 4 : prefix.length % 4;
        onChange(code.slice(0, ss - remove) + code.slice(ss));
        requestAnimationFrame(() => ta.setSelectionRange(ss - remove, ss - remove));
        return;
      }
    }

    if (e.key === "}" && language === "c" && ss === se) {
      const lineStart = code.lastIndexOf("\n", ss - 1) + 1;
      const prefix = code.slice(lineStart, ss);
      if (/^ +$/.test(prefix) && prefix.length >= 4) {
        e.preventDefault();
        const newPos = ss - 4;
        onChange(code.slice(0, newPos) + "}" + code.slice(se));
        requestAnimationFrame(() => ta.setSelectionRange(newPos + 1, newPos + 1));
        return;
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    requestAnimationFrame(refreshCompletions);
  }

  function handleScroll() {
    syncScroll();
    setCompletions([]);
  }

  return (
    <div className="editor-shell">
      <div className="editor-gutter" ref={gutterRef}>
        {lines.map((_, i) => <span key={i + 1}>{i + 1}</span>)}
      </div>
      <div className="editor-main">
        <pre className="editor-highlight" ref={highlightRef} aria-hidden="true">
          {renderHighlightedCode(value, language)}
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          spellCheck={false}
          value={value}
          wrap="off"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onBlur={() => setTimeout(() => setCompletions([]), 150)}
        />
      </div>
      {completions.length > 0 && acPos && createPortal(
        <ul className="editor-autocomplete" style={{ top: acPos.y, left: acPos.x }}>
          {completions.map((s, i) => (
            <li
              key={s.word}
              className={`ac-${s.kind}${i === acIndex ? " ac-active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); acceptCompletion(i); }}
            >
              {s.word}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

export default function App() {
  const editorWindowState = useMemo(() => readEditorWindowState(), []);
  const isEditorWindow = editorWindowState.enabled;
  const initialEditorProblemId = editorWindowState.problemId;
  const [token, setToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem("starlab-code-token"),
  );
  const isPreviewMode = token === PREVIEW_TOKEN;
  const [authBootstrapping, setAuthBootstrapping] = useState<boolean>(() =>
    typeof window === "undefined" ? false : Boolean(localStorage.getItem("starlab-code-token")),
  );
  const [user, setUser] = useState<UserProfile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [problems, setProblems] = useState<ProblemCard[]>([]);
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(initialEditorProblemId);
  const [selectedProblem, setSelectedProblem] = useState<ProblemDetail | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroup[]>([]);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<AssignmentGroupStudent[]>([]);
  const [groupDetailLoading, setGroupDetailLoading] = useState(false);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>(isEditorWindow ? "solve" : "home");
  const [viewHistory, setViewHistory] = useState<View[]>([]);
  const [problemFilter, setProblemFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | "all">("all");
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | "all">("all");
  const [solvePane, setSolvePane] = useState<"problem" | "history">("problem");
  const [loginRole, setLoginRole] = useState<UserRole>("teacher");
  const [loginDraft, setLoginDraft] = useState({ username: "", password: "" });
  const [registerDraft, setRegisterDraft] = useState<RegisterDraft>({
    username: "",
    display_name: "",
    password: "",
    class_name: "",
  });
  const [registerNewClassName, setRegisterNewClassName] = useState("");
  const [teacherCreateDraft, setTeacherCreateDraft] = useState<TeacherAccountDraft>(emptyTeacherAccountDraft());
  const [studentCreateDraft, setStudentCreateDraft] = useState<StudentAccountDraft>(emptyStudentAccountDraft());
  const [problemForm, setProblemForm] = useState<ProblemEditorForm>(emptyProblemForm());
  const [problemFormMode, setProblemFormMode] = useState<"create" | "edit">("create");
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>(emptyAssignmentDraft());
  const [editorLanguage, setEditorLanguage] = useState<"python" | "c">("python");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<SubmissionFeedItem[]>([]);
  const [feedHighlightId, setFeedHighlightId] = useState<number | null>(null);
  const [feedPaused, setFeedPaused] = useState(false);
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    typeof window === "undefined" ? false : localStorage.getItem("starlab-sidebar-collapsed") === "1",
  );
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("starlab-theme") === "dark" ? "dark" : "light";
  });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  const lastFeedIdRef = useRef<number>(0);
  const studyStartedAtRef = useRef<number>(Date.now());
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const serverClockOffsetRef = useRef<number>(0);

  const C_STARTER = "#include <stdio.h>\n\nint main()\n{\n    printf(\"Hello World!\\n\");\n    return 0;\n}";
  const selectedCode = selectedProblemId
    ? codeDrafts[`${selectedProblemId}-${editorLanguage}`]
      ?? (editorLanguage === "c" ? C_STARTER : selectedProblem?.starter_code_python ?? "")
    : "";

  const filteredProblems = useMemo(() => {
    return problems.filter((problem) => {
      const cat = categoryFilter === "all" || problem.category_id === categoryFilter;
      const diff = difficultyFilter === "all" || problem.difficulty === difficultyFilter;
      const q = problemFilter.trim().toLowerCase();
      const search =
        !q ||
        problem.title.toLowerCase().includes(q) ||
        problem.short_description.toLowerCase().includes(q) ||
        String(problem.id).includes(q);
      return cat && diff && search;
    });
  }, [problems, categoryFilter, difficultyFilter, problemFilter]);

  const currentProblemAssignments = assignments.filter((a) => a.problem_id === selectedProblemId);
  const myAssignments = user?.role === "student" ? assignments : [];
  const clockParts = formatHeaderClock(clockNow);
  const studyDuration = formatStudyDuration(studyStartedAtRef.current, clockNow);

  const studentStats = useMemo(() => {
    if (!user || user.role !== "student") return null;
    const accepted = submissions.filter((s) => s.status === "accepted");
    const solvedProblemIds = new Set(accepted.map((s) => s.problem_id));
    const totalAttempts = submissions.length;
    return {
      solved: solvedProblemIds.size,
      attempts: totalAttempts,
      accuracy: totalAttempts === 0 ? 0 : Math.round((accepted.length / totalAttempts) * 100),
    };
  }, [submissions, user]);

  const studentMetrics = useMemo(() => {
    if (!user || user.role !== "student") return null;

    const accepted = submissions.filter((s) => s.status === "accepted");
    const solvedProblemIds = new Set(accepted.map((s) => s.problem_id));

    const difficultyTotals: Record<Difficulty, { solved: number; total: number }> = {
      beginner: { solved: 0, total: 0 },
      basic: { solved: 0, total: 0 },
      intermediate: { solved: 0, total: 0 },
    };
    const categoryTotals = new Map<number, { name: string; solved: number; total: number }>();
    for (const p of problems) {
      difficultyTotals[p.difficulty].total += 1;
      if (solvedProblemIds.has(p.id)) difficultyTotals[p.difficulty].solved += 1;
      let entry = categoryTotals.get(p.category_id);
      if (!entry) {
        entry = { name: p.category_name, solved: 0, total: 0 };
        categoryTotals.set(p.category_id, entry);
      }
      entry.total += 1;
      if (solvedProblemIds.has(p.id)) entry.solved += 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const activity: { date: Date; submitted: number; accepted: number }[] = [];
    const indexByKey = new Map<string, number>();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      indexByKey.set(dayKey(day), activity.length);
      activity.push({ date: day, submitted: 0, accepted: 0 });
    }
    for (const s of submissions) {
      const d = new Date(toUTC(s.created_at));
      d.setHours(0, 0, 0, 0);
      const idx = indexByKey.get(dayKey(d));
      if (idx === undefined) continue;
      activity[idx].submitted += 1;
      if (s.status === "accepted") activity[idx].accepted += 1;
    }

    let streak = 0;
    for (let i = activity.length - 1; i >= 0; i -= 1) {
      if (activity[i].accepted > 0) {
        streak += 1;
      } else if (i === activity.length - 1) {
        // today empty: still count back-streak from yesterday
        continue;
      } else {
        break;
      }
    }

    const todayActivity = activity[activity.length - 1];
    const last7Solved = activity.slice(-7).reduce((sum, a) => sum + a.accepted, 0);
    const last30Solved = activity.reduce((sum, a) => sum + a.accepted, 0);
    const activeDays = activity.filter((a) => a.accepted > 0).length;

    const categoryRows = Array.from(categoryTotals.values())
      .filter((c) => c.total > 0)
      .sort((a, b) => b.solved / Math.max(b.total, 1) - a.solved / Math.max(a.total, 1) || b.total - a.total);

    return {
      activity,
      streak,
      todaySubmitted: todayActivity?.submitted ?? 0,
      todayAccepted: todayActivity?.accepted ?? 0,
      last7Solved,
      last30Solved,
      activeDays,
      difficultyTotals,
      categoryRows,
    };
  }, [submissions, problems, user]);

  const teacherMetrics = useMemo(() => {
    if (!user || user.role !== "teacher") return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    const activity: { date: Date; submitted: number; accepted: number }[] = [];
    const indexByKey = new Map<string, number>();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      indexByKey.set(dayKey(day), activity.length);
      activity.push({ date: day, submitted: 0, accepted: 0 });
    }
    for (const s of submissions) {
      const d = new Date(toUTC(s.created_at));
      d.setHours(0, 0, 0, 0);
      const idx = indexByKey.get(dayKey(d));
      if (idx === undefined) continue;
      activity[idx].submitted += 1;
      if (s.status === "accepted") activity[idx].accepted += 1;
    }

    const todayActivity = activity[activity.length - 1];
    const todayKey = dayKey(today);
    const todayStudents = new Set<number>();
    for (const s of submissions) {
      const d = new Date(toUTC(s.created_at));
      d.setHours(0, 0, 0, 0);
      if (dayKey(d) === todayKey) todayStudents.add(s.user_id);
    }
    const todayAccuracy =
      todayActivity.submitted === 0 ? 0 : Math.round((todayActivity.accepted / todayActivity.submitted) * 100);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    const studentWeek = new Map<number, { submitted: number; accepted: number; solved: Set<number> }>();
    for (const s of submissions) {
      if (new Date(toUTC(s.created_at)).getTime() < weekStart.getTime()) continue;
      let entry = studentWeek.get(s.user_id);
      if (!entry) {
        entry = { submitted: 0, accepted: 0, solved: new Set() };
        studentWeek.set(s.user_id, entry);
      }
      entry.submitted += 1;
      if (s.status === "accepted") {
        entry.accepted += 1;
        entry.solved.add(s.problem_id);
      }
    }
    const topStudents = Array.from(studentWeek.entries())
      .map(([id, stat]) => ({ id, submitted: stat.submitted, accepted: stat.accepted, solved: stat.solved.size }))
      .sort((a, b) => b.solved - a.solved || b.accepted - a.accepted)
      .slice(0, 5);

    const last7Accepted = activity.slice(-7).reduce((sum, a) => sum + a.accepted, 0);
    const last30Accepted = activity.reduce((sum, a) => sum + a.accepted, 0);
    const activeDays = activity.filter((a) => a.accepted > 0).length;

    return {
      todaySubmitted: todayActivity.submitted,
      todayAccepted: todayActivity.accepted,
      todayAccuracy,
      todayActiveStudents: todayStudents.size,
      last7Accepted,
      last30Accepted,
      activeDays,
      activity,
      topStudents,
    };
  }, [submissions, user]);

  async function loadPublicClassrooms() {
    setClassrooms([]);
  }

  function enterPreviewMode(role: UserRole) {
    const preview = makePreviewData(role);
    const firstProblem = preview.problems[0];
    localStorage.removeItem("starlab-code-token");
    setToken(PREVIEW_TOKEN);
    setUser(preview.user);
    setCategories(preview.categories);
    setClassrooms(preview.classrooms);
    setTeachers(preview.teachers);
    setStudents(preview.students);
    setProblems(preview.problems.map(asProblemCard));
    setAssignments(preview.assignments);
    setAssignmentGroups(preview.assignmentGroups);
    setGroupDetail([]);
    setActiveGroupKey(null);
    setSubmissions(preview.submissions);
    setFeed(preview.feed);
    setDashboard(preview.dashboard);
    setLeaderboard([]);
    setSelectedProblemId(firstProblem.id);
    setSelectedProblem(firstProblem);
    setCodeDrafts(
      Object.fromEntries(preview.problems.map((problem) => [problem.id, problem.starter_code_python])),
    );
    setProblemForm(emptyProblemForm(preview.categories[0]?.id ?? 0));
    setAssignmentDraft(emptyAssignmentDraft());
    setStream(null);
    setHealthState("ok");
    setViewHistory([]);
    setView("home");
    setProfileMenuOpen(false);
    setError(null);
    setMessage(`${role === "teacher" ? "선생님" : "학생"} UI 미리보기입니다. 저장 없이 화면만 확인할 수 있어요.`);
  }

  async function loadAppData(
    nextToken: string,
    knownUser?: UserProfile,
    options: { preserveSessionOnError?: boolean } = {},
  ) {
    setIsLoading(true);
    setError(null);
    try {
      const profile = knownUser ?? (await request<UserProfile>("/auth/me", {}, nextToken));
      const calls: Promise<unknown>[] = [
        request<DashboardSummary>("/dashboard", {}, nextToken),
        request<Category[]>("/categories", {}, nextToken),
        request<ProblemCard[]>("/problems", {}, nextToken),
        request<Assignment[]>("/assignments", {}, nextToken),
        request<Submission[]>("/submissions", {}, nextToken),
      ];
      if (profile.role === "teacher") {
        calls.push(request<UserProfile[]>("/teachers", {}, nextToken));
        calls.push(request<UserProfile[]>("/students", {}, nextToken));
        calls.push(request<SubmissionFeedItem[]>("/submissions/feed?limit=60", {}, nextToken));
        calls.push(request<AssignmentGroup[]>("/assignments/groups", {}, nextToken));
      }
      const leaderboardCallIndex = calls.length;
      calls.push(request<LeaderboardEntry[]>("/leaderboard", {}, nextToken));

      const results = await Promise.all(calls);
      const [
        dashboardResult,
        categoriesResult,
        problemsResult,
        assignmentsResult,
        submissionsResult,
        teachersResult,
        studentsResult,
        feedResult,
        groupsResult,
      ] = results as [
        DashboardSummary,
        Category[],
        ProblemCard[],
        Assignment[],
        Submission[],
        UserProfile[] | undefined,
        UserProfile[] | undefined,
        SubmissionFeedItem[] | undefined,
        AssignmentGroup[] | undefined,
      ];
      const leaderboardResult = results[leaderboardCallIndex] as LeaderboardEntry[] | undefined;

      setToken(nextToken);
      setUser(profile);
      setDashboard(dashboardResult);
      setCategories(categoriesResult);
      setProblems(problemsResult);
      setAssignments(assignmentsResult);
      setSubmissions(submissionsResult);
      setTeachers(teachersResult ?? []);
      setStudents(studentsResult ?? []);
      setAssignmentGroups(groupsResult ?? []);
      setLeaderboard(leaderboardResult ?? []);
      if (isEditorWindow) {
        setView("solve");
      }
      if (feedResult) {
        setFeed(feedResult);
        lastFeedIdRef.current = feedResult.reduce((max, f) => (f.id > max ? f.id : max), 0);
      }

      if (selectedProblemId === null) {
        const fallback = initialEditorProblemId ?? assignmentsResult[0]?.problem_id ?? problemsResult[0]?.id ?? null;
        if (fallback) setSelectedProblemId(fallback);
      }

      const defaultCategory = categoriesResult[0]?.id ?? 0;
      setProblemForm((current) =>
        current.category_id === 0 && defaultCategory !== 0 ? { ...current, category_id: defaultCategory } : current,
      );
      localStorage.setItem("starlab-code-token", nextToken);
    } catch (caught) {
      const nextError = caught instanceof Error ? caught.message : "데이터를 불러오지 못했습니다.";
      setError(nextError);
      if (options.preserveSessionOnError) return;
      localStorage.removeItem("starlab-code-token");
      setToken(null);
      setUser(null);
      setTeachers([]);
    } finally {
      setAuthBootstrapping(false);
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const savedToken = localStorage.getItem("starlab-code-token");
    if (savedToken) {
      void loadAppData(savedToken);
      return;
    }
    setAuthBootstrapping(false);
  }, []);

  useEffect(() => {
    const tick = () => setClockNow(new Date(Date.now() + serverClockOffsetRef.current));
    tick();
    const intervalId = window.setInterval(tick, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    localStorage.setItem("starlab-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
    document.documentElement.style.colorScheme = appTheme;
    localStorage.setItem("starlab-theme", appTheme);
  }, [appTheme]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4500);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (profileMenuRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (isEditorWindow || isPreviewMode) return;
    let alive = true;

    async function checkHealth() {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const serverDate = response.headers.get("date");
        if (serverDate) {
          const serverTime = Date.parse(serverDate);
          if (Number.isFinite(serverTime)) {
            serverClockOffsetRef.current = serverTime - Date.now();
            if (alive) setClockNow(new Date(serverTime));
          }
        }
        if (alive) setHealthState(response.ok ? "ok" : "down");
      } catch {
        if (alive) setHealthState("down");
      }
    }

    void checkHealth();
    const intervalId = window.setInterval(checkHealth, 60_000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [isEditorWindow, isPreviewMode]);

  useEffect(() => {
    if (!isEditorWindow || !selectedProblemId) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "editor");
    nextUrl.searchParams.set("problem", String(selectedProblemId));
    window.history.replaceState({}, "", nextUrl.toString());
  }, [isEditorWindow, selectedProblemId]);

  useEffect(() => {
    if (!token || !selectedProblemId) return;
    if (isPreviewMode) {
      const detail = previewProblems.find((problem) => problem.id === selectedProblemId) ?? null;
      setSelectedProblem(detail);
      if (detail) {
        setCodeDrafts((current) =>
          current[selectedProblemId]
            ? current
            : { ...current, [selectedProblemId]: detail.starter_code_python },
        );
      }
      return;
    }
    setSelectedProblem((current) => (current && current.id === selectedProblemId ? current : null));
    const loadProblem = async () => {
      try {
        const detail = await request<ProblemDetail>(`/problems/${selectedProblemId}`, {}, token);
        setSelectedProblem(detail);
        setCodeDrafts((current) => {
          const key = `${selectedProblemId}-python`;
          if (current[key]) return current;
          return {
            ...current,
            [key]: detail.starter_code_python || "import sys\ninput = sys.stdin.readline\n\n",
          };
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "문제 상세를 불러오지 못했습니다.");
      }
    };
    void loadProblem();
  }, [token, selectedProblemId, isPreviewMode]);

  // Teacher live feed polling
  useEffect(() => {
    if (!token || !user || user.role !== "teacher" || feedPaused || isPreviewMode) return;
    const intervalId = window.setInterval(async () => {
      try {
        const sinceId = lastFeedIdRef.current;
        const path = sinceId > 0 ? `/submissions/feed?since_id=${sinceId}` : "/submissions/feed?limit=60";
        const fresh = await request<SubmissionFeedItem[]>(path, {}, token);
        if (fresh.length === 0) return;
        const maxId = fresh.reduce((max, f) => (f.id > max ? f.id : max), sinceId);
        lastFeedIdRef.current = maxId;
        setFeed((current) => {
          const merged = [...fresh, ...current];
          const seen = new Set<number>();
          const dedup: SubmissionFeedItem[] = [];
          for (const item of merged) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            dedup.push(item);
          }
          return dedup.slice(0, 80);
        });
        setFeedHighlightId(fresh[0].id);
        window.setTimeout(() => setFeedHighlightId(null), 2200);
      } catch {
        /* swallow polling errors */
      }
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [token, user, feedPaused, isPreviewMode]);

  function navigate(next: View) {
    setView((current) => {
      if (current === next) return current;
      setViewHistory((history) => [...history, current].slice(-16));
      return next;
    });
    setProfileMenuOpen(false);
    setMessage(null);
    setError(null);
  }

  function refreshAppDataFromNavigation() {
    if (!token || isPreviewMode) return;
    void loadAppData(token, user ?? undefined, { preserveSessionOnError: true });
  }

  function handleSideNavClick(next: View) {
    navigate(next);
    refreshAppDataFromNavigation();
  }

  function goBackView() {
    const previous = viewHistory[viewHistory.length - 1];
    if (!previous) return;
    setView(previous);
    setViewHistory((history) => history.slice(0, -1));
    setProfileMenuOpen(false);
    setMessage(null);
    setError(null);
  }

  function openProblem(problemId: number) {
    setSelectedProblemId(problemId);
    setStream(null);
    setSolvePane("problem");
    if (isPreviewMode) {
      setSelectedProblem(previewProblems.find((problem) => problem.id === problemId) ?? null);
      navigate("solve");
      return;
    }
    if (isEditorWindow) {
      navigate("solve");
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "editor");
    nextUrl.searchParams.set("problem", String(problemId));
    const popup = window.open(nextUrl.toString(), "_blank");

    if (popup) {
      popup.focus();
      return;
    }

    navigate("solve");
  }

  function fillProblemFormFromDetail(problem: ProblemDetail) {
    setProblemFormMode("edit");
    setProblemForm({
      title: problem.title,
      short_description: problem.short_description,
      statement: problem.statement,
      input_description: problem.input_description,
      output_description: problem.output_description,
      constraints: problem.constraints,
      category_id: problem.category_id,
      difficulty: problem.difficulty,
      starter_code_python: problem.starter_code_python,
      sample_input: problem.sample_input,
      sample_output: problem.sample_output,
      time_limit_seconds: problem.time_limit_seconds,
      memory_limit_mb: problem.memory_limit_mb,
      testcases:
        problem.all_testcases?.map((tc) => ({
          id: tc.id,
          input_data: tc.input_data,
          expected_output: tc.expected_output,
          is_public: tc.is_public,
          note: tc.note,
        })) ?? [emptyTestcase()],
    });
  }

  function loadSelectedProblemIntoForm() {
    if (!selectedProblem) return;
    fillProblemFormFromDetail(selectedProblem);
    navigate("manage");
  }

  async function openProblemForManage(problemId: number) {
    setSelectedProblemId(problemId);
    setStream(null);
    setError(null);
    if (isPreviewMode) {
      const detail = previewProblems.find((problem) => problem.id === problemId) ?? null;
      if (detail) {
        setSelectedProblem(detail);
        fillProblemFormFromDetail(detail);
      }
      navigate("manage");
      return;
    }
    if (!token) return;
    try {
      const detail =
        selectedProblem?.id === problemId
          ? selectedProblem
          : await request<ProblemDetail>(`/problems/${problemId}`, {}, token);
      setSelectedProblem(detail);
      fillProblemFormFromDetail(detail);
      navigate("manage");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "문제 관리 화면을 열지 못했습니다.");
    }
  }

  function resetProblemForm() {
    setProblemFormMode("create");
    setProblemForm(emptyProblemForm(categories[0]?.id ?? 0));
    navigate("manage");
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (isLoggingIn) return;
    setError(null);
    setMessage(null);
    setIsLoggingIn(true);
    try {
      const body = new URLSearchParams();
      body.set("username", loginDraft.username);
      body.set("password", loginDraft.password);
      const auth = await request<AuthResponse>("/auth/token", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      await loadAppData(auth.access_token, auth.user);
      navigate(isEditorWindow ? "solve" : "home");
      setMessage(`${auth.user.display_name} 님 환영합니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleCreateTeacher(event: FormEvent) {
    event.preventDefault();
    if (!token || !user || user.role !== "teacher") return;
    setError(null);
    setMessage(null);
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 계정이 실제로 저장되지 않습니다.");
      return;
    }
    try {
      const created = await request<UserProfile>(
        "/users/teachers",
        {
          method: "POST",
          body: JSON.stringify(teacherCreateDraft),
        },
        token,
      );
      setTeacherCreateDraft(emptyTeacherAccountDraft());
      setMessage(`${created.display_name} 선생님 계정을 만들었습니다.`);
      await loadAppData(token, user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선생님 계정 생성에 실패했습니다.");
    }
  }

  async function handleCreateStudent(event: FormEvent) {
    event.preventDefault();
    if (!token || !user || user.role !== "teacher") return;
    setError(null);
    setMessage(null);
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 학생 계정이 실제로 저장되지 않습니다.");
      return;
    }
    try {
      const created = await request<UserProfile>(
        "/users/students",
        {
          method: "POST",
          body: JSON.stringify(studentCreateDraft),
        },
        token,
      );
      setStudentCreateDraft(emptyStudentAccountDraft());
      setMessage(`${created.display_name} 학생 계정을 만들었습니다.`);
      await loadAppData(token, user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "학생 계정 생성에 실패했습니다.");
    }
  }

  async function handleDeleteTeacher(teacherId: number) {
    if (!token || !user || user.role !== "teacher") return;
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 계정 삭제가 실행되지 않습니다.");
      return;
    }
    const teacher = teachers.find((item) => item.id === teacherId);
    if (!teacher || teacher.is_primary_teacher) return;
    setConfirmDialog({
      title: "선생님 계정 삭제",
      body: `${teacher.display_name} 선생님 계정을 삭제할까요? 담당 학생은 메인 선생님에게 이관됩니다.`,
      confirmLabel: "삭제",
      tone: "danger",
      onConfirm: async () => {
        setError(null);
        setMessage(null);
        try {
          await request<{ ok: boolean }>(`/users/teachers/${teacherId}`, { method: "DELETE" }, token);
          setMessage(`${teacher.display_name} 선생님 계정을 삭제했습니다.`);
          await loadAppData(token, user);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "선생님 계정 삭제에 실패했습니다.");
        }
      },
    });
  }

  async function handleDeleteStudent(studentId: number) {
    if (!token || !user || user.role !== "teacher") return;
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 학생 삭제가 실행되지 않습니다.");
      return;
    }
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    setConfirmDialog({
      title: "학생 계정 삭제",
      body: `${student.display_name} 학생 계정과 관련 과제/제출 기록을 삭제할까요?`,
      confirmLabel: "삭제",
      tone: "danger",
      onConfirm: async () => {
        setError(null);
        setMessage(null);
        try {
          await request<{ ok: boolean }>(`/users/students/${studentId}`, { method: "DELETE" }, token);
          setMessage(`${student.display_name} 학생 계정을 삭제했습니다.`);
          await loadAppData(token, user);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "학생 계정 삭제에 실패했습니다.");
        }
      },
    });
  }

  async function handleMoveStudent(studentId: number, teacherId: number, className: string) {
    if (!token || !user || user.role !== "teacher") return;
    const student = students.find((item) => item.id === studentId);
    const teacher = teachers.find((item) => item.id === teacherId) ?? (user?.id === teacherId ? user : null);
    setConfirmDialog({
      title: "반 이동",
      body:
        `${student?.display_name ?? "선택한 학생"}을(를) ` +
        `${teacher?.display_name ?? "선택한 선생님"} / ${className} 반으로 이동할까요?`,
      confirmLabel: "이동",
      tone: "default",
      onConfirm: async () => {
        setError(null);
        setMessage(null);
        if (isPreviewMode) {
          setMessage(
            `${student?.display_name ?? "선택한 학생"} 반 이동 UI를 확인했습니다. ` +
              `담당 선생님: ${teacher?.display_name ?? "선택한 선생님"}, 반: ${className}`,
          );
          return;
        }
        try {
          await request<UserProfile>(
            `/users/students/${studentId}`,
            {
              method: "PATCH",
              body: JSON.stringify({ primary_teacher_id: teacherId, class_name: className }),
            },
            token,
          );
          setMessage(
            `${student?.display_name ?? "학생"}을(를) ${teacher?.display_name ?? "선택한 선생님"} / ${className} 반으로 이동했습니다.`,
          );
          await loadAppData(token, user);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "반 이동에 실패했습니다.");
        }
      },
    });
  }

  function handleDeleteProblems(problemIds: number[]) {
    const picked = problems.filter((problem) => problemIds.includes(problem.id));
    const count = picked.length || problemIds.length;
    const names = picked.slice(0, 3).map((problem) => problem.title).join(", ");
    setConfirmDialog({
      title: "문제 삭제",
      body: `${names ? `${names}${count > 3 ? " 외" : ""} ` : ""}${count}개 문제를 삭제할까요? 연관된 과제와 제출 기록도 함께 삭제됩니다.`,
      confirmLabel: "삭제",
      tone: "danger",
      onConfirm: async () => {
        if (!token) return;
        setError(null);
        if (isPreviewMode) {
          setMessage("UI 미리보기에서는 문제 삭제가 실행되지 않습니다.");
          return;
        }
        try {
          await Promise.all(
            problemIds.map((id) => request<{ ok: boolean }>(`/problems/${id}`, { method: "DELETE" }, token)),
          );
          setMessage(`${count}개 문제를 삭제했습니다.`);
          if (selectedProblemId && problemIds.includes(selectedProblemId)) {
            setSelectedProblemId(null);
            setSelectedProblem(null);
            navigate("problems");
          }
          await loadAppData(token, user ?? undefined);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "문제 삭제에 실패했습니다.");
        }
      },
    });
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const className = registerNewClassName.trim() || registerDraft.class_name.trim();
    if (!className) {
      setError("가입할 수강반을 선택하거나 새 반 이름을 입력해 주세요.");
      return;
    }
    try {
      await request<UserProfile>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ ...registerDraft, class_name: className }),
      });
      setMessage("회원 생성이 완료되었습니다. 바로 로그인할 수 있어요.");
      setLoginDraft({ username: registerDraft.username, password: registerDraft.password });
      setRegisterDraft({ username: "", display_name: "", password: "", class_name: "" });
      setRegisterNewClassName("");
      await loadPublicClassrooms();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회원 생성에 실패했습니다.");
    }
  }

  function logout() {
    localStorage.removeItem("starlab-code-token");
    setToken(null);
    setUser(null);
    setTeachers([]);
    setSelectedProblem(null);
    setSelectedProblemId(null);
    setAssignments([]);
    setProblems([]);
    setStudents([]);
    setSubmissions([]);
    setFeed([]);
    setStream(null);
    setViewHistory([]);
    setProfileMenuOpen(false);
    setMessage("로그아웃했습니다.");
  }

  async function executeStream(kind: "run" | "submit") {
    if (!token || !selectedProblemId) return;
    setIsRunning(true);
    setError(null);
    setMessage(null);
    setStream({ kind, total: 0, completed: 0, results: [], done: false, summary: null });
    try {
      if (isPreviewMode) {
        const results: ExecutionResult[] = [
          { index: 0, status: "passed", stdout: "7", stderr: "", expected: "7", actual: "7", runtime_ms: 18 },
          { index: 1, status: "passed", stdout: "12", stderr: "", expected: "12", actual: "12", runtime_ms: 21 },
          { index: 2, status: kind === "run" ? "passed" : "wrong_answer", stdout: "", stderr: "", expected: "YES", actual: kind === "run" ? "YES" : "NO", runtime_ms: 25 },
        ];
        const passedTests = results.filter((result) => result.status === "passed").length;
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setStream({
          kind,
          total: results.length,
          completed: results.length,
          results,
          done: true,
          summary: {
            status: passedTests === results.length ? "accepted" : "wrong_answer",
            passed_tests: passedTests,
            total_tests: results.length,
            runtime_ms: results.reduce((sum, result) => sum + result.runtime_ms, 0),
          },
        });
        setMessage(kind === "run" ? "미리보기 예제 실행 완료" : "미리보기 제출 결과를 표시했습니다.");
        return;
      }
      const payload = {
        code: codeDrafts[`${selectedProblemId}-${editorLanguage}`]
          ?? (editorLanguage === "c" ? C_STARTER : selectedProblem?.starter_code_python ?? ""),
        language: editorLanguage,
        assignment_id:
          kind === "submit" && user?.role === "student"
            ? currentProblemAssignments.find((a) => a.student_id === user.id)?.id ?? null
            : null,
      };
      const path = `/problems/${selectedProblemId}/${kind === "run" ? "run/stream" : "submit/stream"}`;
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok || !response.body) {
        const errorText = await response.text();
        let detail = errorText;
        try {
          detail = JSON.parse(errorText).detail ?? errorText;
        } catch {
          /* not JSON */
        }
        throw new Error(detail || "실행 요청에 실패했습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalSummary: StreamState["summary"] = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            const msg = JSON.parse(line);
            if (msg.kind === "start") {
              setStream((prev) => (prev ? { ...prev, total: msg.total } : prev));
            } else if (msg.kind === "result") {
              const nextResult: ExecutionResult = {
                index: msg.index,
                status: msg.status,
                stdout: msg.stdout ?? "",
                stderr: msg.stderr ?? "",
                expected: msg.expected ?? "",
                actual: msg.actual ?? "",
                runtime_ms: msg.runtime_ms ?? 0,
              };
              setStream((prev) =>
                prev
                  ? {
                      ...prev,
                      completed: prev.completed + 1,
                      results: [...prev.results, nextResult],
                    }
                  : prev,
              );
            } else if (msg.kind === "done") {
              finalSummary = {
                status: msg.status,
                passed_tests: msg.passed_tests,
                total_tests: msg.total_tests,
                runtime_ms: msg.runtime_ms,
              };
              setStream((prev) => (prev ? { ...prev, done: true, summary: finalSummary } : prev));
            }
          }
          newline = buffer.indexOf("\n");
        }
      }

      if (finalSummary) {
        if (kind === "submit") {
          await loadAppData(token, user ?? undefined);
          setMessage(
            `제출 결과: ${statusLabel(finalSummary.status)}`,
          );
        } else {
          setMessage("예제 테스트 실행 완료");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "실행 중 오류가 발생했습니다.");
    } finally {
      setIsRunning(false);
    }
  }

  async function saveProblem(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setMessage(null);
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 문제 저장이 실행되지 않습니다.");
      return;
    }
    try {
      const filledTcs = problemForm.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim());
      const payload = { ...problemForm, testcases: filledTcs };

      if (problemFormMode === "edit" && selectedProblemId) {
        // 1. 문제 메타데이터만 PUT (testcases 제외 → 백엔드가 TC를 건드리지 않음)
        const { testcases: _tcs, ...metaOnly } = payload;
        await request<ProblemDetail>(
          `/problems/${selectedProblemId}`,
          { method: "PUT", body: JSON.stringify(metaOnly) },
          token,
        );

        // 2. TC delta 계산
        const originalTcs = selectedProblem?.all_testcases ?? [];
        const originalById = new Map(
          originalTcs.filter((tc) => tc.id != null).map((tc) => [tc.id!, tc]),
        );
        const formIdSet = new Set(filledTcs.filter((tc) => tc.id != null).map((tc) => tc.id!));

        const toDelete = [...originalById.keys()].filter((id) => !formIdSet.has(id));
        const toPost = filledTcs.filter((tc) => tc.id == null);
        const toPatch = filledTcs.filter((tc) => {
          if (tc.id == null) return false;
          const orig = originalById.get(tc.id);
          if (!orig) return false;
          return (
            tc.input_data !== orig.input_data ||
            tc.expected_output !== orig.expected_output ||
            tc.is_public !== orig.is_public ||
            tc.note !== orig.note
          );
        });

        // 3. POST/DELETE 순서 결정: 중간 상태에서 10개 미만 or 50개 초과가 없도록 처리
        //    POST-first: 현재 개수 + 새 TC ≤ 50 이면 안전
        //    DELETE-first: 현재 개수 - 삭제 TC ≥ 10 이면 안전
        //    둘 다 불가능하면 PUT으로 일괄 교체 (폴백)
        const currentCount = originalTcs.length;
        const postFirst = currentCount + toPost.length <= 50;
        const deleteFirst = currentCount - toDelete.length >= 10;

        if (!postFirst && !deleteFirst && (toPost.length > 0 || toDelete.length > 0)) {
          // 폴백: TC 전체를 PUT으로 일괄 교체
          await request<ProblemDetail>(
            `/problems/${selectedProblemId}`,
            { method: "PUT", body: JSON.stringify(payload) },
            token,
          );
        } else {
          const baseUrl = `/problems/${selectedProblemId}/testcases`;

          const postAll = async () => {
            for (const tc of toPost) {
              const { id: _id, ...tcBody } = tc;
              await request<TestCase>(baseUrl, { method: "POST", body: JSON.stringify(tcBody) }, token);
            }
          };
          const deleteAll = async () => {
            for (const id of toDelete) {
              await request<{ ok: boolean }>(`${baseUrl}/${id}`, { method: "DELETE" }, token);
            }
          };

          if (postFirst) {
            await postAll();
            await deleteAll();
          } else {
            await deleteAll();
            await postAll();
          }

          // 수정된 기존 TC PATCH (순서 무관)
          for (const tc of toPatch) {
            const { id: tcId, ...tcBody } = tc;
            await request<TestCase>(`${baseUrl}/${tcId}`, { method: "PATCH", body: JSON.stringify(tcBody) }, token);
          }
        }

        setMessage("문제를 수정했습니다.");
      } else {
        const created = await request<ProblemDetail>(
          "/problems",
          { method: "POST", body: JSON.stringify(payload) },
          token,
        );
        setSelectedProblemId(created.id);
        setMessage("새 문제를 등록했습니다.");
      }
      await loadAppData(token, user ?? undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "문제 저장에 실패했습니다.");
    }
  }

  async function createAssignments(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setMessage(null);
    if (isPreviewMode) {
      setMessage("UI 미리보기에서는 과제 배정이 실제로 저장되지 않습니다.");
      navigate("assignments");
      return;
    }
    if (!assignmentDraft.problem_id) {
      setError("문제를 먼저 선택해 주세요.");
      return;
    }
    if (!assignmentDraft.class_name) {
      setError("과제를 배정할 수강반을 선택해 주세요.");
      return;
    }
    try {
      const pickedProblem = problems.find((p) => p.id === assignmentDraft.problem_id);
      await request<Assignment[]>(
        "/assignments",
        {
          method: "POST",
          body: JSON.stringify({
            title: assignmentDraft.title || `${pickedProblem?.title ?? "선택 문제"} 과제`,
            problem_id: assignmentDraft.problem_id,
            assignment_type: assignmentDraft.assignment_type,
            class_name: assignmentDraft.class_name,
            due_at: assignmentDraft.due_at || null,
            classroom_label: assignmentDraft.classroom_label || assignmentDraft.class_name,
          }),
        },
        token,
      );
      setMessage(`'${assignmentDraft.class_name}' 수강반에 과제를 배정했습니다.`);
      setAssignmentDraft(emptyAssignmentDraft());
      await loadAppData(token, user ?? undefined);
      navigate("assignments");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "과제 배정에 실패했습니다.");
    }
  }

  async function openGroupDetail(groupKey: string) {
    if (!token) return;
    setActiveGroupKey(groupKey);
    setGroupDetail([]);
    setGroupDetailLoading(true);
    if (isPreviewMode) {
      setGroupDetail(makePreviewData(user?.role ?? "teacher").groupDetail);
      setGroupDetailLoading(false);
      return;
    }
    try {
      const detail = await request<AssignmentGroupStudent[]>(
        `/assignments/groups/detail?group_key=${encodeURIComponent(groupKey)}`,
        {},
        token,
      );
      setGroupDetail(detail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상세 현황을 불러오지 못했습니다.");
    } finally {
      setGroupDetailLoading(false);
    }
  }

  function closeGroupDetail() {
    setActiveGroupKey(null);
    setGroupDetail([]);
  }

  if (authBootstrapping) {
    return (
      <div className="auth-cinematic-page auth-loading-scene">
        <div className="auth-loader-wrap" role="status" aria-live="polite">
          <div className="auth-loader-logo">
            <span className="auth-loader-ring" />
            <BrandMark className="auth-loader-brand" />
          </div>
          <div className="auth-loader-copy">
            <h1>로그인 데이터 불러오기</h1>
            <p>인증 확인 중 · 학습 데이터 동기화</p>
          </div>
          <div className="auth-loader-track" role="progressbar" aria-label="Loading login data" aria-valuemin={0} aria-valuemax={100}>
            <span />
          </div>
          <div className="auth-loader-dots" aria-hidden="true">
            <span className="on" />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    );
  }

  if (!user || !token) {
    return (
      <div className="auth-cinematic-page">
        <div className="auth-code-float auth-code-float-one">{"def solve():\n    return answer"}</div>
        <div className="auth-code-float auth-code-float-two">{"queue = deque([start])\nwhile queue:"}</div>
        <div className="auth-code-float auth-code-float-three">{"dp[i] = max(dp[i], dp[i-1])"}</div>
        <section className="auth-cinematic-shell">
          <aside className="auth-brand-panel">
            <div>
              <div className="auth-logo-row">
                <BrandMark className="auth-logo-mark" />
              </div>
              <h1>
                StarLab
                <br />
                <span>Expert</span>
              </h1>
              <p>
                문제 풀이, 과제, 제출 관리용 교육 플랫폼
              </p>
            </div>
            <div className="auth-feature-list" aria-hidden="true">
              <div><span>#</span> 학생별 과제, 제출 기록 관리</div>
              <div><span>#</span> 학생별 학습 흐름 확인</div>
              <div><span>#</span> 실시간 채점 기능</div>
            </div>
          </aside>

          <div className="auth-cinematic-divider" />

          <main className="auth-form-panel">
            <div className="auth-glass-card">
              <div>
                <h2>로그인</h2>
                <p>"Hello World"</p>
              </div>

              {(message || error) && (
                <div className={`auth-dark-toast ${error ? "auth-dark-toast-error" : "auth-dark-toast-ok"}`}>
                  {error ?? message}
                </div>
              )}

              <form className="auth-dark-form" onSubmit={handleLogin}>
                <label className="auth-dark-field">
                  <span>아이디</span>
                  <div>
                    <b aria-hidden="true">ID</b>
                    <input
                      value={loginDraft.username}
                      onChange={(e) => setLoginDraft((c) => ({ ...c, username: e.target.value }))}
                      placeholder="아이디를 입력하세요"
                      autoComplete="username"
                    />
                  </div>
                </label>

                <label className="auth-dark-field">
                  <span>비밀번호</span>
                  <div>
                    <b aria-hidden="true">PW</b>
                    <input
                      type="password"
                      value={loginDraft.password}
                      onChange={(e) => setLoginDraft((c) => ({ ...c, password: e.target.value }))}
                      placeholder="비밀번호를 입력하세요"
                      autoComplete="current-password"
                    />
                  </div>
                </label>

                <button className="auth-dark-submit" type="submit" disabled={isLoggingIn}>
                  {isLoggingIn ? "로그인 중..." : "로그인"}
                </button>
              </form>

              {/*<div className="auth-preview-actions">
                <p>백엔드 없이 디자인만 빠르게 확인하려면 미리보기로 들어가세요.</p>
                <div>
                  <button type="button" onClick={() => enterPreviewMode("teacher")}>
                    선생님 UI 보기
                  </button>
                  <button type="button" onClick={() => enterPreviewMode("student")}>
                    학생 UI 보기
                  </button>
                </div>
              </div> */}
            </div>
          </main>
        </section>
      </div>
    );
  }
  const navItems: { key: View; label: string; show: boolean }[] = [
    { key: "home", label: user.role === "teacher" ? "대시보드" : "홈", show: true },
    { key: "problems", label: "문제", show: true },
    { key: "assignments", label: "과제", show: true },
    { key: "submissions", label: "내 제출", show: user.role === "student" },
    { key: "live", label: "실시간 채점", show: user.role === "teacher" },
    { key: "manage", label: "문제 관리", show: user.role === "teacher" },
    { key: "accounts", label: "계정 관리", show: user.role === "teacher" },
  ];
  const visibleNavItems = navItems.filter((item) => item.show);
  const currentViewLabel = visibleNavItems.find((item) => item.key === view)?.label ?? "학습 화면";
  const appClassName = isEditorWindow
    ? "app-root app-root-editor"
    : `app-root app-shell${sidebarCollapsed ? " app-layout-collapsed" : ""}`;

  return (
    <div className={appClassName}>
      {!isEditorWindow && (
        <header className="app-header">
          <button className="brand header-brand" onClick={() => navigate("home")} aria-label="Starlab Code 홈으로 이동">
            <BrandMark />
          </button>
          <div className="header-status">
            <span className="header-clock">
              <span>{clockParts.dateText}</span>
              <strong>{clockParts.timeText}</strong>
            </span>
            <span className="header-study">
              <span>공부 시간</span>
              <strong>{studyDuration}</strong>
            </span>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setAppTheme((current) => (current === "dark" ? "light" : "dark"))}
            aria-label={appTheme === "dark" ? "라이트 테마로 변경" : "다크 테마로 변경"}
            title={appTheme === "dark" ? "라이트 테마" : "다크 테마"}
          >
            <span className="theme-toggle-mark">
              <ThemeToggleIcon targetTheme={appTheme === "dark" ? "light" : "dark"} />
            </span>
          </button>
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setProfileMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
            >
              <span className="profile-avatar" aria-hidden="true">
                <ProfileRoleIcon role={user.role} />
              </span>
              <span className="profile-trigger-copy">
                <strong>{user.display_name}</strong>
                <span>
                  {user.role === "teacher" ? (user.is_primary_teacher ? "메인 선생님" : "선생님") : user.class_name ?? "학생"}
                </span>
              </span>
              <span className="profile-caret" aria-hidden="true">v</span>
            </button>
            {profileMenuOpen && (
              <div className="profile-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    navigate("home");
                  }}
                >
                  대시보드
                </button>
                {/* <button type="button" role="menuitem" onClick={() => navigate("home")}>
                  대시보드
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    navigate("home");
                    setMessage("프로필 정보는 대시보드 상단에서 확인할 수 있습니다.");
                  }}
                >
                  프로필
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setError(null);
                    setMessage("도움말은 수업 운영 중 필요한 기능 안내를 이곳에 연결할 수 있습니다.");
                  }}
                >
                  도움말
                </button> */}
                <button type="button" role="menuitem" className="profile-menu-danger" onClick={logout}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      {!isEditorWindow && (
        <aside className="side-nav" aria-label="주요 메뉴">
          <div className="side-nav-scroll">
            {/*}
            <button
              type="button"
              className="nav-back side-nav-back"
              onClick={goBackView}
              disabled={viewHistory.length === 0}
              title={viewHistory.length === 0 ? "이전 화면이 없습니다" : "이전 화면으로 이동"}
            >
              <span className="side-nav-marker">&lt;</span>
              <span className="side-nav-text">이전</span>
            </button>
            */}
            <nav className="side-nav-links">
              {visibleNavItems.map((item) => (
                <button
                  key={item.key}
                  className={view === item.key ? "side-nav-link side-nav-link-active" : "side-nav-link"}
                  onClick={() => handleSideNavClick(item.key)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className="side-nav-marker">
                    <SideNavIcon view={item.key} />
                  </span>
                  <span className="side-nav-text">
                    {item.label}
                  </span>
                </button>
              ))}
            </nav>
          </div>
          <button
            type="button"
            className="side-nav-toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
          >
            <span className="side-toggle-mark">{sidebarCollapsed ? ">" : "<"}</span>
            <span className="side-toggle-text">{sidebarCollapsed ? "펼치기" : "접기"}</span>
          </button>
        </aside>
      )}

      <main className={isEditorWindow ? "page page-editor-window" : "page"}>
        {/* {error && <div className="toast toast-error">{error}</div>}
        {isLoading && <div className="toast toast-info">데이터를 불러오는 중입니다...</div>} */}

        {view === "home" && user.role === "student" && (
          <StudentAcademyHome
            user={user}
            stats={studentStats}
            metrics={studentMetrics}
            dashboard={dashboard}
            assignments={myAssignments}
            submissions={submissions}
            problems={problems}
            leaderboard={leaderboard}
            onOpenProblem={openProblem}
            onGoProblems={() => navigate("problems")}
            onGoAssignments={() => navigate("assignments")}
          />
        )}

        {view === "home" && user.role === "teacher" && (
          <TeacherHomeRedesign
            user={user}
            metrics={teacherMetrics}
            dashboard={dashboard}
            feed={feed}
            highlightId={feedHighlightId}
            paused={feedPaused}
            onTogglePause={() => setFeedPaused((p) => !p)}
            onOpenProblem={openProblem}
            assignments={assignments}
            students={students}
            onGoLive={() => navigate("live")}
            onGoAssignments={() => navigate("assignments")}
            onGoManage={() => navigate("manage")}
          />
        )}

        {view === "live" && user.role === "teacher" && (
          <LiveFeedView
            feed={feed}
            highlightId={feedHighlightId}
            paused={feedPaused}
            onTogglePause={() => setFeedPaused((p) => !p)}
            onOpenProblem={openProblem}
          />
        )}

        {view === "problems" && (
          <ProblemListView
            problems={filteredProblems}
            categories={categories}
            categoryFilter={categoryFilter}
            difficultyFilter={difficultyFilter}
            problemFilter={problemFilter}
            onSearch={setProblemFilter}
            onCategory={setCategoryFilter}
            onDifficulty={setDifficultyFilter}
            onOpen={openProblem}
            onEditProblem={openProblemForManage}
            onDeleteProblems={handleDeleteProblems}
            submissions={submissions}
            userRole={user.role}
          />
        )}

        {view === "solve" && (
          <SolveView
            user={user}
            problem={selectedProblem}
            problemId={selectedProblemId}
            code={selectedCode}
            onChangeCode={(next) =>
              setCodeDrafts((current) => ({
                ...current,
                ...(selectedProblemId ? { [`${selectedProblemId}-${editorLanguage}`]: next } : {}),
              }))
            }
            onRun={() => void executeStream("run")}
            onSubmit={() => void executeStream("submit")}
            isRunning={isRunning}
            stream={stream}
            submissions={submissions.filter((s) => s.problem_id === selectedProblemId)}
            assignments={currentProblemAssignments}
            pane={solvePane}
            setPane={setSolvePane}
            onEditProblem={loadSelectedProblemIntoForm}
            popupMode={isEditorWindow}
            onOpenWindow={() => {
              if (selectedProblemId) openProblem(selectedProblemId);
            }}
            language={editorLanguage}
            onChangeLanguage={setEditorLanguage}
          />
        )}

        {view === "assignments" && (
          <AssignmentsView
            user={user}
            assignments={assignments}
            students={students}
            problems={problems}
            groups={assignmentGroups}
            activeGroupKey={activeGroupKey}
            groupDetail={groupDetail}
            groupDetailLoading={groupDetailLoading}
            onOpenGroup={openGroupDetail}
            onCloseGroup={closeGroupDetail}
            assignmentDraft={assignmentDraft}
            setAssignmentDraft={setAssignmentDraft}
            onCreate={createAssignments}
            onOpenProblem={openProblem}
          />
        )}

        {view === "accounts" && user.role === "teacher" && (
          <AccountsView
            user={user}
            teachers={teachers}
            students={students}
            teacherCreateDraft={teacherCreateDraft}
            setTeacherCreateDraft={setTeacherCreateDraft}
            studentCreateDraft={studentCreateDraft}
            setStudentCreateDraft={setStudentCreateDraft}
            onCreateTeacher={handleCreateTeacher}
            onCreateStudent={handleCreateStudent}
            onDeleteTeacher={handleDeleteTeacher}
            onDeleteStudent={handleDeleteStudent}
            onMoveStudent={handleMoveStudent}
          />
        )}

        {view === "submissions" && user.role === "student" && (
          <SubmissionsView
            submissions={submissions}
            problems={problems}
            onOpenProblem={openProblem}
          />
        )}

        {view === "manage" && user.role === "teacher" && (
          <ManageView
            categories={categories}
            problemForm={problemForm}
            setProblemForm={setProblemForm}
            mode={problemFormMode}
            onSubmit={saveProblem}
            onReset={resetProblemForm}
            problemId={selectedProblemId}
            onDeleteProblem={(problemId) => handleDeleteProblems([problemId])}
          />
        )}
      </main>
      {!isEditorWindow && <AppFooter user={user} healthState={healthState} apiBaseUrl={API_BASE_URL} />}
      {confirmDialog && <ConfirmDialogModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {(message || error) && (
        <div className={`app-toast app-toast-${error ? "error" : "ok"}`} role="status">
          <span>{error ?? message}</span>
          <button type="button" aria-label="닫기" onClick={() => { setError(null); setMessage(null); }}>✕</button>
        </div>
      )}
    </div>
  );
}

function AppFooter({
  user,
  healthState,
  apiBaseUrl,
}: {
  user: UserProfile;
  healthState: HealthState;
  apiBaseUrl: string;
}) {
  const statusText =
    healthState === "checking" ? "서버 확인 중" : healthState === "ok" ? "서버 정상" : "서버 점검 필요";

  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="footer-brand">
          <BrandMark className="footer-brand-mark" />
          <div>
            <strong>Starlab Expert</strong>
            <span>Confidential Starlab. 2026</span>
          </div>
        </div>
        <div className="footer-meta">
          <span>{APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}

type StudentMetrics = {
  activity: { date: Date; submitted: number; accepted: number }[];
  streak: number;
  todaySubmitted: number;
  todayAccepted: number;
  last7Solved: number;
  last30Solved: number;
  activeDays: number;
  difficultyTotals: Record<Difficulty, { solved: number; total: number }>;
  categoryRows: { name: string; solved: number; total: number }[];
};

function StudentHome(props: {
  user: UserProfile;
  stats: { solved: number; attempts: number; accuracy: number } | null;
  metrics: StudentMetrics | null;
  dashboard: DashboardSummary | null;
  assignments: Assignment[];
  submissions: Submission[];
  problems: ProblemCard[];
  onOpenProblem: (id: number) => void;
  onGoProblems: () => void;
  onGoAssignments: () => void;
}) {
  const { user, stats, metrics, dashboard, assignments, submissions, problems, onOpenProblem, onGoProblems, onGoAssignments } = props;
  const pending = assignments.filter((a) => !a.submitted).slice(0, 5);
  const recommended = problems
    .filter((p) => !submissions.some((s) => s.problem_id === p.id && s.status === "accepted"))
    .slice(0, 6);

  const totalProblems = dashboard?.total_problems ?? 0;
  const solved = stats?.solved ?? 0;
  const overallPct = totalProblems === 0 ? 0 : Math.round((solved / totalProblems) * 100);
  const maxAccepted = metrics ? Math.max(1, ...metrics.activity.map((a) => a.accepted)) : 1;
  const intensity = (n: number) => {
    if (n === 0) return 0;
    if (n >= maxAccepted) return 4;
    const ratio = n / maxAccepted;
    if (ratio < 0.34) return 1;
    if (ratio < 0.67) return 2;
    return 3;
  };

  return (
    <div className="student-home">
      <header className="dash-welcome">
        <div className="dash-welcome-text">
          <span className="eyebrow muted">오늘의 성장 리포트</span>
          <h1>
            {user.display_name}
            <span className="dash-welcome-suffix">님, 어제보다 한 걸음 더 나아갔어요</span>
          </h1>
          <p className="muted dash-welcome-sub">
            지금까지 {solved}문제를 정복했어요 · 전체의 <strong>{overallPct}%</strong>
          </p>
        </div>
        <div className="dash-welcome-cta">
          <button className="btn btn-primary" onClick={onGoProblems}>
            오늘의 문제 풀기 →
          </button>
        </div>
      </header>

      <section className="metric-row">
        <article className="metric">
          <span className="metric-label">해결한 문제</span>
          <strong className="metric-value">
            {solved}
            <span className="metric-of muted">/ {totalProblems}</span>
          </strong>
          <span className="metric-hint">전체의 {overallPct}% 정복</span>
        </article>
        <article className="metric">
          <span className="metric-label">최근 7일</span>
          <strong className="metric-value">
            {metrics?.last7Solved ?? 0}
            <span className="metric-of muted"> 문제 해결</span>
          </strong>
          <span className="metric-trend">
            {metrics?.last7Solved && metrics.last7Solved > 0 ? "📈 꾸준히 성장 중" : "이번 주 첫 문제를 풀어보세요"}
          </span>
        </article>
        <article className="metric">
          <span className="metric-label">연속 풀이</span>
          <strong className="metric-value">
            {metrics?.streak ?? 0}
            <span className="metric-of muted">일 연속 🔥</span>
          </strong>
          <span className="metric-trend">
            {metrics && metrics.streak >= 3 ? "흐름이 살아있어요" : "내일도 한 문제로 streak 이어가요"}
          </span>
        </article>
        <article className="metric">
          <span className="metric-label">정답률</span>
          <strong className="metric-value">
            {stats?.accuracy ?? 0}
            <span className="metric-of muted">%</span>
          </strong>
          <span className="metric-trend">
            총 {stats?.attempts ?? 0}회 제출 · 오늘 {metrics?.todayAccepted ?? 0}회 정답
          </span>
        </article>
      </section>

      <section className="home-section">
        <header className="home-section-head">
          <h2>30일 활동</h2>
          <span className="muted small">
            지난 30일 중 <strong>{metrics?.activeDays ?? 0}일</strong> 풀이 · 총 {metrics?.last30Solved ?? 0}문제 해결
          </span>
        </header>
        <div className="activity-strip">
          {metrics?.activity.map((day, i) => (
            <div
              key={i}
              className={`activity-cell activity-${intensity(day.accepted)}`}
              title={`${day.date.getMonth() + 1}/${day.date.getDate()} · 제출 ${day.submitted} · 정답 ${day.accepted}`}
            />
          ))}
        </div>
        <div className="activity-legend muted small">
          <span>적음</span>
          <span className="activity-cell activity-0" />
          <span className="activity-cell activity-1" />
          <span className="activity-cell activity-2" />
          <span className="activity-cell activity-3" />
          <span className="activity-cell activity-4" />
          <span>많음</span>
        </div>
      </section>

      <section className="growth-grid">
        <div className="home-section">
          <header className="home-section-head">
            <h2>난이도 정복률</h2>
            <span className="muted small">레벨이 올라갈수록 점수가 커져요</span>
          </header>
          <ul className="mastery-list">
            {(["beginner", "basic", "intermediate"] as const).map((level) => {
              const stat = metrics?.difficultyTotals[level] ?? { solved: 0, total: 0 };
              const pct = stat.total === 0 ? 0 : Math.round((stat.solved / stat.total) * 100);
              return (
                <li key={level} className="mastery-row">
                  <div className="mastery-head">
                    <DifficultyBadge level={level} />
                    <span className="mastery-count mono">
                      {stat.solved}<span className="muted">/{stat.total}</span>
                    </span>
                    <span className="mastery-pct mono muted">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="home-section">
          <header className="home-section-head">
            <h2>알고리즘 분야별</h2>
            <span className="muted small">균형 있게 정복해봐요</span>
          </header>
          {!metrics || metrics.categoryRows.length === 0 ? (
            <p className="empty-inline">분류 데이터가 아직 없습니다.</p>
          ) : (
            <ul className="mastery-list">
              {metrics.categoryRows.slice(0, 6).map((row) => {
                const pct = row.total === 0 ? 0 : Math.round((row.solved / row.total) * 100);
                return (
                  <li key={row.name} className="mastery-row">
                    <div className="mastery-head">
                      <span className="mastery-cat">{row.name}</span>
                      <span className="mastery-count mono">
                        {row.solved}<span className="muted">/{row.total}</span>
                      </span>
                      <span className="mastery-pct mono muted">{pct}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="home-section">
        <header className="home-section-head">
          <h2>진행 중인 과제</h2>
          <button className="link" onClick={onGoAssignments}>
            전체 보기 →
          </button>
        </header>
        {pending.length === 0 ? (
          <p className="empty-inline">진행 중인 과제가 없습니다. 아래 추천 문제로 연습해보세요.</p>
        ) : (
          <ul className="clean-list">
            {pending.map((a) => (
              <li key={a.id} className="clean-list-item" onClick={() => onOpenProblem(a.problem_id)}>
                <div className="clean-list-main">
                  <strong>{a.problem_title}</strong>
                  <span className="muted">
                    {a.title} · {a.assignment_type === "homework" ? "숙제" : "수업"}
                  </span>
                </div>
                <span className="muted mono clean-list-meta">{formatDate(a.due_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-section">
        <header className="home-section-head">
          <h2>다음 도전</h2>
          <button className="link" onClick={onGoProblems}>
            문제 둘러보기 →
          </button>
        </header>
        {recommended.length === 0 ? (
          <p className="empty-inline">모든 문제를 풀었습니다. 대단해요!</p>
        ) : (
          <div className="recommend-tiles">
            {recommended.map((p) => (
              <button
                type="button"
                key={p.id}
                className="recommend-tile"
                onClick={() => onOpenProblem(p.id)}
              >
                <div className="tile-top">
                  <span className="muted mono">#{p.id}</span>
                  <DifficultyBadge level={p.difficulty} />
                </div>
                <strong>{p.title}</strong>
                <p className="muted tile-desc">{p.short_description}</p>
                <span className="tile-cat muted">{p.category_name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StudentAcademyHome(props: {
  user: UserProfile;
  stats: { solved: number; attempts: number; accuracy: number } | null;
  metrics: StudentMetrics | null;
  dashboard: DashboardSummary | null;
  assignments: Assignment[];
  submissions: Submission[];
  problems: ProblemCard[];
  leaderboard: LeaderboardEntry[];
  onOpenProblem: (id: number) => void;
  onGoProblems: () => void;
  onGoAssignments: () => void;
}) {
  const { user, stats, metrics, dashboard, assignments, submissions, problems, leaderboard, onOpenProblem, onGoProblems, onGoAssignments } = props;
  const pendingAssignments = assignments.filter((a) => !a.submitted);
  const pending = pendingAssignments.slice(0, 5);
  const recommended = problems
    .filter((p) => !submissions.some((s) => s.problem_id === p.id && s.status === "accepted"))
    .slice(0, 6);

  const totalProblems = dashboard?.total_problems ?? 0;
  const solved = stats?.solved ?? 0;
  const accuracy = stats?.accuracy ?? 0;
  const attempts = stats?.attempts ?? 0;
  const streak = metrics?.streak ?? 0;
  const overallPct = totalProblems === 0 ? 0 : Math.round((solved / totalProblems) * 100);
  const activity = metrics?.activity?.length
    ? metrics.activity
    : Array.from({ length: 30 }, (_, index) => ({
        date: new Date(Date.now() - (29 - index) * 24 * 60 * 60 * 1000),
        submitted: 0,
        accepted: 0,
      }));
  const maxAccepted = Math.max(1, ...activity.map((day) => day.accepted));
  const categoryRows = metrics?.categoryRows ?? [];
  const myRank = leaderboard.find((entry) => entry.student_id === user.id) ?? null;
  const topLeaderboard = leaderboard.slice(0, 12);
  const radarRows = categoryRows.slice(0, 8).map((row) => ({
    ...row,
    pct: row.total === 0 ? 0 : Math.round((row.solved / row.total) * 100),
  }));
  const radarSize = 240;
  const radarCenter = radarSize / 2;
  const radarRadius = 78;
  const radarPoint = (index: number, radius: number) => {
    const angle = -Math.PI / 2 + (index / Math.max(radarRows.length, 1)) * Math.PI * 2;
    return {
      x: radarCenter + Math.cos(angle) * radius,
      y: radarCenter + Math.sin(angle) * radius,
    };
  };
  const radarPolygon = radarRows
    .map((row, index) => {
      const point = radarPoint(index, radarRadius * (row.pct / 100));
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
  const radarAxisPoints = radarRows.map((row, index) => {
    const end = radarPoint(index, radarRadius);
    const label = radarPoint(index, radarRadius + 20);
    return { row, end, label };
  });
  const radarGridRings = [25, 50, 75, 100].map((level) =>
    radarRows.map((_, index) => {
      const point = radarPoint(index, radarRadius * (level / 100));
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }).join(" "),
  );
  const radarTotalSolved = radarRows.reduce((sum, row) => sum + row.solved, 0);
  const radarTotalProblems = radarRows.reduce((sum, row) => sum + row.total, 0);
  const radarAveragePct = radarTotalProblems === 0 ? 0 : Math.round((radarTotalSolved / radarTotalProblems) * 100);
  const strongestRadarRow = [...radarRows].sort((a, b) => b.pct - a.pct || b.solved - a.solved)[0] ?? null;
  const avatarLabel = user.display_name.trim().charAt(0) || "S";
  const dueSoonCount = pendingAssignments.filter((assignment) => {
    if (!assignment.due_at) return false;
    const due = new Date(assignment.due_at).getTime();
    if (Number.isNaN(due)) return false;
    const diff = due - Date.now();
    return diff <= 1000 * 60 * 60 * 24 && diff >= -1000 * 60 * 60 * 24;
  }).length;

  const intensity = (n: number) => {
    if (n === 0) return 0;
    if (n >= maxAccepted) return 4;
    const ratio = n / maxAccepted;
    if (ratio < 0.34) return 1;
    if (ratio < 0.67) return 2;
    return 3;
  };

  const dueLabel = (dueAt: string | null) => {
    if (!dueAt) {
      return { label: "기한 없음", urgent: false };
    }
    const due = new Date(dueAt).getTime();
    if (Number.isNaN(due)) {
      return { label: formatDate(dueAt), urgent: false };
    }
    return {
      label: formatDate(dueAt),
      urgent: due - Date.now() <= 1000 * 60 * 60 * 48,
    };
  };

  return (
    <div className="student-home sh-root">
      <header className="sh-header">
        <div className="sh-profile">
          <div className="sh-avatar" aria-hidden="true">
            {avatarLabel}
          </div>
          <div>
            <h1 className="sh-name">{user.display_name}</h1>
            <div className="sh-meta">
              <span className="sh-class">{user.class_name ? `${user.class_name} 수강반` : "수강반 미지정"}</span>
              <span className="sh-desc">Academy Dashboard</span>
            </div>
            <div className="sh-actions">
              <button className="btn btn-primary btn-sm" onClick={onGoProblems}>
                문제 풀러 가기
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onGoAssignments}>
                내 과제 보기
              </button>
            </div>
          </div>
        </div>

        <div className="sh-stats">
          <article className="sh-stat">
            <div className="sh-stat-label">해결한 문제</div>
            <div className="sh-stat-value">
              {solved}
              <span className="sh-stat-sub">/{totalProblems}</span>
            </div>
            <div className="sh-stat-hint">전체의 {overallPct}%를 완료했어요.</div>
            <div className="sh-stat-bar">
              <div className="sh-stat-bar-fill" style={{ width: `${overallPct}%` }} />
            </div>
          </article>

          <article className="sh-stat">
            <div className="sh-stat-label">정답률</div>
            <div className="sh-stat-value">
              {accuracy}
              <span className="sh-stat-sub">%</span>
            </div>
            <div className="sh-stat-hint">총 {attempts}회 제출</div>
            <div className="sh-stat-bar">
              <div className="sh-stat-bar-fill sh-stat-bar-fill-ok" style={{ width: `${accuracy}%` }} />
            </div>
          </article>

          <article className="sh-stat">
            <div className="sh-stat-label">연속 풀이</div>
            <div className="sh-stat-value">
              {streak}
              <span className="sh-stat-sub">일</span>
            </div>
            <div className="sh-stat-hint">최근 30일 중 {metrics?.activeDays ?? 0}일 활동</div>
          </article>

          <article className="sh-stat">
            <div className="sh-stat-label">대기 과제</div>
            <div className="sh-stat-value">
              {pendingAssignments.length}
              <span className="sh-stat-sub">건</span>
            </div>
            <div className="sh-stat-hint">
              {dueSoonCount > 0 ? `오늘 전후 마감 ${dueSoonCount}건` : "가까운 마감 일정이 없어요."}
            </div>
          </article>
        </div>
      </header>

      <section className="sh-heat">
        <div className="sh-heat-head">
          <h2>최근 30일 풀이 흐름</h2>
          <span className="sh-heat-meta">
            활동일 {metrics?.activeDays ?? 0}일 · 정답 {metrics?.last30Solved ?? 0}개
          </span>
        </div>
        <div className="sh-heat-strip">
          {activity.map((day, index) => (
            <div
              key={index}
              className={`sh-heat-cell sh-heat-${intensity(day.accepted)}`}
              title={`${day.date.getMonth() + 1}/${day.date.getDate()} · 제출 ${day.submitted} · 정답 ${day.accepted}`}
            />
          ))}
        </div>
        <div className="sh-heat-legend">
          <span>적음</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className={`sh-heat-cell sh-heat-${level}`} />
          ))}
          <span>많음</span>
        </div>
      </section>

      <div className="sh-grid">
        <section className="sh-panel">
          <header className="sh-panel-head">
            <h2>추천 문제</h2>
            <button className="sh-link" onClick={onGoProblems}>
              전체 문제 보기 →
            </button>
          </header>
          {recommended.length === 0 ? (
            <p className="sh-empty">풀지 않은 추천 문제가 없어요. 지금 흐름을 아주 잘 타고 있어요.</p>
          ) : (
            <table className="data-table compact sh-table">
              <thead>
                <tr>
                  <th className="mono">#</th>
                  <th>문제</th>
                  <th>난이도</th>
                  <th>분류</th>
                </tr>
              </thead>
              <tbody>
                {recommended.map((problem) => (
                  <tr key={problem.id} className="clickable" onClick={() => onOpenProblem(problem.id)}>
                    <td className="mono sh-table-id">#{problem.id}</td>
                    <td>
                      <strong>{problem.title}</strong>
                      <div className="sh-table-sub">{problem.short_description}</div>
                    </td>
                    <td>
                      <DifficultyBadge level={problem.difficulty} />
                    </td>
                    <td>
                      <span className="chip">{problem.category_name}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="sh-side-stack">
          <section className="sh-panel">
            <header className="sh-panel-head">
              <h2>진행 중인 과제</h2>
              <button className="sh-link" onClick={onGoAssignments}>
                과제 전체 →
              </button>
            </header>
            {pending.length === 0 ? (
              <p className="sh-empty">진행 중인 과제가 없어요. 추천 문제를 풀면서 리듬을 이어가 보세요.</p>
            ) : (
              <ul className="sh-alist">
                {pending.map((assignment) => {
                  const due = dueLabel(assignment.due_at);
                  return (
                    <li key={assignment.id} onClick={() => onOpenProblem(assignment.problem_id)}>
                      <div className="sh-alist-main">
                        <strong>{assignment.problem_title}</strong>
                        <span className="sh-alist-sub">
                          {assignment.title} · {assignment.assignment_type === "homework" ? "숙제" : "수업"}
                        </span>
                      </div>
                      <span className={due.urgent ? "sh-alist-due" : "sh-alist-date"}>{due.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sh-panel">
            <header className="sh-panel-head">
              <h2>문제 풀이 순위</h2>
              <span className="sh-panel-meta">입문 1점 · 기초 3점 · 응용 5점</span>
            </header>
            {leaderboard.length === 0 ? (
              <p className="sh-empty">아직 집계할 풀이 기록이 없어요.</p>
            ) : (
              <>
                <div className="sh-rank-table-wrap">
                  <table className="sh-rank-table">
                    <thead>
                      <tr>
                        <th className="sh-rank-col-rank">순위</th>
                        <th>학생</th>
                        <th className="sh-rank-col-num">점수</th>
                        <th className="sh-rank-col-num">정답률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLeaderboard.map((entry) => {
                        const isMe = entry.student_id === user.id;
                        return (
                          <tr key={entry.student_id} className={isMe ? "sh-rank-row sh-rank-row-me" : "sh-rank-row"}>
                            <td className="sh-rank-col-rank">
                              <span className={`sh-rank-badge sh-rank-badge-${entry.rank <= 3 ? entry.rank : "normal"}`}>
                                {entry.rank}
                              </span>
                            </td>
                            <td>
                              <div className="sh-rank-name">
                                <strong>{entry.student_name}</strong>
                                {isMe && <span className="sh-rank-me-tag">나</span>}
                              </div>
                              {entry.class_name && <span className="sh-rank-sub">{entry.class_name}</span>}
                            </td>
                            <td className="sh-rank-col-num mono">{entry.score}</td>
                            <td className="sh-rank-col-num mono">{entry.accuracy}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {myRank && myRank.rank > topLeaderboard.length && (
                  <div className="sh-rank-self">
                    <span className="sh-rank-self-label">내 순위</span>
                    <span className="sh-rank-self-rank">{myRank.rank}위</span>
                    <span className="sh-rank-self-score mono">
                      {myRank.score}점 · 정답률 {myRank.accuracy}%
                    </span>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <section className="sh-panel sh-radar-panel">
        <header className="sh-panel-head">
          <h2>알고리즘별 풀이 완료 현황</h2>
          <span className="sh-panel-meta">알고리즘별 풀이 퍼센티지</span>
        </header>
        {radarRows.length === 0 ? (
          <p className="sh-empty">아직 분류별 풀이 기록이 없어요.</p>
        ) : (
          <div className="sh-radar-wrap">
            <div className="sh-radar-card">
              <div className="sh-radar-summary">
                <span>
                  <strong>{radarAveragePct}%</strong>
                  평균 완료율
                </span>
                <span>
                  <strong>{radarTotalSolved}</strong>
                  해결 문제
                </span>
                <span>
                  <strong>{strongestRadarRow?.name ?? "-"}</strong>
                  강한 분류
                </span>
              </div>
              <div className="sh-radar-chart">
                <svg viewBox={`-56 -18 ${radarSize + 112} ${radarSize + 36}`} className="sh-radar-svg" role="img" aria-label="알고리즘별 풀이 퍼센트 분포">
                  <circle cx={radarCenter} cy={radarCenter} r={radarRadius + 10} className="sh-radar-halo" />
                  {radarGridRings.map((points, index) => (
                    <polygon key={index} points={points} className="sh-radar-ring" />
                  ))}
                  {radarAxisPoints.map((axis) => (
                    <line key={axis.row.name} x1={radarCenter} y1={radarCenter} x2={axis.end.x} y2={axis.end.y} className="sh-radar-axis" />
                  ))}
                  <polygon points={radarPolygon} className="sh-radar-fill" />
                  <polygon points={radarPolygon} className="sh-radar-stroke" />
                  {radarAxisPoints.map((axis) => {
                    const isTopLabel = axis.label.y < radarCenter && Math.abs(axis.label.x - radarCenter) < 8;
                    const labelY = axis.label.y + (isTopLabel ? -14 : 0);
                    const anchor = axis.label.x < radarCenter - 8 ? "end" : axis.label.x > radarCenter + 8 ? "start" : "middle";

                    return (
                      <g key={`${axis.row.name}-label`}>
                        <circle
                          cx={radarCenter + (axis.end.x - radarCenter) * (axis.row.pct / 100)}
                          cy={radarCenter + (axis.end.y - radarCenter) * (axis.row.pct / 100)}
                          r="3.2"
                          className="sh-radar-dot"
                        />
                        <text
                          x={axis.label.x}
                          y={labelY}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          className="sh-radar-label"
                        >
                          {axis.row.name}
                        </text>
                        <text
                          x={axis.label.x}
                          y={labelY + 12}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          className="sh-radar-label-pct"
                        >
                          {axis.row.pct}%
                        </text>
                      </g>
                    );
                  })}
                  <circle cx={radarCenter} cy={radarCenter} r="20" className="sh-radar-center" />
                  <text x={radarCenter} y={radarCenter - 2} textAnchor="middle" className="sh-radar-center-num">
                    {radarTotalSolved}
                  </text>
                  <text x={radarCenter} y={radarCenter + 10} textAnchor="middle" className="sh-radar-center-label">
                    완료
                  </text>
                </svg>
              </div>
            </div>
            <ul className="sh-radar-list">
              {radarRows.map((row, index) => (
                <li key={row.name}>
                  <span className="sh-radar-list-rank">{index + 1}</span>
                  <span className="sh-radar-list-name">{row.name}</span>
                  <span className="sh-radar-list-count mono">
                    {row.solved}<span className="muted">/{row.total}</span>
                  </span>
                  <span className="sh-radar-list-pct mono">{row.pct}%</span>
                  <span className="sh-radar-list-bar">
                    <span style={{ width: `${row.pct}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

type TeacherMetrics = {
  todaySubmitted: number;
  todayAccepted: number;
  todayAccuracy: number;
  todayActiveStudents: number;
  last7Accepted: number;
  last30Accepted: number;
  activeDays: number;
  activity: { date: Date; submitted: number; accepted: number }[];
  topStudents: { id: number; submitted: number; accepted: number; solved: number }[];
};

function TeacherHome(props: {
  user: UserProfile;
  metrics: TeacherMetrics | null;
  dashboard: DashboardSummary | null;
  feed: SubmissionFeedItem[];
  highlightId: number | null;
  paused: boolean;
  onTogglePause: () => void;
  onOpenProblem: (id: number) => void;
  assignments: Assignment[];
  students: UserProfile[];
  onGoLive: () => void;
  onGoAssignments: () => void;
  onGoManage: () => void;
}) {
  const {
    user,
    metrics,
    dashboard,
    feed,
    highlightId,
    paused,
    onTogglePause,
    onOpenProblem,
    assignments,
    students,
    onGoLive,
    onGoAssignments,
    onGoManage,
  } = props;
  const recentAssignments = assignments.slice(0, 5);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const pendingAssignments = assignments.filter((a) => !a.submitted).length;
  const maxAccepted = metrics ? Math.max(1, ...metrics.activity.map((a) => a.accepted)) : 1;
  const intensity = (n: number) => {
    if (n === 0) return 0;
    if (n >= maxAccepted) return 4;
    const ratio = n / maxAccepted;
    if (ratio < 0.34) return 1;
    if (ratio < 0.67) return 2;
    return 3;
  };

  return (
    <div className="student-home">
      <header className="dash-welcome">
        <div className="dash-welcome-text">
          <span className="eyebrow muted">
            <span className={`live-dot ${paused ? "live-dot-paused" : ""}`} />
            {paused ? " 실시간 일시정지" : " 실시간 모니터링 중"}
          </span>
          <h1>
            {user.display_name}
            <span className="dash-welcome-suffix">강사님, 오늘 학원 풀이 흐름이 좋습니다</span>
          </h1>
          <p className="muted dash-welcome-sub">
            오늘 <strong>{metrics?.todayActiveStudents ?? 0}</strong>명이 활동 · 누적 수강생 {students.length}명 · 배정한
            과제 {dashboard?.assigned_count ?? 0}건
          </p>
        </div>
        <div className="dash-welcome-cta">
          <button className="btn btn-ghost" onClick={onGoLive}>
            실시간 채점 보기 →
          </button>
          <button className="btn btn-primary" onClick={onGoManage}>
            새 문제 만들기
          </button>
        </div>
      </header>

      <section className="metric-row">
        <article className="metric">
          <span className="metric-label">오늘 제출</span>
          <strong className="metric-value">
            {metrics?.todaySubmitted ?? 0}
            <span className="metric-of muted">건</span>
          </strong>
          <span className="metric-trend">정답 {metrics?.todayAccepted ?? 0}건</span>
        </article>
        <article className="metric">
          <span className="metric-label">오늘 정답률</span>
          <strong className="metric-value">
            {metrics?.todayAccuracy ?? 0}
            <span className="metric-of muted">%</span>
          </strong>
          <div className="metric-bar">
            <div className="metric-bar-fill metric-bar-accent" style={{ width: `${metrics?.todayAccuracy ?? 0}%` }} />
          </div>
        </article>
        <article className="metric">
          <span className="metric-label">활동 수강생</span>
          <strong className="metric-value">
            {metrics?.todayActiveStudents ?? 0}
            <span className="metric-of muted">/ {students.length}</span>
          </strong>
          <span className="metric-trend">주간 활동 {metrics?.topStudents.length ?? 0}명</span>
        </article>
        <article className="metric">
          <span className="metric-label">진행 중 과제</span>
          <strong className="metric-value">
            {pendingAssignments}
            <span className="metric-of muted">/ {assignments.length}</span>
          </strong>
          <span className="metric-trend">대기 vs 누적</span>
        </article>
      </section>

      <section className="home-section">
        <header className="home-section-head">
          <h2>
            실시간 제출 피드
            <span className="live-count">{feed.length}건 표시 중</span>
          </h2>
          <div className="form-actions">
            <button className="btn btn-ghost btn-sm" onClick={onTogglePause}>
              {paused ? "재개" : "일시정지"}
            </button>
            <button className="link" onClick={onGoLive}>
              전체 화면으로 보기 →
            </button>
          </div>
        </header>
        {feed.length === 0 ? (
          <p className="empty-inline">아직 들어온 제출이 없습니다. 수강생 제출을 기다리는 중...</p>
        ) : (
          <div className="feed-stream feed-stream-flat">
            {feed.slice(0, 12).map((item) => (
              <article
                key={item.id}
                className={`feed-row ${item.id === highlightId ? "feed-row-fresh" : ""}`}
                onClick={() => onOpenProblem(item.problem_id)}
              >
                <div className="feed-when">
                  <strong>{timeAgo(item.created_at)}</strong>
                  <span className="muted">{formatDate(item.created_at).slice(11)}</span>
                </div>
                <div className="feed-who">
                  <strong>{item.student_name}</strong>
                  <span className="muted">
                    {item.class_name ? `${item.class_name} · ` : ""}@{item.student_username}
                  </span>
                </div>
                <div className="feed-what">
                  <strong>{item.problem_title}</strong>
                  <span className="muted">{item.category_name}</span>
                </div>
                <div className="feed-verdict">
                  <StatusBadge status={item.status} />
                  <span className="muted mono">
                    {item.passed_tests}/{item.total_tests}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="growth-grid">
        <div className="home-section">
          <header className="home-section-head">
            <h2>30일 학원 활동</h2>
            <span className="muted small">
              지난 30일 중 <strong>{metrics?.activeDays ?? 0}일</strong> 활동 · 정답 {metrics?.last30Accepted ?? 0}건
            </span>
          </header>
          <div className="activity-strip">
            {metrics?.activity.map((day, i) => (
              <div
                key={i}
                className={`activity-cell activity-${intensity(day.accepted)}`}
                title={`${day.date.getMonth() + 1}/${day.date.getDate()} · 제출 ${day.submitted} · 정답 ${day.accepted}`}
              />
            ))}
          </div>
          <div className="activity-legend muted small">
            <span>적음</span>
            <span className="activity-cell activity-0" />
            <span className="activity-cell activity-1" />
            <span className="activity-cell activity-2" />
            <span className="activity-cell activity-3" />
            <span className="activity-cell activity-4" />
            <span>많음</span>
          </div>
        </div>

        <div className="home-section">
          <header className="home-section-head">
            <h2>이번 주 활약 수강생</h2>
            <span className="muted small">최근 7일 정답 기준</span>
          </header>
          {!metrics || metrics.topStudents.length === 0 ? (
            <p className="empty-inline">이번 주 활동한 수강생이 아직 없어요.</p>
          ) : (
            <ul className="top-student-list">
              {metrics.topStudents.map((row, i) => {
                const student = studentMap.get(row.id);
                const accuracy = row.submitted === 0 ? 0 : Math.round((row.accepted / row.submitted) * 100);
                return (
                  <li key={row.id} className="top-student-row">
                    <span className="top-rank mono">{i + 1}</span>
                    <div className="top-student-main">
                      <strong>{student?.display_name ?? `수강생 #${row.id}`}</strong>
                      <span className="muted">
                        {student?.class_name ? `${student.class_name} · ` : ""}해결한 문제 {row.solved}개
                      </span>
                    </div>
                    <div className="top-student-meta">
                      <span className="mono">{row.accepted}<span className="muted">/{row.submitted}</span></span>
                      <span className="mono muted">{accuracy}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="home-section">
        <header className="home-section-head">
          <h2>최근 배정한 과제</h2>
          <button className="link" onClick={onGoAssignments}>
            과제 관리 →
          </button>
        </header>
        {recentAssignments.length === 0 ? (
          <p className="empty-inline">아직 배정한 과제가 없습니다.</p>
        ) : (
          <ul className="clean-list">
            {recentAssignments.map((a) => (
              <li key={a.id} className="clean-list-item" onClick={() => onOpenProblem(a.problem_id)}>
                <div className="clean-list-main">
                  <strong>{a.problem_title}</strong>
                  <span className="muted">
                    {a.title} · {a.student_name} · {a.assignment_type === "homework" ? "숙제" : "수업"}
                  </span>
                </div>
                <span className={`verdict ${a.submitted ? "verdict-ok" : "verdict-neutral"}`}>
                  {a.submitted ? "제출 완료" : "대기 중"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TeacherHomeRedesign(props: {
  user: UserProfile;
  metrics: TeacherMetrics | null;
  dashboard: DashboardSummary | null;
  feed: SubmissionFeedItem[];
  highlightId: number | null;
  paused: boolean;
  onTogglePause: () => void;
  onOpenProblem: (id: number) => void;
  assignments: Assignment[];
  students: UserProfile[];
  onGoLive: () => void;
  onGoAssignments: () => void;
  onGoManage: () => void;
}) {
  const {
    user,
    metrics,
    dashboard,
    feed,
    highlightId,
    paused,
    onTogglePause,
    onOpenProblem,
    assignments,
    students,
    onGoLive,
    onGoAssignments,
    onGoManage,
  } = props;
  const myStudents = students.filter((s) => s.role === "student" && s.primary_teacher_id === user.id);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const pendingAssignments = assignments.filter((a) => !a.submitted).length;
  const assignmentGroups = Array.from(
    assignments
      .reduce((map, assignment) => {
        const student = studentMap.get(assignment.student_id);
        const classLabel = assignment.classroom_label ?? student?.class_name ?? "개별";
        const key = `${assignment.problem_id}::${assignment.title}::${classLabel}`;
        const current = map.get(key) ?? {
          key,
          problemId: assignment.problem_id,
          classLabel,
          title: assignment.title,
          problemTitle: assignment.problem_title,
          submitted: 0,
          total: 0,
          dueAt: assignment.due_at,
          assignmentType: assignment.assignment_type,
        };
        current.total += 1;
        if (assignment.submitted) current.submitted += 1;
        if (assignment.due_at && (!current.dueAt || new Date(assignment.due_at) < new Date(current.dueAt))) {
          current.dueAt = assignment.due_at;
        }
        map.set(key, current);
        return map;
      }, new Map<string, {
        key: string;
        problemId: number;
        classLabel: string;
        title: string;
        problemTitle: string;
        submitted: number;
        total: number;
        dueAt: string | null;
        assignmentType: AssignmentType;
      }>())
      .values(),
  ).slice(0, 4);
  const activity = metrics?.activity ?? [];
  const maxAccepted = activity.length ? Math.max(1, ...activity.map((a) => a.accepted)) : 1;
  const intensity = (n: number) => {
    if (n === 0) return 0;
    if (n >= maxAccepted) return 4;
    const ratio = n / maxAccepted;
    if (ratio < 0.34) return 1;
    if (ratio < 0.67) return 2;
    return 3;
  };

  return (
    <div className="teacher-home">
      <header className="th-header">
        <div className="th-header-left">
          <span className={`th-live-dot ${paused ? "paused" : ""}`} />
          <div>
            <div className="th-header-title">{user.display_name}, 안녕하세요</div>
            <div className="th-header-sub">
              오늘 <strong>{metrics?.todayActiveStudents ?? 0}명</strong>이 활동 중이고 총 학생{" "}
              <strong>{myStudents.length}명</strong>, 배정 과제는 <strong>{dashboard?.assigned_count ?? 0}건</strong>입니다.
            </div>
          </div>
        </div>
        <div className="th-header-acts">
          <button className="btn btn-ghost btn-sm" onClick={onTogglePause}>
            {paused ? "실시간 재개" : "실시간 일시정지"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={onGoLive}>
            채점 현황 보기
          </button>
          <button className="btn btn-primary btn-sm" onClick={onGoManage}>
            + 새 문제 추가
          </button>
        </div>
      </header>

      <section className="th-metrics">
        <article className="metric">
          <div className="metric-label">오늘 제출</div>
          <div className="metric-val">
            {metrics?.todaySubmitted ?? 0}
            <span className="metric-sub">건</span>
          </div>
          <div className="metric-hint">정답 {metrics?.todayAccepted ?? 0}건 포함</div>
        </article>
        <article className="metric">
          <div className="metric-label">오늘 정답률</div>
          <div className="metric-val">
            {metrics?.todayAccuracy ?? 0}
            <span className="metric-sub">%</span>
          </div>
          <div className="metric-hint">전체 제출 기준</div>
          <div className="metric-bar">
            <div className="metric-bar-fill" style={{ width: `${metrics?.todayAccuracy ?? 0}%` }} />
          </div>
        </article>
        <article className="metric">
          <div className="metric-label">활동 학생</div>
          <div className="metric-val">
            {metrics?.todayActiveStudents ?? 0}
            <span className="metric-sub">/ {myStudents.length}</span>
          </div>
          <div className="metric-hint">최근 7일 상위 활동 학생 {metrics?.topStudents.length ?? 0}명</div>
          <div className="metric-bar">
            <div
              className="metric-bar-fill metric-bar-accent"
              style={{
                width: `${myStudents.length === 0 ? 0 : Math.round(((metrics?.todayActiveStudents ?? 0) / myStudents.length) * 100)}%`,
              }}
            />
          </div>
        </article>
        <article className="metric">
          <div className="metric-label">미완료 과제</div>
          <div className="metric-val">
            {pendingAssignments}
            <span className="metric-sub">건</span>
          </div>
          <div className="metric-hint">전체 과제 {assignments.length}건 기준</div>
        </article>
      </section>

      <div className="th-grid-main">
        <section className="card feed-wrap">
          <div className="panel-head">
            <h2>
              <span className={`th-live-dot ${paused ? "paused" : ""}`} />
              실시간 제출 피드
              <span className="panel-count">{feed.length}건</span>
            </h2>
            <button className="panel-link" onClick={onGoLive}>
              전체 화면 보기
            </button>
          </div>
          {feed.length === 0 ? (
            <p className="th-empty">아직 들어온 제출이 없습니다. 학생들의 첫 시도를 기다리는 중입니다.</p>
          ) : (
            <ul className="feed-list">
              {feed.slice(0, 12).map((item) => (
                <li
                  key={item.id}
                  className={`feed-row ${item.id === highlightId ? "fresh" : ""}`}
                  onClick={() => onOpenProblem(item.problem_id)}
                >
                  <div className="feed-time">{timeAgo(item.created_at)}</div>
                  <div className="feed-who">
                    <strong>{item.student_name}</strong>
                    <span>{item.class_name ? `${item.class_name} · ` : ""}@{item.student_username}</span>
                  </div>
                  <div className="feed-prob">
                    <strong>{item.problem_title}</strong>
                    <span>{item.category_name}</span>
                  </div>
                  <div className="feed-verdict">
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="feed-tests">{item.passed_tests}/{item.total_tests}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="panel-head">
            <h2>이번 주 상위 학생</h2>
            <span className="muted">최근 7일 정답 기준</span>
          </div>
          {!metrics || metrics.topStudents.length === 0 ? (
            <p className="th-empty">이번 주 활동 데이터가 아직 충분하지 않습니다.</p>
          ) : (
            <ul className="ts-list">
              {metrics.topStudents.map((row, i) => {
                const student = studentMap.get(row.id);
                const accuracy = row.submitted === 0 ? 0 : Math.round((row.accepted / row.submitted) * 100);
                return (
                  <li key={row.id} className="ts-row">
                    <div className="ts-rank">{i + 1}</div>
                    <div className="ts-main">
                      <strong>{student?.display_name ?? `학생 #${row.id}`}</strong>
                      <span>{student?.class_name ?? "반 정보 없음"}</span>
                    </div>
                    <div className="ts-meta">
                      <strong>{row.solved}문제</strong>
                      <span>정답률 {accuracy}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* 
        {/* <section className="card">
          <div className="panel-head">
            <h2>30일 활동 히트맵</h2>
            <span className="muted">활동일 {metrics?.activeDays ?? 0}일</span>
          </div>
          <div className="heat-body">
            <div className="heat-strip">
              {activity.map((day, i) => (
                <div
                  key={i}
                  className={`hc hc-${intensity(day.accepted)}`}
                  title={`${day.date.getMonth() + 1}/${day.date.getDate()} · 제출 ${day.submitted} · 정답 ${day.accepted}`}
                />
              ))}
            </div>
            <div className="heat-legend">
              적음
              {[0, 1, 2, 3, 4].map((level) => (
                <div key={level} className={`hc hc-${level}`} />
              ))}
              많음
            </div>
          </div>
        </section> */}

        <section className="card">
          <div className="panel-head">
            <h2>과제 진행 현황</h2>
            <button className="panel-link" onClick={onGoAssignments}>
              과제 관리하기
            </button>
          </div>
          {assignmentGroups.length === 0 ? (
            <p className="th-empty">표시할 과제가 아직 없습니다.</p>
          ) : (
            <ul className="asn-list">
              {assignmentGroups.map((assignment) => {
                const pct = assignment.total === 0 ? 0 : Math.round((assignment.submitted / assignment.total) * 100);
                const tone = pct === 100 ? "ok" : pct >= 50 ? "mid" : "low";
                return (
                  <li key={assignment.key} className="asn-row" onClick={() => onOpenProblem(assignment.problemId)}>
                    <div className="asn-main">
                      <strong>
                        <span className="cls-chip">{assignment.classLabel}</span>
                        {assignment.problemTitle}
                      </strong>
                      <span>
                        {assignment.title}
                        {assignment.dueAt ? ` · 마감 ${formatDate(assignment.dueAt)}` : ""}
                        {assignment.assignmentType === "classroom" ? " · 수업용" : " · 숙제"}
                      </span>
                    </div>
                    <div className="asn-prog">
                      <div className={`asn-pbar asn-pbar-${tone}`}>
                        <div className="asn-pfill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="asn-pmeta">
                        <strong>{pct}%</strong>
                        <span>{assignment.submitted}/{assignment.total}명</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    
  );
}

function LiveFeedView(props: {
  feed: SubmissionFeedItem[];
  highlightId: number | null;
  paused: boolean;
  onTogglePause: () => void;
  onOpenProblem: (id: number) => void;
}) {
  const { feed, highlightId, paused, onTogglePause, onOpenProblem } = props;
  return (
    <div className="page-stack list-page">
      <header className="page-head page-head-tight">
        <div>
          <h1 className="live-feed-title">
            <span className={`live-dot ${paused ? "live-dot-paused" : ""}`} />
            실시간 채점 피드
          </h1>
          <p className="muted">
            수강생들이 지금 코드를 채점하는 흐름을 그대로 볼 수 있어요. 클릭하면 해당 문제로 이동합니다.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onTogglePause}>
          {paused ? "재개" : "일시정지"}
        </button>
      </header>
      <section className="card">
      {feed.length === 0 ? (
        <div className="empty">아직 들어온 제출이 없습니다.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>제출</th>
              <th>수강생</th>
              <th>문제</th>
              <th>결과</th>
              <th>테스트</th>
              <th>시간</th>
            </tr>
          </thead>
          <tbody>
            {feed.map((item) => (
              <tr
                key={item.id}
                className={`clickable ${item.id === highlightId ? "row-fresh" : ""}`}
                onClick={() => onOpenProblem(item.problem_id)}
              >
                <td className="muted">{formatDate(toUTC(item.created_at))}</td>
                <td>
                  <strong>{item.student_name}</strong>
                  {item.class_name && <span className="muted"> · {item.class_name}</span>}
                </td>
                <td>
                  <strong>{item.problem_title}</strong>
                  <span className="muted"> · {item.category_name}</span>
                </td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td className="mono">
                  {item.passed_tests}/{item.total_tests}
                </td>
                <td className="mono muted">{item.runtime_ms}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </section>
    </div>
  );
}

function ProblemListView(props: {
  problems: ProblemCard[];
  categories: Category[];
  categoryFilter: number | "all";
  difficultyFilter: Difficulty | "all";
  problemFilter: string;
  onSearch: (s: string) => void;
  onCategory: (c: number | "all") => void;
  onDifficulty: (d: Difficulty | "all") => void;
  onOpen: (id: number) => void;
  onEditProblem: (id: number) => void;
  onDeleteProblems: (ids: number[]) => void;
  submissions: Submission[];
  userRole: UserRole;
}) {
  const {
    problems,
    categories,
    categoryFilter,
    difficultyFilter,
    problemFilter,
    onSearch,
    onCategory,
    onDifficulty,
    onOpen,
    onEditProblem,
    onDeleteProblems,
    submissions,
    userRole,
  } = props;
  const solvedSet = new Set(submissions.filter((s) => s.status === "accepted").map((s) => s.problem_id));
  const pageSize = 12;
  const [page, setPage] = useState(1);
  const [selectedProblemIds, setSelectedProblemIds] = useState<number[]>([]);
  const totalPages = Math.max(1, Math.ceil(problems.length / pageSize));
  const visibleProblems = useMemo(() => problems.slice((page - 1) * pageSize, page * pageSize), [page, problems]);
  const visibleIds = visibleProblems.map((problem) => problem.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProblemIds.includes(id));

  useEffect(() => {
    setPage(1);
    setSelectedProblemIds([]);
  }, [problemFilter, categoryFilter, difficultyFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function toggleProblem(problemId: number) {
    setSelectedProblemIds((current) =>
      current.includes(problemId) ? current.filter((id) => id !== problemId) : [...current, problemId],
    );
  }

  function toggleVisibleProblems() {
    setSelectedProblemIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  return (
    <div className="page-stack list-page">
      <header className="page-head page-head-tight">
        <div>
          <h1>문제</h1>
          <p className="muted">알고리즘 분류와 난이도로 좁혀서 풀 문제를 찾아보세요.</p>
        </div>
        <input
          className="search"
          placeholder="문제 번호, 제목, 키워드 검색"
          value={problemFilter}
          onChange={(e) => onSearch(e.target.value)}
        />
      </header>

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">분류</span>
          <button className={`chip ${categoryFilter === "all" ? "chip-active" : ""}`} onClick={() => onCategory("all")}>
            전체
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${categoryFilter === c.id ? "chip-active" : ""}`}
              onClick={() => onCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">난이도</span>
          {(["all", "beginner", "basic", "intermediate"] as const).map((d) => (
            <button
              key={d}
              className={`chip ${difficultyFilter === d ? "chip-active" : ""}`}
              onClick={() => onDifficulty(d)}
            >
              {d === "all" ? "전체" : difficultyLabel(d)}
            </button>
          ))}
        </div>
      </div>

      {userRole === "teacher" && (
        <div className="problem-admin-toolbar">
          <div>
            <strong>{selectedProblemIds.length}</strong>
            <span>개 선택됨</span>
          </div>
          <div className="problem-admin-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedProblemIds([])}
              disabled={selectedProblemIds.length === 0}
            >
              선택 해제
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => onDeleteProblems(selectedProblemIds)}
              disabled={selectedProblemIds.length === 0}
            >
              선택 삭제
            </button>
          </div>
        </div>
      )}

      <table className="data-table problem-table">
        <thead>
          <tr>
            {userRole === "teacher" && (
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="현재 페이지 문제 전체 선택"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleProblems}
                />
              </th>
            )}
            <th className="col-num">#</th>
            <th>분류</th>
            <th>제목</th>
            <th>난이도</th>
            <th className="col-time">시간 제한</th>
            <th>상태</th>
            {userRole === "teacher" && <th className="col-actions">관리</th>}
          </tr>
        </thead>
        <tbody>
          {problems.length === 0 && (
            <tr>
              <td colSpan={userRole === "teacher" ? 8 : 6} className="empty-cell">조건에 맞는 문제가 없습니다.</td>
            </tr>
          )}
          {visibleProblems.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => onOpen(p.id)}>
              {userRole === "teacher" && (
                <td className="col-check" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${p.title} 선택`}
                    checked={selectedProblemIds.includes(p.id)}
                    onChange={() => toggleProblem(p.id)}
                  />
                </td>
              )}
              <td className="mono muted">{p.id}</td>
              <td>
                <span className="chip chip-soft">{p.category_name}</span>
              </td>
              <td>
                <strong>{p.title}</strong>
                <p className="muted oneline">{p.short_description}</p>
              </td>
              <td>
                <DifficultyBadge level={p.difficulty} />
              </td>
              <td className="mono">{p.time_limit_seconds.toFixed(1)}s</td>
              <td>
                {solvedSet.has(p.id) ? (
                  <span className="verdict verdict-ok">해결</span>
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
              {userRole === "teacher" && (
                <td className="problem-row-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEditProblem(p.id)}>
                    수정
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onDeleteProblems([p.id])}>
                    삭제
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {problems.length > 0 && (
        <div className="pagination-bar">
          <div className="pagination-meta muted">
            총 {problems.length}문제 · {page}/{totalPages} 페이지
          </div>
          <div className="pagination-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              이전
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                className={pageNumber === page ? "page-chip page-chip-active" : "page-chip"}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SolveView(props: {
  user: UserProfile;
  problem: ProblemDetail | null;
  problemId: number | null;
  code: string;
  onChangeCode: (s: string) => void;
  onRun: () => void;
  onSubmit: () => void;
  isRunning: boolean;
  stream: StreamState | null;
  submissions: Submission[];
  assignments: Assignment[];
  pane: "problem" | "history";
  setPane: (p: "problem" | "history") => void;
  onEditProblem: () => void;
  popupMode: boolean;
  onOpenWindow: () => void;
  language: "python" | "c";
  onChangeLanguage: (lang: "python" | "c") => void;
}) {
  const {
    user,
    problem,
    problemId,
    code,
    onChangeCode,
    onRun,
    onSubmit,
    isRunning,
    stream,
    submissions,
    assignments,
    pane,
    setPane,
    onEditProblem,
    popupMode,
    onOpenWindow,
    language,
    onChangeLanguage,
  } = props;
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [leftPanelPct, setLeftPanelPct] = useState(() => {
    if (typeof window === "undefined") return 43;
    const saved = Number(localStorage.getItem("starlab-solve-left-panel-pct"));
    return Number.isFinite(saved) && saved >= 28 && saved <= 68 ? saved : 43;
  });
  const [isResizing, setIsResizing] = useState(false);
  const selectedSubmission =
    submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0] ?? null;
  const selectedCodeLines = selectedSubmission?.code.split("\n") ?? [];
  const selectedLanguage: "python" | "c" = selectedSubmission?.language === "c" ? "c" : "python";

  useEffect(() => {
    if (submissions.length === 0) {
      setSelectedSubmissionId(null);
      return;
    }
    if (!submissions.some((submission) => submission.id === selectedSubmissionId)) {
      setSelectedSubmissionId(submissions[0].id);
    }
  }, [selectedSubmissionId, submissions]);

  if (!problem) {
    if (problemId) {
      return <div className="empty card">문제를 불러오는 중입니다…</div>;
    }
    return <div className="empty card">문제를 선택해주세요. 좌측 메뉴 [문제]에서 풀고 싶은 문제를 고를 수 있어요.</div>;
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!shellRef.current) return;
    event.preventDefault();
    setIsResizing(true);
    const shell = shellRef.current;
    const rect = shell.getBoundingClientRect();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    function update(clientX: number) {
      const next = ((clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(68, Math.max(28, next));
      setLeftPanelPct(clamped);
      localStorage.setItem("starlab-solve-left-panel-pct", clamped.toFixed(1));
    }

    function onPointerMove(moveEvent: PointerEvent) {
      update(moveEvent.clientX);
    }

    function onPointerUp() {
      setIsResizing(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  const currentAssignment = assignments[0] ?? null;
  return (
    <div
      className={`sv-shell ${popupMode ? "sv-shell-editor" : ""} ${isResizing ? "sv-resizing" : ""}`}
      ref={shellRef}
    >
      <section className="sv-left" style={{ width: `${leftPanelPct}%` }}>
        <div className="sv-prob-hdr">
          <div className="sv-pnum">
            <span className="mono">#{problem.id}</span>
            <DifficultyBadge level={problem.difficulty} />
            <span className="chip">{problem.category_name}</span>
          </div>
          <div className="sv-ptitle">{problem.title}</div>
          <div className="sv-plimits">
            <span className="sv-plimit">시간 제한 {problem.time_limit_seconds.toFixed(1)}초</span>
            <span className="sv-plimit">메모리 {problem.memory_limit_mb}MB</span>
          </div>
          {user.role === "teacher" && (
            <div className="sv-prob-actions">
              <button className="btn btn-ghost btn-sm" onClick={onEditProblem}>
                이 문제 수정
              </button>
            </div>
          )}
        </div>

        <div className="sv-tabs">
          <button className={pane === "problem" ? "sv-tab on" : "sv-tab"} onClick={() => setPane("problem")}>
            문제
          </button>
          <button className={pane === "history" ? "sv-tab on" : "sv-tab"} onClick={() => setPane("history")}>
            내 제출 ({submissions.length})
          </button>
        </div>

        {pane === "problem" && (
          <div className="sv-body">
            <section className="sv-sec">
              <div className="sv-seclabel">문제 설명</div>
              <p>{problem.statement}</p>
            </section>
            <section className="sv-sec">
              <div className="sv-seclabel">입력</div>
              <p>{problem.input_description || "표준 입력을 사용합니다."}</p>
            </section>
            <section className="sv-sec">
              <div className="sv-seclabel">출력</div>
              <p>{problem.output_description || "표준 출력으로 결과를 출력합니다."}</p>
            </section>
            {problem.constraints && (
              <section className="sv-sec">
                <div className="sv-seclabel">제한사항</div>
                <p>{problem.constraints}</p>
              </section>
            )}
            <section className="sv-sec">
              <div className="sv-seclabel">예제</div>
              <div className="sv-sample">
                <div className="sv-sblk">
                  <div className="sv-sblk-label">입력</div>
                  <pre className="sv-code">{problem.sample_input || "예제가 없습니다."}</pre>
                </div>
                <div className="sv-sblk">
                  <div className="sv-sblk-label">출력</div>
                  <pre className="sv-code">{problem.sample_output || "예제가 없습니다."}</pre>
                </div>
              </div>
            </section>
            {currentAssignment && (
              <div className="sv-assigned">
                이 문제는 "{currentAssignment.title}" 과제로 배정되어 있습니다.
              </div>
            )}
          </div>
        )}

        {pane === "history" && (
          <div className="sv-hist">
            {submissions.length === 0 ? (
              <div className="empty">아직 이 문제에 대한 제출이 없습니다.</div>
            ) : (
              <table className="sv-hist-table">
                <thead>
                  <tr>
                    <th>결과</th>
                    <th>테스트</th>
                    <th>시간</th>
                    <th>제출일</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr
                      key={s.id}
                      className={selectedSubmission?.id === s.id ? "sel clickable" : "clickable"}
                      onClick={() => {
                        setSelectedSubmissionId(s.id);
                        setCodeModalOpen(true);
                      }}
                    >
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="mono">
                        {s.passed_tests}/{s.total_tests}
                      </td>
                      <td className="mono muted">{s.runtime_ms}ms</td>
                      <td className="muted">{formatDate(toUTC(s.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <button
        type="button"
        className="sv-resizer"
        onPointerDown={beginResize}
        aria-label="문제와 코드 에디터 영역 비율 조절"
        title="좌우로 드래그해 문제/코드 영역 비율을 조절"
      >
        <span />
      </button>

      <section className="sv-right">
        <div className="sv-ed-chrome">
          <div className="sv-lang">
            <button
              className={`lang-tab${language === "python" ? " lang-tab-active" : ""}`}
              onClick={() => onChangeLanguage("python")}
            >
              Python 3
            </button>
            <button
              className={`lang-tab${language === "c" ? " lang-tab-active" : ""}`}
              onClick={() => onChangeLanguage("c")}
            >
              C
            </button>
          </div>
          <div className="sv-ed-btns">
            {popupMode ? (
              <button className="btn btn-g btn-sm" onClick={() => window.close()}>
                탭 닫기
              </button>
            ) : (
              <button className="btn btn-g btn-sm" onClick={onOpenWindow}>
                새 탭으로 열기
              </button>
            )}
            <button className="btn btn-run btn-sm" onClick={onRun} disabled={isRunning}>
              {isRunning ? "실행 중..." : "예제 실행"}
            </button>
            <button className="btn btn-submit btn-sm" onClick={onSubmit} disabled={isRunning}>
              제출
            </button>
          </div>
        </div>

        <div className="sv-editor-surface">
          <CodeEditor value={code} onChange={onChangeCode} language={language} />
        </div>

        {stream && <GradingPanel stream={stream} isRunning={isRunning} />}
      </section>

      {codeModalOpen && selectedSubmission && createPortal(
        <div className="submission-modal-backdrop" onClick={() => setCodeModalOpen(false)}>
          <article className="submission-code-mockup submission-code-modal" onClick={(e) => e.stopPropagation()}>
            <header className="submission-code-mockup-head">
              <div>
                <strong>{problem.title}</strong>
                <p className="muted">{formatDate(toUTC(selectedSubmission.created_at))}</p>
              </div>
              <div className="submission-code-meta">
                <StatusBadge status={selectedSubmission.status} />
                <span className="mono muted">
                  {selectedSubmission.passed_tests}/{selectedSubmission.total_tests}
                </span>
                <button
                  type="button"
                  className="submission-modal-close"
                  onClick={() => setCodeModalOpen(false)}
                  aria-label="제출 코드 닫기"
                >
                  x
                </button>
              </div>
            </header>
            <div className="submission-code-frame">
              <pre className="submission-line-nums" aria-hidden="true">
                {selectedCodeLines.map((_, index) => (
                  <Fragment key={index}>{index + 1}{index < selectedCodeLines.length - 1 ? "\n" : ""}</Fragment>
                ))}
              </pre>
              <pre className="submission-code-preview">
                {renderHighlightedCode(selectedSubmission.code, selectedLanguage)}
              </pre>
            </div>
          </article>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ConfirmDialogModal({
  dialog,
  onClose,
}: {
  dialog: ConfirmDialogConfig;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await dialog.onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="confirm-backdrop" role="presentation" onClick={onClose}>
      <article className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <span className={`confirm-icon ${dialog.tone === "danger" ? "confirm-icon-danger" : ""}`} aria-hidden="true">
            !
          </span>
          <div>
            <h2 id="confirm-title">{dialog.title}</h2>
            <p>{dialog.body}</p>
          </div>
        </header>
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            {dialog.cancelLabel ?? "취소"}
          </button>
          <button
            type="button"
            className={dialog.tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => void confirm()}
            disabled={submitting}
          >
            {submitting ? "처리 중..." : dialog.confirmLabel}
          </button>
        </div>
      </article>
    </div>,
    document.body,
  );
}

function StudentMoveModal({
  student,
  teachers,
  currentUser,
  onClose,
  onSubmit,
}: {
  student: UserProfile;
  teachers: UserProfile[];
  currentUser: UserProfile;
  onClose: () => void;
  onSubmit: (draft: StudentMoveDraft) => void;
}) {
  const teacherOptions = teachers.length > 0 ? teachers : [currentUser];
  const initialTeacherId =
    student.primary_teacher_id && teacherOptions.some((teacher) => teacher.id === student.primary_teacher_id)
      ? student.primary_teacher_id
      : teacherOptions[0]?.id ?? currentUser.id;
  const [draft, setDraft] = useState<StudentMoveDraft>({
    teacher_id: initialTeacherId,
    class_name: student.class_name ?? "",
  });
  const canSubmit = draft.teacher_id > 0 && draft.class_name.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(draft);
  }

  return createPortal(
    <div className="floating-backdrop" role="presentation" onClick={onClose}>
      <form className="floating-panel student-move-panel" role="dialog" aria-modal="true" aria-labelledby="student-move-title" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="student-move-title">학생 반 이동</h2>
            <p>{student.display_name} 학생의 담당 선생님과 반 이름을 지정합니다.</p>
          </div>
          <button type="button" className="submission-modal-close" onClick={onClose} aria-label="닫기">
            x
          </button>
        </header>
        <label>
          <span>담당 선생님</span>
          <select
            value={draft.teacher_id}
            onChange={(event) => setDraft((current) => ({ ...current, teacher_id: Number(event.target.value) }))}
          >
            {teacherOptions.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>반 이름(시간대)</span>
          <input
            value={draft.class_name}
            onChange={(event) => setDraft((current) => ({ ...current, class_name: event.target.value }))}
            placeholder="예: 토11시 / 금2시 (띄어쓰기 주의)"
            autoFocus
          />
        </label>
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            이동 적용
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function AccountsView(props: {
  user: UserProfile;
  teachers: UserProfile[];
  students: UserProfile[];
  teacherCreateDraft: TeacherAccountDraft;
  setTeacherCreateDraft: React.Dispatch<React.SetStateAction<TeacherAccountDraft>>;
  studentCreateDraft: StudentAccountDraft;
  setStudentCreateDraft: React.Dispatch<React.SetStateAction<StudentAccountDraft>>;
  onCreateTeacher: (e: FormEvent) => void;
  onCreateStudent: (e: FormEvent) => void;
  onDeleteTeacher: (teacherId: number) => void;
  onDeleteStudent: (studentId: number) => void;
  onMoveStudent: (studentId: number, teacherId: number, className: string) => void;
}) {
  const {
    teachers,
    user,
    students,
    teacherCreateDraft,
    setTeacherCreateDraft,
    studentCreateDraft,
    setStudentCreateDraft,
    onCreateTeacher,
    onCreateStudent,
    onDeleteTeacher,
    onDeleteStudent,
    onMoveStudent,
  } = props;

  const [activeTab, setActiveTab] = useState<"teacher" | "student">("teacher");
  const [movingStudent, setMovingStudent] = useState<UserProfile | null>(null);

  const studentsByClass = useMemo(() => {
    const map = new Map<string, UserProfile[]>();
    for (const student of students) {
      if (student.role !== "student") continue;
      const key = (student.class_name ?? "").trim() || "반 미지정";
      const bucket = map.get(key) ?? [];
      bucket.push(student);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [students]);

  return (
    <div className="page-stack list-page">
      <header className="page-head page-head-tight">
        <div>
          <h1>계정 관리</h1>
          <p className="muted">
            선생님 계정과 학생 계정을 탭에서 따로 관리할 수 있어요. 같은 메인 선생님으로 묶인 조직만 노출됩니다.
          </p>
        </div>
        <div className="account-admin-summary">
          <span className="summary-pill">
            <span className="muted small">선생님</span>
            <strong>{teachers.length}</strong>
          </span>
          <span className="summary-pill">
            <span className="muted small">내 학생</span>
            <strong>{studentsByClass.reduce((sum, [, list]) => sum + list.length, 0)}</strong>
          </span>
        </div>
      </header>

      <div className="auth-role-tabs accounts-tabs">
        <button
          type="button"
          className={activeTab === "teacher" ? "auth-role-tab auth-role-tab-active" : "auth-role-tab"}
          onClick={() => setActiveTab("teacher")}
        >
          선생님 계정 ({teachers.length})
        </button>
        <button
          type="button"
          className={activeTab === "student" ? "auth-role-tab auth-role-tab-active" : "auth-role-tab"}
          onClick={() => setActiveTab("student")}
        >
          학생 계정 ({studentsByClass.reduce((sum, [, list]) => sum + list.length, 0)})
        </button>
      </div>

      {activeTab === "teacher" && (
        <section className="card account-admin">
          <header className="card-head">
            <div>
              <h2>선생님 계정</h2>
              <p className="muted">추가한 선생님은 같은 메인 선생님 조직으로 묶입니다.</p>
            </div>
          </header>

          <form className="account-card" onSubmit={onCreateTeacher}>
            <div className="account-card-head">
              <h3>선생님 추가</h3>
              <span className="muted small">같은 조직에 새 선생님 계정을 발급합니다.</span>
            </div>
            <div className="grid-2">
              <label>
                <span>이름</span>
                <input
                  value={teacherCreateDraft.display_name}
                  onChange={(e) =>
                    setTeacherCreateDraft((current) => ({ ...current, display_name: e.target.value }))
                  }
                  placeholder="예: 김선생"
                />
              </label>
              <label>
                <span>아이디</span>
                <input
                  value={teacherCreateDraft.username}
                  onChange={(e) =>
                    setTeacherCreateDraft((current) => ({ ...current, username: e.target.value }))
                  }
                  placeholder="teacher_kim"
                />
              </label>
            </div>
            <label>
              <span>비밀번호</span>
              <input
                type="password"
                value={teacherCreateDraft.password}
                onChange={(e) =>
                  setTeacherCreateDraft((current) => ({ ...current, password: e.target.value }))
                }
                placeholder="초기 비밀번호"
              />
            </label>
            <div className="form-actions">
              <button className="btn btn-secondary" type="submit">
                선생님 계정 생성
              </button>
            </div>
          </form>

          <div className="account-list-card">
            <div className="account-card-head">
              <h3>선생님 목록</h3>
              <span className="muted small">메인 선생님과 추가 선생님을 함께 표시합니다.</span>
            </div>
            {teachers.length === 0 ? (
              <p className="empty-inline">등록된 선생님이 없습니다.</p>
            ) : (
              <ul className="account-list">
                {teachers.map((teacher) => (
                  <li key={teacher.id} className="account-list-item">
                    <div className="account-list-main">
                      <strong>{teacher.display_name}</strong>
                      <span className="muted small">@{teacher.username}</span>
                    </div>
                    <div className="account-list-actions">
                      <span
                        className={teacher.is_primary_teacher ? "verdict verdict-ok" : "verdict verdict-neutral"}
                      >
                        {teacher.is_primary_teacher ? "메인 선생님" : "추가 선생님"}
                      </span>
                      {user.is_primary_teacher && !teacher.is_primary_teacher && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => onDeleteTeacher(teacher.id)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {movingStudent && (
        <StudentMoveModal
          student={movingStudent}
          teachers={teachers}
          currentUser={user}
          onClose={() => setMovingStudent(null)}
          onSubmit={(draft) => {
            onMoveStudent(movingStudent.id, draft.teacher_id, draft.class_name.trim());
            setMovingStudent(null);
          }}
        />
      )}

      {activeTab === "student" && (
        <section className="card account-admin">
          <header className="card-head">
            <div>
              <h2>학생 계정</h2>
              <p className="muted">반 이름은 현재 로그인한 선생님이 만든 학생끼리만 같은 반으로 묶입니다.</p>
            </div>
          </header>

          <form className="account-card" onSubmit={onCreateStudent}>
            <div className="account-card-head">
              <h3>학생 추가</h3>
              <span className="muted small">같은 반 이름을 입력하면 동일 수강반으로 묶입니다.</span>
            </div>
            <div className="grid-2">
              <label>
                <span>이름</span>
                <input
                  value={studentCreateDraft.display_name}
                  onChange={(e) =>
                    setStudentCreateDraft((current) => ({ ...current, display_name: e.target.value }))
                  }
                  placeholder="예: 홍길동"
                />
              </label>
              <label>
                <span>아이디</span>
                <input
                  value={studentCreateDraft.username}
                  onChange={(e) =>
                    setStudentCreateDraft((current) => ({ ...current, username: e.target.value }))
                  }
                  placeholder="student_hong"
                />
              </label>
            </div>
            <div className="grid-2">
              <label>
                <span>비밀번호</span>
                <input
                  type="password"
                  value={studentCreateDraft.password}
                  onChange={(e) =>
                    setStudentCreateDraft((current) => ({ ...current, password: e.target.value }))
                  }
                  placeholder="초기 비밀번호"
                />
              </label>
              <label>
                <span>반 이름</span>
                <input
                  value={studentCreateDraft.class_name}
                  onChange={(e) =>
                    setStudentCreateDraft((current) => ({ ...current, class_name: e.target.value }))
                  }
                  placeholder="예: 토11시 / 금2시"
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit">
                학생 계정 생성
              </button>
            </div>
          </form>

          <div className="account-list-card">
            <div className="account-card-head">
              <h3>반별 학생 목록</h3>
            </div>
            {studentsByClass.length === 0 ? (
              <p className="empty-inline">아직 등록된 학생이 없습니다.</p>
            ) : (
              <div className="account-class-stack">
                {studentsByClass.map(([className, list]) => (
                  <div key={className} className="account-class-group">
                    <div className="account-class-header">
                      <span className="class-chip">{className}</span>
                      <span className="muted small">{list.length}명</span>
                    </div>
                    <ul className="account-list">
                      {list.map((student) => (
                        <li key={student.id} className="account-list-item">
                          <div className="account-list-main">
                            <strong>{student.display_name}</strong>
                            <span className="muted small">@{student.username}</span>
                          </div>
                          <div className="account-list-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setMovingStudent(student)}
                            >
                              반 이동
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-danger"
                              onClick={() => onDeleteStudent(student.id)}
                            >
                              삭제
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AssignmentsView(props: {
  user: UserProfile;
  assignments: Assignment[];
  students: UserProfile[];
  problems: ProblemCard[];
  groups: AssignmentGroup[];
  activeGroupKey: string | null;
  groupDetail: AssignmentGroupStudent[];
  groupDetailLoading: boolean;
  onOpenGroup: (key: string) => void;
  onCloseGroup: () => void;
  assignmentDraft: AssignmentDraft;
  setAssignmentDraft: React.Dispatch<React.SetStateAction<AssignmentDraft>>;
  onCreate: (e: FormEvent) => void;
  onOpenProblem: (id: number) => void;
}) {
  const {
    user,
    assignments,
    students,
    problems,
    groups,
    activeGroupKey,
    groupDetail,
    groupDetailLoading,
    onOpenGroup,
    onCloseGroup,
    assignmentDraft,
    setAssignmentDraft,
    onCreate,
    onOpenProblem,
  } = props;

  const classOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of students) {
      const name = (student.class_name ?? "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students]);

  const activeGroup = groups.find((g) => g.group_key === activeGroupKey) ?? null;

  if (user.role === "student") {
    return (
      <div className="page-stack list-page">
        <header className="page-head page-head-tight">
          <div>
            <h1>내 과제</h1>
            <p className="muted">담당 강사가 배정한 과제 목록입니다.</p>
          </div>
        </header>
        <section className="card">
          <header className="card-head">
            <h2>과제 목록</h2>
            <span className="muted">{assignments.length}건</span>
          </header>
          {assignments.length === 0 ? (
            <div className="empty">아직 과제가 없습니다.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>문제</th>
                  <th>유형</th>
                  <th>강사</th>
                  <th>마감</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => onOpenProblem(a.problem_id)}>
                    <td>
                      <strong>{a.title}</strong>
                    </td>
                    <td>
                      <strong>{a.problem_title}</strong>
                      <p className="muted">{a.category_name}</p>
                    </td>
                    <td>{a.assignment_type === "homework" ? "숙제" : "수업"}</td>
                    <td>{a.teacher_name}</td>
                    <td className="muted">{formatDate(a.due_at)}</td>
                    <td>
                      {a.submitted ? (
                        <span className="verdict verdict-ok">제출 완료</span>
                      ) : (
                        <span className="verdict verdict-neutral">진행 중</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  const totalAssigned = groups.reduce((acc, g) => acc + g.total_students, 0);
  const totalCompleted = groups.reduce((acc, g) => acc + g.completed_students, 0);
  const overallRate = totalAssigned === 0 ? 0 : Math.round((totalCompleted / totalAssigned) * 100);

  return (
    <div className="page-stack list-page">
      <header className="page-head page-head-tight">
        <div>
          <h1>과제 관리</h1>
          <p className="muted">
            문제를 선택하고 수강반을 지정하면 해당 수강반 전체에 과제가 배정됩니다. 진행 현황도 수강반 기준으로 바로 확인할 수 있어요.
          </p>
        </div>
        <div className="summary-pill">
          <span className="muted small">전체 완료율</span>
          <strong className="mono">{overallRate}%</strong>
          <span className="muted small">
            {totalCompleted}/{totalAssigned}
          </span>
        </div>
      </header>

      <form className="card assign-form" onSubmit={onCreate}>
        <header className="card-head">
          <h2>새 과제 배정</h2>
          <span className="muted small">문제 + 수강반 선택만으로 즉시 배정</span>
        </header>
        <div className="assign-grid">
          <label className="assign-field">
            <span>문제</span>
            <select
              value={assignmentDraft.problem_id ?? ""}
              onChange={(e) =>
                setAssignmentDraft((c) => ({ ...c, problem_id: e.target.value ? Number(e.target.value) : null }))
              }
            >
              <option value="">문제를 선택하세요</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.category_name}] {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="assign-field">
            <span>수강반</span>
            <select
              value={assignmentDraft.class_name}
              onChange={(e) => setAssignmentDraft((c) => ({ ...c, class_name: e.target.value }))}
            >
              <option value="">수강반을 선택하세요</option>
              {classOptions.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count}명)
                </option>
              ))}
            </select>
          </label>
          <label className="assign-field">
            <span>유형</span>
            <select
              value={assignmentDraft.assignment_type}
              onChange={(e) =>
                setAssignmentDraft((c) => ({ ...c, assignment_type: e.target.value as AssignmentType }))
              }
            >
              <option value="homework">숙제</option>
              <option value="classroom">수업시간</option>
            </select>
          </label>
          <label className="assign-field">
            <span>마감 기한</span>
            <input
              type="datetime-local"
              value={assignmentDraft.due_at}
              onChange={(e) => setAssignmentDraft((c) => ({ ...c, due_at: e.target.value }))}
            />
          </label>
          <label className="assign-field assign-field-wide">
            <span>
              과제 제목 <span className="muted small">(비우면 문제 제목으로)</span>
            </span>
            <input
              value={assignmentDraft.title}
              onChange={(e) => setAssignmentDraft((c) => ({ ...c, title: e.target.value }))}
              placeholder="예: 2-3 반 1주차 과제"
            />
          </label>
        </div>
        {classOptions.length === 0 && (
          <p className="empty-inline">
            등록된 수강생이 없어요. 수강생 계정에 수강반을 지정하면 이곳에 나타납니다.
          </p>
        )}
        <div className="form-actions">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!assignmentDraft.problem_id || !assignmentDraft.class_name}
          >
            이 수강반에 과제 배정
          </button>
        </div>
      </form>

      <section className="home-section">
        <header className="home-section-head">
          <h2>반별 과제 현황</h2>
          <span className="muted small">{groups.length}개 과제 · 클릭하면 수강생별 제출 현황</span>
        </header>
        {groups.length === 0 ? (
          <p className="empty-inline">아직 배정한 과제가 없습니다. 위에서 새 과제를 만들어 보세요.</p>
        ) : (
          <ul className="group-list">
            {groups.map((g) => {
              const pct = Math.round(g.completion_rate * 100);
              const tone = pct === 100 ? "ok" : pct >= 50 ? "warn" : "bad";
              return (
                <li
                  key={g.group_key}
                  className={`group-row ${activeGroupKey === g.group_key ? "group-row-active" : ""}`}
                  onClick={() => onOpenGroup(g.group_key)}
                >
                  <div className="group-main">
                    <div className="group-title">
                      <span className="class-chip">{g.class_name}</span>
                      <strong>{g.problem_title}</strong>
                      <span className="muted small">{g.category_name}</span>
                    </div>
                    <div className="muted small group-meta">
                      {g.title} · {g.assignment_type === "homework" ? "숙제" : "수업"}
                      {g.due_at ? ` · 마감 ${formatDate(g.due_at)}` : ""}
                    </div>
                  </div>
                  <div className="group-progress">
                    <div className="group-progress-bar">
                      <div className={`group-progress-fill tone-${tone}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="group-progress-meta">
                      <span className="mono">{pct}%</span>
                      <span className="muted small">
                        {g.completed_students}/{g.total_students}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activeGroup && (
        <section className="home-section group-detail">
          <header className="home-section-head">
            <h2>
              {activeGroup.class_name} · {activeGroup.problem_title}
            </h2>
            <div className="form-actions">
              <button className="link" onClick={() => onOpenProblem(activeGroup.problem_id)}>
                문제 열기 →
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onCloseGroup}>
                닫기
              </button>
            </div>
          </header>
          {groupDetailLoading ? (
            <p className="empty-inline">불러오는 중...</p>
          ) : groupDetail.length === 0 ? (
            <p className="empty-inline">아직 배정된 수강생이 없습니다.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>수강생</th>
                  <th>상태</th>
                  <th>테스트</th>
                  <th>시도</th>
                  <th>최근 제출</th>
                </tr>
              </thead>
              <tbody>
                {groupDetail.map((row) => (
                  <tr key={row.assignment_id}>
                    <td>
                      <strong>{row.student_name}</strong>
                      <p className="muted small">@{row.student_username}</p>
                    </td>
                    <td>
                      {row.best_status ? (
                        <StatusBadge status={row.best_status} />
                      ) : (
                        <span className="verdict verdict-neutral">미제출</span>
                      )}
                    </td>
                    <td className="mono">
                      {row.best_total > 0 ? `${row.best_passed}/${row.best_total}` : "-"}
                    </td>
                    <td className="mono">{row.attempts}</td>
                    <td className="muted">{row.last_submitted_at ? formatDate(toUTC(row.last_submitted_at)) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function SubmissionsView(props: {
  submissions: Submission[];
  problems: ProblemCard[];
  onOpenProblem: (id: number) => void;
}) {
  const { submissions, problems, onOpenProblem } = props;
  const map = new Map(problems.map((p) => [p.id, p]));
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(submissions[0]?.id ?? null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const selectedSubmission =
    submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0] ?? null;

  useEffect(() => {
    if (submissions.length === 0) {
      setSelectedSubmissionId(null);
      return;
    }
    if (!submissions.some((submission) => submission.id === selectedSubmissionId)) {
      setSelectedSubmissionId(submissions[0].id);
    }
  }, [selectedSubmissionId, submissions]);

  useEffect(() => {
    if (!codeModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCodeModalOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [codeModalOpen]);

  const acceptedCount = submissions.filter((submission) => submission.status === "accepted").length;
  const failedCount = submissions.length - acceptedCount;
  const selectedLanguage: "python" | "c" = selectedSubmission?.language === "c" ? "c" : "python";
  const selectedCodeLines = selectedSubmission?.code.split("\n") ?? [];

  return (
    <div className="submissions-page page-stack">
      <header className="page-head page-head-tight submissions-head">
        <div>
          <h1>내 제출</h1>
          <p className="muted">최근 제출한 코드의 결과를 확인할 수 있습니다.</p>
        </div>
        <div className="submissions-stats" aria-label="제출 요약">
          <span><b>{submissions.length}</b>전체</span>
          <span><b>{acceptedCount}</b>통과</span>
          <span><b>{failedCount}</b>미통과</span>
        </div>
      </header>
      <section className="submissions-workspace">
        {submissions.length === 0 ? (
          <div className="empty">아직 제출 기록이 없습니다.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>문제</th>
                <th>분류</th>
                <th>난이도</th>
                <th>결과</th>
                <th>테스트</th>
                <th>시간</th>
                <th>제출일</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => {
                const p = map.get(s.problem_id);
                return (
                  <tr
                    key={s.id}
                    className={selectedSubmission?.id === s.id ? "clickable submission-row-active" : "clickable"}
                    onClick={() => {
                      setSelectedSubmissionId(s.id);
                      setCodeModalOpen(true);
                    }}
                  >
                    <td>
                      <strong>{p?.title ?? `#${s.problem_id}`}</strong>
                      <p>
                        <button className="link" onClick={(event) => {
                          event.stopPropagation();
                          onOpenProblem(s.problem_id);
                        }}>
                          문제 열기
                        </button>
                      </p>
                    </td>
                    <td>{p && <span className="chip chip-soft">{p.category_name}</span>}</td>
                    <td>{p && <DifficultyBadge level={p.difficulty} />}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="mono">
                      {s.passed_tests}/{s.total_tests}
                    </td>
                    <td className="mono muted">{s.runtime_ms}ms</td>
                    <td className="muted">{formatDate(toUTC(s.created_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {codeModalOpen && selectedSubmission && createPortal(
          <div className="submission-modal-backdrop" onClick={() => setCodeModalOpen(false)}>
          <article className="submission-code-mockup submission-code-modal" onClick={(event) => event.stopPropagation()}>
            <header className="submission-code-mockup-head">
              <div>
                <strong>{map.get(selectedSubmission.problem_id)?.title ?? `문제 #${selectedSubmission.problem_id}`}</strong>
                <p className="muted">{formatDate(selectedSubmission.created_at)}</p>
              </div>
              <div className="submission-code-meta">
                <StatusBadge status={selectedSubmission.status} />
                <span className="mono muted">
                  {selectedSubmission.passed_tests}/{selectedSubmission.total_tests}
                </span>
                <button
                  type="button"
                  className="submission-modal-close"
                  onClick={() => setCodeModalOpen(false)}
                  aria-label="제출 코드 닫기"
                >
                  x
                </button>
              </div>
            </header>
            <div className="submission-code-frame">
              <pre className="submission-line-nums" aria-hidden="true">
                {selectedCodeLines.map((_, index) => (
                  <Fragment key={index}>{index + 1}{index < selectedCodeLines.length - 1 ? "\n" : ""}</Fragment>
                ))}
              </pre>
              <pre className="submission-code-preview">
                {renderHighlightedCode(selectedSubmission.code, selectedLanguage)}
              </pre>
            </div>
          </article>
          </div>,
          document.body,
        )}
      </section>
    </div>
  );
}

function ManageView(props: {
  categories: Category[];
  problemForm: ProblemEditorForm;
  setProblemForm: React.Dispatch<React.SetStateAction<ProblemEditorForm>>;
  mode: "create" | "edit";
  onSubmit: (e: FormEvent) => void;
  onReset: () => void;
  problemId: number | null;
  onDeleteProblem: (problemId: number) => void;
}) {
  const { categories, problemForm, setProblemForm, mode, onSubmit, onReset, problemId, onDeleteProblem } = props;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  const filledCount = problemForm.testcases.filter(
    (tc) => tc.input_data.trim() || tc.expected_output.trim(),
  ).length;
  const tcValid = filledCount >= 10 && filledCount <= 50;

  function addEmpty(n: number) {
    setProblemForm((current) => ({
      ...current,
      testcases: [...current.testcases, ...Array.from({ length: n }, emptyTestcase)],
    }));
  }

  function removeEmpty() {
    setProblemForm((current) => {
      const kept = current.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim());
      return { ...current, testcases: kept.length > 0 ? kept : [emptyTestcase()] };
    });
  }

  function updateTestcase(index: number, patch: Partial<TestCase>) {
    setProblemForm((current) => ({
      ...current,
      testcases: current.testcases.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function deleteTestcase(index: number) {
    setProblemForm((current) => {
      const next = current.testcases.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, testcases: next.length > 0 ? next : [emptyTestcase()] };
    });
  }

  function applyBulk() {
    setBulkError(null);
    const trimmed = bulkText.trim();
    if (!trimmed) {
      setBulkError("붙여넣을 내용이 없습니다.");
      return;
    }
    const blocks = trimmed.split(/^===+\s*$/m).map((block) => block.trim()).filter(Boolean);
    const parsed: TestCase[] = [];
    for (const block of blocks) {
      const parts = block.split(/^@@+\s*$/m);
      if (parts.length < 2) {
        setBulkError("각 블록은 '@@' 구분선으로 입력과 기대 출력을 나눠야 합니다.");
        return;
      }
      parsed.push({
        input_data: parts[0].replace(/^\n+|\n+$/g, ""),
        expected_output: parts[1].replace(/^\n+|\n+$/g, ""),
        is_public: false,
        note: "",
      });
    }
    if (parsed.length === 0) {
      setBulkError("추가할 테스트케이스가 없습니다.");
      return;
    }
    setProblemForm((current) => {
      const kept = current.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim());
      return { ...current, testcases: [...kept, ...parsed] };
    });
    setBulkText("");
    setBulkOpen(false);
  }

  return (
    <form className="manage-form mv-root" onSubmit={onSubmit}>
      <header className="mv-header">
        <div>
          <h1>{mode === "edit" ? "문제 수정" : "새 문제 만들기"}</h1>
          <p>필수 입력만 채워도 저장할 수 있고, 테스트케이스는 최소 10개 이상 준비되면 바로 출제할 수 있어요.</p>
        </div>
        <div className="mv-header-actions">
          {mode === "edit" && problemId && (
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onDeleteProblem(problemId)}>
              문제 삭제
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
            처음부터 작성
          </button>
          <button type="submit" className="btn btn-primary" disabled={!tcValid}>
            {mode === "edit" ? "수정 저장" : "문제 등록"}
          </button>
        </div>
      </header>

      <section className="mv-card">
        <div className="mv-section-title">
          <span className="mv-step">1</span>
          <span>기본 정보</span>
        </div>
        <div className="mv-grid-2">
          <label className="mv-field">
            <span className="mv-label">문제 제목 *</span>
            <input
              placeholder="예: 숫자 뒤집기"
              value={problemForm.title}
              onChange={(e) => setProblemForm((current) => ({ ...current, title: e.target.value }))}
            />
          </label>
          <label className="mv-field">
            <span className="mv-label">한 줄 설명 *</span>
            <input
              placeholder="목록 카드에 보일 짧은 설명"
              value={problemForm.short_description}
              onChange={(e) =>
                setProblemForm((current) => ({ ...current, short_description: e.target.value }))
              }
            />
          </label>
        </div>
        <div className="mv-grid-3">
          <label className="mv-field">
            <span className="mv-label">분류</span>
            <select
              value={problemForm.category_id}
              onChange={(e) =>
                setProblemForm((current) => ({ ...current, category_id: Number(e.target.value) }))
              }
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mv-field">
            <span className="mv-label">난이도</span>
            <select
              value={problemForm.difficulty}
              onChange={(e) =>
                setProblemForm((current) => ({ ...current, difficulty: e.target.value as Difficulty }))
              }
            >
              <option value="beginner">입문</option>
              <option value="basic">기초</option>
              <option value="intermediate">응용</option>
            </select>
          </label>
          <label className="mv-field">
            <span className="mv-label">시간 제한 (초)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={problemForm.time_limit_seconds}
              onChange={(e) =>
                setProblemForm((current) => ({ ...current, time_limit_seconds: Number(e.target.value) }))
              }
            />
          </label>
        </div>
      </section>

      <section className="mv-card">
        <div className="mv-section-title">
          <span className="mv-step">2</span>
          <span>문제 내용</span>
        </div>
        <label className="mv-field">
          <span className="mv-label">문제 설명 *</span>
          <textarea
            rows={7}
            placeholder="문제가 요구하는 바를 자세히 적어주세요."
            value={problemForm.statement}
            onChange={(e) => setProblemForm((current) => ({ ...current, statement: e.target.value }))}
          />
        </label>
        <div className="mv-grid-2">
          <label className="mv-field">
            <span className="mv-label">예제 입력</span>
            <textarea
              rows={4}
              value={problemForm.sample_input}
              onChange={(e) => setProblemForm((current) => ({ ...current, sample_input: e.target.value }))}
            />
          </label>
          <label className="mv-field">
            <span className="mv-label">예제 출력</span>
            <textarea
              rows={4}
              value={problemForm.sample_output}
              onChange={(e) => setProblemForm((current) => ({ ...current, sample_output: e.target.value }))}
            />
          </label>
        </div>

        <details className="mv-advanced">
          <summary>고급 설정 (입출력 설명, 제한사항, 스타터 코드, 메모리)</summary>
          <div className="mv-advanced-body">
            <div className="mv-grid-2">
              <label className="mv-field">
                <span className="mv-label">입력 형식 설명</span>
                <textarea
                  rows={3}
                  value={problemForm.input_description}
                  onChange={(e) =>
                    setProblemForm((current) => ({ ...current, input_description: e.target.value }))
                  }
                />
              </label>
              <label className="mv-field">
                <span className="mv-label">출력 형식 설명</span>
                <textarea
                  rows={3}
                  value={problemForm.output_description}
                  onChange={(e) =>
                    setProblemForm((current) => ({ ...current, output_description: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="mv-field">
              <span className="mv-label">제한사항</span>
              <textarea
                rows={2}
                placeholder="예: 1 ≤ N ≤ 1,000,000"
                value={problemForm.constraints}
                onChange={(e) => setProblemForm((current) => ({ ...current, constraints: e.target.value }))}
              />
            </label>
            <div className="mv-grid-2">
              <label className="mv-field">
                <span className="mv-label">스타터 코드 (Python)</span>
                <textarea
                  rows={4}
                  value={problemForm.starter_code_python}
                  onChange={(e) =>
                    setProblemForm((current) => ({ ...current, starter_code_python: e.target.value }))
                  }
                />
              </label>
              <label className="mv-field">
                <span className="mv-label">메모리 제한 (MB)</span>
                <input
                  type="number"
                  min="1"
                  value={problemForm.memory_limit_mb}
                  onChange={(e) =>
                    setProblemForm((current) => ({ ...current, memory_limit_mb: Number(e.target.value) }))
                  }
                />
              </label>
            </div>
          </div>
        </details>
      </section>

      <section className="mv-card">
        <div className="tc-section">
          <div className="tc-top">
            <div className="tc-top-left">
              <div className="mv-section-title tc-title">
                <span className="mv-step">3</span>
                <span>채점 테스트케이스</span>
              </div>
              <p className="mv-hint">
                엣지 케이스를 포함해 <strong>최소 10개, 최대 50개</strong>까지 입력하세요.
              </p>
            </div>
            <div className={`tc-counter ${tcValid ? "tc-counter-ok" : "tc-counter-bad"}`}>
              <strong>{filledCount}</strong>
              <span>/ 10-50</span>
            </div>
          </div>

          <div className="tc-toolbar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(1)}>
              + 1개
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(5)}>
              + 5개
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(10)}>
              + 10개
            </button>
            <button
              type="button"
              className={`btn btn-sm ${bulkOpen ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setBulkOpen((open) => !open)}
            >
              {bulkOpen ? "일괄 입력 닫기" : "일괄 붙여넣기"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeEmpty}>
              빈 칸 정리
            </button>
          </div>

          {bulkOpen && (
            <div className="bulk-box">
              <p className="mv-hint">
                각 테스트는 <code>===</code>로 구분하고, 입력과 기대 출력은 <code>@@</code>로 나눠주세요.
              </p>
              <pre className="bulk-example">{`3 4
@@
7
===
10 20
@@
30`}</pre>
              <textarea
                rows={7}
                placeholder="여러 테스트케이스를 한 번에 붙여넣기"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              {bulkError && <p className="bulk-error">{bulkError}</p>}
              <div className="mv-header-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={applyBulk}>
                  테스트 추가
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkText("")}>
                  지우기
                </button>
              </div>
            </div>
          )}

          <div className="tc-list">
            {problemForm.testcases.length === 0 && (
              <div className="empty-state">테스트케이스가 없습니다. 위에서 먼저 추가해 주세요.</div>
            )}
            {problemForm.testcases.map((tc, index) => (
              <div key={index} className="tc-item">
                <div className="tc-item-head">
                  <span className="tc-item-num mono">#{index + 1}</span>
                  <input
                    className="tc-item-note"
                    placeholder="메모 (예: 엣지 케이스)"
                    value={tc.note}
                    onChange={(e) => updateTestcase(index, { note: e.target.value })}
                  />
                  <label className="tc-pub">
                    <input
                      type="checkbox"
                      checked={tc.is_public}
                      onChange={(e) => updateTestcase(index, { is_public: e.target.checked })}
                    />
                    공개
                  </label>
                  <button
                    type="button"
                    className="tc-del"
                    onClick={() => deleteTestcase(index)}
                    aria-label="테스트케이스 삭제"
                  >
                    ×
                  </button>
                </div>
                <div className="tc-io-labels">
                  <div className="tc-io-label">입력</div>
                  <div className="tc-io-label">기대 출력</div>
                </div>
                <div className="tc-io">
                  <textarea
                    rows={3}
                    placeholder="입력"
                    value={tc.input_data}
                    onChange={(e) => updateTestcase(index, { input_data: e.target.value })}
                  />
                  <textarea
                    rows={3}
                    placeholder="기대 출력"
                    value={tc.expected_output}
                    onChange={(e) => updateTestcase(index, { expected_output: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="form-actions-end">
            <button type="submit" className="btn btn-primary" disabled={!tcValid}>
              {tcValid ? (mode === "edit" ? "수정 저장" : "문제 등록") : `테스트 ${Math.max(0, 10 - filledCount)}개 더 필요`}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}

function GradingPanel({ stream, isRunning }: { stream: StreamState; isRunning: boolean }) {
  const totalTests = Math.max(stream.total, stream.results.length);
  const overallPct = totalTests > 0 ? Math.round((stream.completed / totalTests) * 100) : 0;
  const slots = Array.from({ length: totalTests }, (_, index) => index);
  const finalTone = stream.done ? statusTone(stream.summary?.status ?? "") : "running";
  const badgeTone = finalTone === "ok" ? "ok" : finalTone === "warn" ? "warn" : "bad";
  const firstErrorResult = stream.results.find((result) => result.stderr.trim());
  const errorMessage = firstErrorResult?.stderr.trim() ?? "";

  return (
    <div className="sv-grade">
      <div className="sv-ghead">
        <div className="sv-gtitle">
          {stream.done && stream.summary ? (
            <span className={`sv-dbadge sv-dbadge-${badgeTone}`}>
              {statusLabel(stream.summary.status)}
            </span>
          ) : (
            <>
              <span className="sv-ldot" />
              <span>{stream.kind === "run" ? "예제 실행 중" : "채점 중"}</span>
            </>
          )}
        </div>
        <div className="sv-gsub mono">
          {stream.completed}/{totalTests || "?"}
        </div>
      </div>

      <div className="sv-progress">
        <div
          className={`sv-pfill ${stream.done ? `sv-pfill-${badgeTone}` : "sv-pfill-run"}`}
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {stream.done && stream.summary && (
        <div className="sv-summary">
          <strong>
            {stream.summary.passed_tests}/{stream.summary.total_tests} 테스트 통과
          </strong>
          <span className="sv-gsub">총 {stream.summary.runtime_ms}ms</span>
        </div>
      )}

      {errorMessage && (
        <div className="sv-error-panel">
          <strong>에러 메시지</strong>
          <pre>{errorMessage}</pre>
        </div>
      )}

      <ul className="sv-tc-list">
        {slots.map((i) => {
          const r = stream.results.find((rr) => rr.index === i);
          const tone = r ? statusTone(r.status) : i === stream.completed && isRunning ? "running" : "pending";
          const hasDetail = r && (r.expected || r.actual);
          return (
            <Fragment key={i}>
              <li
                className={`sv-tcrow ${
                  tone === "ok" ? "sv-ok" : tone === "warn" ? "sv-warn" : tone === "bad" ? "sv-bad" : ""
                }`}
              >
                <span className="sv-tcnum">테스트 {i + 1}</span>
                {r ? (
                  <span>{statusLabel(r.status)}</span>
                ) : i === stream.completed && isRunning ? (
                  <span>채점 중</span>
                ) : (
                  <span>대기 중</span>
                )}
                {r && <span className="sv-tcms">{r.runtime_ms}ms</span>}
              </li>
              {hasDetail && (
                <li className={`result-item result-${statusTone(r.status)}`}>
                  <div>
                    <strong>테스트 {r.index + 1} 상세</strong>
                  </div>
                  <div className="result-meta mono">
                    {r.actual && <span>출력<br />{r.actual}</span>}
                    {r.expected && <span>예상 출력값<br />{r.expected}</span>}
                    {r.stderr && <span className="bad">에러: {r.stderr}</span>}
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="problem-section">
      <h3 className="section-title">{title}</h3>
      <p>{children}</p>
    </section>
  );
}
