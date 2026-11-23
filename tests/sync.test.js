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
          // 2. sync.js LEFT JOIN 查询（包含 u.updated_at AS user_updated_at）
          if (normalizedSql.includes('FROM users u LEFT JOIN user_progress p')) {
            const [bankId, uid] = this._args;
            const u = users.get(uid);
            if (!u) return null;
            const p = progress.get(`${uid}::${bankId}`);
            return {
              uid: u.id,
              user_updated_at: u.updated_at,
              answers_data: p ? p.answers_data : null,
              mistakes_data: p ? p.mistakes_data : null,
              version: p ? p.version : null,
              updated_at: p ? p.updated_at : null
            };
          }
          // 3. CAS 冲突后回查最新行
          if (normalizedSql.includes('FROM user_progress WHERE user_id = ? AND bank_id = ?')) {
            const [userId, bankId] = this._args;
            const p = progress.get(`${userId}::${bankId}`);
            if (!p) return null;
            return {
              version: p.version,
              updated_at: p.updated_at,
              answers_data: p.answers_data,
              mistakes_data: p.mistakes_data
            };
          }
          return null;
        },
        async run() {
          if (normalizedSql.includes('UPDATE user_progress')) {
            const [answersJson, mistakesJson, nextVersion, updatedAt, userId, bankId, expectedVersion] = this._args;
            const key = `${userId}::${bankId}`;
            const cur = progress.get(key);
            if (!cur || cur.version !== expectedVersion) {
              return { success: true, meta: { changes: 0 } };
            }
            progress.set(key, {
              user_id: userId,
              bank_id: bankId,
              answers_data: answersJson,
              mistakes_data: mistakesJson,
              version: nextVersion,
              updated_at: updatedAt
            });
            self.writeCount++;
            return { success: true, meta: { changes: 1 } };
          }
          if (normalizedSql.includes('INSERT') && normalizedSql.includes('INTO user_progress')) {
            const [userId, bankId, answersJson, mistakesJson, version, updatedAt] = this._args;
            const key = `${userId}::${bankId}`;
            if (normalizedSql.includes('INSERT OR IGNORE') && progress.has(key)) {
              return { success: true, meta: { changes: 0 } };
            }
            progress.set(key, {
              user_id: userId,
              bank_id: bankId,
              answers_data: answersJson,
              mistakes_data: mistakesJson,
              version,
              updated_at: updatedAt
            });
            self.writeCount++;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
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

  it('冷启动并发调用 ensureMultiBankSchema 时单飞锁应确保只执行一次迁移批次，且失败后允许重试', async () => {
    resetMigrationCacheForTest();
    let hasBankIdColumn = false;
    let pragmaCallCount = 0;
    let batchCallCount = 0;
    let shouldFailFirstBatch = true;

    const concurrentD1 = {
      prepare(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        return {
          sql: s,
          async all() {
            if (s.includes('PRAGMA table_info(user_progress)')) {
              pragmaCallCount++;
              await new Promise(r => setTimeout(r, 15));
              return {
                results: hasBankIdColumn
                  ? [{ name: 'user_id' }, { name: 'bank_id' }]
                  : [{ name: 'user_id' }]
              };
            }
            return { results: [] };
          }
        };
      },
      async batch() {
        batchCallCount++;
        await new Promise(r => setTimeout(r, 15));
        if (shouldFailFirstBatch) {
          shouldFailFirstBatch = false;
          throw new Error('Transient D1 lock timeout');
        }
        hasBankIdColumn = true;
      }
    };

    // 1. 第一波 5 个并发请求同时命中冷启动，首次 batch 模拟瞬时失败
    await Promise.all([
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1)
    ]);
    // 单飞锁保证第一波 5 个并发请求只触发了 1 次 PRAGMA 和 1 次 batch
    assert.equal(pragmaCallCount, 1);
    assert.equal(batchCallCount, 1);
    assert.equal(hasBankIdColumn, false);

    // 2. 因为第一波失败未置 _schemaVerified = true，第二波 5 个并发请求应自动重试并同样只执行 1 次迁移批次
    await Promise.all([
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1)
    ]);
    assert.equal(pragmaCallCount, 2);
    assert.equal(batchCallCount, 2);
    assert.equal(hasBankIdColumn, true);

    // 3. 迁移成功后，后续并发调用 0 开销直接返回
    await Promise.all([
      ensureMultiBankSchema(concurrentD1),
      ensureMultiBankSchema(concurrentD1)
    ]);
    assert.equal(pragmaCallCount, 2);
    assert.equal(batchCallCount, 2);
  });

  it('改密后已吊销的旧 JWT 请求 GET / POST /api/progress/sync 均应返回 401 TOKEN_REVOKED', async () => {
    // 模拟用户在签发 token 后重设了密码（users.updated_at 晚于 token.iat + 容差）
    db.users.get('u_1001').updated_at = Date.now() + 60_000;

    const getRes = await onRequestGet({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }),
      env
    });
    assert.equal(getRes.status, 401);
    const getBody = await getRes.json();
    assert.equal(getBody.code, 'TOKEN_REVOKED');

    const postRes = await onRequestPost({
      request: new Request('https://kaoyan.test/api/progress/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          bankId: '2027_1000',
          overwrite: true,
          answers: {},
          mistakes: {}
        })
      }),
      env
    });
    assert.equal(postRes.status, 401);
    const postBody = await postRes.json();
    assert.equal(postBody.code, 'TOKEN_REVOKED');
  });

  it('原子 CAS 乐观锁：SELECT 与 UPDATE 之间发生并发写入时返回 409 且不静默覆盖最新进度', async () => {
    // 1. 初始写入 version = 1
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

    // 2. 注入并发窗口：当请求 A 即将执行条件 UPDATE ... WHERE version = 1 时，并发请求 B 抢先升至 version = 2
    let injectedRace = false;
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      if (!injectedRace && sql.replace(/\s+/g, ' ').includes('UPDATE user_progress')) {
        injectedRace = true;
        db.progress.set('u_1001::2027_1000', {
          user_id: 'u_1001',
          bank_id: '2027_1000',
          answers_data: JSON.stringify({ Q_0999: ['D', 1, 9000, 0] }),
          mistakes_data: '{}',
          version: 2,
          updated_at: 9000
        });
      }
      return stmt;
    };

    const raceRes = await onRequestPost({
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

    assert.equal(raceRes.status, 409);
    const raceBody = await raceRes.json();
    assert.equal(raceBody.code, 'VERSION_CONFLICT');
    assert.equal(raceBody.version, 2);
    assert.deepEqual(raceBody.answers.Q_0999, ['D', 1, 9000, 0]);
    // 确认云端 Q_0999 未被请求 A 覆盖
    const stored = JSON.parse(db.progress.get('u_1001::2027_1000').answers_data);
    assert.deepEqual(stored.Q_0999, ['D', 1, 9000, 0]);
    assert.equal(stored.Q_0002, undefined);
  });
});
