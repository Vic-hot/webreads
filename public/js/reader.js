/* ============================================================
   私人书库 · 阅读器逻辑
   支持 EPUB（epub.js）/ PDF（pdf.js）/ TXT（原生渲染）
   - 阅读进度自动保存到 localStorage，下次打开续读
   - 阅读设置（字号 / 主题 / 字体）持久化
   ============================================================ */
(function () {
  const params = new URLSearchParams(location.search);
  const bookId = params.get('id');
  if (!bookId) { window.location.href = '/index.html'; return; }

  // ---------- DOM ----------
  const loadingScreen = document.getElementById('loadingScreen');
  const loadingText = document.getElementById('loadingText');
  const readerApp = document.getElementById('readerApp');
  const bookTitleEl = document.getElementById('bookTitle');
  const readerBody = document.getElementById('readerBody');
  const viewer = document.getElementById('viewer');
  const tocPanel = document.getElementById('tocPanel');
  const tocList = document.getElementById('tocList');
  const btnToc = document.getElementById('btnToc');
  const btnSettings = document.getElementById('btnSettings');
  const settingsPanel = document.getElementById('settingsPanel');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const progressSlider = document.getElementById('progressSlider');
  const progressText = document.getElementById('progressText');
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const themeGroup = document.getElementById('themeGroup');
  const fontGroup = document.getElementById('fontGroup');

  // ---------- 状态 ----------
  const state = {
    book: null,
    format: null,
    epubBook: null,
    rendition: null,
    tocItems: [],        // 扁平化目录 [{label, href}]
    spineLength: 0,
    pdfDoc: null,
    pdfPageNum: 1,
    pdfScale: null,   // null = 首次渲染按容器宽度自适应
    pdfTotal: 0,
    txtChapters: [],     // [{index, text, ratio}]
    txtScrollRatio: 0,
    settings: loadSettings(),
    progress: null,      // 已保存的进度
    sliderLocked: false,
  };

  const PROGRESS_KEY = `ebook:progress:${bookId}`;
  const SETTINGS_KEY = 'ebook:settings';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const s = raw ? JSON.parse(raw) : {};
      return {
        slider: Number.isFinite(s.slider) ? s.slider : 40,
        theme: s.theme || 'light',
        font: s.font || 'serif',
      };
    } catch {
      return { slider: 40, theme: 'light', font: 'serif' };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* 忽略 */ }
  }
  function getProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveProgress(payload) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...payload, updated_at: Date.now() }));
    } catch { /* 忽略 */ }
  }

  // ---------- 工具 ----------
  function setLoading(msg) {
    loadingText.textContent = msg || '正在打开书籍…';
  }
  function fail(msg) {
    loadingText.textContent = msg || '打开失败';
    loadingScreen.querySelector('.spinner').style.display = 'none';
  }
  function fmtPct(x) {
    return `${Math.max(0, Math.min(100, Math.round(x)))}%`;
  }
  /** 从 CFI 中解析 spine 索引：epubcfi(/6/4[...]!/...) */
  function cfiSpineIndex(cfi) {
    const m = String(cfi).match(/epubcfi\(\/6\/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // ---------- 界面初始化 ----------
  function showApp() {
    // 先显示阅读器骨架让布局生效（loading 浮层仍在上层遮挡），
    // 否则 EPUB/PDF 渲染容器尺寸为 0
    readerApp.classList.remove('hidden');
    const t = state.settings.theme;
    readerApp.classList.toggle('theme-dark', t === 'dark');
  }

  function applySettingsUI() {
    fontSizeRange.value = state.settings.slider;
    updateFontSizeVal();
    themeGroup.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === state.settings.theme));
    fontGroup.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.font === state.settings.font));
  }

  // 字号滑杆 → 具体数值
  function updateFontSizeVal() {
    const v = state.settings.slider;
    if (state.format === 'pdf') {
      const scale = 0.6 + v * 0.018;
      fontSizeVal.textContent = `${Math.round(scale * 100)}%`;
    } else if (state.format === 'epub') {
      fontSizeVal.textContent = `${Math.round(80 + v * 1.2)}%`;
    } else {
      fontSizeVal.textContent = `${Math.round(13 + v * 0.14)}px`;
    }
  }

  function applyTheme() {
    const t = state.settings.theme;
    readerBody.className = `reader-body theme-${t}`;
    readerApp.classList.toggle('theme-dark', t === 'dark');
    if (state.rendition) {
      const styles = {
        light: { body: { background: '#fbf7ef', color: '#2f2922' } },
        sepia: { body: { background: '#f3ead6', color: '#4d402d' } },
        dark: { body: { background: '#19191b', color: '#c9c2b2' } },
      };
      state.rendition.themes.default(styles[t]);
      applyEpubType();
    }
    if (state.format === 'txt') {
      viewer.classList.remove('theme-light', 'theme-sepia', 'theme-dark');
      viewer.classList.add(`theme-${t}`);
    }
  }

  function applyEpubType() {
    if (!state.rendition) return;
    const v = state.settings.slider;
    state.rendition.themes.fontSize(`${Math.round(80 + v * 1.2)}%`);
    const serif = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
    const sans = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
    state.rendition.themes.font(state.settings.font === 'serif' ? serif : sans);
  }

  function applyTxtType() {
    const v = state.settings.slider;
    viewer.style.fontSize = `${Math.round(13 + v * 0.14)}px`;
    const serif = '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
    const sans = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    viewer.style.fontFamily = state.settings.font === 'serif' ? serif : sans;
  }

  // ---------- 加载书籍 ----------
  async function load() {
    let meta;
    try {
      meta = await apiGetJson(`/api/books/${encodeURIComponent(bookId)}`);
    } catch (err) {
      fail(err.message || '无法获取书籍信息');
      return;
    }
    state.book = meta;
    state.format = meta.format;
    state.progress = getProgress();
    bookTitleEl.textContent = meta.title;
    document.title = `${meta.title} · 私人书库`;

    // 先显示骨架让布局生效（loading 浮层仍在上层），避免渲染容器尺寸为 0
    readerApp.classList.remove('hidden');
    initNavLabels();

    try {
      if (meta.format === 'epub') await initEpub();
      else if (meta.format === 'pdf') await initPdf();
      else if (meta.format === 'txt') await initTxt();
      else throw new Error('未知的书籍格式');
    } catch (err) {
      console.error(err);
      fail(err.message || '书籍打开失败');
      return;
    }
    applyTheme();
    applySettingsUI();
    loadingScreen.classList.add('hidden');
  }

  // ---------- EPUB ----------
  async function initEpub() {
    setLoading('正在解析 EPUB…');
    const res = await fetch(state.book.file_url);
    if (!res.ok) throw new Error(`文件下载失败（${res.status}）`);
    const buf = await res.arrayBuffer();

    const book = ePub(buf);
    state.epubBook = book;
    await book.ready;

    state.spineLength = book.spine.spineItems.length || 1;

    const rendition = book.renderTo(viewer, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      allowScriptedContent: false,
    });
    state.rendition = rendition;
    viewer.classList.add('epub-host');

    // 目录
    try {
      const nav = await book.loaded.navigation;
      const toc = nav && nav.toc ? nav.toc : [];
      state.tocItems = flattenToc(toc);
      renderTocEpub();
    } catch { /* 无目录时忽略 */ }

    rendition.on('relocated', (loc) => {
      const idx = cfiSpineIndex(loc.start.cfi);
      const pct = state.spineLength > 1 ? (idx / (state.spineLength - 1)) * 100 : 0;
      updateProgressUI(pct);
      saveProgress({ format: 'epub', cfi: loc.start.cfi, percent: pct });
      markActiveToc(idx);
    });

    // 恢复进度
    if (state.progress && state.progress.cfi) {
      try { await rendition.display(state.progress.cfi); }
      catch { await rendition.display(); }
    } else {
      await rendition.display();
    }
  }

  function flattenToc(toc) {
    const out = [];
    const walk = (items, depth) => {
      (items || []).forEach((it) => {
        out.push({ label: it.label, href: it.href, depth });
        if (it.subitems && it.subitems.length) walk(it.subitems, depth + 1);
      });
    };
    walk(toc, 0);
    return out;
  }

  function renderTocEpub() {
    tocList.innerHTML = state.tocItems
      .map((it, i) => `<li><button data-i="${i}" style="padding-left:${14 + it.depth * 16}px"><span class="idx">${i + 1}</span>${esc(it.label)}</button></li>`)
      .join('');
    tocList.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = state.tocItems[parseInt(btn.dataset.i, 10)];
        state.rendition.display(item.href).catch(() => {});
        closeToc();
      });
    });
  }

  function markActiveToc(spineIdx) {
    if (!state.tocItems.length) return;
    const target = state.epubBook.spine.spineItems[spineIdx];
    if (!target) return;
    const active = state.tocItems.findIndex((it) => it.href === target.href);
    tocList.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    if (active >= 0) {
      const btn = tocList.querySelector(`button[data-i="${active}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  // ---------- PDF ----------
  async function initPdf() {
    setLoading('正在解析 PDF…');
    const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) throw new Error('PDF 渲染库加载失败，请检查网络');
    // worker 必须与页面同源（跨域 new Worker 会被拦截，导致渲染永久挂起）
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';

    const res = await fetch(state.book.file_url);
    if (!res.ok) throw new Error(`文件下载失败（${res.status}）`);
    const buf = await res.arrayBuffer();

    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    state.pdfDoc = doc;
    state.pdfTotal = doc.numPages;

    const stage = document.createElement('div');
    stage.className = 'pdf-stage';
    const canvas = document.createElement('canvas');
    stage.appendChild(canvas);
    viewer.appendChild(stage);

    if (state.progress && state.progress.page) {
      state.pdfPageNum = Math.min(doc.numPages, Math.max(1, state.progress.page));
    }
    updateProgressUI(((state.pdfPageNum - 1) / Math.max(1, doc.numPages - 1)) * 100);
    await renderPdfPage();
  }

  async function renderPdfPage() {
    if (!state.pdfDoc) return;
    const doc = state.pdfDoc;
    const page = await doc.getPage(state.pdfPageNum);
    const stage = viewer.querySelector('.pdf-stage');
    const canvas = stage.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;

    const base = page.getViewport({ scale: 1 });
    const fitScale = Math.max(0.5, (stage.clientWidth - 48) / base.width);
    // state.pdfScale 为 null 时按容器宽度自适应；用户调整滑杆后使用用户设定的缩放
    let scale = state.pdfScale == null ? fitScale : state.pdfScale;
    scale = Math.max(0.4, Math.min(3, scale));

    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 用 print intent 一次同步渲染：部分环境（如部分嵌入式/自动化浏览器）的默认渐进式
    // 渲染（display intent）会永久挂起不 resolve；同步渲染对正常浏览器也更快更稳
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

    const pct = doc.numPages > 1 ? ((state.pdfPageNum - 1) / (doc.numPages - 1)) * 100 : 0;
    updateProgressUI(pct);
    saveProgress({ format: 'pdf', page: state.pdfPageNum, percent: pct });
  }

  // ---------- TXT ----------
  async function initTxt() {
    setLoading('正在加载文本…');
    const res = await fetch(state.book.file_url);
    if (!res.ok) throw new Error(`文件下载失败（${res.status}）`);
    const buf = await res.arrayBuffer();

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('gb18030').decode(buf);
    }

    viewer.classList.add('txt-view');
    const lines = text.split(/\r?\n/);
    const chapterRe = /^\s*(第[一二三四五六七八九十百千万零〇0-9]+[章回节卷部篇]|(Chapter|CHAPTER)\s*\d+|序章|序言|前言|后记|尾声|附录)\s*[：: ]?/;

    let inParagraph = false;
    const frag = document.createDocumentFragment();
    const chapterRanges = [];   // 每个章节的起始 line index
    let chapterIdx = 0;

    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t) {
        if (inParagraph) {
          const p = document.createElement('p');
          p.className = 'empty';
          frag.appendChild(p);
          inParagraph = false;
        }
        return;
      }
      if (chapterRe.test(t)) {
        inParagraph = false;
        chapterRanges.push({ index: i, text: t.slice(0, 40) });
        const h = document.createElement('p');
        h.className = 'chapter';
        h.textContent = t;
        frag.appendChild(h);
        return;
      }
      const p = document.createElement('p');
      p.textContent = t;
      frag.appendChild(p);
      inParagraph = true;
    });
    viewer.appendChild(frag);

    // 目录（章节）
    state.txtChapters = chapterRanges.map((c) => ({
      ...c,
      ratio: c.index / Math.max(1, lines.length - 1),
    }));
    renderTocTxt();

    // 恢复进度
    const restoreRatio = state.progress && Number.isFinite(state.progress.ratio) ? state.progress.ratio : 0;
    applyTxtType();
    requestAnimationFrame(() => {
      const max = viewer.scrollHeight - viewer.clientHeight;
      viewer.scrollTop = restoreRatio * Math.max(0, max);
      updateProgressUI(restoreRatio * 100);
    });

    let scrollTimer = null;
    viewer.addEventListener('scroll', () => {
      const max = viewer.scrollHeight - viewer.clientHeight;
      const ratio = max > 0 ? viewer.scrollTop / max : 0;
      updateProgressUI(ratio * 100);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        saveProgress({ format: 'txt', ratio, percent: ratio * 100 });
      }, 400);
    });
  }

  function renderTocTxt() {
    if (!state.txtChapters.length) {
      tocPanel.classList.add('hidden');
      return;
    }
    tocList.innerHTML = state.txtChapters
      .map((c, i) => `<li><button data-i="${i}"><span class="idx">${i + 1}</span>${esc(c.text)}</button></li>`)
      .join('');
    tocList.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = state.txtChapters[parseInt(btn.dataset.i, 10)];
        const max = viewer.scrollHeight - viewer.clientHeight;
        viewer.scrollTop = c.ratio * Math.max(0, max);
        closeToc();
      });
    });
  }

  // ---------- 进度 UI ----------
  function updateProgressUI(pct) {
    progressText.textContent = fmtPct(pct);
    if (!state.sliderLocked) progressSlider.value = Math.round(pct * 10);
  }

  // ---------- 按钮事件 ----------
  btnBack.addEventListener('click', () => { window.location.href = '/index.html'; });
  btnToc.addEventListener('click', () => {
    const hidden = tocPanel.classList.contains('hidden');
    if (hidden) openToc(); else closeToc();
  });
  function openToc() { tocPanel.classList.remove('hidden'); }
  function closeToc() { tocPanel.classList.add('hidden'); }

  btnSettings.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!settingsPanel.classList.contains('hidden') && !settingsPanel.contains(e.target) && e.target.id !== 'btnSettings') {
      settingsPanel.classList.add('hidden');
    }
  });

  btnPrev.addEventListener('click', async () => {
    if (state.format === 'epub' && state.rendition) {
      await state.rendition.prev();
    } else if (state.format === 'pdf' && state.pdfDoc && state.pdfPageNum > 1) {
      state.pdfPageNum -= 1;
      await renderPdfPage();
      document.querySelector('.pdf-stage')?.scrollTo({ top: 0 });
    }
  });
  btnNext.addEventListener('click', async () => {
    if (state.format === 'epub' && state.rendition) {
      await state.rendition.next();
    } else if (state.format === 'pdf' && state.pdfDoc && state.pdfPageNum < state.pdfTotal) {
      state.pdfPageNum += 1;
      await renderPdfPage();
      document.querySelector('.pdf-stage')?.scrollTo({ top: 0 });
    }
  });

  // 进度滑杆
  progressSlider.addEventListener('input', () => {
    state.sliderLocked = true;
    const pct = (progressSlider.value / 1000) * 100;
    progressText.textContent = fmtPct(pct);
  });
  progressSlider.addEventListener('change', () => {
    state.sliderLocked = false;
    const ratio = progressSlider.value / 1000;
    if (state.format === 'epub' && state.rendition) {
      const targetIdx = Math.round(ratio * (state.spineLength - 1));
      const item = state.epubBook.spine.spineItems[Math.max(0, Math.min(state.spineLength - 1, targetIdx))];
      if (item) state.rendition.display(item.href).catch(() => {});
    } else if (state.format === 'pdf' && state.pdfDoc) {
      state.pdfPageNum = Math.max(1, Math.min(state.pdfTotal, Math.round(ratio * (state.pdfTotal - 1)) + 1));
      renderPdfPage();
    } else if (state.format === 'txt') {
      const max = viewer.scrollHeight - viewer.clientHeight;
      viewer.scrollTop = ratio * Math.max(0, max);
    }
  });

  // 设置面板
  fontSizeRange.addEventListener('input', () => {
    state.settings.slider = parseInt(fontSizeRange.value, 10);
    updateFontSizeVal();
    if (state.format === 'epub') applyEpubType();
    else if (state.format === 'txt') applyTxtType();
    else if (state.format === 'pdf') {
      state.pdfScale = 0.6 + state.settings.slider * 0.018;
      renderPdfPage();
    }
    saveSettings();
  });
  themeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.settings.theme = btn.dataset.theme;
    applyTheme();
    applySettingsUI();
    saveSettings();
  });
  fontGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.format === 'pdf') return;
    state.settings.font = btn.dataset.font;
    if (state.format === 'epub') applyEpubType();
    else if (state.format === 'txt') applyTxtType();
    applySettingsUI();
    saveSettings();
  });

  // 底部按钮文案按格式调整
  function initNavLabels() {
    if (state.format === 'epub') {
      btnPrev.textContent = '上一章';
      btnNext.textContent = '下一章';
      btnPrev.disabled = false;
      btnNext.disabled = false;
    } else if (state.format === 'pdf') {
      btnPrev.textContent = '上一页';
      btnNext.textContent = '下一页';
      btnPrev.disabled = false;
      btnNext.disabled = false;
    } else {
      btnPrev.classList.add('hidden');
      btnNext.classList.add('hidden');
      progressSlider.classList.add('hidden');
    }
  }

  load();
})();
