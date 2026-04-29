import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlmodel import Session, select

from . import auth, judge
from .config import settings
from .db import create_db_and_tables, engine, get_session
from .models import (
    Assignment,
    AssignmentCreate,
    AssignmentGroup,
    AssignmentGroupStudent,
    AssignmentRead,
    AssignmentType,
    AssignmentUpdate,
    Category,
    ClassroomSummary,
    CodeExecutionResponse,
    DashboardSummary,
    Problem,
    ProblemCard,
    ProblemCreate,
    ProblemDetail,
    ProblemUpdate,
    RunCodeRequest,
    Submission,
    SubmissionFeedItem,
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


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    if request.method == "PATCH" and request.url.path.startswith("/assignments/"):
        for error in exc.errors():
            loc = error.get("loc", ())
            if len(loc) >= 2 and loc[0] == "body" and loc[1] == "assignment_type":
                return JSONResponse(status_code=400, content={"detail": "잘못된 assignment_type입니다."})

    return await request_validation_exception_handler(request, exc)


@app.on_event("startup")
def on_startup() -> None:
    try:
        import anyio.to_thread

        limiter = anyio.to_thread.current_default_thread_limiter()
        limiter.total_tokens = max(limiter.total_tokens, settings.threadpool_size)
    except Exception:
        pass

    create_db_and_tables()
    if settings.seed_demo_data:
        with Session(engine) as session:
            seed_initial_data(session)


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
        statement = statement.where(User.primary_teacher_id == get_primary_teacher_id(current_user))
    else:
        statement = statement.where(User.created_by_teacher_id == current_user.id)
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


def category_lookup(session: Session) -> Dict[int, Category]:
    categories = session.exec(select(Category)).all()
    return {category.id: category for category in categories}


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
def login(form_data: LoginForm = Depends()):
    user = auth.authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    if form_data.role and user.role != form_data.role:
        role_label = "teacher" if form_data.role == UserRole.teacher else "student"
        raise HTTPException(status_code=400, detail=f"This account is not allowed on the {role_label} login.")

    access_token = auth.create_access_token(data={"sub": user.username})
    return TokenResponse(access_token=access_token, user=to_user_read(user))


@app.get("/auth/me", response_model=UserRead)
def me(current_user: User = Depends(auth.get_current_user)):
    return to_user_read(current_user)


@app.get("/dashboard", response_model=DashboardSummary)
def dashboard(current_user: User = Depends(auth.get_current_user), session: Session = Depends(get_session)):
    total_problems = len(session.exec(select(Problem)).all())
    categories = session.exec(select(Category)).all()

    if current_user.role == UserRole.teacher:
        assignments = session.exec(select(Assignment).where(Assignment.teacher_id == current_user.id)).all()
        student_ids = [student.id for student in list_students_for_teacher(session, current_user)]
        accepted = (
            session.exec(
                select(Submission).where(
                    Submission.status == SubmissionStatus.accepted,
                    Submission.user_id.in_(student_ids),
                )
            ).all()
            if student_ids
            else []
        )
        return DashboardSummary(
            assigned_count=len(assignments),
            completed_count=len(accepted),
            total_problems=total_problems,
            categories=categories,
        )

    assignments = session.exec(select(Assignment).where(Assignment.student_id == current_user.id)).all()
    accepted = session.exec(
        select(Submission).where(
            Submission.user_id == current_user.id,
            Submission.status == SubmissionStatus.accepted,
        )
    ).all()
    return DashboardSummary(
        assigned_count=len(assignments),
        completed_count=len(accepted),
        total_problems=total_problems,
        categories=categories,
    )


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
        primary_teacher_id=get_primary_teacher_id(current_user),
        created_by_teacher_id=current_user.id,
        is_primary_teacher=False,
    )
    session.add(student)
    session.commit()
    session.refresh(student)
    return to_user_read(student)


def _delete_student_records(session: Session, student: User) -> None:
    assignments = session.exec(select(Assignment).where(Assignment.student_id == student.id)).all()
    assignment_ids = [assignment.id for assignment in assignments]
    submissions = session.exec(select(Submission).where(Submission.user_id == student.id)).all()
    if assignment_ids:
        assignment_submissions = session.exec(
            select(Submission).where(Submission.assignment_id.in_(assignment_ids))
        ).all()
        seen = {submission.id for submission in submissions}
        submissions.extend([submission for submission in assignment_submissions if submission.id not in seen])
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
    if student.primary_teacher_id != primary_teacher_id:
        raise HTTPException(status_code=403, detail="Cannot delete a student from another organization")
    if not current_user.is_primary_teacher and student.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher or primary teacher can delete this student")

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

    students = session.exec(select(User).where(User.created_by_teacher_id == teacher.id)).all()
    for student in students:
        student.created_by_teacher_id = current_user.id
        student.primary_teacher_id = current_user.id
        session.add(student)

    assignments = session.exec(select(Assignment).where(Assignment.teacher_id == teacher.id)).all()
    assignment_ids = [assignment.id for assignment in assignments]
    if assignment_ids:
        submissions = session.exec(select(Submission).where(Submission.assignment_id.in_(assignment_ids))).all()
        for submission in submissions:
            submission.assignment_id = None
            session.add(submission)
    for assignment in assignments:
        session.delete(assignment)

    problems = session.exec(select(Problem).where(Problem.created_by == teacher.id)).all()
    for problem in problems:
        problem.created_by = current_user.id
        session.add(problem)

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


@app.post("/assignments", response_model=List[AssignmentRead])
def create_assignments(
    payload: AssignmentCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    problem = session.get(Problem, payload.problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    target_student_ids: List[int] = []
    resolved_class_name: Optional[str] = None

    if payload.class_name:
        resolved_class_name = payload.class_name.strip()
        if not resolved_class_name:
            raise HTTPException(status_code=400, detail="Class name is empty")
        class_students = session.exec(
            select(User).where(
                User.role == UserRole.student,
                User.class_name == resolved_class_name,
                User.created_by_teacher_id == current_user.id,
            )
        ).all()
        if not class_students:
            raise HTTPException(status_code=400, detail=f"'{resolved_class_name}' 수강반에 등록된 수강생이 없습니다.")
        target_student_ids = [student.id for student in class_students]
    else:
        target_student_ids = list(payload.student_ids or [])
        if not target_student_ids:
            raise HTTPException(status_code=400, detail="수강반을 선택하거나 수강생을 직접 지정해 주세요.")

    created_assignments: List[Assignment] = []
    for student_id in target_student_ids:
        student = session.get(User, student_id)
        if (
            not student
            or student.role != UserRole.student
            or student.created_by_teacher_id != current_user.id
        ):
            continue
        assignment = Assignment(
            title=payload.title,
            problem_id=payload.problem_id,
            teacher_id=current_user.id,
            student_id=student_id,
            assignment_type=payload.assignment_type,
            due_at=payload.due_at,
            classroom_label=payload.classroom_label or resolved_class_name or student.class_name,
        )
        session.add(assignment)
        created_assignments.append(assignment)

    session.commit()
    for assignment in created_assignments:
        session.refresh(assignment)

    return build_assignment_reads(session, created_assignments)


def _group_key(title: str, problem_id: int, class_name: str, assignment_type: str) -> str:
    return f"{title}|{problem_id}|{class_name}|{assignment_type}"


def _parse_group_key(group_key: str) -> Optional[dict]:
    parts = group_key.split("|")
    if len(parts) < 4:
        return None
    title = "|".join(parts[:-3])
    try:
        problem_id = int(parts[-3])
    except ValueError:
        return None
    return {
        "title": title,
        "problem_id": problem_id,
        "class_name": parts[-2],
        "assignment_type": parts[-1],
    }


@app.get("/assignments/groups", response_model=List[AssignmentGroup])
def list_assignment_groups(
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    assignments = session.exec(
        select(Assignment).where(Assignment.teacher_id == current_user.id).order_by(Assignment.created_at.desc())
    ).all()
    if not assignments:
        return []

    problem_ids = {assignment.problem_id for assignment in assignments}
    student_ids = {assignment.student_id for assignment in assignments}
    problems = {p.id: p for p in session.exec(select(Problem).where(Problem.id.in_(problem_ids))).all()}
    students = {u.id: u for u in session.exec(select(User).where(User.id.in_(student_ids))).all()}
    categories = category_lookup(session)

    accepted_pairs = {
        (sub.assignment_id, sub.user_id)
        for sub in session.exec(
            select(Submission).where(
                Submission.assignment_id.in_([a.id for a in assignments]),
                Submission.status == SubmissionStatus.accepted,
            )
        ).all()
    }

    groups: Dict[str, dict] = {}
    for assignment in assignments:
        student = students.get(assignment.student_id)
        class_name = (assignment.classroom_label or (student.class_name if student else "") or "미지정").strip() or "미지정"
        key = _group_key(
            assignment.title,
            assignment.problem_id,
            class_name,
            assignment.assignment_type.value,
        )
        bucket = groups.setdefault(
            key,
            {
                "group_key": key,
                "title": assignment.title,
                "problem_id": assignment.problem_id,
                "class_name": class_name,
                "classroom_label": assignment.classroom_label,
                "assignment_type": assignment.assignment_type,
                "due_at": assignment.due_at,
                "created_at": assignment.created_at,
                "total_students": 0,
                "completed_students": 0,
                "assignment_ids": [],
            },
        )
        bucket["total_students"] += 1
        bucket["assignment_ids"].append(assignment.id)
        if (assignment.id, assignment.student_id) in accepted_pairs:
            bucket["completed_students"] += 1
        if assignment.created_at > bucket["created_at"]:
            bucket["created_at"] = assignment.created_at

    response: List[AssignmentGroup] = []
    for bucket in groups.values():
        problem = problems.get(bucket["problem_id"])
        category = categories.get(problem.category_id) if problem else None
        total = bucket["total_students"]
        completed = bucket["completed_students"]
        response.append(
            AssignmentGroup(
                group_key=bucket["group_key"],
                title=bucket["title"],
                problem_id=bucket["problem_id"],
                problem_title=problem.title if problem else "",
                category_name=category.name if category else "",
                class_name=bucket["class_name"],
                classroom_label=bucket["classroom_label"],
                assignment_type=bucket["assignment_type"],
                due_at=bucket["due_at"],
                created_at=bucket["created_at"],
                total_students=total,
                completed_students=completed,
                completion_rate=(completed / total) if total else 0.0,
                assignment_ids=bucket["assignment_ids"],
            )
        )
    response.sort(key=lambda g: g.created_at, reverse=True)
    return response


@app.get("/assignments/groups/detail", response_model=List[AssignmentGroupStudent])
def assignment_group_detail(
    group_key: str = Query(...),
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    parsed = _parse_group_key(group_key)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid group_key")

    assignments = session.exec(
        select(Assignment).where(
            Assignment.teacher_id == current_user.id,
            Assignment.title == parsed["title"],
            Assignment.problem_id == parsed["problem_id"],
            Assignment.assignment_type == AssignmentType(parsed["assignment_type"]),
        )
    ).all()

    target_class = parsed["class_name"]
    student_ids = {a.student_id for a in assignments}
    students = {u.id: u for u in session.exec(select(User).where(User.id.in_(student_ids))).all()} if student_ids else {}

    matched = []
    for a in assignments:
        student = students.get(a.student_id)
        class_name = (a.classroom_label or (student.class_name if student else "") or "미지정").strip() or "미지정"
        if class_name == target_class:
            matched.append(a)

    if not matched:
        return []

    submissions_by_assignment: Dict[int, List[Submission]] = {}
    subs = session.exec(
        select(Submission).where(Submission.assignment_id.in_([a.id for a in matched])).order_by(Submission.created_at.desc())
    ).all()
    for sub in subs:
        submissions_by_assignment.setdefault(sub.assignment_id, []).append(sub)

    status_rank = {
        SubmissionStatus.accepted: 5,
        SubmissionStatus.wrong_answer: 4,
        SubmissionStatus.runtime_error: 3,
        SubmissionStatus.time_limit: 2,
        SubmissionStatus.unsupported_language: 1,
    }

    response: List[AssignmentGroupStudent] = []
    for a in matched:
        student = students.get(a.student_id)
        sub_list = submissions_by_assignment.get(a.id, [])
        best: Optional[Submission] = None
        for sub in sub_list:
            if best is None:
                best = sub
                continue
            if sub.status == SubmissionStatus.accepted and best.status != SubmissionStatus.accepted:
                best = sub
            elif sub.status == best.status and sub.passed_tests > best.passed_tests:
                best = sub
            elif status_rank.get(sub.status, 0) > status_rank.get(best.status, 0):
                best = sub

        response.append(
            AssignmentGroupStudent(
                assignment_id=a.id,
                student_id=a.student_id,
                student_name=student.display_name if student else f"수강생 #{a.student_id}",
                student_username=student.username if student else "",
                class_name=student.class_name if student else None,
                submitted=any(s.status == SubmissionStatus.accepted for s in sub_list),
                best_status=best.status if best else None,
                best_passed=best.passed_tests if best else 0,
                best_total=best.total_tests if best else 0,
                best_runtime_ms=best.runtime_ms if best else 0,
                attempts=len(sub_list),
                last_submitted_at=sub_list[0].created_at if sub_list else None,
            )
        )

    response.sort(
        key=lambda s: (
            0 if s.submitted else 1,
            -(s.best_passed if s.best_total else 0),
            s.student_name,
        )
    )
    return response


def build_assignment_reads(session: Session, assignments: List[Assignment]) -> List[AssignmentRead]:
    if not assignments:
        return []

    problem_ids = {assignment.problem_id for assignment in assignments}
    student_ids = {assignment.student_id for assignment in assignments}
    teacher_ids = {assignment.teacher_id for assignment in assignments}

    problems = {problem.id: problem for problem in session.exec(select(Problem).where(Problem.id.in_(problem_ids))).all()}
    categories = category_lookup(session)
    students = {user.id: user for user in session.exec(select(User).where(User.id.in_(student_ids))).all()}
    teachers = {user.id: user for user in session.exec(select(User).where(User.id.in_(teacher_ids))).all()}

    submission_pairs = {
        (submission.assignment_id, submission.user_id)
        for submission in session.exec(select(Submission).where(Submission.assignment_id.in_([assignment.id for assignment in assignments]))).all()
    }

    response: List[AssignmentRead] = []
    for assignment in assignments:
        problem = problems.get(assignment.problem_id)
        student = students.get(assignment.student_id)
        teacher = teachers.get(assignment.teacher_id)
        category = categories.get(problem.category_id) if problem else None

        response.append(
            AssignmentRead(
                id=assignment.id,
                title=assignment.title,
                problem_id=assignment.problem_id,
                problem_title=problem.title if problem else "",
                category_name=category.name if category else "",
                student_id=assignment.student_id,
                student_name=student.display_name if student else "",
                teacher_name=teacher.display_name if teacher else "",
                assignment_type=assignment.assignment_type,
                due_at=assignment.due_at,
                classroom_label=assignment.classroom_label,
                submitted=(assignment.id, assignment.student_id) in submission_pairs,
            )
        )
    return response


@app.get("/assignments", response_model=List[AssignmentRead])
def list_assignments(
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    if current_user.role == UserRole.teacher:
        assignments = session.exec(select(Assignment).where(Assignment.teacher_id == current_user.id).order_by(Assignment.created_at.desc())).all()
        return build_assignment_reads(session, assignments)

    assignments = session.exec(select(Assignment).where(Assignment.student_id == current_user.id).order_by(Assignment.created_at.desc())).all()
    return build_assignment_reads(session, assignments)


@app.patch("/assignments/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):

    """단일 과제 수정"""
    assignment = session.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")

    # 현재 teacher가 생성한 과제인지 확인
    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 과제를 수정할 권한이 없습니다.")

    # problem_id 변경 시 문제 존재 여부 확인
    if payload.problem_id is not None:
        problem = session.get(Problem, payload.problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")
        assignment.problem_id = payload.problem_id

    # 나머지 필드 업데이트
    if payload.title is not None:
        assignment.title = payload.title
    if payload.assignment_type is not None:
        assignment.assignment_type = payload.assignment_type
    if payload.due_at is not None:
        assignment.due_at = payload.due_at
    if payload.classroom_label is not None:
        assignment.classroom_label = payload.classroom_label

    session.add(assignment)
    session.commit()
    session.refresh(assignment)

    return build_assignment_reads(session, [assignment])[0]


@app.get("/submissions")
def list_submissions(
    problem_id: Optional[int] = Query(default=None),
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    statement = select(Submission)
    if current_user.role == UserRole.student:
        statement = statement.where(Submission.user_id == current_user.id)
    else:
        teacher_student_ids = [student.id for student in list_students_for_teacher(session, current_user)]
        if not teacher_student_ids:
            return []
        statement = statement.where(Submission.user_id.in_(teacher_student_ids))
    if problem_id:
        statement = statement.where(Submission.problem_id == problem_id)
    submissions = session.exec(statement.order_by(Submission.created_at.desc())).all()
    return submissions


@app.get("/submissions/feed", response_model=List[SubmissionFeedItem])
def submission_feed(
    limit: int = Query(default=40, ge=1, le=200),
    since_id: Optional[int] = Query(default=None),
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    teacher_student_ids = [student.id for student in list_students_for_teacher(session, current_user)]
    if not teacher_student_ids:
        return []
    statement = select(Submission)
    if since_id is not None:
        statement = statement.where(Submission.id > since_id)
    statement = statement.where(Submission.user_id.in_(teacher_student_ids))
    submissions = session.exec(statement.order_by(Submission.created_at.desc()).limit(limit)).all()
    if not submissions:
        return []

    user_ids = {sub.user_id for sub in submissions}
    problem_ids = {sub.problem_id for sub in submissions}
    assignment_ids = {sub.assignment_id for sub in submissions if sub.assignment_id is not None}

    users = {u.id: u for u in session.exec(select(User).where(User.id.in_(user_ids))).all()}
    problems = {p.id: p for p in session.exec(select(Problem).where(Problem.id.in_(problem_ids))).all()}
    categories = category_lookup(session)
    assignments_map = {}
    if assignment_ids:
        assignments_map = {
            a.id: a for a in session.exec(select(Assignment).where(Assignment.id.in_(assignment_ids))).all()
        }

    feed: List[SubmissionFeedItem] = []
    for sub in submissions:
        student = users.get(sub.user_id)
        problem = problems.get(sub.problem_id)
        category = categories.get(problem.category_id) if problem else None
        assignment = assignments_map.get(sub.assignment_id) if sub.assignment_id else None
        feed.append(
            SubmissionFeedItem(
                id=sub.id,
                student_id=sub.user_id,
                student_name=student.display_name if student else "(알 수 없음)",
                student_username=student.username if student else "",
                class_name=student.class_name if student else None,
                problem_id=sub.problem_id,
                problem_title=problem.title if problem else "",
                category_name=category.name if category else "",
                assignment_id=sub.assignment_id,
                assignment_title=assignment.title if assignment else None,
                language=sub.language,
                status=sub.status,
                passed_tests=sub.passed_tests,
                total_tests=sub.total_tests,
                runtime_ms=sub.runtime_ms,
                created_at=sub.created_at,
            )
        )
    return feed


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


@app.post("/problems/{problem_id}/run", response_model=CodeExecutionResponse)
def run_visible_tests(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    del current_user
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    tests = fetch_tests(session, problem_id, public_only=True)
    if not tests:
        raise HTTPException(status_code=400, detail="No public testcases configured")

    return execute_problem(problem, payload, tests)


@app.post("/problems/{problem_id}/submit", response_model=CodeExecutionResponse)
def submit_solution(
    problem_id: int,
    payload: RunCodeRequest,
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    assignment = validate_submission_assignment(session, payload.assignment_id, problem_id, current_user)
    assignment_id = assignment.id if assignment else None

    tests = fetch_tests(session, problem_id, public_only=False)
    if not tests:
        raise HTTPException(status_code=400, detail="No testcases configured")

    execution = execute_problem(problem, payload, tests)

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
    session: Session = Depends(get_session),
):
    del current_user
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    tests = fetch_tests(session, problem_id, public_only=True)
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
    session: Session = Depends(get_session),
):
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    assignment = validate_submission_assignment(session, payload.assignment_id, problem_id, current_user)
    assignment_id = assignment.id if assignment else None

    tests = fetch_tests(session, problem_id, public_only=False)
    if not tests:
        raise HTTPException(status_code=400, detail="No testcases configured")

    user_id = current_user.id
    language = payload.language
    code = payload.code

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
                total_tests=len(tests),
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
