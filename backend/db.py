import sqlite3
import json
import os
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get("COMIC_DB_PATH", "/root/comic-bot-platform/data/database.db")

def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-') or 'comic'

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS comics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        author TEXT DEFAULT 'Unknown',
        artist TEXT DEFAULT 'Unknown',
        genres TEXT DEFAULT '["Action", "Fantasy"]',
        status TEXT DEFAULT 'Ongoing',
        cover_url TEXT DEFAULT '',
        banner_url TEXT DEFAULT '',
        views INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comic_id INTEGER NOT NULL,
        chapter_number REAL NOT NULL,
        title TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pages_count INTEGER DEFAULT 0,
        FOREIGN KEY (comic_id) REFERENCES comics(id) ON DELETE CASCADE,
        UNIQUE(comic_id, chapter_number)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        UNIQUE(chapter_id, page_number)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS telegram_users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        is_admin INTEGER DEFAULT 0,
        state TEXT DEFAULT 'idle',
        state_data TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    conn.commit()
    conn.close()

# Comic Operations
def get_all_comics(genre: Optional[str] = None, search: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    query = """
        SELECT c.*, 
            (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
            (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
        FROM comics c WHERE 1=1
    """
    params = []

    if search:
        query += " AND (c.title LIKE ? OR c.description LIKE ? OR c.author LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s])

    if genre and genre.lower() != "all":
        query += " AND c.genres LIKE ?"
        params.append(f"%{genre}%")

    query += " ORDER BY c.updated_at DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    comics = []
    for r in rows:
        d = dict(r)
        try:
            d["genres"] = json.loads(d["genres"]) if d["genres"] else []
        except Exception:
            d["genres"] = [g.strip() for g in (d["genres"] or "").split(",") if g.strip()]
        comics.append(d)
    conn.close()
    return comics

def get_comic_by_id_or_slug(identifier: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    if identifier.isdigit():
        cursor.execute("""
            SELECT c.*,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
                (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
            FROM comics c WHERE c.id = ?
        """, (int(identifier),))
    else:
        cursor.execute("""
            SELECT c.*,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
                (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
            FROM comics c WHERE c.slug = ?
        """, (identifier,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    
    d = dict(row)
    try:
        d["genres"] = json.loads(d["genres"]) if d["genres"] else []
    except Exception:
        d["genres"] = [g.strip() for g in (d["genres"] or "").split(",") if g.strip()]
    
    # Fetch chapters
    cursor.execute("""
        SELECT * FROM chapters WHERE comic_id = ? ORDER BY chapter_number ASC
    """, (d["id"],))
    chapters = [dict(ch) for ch in cursor.fetchall()]
    d["chapters"] = chapters

    conn.close()
    return d

def create_comic(title: str, description: str = "", author: str = "Unknown", 
                 genres: List[str] = None, status: str = "Ongoing", 
                 cover_url: str = "", banner_url: str = "") -> Dict[str, Any]:
    if genres is None:
        genres = ["Action", "Adventure"]
    
    conn = get_connection()
    cursor = conn.cursor()
    base_slug = slugify(title)
    slug = base_slug
    counter = 1
    while True:
        cursor.execute("SELECT id FROM comics WHERE slug = ?", (slug,))
        if not cursor.fetchone():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    genres_str = json.dumps(genres)
    now = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO comics (slug, title, description, author, artist, genres, status, cover_url, banner_url, views, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    """, (slug, title, description, author, author, genres_str, status, cover_url, banner_url, now, now))
    comic_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_comic_by_id_or_slug(str(comic_id))

def update_comic(comic_id: int, **fields) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    allowed = ["title", "description", "author", "artist", "genres", "status", "cover_url", "banner_url"]
    updates = []
    params = []
    for k, v in fields.items():
        if k in allowed:
            if k == "genres" and isinstance(v, list):
                v = json.dumps(v)
            updates.append(f"{k} = ?")
            params.append(v)
    if not updates:
        conn.close()
        return get_comic_by_id_or_slug(str(comic_id))
    
    updates.append("updated_at = ?")
    params.append(datetime.now().isoformat())
    params.append(comic_id)

    query = f"UPDATE comics SET {', '.join(updates)} WHERE id = ?"
    cursor.execute(query, params)
    conn.commit()
    conn.close()
    return get_comic_by_id_or_slug(str(comic_id))

def delete_comic(comic_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM comics WHERE id = ?", (comic_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def increment_views(comic_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE comics SET views = views + 1 WHERE id = ?", (comic_id,))
    conn.commit()
    conn.close()

# Chapter & Page Operations
def create_chapter(comic_id: int, chapter_number: float, title: str = "", pages_urls: List[str] = None) -> Dict[str, Any]:
    if pages_urls is None:
        pages_urls = []
    conn = get_connection()
    cursor = conn.cursor()
    
    now = datetime.now().isoformat()
    cursor.execute("""
        INSERT OR REPLACE INTO chapters (comic_id, chapter_number, title, created_at, pages_count)
        VALUES (?, ?, ?, ?, ?)
    """, (comic_id, chapter_number, title, now, len(pages_urls)))
    chapter_id = cursor.lastrowid

    # If it was replaced, query the existing chapter_id
    if not chapter_id:
        cursor.execute("SELECT id FROM chapters WHERE comic_id = ? AND chapter_number = ?", (comic_id, chapter_number))
        row = cursor.fetchone()
        if row:
            chapter_id = row["id"]

    cursor.execute("DELETE FROM pages WHERE chapter_id = ?", (chapter_id,))
    for idx, page_url in enumerate(pages_urls, start=1):
        cursor.execute("""
            INSERT INTO pages (chapter_id, page_number, image_url)
            VALUES (?, ?, ?)
        """, (chapter_id, idx, page_url))

    cursor.execute("UPDATE comics SET updated_at = ? WHERE id = ?", (now, comic_id))
    conn.commit()
    conn.close()
    return get_chapter_with_pages(chapter_id)

def get_chapter_with_pages(chapter_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ch.*, c.title as comic_title, c.slug as comic_slug
        FROM chapters ch
        JOIN comics c ON c.id = ch.comic_id
        WHERE ch.id = ?
    """, (chapter_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    chapter = dict(row)

    cursor.execute("""
        SELECT page_number, image_url FROM pages WHERE chapter_id = ? ORDER BY page_number ASC
    """, (chapter_id,))
    chapter["pages"] = [dict(p) for p in cursor.fetchall()]

    # Navigation: previous and next chapter IDs
    cursor.execute("""
        SELECT id, chapter_number FROM chapters 
        WHERE comic_id = ? AND chapter_number < ? 
        ORDER BY chapter_number DESC LIMIT 1
    """, (chapter["comic_id"], chapter["chapter_number"]))
    prev_row = cursor.fetchone()
    chapter["prev_chapter"] = dict(prev_row) if prev_row else None

    cursor.execute("""
        SELECT id, chapter_number FROM chapters 
        WHERE comic_id = ? AND chapter_number > ? 
        ORDER BY chapter_number ASC LIMIT 1
    """, (chapter["comic_id"], chapter["chapter_number"]))
    next_row = cursor.fetchone()
    chapter["next_chapter"] = dict(next_row) if next_row else None

    conn.close()
    return chapter

def get_chapter_by_comic_and_number(comic_id: int, chapter_num: float) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM chapters WHERE comic_id = ? AND chapter_number = ?", (comic_id, chapter_num))
    row = cursor.fetchone()
    conn.close()
    if row:
        return get_chapter_with_pages(row["id"])
    return None

def delete_chapter(chapter_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

# Bot & Admin Settings
def get_bot_config(key: str, default: str = "") -> str:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM bot_config WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default

def set_bot_config(key: str, value: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()

def get_all_bot_configs() -> Dict[str, str]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM bot_config")
    rows = cursor.fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}

# Telegram User Session State
def get_or_create_tg_user(user_id: int, username: str = "", first_name: str = "") -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM telegram_users WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        cursor.execute("""
            INSERT INTO telegram_users (user_id, username, first_name, is_admin, state, state_data)
            VALUES (?, ?, ?, 0, 'idle', '{}')
        """, (user_id, username or "", first_name or ""))
        conn.commit()
        cursor.execute("SELECT * FROM telegram_users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
    else:
        # update username / firstname if changed
        cursor.execute("UPDATE telegram_users SET username = ?, first_name = ? WHERE user_id = ?", 
                       (username or row["username"], first_name or row["first_name"], user_id))
        conn.commit()
    d = dict(row)
    try:
        d["state_data"] = json.loads(d["state_data"])
    except Exception:
        d["state_data"] = {}
    conn.close()
    return d

def update_tg_user_state(user_id: int, state: str, state_data: Optional[Dict[str, Any]] = None):
    conn = get_connection()
    cursor = conn.cursor()
    if state_data is not None:
        cursor.execute("""
            UPDATE telegram_users SET state = ?, state_data = ? WHERE user_id = ?
        """, (state, json.dumps(state_data), user_id))
    else:
        cursor.execute("UPDATE telegram_users SET state = ? WHERE user_id = ?", (state, user_id))
    conn.commit()
    conn.close()

def set_tg_user_admin(user_id: int, is_admin: bool):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE telegram_users SET is_admin = ? WHERE user_id = ?", (1 if is_admin else 0, user_id))
    conn.commit()
    conn.close()

def is_tg_admin(user_id: int) -> bool:
    admin_id_str = get_bot_config("admin_chat_id", "")
    if admin_id_str:
        admin_ids = [int(i.strip()) for i in admin_id_str.split(",") if i.strip().isdigit()]
        if user_id in admin_ids:
            return True
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT is_admin FROM telegram_users WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return bool(row and row["is_admin"])

def get_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as count FROM comics")
    total_comics = cursor.fetchone()["count"]
    cursor.execute("SELECT COUNT(*) as count FROM chapters")
    total_chapters = cursor.fetchone()["count"]
    cursor.execute("SELECT COUNT(*) as count FROM pages")
    total_pages = cursor.fetchone()["count"]
    cursor.execute("SELECT COALESCE(SUM(views), 0) as total FROM comics")
    total_views = cursor.fetchone()["total"]
    cursor.execute("SELECT COUNT(*) as count FROM telegram_users")
    total_users = cursor.fetchone()["count"]
    conn.close()
    return {
        "comics": total_comics,
        "chapters": total_chapters,
        "pages": total_pages,
        "views": total_views,
        "telegram_users": total_users
    }
