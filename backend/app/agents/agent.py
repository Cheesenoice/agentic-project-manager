from typing import TypedDict, List, Annotated, Optional
import json
import operator
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END
from app.config import settings
from app.db import async_session
from app.models.models import Project, Task, User, Notification
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

# ==========================================
# 1. SCHEMAS FOR LLM OUTPUTS
# ==========================================

class DecomposedTask(BaseModel):
    title: str = Field(description="Unique title of the task")
    description: str = Field(description="Short description of what needs to be done")
    task_type: str = Field(description="epic, feature, task, or subtask")
    phase: str = Field(description="planning, design, development, testing, or deployment")
    parent_title: Optional[str] = Field(default=None, description="Title of the parent task/epic, if this is a subtask/feature")
    dependencies: List[str] = Field(default=[], description="List of task titles that must finish before this task starts")
    days_offset: int = Field(default=0, description="Start day offset from project creation (e.g. 0, 2, 5)")
    duration_days: int = Field(default=2, description="Duration in days")
    estimated_hours: float = Field(default=8.0, description="Estimated time to complete in hours")

class ProjectDecomposition(BaseModel):
    tasks: List[DecomposedTask] = Field(description="Hierarchical list of tasks")

class CoordinatorIntent(BaseModel):
    action_type: str = Field(description="Action: 'update_status', 'assign_task', 'report_delay', 'create_task', or 'none'")
    target_task_id: Optional[int] = Field(default=None, description="ID of the task to modify")
    new_status: Optional[str] = Field(default=None, description="todo, in_progress, qa_review, done, blocked")
    assignee_id: Optional[int] = Field(default=None, description="ID of the user to assign the task to")
    assign_by_skills: Optional[bool] = Field(default=False, description="True if developer should be auto-selected by AI workload/skills")
    delay_days: Optional[int] = Field(default=None, description="Number of days the task is delayed")
    
    # Fields for creating a new task
    create_title: Optional[str] = Field(default=None, description="Title of new task")
    create_desc: Optional[str] = Field(default=None, description="Description of new task")
    create_type: Optional[str] = Field(default="task", description="epic, feature, task, subtask")
    create_phase: Optional[str] = Field(default="development", description="phase")
    create_parent_id: Optional[int] = Field(default=None, description="Parent task ID")
    create_duration_days: Optional[int] = Field(default=2, description="Duration in days")

# ==========================================
# 2. STATE DEFINITIONS
# ==========================================

class AgentState(TypedDict):
    project_id: int
    project_name: str
    project_description: str
    decomposed_tasks: List[dict]
    messages: List[BaseMessage]

class CoordinatorState(TypedDict):
    project_id: int
    user_role: str
    message: str
    parsed_intent: Optional[dict]
    action_taken: str
    response: str

# Initialize LLM dynamically to prevent event loop initialization errors
def get_llm():
    return ChatGoogleGenerativeAI(
        model=settings.GEMINI_MODEL,
        google_api_key=settings.GEMINI_API_KEY,
        temperature=0.1
    )

decomp_parser = JsonOutputParser(pydantic_object=ProjectDecomposition)
coord_parser = JsonOutputParser(pydantic_object=CoordinatorIntent)

# ==========================================
# 3. PROJECT DECOMPOSITION AGENT NODES
# ==========================================

async def decompose_project_node(state: AgentState):
    print("--- ENTERING DECOMPOSE PROJECT NODE ---")
    llm = get_llm()
    prompt = f"""
    You are a professional Project Manager AI. 
    Decompose the project: "{state['project_name']}"
    Description: {state['project_description']}
    
    Break it down into a hierarchical schedule of flat tasks with:
    - Epics (Main blocks, task_type='epic', parent_title=null, offset=0, duration=long)
    - Features (Sub-blocks of epics, task_type='feature', parent_title=Title of parent Epic)
    - Tasks (Work items, task_type='task', parent_title=Title of parent Feature)
    - Subtasks (Detailed micro-steps, task_type='subtask', parent_title=Title of parent Task)
    
    Phases must be one of: planning, design, development, testing, deployment.
    Ensure dependency chains are logical (e.g. testing task depends on development task).
    Estimate realistic offsets (days_offset) and durations.
    
    {decomp_parser.get_format_instructions()}
    
    Ensure the output is a single flat JSON list under the key "tasks". Do not create nested phases or epics in the JSON structure.
    Return ONLY raw JSON conforming to the schema. Do not wrap in markdown tags.
    """
    
    response = await llm.ainvoke([
        SystemMessage(content="You are a strict JSON generator. Output ONLY raw JSON conforming to the schema. Do not write any markdown code blocks or introduction."),
        HumanMessage(content=prompt)
    ])
    
    print(f"Raw LLM Response: {response.content}")
    try:
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        parsed_data = decomp_parser.parse(content)
        tasks = parsed_data.get("tasks", [])
        print(f"Successfully parsed {len(tasks)} tasks.")
    except Exception as e:
        print(f"Decomposition Parse Error: {e}")
        tasks = []
        
    return {"decomposed_tasks": tasks}

async def save_tasks_node(state: AgentState):
    project_id = state["project_id"]
    tasks_to_create = state["decomposed_tasks"]
    print(f"--- ENTERING SAVE TASKS NODE, Tasks to create: {len(tasks_to_create)} ---")
    
    async with async_session() as session:
        async with session.begin():
            # Clear old tasks if any
            result = await session.execute(select(Task).filter(Task.project_id == project_id))
            old_tasks = result.scalars().all()
            for ot in old_tasks:
                await session.delete(ot)
            
            created_tasks = []
            title_to_task = {}
            project_start = datetime.utcnow()
            
            # Step 1: Create all tasks (flat)
            for t_data in tasks_to_create:
                start_dt = project_start + timedelta(days=t_data.get("days_offset", 0))
                due_dt = start_dt + timedelta(days=t_data.get("duration_days", 2))
                
                db_task = Task(
                    project_id=project_id,
                    title=t_data["title"],
                    description=t_data["description"],
                    status="todo",
                    task_type=t_data.get("task_type", "task"),
                    phase=t_data.get("phase", "development"),
                    start_date=start_dt,
                    due_date=due_dt,
                    estimated_hours=t_data.get("estimated_hours", 8.0)
                )
                session.add(db_task)
                created_tasks.append((db_task, t_data))
            
            await session.flush() # Populate IDs
            
            # Index created tasks by title for parent/dependency mapping
            for db_task, _ in created_tasks:
                title_to_task[db_task.title.lower().strip()] = db_task
            
            # Step 2: Establish parent/child relationships and dependencies
            for db_task, t_data in created_tasks:
                # Parent relation
                parent_title = t_data.get("parent_title")
                if parent_title:
                    parent_task = title_to_task.get(parent_title.lower().strip())
                    if parent_task:
                        db_task.parent_id = parent_task.id
                
                # Dependencies relation
                deps = t_data.get("dependencies", [])
                dep_ids = []
                for dep_title in deps:
                    dep_task = title_to_task.get(dep_title.lower().strip())
                    if dep_task:
                        dep_ids.append(dep_task.id)
                db_task.dependencies = json.dumps(dep_ids)
                
    return {"project_id": project_id}

# ==========================================
# 4. COORDINATOR AGENT NODES (CHAT / UPDATES)
# ==========================================

async def parse_intent_node(state: CoordinatorState):
    project_id = state["project_id"]
    
    async with async_session() as session:
        # Load tasks
        t_result = await session.execute(select(Task).filter(Task.project_id == project_id))
        tasks = t_result.scalars().all()
        tasks_info = [{"id": t.id, "title": t.title, "status": t.status, "assigned_to_id": t.assigned_to_id, "type": t.task_type} for t in tasks]
        
        # Load users
        u_result = await session.execute(select(User))
        users = u_result.scalars().all()
        users_info = [{"id": u.id, "username": u.username, "role": u.role, "skills": u.skills} for u in users]
        
    prompt = f"""
    You are an AI Coordinator. Analyze the user's message and current project data.
    Identify the requested action and populate the JSON response.
    
    User Role: {state['user_role']}
    Project ID: {project_id}
    Current Tasks: {tasks_info}
    Available Users: {users_info}
    
    User Message: "{state['message']}"
    
    Determine the action_type:
    - 'update_status': user wants to update a task's status. Set 'target_task_id' and 'new_status'.
    - 'assign_task': user wants to assign a task. Set 'target_task_id'. Set 'assignee_id' if a user is mentioned, or set 'assign_by_skills': true if AI should auto-assign.
    - 'report_delay': user says a task is delayed. Set 'target_task_id' and 'delay_days' (integer).
    - 'create_task': user wants to add a new task/subtask. Set 'create_title', 'create_desc', 'create_type', 'create_phase', 'create_parent_id', 'create_duration_days'.
    - 'none': general question, chat, or no action.
    
    {coord_parser.get_format_instructions()}
    
    Return ONLY raw JSON conforming to the schema. Do not write markdown tags.
    """
    
    llm = get_llm()
    response = await llm.ainvoke([

        SystemMessage(content="You are a strict parser. Output ONLY raw JSON conforming to the schema. No markdown code blocks."),
        HumanMessage(content=prompt)
    ])
    
    try:
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        intent = coord_parser.parse(content)
    except Exception as e:
        print(f"Coordinator Parse Error: {e}")
        intent = {"action_type": "none"}
        
    return {"parsed_intent": intent}

async def execute_intent_node(state: CoordinatorState):
    project_id = state["project_id"]
    intent = state["parsed_intent"] or {}
    action_type = intent.get("action_type", "none")
    
    action_taken = ""
    response_msg = "I parsed your request, but no action was performed."
    
    async with async_session() as session:
        async with session.begin():
            if action_type == "update_status":
                task_id = intent.get("target_task_id")
                new_status = intent.get("new_status")
                if task_id and new_status:
                    # Fetch task
                    result = await session.execute(
                        select(Task)
                        .filter(Task.id == task_id, Task.project_id == project_id)
                        .options(selectinload(Task.parent))
                    )
                    task = result.scalar_one_or_none()
                    if task:
                        old_status = task.status
                        task.status = new_status
                        action_taken = f"Updated task {task_id} status from {old_status} to {new_status}."
                        response_msg = f"Task '{task.title}' status has been updated to **{new_status}**."
                        
                        # Subtask Rollup check
                        if new_status == "done" and task.parent_id:
                            # Load sibling tasks
                            sib_result = await session.execute(
                                select(Task).filter(Task.parent_id == task.parent_id)
                            )
                            siblings = sib_result.scalars().all()
                            if all(s.status == "done" for s in siblings):
                                parent_result = await session.execute(
                                    select(Task).filter(Task.id == task.parent_id)
                                )
                                parent_task = parent_result.scalar_one_or_none()
                                if parent_task and parent_task.status != "done":
                                    parent_task.status = "done"
                                    action_taken += f" Parent task {parent_task.id} also marked done via rollup."
                                    response_msg += f"\n\n*Rollup:* All subtasks completed! Parent task '{parent_task.title}' has also been marked **done**."
                                    
                                    # Create notification
                                    notif = Notification(
                                        task_id=parent_task.id,
                                        message=f"Parent task '{parent_task.title}' automatically completed via subtask rollup."
                                    )
                                    session.add(notif)
                    else:
                        response_msg = "Could not find the requested task in this project."
            
            elif action_type == "assign_task":
                task_id = intent.get("target_task_id")
                assignee_id = intent.get("assignee_id")
                assign_by_skills = intent.get("assign_by_skills")
                
                if task_id:
                    result = await session.execute(
                        select(Task).filter(Task.id == task_id, Task.project_id == project_id)
                    )
                    task = result.scalar_one_or_none()
                    if task:
                        target_user = None
                        if assign_by_skills:
                            # Auto assign: get all developers
                            u_result = await session.execute(select(User).filter(User.role == "developer"))
                            developers = u_result.scalars().all()
                            
                            # Fetch current tasks workload (number of non-done tasks)
                            best_user = None
                            min_workload = float('inf')
                            
                            for dev in developers:
                                workload_result = await session.execute(
                                    select(Task).filter(Task.assigned_to_id == dev.id, Task.status != "done")
                                )
                                workload = len(workload_result.scalars().all())
                                
                                # Simple matching: check if dev skills match keywords in task title/desc
                                skill_match = False
                                if dev.skills and task.title:
                                    try:
                                        dev_skills = json.loads(dev.skills)
                                        for skill in dev_skills:
                                            if skill.lower() in task.title.lower() or (task.description and skill.lower() in task.description.lower()):
                                                skill_match = True
                                    except:
                                        pass
                                
                                # Priority: skill match + lower workload
                                score = workload - (5 if skill_match else 0)
                                if score < min_workload:
                                    min_workload = score
                                    best_user = dev
                                    
                            target_user = best_user
                        elif assignee_id:
                            user_result = await session.execute(select(User).filter(User.id == assignee_id))
                            target_user = user_result.scalar_one_or_none()
                            
                        if target_user:
                            task.assigned_to_id = target_user.id
                            action_taken = f"Assigned task {task_id} to user {target_user.username}."
                            response_msg = f"Task '{task.title}' has been successfully assigned to **{target_user.username}**."
                        else:
                            response_msg = "No suitable developer was found or specified."
                    else:
                        response_msg = "Task not found."
                else:
                    if assign_by_skills:
                        # Auto assign all unassigned tasks in project
                        u_result = await session.execute(select(User).filter(User.role == "developer"))
                        developers = u_result.scalars().all()
                        
                        tasks_result = await session.execute(
                            select(Task).filter(
                                Task.project_id == project_id,
                                Task.task_type.in_(["task", "subtask"]),
                                Task.assigned_to_id == None,
                                Task.status != "done"
                            )
                        )
                        unassigned_tasks = tasks_result.scalars().all()
                        
                        if not unassigned_tasks:
                            response_msg = "All tasks in this project are already assigned or completed."
                        else:
                            assigned_info = []
                            for t in unassigned_tasks:
                                best_user = None
                                min_workload = float('inf')
                                for dev in developers:
                                    workload_result = await session.execute(
                                        select(Task).filter(Task.assigned_to_id == dev.id, Task.status != "done")
                                    )
                                    workload = len(workload_result.scalars().all())
                                    
                                    skill_match = False
                                    if dev.skills and t.title:
                                        try:
                                            dev_skills = json.loads(dev.skills)
                                            for skill in dev_skills:
                                                if skill.lower() in t.title.lower() or (t.description and skill.lower() in t.description.lower()):
                                                    skill_match = True
                                        except:
                                            pass
                                    score = workload - (5 if skill_match else 0)
                                    if score < min_workload:
                                        min_workload = score
                                        best_user = dev
                                if best_user:
                                    t.assigned_to_id = best_user.id
                                    assigned_info.append(f"'{t.title}' to @{best_user.username}")
                            
                            if assigned_info:
                                action_taken = f"Auto-allocated {len(assigned_info)} tasks."
                                response_msg = "Successfully auto-allocated tasks:\n" + "\n".join(f"- {info}" for info in assigned_info)
                            else:
                                response_msg = "No tasks were allocated."
                    else:
                        response_msg = "Please specify a task ID to assign."
            
            elif action_type == "report_delay":
                task_id = intent.get("target_task_id")
                delay_days = intent.get("delay_days")
                
                if task_id and delay_days:
                    result = await session.execute(
                        select(Task).filter(Task.id == task_id, Task.project_id == project_id)
                    )
                    task = result.scalar_one_or_none()
                    if task and task.due_date:
                        old_due = task.due_date
                        task.due_date = task.due_date + timedelta(days=delay_days)
                        if task.start_date:
                            task.start_date = task.start_date + timedelta(days=delay_days)
                            
                        action_taken = f"Shifted task {task_id} schedule by {delay_days} days."
                        response_msg = f"Shifted Task '{task.title}' due date to **{task.due_date.strftime('%Y-%m-%d %H:%M')}**."
                        
                        # Recursive shift of dependent tasks
                        async def shift_dependents(parent_t_id, days):
                            # Find tasks in project
                            proj_tasks_res = await session.execute(
                                select(Task).filter(Task.project_id == project_id)
                            )
                            all_t = proj_tasks_res.scalars().all()
                            
                            shifted_titles = []
                            for t in all_t:
                                if t.dependencies:
                                    try:
                                        dep_ids = json.loads(t.dependencies)
                                        if parent_t_id in dep_ids:
                                            # Shift this task
                                            if t.start_date:
                                                t.start_date = t.start_date + timedelta(days=days)
                                            if t.due_date:
                                                t.due_date = t.due_date + timedelta(days=days)
                                            
                                            # Notify
                                            notif = Notification(
                                                task_id=t.id,
                                                message=f"Task '{t.title}' shifted by {days} days due to delay in prerequisite Task {parent_t_id}."
                                            )
                                            session.add(notif)
                                            shifted_titles.append(t.title)
                                            
                                            # Recurse
                                            sub_shifted = await shift_dependents(t.id, days)
                                            shifted_titles.extend(sub_shifted)
                                    except:
                                        pass
                            return shifted_titles
                        
                        cascaded_tasks = await shift_dependents(task.id, delay_days)
                        if cascaded_tasks:
                            response_msg += f"\n\n*Cascading Delay Warnings:* The following dependent tasks were shifted by {delay_days} days: {', '.join([f'**{t}**' for t in cascaded_tasks])}."
                    else:
                        response_msg = "Task not found or does not have dates set."
                        
            elif action_type == "create_task":
                title = intent.get("create_title")
                desc = intent.get("create_desc", "")
                t_type = intent.get("create_type", "task")
                phase = intent.get("create_phase", "development")
                parent_id = intent.get("create_parent_id")
                duration = intent.get("create_duration_days", 2)
                
                if title:
                    start_dt = datetime.utcnow()
                    due_dt = start_dt + timedelta(days=duration)
                    
                    # If subtask, inherit dates/project from parent
                    if parent_id:
                        p_res = await session.execute(select(Task).filter(Task.id == parent_id))
                        parent_t = p_res.scalar_one_or_none()
                        if parent_t:
                            start_dt = parent_t.start_date or start_dt
                            due_dt = parent_t.due_date or (start_dt + timedelta(days=duration))
                    
                    new_t = Task(
                        project_id=project_id,
                        parent_id=parent_id,
                        title=title,
                        description=desc,
                        status="todo",
                        task_type=t_type,
                        phase=phase,
                        start_date=start_dt,
                        due_date=due_dt,
                        estimated_hours=float(duration * 4) # Rough estimate
                    )
                    session.add(new_t)
                    await session.flush()
                    action_taken = f"Created new {t_type} '{title}' with ID {new_t.id}."
                    response_msg = f"Successfully created new {t_type} **'{title}'** (ID: {new_t.id})."
                else:
                    response_msg = "Could not create task. Missing title."
                    
            else:
                # None or Chat response: generate standard PM conversational response
                chat_prompt = f"""
                You are a helpful AI Project Manager. Respond to the user request.
                User Request: "{state['message']}"
                Answer concisely in Vietnamese or English based on the user language.
                """
                llm = get_llm()
                chat_resp = await llm.ainvoke([

                    SystemMessage(content="You are a helpful project assistant. Respond directly without conversational filler."),
                    HumanMessage(content=chat_prompt)
                ])
                response_msg = chat_resp.content
                action_taken = "Generated conversational answer."

    return {
        "action_taken": action_taken,
        "response": response_msg
    }

# ==========================================
# 5. COMPILE GRAPHS
# ==========================================

# 1. Project Decomposition Graph
decomp_wf = StateGraph(AgentState)
decomp_wf.add_node("decompose", decompose_project_node)
decomp_wf.add_node("save", save_tasks_node)
decomp_wf.set_entry_point("decompose")
decomp_wf.add_edge("decompose", "save")
decomp_wf.add_edge("save", END)
agent_app = decomp_wf.compile()

# 2. Coordinator Graph
coord_wf = StateGraph(CoordinatorState)
coord_wf.add_node("parse", parse_intent_node)
coord_wf.add_node("execute", execute_intent_node)
coord_wf.set_entry_point("parse")
coord_wf.add_edge("parse", "execute")
coord_wf.add_edge("execute", END)
coordinator_app = coord_wf.compile()

