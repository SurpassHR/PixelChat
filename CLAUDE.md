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

## Tooling notes

- Vite config is in [vite.config.js](vite.config.js) (dev server bound to `0.0.0.0:4173`).
- Build output is generated under `dist/`.
- Project uses ESM (`"type": "module"` in [package.json](package.json)).

## Repository constraints

- No README.md, Cursor rules, or Copilot instruction files are present.
- No lint/test tooling is configured; validation is currently manual UI behavior check + `npm run build`.
