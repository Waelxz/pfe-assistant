"""Database engine, session management, and base models."""

from collections.abc import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from backend.app.config import get_settings

settings = get_settings()

db_url = settings.database_url
connect_args = {}

if db_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False
    # If using relative path like sqlite:///data/app.db, ensure absolute path from root
    if db_url.startswith("sqlite:///data/"):
        abs_db_path = settings.data_dir / "app.db"
        db_url = f"sqlite:///{abs_db_path.as_posix()}"

engine = create_engine(db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI database session dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user_id() -> str:
    """Multi-user seam: returns active profile ID in local mode, JWT subject in hosted mode."""
    cfg = get_settings()
    if cfg.app_mode == "hosted":
        # Seam for future auth token decode
        return "hosted-user-placeholder"
    return cfg.active_profile_id or "local-default"


def init_db() -> None:
    """Create all database tables and apply lightweight SQLite migrations."""
    # Ensure models are imported before creating tables
    import backend.app.models  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # Lightweight schema migrations for existing SQLite instances
    with engine.connect() as conn:
        try:
            res = conn.execute(text("PRAGMA table_info(listings)")).fetchall()
            existing_cols = {r[1] for r in res}
            if existing_cols:
                if "location" not in existing_cols:
                    conn.execute(text("ALTER TABLE listings ADD COLUMN location VARCHAR(255)"))
                if "html_hints" not in existing_cols:
                    conn.execute(text("ALTER TABLE listings ADD COLUMN html_hints JSON"))
                conn.commit()
        except Exception:
            pass

        try:
            sm_res = conn.execute(text("PRAGMA table_info(subject_matches)")).fetchall()
            sm_cols = {r[1] for r in sm_res}
            if sm_cols:
                if "interest_score" not in sm_cols:
                    conn.execute(text("ALTER TABLE subject_matches ADD COLUMN interest_score INTEGER DEFAULT 0"))
                if "interest_tier" not in sm_cols:
                    conn.execute(text("ALTER TABLE subject_matches ADD COLUMN interest_tier VARCHAR(20) DEFAULT 'medium'"))
                if "why_interesting" not in sm_cols:
                    conn.execute(text("ALTER TABLE subject_matches ADD COLUMN why_interesting TEXT DEFAULT ''"))
                if "score_breakdown" not in sm_cols:
                    conn.execute(text("ALTER TABLE subject_matches ADD COLUMN score_breakdown JSON"))
                conn.commit()
        except Exception:
            pass
