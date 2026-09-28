// ============================================================
// 全局中间件：统一登录鉴权
//
// 规则：
//  - /api/auth/login 与 /login（含 /login.html、/login/）放行
//    —— Cloudflare Pages 会把 /login.html 308 跳转到无扩展名的 /login，
//      两种形式都必须放行，否则会跳转循环
//  - 其余 /api/* 请求必须携带有效会话，否则返回 401 JSON
//  - 其余页面请求（含无扩展名形式）必须携带有效会话，否则 302 跳 /login
//  - 静态资源（css / js / 图片等）不拦截，保证登录页能正常加载
// ============================================================

import { getCookie } from './_lib/auth.js';

const PUBLIC_API_PREFIXES = ['/api/auth/login'];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 放行：登录接口与登录页（含无扩展名规范形式）
  if (path === '/login' || path.startsWith('/login.')) return next();
  if (path.startsWith('/api/') && PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  // 校验会话
  const token = getCookie(request, 'ebook_session');
  let valid = false;
  if (token) {
    const session = await env.SESSIONS.get(token);
    if (session) valid = true;
  }
  if (valid) return next();

  const isApi = path.startsWith('/api/');
  if (isApi) {
    return new Response(JSON.stringify({ error: '未登录或会话已过期' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // 页面请求（.html 或无扩展名）→ 跳登录
  const isPage = path.endsWith('.html') || (path !== '/' && !path.includes('.'));
  if (isPage || path === '/') {
    return Response.redirect(new URL('/login', url), 302);
  }

  // 其余静态资源直接放行
  return next();
}
