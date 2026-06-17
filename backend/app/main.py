from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import Base, engine, get_db
import httpx
from app.config import settings
from app.models.models import Project, Task, Notification, User, TaskHistory
from app.routers import projects, tasks, notifications, users, reports
from sqlalchemy.future import select
from app.db import Base, engine, get_db, async_session
from datetime import datetime, timedelta

app = FastAPI(title="AI Task Manager API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(notifications.router)
app.include_router(users.router)
app.include_router(reports.router)


from app.services.scheduler import start_scheduler

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # Seed default data
    async with async_session() as session:
        async with session.begin():
            # 1. Seed users
            result = await session.execute(select(User))
            existing_users = result.scalars().all()
            if not existing_users:
                u1 = User(username="pm_alice", role="pm")
                u2 = User(username="dev_bob", role="developer", skills='["React", "TypeScript", "Frontend"]')
                u3 = User(username="dev_john", role="developer", skills='["FastAPI", "Python", "Database"]')
                u4 = User(username="qa_charlie", role="qa")
                session.add_all([u1, u2, u3, u4])
                await session.flush()
                active_users = [u1, u2, u3, u4]
            else:
                active_users = existing_users
                
            # 2. Seed project
            proj_result = await session.execute(select(Project))
            existing_projects = proj_result.scalars().all()
            if not existing_projects:
                proj = Project(
                    name="E-Commerce Website",
                    description="Build an online store with AI product recommendations"
                )
                session.add(proj)
                await session.flush()
                
                now = datetime.utcnow()
                u_pm = next((u for u in active_users if u.role == 'pm'), active_users[0])
                u_bob = next((u for u in active_users if u.username == 'dev_bob'), active_users[1])
                u_john = next((u for u in active_users if u.username == 'dev_john'), active_users[2])
                u_qa = next((u for u in active_users if u.role == 'qa'), active_users[3])
                
                # Epic
                epic1 = Task(
                    project_id=proj.id,
                    title="Epic: Infrastructure Setup",
                    description="Setup core infrastructure for the project",
                    status="todo",
                    task_type="epic",
                    phase="planning",
                    start_date=now,
                    due_date=now + timedelta(days=10),
                    estimated_hours=40.0
                )
                session.add(epic1)
                await session.flush()
                
                # Feature
                feat1 = Task(
                    project_id=proj.id,
                    parent_id=epic1.id,
                    title="Feature: Database & Authentication",
                    description="Design database schema and auth API endpoints",
                    status="in_progress",
                    task_type="feature",
                    phase="design",
                    start_date=now,
                    due_date=now + timedelta(days=4),
                    estimated_hours=20.0
                )
                session.add(feat1)
                await session.flush()
                
                # Task
                t1 = Task(
                    project_id=proj.id,
                    parent_id=feat1.id,
                    title="DB Design & SQLAlchemy Models",
                    description="Define core models and relationships",
                    status="in_progress",
                    task_type="task",
                    phase="development",
                    start_date=now,
                    due_date=now + timedelta(days=2),
                    assigned_to_id=u_john.id,
                    estimated_hours=8.0
                )
                session.add(t1)
                await session.flush()
                
                # Subtask
                sub1 = Task(
                    project_id=proj.id,
                    parent_id=t1.id,
                    title="Setup Foreign Key Constraints",
                    description="Define foreign key constraints for User - Project - Task relation",
                    status="todo",
                    task_type="subtask",
                    phase="development",
                    start_date=now,
                    due_date=now + timedelta(days=1),
                    assigned_to_id=u_john.id,
                    estimated_hours=4.0
                )
                session.add(sub1)
                
                # Task 2 (Frontend)
                t2 = Task(
                    project_id=proj.id,
                    parent_id=feat1.id,
                    title="Frontend Login Interface",
                    description="Implement login screen using React and state management",
                    status="todo",
                    task_type="task",
                    phase="development",
                    start_date=now + timedelta(days=2),
                    due_date=now + timedelta(days=4),
                    assigned_to_id=u_bob.id,
                    dependencies=f"[{t1.id}]",
                    estimated_hours=12.0
                )
                session.add(t2)

                
    start_scheduler()



@app.get("/health")
def health():
    return {"status": "ok"}


