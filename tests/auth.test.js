import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as registerPost } from '../functions/api/auth/register.js';
import { onRequestPost as loginPost } from '../functions/api/auth/login.js';
import { onRequestGet as meGet } from '../functions/api/auth/me.js';
import { onRequestPost as resetPost } from '../functions/api/auth/reset-password.js';
import { onRequestPost as verifyAdminPost } from '../functions/api/admin/verify-secret.js';
import { onRequestPost as genResetPost } from '../functions/api/admin/generate-reset-code.js';
import { signJwt, hashResetCode } from '../functions/utils/auth.js';
import { resetMigrationCacheForTest } from '../functions/utils/db-migrate.js';
import { PBKDF2_ITERATIONS } from '../functions/utils/constants.js';

function createAuthMockDb() {
  const users = new Map();       // username -> row
  const usersById = new Map();   // id -> row
  const progress = new Map();    // userId::bankId -> row
  const rateLimits = new Map();  // bucket -> row
  const resets = new Map();      // id -> row

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      _sql: s,
      _args: [],
      bind(...args) {
        this._args = args;
        return this;
      },
      async first() {
        const [a0, a1] = this._args;
        if (s.startsWith('SELECT id FROM users WHERE username = ?')) {
          const u = users.get(a0);
          return u ? { id: u.id } : null;
        }
        if (s.startsWith('SELECT id, username, nickname, password_hash, salt, token_version, hash_iters FROM users WHERE username = ?')) {
          const u = users.get(a0);
          return u ? { ...u } : null;
        }
        if (s.startsWith('SELECT id, username, nickname, token_version FROM users WHERE username = ?') ||
            s.startsWith('SELECT id, username, nickname FROM users WHERE username = ?')) {
          const u = users.get(a0);
          return u ? { id: u.id, username: u.username, nickname: u.nickname, token_version: u.token_version } : null;
        }
        if (s.startsWith('SELECT id, username, nickname, updated_at, token_version FROM users WHERE id = ?')) {
          const u = usersById.get(a0);
          return u ? { id: u.id, username: u.username, nickname: u.nickname, updated_at: u.updated_at, token_version: u.token_version } : null;
        }
        if (s.startsWith('SELECT fail_count, window_start, locked_until FROM auth_rate_limits WHERE bucket = ?')) {
          const r = rateLimits.get(a0);
          return r ? { ...r } : null;
        }
        if (s.startsWith('SELECT id, code, expires_at, failed_attempts FROM password_resets WHERE username = ?') ||
            s.startsWith('SELECT id, username, code, expires_at, used, failed_attempts FROM password_resets WHERE username = ?')) {
          const list = Array.from(resets.values())
            .filter(r => r.username === a0 && r.used === 0)
            .sort((x, y) => (y.created_at || 0) - (x.created_at || 0));
          return list[0] ? { ...list[0] } : null;
        }
        if (s.startsWith('SELECT count(*) as cnt FROM user_progress')) {
          return { cnt: progress.size };
        }
        return null;
      },
      async all() {
        if (s.includes('PRAGMA table_info(user_progress)')) {
          return { results: [{ name: 'user_id' }, { name: 'bank_id' }, { name: 'answers_data' }, { name: 'mistakes_data' }, { name: 'stats_data' }, { name: 'version' }, { name: 'updated_at' }] };
        }
        if (s.includes('PRAGMA table_info(users)')) {
          return { results: [{ name: 'id' }, { name: 'username' }, { name: 'nickname' }, { name: 'password_hash' }, { name: 'salt' }, { name: 'token_version' }, { name: 'hash_iters' }, { name: 'created_at' }, { name: 'updated_at' }] };
        }
        return { results: [] };
      },
      async run() {
        const args = this._args;
        if (s.startsWith('INSERT INTO users')) {
          const [id, username, nickname, password_hash, salt, token_version, hash_iters, created_at, updated_at] = args;
          if (users.has(username)) throw new Error('UNIQUE constraint failed: users.username');
          const row = { id, username, nickname, password_hash, salt, token_version, hash_iters, created_at, updated_at };
          users.set(username, row);
          usersById.set(id, row);
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('INSERT INTO user_progress')) {
          const [user_id, bank_id, answers_data, mistakes_data, stats_data, updated_at] = args;
          progress.set(`${user_id}::${bank_id}`, { user_id, bank_id, answers_data, mistakes_data, stats_data, version: 1, updated_at });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('INSERT INTO auth_rate_limits')) {
          const [bucket, fail_count, window_start, locked_until] = args;
          rateLimits.set(bucket, { bucket, fail_count, window_start, locked_until });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('DELETE FROM auth_rate_limits WHERE bucket = ?')) {
          const deleted = rateLimits.delete(args[0]) ? 1 : 0;
          return { meta: { changes: deleted } };
        }
        if (s.startsWith('UPDATE password_resets SET used = 1 WHERE username = ?')) {
          for (const r of resets.values()) {
            if (r.username === args[0] && r.used === 0) r.used = 1;
          }
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('INSERT INTO password_resets')) {
          const [id, username, code, created_at, expires_at] = args;
          resets.set(id, { id, username, code, created_at, expires_at, used: 0, failed_attempts: 0 });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('DELETE FROM password_resets')) {
          for (const [k, r] of resets.entries()) {
            if (r.expires_at < args[0] || r.used === 1) resets.delete(k);
          }
          return { meta: { changes: 1 } };
        }
        if (s.startsWith('UPDATE password_resets SET used = 1 WHERE id = ? AND used = 0')) {
          const r = resets.get(args[0]);
          if (r && r.used === 0) {
            r.used = 1;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (s.startsWith('UPDATE password_resets SET failed_attempts = failed_attempts + 1')) {
          const r = resets.get(args[0]);
          if (r) r.failed_attempts += 1;
          return { meta: { changes: r ? 1 : 0 } };
        }
        if (s.startsWith('UPDATE users SET password_hash = ?')) {
          const [password_hash, salt, token_version, hash_iters, updated_at, id] = args;
          const u = usersById.get(id);
          if (u) {
            u.password_hash = password_hash;
            u.salt = salt;
            u.token_version = token_version;
            u.hash_iters = hash_iters;
            u.updated_at = updated_at;
          }
          return { meta: { changes: u ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }

  async function batch(stmts) {
    for (const st of stmts) {
      await st.run();
    }
  }

  return { users, usersById, progress, rateLimits, resets, prepare, batch };
}

describe('Auth / Reset-Password / Admin 安全、限流与 Token 吊销集成测试', () => {
  let db;
  let env;

  beforeEach(() => {
    resetMigrationCacheForTest();
    db = createAuthMockDb();
    env = {
      DB: db,
      JWT_SECRET: 'test-jwt-secret-key-at-least-32-chars-long!',
      ADMIN_SECRET: 'super-admin-secret-2027-strong'
    };
  });

  it('注册成功应返回 200 与有效 JWT；重复账号返回 409', async () => {
    const req1 = new Request('https://kaoyan.test/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify({ username: 'student_01', nickname: '冲刺选手', password: 'Password123' })
    });
    const res1 = await registerPost({ request: req1, env });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.ok(data1.token);
    assert.equal(typeof data1.updatedAt, 'number');
    assert.equal(db.users.get('student_01').hash_iters, PBKDF2_ITERATIONS);

    // 重复用户名应拒绝
    const req2 = new Request('https://kaoyan.test/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify({ username: 'student_01', nickname: '重名', password: 'Password123' })
    });
    const res2 = await registerPost({ request: req2, env });
    assert.equal(res2.status, 409);
  });

  it('连续输错密码与不存在用户均受恒定路径与 429 限流保护', async () => {
    await registerPost({
      request: new Request('https://kaoyan.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.5' },
        body: JSON.stringify({ username: 'bob2027', password: 'CorrectPass99' })
      }),
      env
    });

    // 不存在账号应返回 401 且计入 IP 限流
    const missingRes = await loginPost({
      request: new Request('https://kaoyan.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.9' },
        body: JSON.stringify({ username: 'ghost_user', password: 'AnyPassword1' })
      }),
      env
    });
    assert.equal(missingRes.status, 401);

    // 对 bob2027 连续输错 10 次 (LOGIN_USER maxFails = 10) 后触发第 11 次 429 RATE_LIMITED
    for (let i = 0; i < 10; i++) {
      const failRes = await loginPost({
        request: new Request('https://kaoyan.test/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.5' },
          body: JSON.stringify({ username: 'bob2027', password: `Wrong_${i}` })
        }),
        env
      });
      assert.equal(failRes.status, 401);
    }

    const lockedRes = await loginPost({
      request: new Request('https://kaoyan.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.5' },
        body: JSON.stringify({ username: 'bob2027', password: 'CorrectPass99' })
      }),
      env
    });
    assert.equal(lockedRes.status, 429);
    const lockedBody = await lockedRes.json();
    assert.equal(lockedBody.code, 'RATE_LIMITED');
  });

  it('重置密码原子递增 token_version：同秒签发的旧 JWT 在 /api/auth/me 立即被吊销 (401 TOKEN_REVOKED)', async () => {
    const regRes = await registerPost({
      request: new Request('https://kaoyan.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
        body: JSON.stringify({ username: 'alice27', password: 'OldPassword1' })
      }),
      env
    });
    const { token: oldToken, user } = await regRes.json();

    // 生成重置码
    const genRes = await genResetPost({
      request: new Request('https://kaoyan.test/api/admin/generate-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.2' },
        body: JSON.stringify({ adminSecret: env.ADMIN_SECRET, username: 'alice27' })
      }),
      env
    });
    assert.equal(genRes.status, 200);
    const { code } = await genRes.json();

    // 重置密码并拿到新 token
    const rstRes = await resetPost({
      request: new Request('https://kaoyan.test/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.3' },
        body: JSON.stringify({ username: 'alice27', code, newPassword: 'NewPassword2' })
      }),
      env
    });
    assert.equal(rstRes.status, 200);
    const rstBody = await rstRes.json();
    assert.ok(rstBody.token);
    assert.equal(db.usersById.get(user.id).token_version, 2);

    // 即便伪造一个 iat 比 updated_at 更新、但 tv 仍为 1 的旧凭证也必须被 token_version 吊销
    const sameSecOldTvToken = await signJwt({ id: user.id, username: 'alice27', nickname: 'alice27', tv: 1 }, env);
    for (const badToken of [oldToken, sameSecOldTvToken]) {
      const meBad = await meGet({
        request: new Request('https://kaoyan.test/api/auth/me', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${badToken}` }
        }),
        env
      });
      assert.equal(meBad.status, 401);
      const meBadBody = await meBad.json();
      assert.equal(meBadBody.code, 'TOKEN_REVOKED');
    }

    // 新 token (tv = 2) 应正常放行
    const meGood = await meGet({
      request: new Request('https://kaoyan.test/api/auth/me', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${rstBody.token}` }
      }),
      env
    });
    assert.equal(meGood.status, 200);
  });

  it('Admin 接口错误密钥失败不泄露配置状态、支持空体 Header 校验并执行 429 限流，且缺少 JWT_SECRET 时 /me 返回 500 CONFIG_ERROR', async () => {
    // 1. Header 密钥空体校验成功
    const okRes = await verifyAdminPost({
      request: new Request('https://kaoyan.test/api/admin/verify-secret', {
        method: 'POST',
        headers: { 'x-admin-secret': env.ADMIN_SECRET, 'cf-connecting-ip': '203.0.113.50' }
      }),
      env
    });
    assert.equal(okRes.status, 200);

    // 2. 错误密钥不泄露 isCustomConfigured，且超过阈值 (ADMIN_IP maxFails = 8) 返回 429
    for (let i = 0; i < 8; i++) {
      const failRes = await verifyAdminPost({
        request: new Request('https://kaoyan.test/api/admin/verify-secret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.51' },
          body: JSON.stringify({ adminSecret: 'wrong-secret' })
        }),
        env
      });
      assert.equal(failRes.status, 403);
      const body = await failRes.json();
      assert.equal(body.isCustomConfigured, undefined);
    }

    const rateRes = await verifyAdminPost({
      request: new Request('https://kaoyan.test/api/admin/verify-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.51' },
        body: JSON.stringify({ adminSecret: env.ADMIN_SECRET })
      }),
      env
    });
    assert.equal(rateRes.status, 429);

    // 3. JWT_SECRET 缺失时受保护接口明确返回 500 CONFIG_ERROR（而非伪装 401）
    const brokenEnv = { DB: db };
    const cfgRes = await meGet({
      request: new Request('https://kaoyan.test/api/auth/me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer a.b.c' }
      }),
      env: brokenEnv
    });
    assert.equal(cfgRes.status, 500);
    const cfgBody = await cfgRes.json();
    assert.equal(cfgBody.code, 'CONFIG_ERROR');
  });
});
