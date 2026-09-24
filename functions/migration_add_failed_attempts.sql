-- Cloudflare D1 Migration: Add failed_attempts column to password_resets
-- If your password_resets table was created before v18, execute this in Cloudflare D1 Console:
ALTER TABLE password_resets ADD COLUMN failed_attempts INTEGER DEFAULT 0;
