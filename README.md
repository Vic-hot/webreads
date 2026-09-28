# 📚 私人书库 · Cloudflare 部署版

一套部署在 **Cloudflare Pages + R2 + D1 + KV** 上的私人电子书库：书架管理 + 在线阅读（**EPUB / PDF / TXT**），带密码保护。

- 前端：原生 HTML/CSS/JS（书架、阅读器、管理后台、登录页）
- 后端：Cloudflare Pages Functions（鉴权、书目 API、文件上传与流式下发）
- 存储：R2 存放书籍文件与封面；D1 存放书目元数据；KV 存放登录会话
- 阅读：EPUB 用 epub.js、PDF 用 pdf.js、TXT 原生渲染；进度自动保存、续读恢复

---

## 一、项目结构

```
ebook-library/
├── wrangler.toml          # Cloudflare 资源配置（部署前需填真实 ID）
├── schema.sql             # D1 数据库初始化脚本
├── package.json
├── functions/             # Pages Functions（后端）
│   ├── _middleware.js     # 全局鉴权中间件
│   ├── _lib/auth.js       # 共享工具（Cookie / 密码校验 / JSON 响应）
│   └── api/
│       ├── auth/          # login / logout / me
│       └── books/         # 列表 / 上传 / 详情 / 编辑 / 删除 / 文件流 / 封面
└── public/                # 静态前端
    ├── index.html         # 书架
    ├── reader.html        # 阅读器
    ├── admin.html         # 管理（上传 / 编辑 / 删除）
    ├── login.html         # 登录
    ├── css/style.css
    ├── js/                # api / bookshelf / reader / admin / login
    └── vendor/            # 本地托管的第三方库（JSZip / epub.js / pdf.js，版本锁定）
```

## 二、本地预览（可选）

```bash
npm install                 # 安装 wrangler
npm run dev                 # 启动本地开发服务器（localhost:8788）
```

本地开发时登录密码使用 `wrangler.toml` 中的 `LIBRARY_PASSWORD` 占位值
（部署前请务必用下面的 `secret put` 覆盖成真实密码）。

## 三、云端部署（推荐，约 10 分钟）

> 前提：注册 [Cloudflare](https://dash.cloudflare.com/sign-up) 账号（免费即可）。

### 1. 安装并登录 wrangler

```bash
npm install -g wrangler     # 或使用 npx wrangler
wrangler login              # 浏览器中授权
```

### 2. 创建云资源

```bash
# R2 存储桶
wrangler r2 bucket create ebook-library-bucket

# D1 数据库（记下输出的 database_id）
wrangler d1 create ebook-library-db

# KV 命名空间（记下输出的 id）
wrangler kv namespace create SESSIONS
```

### 3. 填写 wrangler.toml

把上一步输出的 `database_id` 和 KV `id` 填到 `wrangler.toml` 对应位置
（替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID` / `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`）。

### 4. 初始化数据库

```bash
wrangler d1 execute ebook-library-db --file=./schema.sql --remote
```

### 5. 设置访问密码（重要）

```bash
wrangler pages secret put LIBRARY_PASSWORD --project-name ebook-library
# 按提示输入你的访问密码（例如：MySecret2026）
```

### 6. 部署

```bash
wrangler pages deploy
```

部署完成后终端会输出一个 `*.pages.dev` 的 HTTPS 地址，用浏览器打开即可。
（也可以之后在 Cloudflare 控制台绑定自己的域名。）

### 7. 日常使用

| 操作 | 地址 |
|---|---|
| 登录 / 书架 | `https://你的地址/`（或 `/login.html`） |
| 管理（上传 / 删除 / 编辑） | `https://你的地址/admin.html` |
| 阅读 | 书架上点任意一本书 |

---

## 四、常见问题

**Q1：部署后访问报 500 / 数据库未初始化？**
检查是否执行了第 4 步的 `wrangler d1 execute ... --remote`。

**Q2：上传大文件失败？**
Pages Functions 单次请求体上限 100MB。建议单本书控制在 80MB 以内，
绝大多数 EPUB/PDF/TXT 远小于此。

**Q3：密码忘了 / 想改密码？**
重新执行 `wrangler pages secret put LIBRARY_PASSWORD --project-name ebook-library` 即可，
会话不受影响。

**Q4：想在手机上阅读？**
浏览器打开网址即可，页面已适配移动端。也可以添加到主屏幕当 App 用。

**Q5：免费额度够用吗？**
个人使用完全够：Pages 静态托管免费、R2 免费 10GB 存储、D1 免费 5GB、
KV 免费 10 万次读/天、Functions 每天 10 万次请求。

## 五、安全说明

- 整个站点（除登录页）都要求登录会话，会话 Cookie 为 `HttpOnly + Secure + SameSite=Strict`；
- 密码通过 `wrangler secret put` 加密存储，不落盘在任何文件；
- 书籍文件只在登录后通过 `/api/books/:id/file` 下发，静态目录不含任何书稿；
- 书库数据全部存放在你自己的 Cloudflare 账号下，不经过任何第三方存储。

## 六、技术备注

- 第三方库（JSZip 3.10.1 / epub.js 0.3.93 / pdf.js 2.16.105 及 worker）全部**本地托管在 `public/vendor/`**，版本锁定、不依赖外部 CDN；
  - pdf.js 特意锁定 2.16.105：3.x 的 canvas 渲染在部分环境会永久挂起，2.x 兼容性最稳；
  - pdf.js 的 worker 必须与页面**同源**（`/vendor/pdf.worker.min.js`）：跨域 `new Worker` 会被浏览器拦截，导致渲染卡死；阅读器统一使用同步渲染（`intent: 'print'`），对正常浏览器同样更快更稳；
  - 升级方式：替换 `public/vendor/` 下文件，并同步修改 `reader.html` 的 `<script>` 引用与 `reader.js` 中 `workerSrc` 路径。
- 阅读进度与阅读设置保存在浏览器 `localStorage`（按书 ID 区分），换设备不共享；
- 换域名 / 清空浏览器数据后进度会丢失，属预期行为；
- 若要支持超大文件（>100MB），可改用 R2 分片上传，本版本未包含。
