# 📚 OmniComics — Webtoon Reader & Telegram Publisher Platform

A comic / manga / webtoon platform connected to a Telegram publisher bot. Admins can upload comic pages and chapters directly from Telegram (photos or `.zip` archives) or through the web admin panel. Readers enjoy a responsive reader with continuous vertical Webtoon scroll, Manga page flip, favorites, and automatic reading history tracking.

---

## 🌟 Key Features

### 📖 1. Reader Web App
- **Dual Reading Modes**:
  - **Webtoon Mode**: Continuous vertical strip scrolling (standard for Korean webtoons / manhwa).
  - **Manga Mode**: Page-by-page reader with keyboard controls (`←` / `→` or `A` / `D`), touch swipe, and progress tracker.
- **Reading History & "Continue Reading"**: Automatically remembers the exact comic, chapter, and page where the user left off.
- **Favorites & Bookmarks**: One-click hearting of series and manual chapter bookmarking stored persistently.
- **Live Search & Genre Filters**: Instant filtering by Action, Fantasy, Sci-Fi, Cultivation, Supernatural, etc.
- **Preloaded Demos**: Includes 3 complete series (*Shadow Sovereign*, *Celestial Alchemist*, *Neon Drifter 2099*) generated with realistic HD webtoon panel artwork.

### 🤖 2. Telegram Publisher Bot
- **Admin Publishing Flow**:
  - `/newcomic`: Create new series with title, synopsis, genres, and cover photo.
  - `/addchapter`: Select series, specify chapter number/title, and upload pages.
  - **ZIP Archive Support**: Send a `.zip` file of images (`01.jpg`, `02.jpg`, etc.) and the bot automatically extracts and publishes the chapter in order!
  - **Photo Album Support**: Send photos directly in chat, type `/done` to publish.
- **Reader & Community Commands**:
  - `/start`: Welcome menu, Chat ID display, and quick links.
  - `/comics`: List of all published series with direct links to the web reader.
  - `/stats`: Live analytics (total views, comics, chapters, pages).
  - `/setadmin <secret>`: Elevate to admin publisher (default secret: `comicadmin123`).
- **Interactive In-Browser Simulator**:
  - Test all Telegram bot commands and file uploads directly inside the web interface without needing a bot token right away!

---

## 🚀 Quick Start

### 1. Run the Platform
```bash
/root/comic-bot-platform/start.sh
```
Or with custom port:
```bash
PORT=8000 /root/comic-bot-platform/start.sh
```

### 2. Access Web Interface
- **Web App & Reader**: [http://localhost:8000](http://localhost:8000)
- **API Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🤖 Connecting Real Telegram Bot

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`, choose a name and username (e.g. `MyComicReaderBot`).
3. Copy the HTTP API token provided by BotFather (e.g. `123456789:ABCdefGhI...`).
4. In the OmniComics web UI, navigate to the **"Bot & Admin"** tab:
   - Paste your bot token into **Telegram Bot Token**.
   - Click **Save Settings**.
   - Click **Start Bot Polling**.
5. Open your bot on Telegram and send `/start`!
6. To authenticate as admin, send:
   ```text
   /setadmin comicadmin123
   ```
7. You can now use `/newcomic` and `/addchapter` to publish comics to your site directly from Telegram!
