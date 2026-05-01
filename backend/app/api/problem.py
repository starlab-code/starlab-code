from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import auth
from ..db import get_session
from ..models import Problem, TestCase, TestCaseCreate, TestCaseRead, TestCaseUpdate, User

MIN_TESTCASE_COUNT = 10
MAX_TESTCASE_COUNT = 50

router = APIRouter(prefix="/problems", tags=["problems"])


def _testcase_to_read(testcase: TestCase) -> TestCaseRead:
    return TestCaseRead(
        id=testcase.id,
        input_data=testcase.input_data,
        expected_output=testcase.expected_output,
        is_public=testcase.is_public,
        note=testcase.note,
    )


"""테스트케이스 추가 API"""
@router.post("/{problem_id}/testcases", response_model=TestCaseRead)
def create_testcase(
    problem_id: int,
    payload: TestCaseCreate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    del current_user

    # 문제 존재 여부 확인
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")

    # 필수 입력값 확인 (공백만 있는 경우도 차단)
    if not payload.input_data.strip() and not payload.expected_output.strip():
        raise HTTPException(status_code=400, detail="input_data 또는 expected_output 중 하나 이상은 필수입니다.")

    # 추가 후 최대 개수(50개) 초과 여부 확인
    current_count = len(
        session.exec(select(TestCase).where(TestCase.problem_id == problem_id)).all()
    )
    if current_count + 1 > MAX_TESTCASE_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"테스트케이스는 최대 {MAX_TESTCASE_COUNT}개까지만 등록할 수 있습니다. (현재 {current_count}개)",
        )

    testcase = TestCase(
        problem_id=problem_id,
        input_data=payload.input_data,
        expected_output=payload.expected_output,
        is_public=payload.is_public,
        note=payload.note,
    )
    session.add(testcase)
    session.commit()
    session.refresh(testcase)

    return _testcase_to_read(testcase)


"""특정 테스트케이스 수정 API"""
@router.patch("/{problem_id}/testcases/{testcase_id}", response_model=TestCaseRead)
def update_testcase(
    problem_id: int,
    testcase_id: int,
    payload: TestCaseUpdate,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    del current_user

    # 문제 존재 여부 확인
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")

    # 테스트케이스 존재 여부 확인
    testcase = session.get(TestCase, testcase_id)
    if not testcase:
        raise HTTPException(status_code=404, detail="테스트케이스를 찾을 수 없습니다.")

    # 테스트케이스가 요청한 problem_id에 속하는지 확인
    if testcase.problem_id != problem_id:
        raise HTTPException(status_code=400, detail="해당 테스트케이스는 요청한 문제에 속하지 않습니다.")

    # 입력값이 있는 필드만 갱신
    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(testcase, key, value)

    session.add(testcase)
    session.commit()
    session.refresh(testcase)

    return _testcase_to_read(testcase)


"""특정 테스트케이스 삭제 API"""
@router.delete("/{problem_id}/testcases/{testcase_id}")
def delete_testcase(
    problem_id: int,
    testcase_id: int,
    current_user: User = Depends(auth.require_teacher),
    session: Session = Depends(get_session),
):
    del current_user

    # 문제 존재 여부 확인
    problem = session.get(Problem, problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="문제를 찾을 수 없습니다.")

    # 테스트케이스 존재 여부 확인
    testcase = session.get(TestCase, testcase_id)
    if not testcase:
        raise HTTPException(status_code=404, detail="테스트케이스를 찾을 수 없습니다.")

    # 테스트케이스가 요청한 problem_id에 속하는지 확인
    if testcase.problem_id != problem_id:
        raise HTTPException(status_code=400, detail="해당 테스트케이스는 요청한 문제에 속하지 않습니다.")

    # 삭제 후 최소 개수(10개) 미만이 되는지 확인
    current_count = len(
        session.exec(select(TestCase).where(TestCase.problem_id == problem_id)).all()
    )
    if current_count - 1 < MIN_TESTCASE_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"테스트케이스는 최소 {MIN_TESTCASE_COUNT}개 이상이어야 합니다. (현재 {current_count}개)",
        )

    session.delete(testcase)
    session.commit()

    return {"ok": True}
