import json
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, update, delete as sa_delete
from sqlmodel import Session, select

from . import auth, judge
from .api.assignments import build_assignment_reads, list_assignment_groups, router as assignments_router
from .api.problem import router as problem_router
from .api.users import router as users_router
from .config import settings
from .db import create_db_and_tables, engine, get_session
from .models import (
    Assignment,
    AssignmentGroup,
    AssignmentRead,
    BootstrapResponse,
    Category,
    ClassroomSummary,
    CodeExecutionResponse,
    DashboardSummary,
    DifficultyLevel,
    LeaderboardEntry,
    Problem,
    ProblemCard,
    ProblemCreate,
    ProblemDetail,
    ProblemUpdate,
    RunCodeRequest,
    Submission,
    SubmissionJob,
    SubmissionJobCreateResponse,
    SubmissionJobKind,
    SubmissionJobRead,
    SubmissionJobStatus,
    SubmissionStatus,
    StudentCreate,
    TeacherCreate,
    TestCase,
    TestCaseRead,
    TestExecutionResult,
    TokenResponse,
    User,
    UserCreate,
    UserRead,
    UserRole,
)
from .seed import seed_initial_data
from .utils import category_lookup


app = FastAPI(title="Starlab Code MVP API")

_allowed_origins = settings.allow_origins
_allow_credentials = True
if "*" in _allowed_origins:
    # "*" with credentials is rejected by browsers; fall back to no credentials.
    _allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(assignments_router)
app.include_router(problem_router)
app.include_router(users_router)


_job_wakeup = threading.Event()
_job_worker_started = False
_job_worker_lock = threading.Lock()


@app.on_event("startup")
def on_startup() -> None:
    try:
        import anyio.to_thread

        limiter = anyio.to_thread.current_default_thread_limiter()
        limiter.total_tokens = max(limiter.total_tokens, settings.threadpool_size)
    except Exception:
        pass

    create_db_and_tables()
    reset_interrupted_jobs()
    if settings.seed_demo_data:
        with Session(engine) as session:
            seed_initial_data(session)
    start_submission_job_worker()


def to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        primary_teacher_id=user.primary_teacher_id,
        created_by_teacher_id=user.created_by_teacher_id,
        is_primary_teacher=user.is_primary_teacher,
        class_name=user.class_name,
    )


class LoginForm:
    def __init__(
        self,
        username: str = Form(...),
        password: str = Form(...),
        role: Optional[UserRole] = Form(default=None),
    ) -> None:
        self.username = username
        self.password = password
        self.role = role


def get_primary_teacher_id(user: User) -> int:
    return user.primary_teacher_id or user.id


def list_teachers_in_org(session: Session, current_user: User) -> List[User]:
    primary_teacher_id = get_primary_teacher_id(current_user)
    teachers = session.exec(
        select(User).where(
            User.role == UserRole.teacher,
            User.primary_teacher_id == primary_teacher_id,
        ).order_by(User.is_primary_teacher.desc(), User.display_name)
    ).all()
    return teachers


def list_students_for_teacher(session: Session, current_user: User) -> List[User]:
    statement = select(User).where(User.role == UserRole.student)
    if current_user.is_primary_teacher:
        org_teacher_ids = [t.id for t in list_teachers_in_org(session, current_user)]
        org_teacher_ids.append(current_user.id)
        statement = statement.where(User.primary_teacher_id.in_(org_teacher_ids))
    else:
        statement = statement.where(User.primary_teacher_id == current_user.id)
    return session.exec(statement.order_by(User.class_name, User.display_name)).all()


def validate_account_fields(username: str, display_name: str, password: str) -> tuple[str, str]:
    normalized_username = username.strip()
    normalized_display_name = display_name.strip()
    if not normalized_username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not normalized_display_name:
        raise HTTPException(status_code=400, detail="Display name is required")
    if not password.strip():
        raise HTTPException(status_code=400, detail="Password is required")
    return normalized_username, normalized_display_name


def ensure_unique_username(session: Session, username: str) -> None:
    existing = session.exec(select(User).where(User.username == username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")



def normalize_class_name(value: Optional[str], *, required: bool = False) -> Optional[str]:
    normalized = (value or "").strip()
    if normalized:
        return normalized
    if required:
        raise HTTPException(status_code=400, detail="Class name is required")
    return None


def to_problem_card(problem: Problem, category: Category) -> ProblemCard:
    return ProblemCard(
        id=problem.id,
        title=problem.title,
        short_description=problem.short_description,
        category_id=problem.category_id,
        category_name=category.name if category else "",
        difficulty=problem.difficulty,
        time_limit_seconds=problem.time_limit_seconds,
        supported_languages=[lang.strip() for lang in problem.supported_languages.split(",") if lang.strip()],
    )


def testcase_to_read(testcase: TestCase) -> TestCaseRead:
    return TestCaseRead(
        id=testcase.id,
        input_data=testcase.input_data,
        expected_output=testcase.expected_output,
        is_public=testcase.is_public,
        note=testcase.note,
    )


def to_problem_detail(problem: Problem, category: Category, public_tests: List[TestCase], all_tests: Optional[List[TestCase]] = None) -> ProblemDetail:
    return ProblemDetail(
        id=problem.id,
        title=problem.title,
        short_description=problem.short_description,
        category_id=problem.category_id,
        category_name=category.name if category else "",
        difficulty=problem.difficulty,
        time_limit_seconds=problem.time_limit_seconds,
        supported_languages=[lang.strip() for lang in problem.supported_languages.split(",") if lang.strip()],
        statement=problem.statement,
        input_description=problem.input_description,
        output_description=problem.output_description,
        constraints=problem.constraints,
        sample_input=problem.sample_input,
        sample_output=problem.sample_output,
        starter_code_python=problem.starter_code_python,
        memory_limit_mb=problem.memory_limit_mb,
        public_testcases=[testcase_to_read(testcase) for testcase in public_tests],
        all_testcases=[testcase_to_read(testcase) for testcase in all_tests] if all_tests is not None else None,
    )


def summarize_results(results: List[judge.TestResult]) -> str:
    statuses = [result.status for result in results]
    if statuses and all(status == "passed" for status in statuses):
        return SubmissionStatus.accepted.value
    if "time_limit" in statuses:
        return SubmissionStatus.time_limit.value
    if "runtime_error" in statuses:
        return SubmissionStatus.runtime_error.value
    if "unsupported_language" in statuses:
        return SubmissionStatus.unsupported_language.value
    return SubmissionStatus.wrong_answer.value


def result_to_response(result: judge.TestResult, is_public: bool) -> TestExecutionResult:
    return TestExecutionResult(
        index=result.index,
        status=result.status,
        stdout=result.stdout,
        stderr=result.stderr,
        expected=result.expected if is_public else "",
        actual=result.actual if is_public else "",
        runtime_ms=result.runtime_ms,
    )


@app.get("/")
def root():
    return {
        "name": "Starlab Code MVP API",
        "seeded_primary_teacher_username": settings.primary_teacher_username,
        "login_roles": [UserRole.teacher.value, UserRole.student.value],
    }


@app.get("/health")
def health():
    backend = "sqlite" if settings.database_url.startswith("sqlite") else "postgres"
    return {"status": "ok", "database_backend": backend}


def _parse_version(value: str) -> tuple[int, int, int]:
    parts = []
    for chunk in value.strip().lstrip("v").split("."):
        try:
            parts.append(int("".join(ch for ch in chunk if ch.isdigit()) or "0"))
        except ValueError:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


@app.get("/desktop/update")
def desktop_update(version: str = Query(default="0.0.0"), platform: str = Query(default="win32")):
    latest_version = settings.desktop_latest_version
    download_url = settings.desktop_download_url
    update_ready = bool(latest_version and download_url)
    update_available = update_ready and _parse_version(latest_version) > _parse_version(version)

    return {
        "available": update_available,
        "latest_version": latest_version or version,
        "current_version": version,
        "platform": platform,
        "download_url": download_url if update_available else "",
        "release_notes": settings.desktop_release_notes,
        "force_update": settings.desktop_force_update and update_available,
    }


@app.post("/auth/register", response_model=UserRead)
def register(payload: UserCreate, session: Session = Depends(get_session)):
    del payload, session
    raise HTTPException(status_code=403, detail="Public registration is disabled. Teachers must create accounts.")


@app.post("/auth/token", response_model=TokenResponse)
def login(form_data: LoginForm = Depends(), session: Session = Depends(get_session)):
    user = auth.get_user_by_username(session, form_data.username)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    session.expunge(user)
    session.close()
    if not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    if form_data.role and user.role != form_data.role:
        role_label = "teacher" if form_data.role == UserRole.teacher else "student"
        raise HTTPException(status_code=400, detail=f"This account is not allowed on the {role_label} login.")

    access_token = auth.create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=access_token, user=to_user_read(user))


@app.get("/auth/me", response_model=UserRead)
def me(current_user: User = Depends(auth.get_current_user)):
    return to_user_read(current_user)


def list_assignments_for_user(session: Session, current_user: User) -> List[AssignmentRead]:
    if current_user.role == UserRole.teacher:
        assignments = session.exec(
            select(Assignment).where(Assignment.teacher_id == current_user.id).order_by(Assignment.created_at.desc())
        ).all()
    else:
        assignments = session.exec(
            select(Assignment).where(Assignment.student_id == current_user.id).order_by(Assignment.created_at.desc())
        ).all()
    return build_assignment_reads(session, assignments)


@app.get("/dashboard", response_model=DashboardSummary)
def dashboard(
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
    _cached_students: Optional[List[User]] = None,
):
    total_problems = session.exec(select(func.count(Problem.id))).one()
    categories = session.exec(select(Category)).all()

    if current_user.role == UserRole.teacher:
        students = _cached_students if _cached_students is not None else list_students_for_teacher(session, current_user)
        student_ids = [s.id for s in students]
        assigned_count = session.exec(
            select(func.count(Assignment.id)).where(Assignment.teacher_id == current_user.id)
        ).one()
        accepted_count = session.exec(
            select(func.count(Submission.id)).where(
                Submission.status == SubmissionStatus.accepted,
                Submission.user_id.in_(student_ids),
            )
        ).one() if student_ids else 0
        return DashboardSummary(
            assigned_count=assigned_count,
            completed_count=accepted_count,
            total_problems=total_problems,
            categories=categories,
        )

    assigned_count = session.exec(
        select(func.count(Assignment.id)).where(Assignment.student_id == current_user.id)
    ).one()
    accepted_count = session.exec(
        select(func.count(Submission.id)).where(
            Submission.user_id == current_user.id,
            Submission.status == SubmissionStatus.accepted,
        )
    ).one()
    return DashboardSummary(
        assigned_count=assigned_count,
        completed_count=accepted_count,
        total_problems=total_problems,
        categories=categories,
    )


@app.get("/leaderboard", response_model=List[LeaderboardEntry])
def leaderboard(
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    if current_user.role == UserRole.student:
        students = session.exec(
            select(User).where(
                User.role == UserRole.student,
                User.primary_teacher_id == current_user.primary_teacher_id,
            )
        ).all()
    elif current_user.is_primary_teacher:
        org_teacher_ids = [t.id for t in list_teachers_in_org(session, current_user)]
        org_teacher_ids.append(current_user.id)
        students = session.exec(
            select(User).where(
                User.role == UserRole.student,
                User.primary_teacher_id.in_(org_teacher_ids),
            )
        ).all()
    else:
        students = session.exec(
            select(User).where(
                User.role == UserRole.student,
                User.primary_teacher_id == current_user.id,
            )
        ).all()
    if not students:
        return []

    student_ids = [student.id for student in students]
    submissions = session.exec(
        select(Submission).where(Submission.user_id.in_(student_ids))
    ).all()
    problem_ids_used = {sub.problem_id for sub in submissions}
    problems = (
        {p.id: p for p in session.exec(select(Problem).where(Problem.id.in_(problem_ids_used))).all()}
        if problem_ids_used else {}
    )

    score_per_difficulty = {
        DifficultyLevel.beginner: 1,
        DifficultyLevel.basic: 3,
        DifficultyLevel.intermediate: 5,
    }

    buckets: Dict[int, Dict[str, object]] = {}
    for student in students:
        buckets[student.id] = {
            "attempts": 0,
            "accepted": 0,
            "solved_problems": set(),
            "solved_by_diff": {
                DifficultyLevel.beginner: set(),
                DifficultyLevel.basic: set(),
                DifficultyLevel.intermediate: set(),
            },
        }

    for sub in submissions:
        bucket = buckets.get(sub.user_id)
        if not bucket:
            continue
        bucket["attempts"] += 1
        if sub.status != SubmissionStatus.accepted:
            continue
        bucket["accepted"] += 1
        if sub.problem_id in bucket["solved_problems"]:
            continue
        bucket["solved_problems"].add(sub.problem_id)
        problem = problems.get(sub.problem_id)
        if not problem:
            continue
        diff_set = bucket["solved_by_diff"].get(problem.difficulty)
        if diff_set is not None:
            diff_set.add(sub.problem_id)

    rows = []
    for student in students:
        bucket = buckets[student.id]
        beginner = len(bucket["solved_by_diff"][DifficultyLevel.beginner])
        basic = len(bucket["solved_by_diff"][DifficultyLevel.basic])
        intermediate = len(bucket["solved_by_diff"][DifficultyLevel.intermediate])
        score = (
            beginner * score_per_difficulty[DifficultyLevel.beginner]
            + basic * score_per_difficulty[DifficultyLevel.basic]
            + intermediate * score_per_difficulty[DifficultyLevel.intermediate]
        )
        attempts = bucket["attempts"]
        accuracy = 0.0 if attempts == 0 else round(bucket["accepted"] / attempts * 100, 1)
        rows.append(
            {
                "student_id": student.id,
                "student_name": student.display_name,
                "class_name": student.class_name,
                "score": score,
                "solved": len(bucket["solved_problems"]),
                "attempts": attempts,
                "accuracy": accuracy,
                "beginner_solved": beginner,
                "basic_solved": basic,
                "intermediate_solved": intermediate,
            }
        )

    rows.sort(key=lambda row: (-row["score"], -row["accuracy"], row["student_name"]))

    entries: List[LeaderboardEntry] = []
    last_rank = 0
    last_key: Optional[tuple] = None
    for index, row in enumerate(rows):
        key = (row["score"], row["accuracy"])
        if key == last_key:
            rank = last_rank
        else:
            rank = index + 1
            last_rank = rank
            last_key = key
        entries.append(LeaderboardEntry(rank=rank, **row))

    return entries


@app.get("/categories", response_model=List[Category])
def list_categories(session: Session = Depends(get_session)):
    return session.exec(select(Category).order_by(Category.name)).all()


@app.get("/classrooms", response_model=List[ClassroomSummary])
def list_classrooms(
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    students = list_students_for_teacher(session, current_user)
    counts: Dict[str, int] = {}
    for student in students:
        class_name = normalize_class_name(student.class_name)
        if not class_name:
            continue
        counts[class_name] = counts.get(class_name, 0) + 1
    return [ClassroomSummary(name=name, student_count=counts[name]) for name in sorted(counts)]


@app.get("/students", response_model=List[UserRead])
def list_students(
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    students = list_students_for_teacher(session, current_user)
    return [to_user_read(student) for student in students]


@app.get("/teachers", response_model=List[UserRead])
def list_teachers(
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    teachers = list_teachers_in_org(session, current_user)
    return [to_user_read(teacher) for teacher in teachers]


@app.post("/users/teachers", response_model=UserRead)
def create_teacher_account(
    payload: TeacherCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    username, display_name = validate_account_fields(payload.username, payload.display_name, payload.password)
    ensure_unique_username(session, username)

    teacher = User(
        username=username,
        display_name=display_name,
        hashed_password=auth.get_password_hash(payload.password),
        role=UserRole.teacher,
        primary_teacher_id=get_primary_teacher_id(current_user),
        created_by_teacher_id=current_user.id,
        is_primary_teacher=False,
    )
    session.add(teacher)
    session.commit()
    session.refresh(teacher)
    return to_user_read(teacher)


@app.post("/users/students", response_model=UserRead)
def create_student_account(
    payload: StudentCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    username, display_name = validate_account_fields(payload.username, payload.display_name, payload.password)
    ensure_unique_username(session, username)
    class_name = normalize_class_name(payload.class_name, required=True)

    student = User(
        username=username,
        display_name=display_name,
        hashed_password=auth.get_password_hash(payload.password),
        role=UserRole.student,
        class_name=class_name,
        primary_teacher_id=current_user.id,
        created_by_teacher_id=current_user.id,
        is_primary_teacher=False,
    )
    session.add(student)
    session.commit()
    session.refresh(student)
    return to_user_read(student)


def _delete_student_records(session: Session, student: User) -> None:
    assignments = session.exec(select(Assignment).where(Assignment.student_id == student.id)).all()
    assignment_ids = [a.id for a in assignments]
    cond = or_(Submission.user_id == student.id)
    if assignment_ids:
        cond = or_(Submission.user_id == student.id, Submission.assignment_id.in_(assignment_ids))
    submissions = session.exec(select(Submission).where(cond)).all()
    for submission in submissions:
        session.delete(submission)
    for assignment in assignments:
        session.delete(assignment)
    session.delete(student)


@app.delete("/users/students/{student_id}")
def delete_student_account(
    student_id: int,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    student = session.get(User, student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="Student not found")

    primary_teacher_id = get_primary_teacher_id(current_user)
    assigned_teacher = session.get(User, student.primary_teacher_id) if student.primary_teacher_id else None
    if assigned_teacher is None or get_primary_teacher_id(assigned_teacher) != primary_teacher_id:
        raise HTTPException(status_code=403, detail="Cannot delete a student from another organization")
    if not current_user.is_primary_teacher and student.primary_teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the assigned teacher or primary teacher can delete this student")

    _delete_student_records(session, student)
    session.commit()
    return {"ok": True}


@app.delete("/users/teachers/{teacher_id}")
def delete_teacher_account(
    teacher_id: int,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    if not current_user.is_primary_teacher:
        raise HTTPException(status_code=403, detail="Only the primary teacher can delete teacher accounts")
    if teacher_id == current_user.id:
        raise HTTPException(status_code=400, detail="Primary teacher account cannot delete itself")

    teacher = session.get(User, teacher_id)
    if not teacher or teacher.role != UserRole.teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    if teacher.is_primary_teacher or get_primary_teacher_id(teacher) != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete this teacher")

    session.exec(
        update(User)
        .where(User.created_by_teacher_id == teacher.id)
        .values(created_by_teacher_id=current_user.id, primary_teacher_id=current_user.id)
    )

    assignment_ids = [a.id for a in session.exec(
        select(Assignment.id).where(Assignment.teacher_id == teacher.id)
    ).all()]
    if assignment_ids:
        session.exec(
            update(Submission)
            .where(Submission.assignment_id.in_(assignment_ids))
            .values(assignment_id=None)
        )
    session.exec(sa_delete(Assignment).where(Assignment.teacher_id == teacher.id))

    session.exec(
        update(Problem)
        .where(Problem.created_by == teacher.id)
        .values(created_by=current_user.id)
    )

    session.delete(teacher)
    session.commit()
    return {"ok": True}


@app.get("/problems", response_model=List[ProblemCard])
def list_problems(
    category_id: Optional[int] = Query(default=None),
    search: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    statement = select(Problem)
    if category_id:
        statement = statement.where(Problem.category_id == category_id)
    if search:
        statement = statement.where(Problem.title.contains(search))

    problems = session.exec(statement.order_by(Problem.id.desc())).all()
    categories = category_lookup(session)
    return [to_problem_card(problem, categories.get(problem.category_id)) for problem in problems]


@app.get("/problems/{problem_id}", response_model=ProblemDetail)
def get_problem(
    problem_id: int,
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    public_tests = session.exec(
        select(TestCase).where(TestCase.problem_id == problem_id, TestCase.is_public == True).order_by(TestCase.id)
    ).all()
    categories = category_lookup(session)

    all_tests = None
    if current_user.role == UserRole.teacher:
        all_tests = session.exec(select(TestCase).where(TestCase.problem_id == problem_id).order_by(TestCase.id)).all()

    return to_problem_detail(problem, categories.get(problem.category_id), public_tests, all_tests)


def _validate_testcase_count(testcases) -> None:
    non_empty = [tc for tc in testcases if tc.input_data.strip() or tc.expected_output.strip()]
    if len(non_empty) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"테스트케이스는 최소 10개 이상이어야 합니다. (현재 {len(non_empty)}개)",
        )
    if len(non_empty) > 50:
        raise HTTPException(
            status_code=400,
            detail=f"테스트케이스는 최대 50개까지만 등록할 수 있습니다. (현재 {len(non_empty)}개)",
        )


@app.post("/problems", response_model=ProblemDetail)
def create_problem(
    payload: ProblemCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    category = session.get(Category, payload.category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    _validate_testcase_count(payload.testcases)

    problem = Problem(
        title=payload.title,
        short_description=payload.short_description,
        statement=payload.statement,
        input_description=payload.input_description,
        output_description=payload.output_description,
        constraints=payload.constraints,
        category_id=payload.category_id,
        difficulty=payload.difficulty,
        starter_code_python=payload.starter_code_python,
        sample_input=payload.sample_input,
        sample_output=payload.sample_output,
        time_limit_seconds=payload.time_limit_seconds,
        memory_limit_mb=payload.memory_limit_mb,
        created_by=current_user.id,
        updated_at=datetime.utcnow(),
    )
    session.add(problem)
    session.commit()
    session.refresh(problem)

    for testcase in payload.testcases:
        session.add(
            TestCase(
                problem_id=problem.id,
                input_data=testcase.input_data,
                expected_output=testcase.expected_output,
                is_public=testcase.is_public,
                note=testcase.note,
            )
        )
    session.commit()

    tests = session.exec(select(TestCase).where(TestCase.problem_id == problem.id).order_by(TestCase.id)).all()
    public_tests = [testcase for testcase in tests if testcase.is_public]
    return to_problem_detail(problem, category, public_tests, tests)


@app.put("/problems/{problem_id}", response_model=ProblemDetail)
def update_problem(
    problem_id: int,
    payload: ProblemUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    del current_user
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    update_data = payload.dict(exclude_unset=True)
    testcase_payloads = update_data.pop("testcases", None)
    if testcase_payloads is not None:
        _validate_testcase_count(payload.testcases or [])
    for key, value in update_data.items():
        setattr(problem, key, value)
    problem.updated_at = datetime.utcnow()
    session.add(problem)

    if testcase_payloads is not None:
        existing_tests = session.exec(select(TestCase).where(TestCase.problem_id == problem_id)).all()
        for testcase in existing_tests:
            session.delete(testcase)
        session.flush()
        for testcase in testcase_payloads:
            session.add(
                TestCase(
                    problem_id=problem_id,
                    input_data=testcase.input_data,
                    expected_output=testcase.expected_output,
                    is_public=testcase.is_public,
                    note=testcase.note,
                )
            )

    session.commit()
    session.refresh(problem)

    category = session.get(Category, problem.category_id)
    tests = session.exec(select(TestCase).where(TestCase.problem_id == problem_id).order_by(TestCase.id)).all()
    public_tests = [testcase for testcase in tests if testcase.is_public]
    return to_problem_detail(problem, category, public_tests, tests)


@app.get("/submissions")
def list_submissions(
    problem_id: Optional[int] = Query(default=None),
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
    _cached_student_ids: Optional[List[int]] = None,
):
    statement = select(Submission)
    if current_user.role == UserRole.student:
        statement = statement.where(Submission.user_id == current_user.id)
    else:
        teacher_student_ids = _cached_student_ids if _cached_student_ids is not None \
            else [s.id for s in list_students_for_teacher(session, current_user)]
        if not teacher_student_ids:
            return []
        statement = statement.where(Submission.user_id.in_(teacher_student_ids))
    if problem_id:
        statement = statement.where(Submission.problem_id == problem_id)
    submissions = session.exec(statement.order_by(Submission.created_at.desc())).all()
    return submissions


@app.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap(
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    teachers: List[UserRead] = []
    student_objects: List[User] = []
    student_ids: List[int] = []
    assignment_groups: List[AssignmentGroup] = []
    if current_user.role == UserRole.teacher:
        teachers = [to_user_read(t) for t in list_teachers_in_org(session, current_user)]
        student_objects = list_students_for_teacher(session, current_user)
        student_ids = [s.id for s in student_objects]
        assignment_groups = list_assignment_groups(current_user=current_user, session=session)

    return BootstrapResponse(
        user=to_user_read(current_user),
        dashboard=dashboard(current_user=current_user, session=session, _cached_students=student_objects),
        categories=list_categories(session=session),
        problems=list_problems(session=session),
        assignments=list_assignments_for_user(session, current_user),
        submissions=list_submissions(current_user=current_user, session=session, _cached_student_ids=student_ids),
        teachers=teachers,
        students=[to_user_read(s) for s in student_objects],
        assignment_groups=assignment_groups,
        leaderboard=leaderboard(current_user=current_user, session=session),
    )


# --- DISABLED: real-time submission feed -------------------------------------
# Temporarily disabled because the teacher-side polling (every 10s per teacher)
# was a steady source of DB connection pressure on Render's free tier and was
# implicated in repeated SQLAlchemy QueuePool timeouts. Kept (commented) so it
# can be re-enabled when the service moves to a larger plan or to Fly.io.
#
# @app.get("/submissions/feed", response_model=List[SubmissionFeedItem])
# def submission_feed(
#     limit: int = Query(default=50, ge=1, le=100),
#     since_id: Optional[int] = Query(default=None),
#     current_user: User = Depends(auth.require_teacher),
#     session: Session = Depends(get_session),
# ):
#     statement = (
#         select(Submission, User, Problem)
#         .join(User, Submission.user_id == User.id)
#         .join(Problem, Submission.problem_id == Problem.id)
#     )
#     if current_user.is_primary_teacher:
#         org_teacher_ids = [t.id for t in list_teachers_in_org(session, current_user)]
#         org_teacher_ids.append(current_user.id)
#         statement = statement.where(User.primary_teacher_id.in_(org_teacher_ids))
#     else:
#         statement = statement.where(User.primary_teacher_id == current_user.id)
#     if since_id is not None:
#         statement = statement.where(Submission.id > since_id)
#
#     rows = session.exec(
#         statement.order_by(Submission.created_at.desc()).limit(limit)
#     ).all()
#     if not rows:
#         return []
#
#     assignment_ids = {sub.assignment_id for sub, _user, _problem in rows if sub.assignment_id is not None}
#     assignments_map: Dict[int, Assignment] = {}
#     if assignment_ids:
#         assignments_map = {
#             a.id: a
#             for a in session.exec(
#                 select(Assignment).where(Assignment.id.in_(assignment_ids))
#             ).all()
#         }
#     categories = category_lookup(session)
#
#     feed: List[SubmissionFeedItem] = []
#     for sub, student, problem in rows:
#         category = categories.get(problem.category_id) if problem else None
#         assignment = assignments_map.get(sub.assignment_id) if sub.assignment_id else None
#         feed.append(
#             SubmissionFeedItem(
#                 id=sub.id,
#                 student_id=sub.user_id,
#                 student_name=student.display_name if student else "(알 수 없음)",
#                 student_username=student.username if student else "",
#                 class_name=student.class_name if student else None,
#                 problem_id=sub.problem_id,
#                 problem_title=problem.title if problem else "",
#                 category_name=category.name if category else "",
#                 assignment_id=sub.assignment_id,
#                 assignment_title=assignment.title if assignment else None,
#                 language=sub.language,
#                 status=sub.status,
#                 passed_tests=sub.passed_tests,
#                 total_tests=sub.total_tests,
#                 runtime_ms=sub.runtime_ms,
#                 created_at=sub.created_at,
#             )
#         )
#     return feed
# --- END DISABLED ------------------------------------------------------------


def fetch_tests(session: Session, problem_id: int, public_only: bool) -> List[TestCase]:
    statement = select(TestCase).where(TestCase.problem_id == problem_id)
    if public_only:
        statement = statement.where(TestCase.is_public == True)
    return session.exec(statement.order_by(TestCase.id)).all()


def validate_submission_assignment(
    session: Session,
    assignment_id: Optional[int],
    problem_id: int,
    current_user: User,
) -> Optional[Assignment]:
    if assignment_id is None:
        return None

    assignment = session.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.problem_id != problem_id:
        raise HTTPException(status_code=400, detail="Assignment does not match this problem")
    if assignment.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the assigned student can submit this assignment")
    return assignment


def reset_interrupted_jobs() -> None:
    with Session(engine) as session:
        jobs = session.exec(
            select(SubmissionJob).where(SubmissionJob.status == SubmissionJobStatus.running)
        ).all()
        for job in jobs:
            job.status = SubmissionJobStatus.queued
            job.started_at = None
            session.add(job)
        session.commit()


def start_submission_job_worker() -> None:
    global _job_worker_started
    with _job_worker_lock:
        if _job_worker_started:
            return
        worker = threading.Thread(target=submission_job_worker_loop, daemon=True, name="submission-job-worker")
        worker.start()
        _job_worker_started = True


def submission_job_worker_loop() -> None:
    while True:
        try:
            processed = process_next_submission_job()
            if not processed:
                _job_wakeup.wait(timeout=2.0)
                _job_wakeup.clear()
        except Exception:
            time.sleep(1.0)


def process_next_submission_job() -> bool:
    with Session(engine) as session:
        job = session.exec(
            select(SubmissionJob)
            .where(SubmissionJob.status == SubmissionJobStatus.queued)
            .order_by(SubmissionJob.created_at, SubmissionJob.id)
        ).first()
        if not job:
            return False
        job.status = SubmissionJobStatus.running
        job.started_at = datetime.utcnow()
        session.add(job)
        session.commit()
        job_id = job.id
    if job_id is None:
        return True

    try:
        with Session(engine) as session:
            job = session.get(SubmissionJob, job_id)
            if not job:
                return True
            problem = session.get(Problem, job.problem_id)
            if not problem:
                raise ValueError("Problem not found")
            tests = fetch_tests(session, job.problem_id, public_only=job.kind == SubmissionJobKind.run)
            if not tests:
                raise ValueError("No testcases configured")
            payload = RunCodeRequest(code=job.code, language=job.language, assignment_id=job.assignment_id)
            session.expunge_all()

        execution = execute_problem(problem, payload, tests)

        with Session(engine) as session:
            job = session.get(SubmissionJob, job_id)
            if not job:
                return True
            submission_id: Optional[int] = None
            if job.kind == SubmissionJobKind.submit:
                submission = Submission(
                    problem_id=job.problem_id,
                    user_id=job.user_id,
                    assignment_id=job.assignment_id,
                    language=job.language,
                    code=job.code,
                    status=SubmissionStatus(execution.status),
                    passed_tests=execution.passed_tests,
                    total_tests=execution.total_tests,
                    runtime_ms=max((result.runtime_ms for result in execution.results), default=0),
                )
                session.add(submission)
                session.commit()
                session.refresh(submission)
                submission_id = submission.id
                job = session.get(SubmissionJob, job_id)
                if not job:
                    return True
            job.status = SubmissionJobStatus.completed
            job.completed_at = datetime.utcnow()
            job.result_json = json.dumps(execution.dict(), default=str)
            job.submission_id = submission_id
            session.add(job)
            session.commit()
    except Exception as exc:
        with Session(engine) as session:
            job = session.get(SubmissionJob, job_id)
            if job:
                job.status = SubmissionJobStatus.failed
                job.error_message = str(exc)
                job.completed_at = datetime.utcnow()
                session.add(job)
                session.commit()
    return True


def submission_job_queue_position(session: Session, job: SubmissionJob) -> int:
    if job.status == SubmissionJobStatus.running:
        return 0
    if job.status != SubmissionJobStatus.queued or job.id is None:
        return 0
    running_count = session.exec(
        select(func.count(SubmissionJob.id)).where(SubmissionJob.status == SubmissionJobStatus.running)
    ).one()
    queued_ids = session.exec(
        select(SubmissionJob.id)
        .where(SubmissionJob.status == SubmissionJobStatus.queued)
        .order_by(SubmissionJob.created_at, SubmissionJob.id)
    ).all()
    try:
        return running_count + queued_ids.index(job.id) + 1
    except ValueError:
        return running_count + 1


def submission_job_to_read(session: Session, job: SubmissionJob) -> SubmissionJobRead:
    result = None
    if job.result_json:
        result = CodeExecutionResponse.parse_obj(json.loads(job.result_json))
    return SubmissionJobRead(
        id=job.id or 0,
        kind=job.kind,
        status=job.status,
        queue_position=submission_job_queue_position(session, job),
        result=result,
        error_message=job.error_message,
        submission_id=job.submission_id,
    )


def enqueue_submission_job(
    problem_id: int,
    payload: RunCodeRequest,
    kind: SubmissionJobKind,
    current_user: User,
) -> SubmissionJobCreateResponse:
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")
        assignment_id = None
        if kind == SubmissionJobKind.submit:
            assignment = validate_submission_assignment(session, payload.assignment_id, problem_id, current_user)
            assignment_id = assignment.id if assignment else None
        tests = fetch_tests(session, problem_id, public_only=kind == SubmissionJobKind.run)
        if not tests:
            raise HTTPException(status_code=400, detail="No testcases configured")
        job = SubmissionJob(
            kind=kind,
            status=SubmissionJobStatus.queued,
            problem_id=problem_id,
            user_id=current_user.id or 0,
            assignment_id=assignment_id,
            language=payload.language,
            code=payload.code,
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        position = submission_job_queue_position(session, job)
        job_id = job.id or 0
        job_status = job.status
    _job_wakeup.set()
    return SubmissionJobCreateResponse(job_id=job_id, status=job_status, queue_position=position)


def execute_problem(problem: Problem, payload: RunCodeRequest, tests: List[TestCase]) -> CodeExecutionResponse:
    test_inputs = [{"input": testcase.input_data, "expected": testcase.expected_output} for testcase in tests]
    raw_results = judge.run_code(
        language=payload.language,
        code=payload.code,
        tests=test_inputs,
        timeout_per_test=problem.time_limit_seconds,
    )
    status = summarize_results(raw_results)
    passed_tests = sum(1 for result in raw_results if result.status == "passed")
    response_results = [
        result_to_response(result, tests[index].is_public)
        for index, result in enumerate(raw_results)
    ]
    return CodeExecutionResponse(
        status=status,
        passed_tests=passed_tests,
        total_tests=len(raw_results),
        results=response_results,
    )


@app.post("/problems/{problem_id}/run/jobs", response_model=SubmissionJobCreateResponse)
def enqueue_visible_tests(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    return enqueue_submission_job(problem_id, payload, SubmissionJobKind.run, current_user)


@app.post("/problems/{problem_id}/submit/jobs", response_model=SubmissionJobCreateResponse)
def enqueue_submit_solution(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    return enqueue_submission_job(problem_id, payload, SubmissionJobKind.submit, current_user)


@app.get("/submission-jobs/{job_id}", response_model=SubmissionJobRead)
def get_submission_job(
    job_id: int,
    current_user: User = Depends(auth.get_current_user),
):
    with Session(engine) as session:
        job = session.get(SubmissionJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Submission job not found")
        if current_user.role != UserRole.teacher and job.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Cannot view this submission job")
        return submission_job_to_read(session, job)


@app.post("/problems/{problem_id}/run", response_model=CodeExecutionResponse)
def run_visible_tests(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    raise HTTPException(status_code=410, detail="Direct grading is disabled. Use /run/jobs instead.")
    del current_user
    # Release the DB connection before invoking the judge subprocess.
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")
        tests = fetch_tests(session, problem_id, public_only=True)
        session.expunge_all()
    if not tests:
        raise HTTPException(status_code=400, detail="No public testcases configured")

    return execute_problem(problem, payload, tests)


@app.post("/problems/{problem_id}/submit", response_model=CodeExecutionResponse)
def submit_solution(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    raise HTTPException(status_code=410, detail="Direct grading is disabled. Use /submit/jobs instead.")
    # Phase 1: load everything we need, then release the connection.
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")
        assignment = validate_submission_assignment(session, payload.assignment_id, problem_id, current_user)
        assignment_id = assignment.id if assignment else None
        tests = fetch_tests(session, problem_id, public_only=False)
        session.expunge_all()
    if not tests:
        raise HTTPException(status_code=400, detail="No testcases configured")

    # Phase 2: judge without holding any DB connection (this is the slow part).
    execution = execute_problem(problem, payload, tests)

    # Phase 3: persist the submission with a fresh, short-lived session.
    with Session(engine) as session:
        submission = Submission(
            problem_id=problem_id,
            user_id=current_user.id,
            assignment_id=assignment_id,
            language=payload.language,
            code=payload.code,
            status=SubmissionStatus(execution.status),
            passed_tests=execution.passed_tests,
            total_tests=execution.total_tests,
            runtime_ms=max((result.runtime_ms for result in execution.results), default=0),
        )
        session.add(submission)
        session.commit()

    return execution


def stream_execution(
    problem: Problem,
    payload: RunCodeRequest,
    tests: List[TestCase],
    on_complete=None,
):
    """Yield NDJSON lines for each test result plus start/done envelopes."""

    def _iter():
        yield json.dumps({"kind": "start", "total": len(tests)}) + "\n"
        collected: List[judge.TestResult] = []
        test_inputs = [{"input": tc.input_data, "expected": tc.expected_output} for tc in tests]
        for result in judge.run_code_iter(
            language=payload.language,
            code=payload.code,
            tests=test_inputs,
            timeout_per_test=problem.time_limit_seconds,
        ):
            collected.append(result)
            is_public = tests[result.index].is_public
            payload_dict = result_to_response(result, is_public).dict()
            payload_dict["kind"] = "result"
            yield json.dumps(payload_dict, default=str) + "\n"

        status = summarize_results(collected)
        passed = sum(1 for result in collected if result.status == "passed")
        runtime_ms = max((result.runtime_ms for result in collected), default=0)
        extra = on_complete(status, passed, runtime_ms) if on_complete else {}
        done = {
            "kind": "done",
            "status": status,
            "passed_tests": passed,
            "total_tests": len(collected),
            "runtime_ms": runtime_ms,
        }
        done.update(extra or {})
        yield json.dumps(done, default=str) + "\n"

    return _iter()


@app.post("/problems/{problem_id}/run/stream")
def run_visible_tests_stream(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    raise HTTPException(status_code=410, detail="Direct streaming grading is disabled. Use /run/jobs instead.")
    del current_user
    # Open and close the DB session before streaming so the connection is not
    # held while the (potentially slow) judge subprocess runs. On Render's
    # 0.1 vCPU free tier judging can take several seconds per submission;
    # holding a pooled connection through the StreamingResponse exhausts the
    # SQLAlchemy QueuePool with only a handful of concurrent users.
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")
        tests = fetch_tests(session, problem_id, public_only=True)
        # Fully detach loaded ORM objects from the session before it closes
        # so the streaming generator can use them without lazy-loading.
        session.expunge_all()
    if not tests:
        raise HTTPException(status_code=400, detail="No public testcases configured")

    return StreamingResponse(
        stream_execution(problem, payload, tests),
        media_type="application/x-ndjson",
    )


@app.post("/problems/{problem_id}/submit/stream")
def submit_solution_stream(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
):
    raise HTTPException(status_code=410, detail="Direct streaming grading is disabled. Use /submit/jobs instead.")
    # See run_visible_tests_stream: release the DB connection before judging.
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        assignment = validate_submission_assignment(session, payload.assignment_id, problem_id, current_user)
        assignment_id = assignment.id if assignment else None

        tests = fetch_tests(session, problem_id, public_only=False)
        session.expunge_all()
    if not tests:
        raise HTTPException(status_code=400, detail="No testcases configured")

    user_id = current_user.id
    language = payload.language
    code = payload.code
    total_tests = len(tests)

    def on_complete(status: str, passed: int, runtime_ms: int):
        with Session(engine) as local_session:
            submission = Submission(
                problem_id=problem_id,
                user_id=user_id,
                assignment_id=assignment_id,
                language=language,
                code=code,
                status=SubmissionStatus(status),
                passed_tests=passed,
                total_tests=total_tests,
                runtime_ms=runtime_ms,
            )
            local_session.add(submission)
            local_session.commit()
            local_session.refresh(submission)
            return {"submission_id": submission.id}

    return StreamingResponse(
        stream_execution(problem, payload, tests, on_complete=on_complete),
        media_type="application/x-ndjson",
    )
