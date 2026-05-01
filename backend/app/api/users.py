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
    """학생 반 이동"""
    student = session.get(User, student_id)
    if not student or student.role != UserRole.student:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")

    # 같은 조직의 학생인지 확인
    current_user_org = _get_primary_teacher_id(current_user)
    if student.primary_teacher_id != current_user_org:
        raise HTTPException(status_code=403, detail="다른 조직의 학생은 수정할 수 없습니다.")

    # 반이동 권한: 메인 선생님, 해당 학생을 등록한 선생님, 담당 선생님만 가능
    can_transfer = (
        current_user.is_primary_teacher
        or student.created_by_teacher_id == current_user.id
        or student.primary_teacher_id == current_user.id
    )
    if not can_transfer:
        raise HTTPException(status_code=403, detail="반 이동 권한이 없습니다.")

    # # username 변경 시 중복 확인
    # if payload.username is not None:
    #     normalized_username = payload.username.strip()
    #     if not normalized_username:
    #         raise HTTPException(status_code=400, detail="Username은 비어있을 수 없습니다.")
    #     _ensure_unique_username(session, normalized_username, exclude_user_id=student_id)
    #     student.username = normalized_username

    # # display_name 변경
    # if payload.display_name is not None:
    #     normalized_display_name = payload.display_name.strip()
    #     if not normalized_display_name:
    #         raise HTTPException(status_code=400, detail="Display name은 비어있을 수 없습니다.")
    #     student.display_name = normalized_display_name

    # # password 변경
    # if payload.password is not None:
    #     if not payload.password.strip():
    #         raise HTTPException(status_code=400, detail="Password는 비어있을 수 없습니다.")
    #     student.hashed_password = auth.get_password_hash(payload.password)

    # class_name 변경 (반이동)
    if payload.class_name is not None:
        normalized_class_name = payload.class_name.strip()
        if not normalized_class_name:
            raise HTTPException(status_code=400, detail="Class name은 비어있을 수 없습니다.")
        student.class_name = normalized_class_name

    # primary_teacher_id 변경 (반이동)
    if payload.primary_teacher_id is not None:
        primary_teacher = session.get(User, payload.primary_teacher_id)
        if not primary_teacher or primary_teacher.role != UserRole.teacher:
            raise HTTPException(status_code=404, detail="해당 선생님을 찾을 수 없습니다.")
        student.primary_teacher_id = payload.primary_teacher_id


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

    # 메인 선생님(is_primary_teacher가 true인 선생님)만 수정 가능
    if not current_user.is_primary_teacher and teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="선생님 정보 수정은 메인 선생님 혹은 본인만 가능합니다.")

    """teacher 계정 정보 수정"""
    teacher = session.get(User, teacher_id)
    if not teacher or teacher.role != UserRole.teacher:
        raise HTTPException(status_code=404, detail="선생님을 찾을 수 없습니다.")


    # 같은 조직인지 확인(?)
    primary_teacher_id = _get_primary_teacher_id(current_user)
    teacher_primary_id = _get_primary_teacher_id(teacher)
    if teacher_primary_id != primary_teacher_id:
        raise HTTPException(status_code=403, detail="다른 조직의 선생님은 수정할 수 없습니다.")

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
            raise HTTPException(status_code=400, detail="비밀번호는 비어있을 수 없습니다.")
        teacher.hashed_password = auth.get_password_hash(payload.password)

    session.add(teacher)
    session.commit()
    session.refresh(teacher)

    return _to_user_read(teacher)
