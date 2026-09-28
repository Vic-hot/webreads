/* 书架页逻辑：搜索、过滤、分页加载 */
(function () {
  const grid = document.getElementById('bookGrid');
  const statsText = document.getElementById('statsText');
  const emptyState = document.getElementById('emptyState');
  const emptyText = document.getElementById('emptyText');
  const searchInput = document.getElementById('searchInput');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const chips = Array.from(document.querySelectorAll('.chip[data-format]'));

  const state = {
    q: '',
    format: '',
    page: 1,
    perPage: 24,
    total: 0,
    loading: false,
    loaded: 0,
  };

  function renderBook(book) {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.setAttribute('data-id', book.id);

    let coverHtml;
    if (book.cover_url) {
      coverHtml = `<img src="${esc(book.cover_url)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('no-img')" />`;
    } else {
      coverHtml = '';
    }

    card.innerHTML = `
      <div class="cover">
        ${coverHtml}
        <div class="cover-ph" style="background:${coverGradient(book.title)}">
          <span class="ph-title">${esc(book.title)}</span>
          ${book.author ? `<span class="ph-author">${esc(book.author)}</span>` : ''}
        </div>
        <span class="format-badge">${esc(book.format)}</span>
      </div>
      <div class="meta">
        <h3 class="title">${esc(book.title)}</h3>
        <p class="author">${esc(book.author || '佚名')}</p>
        <div class="tags">
          ${(book.tags_list || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        </div>
      </div>
    `;

    // 有封面图时隐藏占位层
    if (book.cover_url) {
      const coverPh = card.querySelector('.cover-ph');
      if (coverPh) coverPh.style.display = 'none';
    }

    card.addEventListener('click', () => {
      window.location.href = `/reader.html?id=${encodeURIComponent(book.id)}`;
    });
    return card;
  }

  async function load(reset) {
    if (state.loading) return;
    if (reset) {
      state.page = 1;
      state.loaded = 0;
      grid.innerHTML = '';
    }
    state.loading = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = '加载中…';

    const params = new URLSearchParams({ page: state.page, per_page: state.perPage });
    if (state.q) params.set('q', state.q);
    if (state.format) params.set('format', state.format);

    try {
      const data = await apiGetJson(`/api/books?${params.toString()}`);
      state.total = data.total;
      const items = data.items || [];
      items.forEach((b) => grid.appendChild(renderBook(b)));
      state.loaded += items.length;

      statsText.textContent = `共 ${state.total} 本`;

      const hasMore = state.loaded < state.total;
      loadMoreWrap.classList.toggle('hidden', !hasMore);
      emptyState.classList.toggle('hidden', !(state.total === 0));
      if (state.total === 0) {
        emptyText.textContent = state.q || state.format
          ? '没有找到匹配的书籍'
          : '书库还是空的\n前往「管理」页上传你的第一本书吧';
      }
    } catch (err) {
      toast(err.message || '加载失败');
    } finally {
      state.loading = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = '加载更多';
    }
  }

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      load(true);
    }, 300);
  });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.format = chip.dataset.format;
      load(true);
    });
  });

  loadMoreBtn.addEventListener('click', () => {
    state.page += 1;
    load(false);
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await apiPostJson('/api/auth/logout', {});
    } catch { /* 忽略 */ }
    window.location.href = '/login';
  });

  load(true);
})();
