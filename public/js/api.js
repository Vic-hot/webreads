/* ============================================================
   私人书库 · 前端共享工具
   ============================================================ */

/** 统一请求封装：401 自动回登录页，非 2xx 抛错误 */
async function apiRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('网络错误，请检查连接后重试');
  }
  if (res.status === 401) {
    // 已在登录页时不要再跳转，避免无限刷新循环
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('请先登录');
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch { /* 忽略非 JSON 响应 */ }
    throw new Error(msg);
  }
  return res;
}

function apiGetJson(path) {
  return apiRequest(path).then((r) => r.json());
}

function apiPostJson(path, body) {
  return apiRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function apiPatchJson(path, body) {
  return apiRequest(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function apiDelete(path) {
  return apiRequest(path, { method: 'DELETE' }).then((r) => r.json());
}

/** HTML 转义，防止 XSS */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 文件大小格式化 */
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 封面占位背景：按书名哈希从暖色调色板取色 */
function coverGradient(title) {
  const palettes = [
    ['#4d6b50', '#7a9550'],
    ['#8a5a2b', '#b0843f'],
    ['#5a4a7a', '#8a77ad'],
    ['#3d6b72', '#6a9aa0'],
    ['#8a4030', '#b06a55'],
    ['#43556e', '#7188a5'],
    ['#6b5a3d', '#97855f'],
  ];
  let h = 0;
  const s = String(title || '书');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const p = palettes[h % palettes.length];
  return `linear-gradient(150deg, ${p[0]}, ${p[1]})`;
}

/** 简易 toast 提示 */
let toastTimer = null;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
