const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const bot = require('./bot');
const { botManager } = require('./botService');

const app = express();
const PORT = process.env.PORT || 8000;
const UPLOAD_DIR = process.env.COMIC_UPLOAD_DIR || path.join(__dirname, '../data/uploads');

// Setup upload directories
fs.mkdirSync(path.join(UPLOAD_DIR, 'covers'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'comics'), { recursive: true });

// Setup Multer storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for chapter zips
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Uploads & Static Frontend
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/static', express.static(path.join(__dirname, '../frontend/static')));

// API ROUTES

// 1. Comics
app.get('/api/comics', async (req, res) => {
  try {
    const { genre, search } = req.query;
    const comics = await db.getAllComics(genre, search);
    res.json(comics);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/comics/:identifier', async (req, res) => {
  try {
    const comic = await db.getComicByIdOrSlug(req.params.identifier);
    if (!comic) return res.status(404).json({ detail: 'Comic not found' });
    res.json(comic);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/comics', async (req, res) => {
  try {
    const { title, description, author, genres, status, cover_url } = req.body;
    if (!title) return res.status(400).json({ detail: 'Title is required' });

    const comic = await db.createComic({
      title,
      description: description || '',
      author: author || 'Unknown',
      genres: Array.isArray(genres) ? genres : ['Action', 'Fantasy'],
      status: status || 'Ongoing',
      cover_url: cover_url || ''
    });
    res.json(comic);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/comics/:id/view', async (req, res) => {
  try {
    await db.incrementViews(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/comics/:id', async (req, res) => {
  try {
    const deleted = await db.deleteComic(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ detail: 'Comic not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 2. Chapters & Pages
app.get('/api/chapters/:id', async (req, res) => {
  try {
    const chapter = await db.getChapterWithPages(parseInt(req.params.id));
    if (!chapter) return res.status(404).json({ detail: 'Chapter not found' });
    await db.incrementViews(chapter.comic_id);
    res.json(chapter);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  try {
    const deleted = await db.deleteChapter(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ detail: 'Chapter not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// Upload Chapter via Web (supports ZIP or multiple image files)
app.post(
  '/api/comics/:comicId/chapters',
  upload.fields([{ name: 'zip_file', maxCount: 1 }, { name: 'page_files', maxCount: 100 }]),
  async (req, res) => {
    try {
      const comicId = parseInt(req.params.comicId);
      const chapterNumber = parseFloat(req.body.chapter_number);
      const title = req.body.title || '';

      const comic = await db.getComicByIdOrSlug(comicId);
      if (!comic) return res.status(404).json({ detail: 'Comic not found' });

      // Handle ZIP file
      if (req.files && req.files['zip_file'] && req.files['zip_file'][0]) {
        const zipFile = req.files['zip_file'][0];
        const chapter = await bot.processZipChapter(comicId, chapterNumber, title, zipFile.buffer);
        return res.json(chapter);
      }

      // Handle multiple images
      if (req.files && req.files['page_files'] && req.files['page_files'].length > 0) {
        const files = req.files['page_files'];
        const chDir = path.join(UPLOAD_DIR, 'comics', comic.slug, `ch_${chapterNumber}`);
        fs.mkdirSync(chDir, { recursive: true });

        const pageUrls = [];
        files.forEach((f, idx) => {
          const ext = path.extname(f.originalname).toLowerCase() || '.jpg';
          const outName = `page_${String(idx + 1).padStart(3, '0')}${ext}`;
          const outPath = path.join(chDir, outName);
          fs.writeFileSync(outPath, f.buffer);
          pageUrls.push(`/uploads/comics/${comic.slug}/ch_${chapterNumber}/${outName}`);
        });

        const chapter = await db.createChapter(comicId, chapterNumber, title, pageUrls);
        return res.json(chapter);
      }

      return res.status(400).json({ detail: 'Please upload either a ZIP file or individual images.' });
    } catch (err) {
      res.status(400).json({ detail: err.message });
    }
  }
);

// Upload Comic Cover
app.post('/api/comics/:comicId/cover', upload.single('file'), async (req, res) => {
  try {
    const comicId = parseInt(req.params.comicId);
    if (!req.file) return res.status(400).json({ detail: 'Image file required' });
    const coverUrl = await bot.saveSingleComicCover(comicId, req.file.buffer, req.file.originalname);
    res.json({ cover_url: coverUrl });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 3. Stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 4. Telegram Bot Management
app.get('/api/bot/status', async (req, res) => {
  try {
    const status = await botManager.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/bot/config', async (req, res) => {
  try {
    const { telegram_bot_token, admin_secret, admin_chat_id, site_url } = req.body;
    if (telegram_bot_token !== undefined) {
      await db.setBotConfig('telegram_bot_token', telegram_bot_token.trim());
    }
    if (admin_secret !== undefined) {
      await db.setBotConfig('admin_secret', admin_secret.trim());
    }
    if (admin_chat_id !== undefined) {
      await db.setBotConfig('admin_chat_id', admin_chat_id.trim());
    }
    if (site_url !== undefined) {
      await db.setBotConfig('site_url', site_url.trim());
    }

    const status = await botManager.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/bot/start', async (req, res) => {
  try {
    const result = await botManager.start();
    if (!result.success) {
      return res.status(400).json({ detail: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/bot/stop', async (req, res) => {
  try {
    const result = await botManager.stop();
    res.json(result);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// 5. Telegram Bot Simulator
app.post('/api/bot/simulate', upload.single('file'), async (req, res) => {
  try {
    const userId = parseInt(req.body.user_id) || 999999999;
    const username = req.body.username || 'SimulatorAdmin';
    const firstName = req.body.first_name || 'Simulator';
    const text = req.body.text || '';

    const fileBuffer = req.file ? req.file.buffer : null;
    const fileName = req.file ? req.file.originalname : null;

    const response = await bot.handleBotCommand({
      userId,
      username,
      firstName,
      text,
      fileBuffer,
      fileName
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ text: `⚠️ Error: ${err.message}` });
  }
});

// Single Page Application Fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Startup
async function startServer() {
  await db.initDb();

  // Try auto-starting Telegram bot if token exists
  const token = await botManager.getToken();
  if (token) {
    console.log('[TelegramBot] Token detected, auto-starting bot...');
    botManager.start().then(r => {
      if (r.success) {
        console.log(`[TelegramBot] Connected as @${r.bot?.username}`);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 Node.js Comic Platform is running on port ${PORT}`);
    console.log(`• Web App: http://localhost:${PORT}`);
    console.log(`• Database: ${path.join(__dirname, '../data/database.db')}`);
    console.log(`====================================================`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
