-- 2027 考研政治 1000 题 · Cloudflare D1 数据库架构规范

-- 1. 用户主表。username 的 UNIQUE 约束已自动建立唯一索引，无需再建重复索引
--    （D1 把索引维护计入「行写入」，重复索引会让每次注册白白多 1 次写入）
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,               -- 用户UUID
    username TEXT UNIQUE NOT NULL,     -- 用户名/账号 (统一转小写)
    nickname TEXT NOT NULL,            -- 展示昵称
    password_hash TEXT NOT NULL,       -- PBKDF2 安全哈希值 (64位hex)
    salt TEXT NOT NULL,                -- 16字节安全随机盐 (32位hex)
    created_at INTEGER NOT NULL,       -- 注册时间戳 (毫秒)
    updated_at INTEGER NOT NULL        -- 最近改密/注册时间戳 (毫秒)，同时用作旧 JWT 吊销基准
);

-- 2. 刷题进度与错题同步表 (单用户 1 行)
CREATE TABLE IF NOT EXISTS user_progress (
    user_id TEXT PRIMARY KEY,
    answers_data TEXT NOT NULL,
    mistakes_data TEXT NOT NULL,
    stats_data TEXT,                   -- 保留列（sync.js 冻结，仍写入 '{}'）
    version INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. 密码重置码表。code 列存 HMAC-SHA256 十六进制摘要(64位)，不再存明文
CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    code TEXT NOT NULL,                -- HMAC(secret, "reset:<username>:<code>")
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,       -- 生成时间 + 15 分钟
    used INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0  -- 尝试计数(原子自增)，上限 5
);

-- 与实际查询 WHERE username = ? AND used = 0 匹配
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(username, used);
CREATE INDEX IF NOT EXISTS idx_resets_expires ON password_resets(expires_at);
