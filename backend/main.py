import os
import io
import shutil
import logging
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import db
import bot
from bot_service import bot_manager

logger = logging.getLogger("ComicApp")
UPLOAD_DIR = "/root/comic-bot-platform/data/uploads"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    db.init_db()
    # Try auto-starting Telegram bot if token exists
    token = bot_manager.get_token()
    if token:
        logger.info("Found Telegram token in database/env, attempting auto-start...")
        res = await bot_manager.start()
        if res.get("success"):
            logger.info(f"Bot @{bot_manager.bot_info.get('username')} started successfully!")
        else:
            logger.warning(f"Could not auto-start Telegram bot: {res.get('error')}")
    yield
    # Shutdown
    if bot_manager.is_running:
        await bot_manager.stop()

app = FastAPI(title="Comic Reader & Telegram Publisher API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class ComicCreateRequest(BaseModel):
    title: str
    description: str = ""
    author: str = "Unknown"
    genres: List[str] = ["Action", "Fantasy"]
    status: str = "Ongoing"
    cover_url: str = ""

class BotConfigRequest(BaseModel):
    telegram_bot_token: Optional[str] = None
    admin_secret: Optional[str] = None
    admin_chat_id: Optional[str] = None
    site_url: Optional[str] = None

# API Routes
@app.get("/api/comics")
def get_comics(genre: Optional[str] = None, search: Optional[str] = None):
    return db.get_all_comics(genre=genre, search=search)

@app.get("/api/comics/{identifier}")
def get_comic(identifier: str):
    comic = db.get_comic_by_id_or_slug(identifier)
    if not comic:
        raise HTTPException(status_code=404, detail="Comic not found")
    return comic

@app.post("/api/comics")
def create_comic_endpoint(req: ComicCreateRequest):
    comic = db.create_comic(
        title=req.title,
        description=req.description,
        author=req.author,
        genres=req.genres,
        status=req.status,
        cover_url=req.cover_url
    )
    return comic

@app.post("/api/comics/{comic_id}/view")
def increment_view(comic_id: int):
    db.increment_views(comic_id)
    return {"success": True}

@app.delete("/api/comics/{comic_id}")
def delete_comic_endpoint(comic_id: int):
    success = db.delete_comic(comic_id)
    if not success:
        raise HTTPException(status_code=404, detail="Comic not found")
    return {"success": True}

@app.get("/api/chapters/{chapter_id}")
def get_chapter(chapter_id: int):
    chapter = db.get_chapter_with_pages(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    # Also record view for the parent comic
    db.increment_views(chapter["comic_id"])
    return chapter

@app.delete("/api/chapters/{chapter_id}")
def delete_chapter_endpoint(chapter_id: int):
    success = db.delete_chapter(chapter_id)
    if not success:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return {"success": True}

# Upload chapter via Web
@app.post("/api/comics/{comic_id}/chapters")
async def upload_chapter_web(
    comic_id: int,
    chapter_number: float = Form(...),
    title: str = Form(""),
    zip_file: Optional[UploadFile] = File(None),
    page_files: Optional[List[UploadFile]] = File(None)
):
    comic = db.get_comic_by_id_or_slug(str(comic_id))
    if not comic:
        raise HTTPException(status_code=404, detail="Comic not found")

    # If ZIP file is uploaded
    if zip_file and zip_file.filename:
        content = await zip_file.read()
        try:
            chapter = bot.process_zip_chapter(comic_id, chapter_number, title, content)
            return chapter
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    # If list of image files are uploaded
    if page_files and len(page_files) > 0:
        comic_slug = comic["slug"]
        ch_dir = os.path.join(UPLOAD_DIR, "comics", comic_slug, f"ch_{chapter_number}")
        os.makedirs(ch_dir, exist_ok=True)
        page_urls = []

        for idx, pf in enumerate(page_files, start=1):
            if not pf.filename:
                continue
            ext = os.path.splitext(pf.filename)[1].lower() or ".jpg"
            out_name = f"page_{idx:03d}{ext}"
            out_path = os.path.join(ch_dir, out_name)
            content = await pf.read()
            with open(out_path, "wb") as f:
                f.write(content)
            page_urls.append(f"/uploads/comics/{comic_slug}/ch_{chapter_number}/{out_name}")

        if not page_urls:
            raise HTTPException(status_code=400, detail="No valid pages uploaded.")

        chapter = db.create_chapter(comic_id, chapter_number, title, page_urls)
        return chapter

    raise HTTPException(status_code=400, detail="Please upload either a ZIP file or individual images.")

# Upload Cover image via Web
@app.post("/api/comics/{comic_id}/cover")
async def upload_cover(comic_id: int, file: UploadFile = File(...)):
    comic = db.get_comic_by_id_or_slug(str(comic_id))
    if not comic:
        raise HTTPException(status_code=404, detail="Comic not found")
    content = await file.read()
    cover_url = bot.save_single_comic_cover(comic_id, content, file.filename or "cover.jpg")
    return {"cover_url": cover_url}

# Stats
@app.get("/api/stats")
def get_stats():
    return db.get_stats()

# Telegram Bot Control
@app.get("/api/bot/status")
def bot_status():
    return bot_manager.get_status()

@app.post("/api/bot/config")
def save_bot_config(req: BotConfigRequest):
    if req.telegram_bot_token is not None:
        db.set_bot_config("telegram_bot_token", req.telegram_bot_token.strip())
    if req.admin_secret is not None:
        db.set_bot_config("admin_secret", req.admin_secret.strip())
    if req.admin_chat_id is not None:
        db.set_bot_config("admin_chat_id", req.admin_chat_id.strip())
    if req.site_url is not None:
        db.set_bot_config("site_url", req.site_url.strip())
    return bot_manager.get_status()

@app.post("/api/bot/start")
async def start_bot():
    res = await bot_manager.start()
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to start bot"))
    return res

@app.post("/api/bot/stop")
async def stop_bot():
    return await bot_manager.stop()

# Telegram Bot Simulator for testing without real Telegram
@app.post("/api/bot/simulate")
async def simulate_bot(
    user_id: int = Form(999999999),
    username: str = Form("SimulatorAdmin"),
    first_name: str = Form("Simulator"),
    text: str = Form(""),
    file: Optional[UploadFile] = File(None)
):
    file_bytes = None
    file_name = None
    if file and file.filename:
        file_bytes = await file.read()
        file_name = file.filename

    res = bot.handle_bot_command(
        user_id=user_id,
        username=username,
        first_name=first_name,
        text=text,
        file_bytes=file_bytes,
        file_name=file_name
    )
    return res

# Static file serving
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs("/root/comic-bot-platform/frontend/static", exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory="/root/comic-bot-platform/frontend/static"), name="static")

@app.get("/")
def index():
    return FileResponse("/root/comic-bot-platform/frontend/index.html")

# Catch-all for SPA deep links
@app.get("/{full_path:path}")
def catch_all(full_path: str):
    if os.path.exists(f"/root/comic-bot-platform/frontend/{full_path}") and os.path.isfile(f"/root/comic-bot-platform/frontend/{full_path}"):
        return FileResponse(f"/root/comic-bot-platform/frontend/{full_path}")
    return FileResponse("/root/comic-bot-platform/frontend/index.html")
