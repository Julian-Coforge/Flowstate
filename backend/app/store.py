from __future__ import annotations

import time
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.errors import HttpError
from app.models import ChecklistItem, Edge, Node, Project, Todo
from app.rules import can_link, next_occurrence, progress as progress_of, today_iso


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
        "checklist": [serialize_check(item) for item in checks],
    }


def serialize_edge(edge: Edge) -> dict:
    return {
        "id": str(edge.id),
        "projectId": str(edge.project_id),
        "sourceNodeId": str(edge.source_node_id),
        "targetNodeId": str(edge.target_node_id),
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


def list_projects(db: Session, user_id: str, query: str) -> list[dict]:
    stmt = select(Project).where(Project.user_id == _uid(user_id)).order_by(Project.created_at.desc())
    rows = list(db.scalars(stmt))
    trimmed = query.strip().replace("%", "").replace("_", "")
    if trimmed:
        lowered = trimmed.lower()
        rows = [row for row in rows if lowered in row.title.lower()]
    if not rows:
        return []
    ids = [row.id for row in rows]
    nodes = list(db.scalars(select(Node).where(Node.project_id.in_(ids))))
    todos = list(db.scalars(select(Todo).where(Todo.project_id.in_(ids))))
    result = []
    for project in rows:
        project_nodes = [node for node in nodes if node.project_id == project.id]
        open_tasks = len([todo for todo in todos if todo.project_id == project.id and not todo.done])
        result.append(
            {
                "id": str(project.id),
                "title": project.title,
                "description": project.description,
                "status": project.status,
                "createdAt": project.created_at,
                "progress": progress_of(project_nodes),
                "openTasks": open_tasks,
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


def create_node(db: Session, user_id: str, project_id: str, title: str, x: float, y: float) -> dict:
    owned_project(db, user_id, project_id)
    node = Node(
        id=uuid.uuid4(),
        project_id=_uid(project_id),
        title=title,
        description="",
        importance="medium",
        notes="",
        status="todo",
        x=x,
        y=y,
    )
    db.add(node)
    db.flush()
    db.refresh(node)
    node.checklist = []
    return serialize_node(node)


def update_node(db: Session, user_id: str, node_id: str, patch: dict) -> dict:
    node = owned_node(db, user_id, node_id)
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
    db.flush()
    db.refresh(node)
    return serialize_node(node) if node.checklist is not None else {**serialize_node(node), "checklist": []}


def delete_node(db: Session, user_id: str, node_id: str) -> None:
    node = owned_node(db, user_id, node_id)
    db.delete(node)


def create_edge(db: Session, user_id: str, project_id: str, source_id: str, target_id: str) -> dict:
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
    edge = Edge(
        id=uuid.uuid4(),
        project_id=_uid(project_id),
        source_node_id=_uid(source_id),
        target_node_id=_uid(target_id),
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
    for edge in edges:
        db.add(
            Edge(
                id=uuid.uuid4(),
                project_id=_uid(project_id),
                source_node_id=key_to_id[edge["from"]],
                target_node_id=key_to_id[edge["to"]],
            )
        )
    for todo in todos:
        node_id = key_to_id.get(todo.get("nodeKey") or "")
        db.add(
            Todo(
                id=uuid.uuid4(),
                user_id=_uid(user_id),
                project_id=_uid(project_id),
                node_id=node_id,
                text=todo["text"],
                done=False,
                due_date=None,
                recurrence="none",
            )
        )
    db.flush()
    return get_project_bundle(db, user_id, project_id)
