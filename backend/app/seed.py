from __future__ import annotations

import time
import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.db import get_session_factory
from app.models import ChecklistItem, Edge, Node, Project, Todo


DEMO_EMAIL = "demo@flowstate.app"
DEMO_PASSWORD = "flowstate"


def _today() -> date:
    return date.today()


def _add(days: int) -> date:
    return _today() + timedelta(days=days)


def ensure_demo_user() -> str:
    settings = get_settings()
    url = settings.public_supabase_url
    key = settings.supabase_secret_key
    if not url or not key:
        raise SystemExit("SUPABASE_SECRET_KEY and project URL are required to seed")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=20.0) as client:
        listed = client.get(f"{url}/auth/v1/admin/users", headers=headers, params={"page": 1, "per_page": 200})
        if listed.status_code == 200:
            users = listed.json().get("users") or listed.json()
            if isinstance(users, dict):
                users = users.get("users") or []
            for user in users:
                if (user.get("email") or "").lower() == DEMO_EMAIL:
                    return user["id"]
        created = client.post(
            f"{url}/auth/v1/admin/users",
            headers=headers,
            json={
                "email": DEMO_EMAIL,
                "password": DEMO_PASSWORD,
                "email_confirm": True,
                "user_metadata": {"name": "Demo"},
            },
        )
        if created.status_code not in (200, 201):
            raise SystemExit(f"Could not create demo user: {created.status_code} {created.text}")
        return created.json()["id"]


def seed() -> None:
    user_id = uuid.UUID(ensure_demo_user())
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        existing = db.scalar(select(Project).where(Project.user_id == user_id))
        if existing:
            print("Demo data already present")
            return
        now = int(time.time() * 1000)
        portfolio = uuid.uuid4()
        move = uuid.uuid4()
        db.add_all(
            [
                Project(
                    id=portfolio,
                    user_id=user_id,
                    title="Portfolio site",
                    description="A small site to show recent work.",
                    status="active",
                    created_at=now,
                ),
                Project(
                    id=move,
                    user_id=user_id,
                    title="Moving house",
                    description="Leave the flat and settle into the new place.",
                    status="active",
                    created_at=now - 1000,
                ),
            ]
        )
        research, design, build, publish = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        landlord, pack, van, unpack = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        db.flush()
        db.add_all(
            [
                Node(id=research, project_id=portfolio, title="Research", description="Look at sites you like.", importance="medium", notes="", status="doing", x=40, y=40),
                Node(id=design, project_id=portfolio, title="Design", description="Layout, type, and colour.", importance="high", notes="", status="done", x=40, y=200),
                Node(id=build, project_id=portfolio, title="Build the pages", description="Home, work, and about.", importance="high", notes="", status="todo", x=320, y=120),
                Node(id=publish, project_id=portfolio, title="Publish", description="Put it on a public address.", importance="medium", notes="", status="todo", x=600, y=120),
                Node(id=landlord, project_id=move, title="Tell the landlord", description="Notice and the deposit.", importance="high", notes="", status="done", x=40, y=80),
                Node(id=pack, project_id=move, title="Pack the kitchen", description="Boxes, labels, fragile items.", importance="medium", notes="", status="doing", x=300, y=40),
                Node(id=van, project_id=move, title="Book a van", description="A morning slot on moving day.", importance="high", notes="", status="todo", x=300, y=220),
                Node(id=unpack, project_id=move, title="Unpack", description="Kitchen first, then the rest.", importance="low", notes="", status="todo", x=560, y=130),
            ]
        )
        db.flush()
        db.add_all(
            [
                Edge(project_id=portfolio, source_node_id=research, target_node_id=build),
                Edge(project_id=portfolio, source_node_id=design, target_node_id=build),
                Edge(project_id=portfolio, source_node_id=build, target_node_id=publish),
                Edge(project_id=move, source_node_id=pack, target_node_id=van),
                Edge(project_id=move, source_node_id=van, target_node_id=unpack),
            ]
        )
        db.add_all(
            [
                ChecklistItem(node_id=build, text="Sketch the layouts", done=True, position=0),
                ChecklistItem(node_id=build, text="Write the home page", done=False, position=1),
                ChecklistItem(node_id=build, text="Pick fonts", done=False, position=2),
                ChecklistItem(node_id=pack, text="Get boxes", done=False, position=0),
                ChecklistItem(node_id=pack, text="Label each box", done=False, position=1),
            ]
        )
        db.add_all(
            [
                Todo(user_id=user_id, project_id=portfolio, text="Write the about page", done=False, due_date=_today(), recurrence="none"),
                Todo(user_id=user_id, project_id=portfolio, text="Pick fonts", done=True, due_date=_add(-1), recurrence="none"),
                Todo(user_id=user_id, project_id=portfolio, text="Choose a host", done=False, due_date=_add(3), recurrence="none"),
                Todo(user_id=user_id, project_id=move, text="Get packing boxes", done=False, due_date=_today(), recurrence="weekly"),
                Todo(user_id=user_id, project_id=move, text="Measure the sofa", done=False, due_date=_add(5), recurrence="none"),
                Todo(user_id=user_id, text="Buy milk", done=False, due_date=_today(), recurrence="daily"),
            ]
        )
        db.commit()
        print(f"Seeded demo user {DEMO_EMAIL}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
