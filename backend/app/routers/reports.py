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

    # If task is changed to "qa_review", auto assign to first QA user in DB
    if new_status == "qa_review":
        from app.models.models import User
        qa_res = await db.execute(select(User).filter(User.role == "qa"))
        qa_user = qa_res.scalar_one_or_none()
        if qa_user:
            task.assigned_to_id = qa_user.id
            print(f"[QA ROUTING] Auto-assigned task {task_id} to QA User {qa_user.username}")

    # 4. Rollup check
    if new_status == "done" and parent_id:
        await db.flush()
        await check_subtask_rollup(db, parent_id)

    # 5. Telegram alert for status changes
    if new_status != old_status:
        from app.services.telegram import send_telegram_message
        if new_status == "qa_review":
            from app.models.models import User
            qa_res = await db.execute(select(User).filter(User.role == "qa"))
            qa_user = qa_res.scalar_one_or_none()
            qa_tag = f"@{qa_user.username}" if qa_user else "@qa_charlie"
            await send_telegram_message(
                f"🚨 <b>[QA REVIEW REQUESTED]</b>\n"
                f"Task: '{task.title}' (ID: {task_id})\n"
                f"Report: <i>{user_report}</i>\n"
                f"🔔 Attention: {qa_tag} - Please verify this task."
            )
        elif new_status == "done":
            await send_telegram_message(f"✅ <b>[TASK COMPLETED]</b>\nTask '{task.title}' (ID: {task_id}) has been completed.\nReport: <i>{user_report}</i>")
            # Trigger AI Routing for completed task
            from app.services.routing import run_ai_routing_decision
            await run_ai_routing_decision(db, task_id)
        else:
            await send_telegram_message(
                f"⚙️ <b>[STATUS UPDATE]</b>\n"
                f"Task: '{task.title}' (ID: {task_id})\n"
                f"Report: <i>{user_report}</i>\n"
                f"Transition: <code>{old_status}</code> ➡️ <code>{new_status}</code>"
            )

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

@router.post("/tasks/{task_id}/draft-report")
async def draft_status_report(
    task_id: int, 
    target_status: Optional[str] = None, 
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Task).filter(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    status_name = target_status or task.status
    prompt = f"""
    You are the AI Project Coordinator.
    Draft exactly 3 alternative, extremely short and simple progress report sentences in English for the task "{task.title}" transitioning to status "{status_name}".
    Guidelines:
    - Keep each option extremely short (under 8 words) and simple.
    - Do not describe in detail.
    - Output ONLY a JSON list of 3 strings. Do not write markdown or any explanations.
    """

    try:
        llm = get_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a helpful assistant. Output ONLY a valid JSON array of 3 short strings directly, without markdown or explanations."),
            HumanMessage(content=prompt)
        ])
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        suggestions = json.loads(content.strip())
        if not isinstance(suggestions, list) or len(suggestions) == 0:
            raise ValueError("Invalid format")
    except Exception as e:
        print(f"Draft Report Error: {e}")
        # fallback based on target_status
        if status_name == "in_progress":
            suggestions = ["Started working on task.", "Began task development.", "Now in progress."]
        elif status_name == "qa_review":
            suggestions = ["Ready for QA review.", "Submitted for testing.", "QA validation needed."]
        elif status_name == "done":
            suggestions = ["Completed task successfully.", "Finished all requirements.", "Task complete."]
        elif status_name == "blocked":
            suggestions = ["Work is blocked.", "Pending external dependencies.", "Encountered blockers."]
        else:
            suggestions = [f"Updated {task.title}.", "Status changed.", "Progressing on task."]

    draft = suggestions[0] if suggestions else f"Updated {task.title}."
    return {"draft": draft, "suggestions": suggestions}

