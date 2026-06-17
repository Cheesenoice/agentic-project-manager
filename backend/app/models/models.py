from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, DateTime, ForeignKey, Float
from datetime import datetime
from typing import List, Optional
from app.db import Base

class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="developer") # "admin", "pm", "developer", "qa"
    skills: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # JSON list: '["React", "FastAPI"]'
    
    tasks: Mapped[List["Task"]] = relationship("Task", back_populates="assigned_to", lazy="selectin")

class Project(Base):
    __tablename__ = "projects"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    tasks: Mapped[List["Task"]] = relationship("Task", back_populates="project", cascade="all, delete-orphan", lazy="selectin")

class Task(Base):
    __tablename__ = "tasks"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True)
    
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="todo") # "todo", "in_progress", "qa_review", "done", "blocked"
    task_type: Mapped[str] = mapped_column(String(50), default="task") # "epic", "feature", "task", "subtask"
    phase: Mapped[str] = mapped_column(String(50), default="development") # "planning", "design", "development", "testing", "deployment"
    
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    assigned_to_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    dependencies: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # JSON array string: "[1, 2]"
    
    estimated_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    project: Mapped["Project"] = relationship("Project", back_populates="tasks")
    assigned_to: Mapped[Optional["User"]] = relationship("User", back_populates="tasks", lazy="selectin")
    
    # Self-referential relationship for subtasks
    subtasks: Mapped[List["Task"]] = relationship(
        "Task", 
        back_populates="parent", 
        cascade="all, delete-orphan", 
        lazy="selectin",
        join_depth=2
    )
    parent: Mapped[Optional["Task"]] = relationship(
        "Task", 
        back_populates="subtasks", 
        remote_side=[id],
        lazy="selectin"
    )


class Notification(Base):
    __tablename__ = "notifications"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_read: Mapped[bool] = mapped_column(default=False)


class TaskHistory(Base):
    __tablename__ = "task_history"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


