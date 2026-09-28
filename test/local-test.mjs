/* ============================================================
   本地端到端测试：直接驱动真实的 Pages Functions 代码
   - D1     → node:sqlite 内存库（真实 SQLite 语义）
   - KV     → 内存 Map（含 TTL 语义）
   - R2     → 内存 Map（含字节流）
   运行：node test/local-test.mjs
   ============================================================ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const load = (p) => import(pathToFileURL(p).href);

// ---------- 加载真实 Functions 代码 ----------
const middleware = await load(join(root, 'functions/_middleware.js'));
const login = await load(join(root, 'functions/api/auth/login.js'));
const logout = await load(join(root, 'functions/api/auth/logout.js'));
const books = await load(join(root, 'functions/api/books.js'));
const bookDetail = await load(join(root, `functions/api/books/[id].js`));
const bookFile = await load(join(root, `functions/api/books/[id]/file.js`));
const bookCover = await load(join(root, `functions/api/books/[id]/cover.js`));

// ---------- Mock：D1（真实 SQLite） ----------
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));

const DB = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      _args: [],
      bind(...args) {
        this._args = args;
        return this;
      },
      async run() {
        const r = this._args.length ? stmt.run(...this._args) : stmt.run();
        return { meta: { changes: r.changes } };
      },
      async all() {
        return { results: this._args.length ? stmt.all(...this._args) : stmt.all() };
      },
      async first() {
        const row = this._args.length ? stmt.get(...this._args) : stmt.get();
        return row === undefined ? null : row;
      },
    };
  },
};

// ---------- Mock：KV ----------
const kvMap = new Map();
const SESSIONS = {
  async put(k, v, opts = {}) {
    kvMap.set(k, {
      value: v,
      exp: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : Infinity,
    });
  },
  async get(k) {
    const e = kvMap.get(k);
    if (!e) return null;
    if (Date.now() > e.exp) { kvMap.delete(k); return null; }
    return e.value;
  },
  async delete(k) { kvMap.delete(k); },
};

// ---------- Mock：R2 ----------
const r2Map = new Map();
function streamToBuffer(stream) {
  return new Response(stream).arrayBuffer().then((b) => Buffer.from(b));
}
function bufferToStream(buf) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}
const BOOKS_BUCKET = {
  async put(key, stream, opts = {}) {
    const buf = await streamToBuffer(stream);
    r2Map.set(key, { body: buf, size: buf.length, httpMetadata: opts.httpMetadata });
    return { key };
  },
  async get(key) {
    const o = r2Map.get(key);
    if (!o) return null;
    return { body: bufferToStream(o.body), size: o.size, httpMetadata: o.httpMetadata, key };
  },
  async delete(key) { r2Map.delete(key); },
};

// ---------- Mock：环境 ----------
const env = {
  DB,
  SESSIONS,
  BOOKS_BUCKET,
  LIBRARY_PASSWORD: 'test-password',
  SESSION_TTL_DAYS: '30',
  LIBRARY_NAME: '测试书库',
};

// ---------- 测试工具 ----------
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function req(path, { method = 'GET', body, headers = {} } = {}) {
  // 用 https 模拟线上环境，验证 Secure Cookie 属性
  return new Request(`https://localhost${path}`, { method, body, headers });
}

async function body(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ---------- 测试流程 ----------
console.log('\n== 1. 鉴权 ==');

let r = await login.onRequestPost({ request: req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }), headers: { 'Content-Type': 'application/json' } }), env });
check('错误密码返回 401', r.status === 401);

r = await login.onRequestPost({ request: req('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'test-password' }), headers: { 'Content-Type': 'application/json' } }), env });
check('正确密码返回 200', r.status === 200);
const setCookie = r.headers.get('Set-Cookie') || '';
const token = (setCookie.match(/ebook_session=([^;]+)/) || [])[1];
check('下发会话 Cookie', Boolean(token));
check('Cookie 含 HttpOnly/Secure/SameSite', /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie));

const authedHeaders = { Cookie: `ebook_session=${token}` };

// 中间件：未登录
r = await middleware.onRequest({ request: req('/api/books'), env, next: async () => new Response('next-called', { status: 200 }) });
check('未登录访问 API → 401', r.status === 401);
r = await middleware.onRequest({ request: req('/index.html'), env, next: async () => new Response('next-called', { status: 200 }) });
check('未登录访问页面 → 302 跳登录', r.status === 302 && (r.headers.get('Location') || '').endsWith('/login'));
r = await middleware.onRequest({ request: req('/login.html'), env, next: async () => new Response('login-page', { status: 200 }) });
check('登录页放行', r.status === 200);

// 中间件：已登录
r = await middleware.onRequest({ request: req('/api/books', { headers: authedHeaders }), env, next: async () => new Response('next-called', { status: 200 }) });
check('已登录访问 API 放行', r.status === 200 && (await r.text()) === 'next-called');

console.log('\n== 2. 上传 ==');

function makeFile(name, type, textOrBytes) {
  const buf = typeof textOrBytes === 'string' ? Buffer.from(textOrBytes, 'utf8') : Buffer.from(textOrBytes);
  return new File([new Uint8Array(buf)], name, { type });
}

const epubBytes = Buffer.from('PK\u0003\u0004 fake-epub-content', 'latin1');
let fd = new FormData();
fd.append('file', makeFile('三体.epub', 'application/epub+zip', epubBytes));
fd.append('title', '三体');
fd.append('author', '刘慈欣');
fd.append('tags', '科幻, 经典');
fd.append('description', '地球往事三部曲');
fd.append('cover', makeFile('cover.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
r = await books.onRequestPost({ request: req('/api/books', { method: 'POST', body: fd }), env });
check('上传 EPUB 成功 → 201', r.status === 201);
const epubId = (await body(r)).id;
check('返回书籍 ID', Boolean(epubId));

fd = new FormData();
fd.append('file', makeFile('武侠.txt', 'text/plain', '第一回 风起\n第一章 初入江湖\n行侠仗义。\n第二章 大战'));
fd.append('title', '江湖录');
r = await books.onRequestPost({ request: req('/api/books', { method: 'POST', body: fd }), env });
check('上传 TXT 成功 → 201', r.status === 201);
const txtId = (await body(r)).id;

fd = new FormData();
fd.append('file', makeFile('手册.pdf', 'application/pdf', '%PDF-1.4 fake'));
fd.append('title', '使用手册');
r = await books.onRequestPost({ request: req('/api/books', { method: 'POST', body: fd }), env });
check('上传 PDF 成功 → 201', r.status === 201);
const pdfId = (await body(r)).id;

fd = new FormData();
fd.append('file', makeFile('文档.docx', 'application/zip', 'docx'));
fd.append('title', '不支持格式');
r = await books.onRequestPost({ request: req('/api/books', { method: 'POST', body: fd }), env });
check('不支持格式 → 400', r.status === 400);

fd = new FormData();
fd.append('file', makeFile('无名.txt', 'text/plain', '内容'));
r = await books.onRequestPost({ request: req('/api/books', { method: 'POST', body: fd }), env });
check('缺书名 → 400', r.status === 400);

console.log('\n== 3. 列表与搜索 ==');

r = await books.onRequestGet({ request: req('/api/books'), env });
const list = await body(r);
check('列表返回 3 本书', list.total === 3 && list.items.length === 3);
check('列表按时间倒序（最新在前）', list.items[0].id === pdfId);
check('列表项含 file_url/cover_url 字段', Boolean(list.items.find((b) => b.id === epubId)?.cover_url) && Boolean(list.items.find((b) => b.id === epubId)?.file_url));
check('标签解析正确', (list.items.find((b) => b.id === epubId)?.tags_list || []).join(',') === '科幻,经典');

r = await books.onRequestGet({ request: req('/api/books?q=刘慈欣'), env });
check('按作者搜索命中 1 本', (await body(r)).total === 1);

r = await books.onRequestGet({ request: req('/api/books?format=txt'), env });
const txtList = await body(r);
check('按格式过滤命中 1 本', txtList.total === 1 && txtList.items[0].id === txtId);

r = await books.onRequestGet({ request: req('/api/books?per_page=2&page=2'), env });
check('分页第 2 页剩 1 本', (await body(r)).items.length === 1);

console.log('\n== 4. 详情与文件流 ==');

r = await bookDetail.onRequestGet({ request: req('/api/books/' + epubId), env, params: { id: epubId } });
const detail = await body(r);
check('详情返回 200 且字段完整', r.status === 200 && detail.title === '三体' && detail.format === 'epub');

r = await bookDetail.onRequestGet({ request: req('/api/books/nonexistent'), env, params: { id: 'nonexistent' } });
check('不存在的书 → 404', r.status === 404);

r = await bookFile.onRequestGet({ request: req('/api/books/' + epubId + '/file'), env, params: { id: epubId } });
const fileBuf = Buffer.from(await r.arrayBuffer());
check('EPUB 文件流：类型正确', r.headers.get('Content-Type') === 'application/epub+zip');
check('EPUB 文件流：内容一致', fileBuf.equals(epubBytes));
check('EPUB 文件流：Content-Disposition 内联', /inline/.test(r.headers.get('Content-Disposition') || ''));

r = await bookFile.onRequestGet({ request: req('/api/books/' + txtId + '/file'), env, params: { id: txtId } });
check('TXT 文件流：text/plain', (r.headers.get('Content-Type') || '').startsWith('text/plain'));

r = await bookCover.onRequestGet({ request: req('/api/books/' + epubId + '/cover'), env, params: { id: epubId } });
check('封面返回 200', r.status === 200);
r = await bookCover.onRequestGet({ request: req('/api/books/' + txtId + '/cover'), env, params: { id: txtId } });
check('无封面 → 404', r.status === 404);

console.log('\n== 5. 编辑与删除 ==');

r = await bookDetail.onRequestPatch({ request: req('/api/books/' + txtId, { method: 'PATCH', body: JSON.stringify({ title: '江湖录·修订版', tags: '武侠,新书' }), headers: { 'Content-Type': 'application/json' } }), env, params: { id: txtId } });
const patched = await body(r);
check('PATCH 修改书名/标签成功', r.status === 200 && patched.title === '江湖录·修订版' && patched.tags === '武侠,新书');

r = await bookDetail.onRequestPatch({ request: req('/api/books/' + txtId, { method: 'PATCH', body: JSON.stringify({ title: '  ' }), headers: { 'Content-Type': 'application/json' } }), env, params: { id: txtId } });
check('PATCH 空书名 → 400', r.status === 400);

r = await bookDetail.onRequestDelete({ request: req('/api/books/' + txtId, { method: 'DELETE' }), env, params: { id: txtId } });
check('删除成功', r.status === 200);
r = await bookDetail.onRequestGet({ request: req('/api/books/' + txtId), env, params: { id: txtId } });
check('删除后查询 → 404', r.status === 404);
r = await bookFile.onRequestGet({ request: req('/api/books/' + txtId + '/file'), env, params: { id: txtId } });
check('删除后文件 → 404', r.status === 404);
check('R2 中文件对象已清理', !r2Map.has(`books/${txtId}.txt`));

console.log('\n== 6. 登出 ==');

r = await logout.onRequestPost({ request: req('/api/auth/logout', { method: 'POST', headers: authedHeaders }), env });
check('登出返回 200', r.status === 200);
const clearCookie = r.headers.get('Set-Cookie') || '';
check('下发清除 Cookie', /ebook_session=;/.test(clearCookie));
check('KV 会话已删除', (await SESSIONS.get(token)) === null);

// ---------- 汇总 ----------
console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
if (failed) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
