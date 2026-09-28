// GET /api/books/:id/cover  返回书籍封面图
import { json } from '../../../_lib/auth.js';

export async function onRequestGet({ env, params }) {
  const book = await env.DB.prepare('SELECT id, cover_key FROM books WHERE id = ?')
    .bind(params.id)
    .first();
  if (!book || !book.cover_key) return json({ error: '暂无封面' }, 404);

  const object = await env.BOOKS_BUCKET.get(book.cover_key);
  if (!object) return json({ error: '封面已丢失' }, 404);

  const headers = {
    'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
    'Content-Length': String(object.size),
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  };
  return new Response(object.body, { headers });
}
