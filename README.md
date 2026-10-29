# 小新工坊

**从灵感到定稿，把 AI 变成你的编辑团队。**

小新工坊是一套面向长篇小说创作的一体化 AI 工作台，把构思、项目搭建、角色与世界观管理、章节写作和精修审校放在同一张创作桌上。

> 本项目基于 MuMuAINovel 二次开发，产品名称、视觉和部分流程已重做，核心代码来源及 GPL v3.0 许可要求见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。

## 主要能力

- **项目管理**：作品库、项目配置、封面、导入导出和多用户数据隔离。
- **创作准备**：AI 向导、大纲、角色、组织、关系、职业体系和世界观设定。
- **章节写作**：单章生成、批量生成、写作风格、技能工作流和上下文引用。
- **生成后精修**：可选自动精修，保留原文快照，可在章节中一键恢复。
- **精修台**：改写前后对照、原文视图、命中分析、量化报告和重新生成。
- **灵感与分析**：灵感模板、拆书、长篇分析、伏笔和章节关系图。
- **模型兼容**：支持 OpenAI、Gemini、Anthropic 及 OpenAI 兼容接口。
- **部署方式**：Docker Compose 一键部署，同时支持本地开发。

## 界面方向

当前视觉主题为“现代编辑部”：

- 纸张色工作区与墨色导航
- 朱砂色编辑标记和红色印章式品牌图标
- 宋体标题与更克制的信息层级
- 桌面和移动端两套导航布局
- 亮色与暗色模式

界面和导航名称已统一为“小新工坊”，路由地址、数据模型和核心写作流程保持兼容。

## 快速开始

### 1. 准备配置

```bash
cp .env.example .env
```

编辑 `.env`，至少完成以下配置：

```dotenv
POSTGRES_PASSWORD=你的数据库密码
LOCAL_AUTH_PASSWORD=你的管理员密码
SESSION_SECRET_KEY=一段足够长的随机字符串
OPENAI_API_KEY=你的模型服务密钥
OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_MODEL=gpt-4o-mini
```

不要提交 `.env`。默认示例中的密码和密钥都只是占位符。

### 2. Docker Compose 启动

```bash
docker compose up -d --build
```

打开 `http://localhost:8000`，使用 `.env` 中配置的本地管理员账号登录。

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

停止服务：

```bash
docker compose down
```

### 3. 本地开发

后端需要 Python 3.12：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端需要 Node.js 20 或更高版本：

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，并通过 Vite 代理连接后端。

## 配置说明

### AI 服务

系统支持在管理员设置中维护共享模型接口，也支持由用户配置自己的接口。常见环境变量：

- `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- `GEMINI_API_KEY` / `GEMINI_BASE_URL`
- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
- `DEFAULT_AI_PROVIDER`
- `DEFAULT_MODEL`

本地 Ollama、llama.cpp 或 Docker 内网服务默认被 SSRF 防护拦截。确需使用时，在受信任网络中设置：

```dotenv
ALLOW_PRIVATE_AI_ENDPOINTS=true
ALLOWED_AI_HOSTS=host.docker.internal,127.0.0.1
```

### 登录方式

- 本地用户名和密码登录
- 邮箱验证码登录与注册（需配置 SMTP）

上游项目曾使用 LinuxDO OAuth。本版本已从界面和后端路由中移除该登录入口，仅保留既有数据库字段以兼容历史数据。

### 数据兼容

为避免升级时丢失数据或本地偏好，部分历史内部标识会继续保留：

- 数据库列 `linuxdo_id`
- 少量包含 `mumu` 的 localStorage 键
- 部分模型命名空间

这些名称不会再作为产品品牌展示。重命名它们需要单独的数据迁移，不能只改代码。

## 项目结构

```text
backend/
  app/          FastAPI、数据库模型、AI 服务与写作流程
  alembic/      数据库迁移
  static/       前端构建产物
frontend/
  src/          React 应用、页面、组件和主题
  public/       品牌图标等静态资源
docker-compose.yml
.env.example
NOTICE.md
LICENSE
```

## 验证

```bash
cd frontend
npm run build
npx eslint src

cd ../backend
PYTHONPYCACHEPREFIX=/tmp/xiaoxin-pycache python3 -m compileall -q app

cd ..
git diff --check
```

## 许可与来源

本项目继续按 **GNU General Public License v3.0** 发布，详见 [LICENSE](LICENSE)。

- 上游项目：MuMuAINovel
- 上游作者：xiamuceer-j
- 上游仓库：https://github.com/xiamuceer-j/MuMuAINovel
- 本版本修改说明：[NOTICE.md](NOTICE.md)

分发修改版本时，请保留上游署名、许可证、修改说明，并按 GPL v3.0 提供对应源代码。
