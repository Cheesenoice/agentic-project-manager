from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import Base, engine, get_db
import httpx
from app.config import settings
from app.models.models import Project, Task, Notification, User, TaskHistory, AgentConfig
from app.routers import projects, tasks, notifications, users, reports, health, comments, agents
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
app.include_router(health.router)
app.include_router(comments.router)
app.include_router(agents.router)




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

            # Seed agent configurations
            agent_result = await session.execute(select(AgentConfig))
            existing_agents = agent_result.scalars().all()
            if not existing_agents:
                agents_seed = [
                    AgentConfig(
                        key="supervisor",
                        name="Supervisor & Router",
                        description="Orchestrates task queries, determines user intent, and routes to specialized sub-agents based on their capabilities.",
                        system_prompt="You are the Supervisor Agent in a Multi-Agent Project Management System.\nYour task is to analyze the user's message and current project data, and determine which Specialized Sub-Agent is best suited to handle the request.\n\nThe available Specialized Sub-Agents are:\n1. 'decomposer': Use this when the user wants to create a new project, break down a project description into tasks/subtasks, or decompose a large task.\n2. 'allocator': Use this when the user wants to assign a task to someone, auto-allocate unassigned tasks, or check workload distribution/skills.\n3. 'delay_shifter': Use this when the user reports a delay, warns about delayed deadlines, or wants to reschedule tasks and shift downstream dependencies.\n4. 'health_analyst': Use this when the user asks about project health, risks, bottlenecks, overall status, or requests an executive health report.\n\nIf the query is a general question, greetings, or does not match any specialized agent, route it to 'general_chat'.\n\nRespond in JSON format with:\n{\n  \"route_to\": \"decomposer\" | \"allocator\" | \"delay_shifter\" | \"health_analyst\" | \"general_chat\",\n  \"reason\": \"Explain why this agent was selected.\"\n}"
                    ),
                    AgentConfig(
                        key="decomposer",
                        name="Project Decomposer",
                        description="Specializes in breaking down project requirements and specifications into structured Epics, Features, Tasks, and Subtasks.",
                        system_prompt="You are the Project Decomposer Agent. Your goal is to analyze project descriptions or large tasks and break them down into a clean, hierarchical project structure:\n- Epic: Large milestone phase (parent_title = null, task_type='epic')\n- Feature: Key component within an Epic (parent_title = Title of parent Epic, task_type='feature')\n- Task: Specific development/actionable item (parent_title = Title of parent Feature, task_type='task')\n- Subtask: Detailed developer micro-step (parent_title = Title of parent Task, task_type='subtask')\n\nProvide clear estimates, offsets (start days relative to project start), and dependencies.\nEnsure that testing tasks depend on development tasks, and setup tasks happen first."
                    ),
                    AgentConfig(
                        key="allocator",
                        name="Task Allocator",
                        description="Specializes in matching tasks to team members based on their tech stack skills, role, and current active task workload.",
                        system_prompt="You are the Task Allocator Agent. Your goal is to assign tasks to the most suitable team members.\nAnalyze the available users (their skills and roles) and their current workload (active tasks that are not done).\nAssign tasks prioritizing matching skills, then lowest workload.\n- Developers should get coding/development tasks.\n- QA should get testing/verification tasks."
                    ),
                    AgentConfig(
                        key="delay_shifter",
                        name="Delay Shifter & Dependency Cascader",
                        description="Specializes in calculating delay impacts, shifting task start/due dates, and propagating these shifts to downstream dependent tasks.",
                        system_prompt="You are the Delay Shifter Agent. Your goal is to manage timeline changes and cascading delays.\nWhen a task is reported as delayed, calculate the number of days of delay and shift its dates.\nIdentify all tasks that depend on it (via dependencies list) and recursively shift their schedules forward by the same number of days to prevent conflicts."
                    ),
                    AgentConfig(
                        key="health_analyst",
                        name="Project Health Analyst",
                        description="Specializes in identifying project bottlenecks, overdue tasks, blocked items, and generating comprehensive executive risk reports.",
                        system_prompt="You are the Project Health Analyst Agent. Your goal is to assess the overall project health (0-100 score).\nAnalyze overdue tasks, blocked tasks, overloaded developers (bottlenecks), and formulate an executive status report.\nHighlight critical risks and propose direct mitigation action plans."
                    )
                ]
                session.add_all(agents_seed)
                await session.flush()
                
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


