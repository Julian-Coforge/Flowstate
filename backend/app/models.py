import uuid
from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, Float, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    nodes: Mapped[list["Node"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    edges: Mapped[list["Edge"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    todos: Mapped[list["Todo"]] = relationship(back_populates="project")


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    importance: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    notes: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="todo")
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recurrence: Mapped[str] = mapped_column(String, nullable=False, default="none")

    project: Mapped[Project] = relationship(back_populates="nodes")
    checklist: Mapped[list["ChecklistItem"]] = relationship(back_populates="node", cascade="all, delete-orphan")


class Edge(Base):
    __tablename__ = "edges"
    __table_args__ = (UniqueConstraint("project_id", "source_node_id", "target_node_id", name="edges_unique"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    source_node_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"))
    target_node_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"))
    source_handle: Mapped[str | None] = mapped_column(String, nullable=True)
    target_handle: Mapped[str | None] = mapped_column(String, nullable=True)

    project: Mapped[Project] = relationship(back_populates="edges")


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    node: Mapped[Node] = relationship(back_populates="checklist")


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    text: Mapped[str] = mapped_column(String, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recurrence: Mapped[str] = mapped_column(String, nullable=False, default="none")
    color: Mapped[str] = mapped_column(String, nullable=False, default="none")

    project: Mapped[Project | None] = relationship(back_populates="todos")
