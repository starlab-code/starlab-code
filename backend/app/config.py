from __future__ import annotations

import os
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


def _get_int(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_bool(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_list(key: str, default: List[str]) -> List[str]:
    raw = os.environ.get(key)
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _resolve_secret_key() -> str:
    value = os.environ.get("STARLAB_SECRET_KEY") or os.environ.get("JWT_SECRET")
    if value:
        return value
    warnings.warn(
        "STARLAB_SECRET_KEY is not set; using an insecure development default. "
        "Set STARLAB_SECRET_KEY (or JWT_SECRET) before deploying.",
        RuntimeWarning,
        stacklevel=2,
    )
    return "starlab-code-insecure-dev-secret-change-in-production"


def _normalize_database_url(raw: str) -> str:
    value = raw.strip()
    if value.startswith("postgresql+psycopg://"):
        return value
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://") :]
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://") :]
    return value


def _resolve_database_url() -> str:
    raw = os.environ.get("STARLAB_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if raw:
        return _normalize_database_url(raw)
    default_path = Path(__file__).resolve().parent.parent / "starlab_code_mvp.db"
    return f"sqlite:///{default_path.as_posix()}"


_DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


@dataclass(frozen=True)
class Settings:
    secret_key: str = field(default_factory=_resolve_secret_key)
    access_token_expire_minutes: int = field(
        default_factory=lambda: _get_int("STARLAB_TOKEN_MINUTES", 60 * 24)
    )
    database_url: str = field(default_factory=_resolve_database_url)
    allow_origins: List[str] = field(
        default_factory=lambda: _get_list("STARLAB_ALLOW_ORIGINS", _DEFAULT_ORIGINS)
    )
    seed_demo_data: bool = field(
        default_factory=lambda: _get_bool("STARLAB_SEED_DEMO_DATA", True)
    )
    db_pool_size: int = field(
        default_factory=lambda: _get_int("STARLAB_DB_POOL_SIZE", 5)
    )
    db_max_overflow: int = field(
        default_factory=lambda: _get_int("STARLAB_DB_MAX_OVERFLOW", 5)
    )
    db_pool_recycle_seconds: int = field(
        default_factory=lambda: _get_int("STARLAB_DB_POOL_RECYCLE_SECONDS", 300)
    )
    threadpool_size: int = field(
        default_factory=lambda: _get_int("STARLAB_THREADPOOL_SIZE", 64)
    )
    judge_concurrency: int = field(
        default_factory=lambda: _get_int("STARLAB_JUDGE_CONCURRENCY", 4)
    )
    judge_max_code_bytes: int = field(
        default_factory=lambda: _get_int("STARLAB_MAX_CODE_BYTES", 64 * 1024)
    )
    judge_max_input_bytes: int = field(
        default_factory=lambda: _get_int("STARLAB_MAX_INPUT_BYTES", 256 * 1024)
    )
    judge_max_output_bytes: int = field(
        default_factory=lambda: _get_int("STARLAB_MAX_OUTPUT_BYTES", 256 * 1024)
    )
    judge_cpu_seconds: int = field(
        default_factory=lambda: _get_int("STARLAB_JUDGE_CPU_SECONDS", 4)
    )
    judge_memory_bytes: int = field(
        default_factory=lambda: _get_int("STARLAB_JUDGE_MEMORY_BYTES", 256 * 1024 * 1024)
    )


settings = Settings()
