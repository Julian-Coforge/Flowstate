from __future__ import annotations

import time
import uuid
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.errors import HttpError
from app.models import ChecklistItem, Edge, Node, Project, Todo
from app.rules import auto_layout, can_link, infer_handles, next_occurrence, progress as progress_of, today_iso


def _uid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HttpError("That item was not found", 404) from exc


def _date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def serialize_check(item: ChecklistItem) -> dict:
    return {
        "id": str(item.id),
        "nodeId": str(item.node_id),
        "text": item.text,
        "done": item.done,
        "position": item.position,
    }


def serialize_node(node: Node) -> dict:
    checks = sorted(node.checklist, key=lambda item: item.position)
    return {
        "id": str(node.id),
        "projectId": str(node.project_id),
        "title": node.title,
        "description": node.description,
        "importance": node.importance,
        "notes": node.notes,
        "status": node.status,
        "x": node.x,
        "y": node.y,
        "dueDate": node.due_date.isoformat() if node.due_date else None,
        "recurrence": node.recurrence or "none",
        "checklist": [serialize_check(item) for item in checks],
    }


def serialize_edge(edge: Edge) -> dict:
    return {
        "id": str(edge.id),
        "projectId": str(edge.project_id),
        "sourceNodeId": str(edge.source_node_id),
        "targetNodeId": str(edge.target_node_id),
        "sourceHandle": edge.source_handle,
        "targetHandle": edge.target_handle,
    }


def serialize_todo(todo: Todo, project_title: str | None) -> dict:
    return {
        "id": str(todo.id),
        "projectId": str(todo.project_id) if todo.project_id else None,
        "nodeId": str(todo.node_id) if todo.node_id else None,
        "text": todo.text,
        "done": todo.done,
        "dueDate": todo.due_date.isoformat() if todo.due_date else None,
        "recurrence": todo.recurrence or "none",
        "color": todo.color or "none",
        "projectTitle": project_title,
    }


def owned_project(db: Session, user_id: str, project_id: str) -> Project:
    project = db.get(Project, _uid(project_id))
    if not project or str(project.user_id) != user_id:
        raise HttpError("That project was not found", 404)
    return project


def owned_node(db: Session, user_id: str, node_id: str) -> Node:
    node = db.get(Node, _uid(node_id))
    if not node:
        raise HttpError("That step was not found", 404)
    owned_project(db, user_id, str(node.project_id))
    return node


def list_projects(db: Session, user_id: str, query: str, status: str | None = "active") -> list[dict]:
    stmt = select(Project).where(Project.user_id == _uid(user_id)).order_by(Project.created_at.desc())
    rows = list(db.scalars(stmt))
    if status and status != "all":
        rows = [row for row in rows if (row.status or "active") == status]
    trimmed = query.strip().replace("%", "").replace("_", "")
    if trimmed:
        lowered = trimmed.lower()
        rows = [row for row in rows if lowered in row.title.lower()]
    if not rows:
        return []
    ids = [row.id for row in rows]
    nodes = list(
        db.scalars(select(Node).where(Node.project_id.in_(ids)).options(selectinload(Node.checklist)))
    )
    todos = list(db.scalars(select(Todo).where(Todo.project_id.in_(ids))))
    result = []
    today = date.today()
    for project in rows:
        project_nodes = [node for node in nodes if node.project_id == project.id]
        open_tasks = len([todo for todo in todos if todo.project_id == project.id and not todo.done])
        overdue_count = sum(
            1
            for node in project_nodes
            if node.due_date and node.due_date < today and node.status != "done"
        )
        result.append(
            {
                "id": str(project.id),
                "title": project.title,
                "description": project.description,
                "status": project.status,
                "createdAt": project.created_at,
                "progress": progress_of(project_nodes),
                "openTasks": open_tasks,
                "overdueCount": overdue_count,
            }
        )
    return result


def create_project(db: Session, user_id: str, title: str, description: str) -> dict:
    project = Project(
        id=uuid.uuid4(),
        user_id=_uid(user_id),
        title=title,
        description=description,
        status="active",
        created_at=int(time.time() * 1000),
    )
    db.add(project)
    db.flush()
    return {
        "id": str(project.id),
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "createdAt": project.created_at,
        "progress": progress_of([]),
        "openTasks": 0,
        "overdueCount": 0,
    }


def get_project_bundle(db: Session, user_id: str, project_id: str) -> dict:
    project = owned_project(db, user_id, project_id)
    nodes = list(
        db.scalars(
            select(Node).where(Node.project_id == project.id).options(selectinload(Node.checklist))
        )
    )
    edges = list(db.scalars(select(Edge).where(Edge.project_id == project.id)))
    todos = list(
        db.scalars(select(Todo).where(Todo.user_id == _uid(user_id), Todo.project_id == project.id))
    )
    flow_nodes = [serialize_node(node) for node in nodes]
    return {
        "project": {
            "id": str(project.id),
            "title": project.title,
            "description": project.description,
            "status": project.status,
            "createdAt": project.created_at,
        },
        "nodes": flow_nodes,
        "edges": [serialize_edge(edge) for edge in edges],
        "todos": [serialize_todo(todo, project.title) for todo in todos],
        "progress": progress_of(flow_nodes),
    }


def delete_project(db: Session, user_id: str, project_id: str) -> None:
    project = owned_project(db, user_id, project_id)
    db.delete(project)


def delete_user_data(db: Session, user_id: str) -> None:
    uid = _uid(user_id)
    projects = list(db.scalars(select(Project).where(Project.user_id == uid)))
    for project in projects:
        db.delete(project)
    db.execute(delete(Todo).where(Todo.user_id == uid))
    db.flush()


def update_project(db: Session, user_id: str, project_id: str, patch: dict) -> dict:
    project = owned_project(db, user_id, project_id)
    if "title" in patch and patch["title"] is not None:
        project.title = patch["title"]
    if "description" in patch and patch["description"] is not None:
        project.description = patch["description"]
    if "status" in patch and patch["status"] is not None:
        project.status = patch["status"]
    db.flush()
    summaries = list_projects(db, user_id, "", status="all")
    for item in summaries:
        if item["id"] == str(project.id):
            return item
    return {
        "id": str(project.id),
        "title": project.title,
        "description": project.description,
        "status": project.status,
        "createdAt": project.created_at,
        "progress": progress_of([]),
        "openTasks": 0,
        "overdueCount": 0,
    }


def create_node(
    db: Session,
    user_id: str,
    project_id: str,
    title: str,
    x: float,
    y: float,
    node_id: str | None = None,
    description: str = "",
    importance: str = "medium",
    notes: str = "",
    status: str = "todo",
    due_date: str | None = None,
    recurrence: str = "none",
) -> dict:
    owned_project(db, user_id, project_id)
    nid = _uid(node_id) if node_id else uuid.uuid4()
    if node_id and db.get(Node, nid):
        raise HttpError("That step already exists", 409)
    cadence = recurrence if recurrence in {"none", "daily", "weekly", "monthly"} else "none"
    node = Node(
        id=nid,
        project_id=_uid(project_id),
        title=title,
        description=description or "",
        importance=importance or "medium",
        notes=notes or "",
        status=status or "todo",
        x=x,
        y=y,
        due_date=_date(due_date),
        recurrence=cadence,
    )
    db.add(node)
    db.flush()
    db.refresh(node)
    node.checklist = []
    return serialize_node(node)


def update_node(db: Session, user_id: str, node_id: str, patch: dict) -> dict:
    node = owned_node(db, user_id, node_id)
    becoming_done = patch.get("status") == "done" and node.status != "done"
    mapping = {
        "title": "title",
        "description": "description",
        "importance": "importance",
        "notes": "notes",
        "status": "status",
        "x": "x",
        "y": "y",
    }
    for key, column in mapping.items():
        if key in patch and patch[key] is not None:
            setattr(node, column, patch[key])
    if "dueDate" in patch:
        node.due_date = _date(patch["dueDate"])
    if "recurrence" in patch and patch["recurrence"] is not None:
        cadence = patch["recurrence"]
        node.recurrence = cadence if cadence in {"none", "daily", "weekly", "monthly"} else "none"
    if becoming_done:
        cadence = node.recurrence or "none"
        nxt = next_occurrence(
            node.due_date.isoformat() if node.due_date else None,
            cadence,
            today_iso(),
        )
        if nxt:
            # Habit steps roll forward in place so the canvas stays tidy.
            node.status = "todo"
            node.due_date = _date(nxt)
    db.flush()
    db.refresh(node)
    return serialize_node(node) if node.checklist is not None else {**serialize_node(node), "checklist": []}


def delete_node(db: Session, user_id: str, node_id: str) -> None:
    node = owned_node(db, user_id, node_id)
    db.delete(node)


def create_edge(
    db: Session,
    user_id: str,
    project_id: str,
    source_id: str,
    target_id: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
    edge_id: str | None = None,
) -> dict:
    owned_project(db, user_id, project_id)
    nodes = list(db.scalars(select(Node).where(Node.project_id == _uid(project_id))))
    existing = list(db.scalars(select(Edge).where(Edge.project_id == _uid(project_id))))
    check = can_link(
        source_id,
        target_id,
        [(str(edge.source_node_id), str(edge.target_node_id)) for edge in existing],
        {str(node.id) for node in nodes},
    )
    if not check.get("ok"):
        raise HttpError(check["error"], 400)
    eid = _uid(edge_id) if edge_id else uuid.uuid4()
    by_id = {str(node.id): node for node in nodes}
    source_node = by_id.get(source_id)
    target_node = by_id.get(target_id)
    if not source_handle or not target_handle:
        if source_node and target_node:
            inferred = infer_handles(source_node.x, source_node.y, target_node.x, target_node.y)
            source_handle = source_handle or inferred[0]
            target_handle = target_handle or inferred[1]
    edge = Edge(
        id=eid,
        project_id=_uid(project_id),
        source_node_id=_uid(source_id),
        target_node_id=_uid(target_id),
        source_handle=source_handle,
        target_handle=target_handle,
    )
    db.add(edge)
    db.flush()
    return serialize_edge(edge)


def delete_edge(db: Session, user_id: str, edge_id: str) -> None:
    edge = db.get(Edge, _uid(edge_id))
    if not edge:
        raise HttpError("That link was not found", 404)
    owned_project(db, user_id, str(edge.project_id))
    db.delete(edge)


def list_todos(db: Session, user_id: str, project_id: str | None = None) -> list[dict]:
    stmt = select(Todo).where(Todo.user_id == _uid(user_id))
    if project_id:
        stmt = stmt.where(Todo.project_id == _uid(project_id))
    todos = list(db.scalars(stmt))
    titles = {
        project.id: project.title
        for project in db.scalars(select(Project).where(Project.user_id == _uid(user_id)))
    }
    return [
        serialize_todo(todo, titles.get(todo.project_id) if todo.project_id else None)
        for todo in todos
    ]


def create_todo(
    db: Session,
    user_id: str,
    text: str,
    project_id: str | None,
    node_id: str | None,
    due_date: str | None,
    recurrence: str = "none",
    color: str = "none",
) -> dict:
    if project_id:
        owned_project(db, user_id, project_id)
    if node_id:
        owned_node(db, user_id, node_id)
    todo = Todo(
        id=uuid.uuid4(),
        user_id=_uid(user_id),
        project_id=_uid(project_id) if project_id else None,
        node_id=_uid(node_id) if node_id else None,
        text=text,
        done=False,
        due_date=_date(due_date),
        recurrence=recurrence or "none",
        color=color or "none",
    )
    db.add(todo)
    db.flush()
    title = None
    if todo.project_id:
        project = db.get(Project, todo.project_id)
        title = project.title if project else None
    return serialize_todo(todo, title)


def update_todo(db: Session, user_id: str, todo_id: str, patch: dict) -> dict:
    todo = db.get(Todo, _uid(todo_id))
    if not todo or str(todo.user_id) != user_id:
        raise HttpError("That task was not found", 404)
    becoming_done = patch.get("done") is True and not todo.done
    if patch.get("projectId"):
        owned_project(db, user_id, patch["projectId"])
        todo.project_id = _uid(patch["projectId"])
    if "projectId" in patch and patch["projectId"] is None:
        todo.project_id = None
    if "nodeId" in patch:
        if patch["nodeId"]:
            owned_node(db, user_id, patch["nodeId"])
            todo.node_id = _uid(patch["nodeId"])
        else:
            todo.node_id = None
    if "text" in patch and patch["text"] is not None:
        todo.text = patch["text"]
    if "dueDate" in patch:
        todo.due_date = _date(patch["dueDate"])
    if "recurrence" in patch and patch["recurrence"] is not None:
        todo.recurrence = patch["recurrence"]
    if "color" in patch and patch["color"] is not None:
        todo.color = patch["color"]
    if "done" in patch and patch["done"] is not None:
        todo.done = patch["done"]
    spawned = None
    if becoming_done:
        nxt = next_occurrence(
            todo.due_date.isoformat() if todo.due_date else None,
            todo.recurrence,
            today_iso(),
        )
        if nxt:
            spawned = Todo(
                id=uuid.uuid4(),
                user_id=todo.user_id,
                project_id=todo.project_id,
                node_id=todo.node_id,
                text=todo.text,
                done=False,
                due_date=_date(nxt),
                recurrence=todo.recurrence,
                color=todo.color or "none",
            )
            db.add(spawned)
    db.flush()
    title = None
    if todo.project_id:
        project = db.get(Project, todo.project_id)
        title = project.title if project else None
    return serialize_todo(todo, title)


def delete_todo(db: Session, user_id: str, todo_id: str) -> None:
    todo = db.get(Todo, _uid(todo_id))
    if not todo or str(todo.user_id) != user_id:
        raise HttpError("That task was not found", 404)
    db.delete(todo)


def create_checklist_item(db: Session, user_id: str, node_id: str, text: str) -> dict:
    owned_node(db, user_id, node_id)
    siblings = list(db.scalars(select(ChecklistItem).where(ChecklistItem.node_id == _uid(node_id))))
    item = ChecklistItem(
        id=uuid.uuid4(),
        node_id=_uid(node_id),
        text=text,
        done=False,
        position=len(siblings),
    )
    db.add(item)
    db.flush()
    return serialize_check(item)


def update_checklist_item(db: Session, user_id: str, item_id: str, patch: dict) -> dict:
    item = db.get(ChecklistItem, _uid(item_id))
    if not item:
        raise HttpError("That checklist item was not found", 404)
    owned_node(db, user_id, str(item.node_id))
    if "text" in patch and patch["text"] is not None:
        item.text = patch["text"]
    if "done" in patch and patch["done"] is not None:
        item.done = patch["done"]
    db.flush()
    return serialize_check(item)


def delete_checklist_item(db: Session, user_id: str, item_id: str) -> None:
    item = db.get(ChecklistItem, _uid(item_id))
    if not item:
        raise HttpError("That checklist item was not found", 404)
    owned_node(db, user_id, str(item.node_id))
    db.delete(item)


def clear_project_plan(db: Session, user_id: str, project_id: str) -> None:
    """Remove the existing map and project-scoped tasks so a refine can replace them."""
    project = owned_project(db, user_id, project_id)
    node_ids = list(db.scalars(select(Node.id).where(Node.project_id == project.id)))
    if node_ids:
        db.execute(delete(Edge).where(Edge.project_id == project.id))
        db.execute(delete(ChecklistItem).where(ChecklistItem.node_id.in_(node_ids)))
        db.execute(delete(Node).where(Node.project_id == project.id))
    db.execute(delete(Todo).where(Todo.project_id == project.id, Todo.user_id == _uid(user_id)))
    db.flush()


def replace_generated_plan(
    db: Session,
    user_id: str,
    project_id: str,
    nodes: list[dict],
    edges: list[dict],
    todos: list[dict],
) -> dict:
    clear_project_plan(db, user_id, project_id)
    return insert_generated_plan(db, user_id, project_id, nodes, edges, todos)


def insert_generated_plan(db: Session, user_id: str, project_id: str, nodes: list[dict], edges: list[dict], todos: list[dict]) -> dict:
    owned_project(db, user_id, project_id)
    key_to_id: dict[str, uuid.UUID] = {}
    created_nodes: list[Node] = []
    for node in nodes:
        row = Node(
            id=uuid.uuid4(),
            project_id=_uid(project_id),
            title=node["title"],
            description=node.get("description") or "",
            importance=node.get("importance") or "medium",
            notes="",
            status="todo",
            x=node["x"],
            y=node["y"],
            due_date=_date(node.get("dueDate")),
            recurrence=(
                node.get("recurrence")
                if node.get("recurrence") in {"none", "daily", "weekly", "monthly"}
                else "none"
            ),
        )
        db.add(row)
        db.flush()
        key_to_id[node["key"]] = row.id
        created_nodes.append(row)
        for index, text in enumerate(node.get("checklist") or []):
            cleaned = str(text).strip()
            if not cleaned:
                continue
            db.add(ChecklistItem(id=uuid.uuid4(), node_id=row.id, text=cleaned[:300], done=False, position=index))
    by_key = {node["key"]: node for node in nodes}
    for edge in edges:
        source = by_key.get(edge["from"])
        target = by_key.get(edge["to"])
        source_handle = target_handle = None
        if source and target:
            source_handle, target_handle = infer_handles(source["x"], source["y"], target["x"], target["y"])
        db.add(
            Edge(
                id=uuid.uuid4(),
                project_id=_uid(project_id),
                source_node_id=key_to_id[edge["from"]],
                target_node_id=key_to_id[edge["to"]],
                source_handle=source_handle,
                target_handle=target_handle,
            )
        )
    for todo in todos:
        node_id = key_to_id.get(todo.get("nodeKey") or "")
        recurrence = todo.get("recurrence") or "none"
        if recurrence not in {"none", "daily", "weekly", "monthly"}:
            recurrence = "none"
        db.add(
            Todo(
                id=uuid.uuid4(),
                user_id=_uid(user_id),
                project_id=_uid(project_id),
                node_id=node_id,
                text=todo["text"],
                done=False,
                due_date=_date(todo.get("dueDate")),
                recurrence=recurrence,
                color="none",
            )
        )
    db.flush()
    return get_project_bundle(db, user_id, project_id)


def list_calendar(db: Session, user_id: str) -> dict:
    todos = list_todos(db, user_id)
    uid = _uid(user_id)
    projects = {project.id: project for project in db.scalars(select(Project).where(Project.user_id == uid))}
    nodes = list(
        db.scalars(select(Node).where(Node.project_id.in_(list(projects.keys())), Node.due_date.isnot(None)))
    ) if projects else []
    steps = [
        {
            "id": str(node.id),
            "projectId": str(node.project_id),
            "projectTitle": projects[node.project_id].title if node.project_id in projects else None,
            "title": node.title,
            "status": node.status,
            "dueDate": node.due_date.isoformat() if node.due_date else None,
            "importance": node.importance,
            "recurrence": node.recurrence or "none",
        }
        for node in nodes
    ]
    return {"todos": todos, "steps": steps}


def update_node_positions(db: Session, user_id: str, project_id: str, positions: list[dict]) -> dict:
    owned_project(db, user_id, project_id)
    wanted = {_uid(item["id"]): item for item in positions}
    nodes = list(db.scalars(select(Node).where(Node.project_id == _uid(project_id), Node.id.in_(list(wanted.keys())))))
    for node in nodes:
        item = wanted[node.id]
        node.x = item["x"]
        node.y = item["y"]
    db.flush()
    return get_project_bundle(db, user_id, project_id)


def layout_project(db: Session, user_id: str, project_id: str) -> dict:
    owned_project(db, user_id, project_id)
    nodes = list(db.scalars(select(Node).where(Node.project_id == _uid(project_id))))
    edges = list(db.scalars(select(Edge).where(Edge.project_id == _uid(project_id))))
    laid = auto_layout(
        [{"key": str(node.id), "title": node.title} for node in nodes],
        [{"from": str(edge.source_node_id), "to": str(edge.target_node_id)} for edge in edges],
    )
    by_key = {item["key"]: item for item in laid}
    for node in nodes:
        pos = by_key.get(str(node.id))
        if pos:
            node.x = pos["x"]
            node.y = pos["y"]
    node_by_id = {str(node.id): node for node in nodes}
    for edge in edges:
        source = node_by_id.get(str(edge.source_node_id))
        target = node_by_id.get(str(edge.target_node_id))
        if source and target:
            edge.source_handle, edge.target_handle = infer_handles(source.x, source.y, target.x, target.y)
    db.flush()
    return get_project_bundle(db, user_id, project_id)


def duplicate_project(db: Session, user_id: str, project_id: str) -> dict:
    bundle_project = owned_project(db, user_id, project_id)
    nodes = list(
        db.scalars(select(Node).where(Node.project_id == bundle_project.id).options(selectinload(Node.checklist)))
    )
    edges = list(db.scalars(select(Edge).where(Edge.project_id == bundle_project.id)))
    todos = list(db.scalars(select(Todo).where(Todo.project_id == bundle_project.id)))
    new_id = uuid.uuid4()
    copy = Project(
        id=new_id,
        user_id=_uid(user_id),
        title=f"{bundle_project.title} (copy)",
        description=bundle_project.description,
        status="active",
        created_at=int(time.time() * 1000),
    )
    db.add(copy)
    db.flush()
    id_map: dict[uuid.UUID, uuid.UUID] = {}
    for node in nodes:
        cloned_id = uuid.uuid4()
        id_map[node.id] = cloned_id
        db.add(
            Node(
                id=cloned_id,
                project_id=new_id,
                title=node.title,
                description=node.description,
                importance=node.importance,
                notes=node.notes,
                status=node.status,
                x=node.x,
                y=node.y,
                due_date=node.due_date,
                recurrence=node.recurrence or "none",
            )
        )
        db.flush()
        for item in node.checklist:
            db.add(
                ChecklistItem(
                    id=uuid.uuid4(),
                    node_id=cloned_id,
                    text=item.text,
                    done=item.done,
                    position=item.position,
                )
            )
    for edge in edges:
        db.add(
            Edge(
                id=uuid.uuid4(),
                project_id=new_id,
                source_node_id=id_map[edge.source_node_id],
                target_node_id=id_map[edge.target_node_id],
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
            )
        )
    for todo in todos:
        db.add(
            Todo(
                id=uuid.uuid4(),
                user_id=_uid(user_id),
                project_id=new_id,
                node_id=id_map.get(todo.node_id) if todo.node_id else None,
                text=todo.text,
                done=todo.done,
                due_date=todo.due_date,
                recurrence=todo.recurrence,
                color=todo.color or "none",
            )
        )
    db.flush()
    summaries = list_projects(db, user_id, "")
    for item in summaries:
        if item["id"] == str(new_id):
            return item
    return {
        "id": str(new_id),
        "title": copy.title,
        "description": copy.description,
        "status": copy.status,
        "createdAt": copy.created_at,
        "progress": progress_of(nodes),
        "openTasks": 0,
        "overdueCount": 0,
    }
