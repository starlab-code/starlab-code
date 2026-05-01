from typing import Dict

from sqlmodel import Session, select

from ..models import Category


def category_lookup(session: Session) -> Dict[int, Category]:
    categories = session.exec(select(Category)).all()
    return {category.id: category for category in categories}

"""seed_config.json에 정의된 유저 생성 함수"""
def seed_demo_users(session: Session, primary_teacher: "User") -> None:  # type: ignore[name-defined]
    import json
    import pathlib

    from ..auth import get_password_hash
    from ..models import User, UserRole

    config_path = pathlib.Path(__file__).parent.parent / "seed_config.json"
    if not config_path.exists():
        return
    demo_users: list[dict] = json.loads(config_path.read_text(encoding="utf-8")).get("demo_users", [])

    # seed_config의 id → username 매핑 (primary teacher는 config id=1)
    config_id_to_username: dict[int, str] = {1: primary_teacher.username}
    for entry in demo_users:
        config_id_to_username[entry["id"]] = entry["username"]

    existing_users = {u.username: u for u in session.exec(select(User)).all()}

    # 1단계: 존재하지 않는 유저 생성
    for entry in demo_users:
        if entry["username"] in existing_users:
            continue
        role = UserRole.teacher if entry["role"] == "teacher" else UserRole.student
        user = User(
            username=entry["username"],
            display_name=entry["display_name"],
            hashed_password=get_password_hash(entry["password"]),
            role=role,
            is_primary_teacher=entry.get("is_primary_teacher", False),
            class_name=entry.get("class_name"),
        )
        session.add(user)
        session.flush()
        existing_users[user.username] = user

    # 2단계: 계층 관계(primary_teacher_id, created_by_teacher_id) 설정
    for entry in demo_users:
        user = existing_users.get(entry["username"])
        if not user:
            continue

        primary_ref_id = entry.get("primary_teacher_id")
        created_ref_id = entry.get("created_by_teacher_id")

        if primary_ref_id is not None:
            ref_username = config_id_to_username.get(primary_ref_id)
            ref_user = existing_users.get(ref_username) if ref_username else None
            if ref_user:
                user.primary_teacher_id = ref_user.id

        if created_ref_id is not None:
            ref_username = config_id_to_username.get(created_ref_id)
            ref_user = existing_users.get(ref_username) if ref_username else None
            if ref_user:
                user.created_by_teacher_id = ref_user.id

        session.add(user)

    session.flush()
