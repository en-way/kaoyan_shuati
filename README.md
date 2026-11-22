# 考研政治 1000 题 · 沉浸式刷题与跨端云同步系统 (`kaoyan_shuati`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages%20%2B%20D1-F38020?logo=cloudflare)](DEPLOY_TO_CLOUDFLARE.md)

基于 **原生 ES Modules + Cloudflare Pages + Pages Functions + Cloudflare D1** 构建的零构建（Zero-Build）、离线优先（Offline-First PWA）考研政治沉浸式刷题系统。

---

## ✨ 核心功能

- **多题库/多年份扩展架构**：通过 `data/catalog.json` 与 `data/banks/<bankId>.json` 静态题库清单管理，支持一键切换不同年份或专项题库，做题进度与错题本按 `bankId` 独立隔离。
- **三种沉浸式刷题模式**：
  - ⚡ **即做即判模式**：单选点选即判、多选确认提交，即时展开权威解析、来源定位与拓展点拨；
  - 📝 **模考自测模式**：隐藏答案与解析，章节完成后统一交卷评分并生成详细诊断报告；
  - 📖 **背题速览模式**：直接高亮正确答案与核心考点解析，适合考前冲刺复盘。
- **智能错题本与斩题机制**：自动归集历史错题，记录错误次数与最近误选，支持按板块/章节过滤、错题重练与“标记已掌握（斩题）”。
- **离线 PWA 秒开体验**：Service Worker 对核心 App Shell 预缓存，对题库数据按需缓存，断网环境下依然可完整刷题。
- **Cloudflare D1 跨端云同步**：
  - 单用户单题库单行紧凑 JSON 存储（`[choice, isCorrect, time, isFlagged]`），极致节约 D1 免费读写配额；
  - 支持多设备单题最新时间戳智能合并、显式重置快照覆盖、乐观锁 `version`（HTTP 409）冲突检测与 FNV-1a 指纹防抖拦截。
- **本地 JSON 备份导入/导出**：无需注册登录亦可通过 JSON 文件跨设备迁移学习记录。

---

## 🛠️ 技术栈与架构约束

| 层级 | 技术选型 | 设计考量 |
| :--- | :--- | :--- |
| **前端视图与逻辑** | 原生 HTML5 / CSS3 / ES Modules (`<script type="module">`) | 零构建步骤，无需 Webpack/Vite，修改即生效 |
| **本地持久化** | `localStorage`（带损坏隔离备份与旧版本键自动迁移） | 同步读写零延迟，100% 兼容历史版本存档 |
| **离线缓存** | Service Worker (`sw.js`) | 核心外壳原子安装 + 题库 JSON 运行时按需缓存 |
| **Serverless 接口** | Cloudflare Pages Functions (`functions/api/**`) | Web Crypto 原生 PBKDF2 + HMAC-SHA256 JWT，单请求 CPU < 2ms |
| **云端数据库** | Cloudflare D1 (SQLite) | 复合主键 `(user_id, bank_id)`，零冗余索引 |
| **自动化测试** | Node.js 原生 `node:test` + `node:assert/strict` | 零第三方重型依赖，毫秒级回归验证 |

---

## 📂 目录结构

```text
.
├── index.html                        # 响应式单页应用入口 (Desktop + Mobile PWA)
├── manifest.json                     # PWA 应用清单
├── sw.js                             # Service Worker (App Shell + 题库按需缓存)
├── wrangler.toml.example             # Cloudflare Pages & D1 绑定配置模板
├── DEPLOY_TO_CLOUDFLARE.md           # Cloudflare Pages + D1 完整部署指南
├── css/
│   └── style.css                     # 暗黑/护眼主题与移动端自适应样式
├── data/
│   ├── catalog.json                  # 多题库/多年份目录清单
│   ├── questions.sample.json         # 5 道脱敏示例题 (公开演示/本地联调)
│   ├── questions.json                # 默认题库兼容入口
│   └── banks/
│       └── 2027_1000.json            # 2027 考研政治 1000 题标准题库
├── js/
│   ├── main.js                       # 前端 ES Module 主入口与全局事件挂载
│   ├── app.js                        # 向后兼容入口转发层
│   ├── config.js                     # 全局常量、版本与多题库存储键工厂
│   ├── api.js                        # 弹性超时、指数退避重试与响应解析
│   ├── state/
│   │   └── store.js                  # 状态管理、多题库隔离存储与旧版数据无损迁移
│   ├── core/
│   │   ├── quiz.js                   # 纯函数判题、紧凑数组编解码、统计与错题引擎
│   │   ├── exam.js                   # 章节模考计分与成绩单引擎
│   │   └── sync.js                   # 云同步调度、防抖拦截与 409 冲突拉取合并
│   └── ui/
│       ├── views.js                  # 大厅、刷题区、答题卡、错题本与题库切换器渲染
│       └── modals.js                 # 登录注册、管理员面板、备份导入导出与弹窗交互
├── functions/
│   ├── schema.sql                    # D1 数据库最新完整建表规范
│   ├── migrations/
│   │   └── 001_add_bank_id.sql       # 老库无损升级复合主键 (user_id, bank_id) 迁移脚本
│   ├── api/
│   │   ├── auth/                     # 注册、登录、会话校验、改密、注销与重置密码
│   │   ├── admin/                    # 管理员密钥校验与重置码签发
│   │   └── progress/
│   │       └── sync.js               # 多题库云端进度拉取 (GET) 与智能合并/覆盖同步 (POST)
│   └── utils/                        # Web Crypto 鉴权、参数校验、HTTP 辅助与常量
└── tests/                            # 基于 node:test 的零依赖自动化回归测试套件
```

---

## 🚀 本地开发与测试

### 1. 环境准备
需要安装 **Node.js 20+**。克隆项目后，根据模板创建本地 Wrangler 配置文件：

```bash
cp wrangler.toml.example wrangler.toml
```

### 2. 运行单元测试
本项目使用 Node.js 内置测试运行器，无需 `npm install` 即可直接运行全套测试：

```bash
npm test
# 或直接执行：
node --test tests/*.test.js
```

### 3. 启动本地开发服务器
- **纯静态模式**（测试刷题、错题本、本地导入导出）：
  使用任意静态服务器（如 `npx serve .` 或 `python -m http.server 8080`）。
- **完整全栈模式**（含 Cloudflare Pages Functions 与本地 D1 数据库）：
  ```bash
  # 初始化本地 D1 表结构
  npx wrangler d1 execute kaoyan-quiz-db --local --file=./functions/schema.sql

  # 启动 Pages 本地开发服务
  npx wrangler pages dev .
  ```

---

## 📦 题库合规隔离说明

- `data/questions.sample.json` 提供了 5 道完全脱敏的示例题目（含单选、多选与带 `sub_items` 的组合题），与正式题库具有完全一致的 JSON Schema。
- 若将代码仓库设为完全公开（Public），建议在公开分支仅保留 `data/questions.sample.json` 并在 `data/catalog.json` 中指向示例题库；正式商业出版题库（`data/banks/*.json`）可通过私有部署分支或构建前私有源拉取进行隔离。

---

## ☁️ 生产部署与 D1 迁移

详细的 GitHub 推送、Cloudflare Pages 绑定、D1 数据库创建与环境变量（`JWT_SECRET`、`ADMIN_SECRET`）配置步骤，请参考：
👉 **[DEPLOY_TO_CLOUDFLARE.md](DEPLOY_TO_CLOUDFLARE.md)**

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。
