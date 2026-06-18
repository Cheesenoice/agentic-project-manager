from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import Task, User, Project
from app.agents.agent import get_llm
from langchain_core.messages import SystemMessage, HumanMessage
from datetime import datetime, timedelta
from typing import List, Dict, Any
import json

router = APIRouter(prefix="/api", tags=["health"])

@router.get("/projects/{project_id}/health")
async def get_project_health(project_id: int, db: AsyncSession = Depends(get_db)):
    # 1. Verify project exists
    proj_result = await db.execute(select(Project).filter(Project.id == project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 2. Fetch all tasks and users
    tasks_res = await db.execute(select(Task).filter(Task.project_id == project_id))
    tasks = tasks_res.scalars().all()
    
    users_res = await db.execute(select(User))
    users = users_res.scalars().all()
    user_map = {u.id: u.username for u in users}

    now = datetime.utcnow()

    # 3. Calculate metrics
    overdue_count = 0
    blocked_count = 0
    
    # Dev task load mapping
    dev_task_count: Dict[str, int] = {}
    for task in tasks:
        # Check overdue
        if task.status != "done" and task.due_date and task.due_date < now:
            overdue_count += 1
            
        # Check blocked
        if task.status == "blocked":
            blocked_count += 1
            
        # Tally active tasks assigned to devs
        if task.status in ["todo", "in_progress", "qa_review"] and task.assigned_to_id:
            username = user_map.get(task.assigned_to_id, f"User {task.assigned_to_id}")
            dev_task_count[username] = dev_task_count.get(username, 0) + 1

    # Bottleneck developers (> 3 tasks)
    bottleneck_devs = [username for username, count in dev_task_count.items() if count > 3]

    # Calculate overall health score
    health_score = 100 - (overdue_count * 15) - (blocked_count * 10) - (len(bottleneck_devs) * 5)
    health_score = max(0, min(100, health_score))

    # 4. Invoke LLM for health assessment
    tasks_info = []
    for t in tasks:
        assignee = user_map.get(t.assigned_to_id, "Unassigned") if t.assigned_to_id else "Unassigned"
        tasks_info.append({
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "type": t.task_type,
            "due_date": (t.due_date + timedelta(hours=7)).strftime("%Y-%m-%d") if t.due_date else "None",
            "assignee": assignee,
            "dependencies": t.dependencies
        })

    prompt = f"""
    You are an expert AI Project Coordinator.
    Analyze the health of this project and generate a concise health assessment report in Markdown.
    
    Project Name: "{project.name}"
    Description: "{project.description or 'No description'}"
    Current Health Score: {health_score}/100
    Overdue Tasks: {overdue_count}
    Blocked Tasks: {blocked_count}
    Bottleneck Developers (workload > 3 tasks): {', '.join(bottleneck_devs) if bottleneck_devs else 'None'}
    
    Task List:
    {json.dumps(tasks_info, indent=2)}
    
    Your markdown response MUST contain:
    1. **Executive Summary**: A brief paragraph on overall project health.
    2. **Critical Path & Risks**: Highlight tasks that are overdue, blocked, or have high risk of delaying downstream dependencies.
    3. **Action Plan**: 3 actionable, specific bullets to get the project back on track or maintain high performance.
    
    Make the report readable, professional, and visually engaging (use alerts or emojis where appropriate).
    Respond in English.
    """

    try:
        llm = get_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a professional project manager. Provide the assessment strictly in English."),
            HumanMessage(content=prompt)
        ])
        ai_assessment = response.content.strip()
    except Exception as e:
        print(f"Health Analysis Error: {e}")
        ai_assessment = "### Project Health Assessment\nUnable to generate AI analysis report at this time."

    return {
        "health_score": health_score,
        "overdue_tasks": overdue_count,
        "blocked_tasks": blocked_count,
        "bottlenecks": bottleneck_devs,
        "ai_assessment": ai_assessment
    }
