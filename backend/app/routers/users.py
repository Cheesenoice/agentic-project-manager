from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import User
from app.schemas.schemas import UserCreate, UserResponse
from typing import List

router = APIRouter(prefix="/api/users", tags=["users"])

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).filter(User.username == user_data.username))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    db_user = User(
        username=user_data.username,
        role=user_data.role,
        skills=user_data.skills
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@router.get("/", response_model=List[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    users = result.scalars().all()
    return users

@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).filter(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).filter(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return None

@router.put("/{user_id}", response_model=UserResponse)
async def update_user(user_id: int, user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).filter(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.username != user_data.username:
        exist_res = await db.execute(select(User).filter(User.username == user_data.username))
        existing = exist_res.scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")

    user.username = user_data.username
    user.role = user_data.role
    user.skills = user_data.skills
    
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/parse-cv")
async def parse_cv(file: UploadFile = File(...)):
    filename = file.filename.lower()
    
    # 1. Extract text
    text = ""
    try:
        content = await file.read()
        if filename.endswith(".pdf"):
            import pypdf
            import io
            pdf_reader = pypdf.PdfReader(io.BytesIO(content))
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        else:
            text = content.decode("utf-8", errors="ignore")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")
        
    if not text.strip():
        raise HTTPException(status_code=400, detail="No readable text found in the CV file.")

    # 2. Call Gemini to extract skills
    try:
        from app.agents.agent import get_llm
        from langchain_core.messages import SystemMessage, HumanMessage
        import json
        
        llm = get_llm()
        system_prompt = (
            "You are a professional HR assistant and technical recruiter.\n"
            "Your task is to analyze the provided CV text and extract:\n"
            "1. A flat list of technical skills and programming languages (e.g. React, Python, PostgreSQL, TypeScript, Git).\n"
            "2. A suggested username for this candidate. The username must be all lowercase, start with the role prefix (e.g., 'dev_' for developers, 'qa_' for QA, 'pm_' for project managers) if you can infer the role, followed by their name or part of it, using only alphanumeric characters and underscores (e.g., 'dev_john_doe', 'qa_sarah'). If the role cannot be determined, default to 'dev_'.\n"
            "\n"
            "Respond ONLY with a JSON object conforming to the schema:\n"
            "{\n"
            "  \"skills\": [\"React\", \"Python\", \"SQL\"],\n"
            "  \"username\": \"dev_john_doe\"\n"
            "}\n"
            "Do not include markdown formatting, markdown code blocks, or introduction. Return ONLY the raw JSON object."
        )
        
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"CV Text:\n{text}")
        ])
        
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
            
        result_data = json.loads(content.strip())
        if not isinstance(result_data, dict):
            raise ValueError("LLM did not return a dictionary")
            
        skills_list = result_data.get("skills", [])
        username = result_data.get("username", "")
        
        return {
            "skills": ", ".join(skills_list),
            "username": username,
            "raw_text": text
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {str(e)}")


