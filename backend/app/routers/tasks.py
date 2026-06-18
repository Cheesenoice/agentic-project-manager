from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import Task, Project
from app.schemas.schemas import TaskCreate, TaskResponse, TaskUpdate
from typing import List

router = APIRouter(prefix="/api", tags=["tasks"])

@router.post("/projects/{project_id}/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(project_id: int, task_data: TaskCreate, db: AsyncSession = Depends(get_db)):
    # Verify project exists
    proj_result = await db.execute(select(Project).filter(Project.id == project_id))
    if not proj_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    db_task = Task(
        project_id=project_id,
        parent_id=task_data.parent_id,
        title=task_data.title,
        description=task_data.description,
        status=task_data.status,
        task_type=task_data.task_type,
        phase=task_data.phase,
        start_date=task_data.start_date,
        due_date=task_data.due_date,
        assigned_to_id=task_data.assigned_to_id,
        dependencies=task_data.dependencies,
        estimated_hours=task_data.estimated_hours,
        actual_hours=task_data.actual_hours
    )
    db.add(db_task)
    await db.commit()
    await db.refresh(db_task)
    
    # Reload task with relationship loaded
    result = await db.execute(select(Task).filter(Task.id == db_task.id))
    return result.scalar_one()

@router.get("/projects/{project_id}/tasks", response_model=List[TaskResponse])
async def list_tasks(project_id: int, db: AsyncSession = Depends(get_db)):
    # Query root-level tasks or all tasks? The frontend wants all tasks to build hierarchy or filter.
    # Let's query all tasks for the project.
    result = await db.execute(select(Task).filter(Task.project_id == project_id))
    return result.scalars().all()

from datetime import datetime, timedelta
import json
from app.models.models import Notification

async def cascade_task_delay(db: AsyncSession, project_id: int, parent_task_id: int, days_shift: float):
    if days_shift <= 0:
        return
        
    res = await db.execute(select(Task).filter(Task.project_id == project_id))
    all_tasks = res.scalars().all()
    
    for t in all_tasks:
        if t.dependencies:
            try:
                dep_ids = json.loads(t.dependencies)
                if parent_task_id in dep_ids:
                    if t.start_date:
                        t.start_date = t.start_date + timedelta(days=days_shift)
                    if t.due_date:
                        t.due_date = t.due_date + timedelta(days=days_shift)
                    
                    msg = f"Task '{t.title}' shifted by {days_shift:.1f} days due to delay in prerequisite Task {parent_task_id}."
                    notif = Notification(
                        task_id=t.id,
                        message=msg
                    )
                    db.add(notif)
                    
                    # Send telegram warning
                    from app.services.telegram import send_telegram_message
                    await send_telegram_message(f"<b>[DELAY SHIFT WARNING]</b>\n{msg}")
                    
                    await cascade_task_delay(db, project_id, t.id, days_shift)
            except Exception as e:
                print(f"Error shifting task {t.id}: {e}")

async def check_subtask_rollup(db: AsyncSession, parent_id: int):
    sib_result = await db.execute(select(Task).filter(Task.parent_id == parent_id))
    siblings = sib_result.scalars().all()
    
    if siblings and all(s.status == "done" for s in siblings):
        parent_result = await db.execute(select(Task).filter(Task.id == parent_id))
        parent_task = parent_result.scalar_one_or_none()
        if parent_task and parent_task.status != "done":
            parent_task.status = "done"
            
            msg = f"Parent task '{parent_task.title}' automatically completed via subtask rollup."
            notif = Notification(
                task_id=parent_task.id,
                message=msg
            )
            db.add(notif)
            
            # Send telegram message
            from app.services.telegram import send_telegram_message
            await send_telegram_message(f"<b>[SUBTASK ROLLUP]</b>\n{msg}")
            
            # Trigger AI Routing for the rolled-up parent task
            from app.services.routing import run_ai_routing_decision
            await run_ai_routing_decision(db, parent_task.id)
            
            if parent_task.parent_id:
                await check_subtask_rollup(db, parent_task.parent_id)

@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: int, task_data: TaskUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).filter(Task.id == task_id))
    db_task = result.scalar_one_or_none()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    old_status = db_task.status
    old_due = db_task.due_date
    project_id = db_task.project_id
    parent_id = db_task.parent_id

    # Snapshot current task state before modification
    task_snapshot = {
        "title": db_task.title,
        "description": db_task.description,
        "status": db_task.status,
        "task_type": db_task.task_type,
        "phase": db_task.phase,
        "start_date": db_task.start_date.isoformat() if db_task.start_date else None,
        "due_date": db_task.due_date.isoformat() if db_task.due_date else None,
        "assigned_to_id": db_task.assigned_to_id,
        "dependencies": db_task.dependencies,
        "estimated_hours": db_task.estimated_hours,
        "actual_hours": db_task.actual_hours,
        "parent_id": db_task.parent_id
    }
    from app.models.models import TaskHistory
    history_entry = TaskHistory(
        project_id=project_id,
        task_id=task_id,
        state_json=json.dumps(task_snapshot)
    )
    db.add(history_entry)

    update_dict = task_data.model_dump(exclude_unset=True)
    
    # Calculate days shift if due_date is changing
    days_shift = 0.0
    if "due_date" in update_dict and update_dict["due_date"] and old_due:
        new_due = update_dict["due_date"]
        if isinstance(new_due, str):
            new_due = datetime.fromisoformat(new_due.replace("Z", "+00:00"))
        new_due = new_due.replace(tzinfo=None)
        old_due = old_due.replace(tzinfo=None)
        
        diff = (new_due - old_due).total_seconds() / 86400.0
        if diff > 0.01:
            days_shift = diff

    for key, val in update_dict.items():
        setattr(db_task, key, val)

    # If task is changed to "qa_review", auto assign to first QA user in DB
    if "status" in update_dict and update_dict["status"] == "qa_review":
        from app.models.models import User
        qa_res = await db.execute(select(User).filter(User.role == "qa"))
        qa_user = qa_res.scalar_one_or_none()
        if qa_user:
            db_task.assigned_to_id = qa_user.id
            print(f"[QA ROUTING] Auto-assigned task {task_id} to QA User {qa_user.username}")

    # Perform cascading shifts
    if days_shift > 0.01:
        await cascade_task_delay(db, project_id, task_id, days_shift)

    # Perform rollup check
    if "status" in update_dict and update_dict["status"] == "done" and parent_id:
        await db.flush()
        await check_subtask_rollup(db, parent_id)

    # Trigger telegram alert if status changed
    if "status" in update_dict and update_dict["status"] != old_status:
        from app.services.telegram import send_telegram_message
        new_stat = update_dict["status"]
        if new_stat == "qa_review":
            from app.models.models import User
            qa_res = await db.execute(select(User).filter(User.role == "qa"))
            qa_user = qa_res.scalar_one_or_none()
            qa_tag = f"@{qa_user.username}" if qa_user else "@qa_charlie"
            await send_telegram_message(
                f"🚨 <b>[QA REVIEW REQUESTED]</b>\n"
                f"Task: '{db_task.title}' (ID: {task_id})\n"
                f"🔔 Attention: {qa_tag} - Please verify this task."
            )
        elif new_stat == "done":
            await send_telegram_message(f"✅ <b>[TASK COMPLETED]</b>\nTask '{db_task.title}' (ID: {task_id}) has been completed.")
            # Trigger AI Routing for completed task
            from app.services.routing import run_ai_routing_decision
            await run_ai_routing_decision(db, task_id)
        else:
            await send_telegram_message(
                f"⚙️ <b>[STATUS UPDATE]</b>\n"
                f"Task: '{db_task.title}' (ID: {task_id})\n"
                f"Transition: <code>{old_status}</code> ➡️ <code>{new_stat}</code>"
            )

    await db.commit()
    await db.refresh(db_task)
    
    # Reload to ensure relationships are updated
    result = await db.execute(select(Task).filter(Task.id == task_id))
    return result.scalar_one()

@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Task).filter(Task.id == task_id))
    db_task = result.scalar_one_or_none()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(db_task)
    await db.commit()
    return None

@router.post("/projects/{project_id}/undo", response_model=TaskResponse)
async def undo_last_task_change(project_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.models import TaskHistory
    hist_result = await db.execute(
        select(TaskHistory)
        .filter(TaskHistory.project_id == project_id)
        .order_by(TaskHistory.timestamp.desc())
        .limit(1)
    )
    last_history = hist_result.scalar_one_or_none()
    
    if not last_history:
        raise HTTPException(status_code=400, detail="No changes to undo for this project.")
        
    task_result = await db.execute(select(Task).filter(Task.id == last_history.task_id))
    task = task_result.scalar_one_or_none()
    
    if not task:
        await db.delete(last_history)
        await db.commit()
        raise HTTPException(status_code=400, detail="Cannot undo change: task no longer exists.")
        
    try:
        state = json.loads(last_history.state_json)
        task.title = state["title"]
        task.description = state["description"]
        task.status = state["status"]
        task.task_type = state["task_type"]
        task.phase = state["phase"]
        
        task.start_date = datetime.fromisoformat(state["start_date"]) if state["start_date"] else None
        task.due_date = datetime.fromisoformat(state["due_date"]) if state["due_date"] else None
        
        task.assigned_to_id = state["assigned_to_id"]
        task.dependencies = state["dependencies"]
        task.estimated_hours = state["estimated_hours"]
        task.actual_hours = state["actual_hours"]
        task.parent_id = state["parent_id"]
        
        await db.delete(last_history)
        await db.commit()
        
        reload_res = await db.execute(select(Task).filter(Task.id == task.id))
        return reload_res.scalar_one()
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to undo: {str(e)}")

