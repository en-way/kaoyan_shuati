-- 2027 考研政治 1000 题 · Cloudflare D1 数据库架构规范

-- 1. 用户主表 (单用户 1 行，记录基础账号信息与 PBKDF2 安全密码哈希)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,               -- 用户UUID
    username TEXT UNIQUE NOT NULL,     -- 用户名/账号 (统一转小写，唯一索引)
    nickname TEXT NOT NULL,            -- 展示昵称
    password_hash TEXT NOT NULL,       -- PBKDF2 安全哈希值 (64位hex)
    salt TEXT NOT NULL,                -- 16字节安全随机盐 (32位hex)
    created_at INTEGER NOT NULL,       -- 注册时间戳 (毫秒)
    updated_at INTEGER NOT NULL        -- 最后活跃时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2. 刷题进度与错题同步表 (单用户 1 行，采用极精简紧凑数组 JSON，全书 1148 题答完仅占约 18KB)
CREATE TABLE IF NOT EXISTS user_progress (
    user_id TEXT PRIMARY KEY,          -- 外键关联 users.id (1对1)
    answers_data TEXT NOT NULL,        -- 紧凑数组 JSON: {"1":["A",1,1710000000],"2":["ABC",1,1710000010]}
    mistakes_data TEXT NOT NULL,       -- 紧凑数组 JSON: {"3":[2,"B",1710000020]} (题号: [做错次数, 最后选择, 时间戳])
    stats_data TEXT,                   -- 紧凑统计指标 JSON (例如今日刷题用时、完成总数)
    version INTEGER DEFAULT 1,         -- 数据版本号
    updated_at INTEGER NOT NULL,       -- 最后同步时间戳 (毫秒)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. 密码重置码表 (管理员凭 ADMIN_SECRET 发放，15分钟有效，单次使用即作废，连续输错5次锁定)
CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,               -- UUID
    username TEXT NOT NULL,            -- 关联用户名
    code TEXT NOT NULL,                -- 6位纯数字重置验证码
    created_at INTEGER NOT NULL,       -- 生成时间戳 (毫秒)
    expires_at INTEGER NOT NULL,       -- 过期时间戳 (生成时间 + 15分钟)
    used INTEGER DEFAULT 0,            -- 0 未使用, 1 已使用
    failed_attempts INTEGER DEFAULT 0  -- 输错次数计数器 (上限 5 次防暴力破解)
);

CREATE INDEX IF NOT EXISTS idx_resets_user_code ON password_resets(username, code);
CREATE INDEX IF NOT EXISTS idx_resets_expires ON password_resets(expires_at);
