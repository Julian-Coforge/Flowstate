import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import CurrentUser, get_current_user
from app.db import get_db
from app.main import app
from app.models import Base

USER_A = CurrentUser(id=str(uuid.uuid4()), email="a@example.com", name="Ada")
USER_B = CurrentUser(id=str(uuid.uuid4()), email="b@example.com", name="Bea")
current = USER_A

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.create_all(engine)


def override_db():
    db = TestingSession()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def override_user():
    return current


app.dependency_overrides[get_db] = override_db
app.dependency_overrides[get_current_user] = override_user
client = TestClient(app)


def test_unauthorized_without_override():
    app.dependency_overrides.pop(get_current_user, None)
    response = client.get("/api/projects")
    assert response.status_code == 401
    assert "error" in response.json()
    app.dependency_overrides[get_current_user] = override_user


def test_create_and_list_project():
    global current
    current = USER_A
    created = client.post("/api/projects", json={"title": "Garden", "description": "Beds"}).json()
    assert created["title"] == "Garden"
    listed = client.get("/api/projects").json()["projects"]
    assert any(item["id"] == created["id"] for item in listed)


def test_user_b_cannot_read_user_a_project():
    global current
    current = USER_A
    created = client.post("/api/projects", json={"title": "Secret", "description": ""}).json()
    current = USER_B
    response = client.get(f"/api/projects/{created['id']}")
    assert response.status_code == 404


def test_user_b_cannot_patch_user_a_node():
    global current
    current = USER_A
    project = client.post("/api/projects", json={"title": "Work", "description": ""}).json()
    node = client.post("/api/nodes", json={"projectId": project["id"], "title": "Draft", "x": 10, "y": 10}).json()
    current = USER_B
    response = client.patch(f"/api/nodes/{node['id']}", json={"title": "Stolen"})
    assert response.status_code == 404


def test_bad_body_is_400():
    global current
    current = USER_A
    response = client.post("/api/projects", json={"title": ""})
    assert response.status_code == 400


def test_link_rejects_self():
    global current
    current = USER_A
    project = client.post("/api/projects", json={"title": "Map", "description": ""}).json()
    node = client.post("/api/nodes", json={"projectId": project["id"], "title": "A", "x": 0, "y": 0}).json()
    response = client.post("/api/edges", json={"projectId": project["id"], "sourceNodeId": node["id"], "targetNodeId": node["id"]})
    assert response.status_code == 400


def test_complete_recurring_spawns_next():
    global current
    current = USER_A
    todo = client.post("/api/todos", json={"text": "Water plants", "dueDate": "2026-10-12", "recurrence": "daily"}).json()
    updated = client.patch(f"/api/todos/{todo['id']}", json={"done": True}).json()
    assert updated["done"] is True
    todos = client.get("/api/todos").json()["todos"]
    texts = [item["text"] for item in todos if item["text"] == "Water plants"]
    assert len(texts) >= 2
