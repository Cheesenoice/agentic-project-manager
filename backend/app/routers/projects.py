from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import Project
from app.schemas.schemas import ProjectCreate, ProjectResponse
from app.agents.agent import agent_app
from typing import List

router = APIRouter(prefix="/api/projects", tags=["projects"])

async def run_decomposition_agent(project_id: int, project_name: str, project_description: str):
    print(f"--- STARTING DECOMPOSITION FOR PROJECT {project_id}: {project_name} ---")
    initial_state = {
        "project_id": project_id,
        "project_name": project_name,
        "project_description": project_description,
        "decomposed_tasks": [],
        "messages": []
    }
    try:
        await agent_app.ainvoke(initial_state)
        print(f"--- COMPLETED DECOMPOSITION FOR PROJECT {project_id} ---")
    except Exception as e:
        import traceback
        print(f"--- ERROR IN DECOMPOSITION FOR PROJECT {project_id} ---")
        traceback.print_exc()

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate, 
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    db_project = Project(
        name=project_data.name,
        description=project_data.description
    )
    db.add(db_project)
    await db.commit()
    await db.refresh(db_project)
    
    background_tasks.add_task(
        run_decomposition_agent,
        project_id=db_project.id,
        project_name=db_project.name,
        project_description=db_project.description
    )
    
    return db_project

@router.get("/", response_model=List[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project))
    projects = result.scalars().all()
    return projects

@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).filter(Project.id == project_id))
    db_project = result.scalar_one_or_none()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    return db_project

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).filter(Project.id == project_id))
    db_project = result.scalar_one_or_none()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.delete(db_project)
    await db.commit()
    return None

from app.schemas.schemas import ChatRequest
from app.agents.agent import coordinator_app

@router.post("/{project_id}/chat")
async def chat_with_agent(project_id: int, chat_data: ChatRequest, db: AsyncSession = Depends(get_db)):
    initial_state = {
        "project_id": project_id,
        "user_role": chat_data.role or "pm",
        "message": chat_data.message,
        "forced_agent": chat_data.forced_agent,
        "parsed_intent": None,
        "action_taken": "",
        "response": "",
        "selected_agent": "supervisor"
    }
    
    try:
        final_state = await coordinator_app.ainvoke(initial_state)
        return {
            "response": final_state["response"],
            "action_taken": final_state["action_taken"],
            "selected_agent": final_state.get("selected_agent", "supervisor")
        }
    except Exception as e:
        return {
            "response": f"Sorry, I encountered an error processing your request: {str(e)}",
            "action_taken": "Error",
            "selected_agent": "supervisor"
        }


