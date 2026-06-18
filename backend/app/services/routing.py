import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.models import Task, User, TaskComment, Notification
from app.agents.agent import get_llm
from app.services.telegram import send_telegram_message
from langchain_core.messages import SystemMessage, HumanMessage

async def run_ai_routing_decision(db: AsyncSession, completed_task_id: int):
    print(f"[AI ROUTING] Starting AI Routing analysis for completed Task ID {completed_task_id}")
    
    # 1. Fetch completed task
    result = await db.execute(select(Task).filter(Task.id == completed_task_id))
    completed_task = result.scalar_one_or_none()
    if not completed_task:
        print(f"[AI ROUTING] Error: Completed task {completed_task_id} not found.")
        return
        
    project_id = completed_task.project_id
    
    # 2. Fetch all project tasks
    tasks_res = await db.execute(select(Task).filter(Task.project_id == project_id))
    all_tasks = tasks_res.scalars().all()
    
    # 3. Fetch all users
    users_res = await db.execute(select(User))
    all_users = users_res.scalars().all()
    
    # 4. Compute developer workloads (active tasks count)
    user_workload = {}
    for user in all_users:
        workload_res = await db.execute(
            select(Task).filter(Task.assigned_to_id == user.id, Task.status != "done")
        )
        user_workload[user.id] = len(workload_res.scalars().all())
        
    # 5. Format info for Gemini
    tasks_info = []
    for t in all_tasks:
        tasks_info.append({
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "status": t.status,
            "task_type": t.task_type,
            "phase": t.phase,
            "assigned_to_id": t.assigned_to_id,
            "dependencies": t.dependencies
        })
        
    users_info = []
    for u in all_users:
        users_info.append({
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "skills": u.skills,
            "active_tasks_count": user_workload.get(u.id, 0)
        })
        
    prompt = f"""
    You are the expert AI Project Coordinator & Tech Lead.
    A task in the project has just been marked as DONE (completed).
    Your job is to analyze the project status, determine the next logical task in the workflow, select the best role and assign the task to the most suitable team member (workload and skill match), and provide a strategic recommendation.

    Completed Task Details:
    - ID: {completed_task.id}
    - Title: "{completed_task.title}"
    - Description: "{completed_task.description or 'No description'}"
    - Phase: "{completed_task.phase}"
    - Task Type: "{completed_task.task_type}"

    Project Task List:
    {json.dumps(tasks_info, indent=2)}

    Available Project Users:
    {json.dumps(users_info, indent=2)}

    Instructions:
    1. Identify the logical next step or downstream task:
       - Look at dependencies: Are there tasks that list the completed task ({completed_task.id}) as a dependency?
       - Look at sibling tasks / phases: If this was a subtask, are all other subtasks of its parent done?
       - If a major development/coding task was completed (e.g. "Setup Environment" or "Backend API Development"), the next task should typically be a QA/testing task (e.g., QA review, API testing). If such a task does not exist in the project, recommend creating it (set action="create_and_assign").
       - If there is an existing downstream task, recommend assigning it (set action="assign_existing").
    2. Assign to the best team member:
       - If it's a testing or QA review task, assign it to a user with the role "qa" (e.g., qa_charlie).
       - If it's a coding or development task, assign it to a developer whose skills match the task keywords, preferring the developer with the lower active_tasks_count.
       - If it's a PM/planning task, assign it to a "pm" user (e.g. pm_alice).
    3. Generate a strong, clear, actionable AI decision and recommendation (reasoning) in English.

    You MUST return ONLY a raw JSON object matching the following structure. Do not wrap in markdown or backticks.
    {{
      "action": "assign_existing" | "create_and_assign" | "none",
      "target_task_id": 12,
      "new_task": {{
        "title": "QA Review for Setup Environment",
        "description": "Perform comprehensive testing and verification for Setup Environment components.",
        "task_type": "task",
        "phase": "testing",
        "estimated_hours": 4.0
      }},
      "assigned_user_id": 4,
      "assigned_username": "qa_charlie",
      "reasoning": "Since Setup Environment is complete, we must execute a QA Review. I have assigned it to qa_charlie who is our QA Engineer. As a subsequent decision, developers should focus on starting Backend Database Design."
    }}
    """
    
    llm = get_llm()
    try:
        response = await llm.ainvoke([
            SystemMessage(content="You are a strict JSON generator. Return ONLY raw JSON matching the schema, with no markdown backticks."),
            HumanMessage(content=prompt)
        ])
        
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        decision = json.loads(content)
        print(f"[AI ROUTING] Parsed decision: {decision}")
    except Exception as e:
        print(f"[AI ROUTING] Error calling/parsing Gemini decision: {e}")
        return

    action = decision.get("action", "none")
    assigned_user_id = decision.get("assigned_user_id")
    assigned_username = decision.get("assigned_username")
    reasoning = decision.get("reasoning", "")
    
    target_task = None
    
    # 6. Apply database changes
    if action == "assign_existing":
        target_id = decision.get("target_task_id")
        if target_id:
            target_res = await db.execute(select(Task).filter(Task.id == target_id))
            target_task = target_res.scalar_one_or_none()
            if target_task:
                target_task.assigned_to_id = assigned_user_id
                target_task.status = "todo"  # ensure it's in todo or ready
                print(f"[AI ROUTING] Assigned existing task {target_task.id} ({target_task.title}) to user ID {assigned_user_id} ({assigned_username})")
                
    elif action == "create_and_assign":
        new_task_info = decision.get("new_task")
        if new_task_info:
            start_dt = datetime.utcnow()
            due_dt = start_dt + timedelta(days=2)
            
            target_task = Task(
                project_id=project_id,
                parent_id=completed_task.parent_id or completed_task.id, # Link it to completed task
                title=new_task_info.get("title", "QA Review"),
                description=new_task_info.get("description", ""),
                status="todo",
                task_type=new_task_info.get("task_type", "task"),
                phase=new_task_info.get("phase", "testing"),
                start_date=start_dt,
                due_date=due_dt,
                assigned_to_id=assigned_user_id,
                estimated_hours=new_task_info.get("estimated_hours", 4.0)
            )
            db.add(target_task)
            await db.flush() # get ID
            print(f"[AI ROUTING] Created and assigned new task {target_task.id} ({target_task.title}) to user ID {assigned_user_id} ({assigned_username})")
            
    # 7. Add AI Coordinator Comment on the completed task
    if action != "none" and target_task:
        comment_content = (
            f"### 📣 AI Coordinator Decision & Automated Routing\n\n"
            f"**Completed Task**: {completed_task.title} (ID: {completed_task.id})\n"
            f"**Next Action**: {target_task.title} (ID: {target_task.id})\n"
            f"**Assigned To**: @{assigned_username} (User ID: {assigned_user_id})\n\n"
            f"**AI Decision/Reasoning**:\n{reasoning}"
        )
        ai_comment = TaskComment(
            task_id=completed_task.id,
            sender="ai_coordinator",
            content=comment_content
        )
        db.add(ai_comment)
        
        # Also send a Notification entry to DB
        notif = Notification(
            task_id=target_task.id,
            message=f"AI assigned next task '{target_task.title}' to @{assigned_username}."
        )
        db.add(notif)
        
        # 8. Send Telegram message
        telegram_message = (
            f"📣 <b>[AI COORDINATOR ROUTING]</b>\n\n"
            f"✅ <b>Completed:</b> '{completed_task.title}' (ID: {completed_task.id})\n"
            f"👉 <b>Next Task:</b> '{target_task.title}' (ID: {target_task.id})\n"
            f"👤 <b>Assigned:</b> @{assigned_username}\n\n"
            f"🧠 <b>AI Decision:</b>\n{reasoning}"
        )
        await send_telegram_message(telegram_message)
        
    await db.commit()
    print("[AI ROUTING] Completed AI Routing process successfully.")
