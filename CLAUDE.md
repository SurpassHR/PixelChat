# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repository is a Vite-based frontend app for chat-style image generation.

UI behavior:
- Left sidebar: session history + API/model settings.
- Main area: chat timeline of prompts and generated image results.
- Prompt area: text input, optional pasted reference images, prompt reuse toggle, generate action.

## Development commands

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Preview build output: `npm run preview`

### Lint / tests
- Lint: not configured.
- Tests: not configured.
- Run a single test: not available (no test framework in repo).

## Architecture notes

### 1) App entry and module split
- [index.html](index.html) contains the app shell markup and loads module entry [src/main.js](src/main.js) and stylesheet [src/style.css](src/style.css).
- [src/style.css](src/style.css) contains the full visual system (layout, chat bubbles, settings panel, prompt area).
- [src/main.js](src/main.js) contains all runtime logic and binds public handlers to `window` for inline `onclick` attributes used in HTML.

### 2) Client-side state and persistence
Session state is stored in `localStorage`:
- `image-gen-sessions`: all sessions and message history.
- `image-gen-active`: active session id.

Core flows in [src/main.js](src/main.js):
- Session lifecycle: `createSession`, `deleteSession`, `switchSession`, `renderSessionList`.
- Message history persistence/render: `appendMessage`, `loadMessages`.

### 3) External API integration
Settings panel provides runtime API base URL and API key.

Endpoints used by [src/main.js](src/main.js):
- `GET /v1/models`: fetch model list.
- `POST /v1/chat/completions`: submit generation requests.

Generation request content:
- text-only prompt, or
- text + `image_url` parts (base64 data URLs from pasted reference images).

Image URL extraction fallback order from model response:
1. `data.url`
2. Markdown image syntax in assistant content
3. Plain URL regex matching common image extensions

### 4) Interaction subsystems
Primary subsystems in [src/main.js](src/main.js):
- Model loading/filtering/selection (`fetchModels`, `filterModels`, `selectModel`).
- Reference image attachments from clipboard paste (`renderAttachments` + paste listener).
- Prompt reuse toggle (`toggleReuse`).
- Status text updates in top bar (`updateStatus`).

### 5) Canvas component ([src/components/canvas.js](src/components/canvas.js))
- **Rendering**: `renderCanvas()` rebuilds DOM from `canvasItems` state via `subscribe('canvasItems', ...)`. Items are rendered as flex-wrap children of `#canvasSurface`.
- **Drag and drop**: HTML5 Drag API via `setupItemDrag()` (dragstart/dragend), `setupOverlapDetection()` (dragover highlight), `setupDragMerge()` (drop → stack merge). Merge uses cursor-position-based target detection (NOT DOM rectangle overlap, which fails in flex layout). The `drop` event may not fire in some browsers, so merge logic also runs in `dragend` via `_lastDragOverTarget` tracking.
- **External drop**: `setupExternalDrop()` handles files/URLs dropped from outside the browser.
- **Material drop**: `handleMaterialDrop` on container handles drops from the material library. Uses `_dragSourceId` check to skip internal canvas drags.
- **Stack system**:
  - Stack items rendered with thumbnail + `stack-badge` (hidden when count ≤ 1).
  - Expand stack: double-click → `expandStack()` generates temporary `_expandedItems` in grid layout.
  - Collapse: `collapseExpanded()` restores normal view.
  - Auto-dissolve: `removeFromStack()` auto-dissolves when only 1 item remains.
- **Selection**: Click/Ctrl+click/Shift+click multi-select, rubber-band selection. Selection state deferred via `setTimeout(0)` to avoid interfering with drag initiation.
- **Pan/zoom**: Viewport transform via mousedown/mousemove/mouseup handlers on container.

### 6) Context menu ([src/components/contextMenu.js](src/components/contextMenu.js))
- Right-click triggers `showMenu(e, context, data)` with contexts: `canvas-image`, `material`, `canvas-empty`.
- Canvas-image actions: copy, add to materials, copy prompt, download, make stack, remove from stack, dissolve stack, delete.
- Menu items statically defined in [index.html](index.html) with `data-ctx` and `data-action` attributes, visibility toggled dynamically.

### 7) Store — Stack operations ([src/store.js](src/store.js))
- `createStackFromItems(itemIds, x, y)` — remove items from source, create `session.stacks[]` entry.
- `addToStack(stackId, itemId)` — add item to existing stack.
- `mergeStacks(sourceId, targetId)` — merge all children from one stack into another.
- `removeFromStack(stackId, childIndex, x, y)` — extract item to standalone; auto-dissolves when only 1 remains.
- `dissolveStack(stackId)` — convert all stack children to standalone items, delete stack.

## Tooling notes

- Vite config is in [vite.config.js](vite.config.js) (dev server bound to `0.0.0.0:4173`).
- Build output is generated under `dist/`.
- Project uses ESM (`"type": "module"` in [package.json](package.json)).

## Repository constraints

- No lint/test tooling is configured; validation is currently manual UI behavior check + `npm run build`.
