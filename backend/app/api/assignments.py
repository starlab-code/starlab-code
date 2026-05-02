from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, select

from .. import auth
from ..db import get_session
from ..models import (
    Assignment,
    AssignmentCreate,
    AssignmentGroup,
    AssignmentGroupStudent,
    AssignmentRead,
    AssignmentType,
    AssignmentUpdate,
    Problem,
    Submission,
    SubmissionStatus,
    User,
    UserRole,
)
from ..utils import category_lookup

router = APIRouter(prefix="/assignments", tags=["assignments"])


#==============================================
# 내부 유틸리티 함수 정의
#==============================================

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


def _get_assignments_by_group_key(
    session: Session,
    group_key: str,
    teacher_id: int,
) -> List[Assignment]:
    """group_key에 해당하는 assignments 조회 (teacher 소유만)"""
    parsed = _parse_group_key(group_key)
    if not parsed:
        return []

    assignments = session.exec(
        select(Assignment).where(
            Assignment.teacher_id == teacher_id,
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

    return matched


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

    submission_pairs = set(session.exec(
        select(Submission.assignment_id, Submission.user_id)
        .where(Submission.assignment_id.in_([a.id for a in assignments]))
    ).all())

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

#==============================================
# 라우터 함수 정의
#==============================================

"""과제 생성 API"""
@router.post("", response_model=List[AssignmentRead])
def create_assignments(
    payload: AssignmentCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    problem_ids = list(dict.fromkeys([
        *([payload.problem_id] if payload.problem_id is not None else []),
        *payload.problem_ids,
    ]))
    if not problem_ids:
        raise HTTPException(status_code=400, detail="문제를 하나 이상 선택해 주세요.")

    problems = {
        problem.id: problem
        for problem in session.exec(select(Problem).where(Problem.id.in_(problem_ids))).all()
    }
    missing_problem_ids = [problem_id for problem_id in problem_ids if problem_id not in problems]
    if missing_problem_ids:
        raise HTTPException(status_code=404, detail=f"Problem not found: {missing_problem_ids[0]}")

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
                User.primary_teacher_id == current_user.id,
            )
        ).all()
        if not class_students:
            raise HTTPException(status_code=400, detail=f"'{resolved_class_name}' 수강반에 등록된 수강생이 없습니다.")
        target_student_ids = [student.id for student in class_students]
    else:
        target_student_ids = list(payload.student_ids or [])
        if not target_student_ids:
            raise HTTPException(status_code=400, detail="수강반을 선택하거나 수강생을 직접 지정해 주세요.")

    students_map = {u.id: u for u in session.exec(
        select(User).where(User.id.in_(target_student_ids))
    ).all()}
    created_assignments: List[Assignment] = []
    base_title = payload.title.strip()
    for problem_id in problem_ids:
        problem = problems[problem_id]
        assignment_title = base_title or f"{problem.title} 과제"
        for student_id in target_student_ids:
            student = students_map.get(student_id)
            if (
                not student
                or student.role != UserRole.student
                or student.primary_teacher_id != current_user.id
            ):
                continue
            assignment = Assignment(
                title=assignment_title,
                problem_id=problem_id,
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

"""과제 조회 API"""
@router.get("", response_model=List[AssignmentRead])
def list_assignments(
    current_user: User = Depends(auth.get_current_user),
    session: Session = Depends(get_session),
):
    if current_user.role == UserRole.teacher:
        assignments = session.exec(select(Assignment).where(Assignment.teacher_id == current_user.id).order_by(Assignment.created_at.desc())).all()
        return build_assignment_reads(session, assignments)

    assignments = session.exec(select(Assignment).where(Assignment.student_id == current_user.id).order_by(Assignment.created_at.desc())).all()
    return build_assignment_reads(session, assignments)


"""단일 과제 수정 API"""
@router.patch("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    assignment = session.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")

    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 과제를 수정할 권한이 없습니다.")

    if payload.problem_id is not None:
        problem = session.get(Problem, payload.problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")
        assignment.problem_id = payload.problem_id

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


"""단일 과제 삭제 API"""
@router.delete("/{assignment_id}")
def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    assignment = session.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")

    if assignment.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="이 과제를 삭제할 권한이 없습니다.")

    submissions = session.exec(
        select(Submission).where(Submission.assignment_id == assignment_id)
    ).all()
    for submission in submissions:
        submission.assignment_id = None
        session.add(submission)

    session.delete(assignment)
    session.commit()

    return {"ok": True}




"""그룹 단위 과제 목록 조회 API"""
@router.get("/groups", response_model=List[AssignmentGroup])
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

    accepted_pairs = set(session.exec(
        select(Submission.assignment_id, Submission.user_id)
        .where(
            Submission.assignment_id.in_([a.id for a in assignments]),
            Submission.status == SubmissionStatus.accepted,
        )
    ).all())

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



"""그룹 단위 과제 수정 API"""
@router.patch("/groups", response_model=List[AssignmentRead])
def update_assignment_group(
    group_key: str = Query(...),
    payload: AssignmentUpdate = None,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):

    parsed = _parse_group_key(group_key)
    if not parsed:
        raise HTTPException(status_code=400, detail="잘못된 group_key입니다.")

    matched = _get_assignments_by_group_key(session, group_key, current_user.id)
    if not matched:
        raise HTTPException(status_code=404, detail="해당 그룹의 과제를 찾을 수 없습니다.")

    if payload and payload.problem_id is not None:
        problem = session.get(Problem, payload.problem_id)
        if not problem:
            raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")

    for assignment in matched:
        if payload:
            if payload.title is not None:
                assignment.title = payload.title
            if payload.problem_id is not None:
                assignment.problem_id = payload.problem_id
            if payload.assignment_type is not None:
                assignment.assignment_type = payload.assignment_type
            if payload.due_at is not None:
                assignment.due_at = payload.due_at
            if payload.classroom_label is not None:
                assignment.classroom_label = payload.classroom_label
        session.add(assignment)

    session.commit()
    for assignment in matched:
        session.refresh(assignment)

    return build_assignment_reads(session, matched)


"""그룹 단위 과제 삭제 API"""
@router.delete("/groups")
def delete_assignment_group(
    group_key: str = Query(...),
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    parsed = _parse_group_key(group_key)
    if not parsed:
        raise HTTPException(status_code=400, detail="잘못된 group_key입니다.")

    matched = _get_assignments_by_group_key(session, group_key, current_user.id)
    if not matched:
        raise HTTPException(status_code=404, detail="해당 그룹의 과제를 찾을 수 없습니다.")

    assignment_ids = [a.id for a in matched]

    submissions = session.exec(
        select(Submission).where(Submission.assignment_id.in_(assignment_ids))
    ).all()
    for submission in submissions:
        submission.assignment_id = None
        session.add(submission)

    for assignment in matched:
        session.delete(assignment)

    session.commit()

    return {"ok": True, "deleted_count": len(matched)}


"""과제 그룹 상세 조회 API"""
@router.get("/groups/detail", response_model=List[AssignmentGroupStudent])
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

