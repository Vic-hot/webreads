/* 管理页逻辑：上传新书 + 书目管理（编辑 / 删除） */
(function () {
  // ---------- 上传 ----------
  const form = document.getElementById('uploadForm');
  const fileDrop = document.getElementById('fileDrop');
  const fileInput = document.getElementById('fileInput');
  const fileName = document.getElementById('fileName');
  const dropText = document.getElementById('dropText');
  const titleInput = document.getElementById('titleInput');
  const authorInput = document.getElementById('authorInput');
  const descInput = document.getElementById('descInput');
  const tagsInput = document.getElementById('tagsInput');
  const coverInput = document.getElementById('coverInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadProgress = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('progressBar');
  const progressPct = document.getElementById('progressPct');
  const uploadResult = document.getElementById('uploadResult');

  let selectedFile = null;

  function pickFile(f) {
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['epub', 'pdf', 'txt'].includes(ext)) {
      toast('仅支持 EPUB / PDF / TXT 文件');
      return;
    }
    selectedFile = f;
    fileName.textContent = `${f.name}（${formatSize(f.size)}）`;
    fileName.classList.remove('hidden');
    dropText.classList.add('hidden');
  }

  fileDrop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));
  fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('drag'); });
  fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('drag'));
  fileDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDrop.classList.remove('drag');
    pickFile(e.dataTransfer.files[0]);
  });

  function setProgress(pct) {
    progressBar.style.width = `${pct}%`;
    progressPct.textContent = `${Math.round(pct)}%`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selectedFile) { toast('请先选择书籍文件'); return; }
    const title = titleInput.value.trim();
    if (!title) { toast('请填写书名'); return; }

    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('title', title);
    fd.append('author', authorInput.value.trim());
    fd.append('description', descInput.value.trim());
    fd.append('tags', tagsInput.value.trim());
    if (coverInput.files[0]) fd.append('cover', coverInput.files[0]);

    uploadBtn.disabled = true;
    uploadBtn.textContent = '上传中…';
    uploadProgress.classList.remove('hidden');
    uploadResult.className = 'upload-result';
    uploadResult.textContent = '';
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/books');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress((ev.loaded / ev.total) * 100);
    };
    xhr.onload = () => {
      let ok = false;
      let msg = '';
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        ok = xhr.status >= 200 && xhr.status < 300;
        msg = data.error || (ok ? `《${data.title || title}》已入库` : '上传失败');
      } catch {
        ok = xhr.status >= 200 && xhr.status < 300;
        msg = ok ? '上传成功' : `上传失败（${xhr.status}）`;
      }
      if (xhr.status === 401) { window.location.href = '/login'; return; }
      setProgress(100);
      uploadResult.className = `upload-result ${ok ? 'ok' : 'err'}`;
      uploadResult.textContent = msg;
      uploadBtn.disabled = false;
      uploadBtn.textContent = '上传到书库';
      if (ok) {
        selectedFile = null;
        form.reset();
        dropText.classList.remove('hidden');
        fileName.classList.add('hidden');
        loadBooks();
      }
    };
    xhr.onerror = () => {
      uploadResult.className = 'upload-result err';
      uploadResult.textContent = '网络错误，上传失败';
      uploadBtn.disabled = false;
      uploadBtn.textContent = '上传到书库';
    };
    xhr.send(fd);
  });

  // ---------- 书目列表 ----------
  const bookList = document.getElementById('bookList');
  const adminEmpty = document.getElementById('adminEmpty');

  function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function rowHtml(b) {
    return `
      <tr data-id="${esc(b.id)}">
        <td style="font-weight:600">${esc(b.title)}</td>
        <td>${esc(b.author || '—')}</td>
        <td><span class="tag" style="text-transform:uppercase">${esc(b.format)}</span></td>
        <td>${formatSize(b.size) || '—'}</td>
        <td>${fmtDate(b.created_at)}</td>
        <td>
          <div class="btns">
            <button class="btn btn-ghost act-edit">编辑</button>
            <button class="btn btn-danger act-del">删除</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function loadBooks() {
    try {
      const data = await apiGetJson('/api/books?per_page=50');
      const items = data.items || [];
      bookList.innerHTML = items.map(rowHtml).join('');
      adminEmpty.classList.toggle('hidden', items.length > 0);
      if (items.length === 0) {
        bookList.innerHTML = '';
      }
    } catch (err) {
      toast(err.message || '加载失败');
    }
  }

  bookList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;

    if (btn.classList.contains('act-del')) {
      if (!confirm('确定删除这本书吗？文件将一并删除，不可恢复。')) return;
      try {
        await apiDelete(`/api/books/${encodeURIComponent(id)}`);
        toast('已删除');
        loadBooks();
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    if (btn.classList.contains('act-edit')) {
      const book = await getBookMeta(id);
      if (!book) return;
      const formHtml = `
        <div class="edit-form">
          <div class="field"><label>书名</label><input type="text" class="ef-title" value="${esc(book.title)}" /></div>
          <div class="field"><label>作者</label><input type="text" class="ef-author" value="${esc(book.author || '')}" /></div>
          <div class="field"><label>简介</label><input type="text" class="ef-desc" value="${esc(book.description || '')}" /></div>
          <div class="field"><label>标签</label><input type="text" class="ef-tags" value="${esc(book.tags || '')}" /></div>
          <div class="field" style="grid-column:1/-1; display:flex; gap:8px; justify-content:flex-end">
            <button class="btn btn-ghost ef-cancel">取消</button>
            <button class="btn btn-primary ef-save">保存</button>
          </div>
        </div>
      `;
      const row = tr;
      row.innerHTML = `<td colspan="6">${formHtml}</td>`;
      const box = row.querySelector('.edit-form');
      box.querySelector('.ef-cancel').addEventListener('click', () => loadBooks());
      box.querySelector('.ef-save').addEventListener('click', async () => {
        const payload = {
          title: box.querySelector('.ef-title').value.trim(),
          author: box.querySelector('.ef-author').value.trim(),
          description: box.querySelector('.ef-desc').value.trim(),
          tags: box.querySelector('.ef-tags').value.trim(),
        };
        if (!payload.title) { toast('书名不能为空'); return; }
        try {
          await apiPatchJson(`/api/books/${encodeURIComponent(id)}`, payload);
          toast('已保存');
          loadBooks();
        } catch (err) {
          toast(err.message);
        }
      });
    }
  });

  async function getBookMeta(id) {
    try {
      return await apiGetJson(`/api/books/${encodeURIComponent(id)}`);
    } catch (err) {
      toast(err.message);
      return null;
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await apiPostJson('/api/auth/logout', {});
    } catch { /* 忽略 */ }
    window.location.href = '/login';
  });

  loadBooks();
})();
