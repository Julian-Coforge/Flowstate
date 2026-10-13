from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, File, Form, Query, UploadFile
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.db import get_db, get_engine
from app.documents import extract_document_text
from app.errors import HttpError, http_error_handler, http_exception_handler
from app.generate import check_rate_limit, generate_plan, refine_plan
from app.schemas import (
    ChecklistCreate,
    ChecklistPatch,
    EdgeCreate,
    GenerateBody,
    GenerateMode,
    NodeCreate,
    NodePatch,
    NodePositionsBody,
    ProjectCreate,
    ProjectPatch,
    RefineBody,
    TodoCreate,
    TodoPatch,
)
from app import store


def ensure_schema() -> None:
    """Apply lightweight additive migrations for existing databases."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("alter table nodes add column if not exists recurrence text not null default 'none'"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        ensure_schema()
    except Exception:
        # Tests / fresh create_all may not need this; ignore if table missing yet.
        pass
    yield


app = FastAPI(title="Flowstate API", lifespan=lifespan)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(HttpError, http_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)


@app.exception_handler(RequestValidationError)
@app.exception_handler(ValidationError)
async def validation_handler(_request, exc):
    message = "Check the form and try again"
    errors = getattr(exc, "errors", lambda: [])()
    if errors:
        err = errors[0]
        msg = err.get("msg") or message
        message = msg.replace("Value error, ", "")
    return JSONResponse({"error": message}, status_code=400)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("select 1"))
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return {"user": user.as_dict()}


@app.delete("/api/auth/account")
def delete_account(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = get_settings()
    if not cfg.public_supabase_url or not cfg.supabase_secret_key:
        raise HttpError("Account deletion is not configured on this server.", 503)
    store.delete_user_data(db, user.id)
    headers = {
        "apikey": cfg.supabase_secret_key,
        "Authorization": f"Bearer {cfg.supabase_secret_key}",
    }
    response = httpx.delete(
        f"{cfg.public_supabase_url}/auth/v1/admin/users/{user.id}",
        headers=headers,
        timeout=20.0,
    )
    if response.status_code not in (200, 204):
        raise HttpError("Could not delete the account. Try again shortly.", 502)
    return {"ok": True}


@app.get("/api/projects")
def projects(
    q: str = Query(default=""),
    status: str = Query(default="active"),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if status not in {"active", "archived", "all"}:
        raise HttpError("Status must be active, archived, or all", 400)
    return {"projects": store.list_projects(db, user.id, q, status)}


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_project(db, user.id, body.title, body.description)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.get_project_bundle(db, user.id, project_id)


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.update_project(db, user.id, project_id, body.model_dump(exclude_unset=True))


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_project(db, user.id, project_id)
    return {"ok": True}


@app.post("/api/projects/{project_id}/duplicate", status_code=201)
def duplicate_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.duplicate_project(db, user.id, project_id)


@app.post("/api/projects/{project_id}/layout")
def layout_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.layout_project(db, user.id, project_id)


@app.post("/api/projects/{project_id}/generate")
async def generate(
    project_id: str,
    idea: str = Form(default=""),
    mode: GenerateMode = Form(default="quick"),
    document: UploadFile | None = File(default=None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cfg = get_settings()
    if not cfg.openai_api_key:
        raise HttpError("Plan generation is turned off on this server.", 503)
    store.owned_project(db, user.id, project_id)
    check_rate_limit(user.id)

    cleaned_idea = (idea or "").strip()
    document_text = None
    if document is not None and document.filename:
        data = await document.read()
        document_text = extract_document_text(document.filename, data)
    if not cleaned_idea and not document_text:
        raise HttpError("Add an idea or upload a document", 400)
    if not cleaned_idea:
        cleaned_idea = (
            "Build a detailed work plan from this assignment brief. "
            "Break every major requirement into its own step, including setup, features, testing, and submission."
        )
    try:
        body = GenerateBody(idea=cleaned_idea, mode=mode)
    except ValidationError as exc:
        raise HttpError(str(exc.errors()[0]["msg"]).replace("Value error, ", ""), 400) from exc

    plan = generate_plan(cfg, body.idea, body.mode, document_text=document_text)
    return store.insert_generated_plan(db, user.id, project_id, plan["nodes"], plan["edges"], plan["todos"])


@app.post("/api/projects/{project_id}/refine")
def refine(
    project_id: str,
    body: RefineBody,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cfg = get_settings()
    if not cfg.openai_api_key:
        raise HttpError("Plan generation is turned off on this server.", 503)
    bundle = store.get_project_bundle(db, user.id, project_id)
    if not bundle["nodes"]:
        raise HttpError("Add or generate a plan before refining it", 400)
    check_rate_limit(user.id)
    id_to_key = {node["id"]: f"n{index + 1}" for index, node in enumerate(bundle["nodes"])}
    current = {
        "nodes": [
            {
                "key": id_to_key[node["id"]],
                "title": node["title"],
                "description": node.get("description") or "",
                "importance": node.get("importance") or "medium",
                "checklist": [item["text"] for item in (node.get("checklist") or []) if item.get("text")],
                "dueDate": node.get("dueDate"),
                "recurrence": node.get("recurrence") or "none",
            }
            for node in bundle["nodes"]
        ],
        "edges": [
            {"from": id_to_key[edge["sourceNodeId"]], "to": id_to_key[edge["targetNodeId"]]}
            for edge in bundle["edges"]
            if edge["sourceNodeId"] in id_to_key and edge["targetNodeId"] in id_to_key
        ],
        "todos": [
            {
                "text": todo["text"],
                "dueDate": todo.get("dueDate"),
                "recurrence": todo.get("recurrence") or "none",
                "nodeKey": id_to_key.get(todo.get("nodeId") or "") or None,
            }
            for todo in bundle["todos"]
        ],
    }

    plan = refine_plan(cfg, current, body.instruction, body.mode)
    return store.replace_generated_plan(db, user.id, project_id, plan["nodes"], plan["edges"], plan["todos"])


@app.post("/api/nodes", status_code=201)
def create_node(body: NodeCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_node(
        db,
        user.id,
        body.projectId,
        body.title,
        body.x,
        body.y,
        body.id,
        body.description,
        body.importance,
        body.notes,
        body.status,
        body.dueDate,
        body.recurrence,
    )


@app.post("/api/nodes/positions")
def node_positions(body: NodePositionsBody, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.positions:
        raise HttpError("Nothing to update", 400)
    first = store.owned_node(db, user.id, body.positions[0].id)
    project_id = str(first.project_id)
    return store.update_node_positions(
        db,
        user.id,
        project_id,
        [{"id": item.id, "x": item.x, "y": item.y} for item in body.positions],
    )


@app.patch("/api/nodes/{node_id}")
def patch_node(node_id: str, body: NodePatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.update_node(db, user.id, node_id, body.model_dump(exclude_unset=True))


@app.delete("/api/nodes/{node_id}")
def remove_node(node_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_node(db, user.id, node_id)
    return {"ok": True}


@app.post("/api/edges", status_code=201)
def create_edge(body: EdgeCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_edge(
        db,
        user.id,
        body.projectId,
        body.sourceNodeId,
        body.targetNodeId,
        body.sourceHandle,
        body.targetHandle,
        body.id,
    )


@app.delete("/api/edges/{edge_id}")
def remove_edge(edge_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_edge(db, user.id, edge_id)
    return {"ok": True}


@app.get("/api/todos")
def todos(projectId: str | None = None, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"todos": store.list_todos(db, user.id, projectId)}


@app.get("/api/calendar")
def calendar(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.list_calendar(db, user.id)


@app.post("/api/todos", status_code=201)
def create_todo(body: TodoCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_todo(db, user.id, body.text, body.projectId, body.nodeId, body.dueDate, body.recurrence, body.color)


@app.patch("/api/todos/{todo_id}")
def patch_todo(todo_id: str, body: TodoPatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    return store.update_todo(db, user.id, todo_id, data)


@app.delete("/api/todos/{todo_id}")
def remove_todo(todo_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_todo(db, user.id, todo_id)
    return {"ok": True}


@app.post("/api/checklist", status_code=201)
def create_check(body: ChecklistCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_checklist_item(db, user.id, body.nodeId, body.text)


@app.patch("/api/checklist/{item_id}")
def patch_check(item_id: str, body: ChecklistPatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.update_checklist_item(db, user.id, item_id, body.model_dump(exclude_none=True))


@app.delete("/api/checklist/{item_id}")
def remove_check(item_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_checklist_item(db, user.id, item_id)
    return {"ok": True}


@app.get("/api/ai/status")
def ai_status():
    return {"enabled": bool(get_settings().openai_api_key)}
