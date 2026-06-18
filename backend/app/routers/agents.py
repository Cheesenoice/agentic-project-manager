from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import AgentConfig
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/api/agents", tags=["agents"])

class AgentResponse(BaseModel):
    id: int
    key: str
    name: str
    description: str
    system_prompt: str

    class Config:
        from_attributes = True

class AgentUpdateRequest(BaseModel):
    description: str
    system_prompt: str

@router.get("/", response_model=List[AgentResponse])
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentConfig))
    agents = result.scalars().all()
    return agents

@router.put("/{key}", response_model=AgentResponse)
async def update_agent(key: str, data: AgentUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentConfig).filter(AgentConfig.key == key))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent configuration not found")
    
    agent.description = data.description
    agent.system_prompt = data.system_prompt
    await db.commit()
    await db.refresh(agent)
    return agent
