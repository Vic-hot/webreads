-- ============================================================
-- 私人书库 · D1 数据库初始化脚本
-- 用法：wrangler d1 execute ebook-library-db --file=./schema.sql --remote
-- ============================================================

CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,              -- 书籍唯一 ID（UUID）
  title       TEXT NOT NULL,                 -- 书名
  author      TEXT DEFAULT '',               -- 作者
  description TEXT DEFAULT '',               -- 简介
  tags        TEXT DEFAULT '',               -- 标签，英文逗号分隔
  format      TEXT NOT NULL,                 -- 文件格式：epub / pdf / txt
  size        INTEGER DEFAULT 0,             -- 文件大小（字节）
  file_key    TEXT NOT NULL,                 -- 文件在 R2 中的对象键
  cover_key   TEXT DEFAULT '',               -- 封面在 R2 中的对象键
  created_at  INTEGER NOT NULL               -- 入库时间（Unix 秒）
);

CREATE INDEX IF NOT EXISTS idx_books_title     ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_created   ON books(created_at);
