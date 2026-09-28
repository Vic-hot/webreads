// POST /api/auth/logout  退出登录（清除会话）
import { json, getCookie, clearSessionCookie } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const token = getCookie(request, 'ebook_session');
  if (token) {
    await env.SESSIONS.delete(token);
  }
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}
