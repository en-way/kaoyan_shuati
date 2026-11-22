-- ============================================================================
-- 迁移脚本: 001_add_bank_id.sql
-- 目标: 将 user_progress 表从单主键 (user_id) 无损升级为复合主键 (user_id, bank_id)
-- 兼容保障: 现有所有用户数据自动归入默认题库 '2027_1000'，完整保留 version 与 updated_at
--
-- 执行前备份命令:
--   npx wrangler d1 export kaoyan-quiz-db --remote --output=./backup_before_001.sql
-- 执行迁移命令:
--   npx wrangler d1 execute kaoyan-quiz-db --remote --file=./functions/migrations/001_add_bank_id.sql
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS user_progress_new (
    user_id TEXT NOT NULL,
    bank_id TEXT NOT NULL DEFAULT '2027_1000',
    answers_data TEXT NOT NULL,
    mistakes_data TEXT NOT NULL,
    stats_data TEXT,
    version INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, bank_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_progress_new (user_id, bank_id, answers_data, mistakes_data, stats_data, version, updated_at)
SELECT
    user_id,
    '2027_1000' AS bank_id,
    COALESCE(answers_data, '{}'),
    COALESCE(mistakes_data, '{}'),
    COALESCE(stats_data, '{}'),
    COALESCE(version, 1),
    COALESCE(updated_at, 0)
FROM user_progress;

DROP TABLE user_progress;

ALTER TABLE user_progress_new RENAME TO user_progress;

PRAGMA foreign_keys = ON;
