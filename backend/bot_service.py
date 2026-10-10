import asyncio
import os
import io
import logging
import httpx
from typing import Optional, Dict, Any
import sys
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import db
import bot

logger = logging.getLogger("BotService")
logging.basicConfig(level=logging.INFO)

class TelegramBotManager:
    def __init__(self):
        self.is_running = False
        self.bot_info: Optional[Dict[str, Any]] = None
        self.last_error: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    def get_token(self) -> str:
        return db.get_bot_config("telegram_bot_token", os.environ.get("TELEGRAM_BOT_TOKEN", ""))

    async def verify_token(self, token: str) -> Dict[str, Any]:
        url = f"https://api.telegram.org/bot{token}/getMe"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            data = resp.json()
            if data.get("ok"):
                return {"valid": True, "bot": data.get("result")}
            else:
                return {"valid": False, "error": data.get("description", "Invalid token")}

    async def send_telegram_message(self, token: str, chat_id: int, text: str, parse_mode: str = "Markdown"):
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        # Escape markdown or use default
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload)
            if not resp.json().get("ok"):
                # Retry without markdown in case markdown tags fail
                payload.pop("parse_mode", None)
                await client.post(url, json=payload)

    async def download_file_bytes(self, token: str, file_id: str) -> bytes:
        info_url = f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(info_url)
            data = r.json()
            if not data.get("ok"):
                raise ValueError(f"Could not get file info: {data.get('description')}")
            file_path = data["result"]["file_path"]
            download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
            f_resp = await client.get(download_url)
            return f_resp.content

    async def _poll_loop(self, token: str):
        offset = 0
        logger.info("Telegram Bot long polling started...")
        self.is_running = True
        self.last_error = None

        async with httpx.AsyncClient(timeout=45.0) as client:
            while not self._stop_event.is_set():
                try:
                    url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout=30"
                    resp = await client.get(url)
                    data = resp.json()

                    if not data.get("ok"):
                        self.last_error = data.get("description", "Error fetching updates")
                        logger.warning(f"Polling error: {self.last_error}")
                        await asyncio.sleep(5)
                        continue

                    updates = data.get("result", [])
                    for u in updates:
                        offset = max(offset, u["update_id"] + 1)
                        msg = u.get("message")
                        if not msg:
                            continue

                        chat_id = msg["chat"]["id"]
                        user = msg.get("from", {})
                        user_id = user.get("id", chat_id)
                        username = user.get("username", "")
                        first_name = user.get("first_name", "")
                        text = msg.get("text", "") or msg.get("caption", "")

                        file_bytes = None
                        file_name = None

                        # Handle photo attachment
                        if "photo" in msg and msg["photo"]:
                            best_photo = msg["photo"][-1]
                            file_id = best_photo["file_id"]
                            try:
                                file_bytes = await self.download_file_bytes(token, file_id)
                                file_name = "photo.jpg"
                            except Exception as e:
                                logger.error(f"Failed to download photo: {e}")

                        # Handle document attachment (.zip, .cbz, images)
                        elif "document" in msg:
                            doc = msg["document"]
                            file_id = doc["file_id"]
                            file_name = doc.get("file_name", "document.bin")
                            try:
                                file_bytes = await self.download_file_bytes(token, file_id)
                            except Exception as e:
                                logger.error(f"Failed to download document: {e}")

                        # Process through bot logic
                        res = bot.handle_bot_command(
                            user_id=user_id,
                            username=username,
                            first_name=first_name,
                            text=text,
                            file_bytes=file_bytes,
                            file_name=file_name
                        )

                        await self.send_telegram_message(token, chat_id, res["text"])

                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Exception in polling loop: {e}")
                    self.last_error = str(e)
                    await asyncio.sleep(3)

        self.is_running = False
        logger.info("Telegram Bot long polling stopped.")

    async def start(self) -> Dict[str, Any]:
        token = self.get_token()
        if not token:
            return {"success": False, "error": "No Telegram Bot Token provided."}

        # Verify token
        check = await self.verify_token(token)
        if not check["valid"]:
            return {"success": False, "error": check["error"]}

        self.bot_info = check["bot"]

        if self.is_running:
            await self.stop()

        self._stop_event.clear()
        self._task = asyncio.create_task(self._poll_loop(token))
        return {"success": True, "bot": self.bot_info}

    async def stop(self) -> Dict[str, Any]:
        if self._task and not self._task.done():
            self._stop_event.set()
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.is_running = False
        return {"success": True}

    def get_status(self) -> Dict[str, Any]:
        token = self.get_token()
        has_token = bool(token and len(token) > 10)
        masked_token = f"{token[:6]}...{token[-4:]}" if has_token else ""
        return {
            "is_running": self.is_running,
            "has_token": has_token,
            "masked_token": masked_token,
            "bot_info": self.bot_info,
            "last_error": self.last_error,
            "admin_secret": db.get_bot_config("admin_secret", "comicadmin123"),
            "admin_chat_id": db.get_bot_config("admin_chat_id", "")
        }

bot_manager = TelegramBotManager()
