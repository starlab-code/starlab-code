import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type UserRole = "teacher" | "student";
type Difficulty = "beginner" | "basic" | "intermediate";
type AssignmentType = "homework" | "classroom";
type View =
  | "home"
  | "problems"
  | "solve"
  | "assignments"
  | "submissions"
  | "live"
  | "manage";

type UserProfile = {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
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
  if (status === "runtime_error" || status === "time_limit") return "warn";
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

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
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

function renderHighlightedCode(code: string) {
  const lines = code.split("\n");
  return lines.map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {highlightPythonLine(line).map((token, tokenIndex) =>
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

function CodeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lines = value.split("\n");

  function syncScroll() {
    if (!gutterRef.current || !textareaRef.current || !highlightRef.current) return;
    gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }

  return (
    <div className="editor-shell">
      <div className="editor-gutter" ref={gutterRef}>
        {lines.map((_, index) => (
          <span key={index + 1}>{index + 1}</span>
        ))}
      </div>
      <div className="editor-main">
        <pre className="editor-highlight" ref={highlightRef} aria-hidden="true">
          {renderHighlightedCode(value)}
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          spellCheck={false}
          value={value}
          wrap="off"
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
        />
      </div>
    </div>
  );
}

export default function App() {
  const editorWindowState = useMemo(() => readEditorWindowState(), []);
  const isEditorWindow = editorWindowState.enabled;
  const initialEditorProblemId = editorWindowState.problemId;
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
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
  const [stream, setStream] = useState<StreamState | null>(null);
  const [codeDrafts, setCodeDrafts] = useState<Record<number, string>>({});
  const [view, setView] = useState<View>(isEditorWindow ? "solve" : "home");
  const [problemFilter, setProblemFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | "all">("all");
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | "all">("all");
  const [solvePane, setSolvePane] = useState<"problem" | "history">("problem");
  const [loginDraft, setLoginDraft] = useState({ username: "teacher_demo", password: "demo1234" });
  const [registerDraft, setRegisterDraft] = useState<RegisterDraft>({
    username: "",
    display_name: "",
    password: "",
    class_name: "",
  });
  const [registerNewClassName, setRegisterNewClassName] = useState("");
  const [problemForm, setProblemForm] = useState<ProblemEditorForm>(emptyProblemForm());
  const [problemFormMode, setProblemFormMode] = useState<"create" | "edit">("create");
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>(emptyAssignmentDraft());
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<SubmissionFeedItem[]>([]);
  const [feedHighlightId, setFeedHighlightId] = useState<number | null>(null);
  const [feedPaused, setFeedPaused] = useState(false);
  const lastFeedIdRef = useRef<number>(0);

  const selectedCode = selectedProblemId ? codeDrafts[selectedProblemId] ?? "" : "";

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
      const d = new Date(s.created_at);
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
      const d = new Date(s.created_at);
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
      const d = new Date(s.created_at);
      d.setHours(0, 0, 0, 0);
      if (dayKey(d) === todayKey) todayStudents.add(s.user_id);
    }
    const todayAccuracy =
      todayActivity.submitted === 0 ? 0 : Math.round((todayActivity.accepted / todayActivity.submitted) * 100);

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    const studentWeek = new Map<number, { submitted: number; accepted: number; solved: Set<number> }>();
    for (const s of submissions) {
      if (new Date(s.created_at).getTime() < weekStart.getTime()) continue;
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
    try {
      const result = await request<ClassroomOption[]>("/classrooms");
      setClassrooms(result);
    } catch {
      setClassrooms([]);
    }
  }

  async function loadAppData(nextToken: string, knownUser?: UserProfile) {
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
        calls.push(request<UserProfile[]>("/students", {}, nextToken));
        calls.push(request<SubmissionFeedItem[]>("/submissions/feed?limit=60", {}, nextToken));
        calls.push(request<AssignmentGroup[]>("/assignments/groups", {}, nextToken));
      }

      const results = await Promise.all(calls);
      const [
        dashboardResult,
        categoriesResult,
        problemsResult,
        assignmentsResult,
        submissionsResult,
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
        SubmissionFeedItem[] | undefined,
        AssignmentGroup[] | undefined,
      ];

      setToken(nextToken);
      setUser(profile);
      setDashboard(dashboardResult);
      setCategories(categoriesResult);
      setProblems(problemsResult);
      setAssignments(assignmentsResult);
      setSubmissions(submissionsResult);
      setStudents(studentsResult ?? []);
      setAssignmentGroups(groupsResult ?? []);
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
      localStorage.removeItem("starlab-code-token");
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPublicClassrooms();
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem("starlab-code-token");
    if (savedToken) void loadAppData(savedToken);
  }, []);

  useEffect(() => {
    if (!isEditorWindow || !selectedProblemId) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "editor");
    nextUrl.searchParams.set("problem", String(selectedProblemId));
    window.history.replaceState({}, "", nextUrl.toString());
  }, [isEditorWindow, selectedProblemId]);

  useEffect(() => {
    if (!token || !selectedProblemId) return;
    const loadProblem = async () => {
      try {
        const detail = await request<ProblemDetail>(`/problems/${selectedProblemId}`, {}, token);
        setSelectedProblem(detail);
        setCodeDrafts((current) => {
          if (current[selectedProblemId]) return current;
          return {
            ...current,
            [selectedProblemId]: detail.starter_code_python || "import sys\ninput = sys.stdin.readline\n\n",
          };
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "문제 상세를 불러오지 못했습니다.");
      }
    };
    void loadProblem();
  }, [token, selectedProblemId]);

  // Teacher live feed polling
  useEffect(() => {
    if (!token || !user || user.role !== "teacher" || feedPaused) return;
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
  }, [token, user, feedPaused]);

  function navigate(next: View) {
    setView(next);
    setMessage(null);
    setError(null);
  }

  function openProblem(problemId: number) {
    setSelectedProblemId(problemId);
    setStream(null);
    setSolvePane("problem");
    if (isEditorWindow) {
      navigate("solve");
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "editor");
    nextUrl.searchParams.set("problem", String(problemId));
    const popup = window.open(
      nextUrl.toString(),
      "starlab-solve-window",
      "popup=yes,width=1520,height=960,left=120,top=60,resizable=yes,scrollbars=yes",
    );

    if (popup) {
      popup.focus();
      return;
    }

    navigate("solve");
  }

  function loadSelectedProblemIntoForm() {
    if (!selectedProblem) return;
    setProblemFormMode("edit");
    navigate("manage");
    setProblemForm({
      title: selectedProblem.title,
      short_description: selectedProblem.short_description,
      statement: selectedProblem.statement,
      input_description: selectedProblem.input_description,
      output_description: selectedProblem.output_description,
      constraints: selectedProblem.constraints,
      category_id: selectedProblem.category_id,
      difficulty: selectedProblem.difficulty,
      starter_code_python: selectedProblem.starter_code_python,
      sample_input: selectedProblem.sample_input,
      sample_output: selectedProblem.sample_output,
      time_limit_seconds: selectedProblem.time_limit_seconds,
      memory_limit_mb: selectedProblem.memory_limit_mb,
      testcases:
        selectedProblem.all_testcases?.map((tc) => ({
          input_data: tc.input_data,
          expected_output: tc.expected_output,
          is_public: tc.is_public,
          note: tc.note,
        })) ?? [emptyTestcase()],
    });
  }

  function resetProblemForm() {
    setProblemFormMode("create");
    setProblemForm(emptyProblemForm(categories[0]?.id ?? 0));
    navigate("manage");
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
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
    }
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
    setSelectedProblem(null);
    setSelectedProblemId(null);
    setAssignments([]);
    setProblems([]);
    setStudents([]);
    setSubmissions([]);
    setFeed([]);
    setStream(null);
    setMessage("로그아웃했습니다.");
  }

  async function executeStream(kind: "run" | "submit") {
    if (!token || !selectedProblemId) return;
    setIsRunning(true);
    setError(null);
    setMessage(null);
    setStream({ kind, total: 0, completed: 0, results: [], done: false, summary: null });
    try {
      const payload = {
        code: codeDrafts[selectedProblemId] ?? selectedProblem?.starter_code_python ?? "",
        language: "python",
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
            `제출 결과: ${statusLabel(finalSummary.status)} (${finalSummary.passed_tests}/${finalSummary.total_tests})`,
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
    try {
      const payload = {
        ...problemForm,
        testcases: problemForm.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim()),
      };
      if (problemFormMode === "edit" && selectedProblemId) {
        await request<ProblemDetail>(
          `/problems/${selectedProblemId}`,
          { method: "PUT", body: JSON.stringify(payload) },
          token,
        );
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

  if (!user || !token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark">SC</span>
            <div>
              <h1>Starlab Code</h1>
              <p>중·고등학생을 위한 알고리즘 문제 풀이 플랫폼</p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <h2>로그인</h2>
            <label>
              <span>아이디</span>
              <input
                value={loginDraft.username}
                onChange={(e) => setLoginDraft((c) => ({ ...c, username: e.target.value }))}
              />
            </label>
            <label>
              <span>비밀번호</span>
              <input
                type="password"
                value={loginDraft.password}
                onChange={(e) => setLoginDraft((c) => ({ ...c, password: e.target.value }))}
              />
            </label>
            <button className="btn btn-primary btn-block" type="submit">
              로그인
            </button>
            <div className="quick-accounts">
              <span>체험 계정</span>
              <button type="button" onClick={() => setLoginDraft({ username: "teacher_demo", password: "demo1234" })}>
                강사
              </button>
            </div>
          </form>

          <details className="auth-register">
            <summary>학생 계정 만들기</summary>
            <form className="auth-form" onSubmit={handleRegister}>
              <div className="grid-2">
                <label>
                  <span>이름</span>
                  <input
                    value={registerDraft.display_name}
                    onChange={(e) => setRegisterDraft((c) => ({ ...c, display_name: e.target.value }))}
                  />
                </label>
                <label>
                  <span>아이디</span>
                  <input
                    value={registerDraft.username}
                    onChange={(e) => setRegisterDraft((c) => ({ ...c, username: e.target.value }))}
                  />
                </label>
              </div>
              <div className="grid-2">
                <label>
                  <span>비밀번호</span>
                  <input
                    type="password"
                    value={registerDraft.password}
                    onChange={(e) => setRegisterDraft((c) => ({ ...c, password: e.target.value }))}
                  />
                </label>
              </div>
              {classrooms.length > 0 && (
                <label>
                  <span>기존 수강반 선택</span>
                  <select
                    value={registerDraft.class_name}
                    onChange={(e) => setRegisterDraft((c) => ({ ...c, class_name: e.target.value }))}
                  >
                    <option value="">수강반을 선택해 주세요</option>
                    {classrooms.map((classroom) => (
                      <option key={classroom.name} value={classroom.name}>
                        {classroom.name} ({classroom.student_count}명)
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>{classrooms.length > 0 ? "새 반 만들기" : "첫 수강반 만들기"}</span>
                <input
                  placeholder="예: 중등 심화A"
                  value={registerNewClassName}
                  onChange={(e) => setRegisterNewClassName(e.target.value)}
                />
              </label>
              <p className="muted small">
                기존 반을 선택하거나 새 반 이름을 입력하면 바로 학생 계정을 만들 수 있어요.
              </p>
              <button className="btn btn-secondary btn-block" type="submit">
                계정 생성
              </button>
            </form>
          </details>

          {(message || error) && (
            <div className={`toast ${error ? "toast-error" : "toast-ok"}`}>{error ?? message}</div>
          )}
        </div>
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
  ];

  return (
    <div className={isEditorWindow ? "app-root app-root-editor" : "app-root"}>
      {!isEditorWindow && (
      <header className="topnav">
        <div className="topnav-inner">
          <button className="brand" onClick={() => navigate("home")}>
            <span className="brand-mark">SC</span>
            <span className="brand-text">Starlab Code</span>
          </button>
          <nav className="topnav-links">
            {navItems
              .filter((n) => n.show)
              .map((item) => (
                <button
                  key={item.key}
                  className={view === item.key ? "nav-link nav-active" : "nav-link"}
                  onClick={() => navigate(item.key)}
                >
                  {item.label}
                </button>
              ))}
          </nav>
          <div className="topnav-user">
            <div className="user-meta">
              <span className={`role-pill role-${user.role}`}>
                {user.role === "teacher" ? "강사" : "수강생"}
              </span>
              <strong>{user.display_name}</strong>
              {user.class_name && <span className="muted">· {user.class_name} 수강반</span>}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>
      )}

      <main className={isEditorWindow ? "page page-editor-window" : "page"}>
        {(message || error) && (
          <div className={`toast ${error ? "toast-error" : "toast-ok"}`}>{error ?? message}</div>
        )}
        {isLoading && <div className="toast toast-info">데이터를 불러오는 중입니다...</div>}

        {view === "home" && user.role === "student" && (
          <StudentAcademyHome
            user={user}
            stats={studentStats}
            metrics={studentMetrics}
            dashboard={dashboard}
            assignments={myAssignments}
            submissions={submissions}
            problems={problems}
            onOpenProblem={openProblem}
            onGoProblems={() => navigate("problems")}
            onGoAssignments={() => navigate("assignments")}
          />
        )}

        {view === "home" && user.role === "teacher" && (
          <TeacherHome
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
            submissions={submissions}
            userRole={user.role}
          />
        )}

        {view === "solve" && (
          <SolveView
            user={user}
            problem={selectedProblem}
            code={selectedCode}
            onChangeCode={(next) =>
              setCodeDrafts((current) => ({
                ...current,
                ...(selectedProblemId ? { [selectedProblemId]: next } : {}),
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
          />
        )}
      </main>
    </div>
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
  onOpenProblem: (id: number) => void;
  onGoProblems: () => void;
  onGoAssignments: () => void;
}) {
  const { user, stats, metrics, dashboard, assignments, submissions, problems, onOpenProblem, onGoProblems, onGoAssignments } = props;
  const pending = assignments.filter((a) => !a.submitted).slice(0, 5);
  const recentSubmissions = submissions.slice(0, 6);
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
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
    <div className="student-home student-solved-home">
      <header className="solved-home-hero">
        <div className="solved-home-profile">
          <div className="solved-home-profile-top">
            <span className="chip chip-soft">ACADEMY DASHBOARD</span>
            <span className="chip chip-soft">{user.class_name ? `${user.class_name} 수강반` : "수강반 미지정"}</span>
          </div>
          <h1>{user.display_name}</h1>
          <p className="muted">
            학원 과제와 추천 문제를 한눈에 확인하고, 최근 풀이 흐름까지 solved.ac처럼 빠르게 읽을 수 있어요.
          </p>
          <div className="solved-home-actions">
            <button className="btn btn-primary" onClick={onGoProblems}>
              문제 풀러 가기
            </button>
            <button className="btn btn-ghost" onClick={onGoAssignments}>
              내 과제 보기
            </button>
          </div>
        </div>

        <div className="solved-home-stats">
          <article className="solved-stat">
            <span className="solved-stat-label">해결한 문제</span>
            <strong>
              {solved}
              <span className="muted"> / {totalProblems}</span>
            </strong>
            <p className="muted">전체 문제 기준 {overallPct}% 진행</p>
          </article>
          <article className="solved-stat">
            <span className="solved-stat-label">정답률</span>
            <strong>
              {stats?.accuracy ?? 0}
              <span className="muted">%</span>
            </strong>
            <p className="muted">총 제출 {stats?.attempts ?? 0}회</p>
          </article>
          <article className="solved-stat">
            <span className="solved-stat-label">최근 7일</span>
            <strong>{metrics?.last7Solved ?? 0}</strong>
            <p className="muted">최근 일주일간 해결한 문제</p>
          </article>
          <article className="solved-stat">
            <span className="solved-stat-label">진행 중인 과제</span>
            <strong>{pending.length}</strong>
            <p className="muted">오늘 바로 풀어야 할 과제</p>
          </article>
        </div>
      </header>

      <div className="solved-home-grid">
        <section className="home-section solved-panel solved-panel-wide">
          <header className="home-section-head solved-head">
            <h2>추천 문제</h2>
            <button className="link" onClick={onGoProblems}>
              전체 문제 보기 →
            </button>
          </header>
          {recommended.length === 0 ? (
            <p className="empty-inline">풀지 않은 추천 문제가 없어요. 지금 흐름을 아주 잘 타고 있어요.</p>
          ) : (
            <table className="data-table compact solved-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>문제</th>
                  <th>난이도</th>
                  <th>분류</th>
                </tr>
              </thead>
              <tbody>
                {recommended.map((problem) => (
                  <tr key={problem.id} className="clickable" onClick={() => onOpenProblem(problem.id)}>
                    <td className="mono">#{problem.id}</td>
                    <td>
                      <strong>{problem.title}</strong>
                      <p className="muted">{problem.short_description}</p>
                    </td>
                    <td>
                      <DifficultyBadge level={problem.difficulty} />
                    </td>
                    <td className="muted">{problem.category_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="home-section solved-panel">
          <header className="home-section-head solved-head">
            <h2>진행 중인 과제</h2>
            <button className="link" onClick={onGoAssignments}>
              과제 전체 →
            </button>
          </header>
          {pending.length === 0 ? (
            <p className="empty-inline">지금 진행 중인 과제가 없어요. 추천 문제를 풀면서 흐름을 이어가면 됩니다.</p>
          ) : (
            <ul className="clean-list solved-clean-list">
              {pending.map((assignment) => (
                <li key={assignment.id} className="clean-list-item" onClick={() => onOpenProblem(assignment.problem_id)}>
                  <div className="clean-list-main">
                    <strong>{assignment.problem_title}</strong>
                    <span className="muted">
                      {assignment.title} · {assignment.assignment_type === "homework" ? "숙제" : "수업"}
                    </span>
                  </div>
                  <span className="muted mono clean-list-meta">{formatDate(assignment.due_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-section solved-panel">
          <header className="home-section-head solved-head">
            <h2>최근 제출</h2>
            <span className="muted small">{recentSubmissions.length}건</span>
          </header>
          {recentSubmissions.length === 0 ? (
            <p className="empty-inline">아직 제출 기록이 없어요. 첫 문제부터 가볍게 시작해 보세요.</p>
          ) : (
            <table className="data-table compact solved-table">
              <thead>
                <tr>
                  <th>문제</th>
                  <th>결과</th>
                  <th>테스트</th>
                </tr>
              </thead>
              <tbody>
                {recentSubmissions.map((submission) => {
                  const problem = problemMap.get(submission.problem_id);
                  return (
                    <tr key={submission.id} className="clickable" onClick={() => onOpenProblem(submission.problem_id)}>
                      <td>
                        <strong>{problem?.title ?? `문제 #${submission.problem_id}`}</strong>
                        <p className="muted">{formatDate(submission.created_at)}</p>
                      </td>
                      <td>
                        <StatusBadge status={submission.status} />
                      </td>
                      <td className="mono">
                        {submission.passed_tests}/{submission.total_tests}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="home-section solved-panel">
          <header className="home-section-head solved-head">
            <h2>난이도 현황</h2>
            <span className="muted small">풀이 누적 기준</span>
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
                      {stat.solved}
                      <span className="muted">/{stat.total}</span>
                    </span>
                    <span className="mastery-pct mono muted">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="home-section solved-panel">
          <header className="home-section-head solved-head">
            <h2>카테고리별 풀이</h2>
            <span className="muted small">상위 6개 분류</span>
          </header>
          {!metrics || metrics.categoryRows.length === 0 ? (
            <p className="empty-inline">아직 분류별 풀이 기록이 없어요.</p>
          ) : (
            <ul className="mastery-list">
              {metrics.categoryRows.slice(0, 6).map((row) => {
                const pct = row.total === 0 ? 0 : Math.round((row.solved / row.total) * 100);
                return (
                  <li key={row.name} className="mastery-row">
                    <div className="mastery-head">
                      <span className="mastery-cat">{row.name}</span>
                      <span className="mastery-count mono">
                        {row.solved}
                        <span className="muted">/{row.total}</span>
                      </span>
                      <span className="mastery-pct mono muted">{pct}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="home-section solved-panel solved-panel-wide">
          <header className="home-section-head solved-head">
            <h2>최근 30일 풀이 흐름</h2>
            <span className="muted small">
              활동일 {metrics?.activeDays ?? 0}일 · 정답 {metrics?.last30Solved ?? 0}개
            </span>
          </header>
          <div className="activity-strip solved-activity-strip">
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
      </div>
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
            {paused ? "실시간 일시정지" : "실시간 모니터링 중"}
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
          <h1>
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
              <th>시각</th>
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
                <td className="muted">{timeAgo(item.created_at)}</td>
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
  submissions: Submission[];
  userRole: UserRole;
}) {
  const { problems, categories, categoryFilter, difficultyFilter, problemFilter, onSearch, onCategory, onDifficulty, onOpen, submissions } = props;
  const solvedSet = new Set(submissions.filter((s) => s.status === "accepted").map((s) => s.problem_id));
  const pageSize = 12;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(problems.length / pageSize));
  const visibleProblems = useMemo(() => problems.slice((page - 1) * pageSize, page * pageSize), [page, problems]);

  useEffect(() => {
    setPage(1);
  }, [problemFilter, categoryFilter, difficultyFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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

      <table className="data-table problem-table">
        <thead>
          <tr>
            <th className="col-num">#</th>
            <th>분류</th>
            <th>제목</th>
            <th>난이도</th>
            <th className="col-time">시간 제한</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {problems.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">조건에 맞는 문제가 없습니다.</td>
            </tr>
          )}
          {visibleProblems.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => onOpen(p.id)}>
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
}) {
  const {
    user,
    problem,
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
  } = props;
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
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

  if (!problem) {
    return <div className="empty card">문제를 선택해주세요. 좌측 메뉴 [문제]에서 풀고 싶은 문제를 고를 수 있어요.</div>;
  }
  return (
    <div className="solve-grid">
      <section className="solve-left">
        <header className="problem-head">
          <div>
            <div className="problem-meta-top">
              <span className="mono muted">#{problem.id}</span>
              <DifficultyBadge level={problem.difficulty} />
              <span className="chip chip-soft">{problem.category_name}</span>
            </div>
            <h1>{problem.title}</h1>
            <div className="problem-limits">
              <span>시간 제한 {problem.time_limit_seconds.toFixed(1)}초</span>
              <span>메모리 {problem.memory_limit_mb}MB</span>
              <span>Python</span>
            </div>
          </div>
          {user.role === "teacher" && (
            <button className="btn btn-ghost btn-sm" onClick={onEditProblem}>
              이 문제 수정
            </button>
          )}
        </header>

        <div className="tab-bar">
          <button className={pane === "problem" ? "tab tab-active" : "tab"} onClick={() => setPane("problem")}>
            문제
          </button>
          <button className={pane === "history" ? "tab tab-active" : "tab"} onClick={() => setPane("history")}>
            내 제출 ({submissions.length})
          </button>
        </div>

        {pane === "problem" && (
          <div className="problem-body">
            <Section title="문제 설명">{problem.statement}</Section>
            <Section title="입력">{problem.input_description || "표준 입력을 사용합니다."}</Section>
            <Section title="출력">{problem.output_description || "표준 출력으로 결과를 출력합니다."}</Section>
            {problem.constraints && <Section title="제한">{problem.constraints}</Section>}

            <div className="sample-grid">
              <div>
                <h3>예제 입력</h3>
                <pre className="codeblock">{problem.sample_input || "예제가 없습니다."}</pre>
              </div>
              <div>
                <h3>예제 출력</h3>
                <pre className="codeblock">{problem.sample_output || "예제가 없습니다."}</pre>
              </div>
            </div>

            {problem.public_testcases.length > 0 && (
              <div>
                <h3 className="section-title">공개 테스트</h3>
                <div className="testcase-list">
                  {problem.public_testcases.map((tc, i) => (
                    <div key={i} className="testcase">
                      <div className="testcase-head">
                        <strong>테스트 {i + 1}</strong>
                        <span className="muted">{tc.note || "공개"}</span>
                      </div>
                      <div className="testcase-grid">
                        <pre className="codeblock">{tc.input_data}</pre>
                        <pre className="codeblock">{tc.expected_output}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {assignments.length > 0 && (
              <div className="info-banner">
                이 문제는 {assignments.length}개의 과제로 배정되어 있습니다.
              </div>
            )}
          </div>
        )}

        {pane === "history" && (
          <div className="problem-body">
            {submissions.length === 0 ? (
              <div className="empty">아직 이 문제에 대한 제출이 없습니다.</div>
            ) : (
              <table className="data-table">
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
                      className={selectedSubmission?.id === s.id ? "submission-row-active" : ""}
                      onClick={() => setSelectedSubmissionId(s.id)}
                    >
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="mono">
                        {s.passed_tests}/{s.total_tests}
                      </td>
                      <td className="mono muted">{s.runtime_ms}ms</td>
                      <td className="muted">{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {selectedSubmission && (
              <section className="submission-code-card">
                <header className="submission-code-head">
                  <div>
                    <strong>제출 코드 보기</strong>
                    <p className="muted">{formatDate(selectedSubmission.created_at)}</p>
                  </div>
                  <div className="submission-code-meta">
                    <StatusBadge status={selectedSubmission.status} />
                    <span className="mono muted">
                      {selectedSubmission.passed_tests}/{selectedSubmission.total_tests}
                    </span>
                  </div>
                </header>
                <pre className="codeblock submission-codeblock">{selectedSubmission.code}</pre>
              </section>
            )}
          </div>
        )}
      </section>

      <section className="solve-right">
        <header className="editor-head">
          <strong>Python 에디터</strong>
          <div className="editor-actions">
            {popupMode ? (
              <button className="btn btn-ghost" onClick={() => window.close()}>
                창 닫기
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={onOpenWindow}>
                큰 창으로 열기
              </button>
            )}
            <button className="btn btn-secondary" onClick={onRun} disabled={isRunning}>
              {isRunning ? "실행 중..." : "예제 실행"}
            </button>
            <button className="btn btn-primary" onClick={onSubmit} disabled={isRunning}>
              제출
            </button>
          </div>
        </header>
        <CodeEditor value={code} onChange={onChangeCode} />

        {stream && <GradingPanel stream={stream} isRunning={isRunning} />}
      </section>
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
                    <td className="muted">{row.last_submitted_at ? formatDate(row.last_submitted_at) : "-"}</td>
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

  return (
    <div className="page-stack list-page">
      <header className="page-head page-head-tight">
        <div>
          <h1>내 제출</h1>
          <p className="muted">최근 제출한 코드의 결과를 확인할 수 있습니다.</p>
        </div>
      </header>
      <section className="card">
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
                    onClick={() => setSelectedSubmissionId(s.id)}
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
                    <td className="muted">{formatDate(s.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {selectedSubmission && (
          <section className="submission-code-card">
            <header className="submission-code-head">
              <div>
                <strong>{map.get(selectedSubmission.problem_id)?.title ?? `문제 #${selectedSubmission.problem_id}`}</strong>
                <p className="muted">{formatDate(selectedSubmission.created_at)}</p>
              </div>
              <div className="submission-code-meta">
                <StatusBadge status={selectedSubmission.status} />
                <span className="mono muted">
                  {selectedSubmission.passed_tests}/{selectedSubmission.total_tests}
                </span>
              </div>
            </header>
            <pre className="codeblock submission-codeblock">{selectedSubmission.code}</pre>
          </section>
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
}) {
  const { categories, problemForm, setProblemForm, mode, onSubmit, onReset } = props;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  const filledCount = problemForm.testcases.filter(
    (tc) => tc.input_data.trim() || tc.expected_output.trim(),
  ).length;
  const tcValid = filledCount >= 10 && filledCount <= 50;

  function addEmpty(n: number) {
    setProblemForm((c) => ({
      ...c,
      testcases: [...c.testcases, ...Array.from({ length: n }, emptyTestcase)],
    }));
  }

  function removeEmpty() {
    setProblemForm((c) => {
      const kept = c.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim());
      return { ...c, testcases: kept.length > 0 ? kept : [emptyTestcase()] };
    });
  }

  function updateTestcase(index: number, patch: Partial<TestCase>) {
    setProblemForm((c) => ({
      ...c,
      testcases: c.testcases.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function deleteTestcase(index: number) {
    setProblemForm((c) => {
      const next = c.testcases.filter((_, i) => i !== index);
      return { ...c, testcases: next.length > 0 ? next : [emptyTestcase()] };
    });
  }

  function applyBulk() {
    setBulkError(null);
    const trimmed = bulkText.trim();
    if (!trimmed) {
      setBulkError("붙여넣을 내용이 없습니다.");
      return;
    }
    const blocks = trimmed.split(/^===+\s*$/m).map((b) => b.trim()).filter(Boolean);
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
    setProblemForm((c) => {
      const kept = c.testcases.filter((tc) => tc.input_data.trim() || tc.expected_output.trim());
      return { ...c, testcases: [...kept, ...parsed] };
    });
    setBulkText("");
    setBulkOpen(false);
  }

  return (
    <form className="manage-form" onSubmit={onSubmit}>
      <header className="manage-head">
        <div>
          <h1>{mode === "edit" ? "문제 수정" : "새 문제 만들기"}</h1>
          <p className="muted">
            필수 항목만 채워도 바로 출제할 수 있어요. 세부 설정은 아래 고급 설정에서 조정하세요.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
            처음부터 작성
          </button>
          <button type="submit" className="btn btn-primary" disabled={!tcValid}>
            {mode === "edit" ? "수정 저장" : "문제 등록"}
          </button>
        </div>
      </header>

      <section className="manage-block">
        <h2 className="manage-block-title">1. 기본 정보</h2>
        <div className="grid-2">
          <label>
            <span>문제 제목 *</span>
            <input
              placeholder="예: 숫자 뒤집기"
              value={problemForm.title}
              onChange={(e) => setProblemForm((c) => ({ ...c, title: e.target.value }))}
            />
          </label>
          <label>
            <span>한 줄 설명 *</span>
            <input
              placeholder="목록에 표시될 짧은 설명"
              value={problemForm.short_description}
              onChange={(e) => setProblemForm((c) => ({ ...c, short_description: e.target.value }))}
            />
          </label>
        </div>
        <div className="grid-3">
          <label>
            <span>분류</span>
            <select
              value={problemForm.category_id}
              onChange={(e) => setProblemForm((c) => ({ ...c, category_id: Number(e.target.value) }))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>난이도</span>
            <select
              value={problemForm.difficulty}
              onChange={(e) => setProblemForm((c) => ({ ...c, difficulty: e.target.value as Difficulty }))}
            >
              <option value="beginner">입문</option>
              <option value="basic">기초</option>
              <option value="intermediate">응용</option>
            </select>
          </label>
          <label>
            <span>시간 제한 (초)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={problemForm.time_limit_seconds}
              onChange={(e) =>
                setProblemForm((c) => ({ ...c, time_limit_seconds: Number(e.target.value) }))
              }
            />
          </label>
        </div>
      </section>

      <section className="manage-block">
        <h2 className="manage-block-title">2. 문제 내용</h2>
        <label>
          <span>문제 설명 *</span>
          <textarea
            rows={7}
            placeholder="문제가 요구하는 바를 자세히 적어주세요."
            value={problemForm.statement}
            onChange={(e) => setProblemForm((c) => ({ ...c, statement: e.target.value }))}
          />
        </label>
        <div className="grid-2">
          <label>
            <span>예제 입력</span>
            <textarea
              rows={4}
              value={problemForm.sample_input}
              onChange={(e) => setProblemForm((c) => ({ ...c, sample_input: e.target.value }))}
            />
          </label>
          <label>
            <span>예제 출력</span>
            <textarea
              rows={4}
              value={problemForm.sample_output}
              onChange={(e) => setProblemForm((c) => ({ ...c, sample_output: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <details className="manage-advanced">
        <summary>고급 설정 (입출력 설명, 제한사항, 스타터 코드, 메모리)</summary>
        <div className="grid-2">
          <label>
            <span>입력 형식 설명</span>
            <textarea
              rows={3}
              value={problemForm.input_description}
              onChange={(e) => setProblemForm((c) => ({ ...c, input_description: e.target.value }))}
            />
          </label>
          <label>
            <span>출력 형식 설명</span>
            <textarea
              rows={3}
              value={problemForm.output_description}
              onChange={(e) => setProblemForm((c) => ({ ...c, output_description: e.target.value }))}
            />
          </label>
        </div>
        <label>
          <span>제한사항</span>
          <textarea
            rows={2}
            placeholder="예: 1 ≤ N ≤ 1,000,000"
            value={problemForm.constraints}
            onChange={(e) => setProblemForm((c) => ({ ...c, constraints: e.target.value }))}
          />
        </label>
        <div className="grid-2">
          <label>
            <span>스타터 코드 (Python)</span>
            <textarea
              rows={4}
              value={problemForm.starter_code_python}
              onChange={(e) => setProblemForm((c) => ({ ...c, starter_code_python: e.target.value }))}
            />
          </label>
          <label>
            <span>메모리 제한 (MB)</span>
            <input
              type="number"
              value={problemForm.memory_limit_mb}
              onChange={(e) => setProblemForm((c) => ({ ...c, memory_limit_mb: Number(e.target.value) }))}
            />
          </label>
        </div>
      </details>

      <section className="manage-block">
        <div className="tc-head-row">
          <div>
            <h2 className="manage-block-title">3. 채점 테스트케이스</h2>
            <p className="muted small">
              엣지 케이스를 포함해 <strong>최소 10개, 최대 50개</strong>를 입력하세요.
            </p>
          </div>
          <div className={`tc-counter ${tcValid ? "tc-counter-ok" : "tc-counter-bad"}`}>
            <strong>{filledCount}</strong>
            <span className="muted"> / 10–50</span>
          </div>
        </div>

        <div className="tc-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(1)}>
            + 1개 추가
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(5)}>
            + 5개 추가
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addEmpty(10)}>
            + 10개 추가
          </button>
          <button
            type="button"
            className={`btn btn-sm ${bulkOpen ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setBulkOpen((o) => !o)}
          >
            {bulkOpen ? "일괄 입력 닫기" : "일괄 입력 / 붙여넣기"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={removeEmpty}>
            빈 칸 정리
          </button>
        </div>

        {bulkOpen && (
          <div className="bulk-editor">
            <p className="muted small">
              각 테스트는 <code>===</code>로 구분하고, 한 테스트 안에서 입력과 기대 출력은 <code>@@</code>로 구분합니다.
              예시:
            </p>
            <pre className="bulk-example">{`3 4
@@
7
===
10 20
@@
30
===
0 0
@@
0`}</pre>
            <textarea
              rows={8}
              placeholder="여러 테스트케이스를 한 번에 붙여넣기"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkError && <p className="bad small">{bulkError}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={applyBulk}>
                파싱해서 추가
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkText("")}>
                지우기
              </button>
            </div>
          </div>
        )}

        <div className="tc-compact-list">
          {problemForm.testcases.map((tc, index) => (
            <div key={index} className="tc-compact">
              <div className="tc-compact-head">
                <span className="tc-compact-num mono">#{index + 1}</span>
                <input
                  className="tc-compact-note"
                  placeholder="메모 (예: 엣지 - 최대값)"
                  value={tc.note}
                  onChange={(e) => updateTestcase(index, { note: e.target.value })}
                />
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={tc.is_public}
                    onChange={(e) => updateTestcase(index, { is_public: e.target.checked })}
                  />
                  <span>공개</span>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm tc-delete"
                  onClick={() => deleteTestcase(index)}
                  aria-label="삭제"
                >
                  ×
                </button>
              </div>
              <div className="tc-compact-io">
                <textarea
                  className="tc-compact-input"
                  rows={3}
                  placeholder="입력"
                  value={tc.input_data}
                  onChange={(e) => updateTestcase(index, { input_data: e.target.value })}
                />
                <textarea
                  className="tc-compact-output"
                  rows={3}
                  placeholder="기대 출력"
                  value={tc.expected_output}
                  onChange={(e) => updateTestcase(index, { expected_output: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="form-actions end">
        <button type="submit" className="btn btn-primary" disabled={!tcValid}>
          {mode === "edit" ? "수정 저장" : "문제 등록"}
        </button>
      </div>
    </form>
  );
}

function GradingPanel({ stream, isRunning }: { stream: StreamState; isRunning: boolean }) {
  const totalTests = Math.max(stream.total, stream.results.length);
  const overallPct = totalTests > 0 ? Math.round((stream.completed / totalTests) * 100) : 0;
  const slots = Array.from({ length: totalTests }, (_, index) => index);
  const passedSoFar = stream.results.filter((r) => r.status === "passed").length;
  const heading = stream.kind === "submit" ? "제출 채점" : "예제 실행";
  const subheading = stream.done
    ? stream.summary
      ? `${statusLabel(stream.summary.status)} · ${stream.summary.passed_tests}/${stream.summary.total_tests} 통과`
      : "완료"
    : isRunning
      ? `채점 중... ${stream.completed}/${stream.total || "?"}`
      : "대기 중";

  return (
    <div className="grading-panel">
      <header className="grading-header">
        <div className="grading-header-main">
          <strong>{heading}</strong>
          {stream.done && stream.summary ? (
            <StatusBadge status={stream.summary.status} />
          ) : (
            <span className="grading-live">
              <span className="live-dot" />
              LIVE
            </span>
          )}
        </div>
        <span className="muted mono">{subheading}</span>
      </header>

      <div className="overall-progress">
        <div
          className={`overall-progress-fill ${stream.done ? `progress-${statusTone(stream.summary?.status ?? "")}` : "progress-running"}`}
          style={{ width: `${overallPct}%` }}
        />
        <span className="overall-progress-label mono">
          {stream.completed}/{totalTests || "?"} · 통과 {passedSoFar}
        </span>
      </div>

      <ul className="tc-progress-list">
        {slots.map((i) => {
          const r = stream.results.find((rr) => rr.index === i);
          const tone = r ? statusTone(r.status) : "pending";
          const pct = r ? 100 : 0;
          return (
            <li key={i} className={`tc-progress-item tc-${tone}`}>
              <div className="tc-progress-head">
                <strong>테스트 {i + 1}</strong>
                {r ? (
                  <>
                    <StatusBadge status={r.status} />
                    <span className="muted mono">{r.runtime_ms}ms</span>
                  </>
                ) : i === stream.completed && isRunning ? (
                  <span className="muted grading-live">
                    <span className="live-dot" />
                    채점 중
                  </span>
                ) : (
                  <span className="muted">대기 중</span>
                )}
              </div>
              <div className="tc-progress-bar">
                <div
                  className={`tc-progress-bar-fill ${r ? `progress-${tone}` : i === stream.completed && isRunning ? "progress-running" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {r && (r.expected || r.actual || r.stderr) && (
                <div className="tc-progress-meta mono">
                  {r.expected && <span>기댓값: {r.expected.split("\n").join(" / ")}</span>}
                  {r.actual && <span>출력: {r.actual.split("\n").join(" / ")}</span>}
                  {r.stderr && <span className="bad">에러: {r.stderr.split("\n").join(" / ")}</span>}
                </div>
              )}
            </li>
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
