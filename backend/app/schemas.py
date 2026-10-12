from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Importance = Literal["low", "medium", "high"]
NodeStatus = Literal["todo", "doing", "done"]
Recurrence = Literal["none", "daily", "weekly", "monthly"]
TaskColor = Literal["none", "blue", "green", "amber", "rose", "violet", "teal"]
GenerateMode = Literal["quick", "thinking"]


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)

    @field_validator("title", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


def parse_optional_date(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        raise ValueError("Use a real date")
    return value


class NodeCreate(BaseModel):
    projectId: str
    title: str = Field(default="New step", max_length=120)
    x: float
    y: float
    id: str | None = None
    description: str = Field(default="", max_length=2000)
    importance: Importance = "medium"
    notes: str = Field(default="", max_length=20000)
    status: NodeStatus = "todo"
    dueDate: str | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = value.strip()
        return cleaned or "New step"

    @field_validator("dueDate")
    @classmethod
    def date_format(cls, value: str | None) -> str | None:
        return parse_optional_date(value)


class NodePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    importance: Importance | None = None
    notes: str | None = Field(default=None, max_length=20000)
    status: NodeStatus | None = None
    x: float | None = None
    y: float | None = None
    dueDate: str | None = None

    @field_validator("dueDate")
    @classmethod
    def date_format(cls, value: str | None) -> str | None:
        return parse_optional_date(value)

    @model_validator(mode="after")
    def not_empty(self):
        if not self.model_fields_set:
            raise ValueError("Nothing to update")
        return self


HandleName = Literal["top", "right", "bottom", "left"]


class EdgeCreate(BaseModel):
    projectId: str
    sourceNodeId: str
    targetNodeId: str
    id: str | None = None
    sourceHandle: HandleName | None = None
    targetHandle: HandleName | None = None


class PositionItem(BaseModel):
    id: str
    x: float
    y: float


class NodePositionsBody(BaseModel):
    positions: list[PositionItem]


class TodoCreate(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    projectId: str | None = None
    nodeId: str | None = None
    dueDate: str | None = None
    recurrence: Recurrence = "none"
    color: TaskColor = "none"

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("dueDate")
    @classmethod
    def date_format(cls, value: str | None) -> str | None:
        return parse_optional_date(value)


class TodoPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None
    dueDate: str | None = None
    projectId: str | None = None
    recurrence: Recurrence | None = None
    nodeId: str | None = None
    color: TaskColor | None = None

    @model_validator(mode="after")
    def not_empty(self):
        if all(value is None for value in self.model_dump().values()):
            raise ValueError("Nothing to update")
        return self


class ChecklistCreate(BaseModel):
    nodeId: str
    text: str = Field(min_length=1, max_length=300)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class ChecklistPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None

    @model_validator(mode="after")
    def not_empty(self):
        if all(value is None for value in self.model_dump().values()):
            raise ValueError("Nothing to update")
        return self


class GenerateBody(BaseModel):
    idea: str = Field(min_length=1, max_length=500)
    mode: GenerateMode = "quick"

    @field_validator("idea")
    @classmethod
    def strip_idea(cls, value: str) -> str:
        return value.strip()


class PlanNode(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    importance: Importance = "medium"
    checklist: list[str] = Field(default_factory=list, max_length=12)


class PlanEdge(BaseModel):
    from_key: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)

    model_config = {"populate_by_name": True}


class PlanTodo(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    nodeKey: str | None = None


class Plan(BaseModel):
    nodes: list[PlanNode]
    edges: list[PlanEdge] = Field(default_factory=list)
    todos: list[PlanTodo] = Field(default_factory=list, max_length=20)


def validate_plan(plan: Plan, mode: GenerateMode) -> Plan:
    low, high = (5, 8) if mode == "quick" else (10, 20)
    count = len(plan.nodes)
    if count < low or count > high:
        raise ValueError(f"A {mode} plan needs {low}–{high} steps")
    keys = [node.key for node in plan.nodes]
    if len(set(keys)) != len(keys):
        raise ValueError("Each step needs its own key")
    key_set = set(keys)
    seen_edges: set[tuple[str, str]] = set()
    for edge in plan.edges:
        result = can_link_keys(edge.from_key, edge.to, seen_edges, key_set)
        if not result["ok"]:
            raise ValueError(result["error"])
        seen_edges.add((edge.from_key, edge.to))
    for todo in plan.todos:
        if todo.nodeKey and todo.nodeKey not in key_set:
            raise ValueError("A task points at a missing step")
    return plan


def can_link_keys(source: str, target: str, existing: set[tuple[str, str]], keys: set[str]):
    from app.rules import can_link

    return can_link(source, target, existing, keys)
