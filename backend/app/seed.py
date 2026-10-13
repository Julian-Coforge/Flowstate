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


def clear_demo_data(db, user_id: uuid.UUID) -> int:
    """Remove projects and todos for the demo account only."""
    projects = list(db.scalars(select(Project).where(Project.user_id == user_id)))
    for project in projects:
        db.delete(project)
    deleted_todos = db.execute(delete(Todo).where(Todo.user_id == user_id))
    db.flush()
    return len(projects) + (deleted_todos.rowcount or 0)


def seed() -> None:
    user_id = uuid.UUID(ensure_demo_user())
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        cleared = clear_demo_data(db, user_id)
        print(f"Cleared demo account data ({cleared} project/todo rows)")

        now = int(time.time() * 1000)
        # Newest first in the UI: small personal → habits → medium → large software.
        (
            shop,
            stretch,
            dinner,
            guitar,
            lakes,
            kitchen,
            flux,
            atlas,
            ledger,
        ) = (uuid.uuid4() for _ in range(9))

        db.add_all(
            [
                Project(
                    id=shop,
                    user_id=user_id,
                    title="Weekly food shop",
                    description="Tiny horizontal chain — list, buy, put away.",
                    status="active",
                    created_at=now,
                ),
                Project(
                    id=stretch,
                    user_id=user_id,
                    title="Evening wind-down",
                    description="A short vertical habit loop for weeknights.",
                    status="active",
                    created_at=now - 1000,
                ),
                Project(
                    id=dinner,
                    user_id=user_id,
                    title="Sister's anniversary dinner",
                    description="Gift and booking funnel — small personal plan.",
                    status="active",
                    created_at=now - 2000,
                ),
                Project(
                    id=guitar,
                    user_id=user_id,
                    title="Learn guitar basics",
                    description="Vertical practice path with a daily repeating drill.",
                    status="active",
                    created_at=now - 3000,
                ),
                Project(
                    id=lakes,
                    user_id=user_id,
                    title="Lakes weekend",
                    description="Horizontal trip plan — travel, stay, walk, home.",
                    status="active",
                    created_at=now - 4000,
                ),
                Project(
                    id=kitchen,
                    user_id=user_id,
                    title="Kitchen refresh",
                    description="Vertical home jobs from measure to paint.",
                    status="active",
                    created_at=now - 5000,
                ),
                Project(
                    id=flux,
                    user_id=user_id,
                    title="Flux chat app",
                    description="Medium product map — design and build tracks remerge.",
                    status="active",
                    created_at=now - 6000,
                ),
                Project(
                    id=atlas,
                    user_id=user_id,
                    title="Atlas inventory platform",
                    description="Large software delivery — research, design, build, launch.",
                    status="active",
                    created_at=now - 7000,
                ),
                Project(
                    id=ledger,
                    user_id=user_id,
                    title="Ledger API rewrite",
                    description="Large horizontal migration with parallel service work.",
                    status="active",
                    created_at=now - 8000,
                ),
            ]
        )

        # --- id pools ---
        list_items, buy_food, put_away = _ids(3)
        screens, stretch_n, lights = _ids(3)
        invite, gift, book_table, confirm = _ids(4)
        tune, chords, song, jam = _ids(4)
        book_train, cottage, hike, drive_home = _ids(4)
        measure, order_paint, clear_cupboards, paint, restock = _ids(5)
        (
            flux_brief,
            flux_flows,
            flux_ui,
            flux_auth,
            flux_rooms,
            flux_push,
            flux_beta,
            flux_ship,
        ) = _ids(8)
        (
            a_kickoff,
            a_brief,
            a_research,
            a_interviews,
            a_ia,
            a_wire,
            a_proto,
            a_review,
            a_api,
            a_stock,
            a_scan,
            a_alerts,
            a_reports,
            a_a11y,
            a_staging,
            a_uat,
            a_launch,
        ) = _ids(17)
        (
            l_audit,
            l_contracts,
            l_schema,
            l_payments,
            l_invoices,
            l_webhooks,
            l_cutover,
            l_monitor,
            l_docs,
            l_retire,
        ) = _ids(10)

        db.flush()

        node_rows = [
            # 1 · Weekly food shop — horizontal.
            Node(
                id=list_items,
                project_id=shop,
                title="Write the list",
                description="Milk, eggs, fruit, washing-up liquid.",
                importance="medium",
                notes="",
                status="done",
                x=80,
                y=160,
                due_date=_add(-1),
                recurrence="weekly",
            ),
            Node(
                id=buy_food,
                project_id=shop,
                title="Do the shop",
                description="One trip after work.",
                importance="high",
                notes="",
                status="doing",
                x=400,
                y=160,
                due_date=_today(),
                recurrence="weekly",
            ),
            Node(
                id=put_away,
                project_id=shop,
                title="Put it away",
                description="Fridge first, then the cupboard.",
                importance="low",
                notes="",
                status="todo",
                x=720,
                y=160,
                due_date=_add(1),
                recurrence="weekly",
            ),
            # 2 · Evening wind-down — vertical habit.
            Node(
                id=screens,
                project_id=stretch,
                title="Park the phone",
                description="Leave it in the kitchen after 21:30.",
                importance="high",
                notes="",
                status="doing",
                x=220,
                y=40,
                due_date=_today(),
                recurrence="daily",
            ),
            Node(
                id=stretch_n,
                project_id=stretch,
                title="Ten-minute stretch",
                description="Neck, hips, and a short walk around the flat.",
                importance="medium",
                notes="",
                status="todo",
                x=220,
                y=220,
                due_date=_today(),
                recurrence="daily",
            ),
            Node(
                id=lights,
                project_id=stretch,
                title="Lights down",
                description="Dim the room and set the alarm.",
                importance="medium",
                notes="",
                status="todo",
                x=220,
                y=400,
                due_date=_today(),
                recurrence="daily",
            ),
            # 3 · Sister's anniversary — small funnel.
            Node(
                id=invite,
                project_id=dinner,
                title="Confirm the date",
                description="Saturday evening works for both of them.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=40,
                due_date=_add(-3),
            ),
            Node(
                id=gift,
                project_id=dinner,
                title="Choose a gift",
                description="Something for the garden, not another gadget.",
                importance="high",
                notes="Look at the plant stand and the book.",
                status="doing",
                x=400,
                y=40,
                due_date=_add(2),
            ),
            Node(
                id=book_table,
                project_id=dinner,
                title="Book the restaurant",
                description="Quiet corner, not the loud room upstairs.",
                importance="high",
                notes="",
                status="todo",
                x=240,
                y=240,
                due_date=_add(4),
            ),
            Node(
                id=confirm,
                project_id=dinner,
                title="Send the plan",
                description="Time, address, and gift wrap reminder.",
                importance="medium",
                notes="",
                status="todo",
                x=240,
                y=420,
                due_date=_add(6),
            ),
            # 4 · Guitar — vertical learning.
            Node(
                id=tune,
                project_id=guitar,
                title="Tune and warm up",
                description="Five minutes before anything else.",
                importance="medium",
                notes="",
                status="doing",
                x=220,
                y=40,
                due_date=_today(),
                recurrence="daily",
            ),
            Node(
                id=chords,
                project_id=guitar,
                title="Open chords",
                description="G, C, D, Em — clean changes.",
                importance="high",
                notes="",
                status="todo",
                x=220,
                y=210,
                due_date=_add(1),
                recurrence="daily",
            ),
            Node(
                id=song,
                project_id=guitar,
                title="Learn one song",
                description="A short three-chord tune all the way through.",
                importance="high",
                notes="",
                status="todo",
                x=220,
                y=380,
                due_date=_add(10),
            ),
            Node(
                id=jam,
                project_id=guitar,
                title="Play with a friend",
                description="Twenty minutes, no performance pressure.",
                importance="low",
                notes="",
                status="todo",
                x=220,
                y=550,
                due_date=_add(21),
            ),
            # 5 · Lakes weekend — horizontal travel.
            Node(
                id=book_train,
                project_id=lakes,
                title="Book trains",
                description="Out Friday afternoon, back Sunday evening.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=160,
                due_date=_add(-5),
            ),
            Node(
                id=cottage,
                project_id=lakes,
                title="Confirm the cottage",
                description="Key safe code and parking notes.",
                importance="high",
                notes="",
                status="doing",
                x=400,
                y=160,
                due_date=_today(),
            ),
            Node(
                id=hike,
                project_id=lakes,
                title="Pick a Saturday walk",
                description="Something with a pub near the end.",
                importance="medium",
                notes="Catbells if the weather holds.",
                status="todo",
                x=720,
                y=160,
                due_date=_add(3),
            ),
            Node(
                id=drive_home,
                project_id=lakes,
                title="Pack and leave",
                description="Boots, waterproof, and the train snacks.",
                importance="medium",
                notes="",
                status="todo",
                x=1040,
                y=160,
                due_date=_add(8),
            ),
            # 6 · Kitchen refresh — vertical home.
            Node(
                id=measure,
                project_id=kitchen,
                title="Measure the walls",
                description="Note sockets and the awkward corner.",
                importance="high",
                notes="",
                status="done",
                x=220,
                y=40,
                due_date=_add(-4),
            ),
            Node(
                id=order_paint,
                project_id=kitchen,
                title="Order paint",
                description="Eggshell white and a sample pot of green.",
                importance="high",
                notes="",
                status="doing",
                x=220,
                y=200,
                due_date=_add(-1),
            ),
            Node(
                id=clear_cupboards,
                project_id=kitchen,
                title="Clear the cupboards",
                description="Bin the cracked Tupperware.",
                importance="medium",
                notes="",
                status="todo",
                x=220,
                y=360,
                due_date=_add(2),
            ),
            Node(
                id=paint,
                project_id=kitchen,
                title="Paint",
                description="Two coats, tape the cabinets carefully.",
                importance="high",
                notes="",
                status="todo",
                x=220,
                y=520,
                due_date=_add(7),
            ),
            Node(
                id=restock,
                project_id=kitchen,
                title="Restock and tidy",
                description="Put things back in a better order.",
                importance="low",
                notes="",
                status="todo",
                x=220,
                y=680,
                due_date=_add(10),
            ),
            # 7 · Flux chat app — medium software, diverge / remerge.
            Node(
                id=flux_brief,
                project_id=flux,
                title="Product brief",
                description="Who it is for, and what is out of scope.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=200,
                due_date=_add(-12),
            ),
            Node(
                id=flux_flows,
                project_id=flux,
                title="Core flows",
                description="Sign in, join a room, send a message.",
                importance="high",
                notes="",
                status="done",
                x=360,
                y=80,
                due_date=_add(-8),
            ),
            Node(
                id=flux_ui,
                project_id=flux,
                title="UI kit",
                description="Message list, composer, presence dots.",
                importance="medium",
                notes="",
                status="doing",
                x=360,
                y=320,
                due_date=_today(),
            ),
            Node(
                id=flux_auth,
                project_id=flux,
                title="Auth",
                description="Email magic link and session cookies.",
                importance="high",
                notes="",
                status="doing",
                x=640,
                y=80,
                due_date=_add(2),
            ),
            Node(
                id=flux_rooms,
                project_id=flux,
                title="Rooms & messages",
                description="Realtime fan-out and read state.",
                importance="high",
                notes="",
                status="todo",
                x=640,
                y=240,
                due_date=_add(6),
            ),
            Node(
                id=flux_push,
                project_id=flux,
                title="Push notifications",
                description="Mute rules and quiet hours.",
                importance="medium",
                notes="",
                status="todo",
                x=640,
                y=400,
                due_date=_add(9),
            ),
            Node(
                id=flux_beta,
                project_id=flux,
                title="Closed beta",
                description="Twelve friends for a week.",
                importance="high",
                notes="",
                status="todo",
                x=920,
                y=200,
                due_date=_add(16),
            ),
            Node(
                id=flux_ship,
                project_id=flux,
                title="Public launch",
                description="Landing page and waitlist off.",
                importance="high",
                notes="",
                status="todo",
                x=1200,
                y=200,
                due_date=_add(28),
            ),
            # 8 · Atlas inventory — large vertical columns.
            Node(
                id=a_kickoff,
                project_id=atlas,
                title="Kickoff with warehouse",
                description="What breaks today on paper stock sheets.",
                importance="high",
                notes="Night shift still uses clipboards.",
                status="done",
                x=80,
                y=40,
                due_date=_add(-45),
            ),
            Node(
                id=a_brief,
                project_id=atlas,
                title="Write the brief",
                description="MVP: receive, locate, pick, adjust.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=200,
                due_date=_add(-40),
            ),
            Node(
                id=a_research,
                project_id=atlas,
                title="Map the floor process",
                description="From goods-in to dispatch.",
                importance="medium",
                notes="",
                status="done",
                x=80,
                y=360,
                due_date=_add(-34),
            ),
            Node(
                id=a_interviews,
                project_id=atlas,
                title="Interview pickers",
                description="Four pickers, two supervisors.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=520,
                due_date=_add(-28),
            ),
            Node(
                id=a_ia,
                project_id=atlas,
                title="Information architecture",
                description="SKU, location, batch, movement.",
                importance="high",
                notes="",
                status="done",
                x=420,
                y=40,
                due_date=_add(-22),
            ),
            Node(
                id=a_wire,
                project_id=atlas,
                title="Wireframes",
                description="Handheld scan flow and desk console.",
                importance="high",
                notes="",
                status="done",
                x=420,
                y=200,
                due_date=_add(-16),
            ),
            Node(
                id=a_proto,
                project_id=atlas,
                title="Clickable prototype",
                description="Walk the pick path with a supervisor.",
                importance="medium",
                notes="",
                status="done",
                x=420,
                y=360,
                due_date=_add(-11),
            ),
            Node(
                id=a_review,
                project_id=atlas,
                title="Design review",
                description="Sign-off on the main paths.",
                importance="high",
                notes="Approved last week.",
                status="done",
                x=420,
                y=520,
                due_date=_add(-7),
            ),
            Node(
                id=a_api,
                project_id=atlas,
                title="Inventory API",
                description="Movements, reservations, adjustments.",
                importance="high",
                notes="",
                status="doing",
                x=760,
                y=40,
                due_date=_add(-2),
            ),
            Node(
                id=a_stock,
                project_id=atlas,
                title="Stock console",
                description="Search, filter, and bulk adjust.",
                importance="high",
                notes="",
                status="doing",
                x=760,
                y=200,
                due_date=_today(),
            ),
            Node(
                id=a_scan,
                project_id=atlas,
                title="Scan-to-pick",
                description="Barcode confirm on each bin.",
                importance="high",
                notes="Offline queue still flaky.",
                status="doing",
                x=760,
                y=360,
                due_date=_add(3),
            ),
            Node(
                id=a_alerts,
                project_id=atlas,
                title="Low-stock alerts",
                description="Thresholds per SKU family.",
                importance="medium",
                notes="",
                status="todo",
                x=760,
                y=520,
                due_date=_add(8),
            ),
            Node(
                id=a_reports,
                project_id=atlas,
                title="Daily stock report",
                description="Variance and stuck picks.",
                importance="medium",
                notes="",
                status="todo",
                x=760,
                y=680,
                due_date=_add(12),
            ),
            Node(
                id=a_a11y,
                project_id=atlas,
                title="Accessibility pass",
                description="Handheld contrast and large tap targets.",
                importance="medium",
                notes="",
                status="todo",
                x=1100,
                y=160,
                due_date=_add(14),
            ),
            Node(
                id=a_staging,
                project_id=atlas,
                title="Staging with live data",
                description="Masked copy of last Friday's stock.",
                importance="high",
                notes="",
                status="todo",
                x=1100,
                y=340,
                due_date=_add(18),
            ),
            Node(
                id=a_uat,
                project_id=atlas,
                title="Warehouse UAT",
                description="Night shift runs three real waves.",
                importance="high",
                notes="",
                status="todo",
                x=1100,
                y=520,
                due_date=_add(24),
            ),
            Node(
                id=a_launch,
                project_id=atlas,
                title="Go live",
                description="Retire the paper sheets on a Monday.",
                importance="high",
                notes="",
                status="todo",
                x=1100,
                y=700,
                due_date=_add(32),
            ),
            # 9 · Ledger API rewrite — large horizontal migration.
            Node(
                id=l_audit,
                project_id=ledger,
                title="Audit the old API",
                description="List every consumer and the endpoints they hit.",
                importance="high",
                notes="",
                status="done",
                x=80,
                y=220,
                due_date=_add(-30),
            ),
            Node(
                id=l_contracts,
                project_id=ledger,
                title="Freeze contracts",
                description="OpenAPI for v2, with deprecation dates.",
                importance="high",
                notes="",
                status="done",
                x=360,
                y=220,
                due_date=_add(-20),
            ),
            Node(
                id=l_schema,
                project_id=ledger,
                title="New ledger schema",
                description="Append-only entries and idempotent writes.",
                importance="high",
                notes="",
                status="doing",
                x=640,
                y=80,
                due_date=_today(),
            ),
            Node(
                id=l_payments,
                project_id=ledger,
                title="Payments service",
                description="Capture, refund, and reconcile.",
                importance="high",
                notes="",
                status="doing",
                x=640,
                y=240,
                due_date=_add(4),
            ),
            Node(
                id=l_invoices,
                project_id=ledger,
                title="Invoices service",
                description="Line items, tax, and PDF render.",
                importance="high",
                notes="",
                status="todo",
                x=640,
                y=400,
                due_date=_add(7),
            ),
            Node(
                id=l_webhooks,
                project_id=ledger,
                title="Webhook bridge",
                description="Dual-write to old and new during cutover.",
                importance="medium",
                notes="",
                status="todo",
                x=920,
                y=160,
                due_date=_add(12),
            ),
            Node(
                id=l_cutover,
                project_id=ledger,
                title="Traffic cutover",
                description="Flip the gateway when lag is under a second.",
                importance="high",
                notes="",
                status="todo",
                x=920,
                y=320,
                due_date=_add(18),
            ),
            Node(
                id=l_monitor,
                project_id=ledger,
                title="Watch the metrics",
                description="Error budget and reconciliation jobs.",
                importance="high",
                notes="",
                status="todo",
                x=1200,
                y=160,
                due_date=_add(20),
            ),
            Node(
                id=l_docs,
                project_id=ledger,
                title="Update partner docs",
                description="Migration guide and sample clients.",
                importance="medium",
                notes="",
                status="todo",
                x=1200,
                y=320,
                due_date=_add(22),
            ),
            Node(
                id=l_retire,
                project_id=ledger,
                title="Retire v1",
                description="Turn off the old cluster after 30 quiet days.",
                importance="medium",
                notes="",
                status="todo",
                x=1480,
                y=220,
                due_date=_add(45),
            ),
        ]
        db.add_all(node_rows)
        db.flush()
        by_id = {node.id: node for node in node_rows}

        pairs = [
            # shop horizontal
            (shop, list_items, buy_food),
            (shop, buy_food, put_away),
            # stretch vertical
            (stretch, screens, stretch_n),
            (stretch, stretch_n, lights),
            # dinner funnel
            (dinner, invite, book_table),
            (dinner, gift, book_table),
            (dinner, book_table, confirm),
            # guitar vertical
            (guitar, tune, chords),
            (guitar, chords, song),
            (guitar, song, jam),
            # lakes horizontal
            (lakes, book_train, cottage),
            (lakes, cottage, hike),
            (lakes, hike, drive_home),
            # kitchen vertical
            (kitchen, measure, order_paint),
            (kitchen, order_paint, clear_cupboards),
            (kitchen, clear_cupboards, paint),
            (kitchen, paint, restock),
            # flux diverge / remerge
            (flux, flux_brief, flux_flows),
            (flux, flux_brief, flux_ui),
            (flux, flux_flows, flux_auth),
            (flux, flux_flows, flux_rooms),
            (flux, flux_ui, flux_rooms),
            (flux, flux_ui, flux_push),
            (flux, flux_auth, flux_beta),
            (flux, flux_rooms, flux_beta),
            (flux, flux_push, flux_beta),
            (flux, flux_beta, flux_ship),
            # atlas columns
            (atlas, a_kickoff, a_brief),
            (atlas, a_brief, a_research),
            (atlas, a_research, a_interviews),
            (atlas, a_interviews, a_ia),
            (atlas, a_ia, a_wire),
            (atlas, a_wire, a_proto),
            (atlas, a_proto, a_review),
            (atlas, a_review, a_api),
            (atlas, a_review, a_stock),
            (atlas, a_api, a_scan),
            (atlas, a_stock, a_scan),
            (atlas, a_scan, a_alerts),
            (atlas, a_stock, a_reports),
            (atlas, a_alerts, a_staging),
            (atlas, a_reports, a_staging),
            (atlas, a_review, a_a11y),
            (atlas, a_a11y, a_staging),
            (atlas, a_staging, a_uat),
            (atlas, a_uat, a_launch),
            # ledger horizontal migration
            (ledger, l_audit, l_contracts),
            (ledger, l_contracts, l_schema),
            (ledger, l_contracts, l_payments),
            (ledger, l_contracts, l_invoices),
            (ledger, l_schema, l_webhooks),
            (ledger, l_payments, l_webhooks),
            (ledger, l_invoices, l_webhooks),
            (ledger, l_webhooks, l_cutover),
            (ledger, l_cutover, l_monitor),
            (ledger, l_cutover, l_docs),
            (ledger, l_monitor, l_retire),
            (ledger, l_docs, l_retire),
        ]
        db.add_all([_edge(project_id, source, target, by_id) for project_id, source, target in pairs])

        db.add_all(
            [
                # shop
                ChecklistItem(node_id=list_items, text="Check what's left in the fridge", done=True, position=0),
                ChecklistItem(node_id=list_items, text="Add cleaning bits", done=True, position=1),
                ChecklistItem(node_id=buy_food, text="Take bags", done=False, position=0),
                # stretch
                ChecklistItem(node_id=stretch_n, text="Hip opener", done=False, position=0),
                ChecklistItem(node_id=stretch_n, text="Shoulder rolls", done=False, position=1),
                # dinner
                ChecklistItem(node_id=gift, text="Shortlist two options", done=True, position=0),
                ChecklistItem(node_id=gift, text="Check delivery time", done=False, position=1),
                ChecklistItem(node_id=book_table, text="Ask for a quiet table", done=False, position=0),
                # guitar
                ChecklistItem(node_id=chords, text="G to C cleanly", done=False, position=0),
                ChecklistItem(node_id=chords, text="D to Em without muted strings", done=False, position=1),
                ChecklistItem(node_id=song, text="Learn the verse", done=False, position=0),
                ChecklistItem(node_id=song, text="Learn the chorus", done=False, position=1),
                # lakes
                ChecklistItem(node_id=cottage, text="Save the key safe code", done=True, position=0),
                ChecklistItem(node_id=cottage, text="Ask about parking", done=False, position=1),
                ChecklistItem(node_id=hike, text="Check the weather window", done=False, position=0),
                ChecklistItem(node_id=drive_home, text="Charge the power bank", done=False, position=0),
                # kitchen
                ChecklistItem(node_id=order_paint, text="Order sample pots", done=True, position=0),
                ChecklistItem(node_id=order_paint, text="Order rollers and tape", done=False, position=1),
                ChecklistItem(node_id=clear_cupboards, text="Photograph the current layout", done=False, position=0),
                ChecklistItem(node_id=paint, text="Cut in the edges", done=False, position=0),
                ChecklistItem(node_id=paint, text="Second coat after lunch", done=False, position=1),
                # flux
                ChecklistItem(node_id=flux_ui, text="Message bubble states", done=True, position=0),
                ChecklistItem(node_id=flux_ui, text="Empty room state", done=False, position=1),
                ChecklistItem(node_id=flux_ui, text="Composer with attachments", done=False, position=2),
                ChecklistItem(node_id=flux_auth, text="Magic link email", done=True, position=0),
                ChecklistItem(node_id=flux_auth, text="Session refresh", done=False, position=1),
                ChecklistItem(node_id=flux_rooms, text="Create / join room", done=False, position=0),
                ChecklistItem(node_id=flux_rooms, text="Realtime delivery", done=False, position=1),
                ChecklistItem(node_id=flux_beta, text="Invite twelve testers", done=False, position=0),
                ChecklistItem(node_id=flux_beta, text="Collect feedback form", done=False, position=1),
                # atlas
                ChecklistItem(node_id=a_interviews, text="Book four picker slots", done=True, position=0),
                ChecklistItem(node_id=a_interviews, text="Write the notes up", done=True, position=1),
                ChecklistItem(node_id=a_wire, text="Handheld pick path", done=True, position=0),
                ChecklistItem(node_id=a_wire, text="Desk adjust screen", done=True, position=1),
                ChecklistItem(node_id=a_wire, text="Goods-in receive", done=False, position=2),
                ChecklistItem(node_id=a_api, text="Movement endpoints", done=True, position=0),
                ChecklistItem(node_id=a_api, text="Idempotent adjust", done=False, position=1),
                ChecklistItem(node_id=a_scan, text="Barcode confirm", done=True, position=0),
                ChecklistItem(node_id=a_scan, text="Offline queue retry", done=False, position=1),
                ChecklistItem(node_id=a_scan, text="Wrong-bin warning", done=False, position=2),
                ChecklistItem(node_id=a_staging, text="Mask personal data", done=False, position=0),
                ChecklistItem(node_id=a_uat, text="Night-shift checklist", done=False, position=0),
                # ledger
                ChecklistItem(node_id=l_audit, text="List partner integrations", done=True, position=0),
                ChecklistItem(node_id=l_audit, text="Flag undocumented callers", done=True, position=1),
                ChecklistItem(node_id=l_schema, text="Migration scripts", done=True, position=0),
                ChecklistItem(node_id=l_schema, text="Backfill dry-run", done=False, position=1),
                ChecklistItem(node_id=l_payments, text="Capture path", done=True, position=0),
                ChecklistItem(node_id=l_payments, text="Refund path", done=False, position=1),
                ChecklistItem(node_id=l_payments, text="Reconcile against bank file", done=False, position=2),
                ChecklistItem(node_id=l_invoices, text="PDF template", done=False, position=0),
                ChecklistItem(node_id=l_webhooks, text="Dual-write switch", done=False, position=0),
                ChecklistItem(node_id=l_cutover, text="Rollback runbook", done=False, position=0),
                ChecklistItem(node_id=l_cutover, text="On-call rota for cutover night", done=False, position=1),
            ]
        )

        db.add_all(
            [
                # shop / home
                Todo(user_id=user_id, project_id=shop, node_id=buy_food, text="Pick up the weekly shop", done=False, due_date=_today(), recurrence="weekly", color="amber"),
                Todo(user_id=user_id, project_id=shop, text="Check loyalty points", done=False, due_date=_add(1), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=stretch, node_id=stretch_n, text="Evening stretch", done=False, due_date=_today(), recurrence="daily", color="teal"),
                Todo(user_id=user_id, project_id=stretch, node_id=screens, text="Phone in the kitchen by 21:30", done=False, due_date=_today(), recurrence="daily", color="teal"),
                # family
                Todo(user_id=user_id, project_id=dinner, node_id=gift, text="Buy the anniversary gift", done=False, due_date=_add(2), recurrence="none", color="green"),
                Todo(user_id=user_id, project_id=dinner, node_id=book_table, text="Book the restaurant", done=False, due_date=_add(4), recurrence="none", color="green"),
                Todo(user_id=user_id, project_id=dinner, text="Write a short card", done=False, due_date=_add(5), recurrence="none", color="green"),
                # learning
                Todo(user_id=user_id, project_id=guitar, node_id=tune, text="Tune the guitar", done=False, due_date=_today(), recurrence="daily", color="blue"),
                Todo(user_id=user_id, project_id=guitar, node_id=chords, text="Fifteen minutes of chord changes", done=False, due_date=_today(), recurrence="daily", color="blue"),
                Todo(user_id=user_id, project_id=guitar, node_id=jam, text="Message Sam about a jam", done=False, due_date=_add(14), recurrence="none", color="blue"),
                # travel
                Todo(user_id=user_id, project_id=lakes, node_id=cottage, text="Confirm cottage check-in", done=False, due_date=_today(), recurrence="none", color="violet"),
                Todo(user_id=user_id, project_id=lakes, node_id=hike, text="Choose Saturday walk", done=False, due_date=_add(3), recurrence="none", color="violet"),
                Todo(user_id=user_id, project_id=lakes, node_id=drive_home, text="Pack walking boots", done=False, due_date=_add(7), recurrence="none", color="violet"),
                # home project
                Todo(user_id=user_id, project_id=kitchen, node_id=order_paint, text="Chase the paint delivery", done=False, due_date=_add(-1), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=kitchen, node_id=clear_cupboards, text="Clear top cupboard", done=False, due_date=_add(2), recurrence="none", color="amber"),
                Todo(user_id=user_id, project_id=kitchen, text="Borrow the tall stepladder", done=False, due_date=_add(5), recurrence="none", color="amber"),
                # flux
                Todo(user_id=user_id, project_id=flux, node_id=flux_ui, text="Finish empty-room state", done=False, due_date=_today(), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=flux, node_id=flux_auth, text="Test magic-link on mobile", done=False, due_date=_add(1), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=flux, node_id=flux_rooms, text="Spike realtime fan-out", done=False, due_date=_add(4), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=flux, text="Write beta invite email", done=False, due_date=_add(10), recurrence="none", color="rose"),
                # atlas
                Todo(user_id=user_id, project_id=atlas, node_id=a_scan, text="Fix offline scan queue", done=False, due_date=_today(), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=atlas, node_id=a_stock, text="Demo stock console to supervisors", done=False, due_date=_add(1), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=atlas, node_id=a_api, text="Finish idempotent adjust", done=False, due_date=_add(2), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=atlas, text="Send weekly warehouse update", done=False, due_date=_add(3), recurrence="weekly", color="rose"),
                Todo(user_id=user_id, project_id=atlas, node_id=a_uat, text="Book night-shift UAT week", done=False, due_date=_add(12), recurrence="none", color="rose"),
                # ledger
                Todo(user_id=user_id, project_id=ledger, node_id=l_schema, text="Run schema backfill dry-run", done=False, due_date=_today(), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=ledger, node_id=l_payments, text="Pair on refund path", done=False, due_date=_add(3), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=ledger, node_id=l_cutover, text="Draft cutover runbook", done=False, due_date=_add(8), recurrence="none", color="rose"),
                Todo(user_id=user_id, project_id=ledger, text="Update status page copy", done=False, due_date=_add(15), recurrence="none", color="rose"),
                # loose personal
                Todo(user_id=user_id, text="Buy milk", done=False, due_date=_today(), recurrence="daily", color="amber"),
                Todo(user_id=user_id, text="Call Mum", done=False, due_date=_add(2), recurrence="none", color="green"),
                Todo(user_id=user_id, text="Water the plants", done=False, due_date=_add(1), recurrence="weekly", color="amber"),
                Todo(user_id=user_id, text="Bin night", done=False, due_date=_add(3), recurrence="weekly", color="amber"),
                Todo(user_id=user_id, text="Renew library books", done=False, due_date=_add(-2), recurrence="none", color="blue"),
            ]
        )
        db.commit()
        print(f"Seeded 9 demo projects on {DEMO_EMAIL} (personal → habits → software)")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
