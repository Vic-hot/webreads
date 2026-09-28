// GET /api/books/:id/file  以正确的 Content-Type 流式返回电子书文件
import { json } from '../../../_lib/auth.js';

const CONTENT_TYPES = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

export async function onRequestGet({ env, params }) {
  const book = await env.DB.prepare('SELECT id, title, format, file_key FROM books WHERE id = ?')
    .bind(params.id)
    .first();
  if (!book) return json({ error: '书籍不存在' }, 404);

  const object = await env.BOOKS_BUCKET.get(book.file_key);
  if (!object) return json({ error: '文件已丢失' }, 404);

  const contentType = CONTENT_TYPES[book.format] || 'application/octet-stream';
  // Header 值必须是 ASCII（Latin-1）：中文书名放进 filename* 的百分号编码里
  const rawTitle = book.title || 'book';
  const asciiName = rawTitle.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').slice(0, 80) || 'book';
  const utf8Name = rawTitle.replace(/[\\/"]/g, '_').slice(0, 80) || 'book';

  const headers = {
    'Content-Type': contentType,
    'Content-Length': String(object.size),
    'Content-Disposition': `inline; filename="${asciiName}.${book.format}"; filename*=UTF-8''${encodeURIComponent(`${utf8Name}.${book.format}`)}`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };

  return new Response(object.body, { headers });
}
