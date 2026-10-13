from __future__ import annotations

import time
import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy import delete, select

from app.config import get_settings
from app.db import get_session_factory
from app.models import ChecklistItem, Edge, Node, Project, Todo
from app.rules import infer_handles


DEMO_EMAIL = "demo@flowstate.app"
DEMO_PASSWORD = "flowstate"

# Shared meaning across the demo account:
# rose = work, green = friends & family, amber = home,
# teal = health, blue = learning, violet = travel.


def _today() -> date:
    return date.today()


def _add(days: int) -> date:
    return _today() + timedelta(days=days)


def _edge(project_id, source, target, nodes_by_id):
    source_node = nodes_by_id[source]
    target_node = nodes_by_id[target]
    source_handle, target_handle = infer_handles(source_node.x, source_node.y, target_node.x, target_node.y)
    return Edge(
        project_id=project_id,
        source_node_id=source,
        target_node_id=target,
        source_handle=source_handle,
        target_handle=target_handle,
    )


def _ids(count: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(count)]


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


def clear_all_app_data(db) -> int:
    """Remove projects/todos for every account. Auth users are left untouched."""
    projects = list(db.scalars(select(Project)))
    for project in projects:
        db.delete(project)
    deleted_todos = db.execute(delete(Todo))
    db.flush()
    return len(projects) + (deleted_todos.rowcount or 0)


def seed() -> None:
    user_id = uuid.UUID(ensure_demo_user())
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        cleared = clear_all_app_data(db)
        print(f"Cleared app data across all accounts ({cleared} project/todo rows)")

        now = int(time.time() * 1000)
        # Newest first in the UI: simple examples at the top, complex at the bottom.
        shop, birthday, spanish, lisbon, health, move, portfolio, portal = (uuid.uuid4() for _ in range(8))
        db.add_all(
            [
                Project(
                    id=shop,
                    user_id=user_id,
                    title="1 · Weekend shop",
                    description="A tiny linear plan — three steps, nothing fancy.",
                    status="active",
                    created_at=now,
                ),
                Project(
                    id=birthday,
                    user_id=user_id,
                    title="2 · Mum's birthday",
                    description="Gift, cake, and a table for four — a small funnel.",
                    status="active",
                    created_at=now - 1000,
                ),
                Project(
                    id=spanish,
                    user_id=user_id,
                    title="3 · Learn Spanish",
                    description="A simple weekly rhythm to get past beginner.",
                    status="active",
                    created_at=now - 2000,
                ),
                Project(
                    id=lisbon,
                    user_id=user_id,
                    title="4 · Weekend in Lisbon",
                    description="Flights, a stay, and a loose plan for two days.",
                    status="active",
                    created_at=now - 3000,
                ),
                Project(
                    id=health,
                    user_id=user_id,
                    title="5 · Health week",
                    description="Two parallel tracks: food and recovery.",
                    status="active",
                    created_at=now - 4000,
                ),
                Project(
                    id=move,
                    user_id=user_id,
                    title="6 · Moving house",
                    description="Leave the flat and settle into the new place.",
                    status="active",
                    created_at=now - 5000,
                ),
                Project(
                    id=portfolio,
                    user_id=user_id,
                    title="7 · Portfolio site",
                    description="Branches that rejoin — design and photos both feed the build.",
                    status="active",
                    created_at=now - 6000,
                ),
                Project(
                    id=portal,
                    user_id=user_id,
                    title="8 · Northshore client portal",
                    description="A full work map: research, build tracks, and a launch path.",
                    status="active",
                    created_at=now - 7000,
                ),
            ]
        )

        (
            kickoff,
            brief,
            research_ops,
            interviews,
            competitors,
            ia,
            wireframes,
            prototype,
            review,
            components,
            auth,
            dashboard,
            uploads,
            approvals,
            notifications,
            reporting,
            a11y,
            staging,
            uat,
            launch,
        ) = _ids(20)
        research, design, photos, build, publish = _ids(5)
        landlord, pack, utilities, van, unpack = _ids(5)
        vocab, listen, grammar, speak = _ids(4)
        food_shop, cook, walk, sleep = _ids(4)
        flights, stay, days, pack_bag = _ids(4)
        invite, gift, cake, book_table = _ids(4)
        list_items, buy_food, put_away = _ids(3)
        db.flush()

        node_rows = [
            # 1 · Weekend shop — simplest linear chain.
            Node(id=list_items, project_id=shop, title="Write the list", description="Milk, bread, fruit, washing-up liquid.", importance="medium", notes="", status="done", x=80, y=160, due_date=_add(-1)),
            Node(id=buy_food, project_id=shop, title="Go to the shop", description="One trip, no wandering the aisles.", importance="high", notes="", status="doing", x=400, y=160, due_date=_today()),
            Node(id=put_away, project_id=shop, title="Put it away", description="Fridge first, then the cupboard.", importance="low", notes="", status="todo", x=720, y=160, due_date=_add(1)),
            # Large work map: four columns, mostly top-to-bottom. 12 of 20 done = 60%.
            Node(id=kickoff, project_id=portal, title="Kickoff with ops", description="Who uses this, and what is painful today.", importance="high", notes="Paper folders, email chains, no audit trail.", status="done", x=80, y=40, due_date=_add(-40)),
            Node(id=brief, project_id=portal, title="Write the brief", description="Scope, out of scope, and a first release.", importance="high", notes="", status="done", x=80, y=200, due_date=_add(-35)),
            Node(id=research_ops, project_id=portal, title="Map the current process", description="From request in, to a signed-off pack.", importance="medium", notes="", status="done", x=80, y=360, due_date=_add(-30)),
            Node(id=interviews, project_id=portal, title="Interview six users", description="Two from ops, two from field, two from finance.", importance="high", notes="", status="done", x=80, y=520, due_date=_add(-24)),
            Node(id=competitors, project_id=portal, title="Look at similar tools", description="Steal the calm bits, ignore the clutter.", importance="low", notes="", status="done", x=80, y=680, due_date=_add(-22)),
            Node(id=ia, project_id=portal, title="Information architecture", description="Jobs, documents, people, status.", importance="high", notes="", status="done", x=420, y=40, due_date=_add(-18)),
            Node(id=wireframes, project_id=portal, title="Wireframes", description="List, detail, upload, approval.", importance="high", notes="", status="done", x=420, y=200, due_date=_add(-14)),
            Node(id=prototype, project_id=portal, title="Clickable prototype", description="Enough to walk through with ops.", importance="medium", notes="", status="done", x=420, y=360, due_date=_add(-11)),
            Node(id=review, project_id=portal, title="Design review", description="Get a yes on the main paths.", importance="high", notes="Signed off last Thursday.", status="done", x=420, y=520, due_date=_add(-8)),
            Node(id=components, project_id=portal, title="Component library", description="Buttons, tables, files, status chips.", importance="medium", notes="", status="done", x=420, y=680, due_date=_add(-6)),
            Node(id=auth, project_id=portal, title="Auth and accounts", description="Invite, roles, password reset.", importance="high", notes="", status="done", x=760, y=40, due_date=_add(-4)),
            Node(id=dashboard, project_id=portal, title="Jobs dashboard", description="What is waiting on me today.", importance="high", notes="", status="done", x=760, y=200, due_date=_add(-1)),
            Node(id=uploads, project_id=portal, title="Document upload", description="PDFs, photos, a simple version history.", importance="high", notes="Stuck on large files.", status="doing", x=760, y=360, due_date=_today()),
            Node(id=approvals, project_id=portal, title="Approvals flow", description="Request, comment, sign off, lock.", importance="high", notes="", status="doing", x=760, y=520, due_date=_add(3)),
            Node(id=notifications, project_id=portal, title="Notifications", description="Email when a job is waiting.", importance="medium", notes="", status="todo", x=760, y=680, due_date=_add(7)),
            Node(id=reporting, project_id=portal, title="Simple reporting", description="Open jobs, stuck jobs, time to sign-off.", importance="medium", notes="", status="todo", x=760, y=840, due_date=_add(10)),
            Node(id=a11y, project_id=portal, title="Accessibility pass", description="Keyboard, contrast, forms.", importance="medium", notes="", status="todo", x=1100, y=200, due_date=_add(12)),
            Node(id=staging, project_id=portal, title="Staging deploy", description="Their data, our build.", importance="high", notes="", status="todo", x=1100, y=400, due_date=_add(16)),
            Node(id=uat, project_id=portal, title="Client UAT", description="A week with the real ops team.", importance="high", notes="", status="todo", x=1100, y=600, due_date=_add(21)),
            Node(id=launch, project_id=portal, title="Launch", description="Turn off the paper process on a Monday.", importance="high", notes="", status="todo", x=1100, y=800, due_date=_add(28)),
            # Portfolio stays left to right.
            Node(id=research, project_id=portfolio, title="Research", description="Look at sites you like.", importance="medium", notes="Collect three sites with clear type.", status="doing", x=80, y=140, due_date=_today()),
            Node(id=design, project_id=portfolio, title="Design", description="Layout, type, and colour.", importance="high", notes="", status="done", x=400, y=140, due_date=_add(-2)),
            Node(id=photos, project_id=portfolio, title="Photos", description="Work shots and a simple portrait.", importance="low", notes="", status="todo", x=400, y=340, due_date=_add(2)),
            Node(id=build, project_id=portfolio, title="Build the pages", description="Home, work, and about.", importance="high", notes="Keep the pages short.", status="todo", x=720, y=220, due_date=_add(7)),
            Node(id=publish, project_id=portfolio, title="Publish", description="Put it on a public address.", importance="medium", notes="", status="todo", x=1040, y=220, due_date=_add(12)),
            # Moving house: top to bottom.
            Node(id=landlord, project_id=move, title="Tell the landlord", description="Notice and the deposit.", importance="high", notes="Email already sent.", status="done", x=220, y=40, due_date=_add(-5)),
            Node(id=pack, project_id=move, title="Pack the kitchen", description="Boxes, labels, fragile items.", importance="medium", notes="", status="doing", x=220, y=200, due_date=_add(3)),
            Node(id=utilities, project_id=move, title="Switch utilities", description="Internet, council tax, energy.", importance="high", notes="", status="todo", x=220, y=360, due_date=_add(1)),
            Node(id=van, project_id=move, title="Book a van", description="A morning slot on moving day.", importance="high", notes="", status="todo", x=220, y=520, due_date=_add(8)),
            Node(id=unpack, project_id=move, title="Unpack", description="Kitchen first, then the rest.", importance="low", notes="", status="todo", x=220, y=680, due_date=_add(10)),
            # Spanish: top to bottom.
            Node(id=vocab, project_id=spanish, title="Daily words", description="Ten new words, spoken out loud.", importance="medium", notes="", status="doing", x=220, y=40, due_date=_today()),
            Node(id=listen, project_id=spanish, title="Listening", description="A short podcast while walking.", importance="low", notes="", status="todo", x=220, y=210, due_date=_add(1)),
            Node(id=grammar, project_id=spanish, title="Present tense", description="Regular verbs until they feel easy.", importance="high", notes="", status="todo", x=220, y=380, due_date=_add(4)),
            Node(id=speak, project_id=spanish, title="Speak with someone", description="A 20 minute conversation.", importance="high", notes="", status="todo", x=220, y=550, due_date=_add(6)),
            # Health: two vertical tracks.
            Node(id=food_shop, project_id=health, title="Food shop", description="A list that lasts the week.", importance="medium", notes="", status="todo", x=80, y=40, due_date=_add(4)),
            Node(id=cook, project_id=health, title="Cook twice", description="A pot of something you can reheat.", importance="low", notes="", status="todo", x=80, y=240, due_date=_add(2)),
            Node(id=walk, project_id=health, title="Walks", description="30 minutes, no headset required.", importance="medium", notes="", status="todo", x=400, y=40, due_date=_today()),
            Node(id=sleep, project_id=health, title="Sleep window", description="Lights down by 22:30.", importance="high", notes="", status="doing", x=400, y=240, due_date=_today()),
            # Lisbon stays left to right.
            Node(id=flights, project_id=lisbon, title="Book flights", description="Out Friday evening, back Monday morning.", importance="high", notes="Prefer a direct flight.", status="done", x=80, y=160, due_date=_add(-4)),
            Node(id=stay, project_id=lisbon, title="Find a stay", description="Central, walking distance to trams.", importance="high", notes="", status="doing", x=400, y=160, due_date=_today()),
            Node(id=days, project_id=lisbon, title="Plan the days", description="One neighbourhood per day, leave room to wander.", importance="medium", notes="Alfama, Belem, a miradouro at sunset.", status="todo", x=720, y=160, due_date=_add(2)),
            Node(id=pack_bag, project_id=lisbon, title="Pack", description="Light bag, decent walking shoes.", importance="low", notes="", status="todo", x=1040, y=160, due_date=_add(9)),
            # Birthday: funnel from the top.
            Node(id=invite, project_id=birthday, title="Invite people", description="Keep it to four.", importance="medium", notes="", status="done", x=80, y=40, due_date=_add(-1)),
            Node(id=gift, project_id=birthday, title="Choose a gift", description="Something she will actually use.", importance="high", notes="The garden book, or the scarf.", status="doing", x=400, y=40, due_date=_add(4)),
            Node(id=cake, project_id=birthday, title="Order the cake", description="Lemon, not too sweet.", importance="medium", notes="", status="todo", x=240, y=240, due_date=_add(7)),
            Node(id=book_table, project_id=birthday, title="Book a table", description="Saturday lunch, somewhere quiet.", importance="high", notes="", status="todo", x=240, y=440, due_date=_add(5)),
        ]
        db.add_all(node_rows)
        db.flush()
        by_id = {node.id: node for node in node_rows}

        pairs = [
            (shop, list_items, buy_food),
            (shop, buy_food, put_away),
            (portal, kickoff, brief),
            (portal, brief, research_ops),
            (portal, research_ops, interviews),
            (portal, interviews, competitors),
            (portal, interviews, ia),
            (portal, competitors, ia),
            (portal, ia, wireframes),
            (portal, wireframes, prototype),
            (portal, prototype, review),
            (portal, review, components),
            (portal, components, auth),
            (portal, components, dashboard),
            (portal, auth, dashboard),
            (portal, dashboard, uploads),
            (portal, uploads, approvals),
            (portal, approvals, notifications),
            (portal, dashboard, reporting),
            (portal, components, a11y),
            (portal, approvals, staging),
            (portal, reporting, staging),
            (portal, notifications, staging),
            (portal, a11y, staging),
            (portal, staging, uat),
            (portal, uat, launch),
            (portfolio, research, design),
            (portfolio, design, build),
            (portfolio, photos, build),
            (portfolio, build, publish),
            (move, landlord, pack),
            (move, pack, utilities),
            (move, utilities, van),
            (move, van, unpack),
            (spanish, vocab, listen),
            (spanish, listen, grammar),
            (spanish, grammar, speak),
            (health, food_shop, cook),
            (health, walk, sleep),
            (lisbon, flights, stay),
            (lisbon, stay, days),
            (lisbon, days, pack_bag),
            (birthday, invite, cake),
            (birthday, gift, cake),
            (birthday, cake, book_table),
        ]
        db.add_all([_edge(project_id, source, target, by_id) for project_id, source, target in pairs])
        db.add_all(
            [
                ChecklistItem(node_id=interviews, text="Book the six slots", done=True, position=0),
                ChecklistItem(node_id=interviews, text="Write the notes up", done=True, position=1),
                ChecklistItem(node_id=wireframes, text="List view", done=True, position=0),
                ChecklistItem(node_id=wireframes, text="Job detail", done=True, position=1),
                ChecklistItem(node_id=wireframes, text="Upload + approve", done=True, position=2),
                ChecklistItem(node_id=uploads, text="Accept PDF and photos", done=True, position=0),
                ChecklistItem(node_id=uploads, text="Handle files over 20MB", done=False, position=1),
                ChecklistItem(node_id=approvals, text="Comment thread", done=False, position=0),
                ChecklistItem(node_id=approvals, text="Lock after sign-off", done=False, position=1),
                ChecklistItem(node_id=staging, text="Seed with a copy of last month", done=False, position=0),
                ChecklistItem(node_id=build, text="Sketch the layouts", done=True, position=0),
                ChecklistItem(node_id=build, text="Write the home page", done=False, position=1),
                ChecklistItem(node_id=pack, text="Get boxes", done=False, position=0),
                ChecklistItem(node_id=pack, text="Label each box", done=False, position=1),
                ChecklistItem(node_id=vocab, text="Write today's ten words", done=False, position=0),
                ChecklistItem(node_id=cook, text="Choose a recipe", done=True, position=0),
                ChecklistItem(node_id=cook, text="Defrost anything needed", done=False, position=1),
                ChecklistItem(node_id=stay, text="Compare three places", done=True, position=0),
                ChecklistItem(node_id=stay, text="Check cancellation", done=False, position=1),
                ChecklistItem(node_id=gift, text="Look at the garden book", done=False, position=0),
                ChecklistItem(node_id=book_table, text="Call if they do not take bookings online", done=False, position=0),
            ]
        )
        db.add_all(
            [
                Todo(user_id=user_id, project_id=portal, node_id=uploads, text="Fix large file uploads", done=False, due_date=_today(), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portal, node_id=approvals, text="Walk ops through the approval path", done=False, due_date=_add(2), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portal, node_id=dashboard, text="Send the weekly build note", done=False, due_date=_add(1), recurrence="weekly", color="rose"),
                Todo(user_id=user_id, project_id=portal, node_id=uat, text="Book the UAT week with Northshore", done=False, due_date=_add(8), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portal, text="Invoice the second milestone", done=False, due_date=_add(5), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portfolio, node_id=build, text="Write the about page", done=False, due_date=_today(), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portfolio, text="Pick fonts", done=True, due_date=_add(-1), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portfolio, node_id=publish, text="Choose a host", done=False, due_date=_add(3), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=portfolio, node_id=photos, text="Take three project photos", done=False, due_date=_add(2), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=move, text="Get packing boxes", done=False, due_date=_today(), recurrence="weekly", color="amber"),
                Todo(user_id=user_id, project_id=move, text="Measure the sofa", done=False, due_date=_add(5), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=move, node_id=utilities, text="Book the internet switch", done=False, due_date=_add(1), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=move, node_id=van, text="Confirm the van slot", done=False, due_date=_add(8), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=spanish, node_id=vocab, text="Ten Spanish words", done=False, due_date=_today(), recurrence="daily", color="blue"),
                Todo(user_id=user_id, project_id=spanish, node_id=listen, text="Spanish podcast while walking", done=False, due_date=_add(1), recurrence="weekly", color="blue"),
                Todo(user_id=user_id, project_id=spanish, node_id=speak, text="Book a conversation slot", done=False, due_date=_add(6), recurrence="none", color="blue"),
                Todo(user_id=user_id, project_id=health, node_id=walk, text="Walk after lunch", done=False, due_date=_today(), recurrence="daily", color="teal"),
                Todo(user_id=user_id, project_id=health, node_id=cook, text="Cook a pot of soup", done=False, due_date=_add(2), recurrence="weekly", color="teal"),
                Todo(user_id=user_id, project_id=health, node_id=food_shop, text="Weekly food shop", done=False, due_date=_add(4), recurrence="weekly", color="teal"),
                Todo(user_id=user_id, project_id=shop, node_id=buy_food, text="Pick up the weekend shop", done=False, due_date=_today(), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=lisbon, node_id=stay, text="Shortlist three stays", done=False, due_date=_today(), recurrence="none", color="violet"),
                Todo(user_id=user_id, project_id=lisbon, node_id=days, text="Read a short Lisbon walking guide", done=False, due_date=_add(2), recurrence="none", color="violet"),
                Todo(user_id=user_id, project_id=lisbon, node_id=pack_bag, text="Charge the camera", done=False, due_date=_add(9), recurrence="none", color="violet"),
                Todo(user_id=user_id, project_id=birthday, node_id=gift, text="Buy the gift", done=False, due_date=_add(4), recurrence="none", color="green"),
                Todo(user_id=user_id, project_id=birthday, node_id=cake, text="Order the lemon cake", done=False, due_date=_add(7), recurrence="none", color="green"),
                Todo(user_id=user_id, project_id=birthday, node_id=book_table, text="Book Saturday lunch", done=False, due_date=_add(5), recurrence="none", color="green"),
                Todo(user_id=user_id, text="Buy milk", done=False, due_date=_today(), recurrence="daily", color="amber"),
                Todo(user_id=user_id, text="Call Mum", done=False, due_date=_add(3), recurrence="none", color="green"),
                Todo(user_id=user_id, text="Water the plants", done=False, due_date=_add(1), recurrence="weekly", color="amber"),
                Todo(user_id=user_id, text="Bin night", done=False, due_date=_add(2), recurrence="weekly", color="amber"),
            ]
        )
        db.commit()
        print(f"Seeded demo examples on {DEMO_EMAIL} (simple → complex)")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
