# 考研政治 1000 题 · GitHub 推送与 Cloudflare Pages 部署完整指南

本项目现已全面完成**纯静态与 Serverless 适配**，无需运行任何后端服务器，即可 100% 在浏览器中全功能运行（包含 1,148 道题目、全量官方解析、即做即判、模考自测、错题本以及进度备份/恢复功能）。

部署到 **Cloudflare Pages** 拥有以下巨大优势：
- 🌐 **全球免费顶级 CDN 加速**：手机、iPad、电脑秒开页面，无延迟；
- 🔒 **自带免费 SSL 证书**：安全 HTTPS 访问；
- 💰 **完全永久免费**：零服务器费用、零维护负担；
- 📱 **随时随地跨端刷题**：只要有浏览器即可打开刷题。

---

## 第一阶段：推送到 GitHub 仓库

### 步骤 1：确认电脑已安装 Git
在终端中输入以下命令检查 Git：
```bash
git --version
```
如果提示没有安装 Git，可以使用 Windows 自带包管理器一键安装（推荐）：
```bash
winget install --id Git.Git -e --source winget
```
安装完成后**重新打开终端或 VSCode** 即可生效。

### 步骤 2：在 GitHub 创建一个新仓库
1. 打开并登录 [GitHub](https://github.com/)；
2. 点击右上角的 **`+`** 号 -> 选择 **New repository**；
3. 填写仓库名称（例如 `kaoyan-politics-1000`）；
4. 可以选择 **Public**（公开）或 **Private**（私有，Cloudflare 同样完全支持私有仓库）；
5. **不要勾选** "Add a README file"（因为本地已有），直接点击 **Create repository**。

### 步骤 3：在本地提交并推送代码
在当前项目根目录（`d:\A16pro\Aing\antigravity\test`）打开终端，依次执行：
```bash
# 1. 初始化 Git 本地仓库
git init

# 2. 将所有文件添加到暂存区
git add .

# 3. 提交本地版本
git commit -m "feat: 2027 考研政治 1000 题全解析沉浸式做题系统"

# 4. 指定主分支为 main
git branch -M main

# 5. 关联你的 GitHub 远程仓库（请将下方 URL 换成你在 GitHub 复制的实际仓库地址）
git remote add origin https://github.com/你的用户名/kaoyan-politics-1000.git

# 6. 推送至 GitHub
git push -u origin main
```

---

## 第二阶段：在 Cloudflare Pages 一键部署

### 步骤 1：登录 Cloudflare 控制台
1. 打开并登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)（如果没有账号可免费注册一个）。
2. 在左侧菜单栏中点击 **Workers 和 Pages**（Workers & Pages）。

### 步骤 2：创建 Pages 应用程序
1. 点击右上角的 **创建**（Create）按钮；
2. 选择 **Pages** 选项卡；
3. 点击 **连接到 Git**（Connect to Git）；
4. 授权并选择你的 GitHub 账号，勾选刚才创建的 `kaoyan-politics-1000` 仓库，点击 **开始设置**（Begin setup）。

### 步骤 3：填写构建配置（核心步骤）
在配置页面中，按如下方式设置：
- **项目名称**：自定义，例如 `kaoyan-politics-1000`（这会决定你分配到的二级域名）；
- **生产分支 (Production branch)**：`main`；
- **框架预设 (Framework preset)**：选择 **`None`**；
- **构建命令 (Build command)**：**留空**（不需要填写任何内容）；
- **构建输出目录 (Build output directory)**：填写 **`/`** 或留空（代表直接发布根目录下的网页文件）。

### 步骤 4：保存并部署
点击底部的 **保存并部署**（Save and Deploy）按钮。
Cloudflare 会在 15~30 秒内完成全球边缘节点部署！

部署成功后，你将获得一个形如：
👉 **`https://kaoyan-politics-1000.pages.dev`** 的公网链接！

---

## 第三阶段：手机 / iPad / 电脑跨端同步技巧

1. **直接随开随刷**：
   在 iPad / 手机 Safari 或 Chrome 中打开 `https://你的项目名.pages.dev`，即可开始刷题。在 Safari 中点击“分享”->“添加到主屏幕”，即可像原生 App 一样全屏无边框刷题！
2. **作答数据存储在哪里？**
   答题记录、错题本、标记题目均保存在当前浏览器的 `localStorage` 中，离线状态也能稳定记录。
3. **如何在电脑与 iPad / 手机之间同步进度？**
   - 在电脑端做题后，点击页面右上角 **「💾 备份进度」**，会自动下载一个 `.json` 进度备份文件；
   - 通过微信/网盘/AirDrop 发送到 iPad 或手机；
   - 在移动端打开网页，点击右上角 **「📥 导入进度」** 选择该文件，即可瞬间同步所有做题记录、掌握度与错题本！

---

## 常见问题与后续更新

- **代码有修改如何更新到网站？**
  只需在本地修改后执行：
  ```bash
  git add .
  git commit -m "update: 优化部分题目或功能"
  git push
  ```
  Cloudflare Pages 会自动检测到 GitHub 的推送并在几秒钟内自动触发重新部署，无需手动操作！
