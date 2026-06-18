# Unused imports removed
from sqlalchemy.future import select
from app.db import async_session
from app.models.models import Task, Notification
from datetime import datetime, timedelta
import asyncio

# Using Asyncio-compatible BackgroundScheduler or AsyncScheduler.
# Since FastAPI runs on asyncio, AsyncIOScheduler is standard.
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

async def check_deadlines_job():
    print("--- Running Background Deadline Checker ---")
    async with async_session() as session:
        # Get tasks that are not done and have a due date
        result = await session.execute(
            select(Task).filter(Task.status != "done", Task.due_date.isnot(None))
        )
        tasks = result.scalars().all()
        now = datetime.utcnow()
        print(f"Scheduler: Found {len(tasks)} active tasks with deadlines. Current UTC: {now}")
        
        for task in tasks:
            print(f"Checking Task ID={task.id}, Title={task.title}, Due={task.due_date}")
            tag = f"@{task.assigned_to.username}" if task.assigned_to else "Unassigned"
            # 1. Overdue check
            if task.due_date < now:
                due_gmt7 = task.due_date + timedelta(hours=7)
                msg = f"Task '{task.title}' is OVERDUE! Assigned to: {tag} (Due: {due_gmt7.strftime('%Y-%m-%d %H:%M')})"
            # 2. Approaching due date check (within 24 hours)
            elif task.due_date <= now + timedelta(hours=24):
                due_gmt7 = task.due_date + timedelta(hours=7)
                msg = f"Task '{task.title}' is due soon! Assigned to: {tag} (Due: {due_gmt7.strftime('%Y-%m-%d %H:%M')})"
            else:
                continue
            
            # Check if notification already exists for this message to prevent duplicates
            notif_result = await session.execute(
                select(Notification).filter(
                    Notification.task_id == task.id,
                    Notification.message == msg
                )
            )
            existing = notif_result.scalar_one_or_none()
            if not existing:
                # Create new alert
                new_notif = Notification(
                    task_id=task.id,
                    message=msg
                )
                session.add(new_notif)
                await session.commit()
                
                # Send telegram message
                from app.services.telegram import send_telegram_message
                await send_telegram_message(f"<b>[DEADLINE ALERT]</b>\n{msg}")

def start_scheduler():
    # Run check every 15 seconds for fast local testing demo
    scheduler.add_job(check_deadlines_job, 'interval', seconds=15, id="check_deadlines")
    scheduler.start()
