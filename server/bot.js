const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const db = require('./db');

const UPLOAD_DIR = process.env.COMIC_UPLOAD_DIR || path.join(__dirname, '../data/uploads');

async function getBaseWebUrl() {
  const url = await db.getBotConfig('site_url', 'http://localhost:8000');
  return url.replace(/\/+$/, '');
}

async function processZipChapter(comicId, chapterNum, chapterTitle, zipBuffer) {
  const comic = await db.getComicByIdOrSlug(comicId);
  if (!comic) throw new Error(`Comic with ID ${comicId} not found.`);

  const comicSlug = comic.slug;
  const chDir = path.join(UPLOAD_DIR, 'comics', comicSlug, `ch_${chapterNum}`);
  fs.mkdirSync(chDir, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();

  const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const imageEntries = zipEntries.filter(entry => {
    if (entry.isDirectory) return false;
    if (entry.entryName.startsWith('__MACOSX')) return false;
    const ext = path.extname(entry.entryName).toLowerCase();
    return validExts.includes(ext);
  });

  // Sort alphabetically so 01.jpg, 02.jpg stay in order
  imageEntries.sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  if (imageEntries.length === 0) {
    throw new Error('No valid image files (.jpg, .png, .webp) found in the ZIP archive.');
  }

  const pageUrls = [];
  imageEntries.forEach((entry, idx) => {
    const ext = path.extname(entry.entryName).toLowerCase() || '.jpg';
    const outName = `page_${String(idx + 1).padStart(3, '0')}${ext}`;
    const outPath = path.join(chDir, outName);
    fs.writeFileSync(outPath, entry.getData());
    pageUrls.push(`/uploads/comics/${comicSlug}/ch_${chapterNum}/${outName}`);
  });

  const chapter = await db.createChapter(comicId, chapterNum, chapterTitle, pageUrls);
  return chapter;
}

async function saveSingleComicCover(comicId, fileBuffer, fileName = 'cover.jpg') {
  const comic = await db.getComicByIdOrSlug(comicId);
  if (!comic) throw new Error('Comic not found');

  const coversDir = path.join(UPLOAD_DIR, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });

  const ext = path.extname(fileName).toLowerCase() || '.jpg';
  const safeName = `cover_${comic.slug}${ext}`;
  const coverPath = path.join(coversDir, safeName);
  fs.writeFileSync(coverPath, fileBuffer);

  const coverUrl = `/uploads/covers/${safeName}`;
  await db.updateComic(comicId, { cover_url: coverUrl, banner_url: coverUrl });
  return coverUrl;
}

async function saveChapterPageImage(comicId, chapterNum, fileBuffer, pageNum) {
  const comic = await db.getComicByIdOrSlug(comicId);
  if (!comic) throw new Error('Comic not found');

  const chDir = path.join(UPLOAD_DIR, 'comics', comic.slug, `ch_${chapterNum}`);
  fs.mkdirSync(chDir, { recursive: true });

  const outName = `page_${String(pageNum).padStart(3, '0')}.jpg`;
  const outPath = path.join(chDir, outName);
  fs.writeFileSync(outPath, fileBuffer);

  return `/uploads/comics/${comic.slug}/ch_${chapterNum}/${outName}`;
}

// Telegram Message Dispatcher
async function handleBotCommand({ userId, username = '', firstName = '', text = '', fileBuffer = null, fileName = null }) {
  const user = await db.getOrRegisterTgUser(userId, username, firstName);
  const isAdmin = await db.isTgAdmin(userId);
  const state = user.state;
  const stateData = user.state_data || {};
  const cmd = (text || '').trim();
  const baseUrl = await getBaseWebUrl();

  // Cancel command
  if (cmd.toLowerCase() === '/cancel' || cmd.toLowerCase() === 'cancel') {
    await db.updateTgUserState(userId, 'idle', {});
    return {
      text: '❌ Action cancelled. Returned to main menu. Use /help to see available commands.',
      state: 'idle'
    };
  }

  // Set admin with secret
  if (cmd.startsWith('/setadmin')) {
    const parts = cmd.split(/\s+/);
    const secret = parts[1] ? parts[1].trim() : '';
    const expectedSecret = await db.getBotConfig('admin_secret', 'comicadmin123');

    if (secret === expectedSecret) {
      await db.setTgUserAdmin(userId, true);
      return {
        text: '👑 **Success! You are now authenticated as an Administrator!**\n\nYou can now use /newcomic and /addchapter to publish comics to the site.',
        state: 'idle'
      };
    } else {
      return {
        text: '⚠️ Invalid secret key. Usage: `/setadmin <admin_secret>` (Default secret is `comicadmin123` or check web settings).',
        state: state
      };
    }
  }

  // /start
  if (cmd.startsWith('/start')) {
    await db.updateTgUserState(userId, 'idle', {});
    const adminBadge = isAdmin ? '👑 Admin' : '👤 Reader';
    const siteName = await db.getBotConfig('site_name', 'OmniComics Webtoon');

    let welcomeText = (
      `👋 Welcome to **${siteName} Publisher Bot**!\n\n` +
      `• **User ID**: \`${userId}\`\n` +
      `• **Status**: ${adminBadge}\n` +
      `• **Web Reader**: ${baseUrl}\n\n` +
      `**Available Actions:**\n` +
      `📖 \`/comics\` - List all published comics\n` +
      `📊 \`/stats\` - View readership & comic stats\n`
    );

    if (isAdmin) {
      welcomeText += (
        `➕ \`/newcomic\` - Create a new comic series\n` +
        `📤 \`/addchapter\` - Upload & publish a chapter (images or ZIP)\n`
      );
    } else {
      welcomeText += (
        `\n💡 *Are you the admin?* Send \`/setadmin <secret>\` (Default: \`comicadmin123\`) to unlock publisher privileges!`
      );
    }

    return {
      text: welcomeText,
      state: 'idle',
      options: isAdmin ? ['/comics', '/stats', '/newcomic', '/addchapter'] : ['/comics', '/stats']
    };
  }

  // /help
  if (cmd.startsWith('/help')) {
    let helpText = (
      `📖 **Bot Command Reference**:\n\n` +
      `• \`/comics\` - View library of published comics with links\n` +
      `• \`/stats\` - Check platform statistics\n` +
      `• \`/setadmin <secret>\` - Claim admin privileges\n`
    );
    if (isAdmin) {
      helpText += (
        `\n**Admin Publishing Commands:**\n` +
        `• \`/newcomic\` - Step-by-step comic creator with cover upload\n` +
        `• \`/addchapter\` - Select comic & upload pages (as photos or ZIP archive)\n` +
        `• \`/cancel\` - Abort current upload or creation session`
      );
    }
    return { text: helpText, state };
  }

  // /stats
  if (cmd.startsWith('/stats')) {
    const stats = await db.getStats();
    return {
      text: (
        `📊 **Comic Platform Statistics**\n\n` +
        `📚 Total Comics: **${stats.comics}**\n` +
        `📑 Total Chapters: **${stats.chapters}**\n` +
        `🖼️ Total Pages: **${stats.pages}**\n` +
        `👀 Total Views: **${stats.views}**\n` +
        `👥 Telegram Users: **${stats.telegram_users}**\n\n` +
        `🔗 Web Reader: ${baseUrl}`
      ),
      state
    };
  }

  // /comics
  if (cmd.startsWith('/comics') || cmd.startsWith('/list')) {
    const comics = await db.getAllComics();
    if (!comics.length) {
      return { text: '📚 No comics published yet! Use `/newcomic` to add the first one.', state };
    }

    const lines = ['📚 **Published Comics Directory:**\n'];
    for (const c of comics) {
      const latest = c.latest_chapter || 0;
      lines.push(
        `• **[#${c.id}] ${c.title}**\n` +
        `  Chapters: ${c.total_chapters} (Latest: Ch. ${latest})\n` +
        `  Genres: ${c.genres.slice(0, 3).join(', ')}\n` +
        `  🔗 [Read on Web](${baseUrl}/#comic/${c.slug})\n`
      );
    }
    return { text: lines.join('\n'), state };
  }

  // 1) NEW COMIC CREATION
  if (cmd.startsWith('/newcomic')) {
    if (!isAdmin) {
      return { text: '🚫 Access Denied: You must be an administrator. Use `/setadmin <secret>`.', state };
    }
    await db.updateTgUserState(userId, 'awaiting_newcomic_title', {});
    return {
      text: '✨ **Creating a New Comic Series**\n\nPlease enter the **Title** of the comic (or type `/cancel` to abort):',
      state: 'awaiting_newcomic_title'
    };
  }

  if (state === 'awaiting_newcomic_title') {
    const title = cmd.trim();
    if (title.length < 2) {
      return { text: '⚠️ Title is too short. Please enter a valid comic title:', state };
    }
    await db.updateTgUserState(userId, 'awaiting_newcomic_desc', { title });
    return {
      text: `✅ Title set: **${title}**\n\nNow enter a short **Description / Synopsis**:`,
      state: 'awaiting_newcomic_desc'
    };
  }

  if (state === 'awaiting_newcomic_desc') {
    stateData.description = cmd.trim();
    await db.updateTgUserState(userId, 'awaiting_newcomic_genres', stateData);
    return {
      text: '✅ Description saved.\n\nEnter genres separated by commas (e.g. `Action, Fantasy, Adventure`):',
      state: 'awaiting_newcomic_genres'
    };
  }

  if (state === 'awaiting_newcomic_genres') {
    const genres = cmd.split(',').map(s => s.trim()).filter(Boolean);
    stateData.genres = genres.length ? genres : ['Action', 'Fantasy'];
    await db.updateTgUserState(userId, 'awaiting_newcomic_cover', stateData);
    return {
      text: (
        `✅ Genres set to: ${stateData.genres.join(', ')}\n\n` +
        `🖼️ **Almost done! Please send a cover photo/image for this comic.**\n` +
        `(Or type \`skip\` to use a default cover).`
      ),
      state: 'awaiting_newcomic_cover'
    };
  }

  if (state === 'awaiting_newcomic_cover') {
    const title = stateData.title || 'Untitled';
    const desc = stateData.description || '';
    const genres = stateData.genres || ['Action'];

    let comic = await db.createComic({
      title,
      description: desc,
      genres,
      cover_url: '/uploads/covers/cover_shadow-sovereign.jpg'
    });

    if (fileBuffer) {
      const coverUrl = await saveSingleComicCover(comic.id, fileBuffer, fileName || 'cover.jpg');
      comic.cover_url = coverUrl;
    }

    await db.updateTgUserState(userId, 'idle', {});
    return {
      text: (
        `🎉 **Comic '${comic.title}' created successfully!**\n\n` +
        `• ID: \`${comic.id}\`\n` +
        `• Slug: \`${comic.slug}\`\n` +
        `• Genres: ${comic.genres.join(', ')}\n\n` +
        `🔗 View on Web: ${baseUrl}/#comic/${comic.slug}\n\n` +
        `👉 Use \`/addchapter\` to upload Chapter 1 now!`
      ),
      state: 'idle'
    };
  }

  // 2) ADD CHAPTER WORKFLOW
  if (cmd.startsWith('/addchapter')) {
    if (!isAdmin) {
      return { text: '🚫 Access Denied: You must be an administrator.', state };
    }

    const comics = await db.getAllComics();
    if (!comics.length) {
      return { text: '⚠️ No comics exist yet. Create one first with `/newcomic`.', state };
    }

    let msg = '📑 **Select which Comic to add a chapter to:**\n\nEnter the **Comic ID** number from the list below:\n\n';
    for (const c of comics) {
      msg += `• **#${c.id}** : ${c.title} (Latest: Ch. ${c.latest_chapter || 0})\n`;
    }

    await db.updateTgUserState(userId, 'awaiting_chapter_comic_id', {});
    return { text: msg, state: 'awaiting_chapter_comic_id' };
  }

  if (state === 'awaiting_chapter_comic_id') {
    const comicId = parseInt(cmd);
    if (isNaN(comicId)) {
      return { text: '⚠️ Please enter a numeric Comic ID (e.g. 1, 2, 3):', state };
    }
    const comic = await db.getComicByIdOrSlug(comicId);
    if (!comic) {
      return { text: `⚠️ Comic with ID #${comicId} not found. Please enter a valid ID:`, state };
    }

    const suggestedNum = (comic.latest_chapter || 0) + 1;
    await db.updateTgUserState(userId, 'awaiting_chapter_number', { comic_id: comicId, comic_title: comic.title });
    return {
      text: `Selected: **${comic.title}**\n\nEnter the **Chapter Number** (suggested: \`${suggestedNum}\` or e.g. \`1\`, \`2.5\`):`,
      state: 'awaiting_chapter_number'
    };
  }

  if (state === 'awaiting_chapter_number') {
    const chNum = parseFloat(cmd);
    if (isNaN(chNum)) {
      return { text: '⚠️ Invalid number. Please enter a number like `1`, `2`, `3.5`:', state };
    }
    stateData.chapter_number = chNum;
    await db.updateTgUserState(userId, 'awaiting_chapter_title', stateData);
    return {
      text: `Chapter number set to **${chNum}**.\n\nEnter an optional **Chapter Title** (or type \`skip\`):`,
      state: 'awaiting_chapter_title'
    };
  }

  if (state === 'awaiting_chapter_title') {
    const chTitle = cmd.toLowerCase() === 'skip' ? '' : cmd.trim();
    stateData.chapter_title = chTitle;
    stateData.accumulated_pages = [];
    await db.updateTgUserState(userId, 'awaiting_chapter_pages', stateData);
    return {
      text: (
        `✅ Chapter ${stateData.chapter_number} configured!\n\n` +
        `📦 **How to upload pages:**\n` +
        `1️⃣ **Best:** Send a \`.zip\` file containing comic images (\`01.jpg\`, \`02.jpg\`, etc.)\n` +
        `2️⃣ **Or:** Send photos one-by-one or in an album, then send \`/done\` when finished.\n\n` +
        `Send your file or image now (or \`/cancel\`):`
      ),
      state: 'awaiting_chapter_pages'
    };
  }

  if (state === 'awaiting_chapter_pages') {
    const comicId = stateData.comic_id;
    const chNum = stateData.chapter_number;
    const chTitle = stateData.chapter_title;

    // ZIP File check
    if (fileBuffer && fileName && (fileName.toLowerCase().endsWith('.zip') || fileName.toLowerCase().endsWith('.cbz'))) {
      try {
        const chapter = await processZipChapter(comicId, chNum, chTitle, fileBuffer);
        const comic = await db.getComicByIdOrSlug(comicId);
        await db.updateTgUserState(userId, 'idle', {});
        return {
          text: (
            `🎉 **Chapter Published Successfully!**\n\n` +
            `• Series: **${comic.title}**\n` +
            `• Chapter: **${chNum}** ${chTitle ? `(${chTitle})` : ''}\n` +
            `• Total Pages: **${chapter.pages_count} pages** extracted & uploaded\n\n` +
            `📖 Read now: ${baseUrl}/#read/${comic.slug}/${chapter.id}`
          ),
          state: 'idle'
        };
      } catch (err) {
        return { text: `❌ Error extracting ZIP: ${err.message}. Please check archive format and try again.`, state };
      }
    }

    // Single Image check
    if (fileBuffer) {
      const currentPages = stateData.accumulated_pages || [];
      const pageIndex = currentPages.length + 1;
      const pageUrl = await saveChapterPageImage(comicId, chNum, fileBuffer, pageIndex);
      currentPages.push(pageUrl);
      stateData.accumulated_pages = currentPages;
      await db.updateTgUserState(userId, 'awaiting_chapter_pages', stateData);
      return {
        text: (
          `📥 Page #${pageIndex} received!\n\n` +
          `Total pages received so far: **${currentPages.length}**.\n` +
          `Send the next image, or type \`/done\` to publish the chapter.`
        ),
        state: 'awaiting_chapter_pages'
      };
    }

    // /done check
    if (cmd.toLowerCase() === '/done' || cmd.toLowerCase() === 'done') {
      const currentPages = stateData.accumulated_pages || [];
      if (!currentPages.length) {
        return { text: '⚠️ No pages were sent yet! Send at least one image or a `.zip` file.', state };
      }

      const chapter = await db.createChapter(comicId, chNum, chTitle, currentPages);
      const comic = await db.getComicByIdOrSlug(comicId);
      await db.updateTgUserState(userId, 'idle', {});
      return {
        text: (
          `🎉 **Chapter Published Successfully!**\n\n` +
          `• Series: **${comic.title}**\n` +
          `• Chapter: **${chNum}**\n` +
          `• Total Pages: **${currentPages.length} pages**\n\n` +
          `📖 Read now: ${baseUrl}/#read/${comic.slug}/${chapter.id}`
        ),
        state: 'idle'
      };
    }

    return {
      text: 'Waiting for comic pages (images or .zip file). Type `/done` when finished, or `/cancel` to abort.',
      state
    };
  }

  return {
    text: 'Command not recognized. Type `/help` for available commands or `/start` to return to menu.',
    state
  };
}

module.exports = {
  processZipChapter,
  saveSingleComicCover,
  saveChapterPageImage,
  handleBotCommand
};
