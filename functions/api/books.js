// ============================================================
// /api/books
//   GET    书架列表 / 搜索 / 过滤（分页）
//   POST   上传新书（multipart/form-data）
// ============================================================

import { json, safeExt } from '../_lib/auth.js';

const ALLOWED_FORMATS = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

function formatTags(raw) {
  return (raw || '')
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(',');
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const tag = (url.searchParams.get('tag') || '').trim();
  const format = (url.searchParams.get('format') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(url.searchParams.get('per_page') || '24', 10) || 24));

  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(title LIKE ? OR author LIKE ? OR tags LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (tag) {
    conditions.push('tags LIKE ?');
    params.push(`%${tag}%`);
  }
  if (format && ALLOWED_FORMATS[format]) {
    conditions.push('format = ?');
    params.push(format);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * perPage;

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM books ${where}`)
    .bind(...params)
    .first();
  const list = await env.DB.prepare(
    `SELECT id, title, author, description, tags, format, size, cover_key, created_at
     FROM books ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, perPage, offset)
    .all();

  const items = (list.results || []).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    description: b.description,
    tags: b.tags,
    tags_list: b.tags ? b.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    format: b.format,
    size: b.size,
    created_at: b.created_at,
    file_url: `/api/books/${b.id}/file`,
    cover_url: b.cover_key ? `/api/books/${b.id}/cover` : null,
  }));

  return json({ total: countRow?.total || 0, page, per_page: perPage, items });
}

export async function onRequestPost({ request, env }) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: '请使用 multipart/form-data 上传' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string' || file.size === 0) {
    return json({ error: '缺少书籍文件' }, 400);
  }

  const ext = safeExt(file.name);
  if (!ALLOWED_FORMATS[ext]) {
    return json({ error: `不支持的文件格式：${ext || '未知'}（仅支持 epub / pdf / txt）` }, 400);
  }

  const title = (formData.get('title') || '').trim();
  if (!title) {
    return json({ error: '请填写书名' }, 400);
  }
  const author = (formData.get('author') || '').trim();
  const description = (formData.get('description') || '').trim();
  const tags = formatTags(formData.get('tags'));

  const id = crypto.randomUUID();
  const fileKey = `books/${id}.${ext}`;

  // 可选封面
  const cover = formData.get('cover');
  let coverKey = '';
  if (cover && typeof cover !== 'string' && cover.size > 0) {
    const coverExt = safeExt(cover.name) || 'jpg';
    coverKey = `covers/${id}.${coverExt}`;
    await env.BOOKS_BUCKET.put(coverKey, cover.stream(), {
      httpMetadata: { contentType: cover.type || 'image/jpeg' },
    });
  }

  await env.BOOKS_BUCKET.put(fileKey, file.stream(), {
    httpMetadata: { contentType: ALLOWED_FORMATS[ext] },
  });

  await env.DB.prepare(
    `INSERT INTO books (id, title, author, description, tags, format, size, file_key, cover_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, title, author, description, tags, ext, file.size, fileKey, coverKey, Math.floor(Date.now() / 1000))
    .run();

  return json({ id, title, format: ext }, 201);
}
