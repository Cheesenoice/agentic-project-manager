from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db, async_session
from app.models.models import Task, TaskHistory, Notification
from app.routers.tasks import check_subtask_rollup, cascade_task_delay
from app.agents.agent import get_llm
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from typing import Optional
import json
from datetime import datetime

router = APIRouter(prefix="/api", tags=["reports"])

class ReportRequest(BaseModel):
    status: str
    report: str

class AIRecommendation(BaseModel):
    recommendation: str = Field(description="Reasoning for recommendation")
    action_type: str = Field(description="create_task or none")
    suggested_title: Optional[str] = Field(default=None, description="Suggested task title if create_task")
    suggested_desc: Optional[str] = Field(default=None, description="Suggested task description if create_task")
    suggested_phase: Optional[str] = Field(default="development", description="Suggested task phase: planning, design, development, testing, or deployment")

ai_parser = JsonOutputParser(pydantic_object=AIRecommendation)

@router.post("/tasks/{task_id}/report")
async def create_status_report(task_id: int, payload: ReportRequest, db: AsyncSession = Depends(get_db)):
    # 1. Fetch task
    result = await db.execute(select(Task).filter(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    old_status = task.status
    new_status = payload.status
    user_report = payload.report
    project_id = task.project_id
    parent_id = task.parent_id

    # 2. Save snapshot to TaskHistory
    task_snapshot = {
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "task_type": task.task_type,
        "phase": task.phase,
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "assigned_to_id": task.assigned_to_id,
        "dependencies": task.dependencies,
        "estimated_hours": task.estimated_hours,
        "actual_hours": task.actual_hours,
        "parent_id": task.parent_id
    }
    history_entry = TaskHistory(
        project_id=project_id,
        task_id=task_id,
        state_json=json.dumps(task_snapshot)
    )
    db.add(history_entry)

    # 3. Update status
    task.status = new_status

    # 4. Rollup check
    if new_status == "done" and parent_id:
        await db.flush()
        await check_subtask_rollup(db, parent_id)

    # 5. Telegram alert for task completion
    if new_status == "done" and old_status != "done":
        from app.services.telegram import send_telegram_message
        await send_telegram_message(f"<b>[TASK COMPLETED]</b>\nTask '{task.title}' (ID: {task_id}) has been completed.\nReport: <i>{user_report}</i>")

    await db.commit()
    await db.refresh(task)

    # 6. Ask LLM to analyze the report and generate recommendation
    llm = get_llm()
    prompt = f"""
    You are an expert AI Project Coordinator.
    Analyze this task update report and recommend the next action.
    
    Task: "{task.title}"
    Description: "{task.description or 'No description'}"
    Transition: {old_status} -> {new_status}
    Developer Progress Report: "{user_report}"
    
    Determine if this report suggests:
    1. A missing feature, bug, follow-up, or new task that should be created (action_type: "create_task").
    2. No action needed (action_type: "none").
    
    {ai_parser.get_format_instructions()}
    
    Return ONLY a raw JSON conforming to the schema. Do not write markdown tags.
    """
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON generator. Output ONLY raw JSON conforming to the schema."),
            HumanMessage(content=prompt)
        ])
        
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
            
        recommendation = ai_parser.parse(content)
    except Exception as e:
        print(f"Report Analysis Error: {e}")
        recommendation = {
            "recommendation": "Report received. No automatic action suggested.",
            "action_type": "none"
        }

    return {
        "task": {
            "id": task.id,
            "title": task.title,
            "status": task.status
        },
        "ai_recommendation": recommendation
    }
