from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import auth
from ..db import get_session
from ..models import StudentUpdate, TeacherUpdate, User, UserRead, UserRole

router = APIRouter(prefix="/users", tags=["users"])


def _to_user_read(user: User) -> UserRead:
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


def _get_primary_teacher_id(user: User) -> int:
    return user.primary_teacher_id or user.id


def _ensure_unique_username(session: Session, username: str, exclude_user_id: Optional[int] = None) -> None:
    """username 중복 확인 (exclude_user_id는 본인 제외용)"""
    statement = select(User).where(User.username == username)
    if exclude_user_id:
        statement = statement.where(User.id != exclude_user_id)
    existing = session.exec(statement).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")


@router.patch("/students/{student_id}", response_model=UserRead)
def update_student(
    student_id: int,
    payload: StudentUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    """학생 계정 정보 수정 및 반/담당 teacher 이동"""
    student = session.get(User, student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")

    # 권한 검증: 일반 teacher는 본인이 생성한 학생만, main teacher는 같은 조직 내 모든 학생
    primary_teacher_id = _get_primary_teacher_id(current_user)
    if student.primary_teacher_id != primary_teacher_id:
        raise HTTPException(status_code=403, detail="다른 조직의 학생은 수정할 수 없습니다.")
    if not current_user.is_primary_teacher and student.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="본인이 생성한 학생만 수정할 수 있습니다.")

    # username 변경 시 중복 확인
    if payload.username is not None:
        normalized_username = payload.username.strip()
        if not normalized_username:
            raise HTTPException(status_code=400, detail="Username은 비어있을 수 없습니다.")
        _ensure_unique_username(session, normalized_username, exclude_user_id=student_id)
        student.username = normalized_username

    # display_name 변경
    if payload.display_name is not None:
        normalized_display_name = payload.display_name.strip()
        if not normalized_display_name:
            raise HTTPException(status_code=400, detail="Display name은 비어있을 수 없습니다.")
        student.display_name = normalized_display_name

    # password 변경
    if payload.password is not None:
        if not payload.password.strip():
            raise HTTPException(status_code=400, detail="Password는 비어있을 수 없습니다.")
        student.hashed_password = auth.get_password_hash(payload.password)

    # class_name 변경
    if payload.class_name is not None:
        normalized_class_name = payload.class_name.strip()
        if not normalized_class_name:
            raise HTTPException(status_code=400, detail="Class name은 비어있을 수 없습니다.")
        student.class_name = normalized_class_name

    # 담당 teacher 변경 (main teacher만 가능)
    if payload.created_by_teacher_id is not None:
        if not current_user.is_primary_teacher:
            raise HTTPException(status_code=403, detail="담당 teacher 변경은 main teacher만 가능합니다.")

        new_teacher = session.get(User, payload.created_by_teacher_id)
        if not new_teacher or new_teacher.role != UserRole.teacher:
            raise HTTPException(status_code=404, detail="대상 teacher를 찾을 수 없습니다.")

        # 같은 조직인지 확인
        new_teacher_primary_id = _get_primary_teacher_id(new_teacher)
        if new_teacher_primary_id != primary_teacher_id:
            raise HTTPException(status_code=403, detail="다른 조직의 teacher에게 이동할 수 없습니다.")

        student.created_by_teacher_id = payload.created_by_teacher_id

    session.add(student)
    session.commit()
    session.refresh(student)

    return _to_user_read(student)


@router.patch("/teachers/{teacher_id}", response_model=UserRead)
def update_teacher(
    teacher_id: int,
    payload: TeacherUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    """teacher 계정 정보 수정"""
    teacher = session.get(User, teacher_id)
    if not teacher or teacher.role != UserRole.teacher:
        raise HTTPException(status_code=404, detail="Teacher를 찾을 수 없습니다.")

    # 같은 조직인지 확인
    primary_teacher_id = _get_primary_teacher_id(current_user)
    teacher_primary_id = _get_primary_teacher_id(teacher)
    if teacher_primary_id != primary_teacher_id:
        raise HTTPException(status_code=403, detail="다른 조직의 teacher는 수정할 수 없습니다.")

    # 권한 검증: main teacher만 수정 가능 (본인 포함)
    if not current_user.is_primary_teacher:
        raise HTTPException(status_code=403, detail="Teacher 정보 수정은 main teacher만 가능합니다.")

    # username 변경 시 중복 확인
    if payload.username is not None:
        normalized_username = payload.username.strip()
        if not normalized_username:
            raise HTTPException(status_code=400, detail="Username은 비어있을 수 없습니다.")
        _ensure_unique_username(session, normalized_username, exclude_user_id=teacher_id)
        teacher.username = normalized_username

    # display_name 변경
    if payload.display_name is not None:
        normalized_display_name = payload.display_name.strip()
        if not normalized_display_name:
            raise HTTPException(status_code=400, detail="Display name은 비어있을 수 없습니다.")
        teacher.display_name = normalized_display_name

    # password 변경
    if payload.password is not None:
        if not payload.password.strip():
            raise HTTPException(status_code=400, detail="Password는 비어있을 수 없습니다.")
        teacher.hashed_password = auth.get_password_hash(payload.password)

    session.add(teacher)
    session.commit()
    session.refresh(teacher)

    return _to_user_read(teacher)
