from fastapi import Depends, FastAPI, Query
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.db import get_db
from app.errors import HttpError, http_error_handler, http_exception_handler
from app.generate import check_rate_limit, generate_plan
from app.schemas import (
    ChecklistCreate,
    ChecklistPatch,
    EdgeCreate,
    GenerateBody,
    NodeCreate,
    NodePatch,
    ProjectCreate,
    TodoCreate,
    TodoPatch,
)
from app import store

app = FastAPI(title="Flowstate API")
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


@app.get("/api/projects")
def projects(q: str = Query(default=""), user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"projects": store.list_projects(db, user.id, q)}


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_project(db, user.id, body.title, body.description)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.get_project_bundle(db, user.id, project_id)


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_project(db, user.id, project_id)
    return {"ok": True}


@app.post("/api/projects/{project_id}/generate")
def generate(project_id: str, body: GenerateBody, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = get_settings()
    if not cfg.anthropic_api_key:
        raise HttpError("Plan generation is turned off on this server.", 503)
    store.owned_project(db, user.id, project_id)
    check_rate_limit(user.id)
    plan = generate_plan(cfg, body.idea, body.mode)
    return store.insert_generated_plan(db, user.id, project_id, plan["nodes"], plan["edges"], plan["todos"])


@app.post("/api/nodes", status_code=201)
def create_node(body: NodeCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_node(db, user.id, body.projectId, body.title, body.x, body.y)


@app.patch("/api/nodes/{node_id}")
def patch_node(node_id: str, body: NodePatch, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.update_node(db, user.id, node_id, body.model_dump(exclude_none=True))


@app.delete("/api/nodes/{node_id}")
def remove_node(node_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_node(db, user.id, node_id)
    return {"ok": True}


@app.post("/api/edges", status_code=201)
def create_edge(body: EdgeCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_edge(db, user.id, body.projectId, body.sourceNodeId, body.targetNodeId)


@app.delete("/api/edges/{edge_id}")
def remove_edge(edge_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    store.delete_edge(db, user.id, edge_id)
    return {"ok": True}


@app.get("/api/todos")
def todos(projectId: str | None = None, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"todos": store.list_todos(db, user.id, projectId)}


@app.post("/api/todos", status_code=201)
def create_todo(body: TodoCreate, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return store.create_todo(db, user.id, body.text, body.projectId, body.nodeId, body.dueDate, body.recurrence)


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
    return {"enabled": bool(get_settings().anthropic_api_key)}
