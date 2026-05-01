from datetime import datetime
from enum import Enum
from typing import List, Optional

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class UserRole(str, Enum):
    teacher = "teacher"
    student = "student"


class DifficultyLevel(str, Enum):
    beginner = "beginner"
    basic = "basic"
    intermediate = "intermediate"


class AssignmentType(str, Enum):
    homework = "homework"
    classroom = "classroom"


class SubmissionStatus(str, Enum):
    accepted = "accepted"
    wrong_answer = "wrong_answer"
    runtime_error = "runtime_error"
    time_limit = "time_limit"
    unsupported_language = "unsupported_language"


class SubmissionJobKind(str, Enum):
    run = "run"
    submit = "submit"


class SubmissionJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    display_name: str
    hashed_password: str
    role: UserRole = Field(default=UserRole.student)
    primary_teacher_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_by_teacher_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    is_primary_teacher: bool = Field(default=False)
    class_name: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Category(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: str = ""


class Problem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    short_description: str
    statement: str
    input_description: str = ""
    output_description: str = ""
    constraints: str = ""
    category_id: int = Field(foreign_key="category.id")
    difficulty: DifficultyLevel = Field(default=DifficultyLevel.beginner)
    supported_languages: str = "python"
    starter_code_python: str = ""
    sample_input: str = ""
    sample_output: str = ""
    time_limit_seconds: float = 2.0
    memory_limit_mb: int = 128
    created_by: int = Field(foreign_key="user.id")
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TestCase(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int = Field(foreign_key="problem.id")
    input_data: str
    expected_output: str
    is_public: bool = True
    note: str = ""


class Assignment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    problem_id: int = Field(foreign_key="problem.id")
    teacher_id: int = Field(foreign_key="user.id")
    student_id: int = Field(foreign_key="user.id")
    assignment_type: AssignmentType
    due_at: Optional[datetime] = None
    classroom_label: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Submission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int = Field(foreign_key="problem.id")
    user_id: int = Field(foreign_key="user.id")
    assignment_id: Optional[int] = Field(default=None, foreign_key="assignment.id")
    language: str = "python"
    code: str
    status: SubmissionStatus
    passed_tests: int = 0
    total_tests: int = 0
    runtime_ms: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SubmissionJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: SubmissionJobKind = Field(index=True)
    status: SubmissionJobStatus = Field(default=SubmissionJobStatus.queued, index=True)
    problem_id: int = Field(foreign_key="problem.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    assignment_id: Optional[int] = Field(default=None, foreign_key="assignment.id")
    language: str = "python"
    code: str = Field(sa_column=Column(Text))
    result_json: Optional[str] = Field(default=None, sa_column=Column(Text))
    error_message: Optional[str] = None
    submission_id: Optional[int] = Field(default=None, foreign_key="submission.id")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class UserCreate(SQLModel):
    username: str
    display_name: str
    password: str
    class_name: Optional[str] = None


class TeacherCreate(SQLModel):
    username: str
    display_name: str
    password: str


class StudentCreate(SQLModel):
    username: str
    display_name: str
    password: str
    class_name: str


class StudentUpdate(SQLModel):
    """학생 정보 수정용 스키마"""
    username: Optional[str] = None
    display_name: Optional[str] = None
    password: Optional[str] = None
    class_name: Optional[str] = None
    created_by_teacher_id: Optional[int] = None
    primary_teacher_id: Optional[int] = None


class TeacherUpdate(SQLModel):
    """선생님 정보 수정용 스키마"""
    username: Optional[str] = None
    display_name: Optional[str] = None
    password: Optional[str] = None


class UserRead(SQLModel):
    id: int
    username: str
    display_name: str
    role: UserRole
    primary_teacher_id: Optional[int] = None
    created_by_teacher_id: Optional[int] = None
    is_primary_teacher: bool = False
    class_name: Optional[str] = None


class ClassroomSummary(SQLModel):
    name: str
    student_count: int


class TokenResponse(SQLModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class TestCaseCreate(SQLModel):
    input_data: str
    expected_output: str
    is_public: bool = True
    note: str = ""


class TestCaseRead(SQLModel):
    id: int
    input_data: str
    expected_output: str
    is_public: bool
    note: str = ""


class TestCaseUpdate(SQLModel):
    """단일 테스트케이스 수정용 스키마"""
    input_data: Optional[str] = None
    expected_output: Optional[str] = None
    is_public: Optional[bool] = None
    note: Optional[str] = None


class ProblemCreate(SQLModel):
    title: str
    short_description: str
    statement: str
    input_description: str = ""
    output_description: str = ""
    constraints: str = ""
    category_id: int
    difficulty: DifficultyLevel = DifficultyLevel.beginner
    starter_code_python: str = ""
    sample_input: str = ""
    sample_output: str = ""
    time_limit_seconds: float = 2.0
    memory_limit_mb: int = 128
    testcases: List[TestCaseCreate] = Field(default_factory=list)


class ProblemUpdate(SQLModel):
    title: Optional[str] = None
    short_description: Optional[str] = None
    statement: Optional[str] = None
    input_description: Optional[str] = None
    output_description: Optional[str] = None
    constraints: Optional[str] = None
    category_id: Optional[int] = None
    difficulty: Optional[DifficultyLevel] = None
    starter_code_python: Optional[str] = None
    sample_input: Optional[str] = None
    sample_output: Optional[str] = None
    time_limit_seconds: Optional[float] = None
    memory_limit_mb: Optional[int] = None
    testcases: Optional[List[TestCaseCreate]] = None


class ProblemCard(SQLModel):
    id: int
    title: str
    short_description: str
    category_id: int
    category_name: str
    difficulty: DifficultyLevel
    time_limit_seconds: float
    supported_languages: List[str]


class ProblemDetail(ProblemCard):
    statement: str
    input_description: str
    output_description: str
    constraints: str
    sample_input: str
    sample_output: str
    starter_code_python: str
    memory_limit_mb: int
    public_testcases: List[TestCaseRead]
    all_testcases: Optional[List[TestCaseRead]] = None


class AssignmentCreate(SQLModel):
    title: str
    problem_id: int
    assignment_type: AssignmentType
    class_name: Optional[str] = None
    student_ids: List[int] = Field(default_factory=list)
    due_at: Optional[datetime] = None
    classroom_label: Optional[str] = None


class AssignmentUpdate(SQLModel):
    """단일 과제 수정용 스키마"""
    title: Optional[str] = None
    problem_id: Optional[int] = None
    assignment_type: Optional[AssignmentType] = None
    due_at: Optional[datetime] = None
    classroom_label: Optional[str] = None


class AssignmentGroup(SQLModel):
    group_key: str
    title: str
    problem_id: int
    problem_title: str
    category_name: str
    class_name: str
    classroom_label: Optional[str] = None
    assignment_type: AssignmentType
    due_at: Optional[datetime] = None
    created_at: datetime
    total_students: int
    completed_students: int
    completion_rate: float
    assignment_ids: List[int] = Field(default_factory=list)


class AssignmentGroupStudent(SQLModel):
    assignment_id: int
    student_id: int
    student_name: str
    student_username: str
    class_name: Optional[str] = None
    submitted: bool
    best_status: Optional[SubmissionStatus] = None
    best_passed: int = 0
    best_total: int = 0
    best_runtime_ms: int = 0
    attempts: int = 0
    last_submitted_at: Optional[datetime] = None


class AssignmentRead(SQLModel):
    id: int
    title: str
    problem_id: int
    problem_title: str
    category_name: str
    student_id: int
    student_name: str
    teacher_name: str
    assignment_type: AssignmentType
    due_at: Optional[datetime] = None
    classroom_label: Optional[str] = None
    submitted: bool = False


class RunCodeRequest(SQLModel):
    code: str
    language: str = "python"
    assignment_id: Optional[int] = None


class TestExecutionResult(SQLModel):
    index: int
    status: str
    stdout: str = ""
    stderr: str = ""
    expected: str = ""
    actual: str = ""
    runtime_ms: int = 0


class CodeExecutionResponse(SQLModel):
    status: str
    passed_tests: int
    total_tests: int
    results: List[TestExecutionResult]


class SubmissionJobCreateResponse(SQLModel):
    job_id: int
    status: SubmissionJobStatus
    queue_position: int


class SubmissionJobRead(SQLModel):
    id: int
    kind: SubmissionJobKind
    status: SubmissionJobStatus
    queue_position: int = 0
    result: Optional[CodeExecutionResponse] = None
    error_message: Optional[str] = None
    submission_id: Optional[int] = None


class DashboardSummary(SQLModel):
    assigned_count: int
    completed_count: int
    total_problems: int
    categories: List[Category]


class LeaderboardEntry(SQLModel):
    rank: int
    student_id: int
    student_name: str
    class_name: Optional[str] = None
    score: int
    solved: int
    attempts: int
    accuracy: float
    beginner_solved: int
    basic_solved: int
    intermediate_solved: int


class SubmissionFeedItem(SQLModel):
    id: int
    student_id: int
    student_name: str
    student_username: str
    class_name: Optional[str] = None
    problem_id: int
    problem_title: str
    category_name: str
    assignment_id: Optional[int] = None
    assignment_title: Optional[str] = None
    language: str
    status: SubmissionStatus
    passed_tests: int
    total_tests: int
    runtime_ms: int
    created_at: datetime


class BootstrapResponse(SQLModel):
    user: UserRead
    dashboard: DashboardSummary
    categories: List[Category]
    problems: List[ProblemCard]
    assignments: List[AssignmentRead]
    submissions: List[Submission]
    teachers: List[UserRead] = Field(default_factory=list)
    students: List[UserRead] = Field(default_factory=list)
    assignment_groups: List[AssignmentGroup] = Field(default_factory=list)
    leaderboard: List[LeaderboardEntry] = Field(default_factory=list)
