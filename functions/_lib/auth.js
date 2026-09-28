// ============================================================
// 共享工具库：鉴权相关的通用函数
// （以 _ 开头的目录不会被 Pages Functions 当作路由）
// ============================================================

/** 统一的 JSON 响应 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** 从请求 Cookie 中读取指定名称的值 */
export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

/** 常量时间比较（避免时序侧信道），用于密码校验 */
export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/** 生成登录会话 Cookie（HttpOnly + Secure + SameSite=Strict） */
export function buildSessionCookie(token, ttlDays, secure) {
  const maxAge = ttlDays * 24 * 3600;
  const secureFlag = secure ? '; Secure' : '';
  return `ebook_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly${secureFlag}; SameSite=Strict`;
}

/** 清除登录会话 Cookie */
export function clearSessionCookie() {
  return 'ebook_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict';
}

/** 文件扩展名（小写、仅字母数字，防止路径注入） */
export function safeExt(name) {
  const n = name || '';
  const dot = n.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = n.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}
