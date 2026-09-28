// GET /api/auth/me  当前会话信息（本接口受中间件保护，能到这里即已登录）
import { json } from '../../_lib/auth.js';

export async function onRequestGet({ env }) {
  return json({
    authed: true,
    library_name: env.LIBRARY_NAME || '私人书库',
  });
}
