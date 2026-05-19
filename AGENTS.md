# AGENTS.md

通用 AI 助手项目配置。读取此文件以了解项目结构、架构约定和开发流程。

## 项目概述

本仓库是基于 Vite 的前端应用，用于聊天式图片生成。

UI 布局：
- 左侧边栏：会话历史 + API/模型设置。
- 主区域：提示词和生成结果的聊天时间线。
- 提示词输入区：文本输入、可选的粘贴参考图片、提示词复用开关、生成按钮。

## 开发命令

- 安装依赖：`npm install`
- 启动开发服务器：`npm run dev`
- 构建生产包：`npm run build`
- 预览构建结果：`npm run preview`

### 代码检查 / 测试
- 代码检查：未配置。
- 测试：未配置（仓库中无测试框架）。
- 验证方式：手动 UI 行为检查 + `npm run build`。

## 架构说明

### 1) 应用入口与模块拆分
- [index.html](index.html) 包含应用外壳标记，加载模块入口 [src/main.js](src/main.js) 和样式表 [src/style.css](src/style.css)。
- [src/style.css](src/style.css) 包含完整视觉系统（布局、聊天气泡、设置面板、提示词区域）。
- [src/main.js](src/main.js) 包含所有运行时逻辑，并将公共处理函数绑定到 `window` 上，供 HTML 中内联 `onclick` 属性使用。

### 2) 客户端状态与持久化
会话状态存储在 `localStorage` 中：
- `image-gen-sessions`：所有会话及消息历史。
- `image-gen-active`：当前活跃会话 ID。

[src/main.js](src/main.js) 中的核心流程：
- 会话生命周期：`createSession`、`deleteSession`、`switchSession`、`renderSessionList`。
- 消息历史持久化/渲染：`appendMessage`、`loadMessages`。

### 3) 外部 API 集成
设置面板提供运行时 API 基础地址和 API 密钥。

[src/main.js](src/main.js) 中使用的接口：
- `GET /v1/models`：获取模型列表。
- `POST /v1/chat/completions`：提交生成请求。

生成请求内容：
- 纯文本提示词，或
- 文本 + `image_url` 部分（来自粘贴参考图片的 base64 data URL）。

从模型响应中提取图片 URL 的回退顺序：
1. `data.url`
2. assistant 内容中的 Markdown 图片语法
3. 匹配常见图片扩展名的纯 URL 正则

### 4) 交互子系统
[src/main.js](src/main.js) 中的主要子系统：
- 模型加载/筛选/选择（`fetchModels`、`filterModels`、`selectModel`）。
- 从剪贴板粘贴参考图片附件（`renderAttachments` + paste 监听器）。
- 提示词复用开关（`toggleReuse`）。
- 顶部栏状态文本更新（`updateStatus`）。

### 5) Canvas 组件（[src/components/canvas.js](src/components/canvas.js)）
- **渲染**：`renderCanvas()` 通过 `subscribe('canvasItems', ...)` 从 `canvasItems` 状态重建 DOM。项目渲染为 `#canvasSurface` 下的 flex-wrap 子元素。
- **拖放**：通过 `setupItemDrag()`（dragstart/dragend）、`setupOverlapDetection()`（dragover 高亮）、`setupDragMerge()`（drop → 堆叠合并）实现 HTML5 拖放 API。合并使用基于光标位置的目标检测（而非 DOM 矩形重叠，后者在 flex 布局下会失效）。部分浏览器可能不会触发 `drop` 事件，因此合并逻辑也通过 `_lastDragOverTarget` 追踪在 `dragend` 中执行。
- **外部拖入**：`setupExternalDrop()` 处理从浏览器外部拖入的文件/URL。
- **素材库拖入**：容器上的 `handleMaterialDrop` 处理从素材库的拖放。使用 `_dragSourceId` 检查跳过内部 canvas 拖拽。
- **堆叠系统**：
  - 堆叠项目渲染为缩略图 + `stack-badge`（数量 ≤ 1 时隐藏）。
  - 展开堆叠：双击 → `expandStack()` 在网格布局中生成临时 `_expandedItems`。
  - 折叠：`collapseExpanded()` 恢复普通视图。
  - 自动解散：`removeFromStack()` 在仅剩 1 个项目时自动解散。
- **选择**：单击/Ctrl+单击/Shift+单击多选、橡皮筋框选。选择状态通过 `setTimeout(0)` 延迟执行，避免干扰拖拽启动。
- **平移/缩放**：通过容器上的 mousedown/mousemove/mouseup 处理程序实现视口变换。

### 6) 上下文菜单（[src/components/contextMenu.js](src/components/contextMenu.js)）
- 右键触发 `showMenu(e, context, data)`，支持上下文：`canvas-image`、`material`、`canvas-empty`。
- Canvas 图片操作：复制、添加到素材库、复制提示词、下载、创建堆叠、从堆叠移除、解散堆叠、删除。
- 菜单项静态定义在 [index.html](index.html) 中，带有 `data-ctx` 和 `data-action` 属性，动态控制可见性。

### 7) Store — 堆叠操作（[src/store.js](src/store.js)）
- `createStackFromItems(itemIds, x, y)` — 从源移除项目，创建 `session.stacks[]` 条目。
- `addToStack(stackId, itemId)` — 将项目添加到现有堆叠。
- `mergeStacks(sourceId, targetId)` — 将一个堆叠的所有子项合并到另一个堆叠。
- `removeFromStack(stackId, childIndex, x, y)` — 提取项目为独立项；仅剩 1 个时自动解散。
- `dissolveStack(stackId)` — 将堆叠的所有子项转换为独立项目，删除堆叠。

## 工具说明

- Vite 配置位于 [vite.config.js](vite.config.js)（开发服务器绑定到 `0.0.0.0:4173`）。
- 构建输出生成在 `dist/` 目录下。
- 项目使用 ESM（`package.json` 中 `"type": "module"`）。

## 仓库约束

- 未配置代码检查/测试工具；验证方式为手动 UI 行为检查 + `npm run build`。

## 开发约定

- **注释语言**：所有代码注释、commit message、文档、PR 描述等均使用**中文**书写。
- **Commit message 格式**：遵循 Conventional Commits（`feat:`、`fix:`、`refactor:`、`chore:` 等），但说明部分使用中文。
- **命名规范**：变量、函数、组件等标识符使用英文命名（驼峰式），注释使用中文解释意图。**不要在标识符中使用中文或拼音**。
