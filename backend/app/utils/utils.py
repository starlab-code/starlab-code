from typing import Dict

from sqlmodel import Session, select

from ..models import Category


def category_lookup(session: Session) -> Dict[int, Category]:
    categories = session.exec(select(Category)).all()
    return {category.id: category for category in categories}
