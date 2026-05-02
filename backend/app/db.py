import logging
from urllib.parse import urlparse

from sqlalchemy import event, inspect, text
from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, create_engine

from .config import settings


DATABASE_URL = settings.database_url
_is_sqlite = DATABASE_URL.startswith("sqlite")
logger = logging.getLogger("uvicorn.error")


def _uses_transaction_pooler(database_url: str) -> bool:
    parsed = urlparse(database_url)
    return parsed.port == 6543 and "pooler.supabase.com" in (parsed.hostname or "")

_connect_args: dict = {}
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
if _is_sqlite:
    _connect_args["check_same_thread"] = False
    _connect_args["timeout"] = 30
    _engine_kwargs["pool_size"] = 20
    _engine_kwargs["max_overflow"] = 30
else:
    pool_mode = settings.db_pool_mode
    use_null_pool = pool_mode in {"null", "nullpool", "transaction", "transaction_pooler"}
    if pool_mode == "auto":
        use_null_pool = _uses_transaction_pooler(DATABASE_URL)

    if use_null_pool:
        # Supabase transaction pooler uses PgBouncer transaction mode.
        # Avoid keeping app-side pooled connections around between operations.
        _engine_kwargs["poolclass"] = NullPool
    else:
        # Keep the Render + Supabase footprint modest while allowing short bursts.
        _engine_kwargs["pool_size"] = settings.db_pool_size
        _engine_kwargs["max_overflow"] = settings.db_max_overflow
        _engine_kwargs["pool_timeout"] = settings.db_pool_timeout_seconds
        _engine_kwargs["pool_recycle"] = settings.db_pool_recycle_seconds
    # Disable psycopg3 server-side prepared statements; required for
    # Supabase's transaction pooler (avoids "prepared statement already exists").
    _connect_args["prepare_threshold"] = None

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
    _run_schema_migrations()


def _run_schema_migrations() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("user"):
            return

        existing_columns = {column["name"] for column in inspector.get_columns("user")}
        if "primary_teacher_id" not in existing_columns:
            conn.execute(text('ALTER TABLE "user" ADD COLUMN primary_teacher_id INTEGER'))
        if "created_by_teacher_id" not in existing_columns:
            conn.execute(text('ALTER TABLE "user" ADD COLUMN created_by_teacher_id INTEGER'))
        if "is_primary_teacher" not in existing_columns:
            conn.execute(text('ALTER TABLE "user" ADD COLUMN is_primary_teacher BOOLEAN NOT NULL DEFAULT FALSE'))

        conn.execute(text('CREATE INDEX IF NOT EXISTS ix_user_primary_teacher_id ON "user" (primary_teacher_id)'))
        conn.execute(text('CREATE INDEX IF NOT EXISTS ix_user_created_by_teacher_id ON "user" (created_by_teacher_id)'))


def db_pool_status() -> str:
    try:
        return engine.pool.status()
    except Exception as exc:
        return f"pool status unavailable: {exc}"


def log_db_pool_status(label: str) -> None:
    logger.info("db_pool_status %s: %s", label, db_pool_status())


def get_session():
    session = Session(engine)
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
