from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import List, Optional

# User Schemas
class UserBase(BaseModel):
    username: str
    role: str = "developer" # "admin", "pm", "developer", "qa"
    skills: Optional[str] = None # JSON string

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

# Task Schemas
class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    task_type: str = "task" # "epic", "feature", "task", "subtask"
    phase: str = "development" # "planning", "design", "development", "testing", "deployment"
    parent_id: Optional[int] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    assigned_to_id: Optional[int] = None
    dependencies: Optional[str] = None # JSON string e.g. "[1, 2]"
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    task_type: Optional[str] = None
    phase: Optional[str] = None
    parent_id: Optional[int] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    assigned_to_id: Optional[int] = None
    dependencies: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None

class TaskResponse(TaskBase):
    id: int
    project_id: int
    assigned_to: Optional[UserResponse] = None
    subtasks: List["TaskResponse"] = []

    model_config = ConfigDict(from_attributes=True)

# Project Schemas
class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class ProjectResponse(ProjectBase):
    id: int
    created_at: datetime
    tasks: List[TaskResponse] = []

    model_config = ConfigDict(from_attributes=True)

# Notification Schemas
class NotificationResponse(BaseModel):
    id: int
    task_id: Optional[int]
    message: str
    created_at: datetime
    is_read: bool

    model_config = ConfigDict(from_attributes=True)

class ChatRequest(BaseModel):
    message: str
    role: Optional[str] = "pm"


# Rebuild model to support recursive references
TaskResponse.model_rebuild()

