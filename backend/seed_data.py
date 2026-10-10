import os
import random
from PIL import Image, ImageDraw, ImageFont
import db

UPLOAD_DIR = "/root/comic-bot-platform/data/uploads"

def create_gradient(width, height, color1, color2):
    base = Image.new('RGB', (width, height), color1)
    top = Image.new('RGB', (width, height), color2)
    mask = Image.new('L', (width, height))
    mask_data = []
    for y in range(height):
        for x in range(width):
            mask_data.append(int(255 * (y / height)))
    mask.putdata(mask_data)
    base.paste(top, (0, 0), mask)
    return base

def draw_comic_panel(draw, bbox, title, speech_texts, border_color=(255, 255, 255), bg_color=(20, 24, 39)):
    x1, y1, x2, y2 = bbox
    # Draw panel background
    draw.rectangle([x1, y1, x2, y2], fill=bg_color, outline=border_color, width=4)
    
    # Accent lines
    draw.line([x1 + 10, y1 + 10, x2 - 10, y1 + 10], fill=border_color, width=1)
    
    # Title / Narrative header
    if title:
        draw.rectangle([x1 + 15, y1 + 15, x1 + 250, y1 + 45], fill=(10, 10, 15, 200), outline=(80, 80, 100), width=1)
        draw.text((x1 + 25, y1 + 22), title, fill=(240, 240, 255))

    # Speech bubbles
    for idx, (bx, by, speaker, text) in enumerate(speech_texts):
        bw = len(text) * 8 + 30
        bh = 45
        # Bubble body
        draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=12, fill=(255, 255, 255), outline=(0, 0, 0), width=2)
        # Tail
        draw.polygon([(bx + 20, by + bh), (bx + 15, by + bh + 12), (bx + 35, by + bh)], fill=(255, 255, 255), outline=(0, 0, 0))
        # Speaker prefix and text
        draw.text((bx + 10, by + 8), f"{speaker}:", fill=(180, 40, 40))
        draw.text((bx + 10, by + 24), text, fill=(20, 20, 20))

def generate_comic_page(comic_title, chapter_num, page_num, total_pages, theme):
    width = 800
    height = 1200
    
    if theme == "dark_fantasy":
        c1, c2 = (15, 12, 35), (45, 15, 60)
        border_c = (147, 51, 234)
        panel_bg = (18, 16, 30)
    elif theme == "alchemist":
        c1, c2 = (20, 30, 25), (10, 60, 40)
        border_c = (16, 185, 129)
        panel_bg = (15, 28, 22)
    else: # cyberpunk
        c1, c2 = (10, 15, 40), (40, 10, 45)
        border_c = (6, 182, 212)
        panel_bg = (15, 20, 35)

    img = create_gradient(width, height, c1, c2)
    draw = ImageDraw.Draw(img)

    # Top Chapter Header
    draw.rectangle([0, 0, width, 55], fill=(5, 5, 10))
    draw.text((30, 18), f"{comic_title.upper()}  •  CH. {chapter_num}", fill=(200, 200, 220))
    draw.text((width - 130, 18), f"PAGE {page_num}/{total_pages}", fill=(150, 150, 180))

    # Panel 1 (Top)
    draw_comic_panel(
        draw, [40, 80, width - 40, 380], 
        f"SCENE I : THE ENCOUNTER",
        [(70, 260, "HERO", "Is this... the legendary seal unlocking?!"),
         (420, 160, "UNKNOWN", "You should not have stepped into this abyss...")],
        border_color=border_c, bg_color=panel_bg
    )
    # Visual flair in panel 1: magic geometric lines
    draw.ellipse([width//2 - 60, 230 - 60, width//2 + 60, 230 + 60], outline=border_c, width=3)
    draw.polygon([(width//2, 180), (width//2 - 50, 260), (width//2 + 50, 260)], outline=(250, 204, 21), width=2)

    # Panel 2 (Middle action splash)
    draw_comic_panel(
        draw, [40, 410, width - 40, 780],
        f"SCENE II : BATTLE CLASH",
        [(80, 680, "ENEMY", "Too slow! Tremble before absolute power!"),
         (380, 470, "HERO", "Activate: RESONANCE BURST!!")],
        border_color=(239, 68, 68) if theme == "dark_fantasy" else border_c, bg_color=panel_bg
    )
    # Dynamic action slash lines
    draw.line([60, 450, width - 60, 740], fill=(255, 255, 255), width=4)
    draw.line([90, 430, width - 90, 720], fill=(244, 63, 94), width=2)
    draw.line([ width - 60, 450, 60, 740], fill=(250, 204, 21), width=3)

    # Panel 3 (Bottom climax / cliffhanger)
    draw_comic_panel(
        draw, [40, 810, width - 40, 1130],
        f"SCENE III : AFTERMATH",
        [(80, 1000, "COMPANION", "Hang on... look at the sky! Something is descending!"),
         (390, 870, "NARRATOR", "And thus, the ancient decree shattered.")],
        border_color=border_c, bg_color=panel_bg
    )
    # Energy sphere
    draw.ellipse([width//2 - 80, 970 - 40, width//2 + 80, 970 + 40], outline=(168, 85, 247), width=3)

    # Bottom Footer
    draw.rectangle([0, height - 40, width, height], fill=(5, 5, 10))
    draw.text((width//2 - 60, height - 28), "▼ SCROLL DOWN ▼", fill=(120, 120, 140))

    return img

def generate_cover_image(title, subtitle, theme):
    width, height = 450, 650
    if theme == "dark_fantasy":
        c1, c2 = (18, 10, 36), (88, 28, 135)
        accent = (168, 85, 247)
    elif theme == "alchemist":
        c1, c2 = (6, 78, 59), (5, 46, 22)
        accent = (52, 211, 153)
    else: # cyberpunk
        c1, c2 = (15, 23, 42), (14, 116, 144)
        accent = (34, 211, 238)

    img = create_gradient(width, height, c1, c2)
    draw = ImageDraw.Draw(img)

    # Frame border
    draw.rectangle([15, 15, width - 15, height - 15], outline=accent, width=3)
    draw.rectangle([22, 22, width - 22, height - 22], outline=(255, 255, 255, 60), width=1)

    # Decorative sigil / emblem
    center_y = 280
    draw.ellipse([width//2 - 100, center_y - 100, width//2 + 100, center_y + 100], outline=accent, width=4)
    draw.polygon([
        (width//2, center_y - 80),
        (width//2 + 75, center_y + 50),
        (width//2 - 75, center_y + 50)
    ], outline=(250, 204, 21), width=3)
    draw.ellipse([width//2 - 25, center_y - 10, width//2 + 25, center_y + 40], fill=accent)

    # Title Banner Box
    draw.rectangle([35, height - 190, width - 35, height - 50], fill=(10, 10, 15, 230), outline=accent, width=2)
    draw.text((50, height - 170), title.upper(), fill=(255, 255, 255))
    draw.text((50, height - 130), subtitle, fill=(200, 200, 220))
    draw.text((50, height - 90), "WEBTOON / MANGA • HD", fill=accent)

    # Top Tag
    draw.rectangle([40, 35, 140, 65], fill=accent)
    draw.text((50, 42), "OFFICIAL", fill=(0, 0, 0))

    return img

def seed():
    db.init_db()
    existing = db.get_all_comics()
    if existing:
        print(f"Database already has {len(existing)} comics. Skipping seed.")
        return

    print("Generating demo comics and rich manga chapters...")
    os.makedirs(f"{UPLOAD_DIR}/covers", exist_ok=True)

    demos = [
        {
            "title": "Shadow Sovereign",
            "subtitle": "Rise of the Monarch",
            "desc": "In a world overrun by dimensional rifts, Jin-Woo was mocked as the weakest hunter of all mankind. But when a mysterious double dungeon claims his team, a surreal quest window appears only to him: 'Congratulations, you have been selected as the Monarch.'",
            "author": "Chugong & DUBU",
            "genres": ["Action", "Fantasy", "Supernatural", "Shounen"],
            "theme": "dark_fantasy",
            "chapters": [
                {"num": 1, "title": "The Dual Dungeon Awakening", "pages": 4},
                {"num": 2, "title": "Trial of the Great Monarch", "pages": 4},
                {"num": 3, "title": "Return of the Hunter", "pages": 3}
            ]
        },
        {
            "title": "Celestial Alchemist",
            "subtitle": "Nine Cauldrons Immortal",
            "desc": "Betrayed by his master and stripped of his Golden Core, Ye Chen falls to the bottom of the Valley of Despair. Discovering the ancient Nine Dragon Cauldron, he re-forges his body with primordial lightning and begins his conquest of the 33 Heavens.",
            "author": "Tang Jiasan",
            "genres": ["Fantasy", "Martial Arts", "Adventure", "Cultivation"],
            "theme": "alchemist",
            "chapters": [
                {"num": 1, "title": "Rebirth in the Desolate Valley", "pages": 4},
                {"num": 2, "title": "First Cauldron Pill Refinement", "pages": 4}
            ]
        },
        {
            "title": "Neon Drifter 2099",
            "subtitle": "Underground Cyber Syndicate",
            "desc": "Neon-drenched megacity Neo-Tokyo is ruled by biometric cartels and rogue AI sentinels. Ryo, a neural-deck hacker with an illegal sub-tier chrome arm, discovers an encrypted memory shard containing the kill-switch of the world's governing neural net.",
            "author": "A. K. Sterling",
            "genres": ["Sci-Fi", "Cyberpunk", "Action", "Mystery"],
            "theme": "cyberpunk",
            "chapters": [
                {"num": 1, "title": "Zero Hour Neural Jack", "pages": 4},
                {"num": 2, "title": "The Megacity Lockdown", "pages": 3}
            ]
        }
    ]

    for d in demos:
        # Create cover image
        cover_filename = f"cover_{db.slugify(d['title'])}.jpg"
        cover_path = os.path.join(f"{UPLOAD_DIR}/covers", cover_filename)
        cover_img = generate_cover_image(d["title"], d["subtitle"], d["theme"])
        cover_img.save(cover_path, "JPEG", quality=90)
        cover_url = f"/uploads/covers/{cover_filename}"

        comic = db.create_comic(
            title=d["title"],
            description=d["desc"],
            author=d["author"],
            genres=d["genres"],
            status="Ongoing",
            cover_url=cover_url,
            banner_url=cover_url
        )
        print(f"Created Comic: {comic['title']} (ID: {comic['id']})")

        comic_slug = comic["slug"]
        for ch in d["chapters"]:
            ch_num = ch["num"]
            ch_dir = os.path.join(UPLOAD_DIR, "comics", comic_slug, f"ch_{ch_num}")
            os.makedirs(ch_dir, exist_ok=True)
            page_urls = []

            for p_num in range(1, ch["pages"] + 1):
                p_filename = f"page_{p_num:02d}.jpg"
                p_path = os.path.join(ch_dir, p_filename)
                page_img = generate_comic_page(d["title"], ch_num, p_num, ch["pages"], d["theme"])
                page_img.save(p_path, "JPEG", quality=88)
                page_urls.append(f"/uploads/comics/{comic_slug}/ch_{ch_num}/{p_filename}")

            db.create_chapter(comic["id"], float(ch_num), ch["title"], page_urls)
            print(f"  Added Chapter {ch_num}: '{ch['title']}' ({len(page_urls)} pages)")

    # Set some initial bot settings
    db.set_bot_config("site_name", "OmniComics Webtoon")
    db.set_bot_config("site_url", "http://localhost:8000")
    print("Seed complete! All sample comics generated.")

if __name__ == "__main__":
    seed()
