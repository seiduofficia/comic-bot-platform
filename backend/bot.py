import os
import io
import zipfile
import json
import logging
from typing import Optional, List
from datetime import datetime
import sys
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ComicTelegramBot")

UPLOAD_DIR = "/root/comic-bot-platform/data/uploads"

def get_base_web_url() -> str:
    url = db.get_bot_config("site_url", "http://localhost:8000")
    return url.rstrip('/')

def process_zip_chapter(comic_id: int, chapter_num: float, chapter_title: str, zip_bytes: bytes) -> dict:
    comic = db.get_comic_by_id_or_slug(str(comic_id))
    if not comic:
        raise ValueError(f"Comic with ID {comic_id} not found.")

    comic_slug = comic["slug"]
    ch_dir = os.path.join(UPLOAD_DIR, "comics", comic_slug, f"ch_{chapter_num}")
    os.makedirs(ch_dir, exist_ok=True)

    page_urls = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        # Filter image files
        valid_exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
        file_list = [f for f in z.namelist() if not f.startswith('__MACOSX') and f.lower().endswith(valid_exts)]
        file_list.sort() # alphabetical sort preserves 01.jpg, 02.jpg, etc.

        for idx, filename in enumerate(file_list, start=1):
            file_data = z.read(filename)
            ext = os.path.splitext(filename)[1].lower()
            out_name = f"page_{idx:03d}{ext}"
            out_path = os.path.join(ch_dir, out_name)
            with open(out_path, "wb") as f_out:
                f_out.write(file_data)
            page_urls.append(f"/uploads/comics/{comic_slug}/ch_{chapter_num}/{out_name}")

    if not page_urls:
        raise ValueError("No valid image files (.jpg, .png, .webp) found in the ZIP archive.")

    chapter = db.create_chapter(comic_id, chapter_num, chapter_title, page_urls)
    return chapter

def save_single_comic_cover(comic_id: int, image_bytes: bytes, filename: str = "cover.jpg") -> str:
    comic = db.get_comic_by_id_or_slug(str(comic_id))
    if not comic:
        raise ValueError("Comic not found")
    
    os.makedirs(f"{UPLOAD_DIR}/covers", exist_ok=True)
    ext = os.path.splitext(filename)[1].lower() or ".jpg"
    safe_name = f"cover_{comic['slug']}{ext}"
    cover_path = os.path.join(f"{UPLOAD_DIR}/covers", safe_name)
    with open(cover_path, "wb") as f:
        f.write(image_bytes)
    
    cover_url = f"/uploads/covers/{safe_name}"
    db.update_comic(comic_id, cover_url=cover_url, banner_url=cover_url)
    return cover_url

def save_chapter_page_image(comic_id: int, chapter_num: float, page_bytes: bytes, page_num: int) -> str:
    comic = db.get_comic_by_id_or_slug(str(comic_id))
    if not comic:
        raise ValueError("Comic not found")
    
    comic_slug = comic["slug"]
    ch_dir = os.path.join(UPLOAD_DIR, "comics", comic_slug, f"ch_{chapter_num}")
    os.makedirs(ch_dir, exist_ok=True)

    out_name = f"page_{page_num:03d}.jpg"
    out_path = os.path.join(ch_dir, out_name)
    with open(out_path, "wb") as f:
        f.write(page_bytes)
    
    return f"/uploads/comics/{comic_slug}/ch_{chapter_num}/{out_name}"

# Telegram Bot Message Handler Logic (works for both Real Telegram and Web Simulator)
def handle_bot_command(user_id: int, username: str, first_name: str, text: str, 
                       file_bytes: Optional[bytes] = None, file_name: Optional[str] = None) -> dict:
    """
    Processes an incoming message/command and returns:
    {
        "text": str,
        "reply_markup": Optional[dict],
        "state": str
    }
    """
    user = db.get_or_create_tg_user(user_id, username, first_name)
    is_admin = db.is_tg_admin(user_id)
    state = user["state"]
    state_data = user["state_data"]
    cmd = (text or "").strip()
    base_url = get_base_web_url()

    # Cancel command resets state
    if cmd.lower() in ["/cancel", "cancel"]:
        db.update_tg_user_state(user_id, "idle", {})
        return {
            "text": "❌ Action cancelled. Returned to main menu. Use /help to see available commands.",
            "state": "idle"
        }

    # Elevate to admin with secret key
    if cmd.startswith("/setadmin"):
        parts = cmd.split(maxsplit=1)
        secret = parts[1].strip() if len(parts) > 1 else ""
        expected_secret = db.get_bot_config("admin_secret", "comicadmin123")
        if secret == expected_secret:
            db.set_tg_user_admin(user_id, True)
            return {
                "text": "👑 **Success! You are now authenticated as an Administrator!**\n\nYou can now use /newcomic and /addchapter to publish comics to the site.",
                "state": "idle"
            }
        else:
            return {
                "text": "⚠️ Invalid secret key. Usage: `/setadmin <admin_secret>` (Default secret is `comicadmin123` or check web settings).",
                "state": state
            }

    # /start command
    if cmd.startswith("/start"):
        db.update_tg_user_state(user_id, "idle", {})
        admin_badge = "👑 Admin" if is_admin else "👤 Reader"
        welcome_text = (
            f"👋 Welcome to **{db.get_bot_config('site_name', 'OmniComics')} Publisher Bot**!\n\n"
            f"• **User ID**: `{user_id}`\n"
            f"• **Status**: {admin_badge}\n"
            f"• **Web Reader**: {base_url}\n\n"
            "**Available Actions:**\n"
            "📖 `/comics` - List all published comics\n"
            "📊 `/stats` - View readership & comic stats\n"
        )
        if is_admin:
            welcome_text += (
                "➕ `/newcomic` - Create a new comic series\n"
                "📤 `/addchapter` - Upload & publish a chapter (images or ZIP)\n"
                "⚡ `/quickadd <Title> | <Ch#>` - Quick chapter creator\n"
            )
        else:
            welcome_text += (
                "\n💡 *Are you the admin?* Send `/setadmin <secret>` (Default: `comicadmin123`) to unlock publisher privileges!"
            )
        return {
            "text": welcome_text,
            "state": "idle",
            "options": ["/comics", "/stats", "/newcomic", "/addchapter"] if is_admin else ["/comics", "/stats"]
        }

    # /help command
    if cmd.startswith("/help"):
        help_text = (
            "📖 **Bot Command Reference**:\n\n"
            "• `/comics` - View library of published comics with links\n"
            "• `/stats` - Check platform statistics\n"
            "• `/setadmin <secret>` - Claim admin privileges\n"
        )
        if is_admin:
            help_text += (
                "\n**Admin Publishing Commands:**\n"
                "• `/newcomic` - Step-by-step comic creator with cover upload\n"
                "• `/addchapter` - Select comic & upload pages (as photos or ZIP archive)\n"
                "• `/cancel` - Abort current upload or creation session"
            )
        return {"text": help_text, "state": state}

    # /stats command
    if cmd.startswith("/stats"):
        stats = db.get_stats()
        text_out = (
            "📊 **Comic Platform Statistics**\n\n"
            f"📚 Total Comics: **{stats['comics']}**\n"
            f"📑 Total Chapters: **{stats['chapters']}**\n"
            f"🖼️ Total Pages: **{stats['pages']}**\n"
            f"👀 Total Views: **{stats['views']}**\n"
            f"👥 Telegram Users: **{stats['telegram_users']}**\n\n"
            f"🔗 Web Reader: {base_url}"
        )
        return {"text": text_out, "state": state}

    # /comics command
    if cmd.startswith("/comics") or cmd.startswith("/list"):
        comics = db.get_all_comics()
        if not comics:
            return {"text": "📚 No comics published yet! Use `/newcomic` to add the first one.", "state": state}
        
        lines = ["📚 **Published Comics Directory:**\n"]
        for c in comics:
            latest = c['latest_chapter'] or 0
            lines.append(
                f"• **[#{c['id']}] {c['title']}**\n"
                f"  Chapters: {c['total_chapters']} (Latest: Ch. {latest})\n"
                f"  Genres: {', '.join(c['genres'][:3])}\n"
                f"  🔗 [Read on Web]({base_url}/#comic/{c['slug']})\n"
            )
        return {"text": "\n".join(lines), "state": state}

    # State Machine Handling:
    # 1) NEW COMIC CREATION
    if cmd.startswith("/newcomic"):
        if not is_admin:
            return {"text": "🚫 Access Denied: You must be an administrator. Use `/setadmin <secret>`.", "state": state}
        db.update_tg_user_state(user_id, "awaiting_newcomic_title", {})
        return {
            "text": "✨ **Creating a New Comic Series**\n\nPlease enter the **Title** of the comic (or type `/cancel` to abort):",
            "state": "awaiting_newcomic_title"
        }

    if state == "awaiting_newcomic_title":
        title = cmd.strip()
        if len(title) < 2:
            return {"text": "⚠️ Title is too short. Please enter a valid comic title:", "state": state}
        db.update_tg_user_state(user_id, "awaiting_newcomic_desc", {"title": title})
        return {
            "text": f"✅ Title set: **{title}**\n\nNow enter a short **Description / Synopsis**:",
            "state": "awaiting_newcomic_desc"
        }

    if state == "awaiting_newcomic_desc":
        desc = cmd.strip()
        state_data["description"] = desc
        db.update_tg_user_state(user_id, "awaiting_newcomic_genres", state_data)
        return {
            "text": "✅ Description saved.\n\nEnter genres separated by commas (e.g. `Action, Fantasy, Adventure`):",
            "state": "awaiting_newcomic_genres"
        }

    if state == "awaiting_newcomic_genres":
        genres = [g.strip() for g in cmd.split(",") if g.strip()] or ["Action", "Fantasy"]
        state_data["genres"] = genres
        db.update_tg_user_state(user_id, "awaiting_newcomic_cover", state_data)
        return {
            "text": (
                f"✅ Genres set to: {', '.join(genres)}\n\n"
                "🖼️ **Almost done! Please send a cover photo/image for this comic.**\n"
                "(Or type `skip` to use a default generated cover)."
            ),
            "state": "awaiting_newcomic_cover"
        }

    if state == "awaiting_newcomic_cover":
        title = state_data.get("title", "Untitled")
        desc = state_data.get("description", "")
        genres = state_data.get("genres", ["Action"])

        cover_url = ""
        if file_bytes:
            # Create comic first to get ID
            comic = db.create_comic(title=title, description=desc, genres=genres, cover_url="")
            cover_url = save_single_comic_cover(comic["id"], file_bytes, file_name or "cover.jpg")
        else:
            if cmd.lower() != "skip":
                return {"text": "Please upload an image for the cover, or type `skip`.", "state": state}
            comic = db.create_comic(title=title, description=desc, genres=genres, cover_url="/uploads/covers/cover_shadow-sovereign.jpg")

        db.update_tg_user_state(user_id, "idle", {})
        return {
            "text": (
                f"🎉 **Comic '{comic['title']}' created successfully!**\n\n"
                f"• ID: `{comic['id']}`\n"
                f"• Slug: `{comic['slug']}`\n"
                f"• Genres: {', '.join(comic['genres'])}\n\n"
                f"🔗 View on Web: {base_url}/#comic/{comic['slug']}\n\n"
                f"👉 Use `/addchapter` to upload Chapter 1 now!"
            ),
            "state": "idle"
        }

    # 2) ADD CHAPTER WORKFLOW
    if cmd.startswith("/addchapter"):
        if not is_admin:
            return {"text": "🚫 Access Denied: You must be an administrator.", "state": state}
        
        comics = db.get_all_comics()
        if not comics:
            return {"text": "⚠️ No comics exist yet. Create one first with `/newcomic`.", "state": state}
        
        msg = "📑 **Select which Comic to add a chapter to:**\n\nEnter the **Comic ID** number from the list below:\n\n"
        for c in comics:
            msg += f"• **#{c['id']}** : {c['title']} (Latest: Ch. {c['latest_chapter'] or 0})\n"
        
        db.update_tg_user_state(user_id, "awaiting_chapter_comic_id", {})
        return {"text": msg, "state": "awaiting_chapter_comic_id"}

    if state == "awaiting_chapter_comic_id":
        if not cmd.isdigit():
            return {"text": "⚠️ Please enter a numeric Comic ID (e.g. 1, 2, 3):", "state": state}
        comic_id = int(cmd)
        comic = db.get_comic_by_id_or_slug(str(comic_id))
        if not comic:
            return {"text": f"⚠️ Comic with ID #{comic_id} not found. Please enter a valid ID:", "state": state}
        
        suggested_num = (comic['latest_chapter'] or 0) + 1
        db.update_tg_user_state(user_id, "awaiting_chapter_number", {"comic_id": comic_id, "comic_title": comic["title"]})
        return {
            "text": (
                f"Selected: **{comic['title']}**\n\n"
                f"Enter the **Chapter Number** (suggested: `{suggested_num}` or e.g. `1`, `2.5`):"
            ),
            "state": "awaiting_chapter_number"
        }

    if state == "awaiting_chapter_number":
        try:
            ch_num = float(cmd)
        except ValueError:
            return {"text": "⚠️ Invalid number. Please enter a number like `1`, `2`, `3.5`:", "state": state}
        
        state_data["chapter_number"] = ch_num
        db.update_tg_user_state(user_id, "awaiting_chapter_title", state_data)
        return {
            "text": f"Chapter number set to **{ch_num}**.\n\nEnter an optional **Chapter Title** (or type `skip`):",
            "state": "awaiting_chapter_title"
        }

    if state == "awaiting_chapter_title":
        ch_title = "" if cmd.lower() == "skip" else cmd.strip()
        state_data["chapter_title"] = ch_title
        state_data["accumulated_pages"] = []
        db.update_tg_user_state(user_id, "awaiting_chapter_pages", state_data)
        return {
            "text": (
                f"✅ Chapter {state_data['chapter_number']} configured!\n\n"
                "📦 **How to upload pages:**\n"
                "1️⃣ **Best:** Send a `.zip` file containing comic images (`01.jpg`, `02.jpg`, etc.)\n"
                "2️⃣ **Or:** Send photos one-by-one or in an album, then send `/done` when finished.\n\n"
                "Send your file or image now (or `/cancel`):"
            ),
            "state": "awaiting_chapter_pages"
        }

    if state == "awaiting_chapter_pages":
        comic_id = state_data["comic_id"]
        ch_num = state_data["chapter_number"]
        ch_title = state_data["chapter_title"]

        # Check if user sent a ZIP file
        if file_bytes and (file_name and file_name.lower().endswith(('.zip', '.cbz'))):
            try:
                chapter = process_zip_chapter(comic_id, ch_num, ch_title, file_bytes)
                comic = db.get_comic_by_id_or_slug(str(comic_id))
                db.update_tg_user_state(user_id, "idle", {})
                return {
                    "text": (
                        f"🎉 **Chapter Published Successfully!**\n\n"
                        f"• Series: **{comic['title']}**\n"
                        f"• Chapter: **{ch_num}** {f'({ch_title})' if ch_title else ''}\n"
                        f"• Total Pages: **{chapter['pages_count']} pages** extracted & uploaded\n\n"
                        f"📖 Read now: {base_url}/#read/{comic['slug']}/{chapter['id']}"
                    ),
                    "state": "idle"
                }
            except Exception as e:
                logger.error(f"ZIP error: {e}")
                return {"text": f"❌ Error extracting ZIP: {str(e)}. Please check archive format and try again.", "state": state}

        # Check if single image/photo was uploaded
        if file_bytes:
            current_pages = state_data.get("accumulated_pages", [])
            page_index = len(current_pages) + 1
            page_url = save_chapter_page_image(comic_id, ch_num, file_bytes, page_index)
            current_pages.append(page_url)
            state_data["accumulated_pages"] = current_pages
            db.update_tg_user_state(user_id, "awaiting_chapter_pages", state_data)
            return {
                "text": (
                    f"📥 Page #{page_index} received!\n\n"
                    f"Total pages received so far: **{len(current_pages)}**.\n"
                    f"Send the next image, or type `/done` to publish the chapter."
                ),
                "state": "awaiting_chapter_pages"
            }

        # User sent /done
        if cmd.lower() in ["/done", "done"]:
            current_pages = state_data.get("accumulated_pages", [])
            if not current_pages:
                return {"text": "⚠️ No pages were sent yet! Send at least one image or a `.zip` file.", "state": state}
            
            chapter = db.create_chapter(comic_id, ch_num, ch_title, current_pages)
            comic = db.get_comic_by_id_or_slug(str(comic_id))
            db.update_tg_user_state(user_id, "idle", {})
            return {
                "text": (
                    f"🎉 **Chapter Published Successfully!**\n\n"
                    f"• Series: **{comic['title']}**\n"
                    f"• Chapter: **{ch_num}**\n"
                    f"• Total Pages: **{len(current_pages)} pages**\n\n"
                    f"📖 Read now: {base_url}/#read/{comic['slug']}/{chapter['id']}"
                ),
                "state": "idle"
            }

        return {
            "text": "Waiting for comic pages (images or .zip file). Type `/done` when finished, or `/cancel` to abort.",
            "state": state
        }

    # Fallback default
    return {
        "text": f"Command not recognized. Type `/help` for available commands or `/start` to return to menu.",
        "state": state
    }
