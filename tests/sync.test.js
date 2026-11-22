import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/progress/sync.js';
import { signJwt } from '../functions/utils/auth.js';
import { ensureMultiBankSchema, resetMigrationCacheForTest } from '../functions/utils/db-migrate.js';

/**
 * 内存级 Cloudflare D1 Mock，完整模拟 users 与 user_progress 复合主键 (user_id, bank_id) 读写
 */
function createMockD1() {
  const users = new Map();
  const progress = new Map(); // key: `${userId}::${bankId}`

  users.set('u_1001', {
    id: 'u_1001',
    username: 'testuser',
    nickname: '测试同学',
    updated_at: 1700000000000
  });

  return {
    users,
    progress,
    writeCount: 0,
    prepare(sql) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      const self = this;
      return {
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async first() {
          // 1. getAuthUser 查询用户表
          if (normalizedSql.includes('FROM users WHERE id = ?')) {
            const [uid] = this._args;
            return users.get(uid) || null;
          }
          // 2. sync.js LEFT JOIN 查询
          if (normalizedSql.includes('FROM users u LEFT JOIN user_progress p')) {
            const [bankId, uid] = this._args;
            const u = users.get(uid);
            if (!u) return null;
            const p = progress.get(`${uid}::${bankId}`);
            return {
              uid: u.id,
              answers_data: p ? p.answers_data : null,
              mistakes_data: p ? p.mistakes_data : null,
              version: p ? p.version : null,
              updated_at: p ? p.updated_at : null
            };
          }
          return null;
        },
        async run() {
          if (normalizedSql.includes('INSERT INTO user_progress')) {
            const [userId, bankId, answersJson, mistakesJson, version, updatedAt] = this._args;
            progress.set(`${userId}::${bankId}`, {
              user_id: userId,
              bank_id: bankId,
              answers_data: answersJson,
              mistakes_data: mistakesJson,
              version,
              updated_at: updatedAt
            });
            self.writeCount++;
            return { success: true };
          }
          return { success: true };
        }
      };
    }
  };
}

describe('functions/api/progress/sync.js 多题库云同步、时间戳合并与乐观锁 409', () => {
  let db;
  let env;
  let token;

  beforeEach(async () => {
    db = createMockD1();
    env = { DB: db, JWT_SECRET: 'unit_test_jwt_secret_2027_32chars_long!!' };
    token = await signJwt({ id: 'u_1001', username: 'testuser', nickname: '测试同学' }, env);
  });

  it('缺省 bankId 时自动回退到 2027_1000，非法 bankId 返回 400', async () => {
    // 1. POST 不传 bankId -> 默认写入 2027_1000
    const postReq = new Request('https://kaoyan.test/api/progress/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        answers: { Q_0001: ['A', 1, 1000, 0] },
        mistakes: {}
      })
    });
    const postRes = await onRequestPost({ request: postReq, env });
    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.bankId, '2027_1000');
    assert.equal(postBody.version, 1);

    // 2. GET 不传 bankId -> 默认读取 2027_1000
    const getReq = new Request('https://kaoyan.test/api/progress/sync', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getRes = await onRequestGet({ request: getReq, env });
    const getBody = await getRes.json();
    assert.equal(getBody.bankId, '2027_1000');
    assert.deepEqual(getBody.answers.Q_0001, ['A', 1, 1000, 0]);

    // 3. 非法 bankId -> 400 INVALID_BANK_ID
    const badReq = new Request('https://kaoyan.test/api/progress/sync?bankId=../etc/passwd', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const badRes = await onRequestGet({ request: badReq, env });
    assert.equal(badRes.status, 400);
    const badBody = await badRes.json();
    assert.equal(badBody.code, 'INVALID_BANK_ID');
  });

  it('多端同一题不同时间戳合并：新记录覆盖旧记录，旧记录不覆盖新记录', async () => {
    // 设备 A 先上传 Q_0001 (t=2000) 与 Q_0002 (t=5000)
    await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          answers: {
            Q_0001: ['A', 0, 2000, 0],
            Q_0002: ['ABD', 1, 5000, 1]
          },
          mistakes: {}
        })
      }),
      env
    });

    // 设备 B 上传 Q_0001 (t=4000, 更新) 与 Q_0002 (t=3000, 更旧) 与 Q_0003 (t=6000, 新增)
    const resB = await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          answers: {
            Q_0001: ['B', 1, 4000, 0],
            Q_0002: ['AB', 0, 3000, 0],
            Q_0003: ['C', 1, 6000, 0]
          },
          mistakes: {}
        })
      }),
      env
    });

    const dataB = await resB.json();
    assert.equal(dataB.success, true);
    assert.equal(dataB.version, 2);
    assert.deepEqual(dataB.answers.Q_0001, ['B', 1, 4000, 0]);   // 新时间戳胜出
    assert.deepEqual(dataB.answers.Q_0002, ['ABD', 1, 5000, 1]); // 云端较新记录得以保留
    assert.deepEqual(dataB.answers.Q_0003, ['C', 1, 6000, 0]);   // 新增题合并成功
  });

  it('version 乐观锁冲突检测：当 expectedVersion 与云端不一致时返回 409', async () => {
    // 初始写入 (version = 1)
    await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          answers: { Q_0001: ['A', 1, 1000, 0] },
          mistakes: {}
        })
      }),
      env
    });

    // 另一设备更新后 version 变为 2
    await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          expectedVersion: 1,
          answers: { Q_0002: ['B', 1, 2000, 0] },
          mistakes: {}
        })
      }),
      env
    });

    // 旧设备仍携带 expectedVersion: 1 发起请求 -> 应返回 409 VERSION_CONFLICT
    const conflictRes = await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          expectedVersion: 1,
          answers: { Q_0003: ['C', 1, 3000, 0] },
          mistakes: {}
        })
      }),
      env
    });

    assert.equal(conflictRes.status, 409);
    const conflictBody = await conflictRes.json();
    assert.equal(conflictBody.code, 'VERSION_CONFLICT');
    assert.equal(conflictBody.version, 2);
    assert.ok(conflictBody.answers.Q_0002);
  });

  it('显式 overwrite: true 支持清空重置章节，且相同内容二次提交跳过 D1 写入', async () => {
    await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          answers: { Q_0001: ['A', 1, 1000, 0], Q_0002: ['B', 1, 2000, 0] },
          mistakes: {}
        })
      }),
      env
    });
    assert.equal(db.writeCount, 1);

    // 相同数据再次提交 -> notModified: true，D1 写入次数不增加
    const dupRes = await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          answers: { Q_0001: ['A', 1, 1000, 0], Q_0002: ['B', 1, 2000, 0] },
          mistakes: {}
        })
      }),
      env
    });
    const dupBody = await dupRes.json();
    assert.equal(dupBody.notModified, true);
    assert.equal(db.writeCount, 1);

    // 用户清空重置后携带 overwrite: true -> 云端被清空为 {}
    const clearRes = await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bankId: '2027_1000',
          overwrite: true,
          answers: {},
          mistakes: {}
        })
      }),
      env
    });
    const clearBody = await clearRes.json();
    assert.deepEqual(clearBody.answers, {});
    assert.equal(db.writeCount, 2);
  });

  it('超过 MAX_SYNC_BODY_BYTES 请求体大小限制时应返回 413 拦截', async () => {
    const hugeString = 'x'.repeat(600 * 1024); // 600KB > 512KB limit
    const hugeReq = new Request('https://kaoyan.test/api/progress/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ answers: { Q_0001: hugeString } })
    });
    const res = await onRequestPost({ request: hugeReq, env });
    assert.equal(res.status, 413);
  });

  it('旧版 v37 单主键 user_progress 表在首次访问时应自动无损迁移至复合主键并保留全部历史数据', async () => {
    resetMigrationCacheForTest();
    let hasBankIdColumn = false;
    const executedBatchSqls = [];

    const legacyD1 = {
      prepare(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        return {
          sql: s,
          async all() {
            if (s.includes('PRAGMA table_info(user_progress)')) {
              return {
                results: hasBankIdColumn
                  ? [{ name: 'user_id' }, { name: 'bank_id' }, { name: 'answers_data' }]
                  : [{ name: 'user_id' }, { name: 'answers_data' }]
              };
            }
            return { results: [] };
          }
        };
      },
      async batch(stmts) {
        for (const st of stmts) {
          executedBatchSqls.push(st.sql);
        }
        hasBankIdColumn = true;
      }
    };

    await ensureMultiBankSchema(legacyD1);
    assert.equal(hasBankIdColumn, true);
    assert.equal(executedBatchSqls.length, 4);
    assert.ok(executedBatchSqls[0].includes('CREATE TABLE IF NOT EXISTS user_progress_new'));
    assert.ok(executedBatchSqls[1].includes("'2027_1000' AS bank_id"));

    // 同一 Isolate 后续调用直接命中内存缓存，不再触发 batch
    await ensureMultiBankSchema(legacyD1);
    assert.equal(executedBatchSqls.length, 4);
  });
});
