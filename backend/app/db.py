from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import settings


DATABASE_URL = settings.database_url
_is_sqlite = DATABASE_URL.startswith("sqlite")

_connect_args: dict = {}
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
if _is_sqlite:
    _connect_args["check_same_thread"] = False
    _connect_args["timeout"] = 30
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 30
else:
    # Keep the free-tier connection footprint small for Render + Supabase.
    _engine_kwargs["pool_size"] = settings.db_pool_size
    _engine_kwargs["max_overflow"] = settings.db_max_overflow
    _engine_kwargs["pool_recycle"] = settings.db_pool_recycle_seconds

engine = create_engine(DATABASE_URL, connect_args=_connect_args, **_engine_kwargs)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _apply_sqlite_pragmas(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA temp_store=MEMORY;")
        cursor.close()


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
