const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.COMIC_DB_PATH || path.join(__dirname, '../data/database.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// Helper promise wrappers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'comic';
}

async function initDb() {
  await run(`
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
  `);

  await run(`
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
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      UNIQUE(chapter_id, page_number)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bot_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      is_admin INTEGER DEFAULT 0,
      state TEXT DEFAULT 'idle',
      state_data TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Comic Queries
async function getAllComics(genre = null, search = null, limit = 50) {
  let query = `
    SELECT c.*,
      (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
      (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
    FROM comics c WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (c.title LIKE ? OR c.description LIKE ? OR c.author LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  if (genre && genre.toLowerCase() !== 'all') {
    query += ` AND c.genres LIKE ?`;
    params.push(`%${genre}%`);
  }

  query += ` ORDER BY c.updated_at DESC LIMIT ?`;
  params.push(limit);

  const rows = await all(query, params);
  return rows.map(r => {
    let parsedGenres = [];
    try {
      parsedGenres = JSON.parse(r.genres);
    } catch {
      parsedGenres = (r.genres || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    return { ...r, genres: parsedGenres };
  });
}

async function getComicByIdOrSlug(identifier) {
  let comic;
  if (/^\d+$/.test(String(identifier))) {
    comic = await get(`
      SELECT c.*,
        (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
        (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
      FROM comics c WHERE c.id = ?
    `, [parseInt(identifier)]);
  } else {
    comic = await get(`
      SELECT c.*,
        (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) as total_chapters,
        (SELECT MAX(chapter_number) FROM chapters ch WHERE ch.comic_id = c.id) as latest_chapter
      FROM comics c WHERE c.slug = ?
    `, [identifier]);
  }

  if (!comic) return null;

  try {
    comic.genres = JSON.parse(comic.genres);
  } catch {
    comic.genres = (comic.genres || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  const chapters = await all(`SELECT * FROM chapters WHERE comic_id = ? ORDER BY chapter_number ASC`, [comic.id]);
  comic.chapters = chapters;
  return comic;
}

async function createComic({ title, description = '', author = 'Unknown', genres = ['Action', 'Fantasy'], status = 'Ongoing', cover_url = '', banner_url = '' }) {
  const baseSlug = slugify(title);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await get(`SELECT id FROM comics WHERE slug = ?`, [slug]);
    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }

  const now = new Date().toISOString();
  const genresStr = JSON.stringify(genres || []);
  const res = await run(`
    INSERT INTO comics (slug, title, description, author, artist, genres, status, cover_url, banner_url, views, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `, [slug, title, description, author, author, genresStr, status, cover_url, banner_url, now, now]);

  return getComicByIdOrSlug(res.lastID);
}

async function updateComic(comicId, fields = {}) {
  const allowed = ['title', 'description', 'author', 'artist', 'genres', 'status', 'cover_url', 'banner_url'];
  const updates = [];
  const params = [];

  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      params.push(k === 'genres' && Array.isArray(v) ? JSON.stringify(v) : v);
    }
  }

  if (updates.length === 0) return getComicByIdOrSlug(comicId);

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(comicId);

  await run(`UPDATE comics SET ${updates.join(', ')} WHERE id = ?`, params);
  return getComicByIdOrSlug(comicId);
}

async function deleteComic(comicId) {
  const res = await run(`DELETE FROM comics WHERE id = ?`, [comicId]);
  return res.changes > 0;
}

async function incrementViews(comicId) {
  await run(`UPDATE comics SET views = views + 1 WHERE id = ?`, [comicId]);
}

// Chapter & Page Queries
async function createChapter(comicId, chapterNumber, title = '', pageUrls = []) {
  const now = new Date().toISOString();

  await run(`
    INSERT OR REPLACE INTO chapters (comic_id, chapter_number, title, created_at, pages_count)
    VALUES (?, ?, ?, ?, ?)
  `, [comicId, chapterNumber, title || '', now, pageUrls.length]);

  const chapterRow = await get(`SELECT id FROM chapters WHERE comic_id = ? AND chapter_number = ?`, [comicId, chapterNumber]);
  const chapterId = chapterRow.id;

  await run(`DELETE FROM pages WHERE chapter_id = ?`, [chapterId]);

  for (let i = 0; i < pageUrls.length; i++) {
    await run(`INSERT INTO pages (chapter_id, page_number, image_url) VALUES (?, ?, ?)`, [chapterId, i + 1, pageUrls[i]]);
  }

  await run(`UPDATE comics SET updated_at = ? WHERE id = ?`, [now, comicId]);
  return getChapterWithPages(chapterId);
}

async function getChapterWithPages(chapterId) {
  const chapter = await get(`
    SELECT ch.*, c.title as comic_title, c.slug as comic_slug
    FROM chapters ch
    JOIN comics c ON c.id = ch.comic_id
    WHERE ch.id = ?
  `, [chapterId]);

  if (!chapter) return null;

  const pages = await all(`SELECT page_number, image_url FROM pages WHERE chapter_id = ? ORDER BY page_number ASC`, [chapterId]);
  chapter.pages = pages;

  const prev = await get(`
    SELECT id, chapter_number FROM chapters 
    WHERE comic_id = ? AND chapter_number < ? 
    ORDER BY chapter_number DESC LIMIT 1
  `, [chapter.comic_id, chapter.chapter_number]);

  const next = await get(`
    SELECT id, chapter_number FROM chapters 
    WHERE comic_id = ? AND chapter_number > ? 
    ORDER BY chapter_number ASC LIMIT 1
  `, [chapter.comic_id, chapter.chapter_number]);

  chapter.prev_chapter = prev || null;
  chapter.next_chapter = next || null;

  return chapter;
}

async function deleteChapter(chapterId) {
  const res = await run(`DELETE FROM chapters WHERE id = ?`, [chapterId]);
  return res.changes > 0;
}

// Bot Config
async function getBotConfig(key, defaultVal = '') {
  const row = await get(`SELECT value FROM bot_config WHERE key = ?`, [key]);
  return row ? row.value : defaultVal;
}

async function setBotConfig(key, value) {
  await run(`INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)`, [key, value]);
}

// Telegram User State
async function getOrRegisterTgUser(userId, username = '', firstName = '') {
  let user = await get(`SELECT * FROM telegram_users WHERE user_id = ?`, [userId]);
  if (!user) {
    await run(`
      INSERT INTO telegram_users (user_id, username, first_name, is_admin, state, state_data)
      VALUES (?, ?, ?, 0, 'idle', '{}')
    `, [userId, username || '', firstName || '']);
    user = await get(`SELECT * FROM telegram_users WHERE user_id = ?`, [userId]);
  } else {
    await run(`UPDATE telegram_users SET username = ?, first_name = ? WHERE user_id = ?`, [username || user.username, firstName || user.first_name, userId]);
  }

  try {
    user.state_data = JSON.parse(user.state_data);
  } catch {
    user.state_data = {};
  }
  return user;
}

async function updateTgUserState(userId, state, stateData = null) {
  if (stateData !== null) {
    await run(`UPDATE telegram_users SET state = ?, state_data = ? WHERE user_id = ?`, [state, JSON.stringify(stateData), userId]);
  } else {
    await run(`UPDATE telegram_users SET state = ? WHERE user_id = ?`, [state, userId]);
  }
}

async function setTgUserAdmin(userId, isAdmin) {
  await run(`UPDATE telegram_users SET is_admin = ? WHERE user_id = ?`, [isAdmin ? 1 : 0, userId]);
}

async function isTgAdmin(userId) {
  const adminIdsStr = await getBotConfig('admin_chat_id', '');
  if (adminIdsStr) {
    const ids = adminIdsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (ids.includes(userId)) return true;
  }
  const row = await get(`SELECT is_admin FROM telegram_users WHERE user_id = ?`, [userId]);
  return Boolean(row && row.is_admin);
}

async function getStats() {
  const c = await get(`SELECT COUNT(*) as count FROM comics`);
  const ch = await get(`SELECT COUNT(*) as count FROM chapters`);
  const p = await get(`SELECT COUNT(*) as count FROM pages`);
  const v = await get(`SELECT COALESCE(SUM(views), 0) as total FROM comics`);
  const u = await get(`SELECT COUNT(*) as count FROM telegram_users`);

  return {
    comics: c.count,
    chapters: ch.count,
    pages: p.count,
    views: v.total,
    telegram_users: u.count
  };
}

module.exports = {
  db,
  initDb,
  slugify,
  getAllComics,
  getComicByIdOrSlug,
  createComic,
  updateComic,
  deleteComic,
  incrementViews,
  createChapter,
  getChapterWithPages,
  deleteChapter,
  getBotConfig,
  setBotConfig,
  getOrRegisterTgUser,
  updateTgUserState,
  setTgUserAdmin,
  isTgAdmin,
  getStats
};
