from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import Task, TaskComment, User
from app.schemas.schemas import CommentCreate, CommentResponse
from app.agents.agent import get_llm
from langchain_core.messages import SystemMessage, HumanMessage
from typing import List
from datetime import datetime

router = APIRouter(prefix="/api", tags=["comments"])

@router.get("/tasks/{task_id}/comments", response_model=List[CommentResponse])
async def list_task_comments(task_id: int, db: AsyncSession = Depends(get_db)):
    # Verify task exists
    task_res = await db.execute(select(Task).filter(Task.id == task_id))
    if not task_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(TaskComment)
        .filter(TaskComment.task_id == task_id)
        .order_by(TaskComment.created_at.asc())
    )
    return result.scalars().all()

@router.post("/tasks/{task_id}/comments", response_model=CommentResponse)
async def create_task_comment(task_id: int, payload: CommentCreate, db: AsyncSession = Depends(get_db)):
    # 1. Verify task exists
    task_res = await db.execute(select(Task).filter(Task.id == task_id))
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # 2. Save user comment
    user_comment = TaskComment(
        task_id=task_id,
        sender="user",
        content=payload.content
    )
    db.add(user_comment)
    await db.flush()

    # 3. Get user details if task is assigned
    assignee_name = "Unassigned"
    if task.assigned_to_id:
        user_res = await db.execute(select(User).filter(User.id == task.assigned_to_id))
        user_obj = user_res.scalar_one_or_none()
        if user_obj:
            assignee_name = user_obj.username

    # 4. Fetch past comments context (limit to last 10 comments to keep context short)
    past_comments_res = await db.execute(
        select(TaskComment)
        .filter(TaskComment.task_id == task_id, TaskComment.id != user_comment.id)
        .order_by(TaskComment.created_at.desc())
        .limit(10)
    )
    past_comments = list(reversed(past_comments_res.scalars().all()))
    comments_ctx = "\n".join([f"{c.sender}: {c.content}" for c in past_comments])

    # 5. Formulate prompt for Gemini
    prompt = f"""
    You are the AI Project Coordinator / Expert Tech Lead.
    You are assisting a developer in a chat thread directly on a specific task.
    
    Task Details:
    - Title: "{task.title}"
    - Description: "{task.description or 'No description'}"
    - Phase: "{task.phase}"
    - Current Status: "{task.status}"
    - Assigned To: "{assignee_name}"
    
    Conversation History:
    {comments_ctx or 'No prior messages.'}
    
    User message: "{payload.content}"
    
    Respond as an expert pair programmer or helpful team coordinator.
    - If they ask for subtasks / decomposition, suggest a flat list of subtasks.
    - If they ask for code, write clean code boilerplates in appropriate language.
    - Keep your answer direct and helpful. Use Markdown for formatting.
    - Answer in English.
    """

    try:
        llm = get_llm()
        response = await llm.ainvoke([
            SystemMessage(content="You are a senior tech lead helping developers. Always answer in English and format code blocks nicely using Markdown."),
            HumanMessage(content=prompt)
        ])
        ai_reply = response.content.strip()
    except Exception as e:
        print(f"Task AI Comment Error: {e}")
        ai_reply = "Sorry, I am having trouble connecting to the AI assistant right now."

    # 6. Save AI comment
    ai_comment = TaskComment(
        task_id=task_id,
        sender="ai_coordinator",
        content=ai_reply
    )
    db.add(ai_comment)
    await db.commit()
    
    # Reload user comment with DB values
    await db.refresh(user_comment)
    return user_comment
