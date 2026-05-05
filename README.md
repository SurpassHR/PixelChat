# Image Gen – AI Image Generation App

[English](README.md) | [中文](README.zh-CN.md)

A full‑stack web application for generating AI images using any OpenAI‑compatible API (e.g., OpenAI, local LLM like Ollama, or custom endpoints). It provides a rich UI with session management, a persistent image canvas, material library, and a robust background task queue.

![Screenshot placeholder](https://via.placeholder.com/800x400?text=Image+Gen+Screenshot)

## Features

- 🖼️ **AI Image Generation** – Supports any provider implementing the OpenAI chat completions API (`/v1/chat/completions`).
- 📝 **Prompt Management** – Write prompts with drag‑and‑drop image references (materials).
- 🗂️ **Multi‑Session Workspace** – Create, rename, and delete sessions. Each session stores its own conversation history.
- 🎨 **Canvas & Context Menu** – View generated images, copy, download, or add them to the material library.
- 📚 **Material Library** – Store frequently used images and reuse them in prompts.
- ⚙️ **Provider Configuration** – Add multiple API providers (base URL, API key) with model selection per request.
- 🔄 **Asynchronous Task Queue** – Generations run in the background with concurrency limiting, retries, and persistent task storage.
- 💾 **Persistent Storage** – All data (sessions, materials, images, tasks) is stored in SQLite, including image blobs.
- 🧹 **Automatic Cleanup** – Completed tasks are removed after one hour; old image files are migrated into the database.

## Tech Stack

- **Frontend**: Vanilla JavaScript, Vite, HTML5/CSS3
- **Backend**: Python 3, Flask, SQLite
- **Communication**: REST API, CORS enabled

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (for frontend development)
- [Python 3](https://www.python.org/) (3.8 or higher)
- `pip` for installing Python dependencies

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/image-gen.git
   cd image-gen
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

3. Install frontend dependencies:
   ```bash
   npm install
   ```

### Running the Application

The easiest way to run both frontend and backend simultaneously:

```bash
npm run dev
```

This command uses `concurrently` to start:
- **Backend** – Flask server on `http://127.0.0.1:5001`
- **Frontend** – Vite dev server on `http://localhost:5173`

Open your browser to `http://localhost:5173`.

Alternatively, run them separately:

**Backend only:**
```bash
cd backend
python server.py
```

**Frontend only:**
```bash
npm run dev   # starts only Vite (without backend)
```

### Configuration

1. Open the app and click the **Settings** icon (⚙️) in the top right.
2. Under **Providers**, add one or more API providers:
   - **Name** (e.g., `OpenAI`, `LocalLLM`)
   - **Base URL** – The endpoint where the `/v1/chat/completions` route is served (e.g., `https://api.openai.com` or `http://localhost:1234`)
   - **API Key** – Your secret key (required for most cloud services)
3. Select a default model (e.g., `gpt-4o-mini`, `dall-e-3`, or any model that outputs image URLs).

The app supports any model that returns an image in one of these formats:
- `url` field in the response
- `data[0].url`
- `choices[0].message.content` containing a Markdown image link
- `b64_json` field (OpenAI DALL‑E style)

## Usage

### Generating an Image

1. Create a new session (or use the default one).
2. Type your prompt in the text area at the bottom.
3. (Optional) Drag images from the **Material Library** into the prompt area to use them as references.
4. Select a provider and model from the dropdown.
5. Click **Generate** (or press `Ctrl+Enter` / `Cmd+Enter`).
6. The task is added to the **Task Queue** (visible via the queue button). Once completed, the image appears on the canvas.

### Task Queue

- The queue processes up to **2 concurrent generations** (configurable in `backend/server.py`).
- Failed tasks are automatically retried up to 2 times with exponential backoff.
- You can cancel a pending or running task from the queue panel.

### Sessions

- All conversations are saved automatically.
- Use the sidebar to create, rename, or delete sessions.
- Switch between sessions to continue previous work.

### Material Library

- Click the **Library** button to open the material library.
- Add images by uploading files or using the context menu on any generated image.
- Drag a material image directly into the prompt area to include it as a reference.

### Canvas

- **Drag & merge**: Drag one image onto another to automatically create a **stack group**. Drag onto an existing stack to add to it, or drag a stack onto another to merge them.
- **Stack management**: Double‑click a stack to expand and view individual images. Right‑click a stack to **dissolve** it (convert all images back to standalone items). Right‑click an expanded item to remove it from the stack.
- Right‑click any generated image to open a context menu with options to:
  - Copy image to clipboard
  - Download image
  - Add to material library
  - Create stack (select 2+ images first)
  - Dissolve stack
  - Delete

## API Endpoints (Summary)

| Method | Endpoint                | Description                           |
|--------|-------------------------|---------------------------------------|
| GET    | `/api/sessions`         | Get all sessions                      |
| POST   | `/api/sessions`         | Save sessions                         |
| GET    | `/api/materials`        | Get material library                  |
| POST   | `/api/materials`        | Save material library                 |
| GET    | `/api/settings`         | Get provider & model settings         |
| POST   | `/api/settings`         | Save settings                         |
| GET    | `/api/active`           | Get currently active session ID       |
| POST   | `/api/active`           | Set active session ID                 |
| POST   | `/api/images`           | Upload an image (base64)              |
| GET    | `/api/images/{id}`      | Serve a stored image                  |
| POST   | `/api/tasks`            | Create a generation task              |
| GET    | `/api/tasks`            | List all tasks                        |
| POST   | `/api/tasks/{id}/cancel`| Cancel a task                         |

All endpoints return JSON and support CORS.

## Project Structure

```
image-gen/
├── backend/
│   ├── server.py           # Flask application (task queue, DB, API)
│   └── requirements.txt    # Python dependencies
├── src/
│   ├── components/         # UI components (canvas, sidebar, modal, etc.)
│   ├── api.js              # API client for backend communication
│   ├── store.js            # Centralized state management (sessions, settings)
│   ├── main.js             # Application entry point
│   ├── domHelpers.js       # DOM utility functions
│   ├── style.css           # Global styles
│   └── toast.js            # Notification system
├── index.html              # Main HTML file
├── package.json            # Node dependencies and scripts
├── vite.config.js          # Vite configuration
└── README.md               # This file
```

## Customisation & Configuration

- **Concurrency & queue limits** – Edit `MAX_CONCURRENT`, `MAX_QUEUE_DEPTH`, `MAX_RETRIES` in `backend/server.py`.
- **Image storage** – Images are stored as base64 blobs inside SQLite (`data/store.db`). The database is automatically created on first run.
- **Data directory** – Default is `./data/`. Change `DATA_DIR` in `backend/server.py` if needed.

## Troubleshooting

- **Backend not starting** – Ensure port 5001 is free. Change the port in `server.py` if necessary.
- **API errors** – Check your provider’s base URL and API key in the settings panel. The backend logs errors to the console.
- **Images not showing** – Verify that CORS is enabled (the backend adds appropriate headers). Generated images are downloaded and stored locally – check the network tab for any failed requests.

## License

This project is open source and available under the [MIT License](LICENSE). (You can add a `LICENSE` file if you wish.)

## Acknowledgments

- Built with [Vite](https://vitejs.dev/) and [Flask](https://flask.palletsprojects.com/).
- Inspired by modern AI image generation workflows.

---

**Enjoy generating images!** If you encounter any issues, please open an issue on GitHub.