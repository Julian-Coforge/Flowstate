from pathlib import Path

from sqlalchemy import text

from app.db import get_engine


def migration_paths() -> list[Path]:
    here = Path(__file__).resolve().parent.parent
    candidates = [
        here / "supabase" / "migrations",
        here.parent / "supabase" / "migrations",
    ]
    for folder in candidates:
        if folder.is_dir():
            return sorted(folder.glob("*.sql"))
    return []


def run() -> None:
    engine = get_engine()
    files = migration_paths()
    if not files:
        raise SystemExit("No SQL migrations found")
    with engine.begin() as connection:
        for path in files:
            connection.execute(text(path.read_text()))
    print(f"Applied {len(files)} migration(s)")


if __name__ == "__main__":
    run()
