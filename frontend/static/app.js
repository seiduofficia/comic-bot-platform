// OmniComics - Interactive SPA Logic
const app = {
  state: {
    comics: [],
    currentComic: null,
    currentChapter: null,
    currentMangaPageIndex: 0,
    selectedGenre: 'All',
    searchQuery: '',
    readerMode: 'webtoon', // 'webtoon' | 'manga'
    favorites: JSON.parse(localStorage.getItem('omni_favorites') || '[]'),
    history: JSON.parse(localStorage.getItem('omni_history') || '[]'),
    simMessages: [
      { sender: 'bot', text: '👋 Welcome to OmniComics Publisher Bot Simulator!\nTry sending `/start` or `/comics` below, or click any quick command pill.' }
    ],
    selectedUploadFiles: null,
    simPendingFile: null
  },

  async init() {
    this.updateBadges();
    await this.loadComics();
    await this.checkBotStatus();
    this.initScrollListener();
    this.initKeyboardListener();
    this.renderSimulatorMessages();

    // Check URL hash for direct links (e.g. #comic/slug or #read/slug/chapterId)
    this.handleRoute();
    window.addEventListener('hashchange', () => this.handleRoute());
  },

  // ROUTING
  handleRoute() {
    const hash = window.location.hash;
    if (hash.startsWith('#read/')) {
      const parts = hash.split('/');
      if (parts.length >= 3) {
        const chapterId = parseInt(parts[2]);
        this.openReader(chapterId);
      }
    } else if (hash.startsWith('#comic/')) {
      const slug = hash.replace('#comic/', '');
      this.openComic(slug);
    } else if (hash === '#admin') {
      this.showView('admin');
    } else {
      this.showView('catalog');
    }
  },

  showView(viewName) {
    document.getElementById('catalogView').classList.add('hidden');
    document.getElementById('comicDetailView').classList.add('hidden');
    document.getElementById('adminView').classList.add('hidden');

    if (viewName === 'catalog') {
      document.getElementById('catalogView').classList.remove('hidden');
      window.location.hash = '';
    } else if (viewName === 'detail') {
      document.getElementById('comicDetailView').classList.remove('hidden');
    } else if (viewName === 'admin') {
      document.getElementById('adminView').classList.remove('hidden');
      window.location.hash = '#admin';
      this.checkBotStatus();
      this.populateUploadComicsSelect();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    lucide.createIcons();
  },

  // API CALLS
  async loadComics() {
    try {
      let url = '/api/comics';
      const params = new URLSearchParams();
      if (this.state.selectedGenre && this.state.selectedGenre !== 'All') {
        params.append('genre', this.state.selectedGenre);
      }
      if (this.state.searchQuery) {
        params.append('search', this.state.searchQuery);
      }
      if (params.toString()) {
        url += '?' + params.toString();
      }

      const res = await fetch(url);
      const data = await res.json();
      this.state.comics = data;
      this.renderComics();
      this.updateHero();
    } catch (e) {
      console.error("Failed to load comics:", e);
      this.showToast("Failed to load comics library", "error");
    }
  },

  // HERO BANNER
  updateHero() {
    if (!this.state.comics.length) return;
    const hero = this.state.comics[0];
    document.getElementById('heroTitle').textContent = hero.title;
    document.getElementById('heroDesc').textContent = hero.description || 'No description provided.';
    if (hero.cover_url) {
      document.getElementById('heroCoverImg').src = hero.cover_url;
    }
    document.getElementById('heroReadBtn').onclick = () => {
      this.startReadingComic(hero.slug);
    };
    document.getElementById('heroDetailsBtn').onclick = () => {
      this.openComic(hero.slug);
    };
  },

  // RENDER CATALOG GRID
  renderComics() {
    const grid = document.getElementById('comicGrid');
    const emptyState = document.getElementById('emptyCatalogState');
    const countBadge = document.getElementById('comicsCountBadge');

    countBadge.textContent = `${this.state.comics.length} titles available`;

    if (this.state.comics.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = this.state.comics.map(c => {
      const isFav = this.state.favorites.includes(c.id);
      const genresList = (c.genres || []).slice(0, 2).map(g => 
        `<span class="px-1.5 py-0.5 rounded bg-gray-800 text-[10px] text-gray-300 font-medium">${g}</span>`
      ).join('');

      return `
        <div class="comic-card group flex flex-col bg-gray-900/60 rounded-2xl border border-gray-800/80 overflow-hidden hover:border-purple-500/50 transition cursor-pointer" onclick="app.openComic('${c.slug}')">
          <!-- Cover container -->
          <div class="relative aspect-[2/3] overflow-hidden bg-gray-950">
            <img src="${c.cover_url || '/static/placeholder.jpg'}" alt="${c.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" loading="lazy">
            <div class="absolute inset-0 bg-gradient-to-t from-gray-950/90 via-transparent to-transparent opacity-80 group-hover:opacity-60 transition"></div>
            
            <!-- Top Badges -->
            <div class="absolute top-2 left-2 flex gap-1">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-600/90 text-white backdrop-blur-sm">HD</span>
            </div>

            <!-- Favorite toggle button on card -->
            <button onclick="event.stopPropagation(); app.toggleFavorite(${c.id})" class="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white transition backdrop-blur-sm">
              <i data-lucide="heart" class="w-3.5 h-3.5 ${isFav ? 'text-pink-500 fill-pink-500' : 'text-gray-300'}"></i>
            </button>

            <!-- Bottom overlay stats -->
            <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] text-gray-300">
              <span class="font-semibold text-purple-300">Ch. ${c.latest_chapter || 0}</span>
              <span class="flex items-center gap-1 text-[10px] text-gray-400">
                <i data-lucide="eye" class="w-3 h-3"></i> ${c.views || 0}
              </span>
            </div>
          </div>

          <!-- Card Content -->
          <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
            <div>
              <h3 class="font-bold text-sm text-gray-100 group-hover:text-purple-400 transition line-clamp-1">${c.title}</h3>
              <p class="text-[11px] text-gray-400 line-clamp-1 mt-0.5">${c.author || 'Unknown'}</p>
            </div>
            <div class="flex flex-wrap gap-1 pt-1">
              ${genresList}
            </div>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  },

  // SEARCH & FILTER
  handleSearch(val) {
    this.state.searchQuery = val.trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if (this.state.searchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.loadComics();
    }, 250);
  },

  clearSearch() {
    document.getElementById('searchInput').value = '';
    this.state.searchQuery = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    this.loadComics();
  },

  setGenre(genre) {
    this.state.selectedGenre = genre;
    document.querySelectorAll('.genre-pill').forEach(btn => {
      if (btn.textContent.trim().toLowerCase() === genre.toLowerCase()) {
        btn.classList.add('active');
        btn.classList.remove('bg-gray-900', 'text-gray-300');
        btn.classList.add('bg-purple-600', 'text-white');
      } else {
        btn.classList.remove('active', 'bg-purple-600', 'text-white');
        btn.classList.add('bg-gray-900', 'text-gray-300');
      }
    });
    this.loadComics();
  },

  // COMIC DETAIL VIEW
  async openComic(slugOrId) {
    try {
      const res = await fetch(`/api/comics/${slugOrId}`);
      if (!res.ok) throw new Error("Comic not found");
      const comic = await res.json();
      this.state.currentComic = comic;

      document.getElementById('detailCover').src = comic.cover_url || '';
      document.getElementById('detailTitle').textContent = comic.title;
      document.getElementById('detailAuthor').textContent = `Created by ${comic.author || 'Unknown'}`;
      document.getElementById('detailDescription').textContent = comic.description || 'No description available.';
      document.getElementById('detailStatus').textContent = comic.status || 'Ongoing';
      document.getElementById('detailChaptersCount').textContent = comic.chapters ? comic.chapters.length : 0;
      document.getElementById('detailViewsCount').textContent = comic.views || 0;

      // Genres
      const genresContainer = document.getElementById('detailGenres');
      genresContainer.innerHTML = (comic.genres || []).map(g => 
        `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-950/60 border border-purple-800/60 text-purple-300">${g}</span>`
      ).join('');

      // Chapters List
      const chList = document.getElementById('detailChaptersContainer');
      document.getElementById('detailChapterListCount').textContent = `${(comic.chapters || []).length} Total`;

      if (!comic.chapters || comic.chapters.length === 0) {
        chList.innerHTML = `<p class="col-span-2 text-xs text-gray-500 py-6 text-center">No chapters uploaded yet. Use the Telegram Bot or Admin tab to publish Chapter 1!</p>`;
      } else {
        chList.innerHTML = comic.chapters.map(ch => {
          const isRead = this.isChapterRead(comic.slug, ch.id);
          const date = new Date(ch.created_at).toLocaleDateString();
          return `
            <div onclick="app.openReader(${ch.id})" class="p-3.5 bg-gray-950/80 hover:bg-gray-800/80 rounded-2xl border border-gray-800 flex items-center justify-between cursor-pointer group transition">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl ${isRead ? 'bg-gray-800 text-gray-400' : 'bg-purple-900/60 text-purple-300'} flex items-center justify-center text-xs font-bold font-mono">
                  ${ch.chapter_number}
                </div>
                <div>
                  <span class="font-bold text-sm text-gray-200 group-hover:text-purple-400 transition block">
                    Chapter ${ch.chapter_number} ${ch.title ? `— ${ch.title}` : ''}
                  </span>
                  <span class="text-[11px] text-gray-500">${ch.pages_count} pages • ${date}</span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                ${isRead ? '<span class="text-[10px] text-gray-400 font-mono">Read</span>' : '<span class="text-[10px] text-purple-400 font-semibold">New</span>'}
                <i data-lucide="chevron-right" class="w-4 h-4 text-gray-500 group-hover:text-white transition"></i>
              </div>
            </div>
          `;
        }).join('');
      }

      // Read First Chapter Button
      const readFirstBtn = document.getElementById('detailReadFirstBtn');
      if (comic.chapters && comic.chapters.length > 0) {
        readFirstBtn.onclick = () => this.openReader(comic.chapters[0].id);
        readFirstBtn.classList.remove('opacity-50', 'pointer-events-none');
      } else {
        readFirstBtn.classList.add('opacity-50', 'pointer-events-none');
      }

      this.updateDetailFavoriteButton();
      this.showView('detail');
      window.location.hash = `#comic/${comic.slug}`;
      lucide.createIcons();
    } catch (e) {
      console.error(e);
      this.showToast("Could not load comic details", "error");
    }
  },

  async startReadingComic(slug) {
    const res = await fetch(`/api/comics/${slug}`);
    const comic = await res.json();
    if (comic.chapters && comic.chapters.length > 0) {
      this.openReader(comic.chapters[0].id);
    } else {
      this.openComic(slug);
    }
  },

  // COMIC READER
  async openReader(chapterId) {
    try {
      const res = await fetch(`/api/chapters/${chapterId}`);
      if (!res.ok) throw new Error("Chapter not found");
      const chapter = await res.json();
      this.state.currentChapter = chapter;
      this.state.currentMangaPageIndex = 0;

      // Populate Header Titles
      document.getElementById('readerComicTitle').textContent = chapter.comic_title;
      document.getElementById('readerChapterTitle').textContent = `Chapter ${chapter.chapter_number} ${chapter.title ? `— ${chapter.title}` : ''}`;

      // Populate Chapter Selector Dropdown
      const comicRes = await fetch(`/api/comics/${chapter.comic_id}`);
      const comic = await comicRes.json();
      this.state.currentComic = comic;
      const select = document.getElementById('readerChapterSelect');
      select.innerHTML = (comic.chapters || []).map(ch => 
        `<option value="${ch.id}" ${ch.id === chapter.id ? 'selected' : ''}>Ch. ${ch.chapter_number} ${ch.title ? `(${ch.title})` : ''}</option>`
      ).join('');

      // Render Pages in Webtoon strip
      const webtoonContainer = document.getElementById('readerWebtoonContainer');
      webtoonContainer.innerHTML = (chapter.pages || []).map((p, idx) => 
        `<img src="${p.image_url}" alt="Page ${idx + 1}" loading="lazy" class="w-full">`
      ).join('');

      // Next / Previous Chapter navigation buttons
      const prevBtn = document.getElementById('prevChapterBtn');
      const nextBtn = document.getElementById('nextChapterBtn');
      if (chapter.prev_chapter) {
        prevBtn.classList.remove('hidden');
        prevBtn.onclick = () => this.openReader(chapter.prev_chapter.id);
      } else {
        prevBtn.classList.add('hidden');
      }

      if (chapter.next_chapter) {
        nextBtn.classList.remove('hidden');
        nextBtn.onclick = () => this.openReader(chapter.next_chapter.id);
      } else {
        nextBtn.classList.add('hidden');
      }

      // Update Manga Mode Image if in Manga mode
      this.updateMangaPage();

      // Show Reader Fullscreen
      document.getElementById('readerView').classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      window.location.hash = `#read/${chapter.comic_slug}/${chapter.id}`;

      // Record in Reading History
      this.saveToHistory(chapter, 1);

      // Scroll top
      document.getElementById('readerScrollContainer').scrollTop = 0;
      this.updateReadingProgress();
      lucide.createIcons();
    } catch (e) {
      console.error(e);
      this.showToast("Could not open chapter reader", "error");
    }
  },

  closeReader() {
    document.getElementById('readerView').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (this.state.currentComic) {
      this.openComic(this.state.currentComic.slug);
    } else {
      this.showView('catalog');
    }
  },

  switchChapterFromSelect(chapterId) {
    this.openReader(parseInt(chapterId));
  },

  loadPrevChapter() {
    if (this.state.currentChapter && this.state.currentChapter.prev_chapter) {
      this.openReader(this.state.currentChapter.prev_chapter.id);
    }
  },

  loadNextChapter() {
    if (this.state.currentChapter && this.state.currentChapter.next_chapter) {
      this.openReader(this.state.currentChapter.next_chapter.id);
    }
  },

  // TOGGLE READER MODE (Webtoon Vertical vs Manga Page Turn)
  toggleReaderMode() {
    const webtoonBox = document.getElementById('readerWebtoonContainer');
    const mangaBox = document.getElementById('readerMangaContainer');
    const modeText = document.getElementById('readerModeText');

    if (this.state.readerMode === 'webtoon') {
      this.state.readerMode = 'manga';
      webtoonBox.classList.add('hidden');
      mangaBox.classList.remove('hidden');
      modeText.textContent = "Page Flip";
      this.updateMangaPage();
    } else {
      this.state.readerMode = 'webtoon';
      webtoonBox.classList.remove('hidden');
      mangaBox.classList.add('hidden');
      modeText.textContent = "Webtoon Scroll";
    }
    lucide.createIcons();
  },

  updateMangaPage() {
    if (!this.state.currentChapter || !this.state.currentChapter.pages) return;
    const pages = this.state.currentChapter.pages;
    const idx = this.state.currentMangaPageIndex;
    if (idx >= 0 && idx < pages.length) {
      document.getElementById('mangaPageImg').src = pages[idx].image_url;
      document.getElementById('mangaPageIndicator').textContent = `Page ${idx + 1} / ${pages.length}`;
      this.saveToHistory(this.state.currentChapter, idx + 1);
    }
  },

  prevMangaPage() {
    if (this.state.currentMangaPageIndex > 0) {
      this.state.currentMangaPageIndex--;
      this.updateMangaPage();
    } else if (this.state.currentChapter.prev_chapter) {
      this.loadPrevChapter();
    }
  },

  nextMangaPage() {
    const pages = this.state.currentChapter.pages || [];
    if (this.state.currentMangaPageIndex < pages.length - 1) {
      this.state.currentMangaPageIndex++;
      this.updateMangaPage();
    } else if (this.state.currentChapter.next_chapter) {
      this.loadNextChapter();
    }
  },

  initKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      const reader = document.getElementById('readerView');
      if (reader.classList.contains('hidden')) return;

      if (e.key === 'ArrowRight' || e.key === 'd') {
        if (this.state.readerMode === 'manga') this.nextMangaPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        if (this.state.readerMode === 'manga') this.prevMangaPage();
      } else if (e.key === 'Escape') {
        this.closeReader();
      }
    });
  },

  initScrollListener() {
    const scrollBox = document.getElementById('readerScrollContainer');
    scrollBox.addEventListener('scroll', () => {
      this.updateReadingProgress();
    });
  },

  updateReadingProgress() {
    const scrollBox = document.getElementById('readerScrollContainer');
    const totalHeight = scrollBox.scrollHeight - scrollBox.clientHeight;
    if (totalHeight > 0) {
      const progress = Math.min(100, Math.max(0, (scrollBox.scrollTop / totalHeight) * 100));
      document.getElementById('readingProgressBar').style.width = `${progress}%`;
    }
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  },

  // FAVORITES & BOOKMARKS
  toggleFavorite(comicId) {
    const idx = this.state.favorites.indexOf(comicId);
    if (idx > -1) {
      this.state.favorites.splice(idx, 1);
      this.showToast("Removed from favorites", "info");
    } else {
      this.state.favorites.push(comicId);
      this.showToast("Saved to favorites ❤️", "success");
    }
    localStorage.setItem('omni_favorites', JSON.stringify(this.state.favorites));
    this.updateBadges();
    this.renderComics();
    this.updateDetailFavoriteButton();
  },

  toggleFavoriteCurrent() {
    if (this.state.currentComic) {
      this.toggleFavorite(this.state.currentComic.id);
    }
  },

  updateDetailFavoriteButton() {
    if (!this.state.currentComic) return;
    const isFav = this.state.favorites.includes(this.state.currentComic.id);
    const btn = document.getElementById('detailFavoriteBtn');
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');

    if (isFav) {
      span.textContent = "Favorited";
      btn.classList.add('bg-pink-950/80', 'border-pink-800');
      icon.classList.add('fill-pink-500');
    } else {
      span.textContent = "Add to Favorites";
      btn.classList.remove('bg-pink-950/80', 'border-pink-800');
      icon.classList.remove('fill-pink-500');
    }
    lucide.createIcons();
  },

  bookmarkCurrentChapter() {
    if (!this.state.currentChapter) return;
    this.saveToHistory(this.state.currentChapter, 1, true);
    this.showToast("Chapter bookmarked! 🔖", "success");
  },

  saveToHistory(chapter, page = 1, isManualBookmark = false) {
    const comic = this.state.currentComic || { title: chapter.comic_title, slug: chapter.comic_slug, cover_url: '' };
    // Remove duplicate entry for same comic
    this.state.history = this.state.history.filter(h => h.comic_slug !== comic.slug);
    this.state.history.unshift({
      comic_slug: comic.slug,
      comic_title: comic.title,
      cover_url: comic.cover_url,
      chapter_id: chapter.id,
      chapter_number: chapter.chapter_number,
      chapter_title: chapter.title,
      page: page,
      timestamp: new Date().toISOString(),
      is_bookmark: isManualBookmark
    });
    // keep maximum 30 history items
    this.state.history = this.state.history.slice(0, 30);
    localStorage.setItem('omni_history', JSON.stringify(this.state.history));
    this.updateBadges();
  },

  isChapterRead(comicSlug, chapterId) {
    return this.state.history.some(h => h.comic_slug === comicSlug && h.chapter_id === chapterId);
  },

  updateBadges() {
    const favBadge = document.getElementById('favoritesBadge');
    const histBadge = document.getElementById('historyBadge');

    if (this.state.favorites.length > 0) {
      favBadge.textContent = this.state.favorites.length;
      favBadge.classList.remove('hidden');
    } else {
      favBadge.classList.add('hidden');
    }

    if (this.state.history.length > 0) {
      histBadge.textContent = this.state.history.length;
      histBadge.classList.remove('hidden');
    } else {
      histBadge.classList.add('hidden');
    }
  },

  shareToTelegram() {
    if (!this.state.currentComic) return;
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(`Read ${this.state.currentComic.title} on OmniComics!`);
    window.open(`https://t.me/share/url?url=${url}&text=${text}`, '_blank');
  },

  // MODALS
  showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
    if (modalId === 'favoritesModal') this.renderFavoritesList();
    if (modalId === 'historyModal') this.renderHistoryList();
    lucide.createIcons();
  },

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  },

  renderFavoritesList() {
    const container = document.getElementById('favoritesListContainer');
    const favComics = this.state.comics.filter(c => this.state.favorites.includes(c.id));

    if (favComics.length === 0) {
      container.innerHTML = `<p class="text-xs text-gray-500 py-8 text-center">No favorites added yet. Click the heart icon on any comic!</p>`;
      return;
    }

    container.innerHTML = favComics.map(c => `
      <div class="p-3 bg-gray-950 rounded-2xl border border-gray-800 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <img src="${c.cover_url}" class="w-10 h-14 object-cover rounded-lg border border-gray-800">
          <div>
            <h4 class="font-bold text-sm text-gray-200 line-clamp-1">${c.title}</h4>
            <span class="text-[11px] text-gray-400">Ch. ${c.latest_chapter || 0} • ${c.author}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="app.closeModal('favoritesModal'); app.openComic('${c.slug}')" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold">View</button>
          <button onclick="app.toggleFavorite(${c.id})" class="p-1.5 text-pink-400 hover:text-gray-400"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      </div>
    `).join('');
  },

  renderHistoryList() {
    const container = document.getElementById('historyListContainer');
    if (this.state.history.length === 0) {
      container.innerHTML = `<p class="text-xs text-gray-500 py-8 text-center">No reading history yet. Open any chapter to start tracking!</p>`;
      return;
    }

    container.innerHTML = this.state.history.map(h => {
      const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="p-3 bg-gray-950 rounded-2xl border border-gray-800 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-800 flex items-center justify-center font-mono font-bold text-indigo-300 text-xs">
              Ch.${h.chapter_number}
            </div>
            <div>
              <h4 class="font-bold text-sm text-gray-200 line-clamp-1">${h.comic_title}</h4>
              <span class="text-[11px] text-indigo-400">Chapter ${h.chapter_number} • ${time}</span>
            </div>
          </div>
          <button onclick="app.closeModal('historyModal'); app.openReader(${h.chapter_id})" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1">
            <i data-lucide="play" class="w-3 h-3 fill-white"></i> Continue
          </button>
        </div>
      `;
    }).join('');
  },

  // BOT & ADMIN CONTROLS
  async checkBotStatus() {
    try {
      const res = await fetch('/api/bot/status');
      const data = await res.json();
      
      const statusText = document.getElementById('botStatusText');
      const startBtn = document.getElementById('btnStartBot');
      const stopBtn = document.getElementById('btnStopBot');
      const tokenInput = document.getElementById('cfgBotToken');

      if (data.is_running) {
        statusText.innerHTML = `<span class="text-green-400 font-bold">● ONLINE: @${data.bot_info?.username || 'Bot'}</span>`;
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
      } else {
        statusText.innerHTML = data.has_token ? `<span class="text-yellow-400">● IDLE (Token configured, ready to start)</span>` : `<span class="text-gray-400">● NOT CONFIGURED</span>`;
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
      }

      if (data.masked_token && !tokenInput.value) {
        tokenInput.placeholder = `Configured: ${data.masked_token}`;
      }
      if (data.admin_secret) {
        document.getElementById('cfgAdminSecret').value = data.admin_secret;
      }
      if (data.admin_chat_id) {
        document.getElementById('cfgAdminChatId').value = data.admin_chat_id;
      }
    } catch (e) {
      console.error(e);
    }
  },

  async saveBotConfig() {
    const token = document.getElementById('cfgBotToken').value.trim();
    const secret = document.getElementById('cfgAdminSecret').value.trim();
    const chatId = document.getElementById('cfgAdminChatId').value.trim();

    try {
      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_bot_token: token || undefined,
          admin_secret: secret,
          admin_chat_id: chatId
        })
      });
      if (res.ok) {
        this.showToast("Settings saved successfully!", "success");
        this.checkBotStatus();
      }
    } catch (e) {
      this.showToast("Error saving settings", "error");
    }
  },

  async startTelegramBot() {
    try {
      const res = await fetch('/api/bot/start', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        this.showToast(`Bot @${data.bot?.username} is now online and polling!`, "success");
        this.checkBotStatus();
      } else {
        this.showToast(data.detail || "Failed to start bot", "error");
      }
    } catch (e) {
      this.showToast("Failed to connect to Telegram API", "error");
    }
  },

  async stopTelegramBot() {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      this.showToast("Telegram Bot stopped.", "info");
      this.checkBotStatus();
    } catch (e) {
      this.showToast("Error stopping bot", "error");
    }
  },

  populateUploadComicsSelect() {
    const sel = document.getElementById('uploadComicSelect');
    sel.innerHTML = this.state.comics.map(c => 
      `<option value="${c.id}">${c.title} (Latest: Ch. ${c.latest_chapter || 0})</option>`
    ).join('');
  },

  handleFileSelect(input) {
    if (input.files && input.files.length > 0) {
      this.state.selectedUploadFiles = input.files;
      const label = document.getElementById('uploadFileLabel');
      if (input.files.length === 1) {
        label.textContent = `Selected: ${input.files[0].name}`;
      } else {
        label.textContent = `Selected: ${input.files.length} images`;
      }
    }
  },

  async handleWebUpload(e) {
    e.preventDefault();
    const comicId = document.getElementById('uploadComicSelect').value;
    const chNum = document.getElementById('uploadChapterNumber').value;
    const chTitle = document.getElementById('uploadChapterTitle').value;
    const files = this.state.selectedUploadFiles;

    if (!files || files.length === 0) {
      this.showToast("Please choose a ZIP archive or images to upload", "error");
      return;
    }

    const submitBtn = document.getElementById('uploadSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Uploading & Processing...`;

    try {
      const formData = new FormData();
      formData.append('chapter_number', chNum);
      formData.append('title', chTitle);

      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        formData.append('zip_file', files[0]);
      } else {
        for (let i = 0; i < files.length; i++) {
          formData.append('page_files', files[i]);
        }
      }

      const res = await fetch(`/api/comics/${comicId}/chapters`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Upload failed");
      }

      const chapter = await res.json();
      this.showToast(`Chapter ${chNum} published successfully!`, "success");
      
      // Reset form
      document.getElementById('webUploadForm').reset();
      document.getElementById('uploadFileLabel').textContent = "Click or drop a .ZIP file of comic pages";
      this.state.selectedUploadFiles = null;

      // Reload
      await this.loadComics();
      this.populateUploadComicsSelect();
    } catch (err) {
      this.showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i> Publish Chapter to Web Reader`;
      lucide.createIcons();
    }
  },

  async handleCreateComicSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('newComicTitle').value.trim();
    const author = document.getElementById('newComicAuthor').value.trim();
    const genres = document.getElementById('newComicGenres').value.split(',').map(s => s.trim()).filter(Boolean);
    const desc = document.getElementById('newComicDesc').value.trim();
    const coverFile = document.getElementById('newComicCoverFile').files[0];

    try {
      const res = await fetch('/api/comics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, author, genres, description: desc
        })
      });
      const comic = await res.json();

      if (coverFile) {
        const formData = new FormData();
        formData.append('file', coverFile);
        await fetch(`/api/comics/${comic.id}/cover`, {
          method: 'POST',
          body: formData
        });
      }

      this.showToast(`Comic "${comic.title}" created!`, "success");
      this.closeModal('newComicModal');
      await this.loadComics();
      this.populateUploadComicsSelect();
    } catch (err) {
      this.showToast("Failed to create comic", "error");
    }
  },

  // TELEGRAM BOT SIMULATOR
  renderSimulatorMessages() {
    const chat = document.getElementById('simChatBody');
    chat.innerHTML = this.state.simMessages.map(m => {
      const isUser = m.sender === 'user';
      return `
        <div class="flex flex-col ${isUser ? 'items-end' : 'items-start'}">
          <div class="max-w-[85%] px-4 py-2.5 ${isUser ? 'sim-msg-user' : 'sim-msg-bot'} shadow-md">
            ${m.file ? `<div class="mb-1 text-[11px] text-cyan-300 font-mono flex items-center gap-1"><i data-lucide="paperclip" class="w-3 h-3"></i> ${m.file}</div>` : ''}
            <div class="whitespace-pre-line leading-relaxed">${this.formatTelegramText(m.text)}</div>
          </div>
        </div>
      `;
    }).join('');
    chat.scrollTop = chat.scrollHeight;
    lucide.createIcons();
  },

  formatTelegramText(text) {
    // Basic markdown formatting converter for simulator bubble
    let t = text || '';
    t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.*?)\*/g, '<em>$1</em>');
    t = t.replace(/`(.*?)`/g, '<code class="bg-black/30 px-1 py-0.5 rounded text-cyan-300 font-mono text-[11px]">$1</code>');
    t = t.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-cyan-400 underline font-semibold">$1</a>');
    return t;
  },

  handleSimFileSelect(input) {
    if (input.files && input.files.length > 0) {
      this.state.simPendingFile = input.files[0];
      this.showToast(`Attached ${input.files[0].name} to simulated message`, "info");
    }
  },

  handleSimSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('simInputText');
    const text = input.value.trim();
    if (!text && !this.state.simPendingFile) return;
    this.sendSimMessage(text);
    input.value = '';
  },

  async sendSimMessage(text) {
    const file = this.state.simPendingFile;
    this.state.simPendingFile = null;

    // Add user message
    this.state.simMessages.push({
      sender: 'user',
      text: text,
      file: file ? file.name : null
    });
    this.renderSimulatorMessages();

    // Call /api/bot/simulate
    try {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('user_id', 999999999);
      formData.append('username', 'SimulatorAdmin');
      formData.append('first_name', 'Simulator');
      if (file) {
        formData.append('file', file);
      }

      const res = await fetch('/api/bot/simulate', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      this.state.simMessages.push({
        sender: 'bot',
        text: data.text
      });
      this.renderSimulatorMessages();

      // Refresh comics list in case a comic or chapter was added
      if (text.includes('/done') || text.includes('skip') || (file && file.name.endsWith('.zip'))) {
        this.loadComics();
      }
    } catch (e) {
      this.state.simMessages.push({
        sender: 'bot',
        text: '⚠️ Simulator error connecting to backend API.'
      });
      this.renderSimulatorMessages();
    }
  },

  resetSimulator() {
    this.state.simMessages = [
      { sender: 'bot', text: 'Chat reset. Type `/start` to begin.' }
    ];
    this.renderSimulatorMessages();
  },

  // TOAST NOTIFICATIONS
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const colors = {
      success: 'bg-green-950/90 border-green-700 text-green-200',
      error: 'bg-red-950/90 border-red-700 text-red-200',
      info: 'bg-gray-900/90 border-gray-700 text-gray-200'
    };

    toast.className = `px-4 py-3 rounded-2xl border text-xs shadow-2xl backdrop-blur-md flex items-center gap-2.5 transition-all transform duration-200 pointer-events-auto ${colors[type] || colors.info}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }
};
