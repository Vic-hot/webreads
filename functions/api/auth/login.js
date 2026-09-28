// POST /api/auth/login  密码登录
import { json, timingSafeEqual, buildSessionCookie } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const expected = env.LIBRARY_PASSWORD || '';

  if (!expected) {
    return json({ error: '服务端尚未配置登录密码' }, 500);
  }
  if (!timingSafeEqual(password, expected)) {
    return json({ error: '密码错误' }, 401);
  }

  const token = crypto.randomUUID();
  const ttlDays = parseInt(env.SESSION_TTL_DAYS || '30', 10) || 30;
  const ttlSeconds = ttlDays * 24 * 3600;

  await env.SESSIONS.put(token, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: ttlSeconds,
  });

  const res = json({ ok: true, library_name: env.LIBRARY_NAME || '私人书库' });
  res.headers.append('Set-Cookie', buildSessionCookie(token, ttlDays, secure));
  return res;
}
