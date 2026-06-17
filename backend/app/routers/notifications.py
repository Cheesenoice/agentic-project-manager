from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models.models import Notification
from app.schemas.schemas import NotificationResponse
from typing import List

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

@router.get("/", response_model=List[NotificationResponse])
async def list_notifications(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Notification).order_by(Notification.created_at.desc()))
    return result.scalars().all()

@router.put("/{notification_id}/read", response_model=NotificationResponse)
async def mark_as_read(notification_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Notification).filter(Notification.id == notification_id))
    db_notif = result.scalar_one_or_none()
    if not db_notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    db_notif.is_read = True
    await db.commit()
    await db.refresh(db_notif)
    return db_notif
