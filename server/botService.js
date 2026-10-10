const db = require('./db');
const bot = require('./bot');

class TelegramBotManager {
  constructor() {
    this.isRunning = false;
    this.botInfo = null;
    this.lastError = null;
    this.abortController = null;
  }

  async getToken() {
    return (await db.getBotConfig('telegram_bot_token')) || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  async verifyToken(token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      if (data.ok) {
        return { valid: true, bot: data.result };
      }
      return { valid: false, error: data.description || 'Invalid token' };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  async sendMessage(token, chatId, text, parseMode = 'Markdown') {
    try {
      const payload = { chat_id: chatId, text, parse_mode: parseMode };
      let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let data = await res.json();
      if (!data.ok) {
        // Fallback without markdown
        delete payload.parse_mode;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    } catch (err) {
      console.error('Failed to send telegram message:', err.message);
    }
  }

  async downloadFileBytes(token, fileId) {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const infoData = await infoRes.json();
    if (!infoData.ok) {
      throw new Error(`Could not get file info: ${infoData.description}`);
    }
    const filePath = infoData.result.file_path;
    const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    const arrayBuffer = await downloadRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async start() {
    const token = await this.getToken();
    if (!token) {
      return { success: false, error: 'No Telegram Bot Token provided.' };
    }

    const check = await this.verifyToken(token);
    if (!check.valid) {
      return { success: false, error: check.error };
    }

    this.botInfo = check.bot;

    if (this.isRunning) {
      await this.stop();
    }

    this.isRunning = true;
    this.lastError = null;
    this.abortController = new AbortController();

    this.pollLoop(token, this.abortController.signal);
    return { success: true, bot: this.botInfo };
  }

  async stop() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isRunning = false;
    return { success: true };
  }

  async pollLoop(token, signal) {
    let offset = 0;
    console.log(`[TelegramBot] Polling loop started for @${this.botInfo?.username}`);

    while (!signal.aborted) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`;
        const res = await fetch(url, { signal });
        const data = await res.json();

        if (!data.ok) {
          this.lastError = data.description || 'Error fetching updates';
          console.warn('[TelegramBot] Polling warning:', this.lastError);
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }

        const updates = data.result || [];
        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1);
          const msg = u.message;
          if (!msg) continue;

          const chatId = msg.chat.id;
          const user = msg.from || {};
          const userId = user.id || chatId;
          const username = user.username || '';
          const firstName = user.first_name || '';
          const text = msg.text || msg.caption || '';

          let fileBuffer = null;
          let fileName = null;

          // Check photo
          if (msg.photo && msg.photo.length > 0) {
            const bestPhoto = msg.photo[msg.photo.length - 1];
            try {
              fileBuffer = await this.downloadFileBytes(token, bestPhoto.file_id);
              fileName = 'photo.jpg';
            } catch (err) {
              console.error('[TelegramBot] Photo download error:', err.message);
            }
          }
          // Check document (.zip or uncompressed image)
          else if (msg.document) {
            const doc = msg.document;
            fileName = doc.file_name || 'document.bin';
            try {
              fileBuffer = await this.downloadFileBytes(token, doc.file_id);
            } catch (err) {
              console.error('[TelegramBot] Document download error:', err.message);
            }
          }

          // Process command
          const response = await bot.handleBotCommand({
            userId,
            username,
            firstName,
            text,
            fileBuffer,
            fileName
          });

          await this.sendMessage(token, chatId, response.text);
        }
      } catch (err) {
        if (signal.aborted) break;
        this.lastError = err.message;
        console.error('[TelegramBot] Loop error:', err.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    this.isRunning = false;
    console.log('[TelegramBot] Polling loop stopped.');
  }

  async getStatus() {
    const token = await this.getToken();
    const hasToken = Boolean(token && token.length > 10);
    const maskedToken = hasToken ? `${token.slice(0, 6)}...${token.slice(-4)}` : '';

    return {
      is_running: this.isRunning,
      has_token: hasToken,
      masked_token: maskedToken,
      bot_info: this.botInfo,
      last_error: this.lastError,
      admin_secret: await db.getBotConfig('admin_secret', 'comicadmin123'),
      admin_chat_id: await db.getBotConfig('admin_chat_id', '')
    };
  }
}

const botManager = new TelegramBotManager();
module.exports = { botManager };
