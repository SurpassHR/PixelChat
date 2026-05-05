# Image Gen – AI 图像生成应用

一个全栈 Web 应用，通过兼容 OpenAI API 格式的服务（例如 OpenAI、本地 LLM 如 Ollama，或自定义端点）生成 AI 图像。提供丰富的用户界面，支持会话管理、持久化图像画布、素材库以及健壮的后台任务队列。

## 功能特点

- 🖼️ **AI 图像生成** – 支持任何实现 OpenAI 聊天补全 API (`/v1/chat/completions`) 的提供商。
- 📝 **提示词管理** – 编写提示词，支持拖拽图像引用（素材）。
- 🗂️ **多会话工作区** – 创建、重命名和删除会话。每个会话保存独立的对话历史。
- 🎨 **画布与右键菜单** – 查看生成的图像，复制、下载或添加到素材库。
- 📚 **素材库** – 存储常用图像，并在提示词中复用。
- ⚙️ **提供商配置** – 添加多个 API 提供商（Base URL、API Key），每个请求可选模型。
- 🔄 **异步任务队列** – 后台生成图像，支持并发限制、重试和持久化任务存储。
- 💾 **持久化存储** – 所有数据（会话、素材、图像、任务）均存储在 SQLite 中，包括图像二进制数据。
- 🧹 **自动清理** – 已完成的任务一小时后自动删除；旧图像文件会迁移到数据库。

## 技术栈

- **前端**：原生 JavaScript、Vite、HTML5/CSS3
- **后端**：Python 3、Flask、SQLite
- **通信**：REST API，启用 CORS

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/)（用于前端开发）
- [Python 3](https://www.python.org/)（3.8 或更高）
- `pip` 用于安装 Python 依赖

### 安装步骤

1. 克隆仓库：
   ```bash
   git clone https://github.com/your-username/image-gen.git
   cd image-gen
   ```

2. 安装后端依赖：
   ```bash
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

3. 安装前端依赖：
   ```bash
   npm install
   ```

### 运行应用

最简单的方式是同时启动前端和后端：

```bash
npm run dev
```

此命令使用 `concurrently` 启动：
- **后端** – Flask 服务器，地址 `http://127.0.0.1:5001`
- **前端** – Vite 开发服务器，地址 `http://localhost:5173`

在浏览器中打开 `http://localhost:5173`。

或者分别运行：

**仅后端：**
```bash
cd backend
python server.py
```

**仅前端：**
```bash
npm run dev   # 仅启动 Vite（不启动后端）
```

### 配置

1. 打开应用，点击右上角的 **设置** 图标（⚙️）。
2. 在 **提供商** 下，添加一个或多个 API 提供商：
   - **名称**（例如 `OpenAI`、`LocalLLM`）
   - **Base URL** – 提供 `/v1/chat/completions` 路由的端点（例如 `https://api.openai.com` 或 `http://localhost:1234`）
   - **API Key** – 密钥（大多数云服务需要）
3. 选择默认模型（例如 `gpt-4o-mini`、`dall-e-3`，或任何能输出图像 URL 的模型）。

应用支持以下格式返回图像的模型：
- 响应中的 `url` 字段
- `data[0].url`
- `choices[0].message.content` 中包含的 Markdown 图像链接
- `b64_json` 字段（OpenAI DALL‑E 风格）

## 使用说明

### 生成图像

1. 创建一个新会话（或使用默认会话）。
2. 在底部的文本区域输入提示词。
3. （可选）从 **素材库** 拖拽图像到提示词区域，作为参考图片。
4. 从下拉框中选择提供商和模型。
5. 点击 **生成**（或按 `Ctrl+Enter` / `Cmd+Enter`）。
6. 任务会添加到 **任务队列**（可通过队列按钮查看）。完成后，图像会显示在画布上。

### 任务队列

- 队列最多同时处理 **2 个** 生成任务（可在 `backend/server.py` 中配置）。
- 失败的任务会自动重试最多 2 次，采用指数退避策略。
- 可以从队列面板取消等待中或运行中的任务。

### 会话

- 所有对话自动保存。
- 使用侧边栏创建、重命名或删除会话。
- 切换会话以继续之前的工作。

### 素材库

- 点击 **素材库** 按钮打开素材库。
- 通过上传文件或对任何生成的图像使用右键菜单中的“添加到素材库”来添加图像。
- 将素材图像直接拖拽到提示词区域，将其作为参考图片。

### 画布

- **拖拽合并**：将一张图像拖到另一张上自动创建**堆叠组**。拖到已有堆叠组上可加入，堆叠组之间可互相合并。
- **堆叠组管理**：双击堆叠组展开查看所有图片。右键堆叠组可**解散**（所有图片恢复为独立项）。右键展开的图片可移出堆叠组。
- 在任意生成的图像上右键，打开上下文菜单，提供以下选项：
  - 复制图像到剪贴板
  - 下载图像
  - 添加到素材库
  - 复制提示词
  - 放入堆叠组（需选中 2 张以上）
  - 移出堆叠组
  - 解散堆叠组
  - 删除

## API 端点（摘要）

| 方法   | 端点                         | 描述               |
|--------|------------------------------|--------------------|
| GET    | `/api/sessions`              | 获取所有会话       |
| POST   | `/api/sessions`              | 保存会话           |
| GET    | `/api/materials`             | 获取素材库         |
| POST   | `/api/materials`             | 保存素材库         |
| GET    | `/api/settings`              | 获取提供商和模型设置 |
| POST   | `/api/settings`              | 保存设置           |
| GET    | `/api/active`                | 获取当前活动会话 ID |
| POST   | `/api/active`                | 设置活动会话 ID     |
| POST   | `/api/images`                | 上传图像（base64）  |
| GET    | `/api/images/{id}`           | 提供存储的图像      |
| POST   | `/api/tasks`                 | 创建生成任务        |
| GET    | `/api/tasks`                 | 列出所有任务        |
| POST   | `/api/tasks/{id}/cancel`     | 取消任务            |

所有端点返回 JSON，并支持 CORS。

## 项目结构

```
image-gen/
├── backend/
│   ├── server.py           # Flask 应用（任务队列、数据库、API）
│   └── requirements.txt    # Python 依赖
├── src/
│   ├── components/         # UI 组件（画布、侧边栏、模态框等）
│   ├── api.js              # 与后端通信的 API 客户端
│   ├── store.js            # 集中状态管理（会话、设置等）
│   ├── main.js             # 应用入口点
│   ├── domHelpers.js       # DOM 工具函数
│   ├── style.css           # 全局样式
│   └── toast.js            # 通知系统
├── index.html              # 主 HTML 文件
├── package.json            # Node 依赖和脚本
├── vite.config.js          # Vite 配置
└── README.md               # 英文说明文档
```

## 自定义与配置

- **并发与队列限制** – 在 `backend/server.py` 中修改 `MAX_CONCURRENT`、`MAX_QUEUE_DEPTH`、`MAX_RETRIES`。
- **图像存储** – 图像以 base64 格式存储在 SQLite 数据库（`data/store.db`）中。首次运行时自动创建数据库。
- **数据目录** – 默认为 `./data/`。如需更改，修改 `backend/server.py` 中的 `DATA_DIR`。

## 故障排查

- **后端未启动** – 确保端口 5001 空闲。必要时在 `server.py` 中更改端口。
- **API 错误** – 检查设置面板中的提供商 Base URL 和 API Key。后端错误会输出到控制台。
- **图像不显示** – 确认 CORS 已启用（后端已添加相应头）。生成的图像会被下载并本地存储 – 检查网络选项卡，查看是否有请求失败。

## 许可证

本项目基于 MIT 许可证开源。（你可以根据需要添加 `LICENSE` 文件。）

## 致谢

- 基于 [Vite](https://vitejs.dev/) 和 [Flask](https://flask.palletsprojects.com/) 构建。
- 灵感来源于现代 AI 图像生成工作流。

---

**享受生成图像的乐趣！** 如遇任何问题，请在 GitHub 上提交 Issue。