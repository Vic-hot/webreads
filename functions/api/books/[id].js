// ============================================================
// /api/books/:id
//   GET     书籍详情
//   PATCH   编辑元数据（书名 / 作者 / 简介 / 标签）
//   DELETE  删除书籍（连同 R2 中的文件与封面）
// ============================================================

import { json } from '../../_lib/auth.js';

function normalizeTags(raw) {
  return (raw || '')
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(',');
}

function toDetail(b) {
  return {
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
  };
}

export async function onRequestGet({ env, params }) {
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(params.id).first();
  if (!book) return json({ error: '书籍不存在' }, 404);
  return json(toDetail(book));
}

export async function onRequestPatch({ request, env, params }) {
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(params.id).first();
  if (!book) return json({ error: '书籍不存在' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const sets = [];
  const values = [];
  const fields = { title: 'title', author: 'author', description: 'description', tags: 'tags' };

  if (typeof body.title === 'string') {
    const v = body.title.trim();
    if (!v) return json({ error: '书名不能为空' }, 400);
    sets.push('title = ?');
    values.push(v);
  }
  if (typeof body.author === 'string') {
    sets.push('author = ?');
    values.push(body.author.trim());
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?');
    values.push(body.description.trim());
  }
  if (typeof body.tags === 'string') {
    sets.push('tags = ?');
    values.push(normalizeTags(body.tags));
  }
  if (!sets.length) return json({ error: '没有需要修改的字段' }, 400);

  values.push(params.id);
  await env.DB.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(params.id).first();
  return json(toDetail(updated));
}

export async function onRequestDelete({ env, params }) {
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(params.id).first();
  if (!book) return json({ error: '书籍不存在' }, 404);

  await env.BOOKS_BUCKET.delete(book.file_key);
  if (book.cover_key) {
    await env.BOOKS_BUCKET.delete(book.cover_key);
  }
  await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(params.id).run();

  return json({ ok: true });
}
