from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import sqlite3, json, os, base64, uuid, time, shutil, threading, urllib.request, urllib.error, re as re_module

app = Flask(__name__)
CORS(app, resources={r'/api/*': {'origins': '*', 'allow_headers': '*', 'expose_headers': '*'}})

@app.after_request
def add_response_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    response.headers['Cache-Control'] = 'no-store'
    return response

DATA_DIR = 'data'
DB_PATH = os.path.join(DATA_DIR, 'store.db')
os.makedirs(DATA_DIR, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            filename TEXT,
            data TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/png',
            hash TEXT,
            created_at INTEGER NOT NULL
        )
    ''')
    for col in ['data', 'mime_type']:
        try:
            conn.execute(f'ALTER TABLE images ADD COLUMN {col} TEXT')
        except sqlite3.OperationalError:
            pass
    conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_images_hash ON images(hash)')
    return conn

def kv_get(key, default=None):
    conn = get_db()
    row = conn.execute('SELECT value FROM kv WHERE key=?', (key,)).fetchone()
    conn.close()
    if row:
        try: return json.loads(row['value'])
        except: return row['value']
    return default

def kv_set(key, value):
    conn = get_db()
    conn.execute('REPLACE INTO kv (key, value) VALUES (?, ?)',
                 (key, json.dumps(value) if not isinstance(value, str) else value))
    conn.commit()
    conn.close()

# --- Sessions ---

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    return jsonify(kv_get('sessions', {}))

@app.route('/api/sessions', methods=['POST'])
def save_sessions():
    kv_set('sessions', request.json)
    return jsonify({'ok': True})

# --- Materials ---

@app.route('/api/materials', methods=['GET'])
def get_materials():
    return jsonify(kv_get('materials', []))

@app.route('/api/materials', methods=['POST'])
def save_materials():
    kv_set('materials', request.json)
    return jsonify({'ok': True})

# --- Settings ---

@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(kv_get('settings', {}))

@app.route('/api/settings', methods=['POST'])
def save_settings():
    kv_set('settings', request.json)
    return jsonify({'ok': True})

# --- Active session id ---

@app.route('/api/active', methods=['GET'])
def get_active():
    val = kv_get('active', '')
    return jsonify(val if isinstance(val, str) else '')

@app.route('/api/active', methods=['POST'])
def save_active():
    kv_set('active', request.json.get('id', ''))
    return jsonify({'ok': True})

# --- Image upload / serve ---

def _migrate():
    """One-time startup: import old files → SQLite, clean stale data, fix old URLs."""
    conn = get_db()

    # 1. Import old file-based images into SQLite, then delete old directory
    old_dir = os.path.join(DATA_DIR, 'images')
    if os.path.isdir(old_dir):
        migrated = 0
        for fname in os.listdir(old_dir):
            fpath = os.path.join(old_dir, fname)
            if not os.path.isfile(fpath):
                continue
            image_id = fname.rsplit('.', 1)[0] if '.' in fname else fname
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else 'png'
            mime_map = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                        'gif': 'image/gif', 'webp': 'image/webp'}
            mime = mime_map.get(ext, 'image/png')
            row = conn.execute('SELECT data FROM images WHERE id=?', (image_id,)).fetchone()
            if row is not None and row['data'] is not None:
                continue
            with open(fpath, 'rb') as f:
                b64_data = base64.b64encode(f.read()).decode('ascii')
            conn.execute(
                'INSERT OR REPLACE INTO images (id, filename, data, mime_type, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                (image_id, fname, b64_data, mime, None, int(os.path.getmtime(fpath)))
            )
            migrated += 1
        conn.commit()
        if migrated:
            print(f'[迁移] 已将 {migrated} 个旧图片导入 SQLite')
        shutil.rmtree(old_dir)
        print(f'[清理] 已删除旧图片目录 {old_dir}')

    # 2. Fix old URLs in kv table: strip .png extension from image URLs
    for row in conn.execute('SELECT key, value FROM kv WHERE key IN ("sessions", "materials")').fetchall():
        val = row['value']
        fixed = re_module.sub(r'(/api/images/[a-f0-9]+)\.\w+', r'\1', val)
        if fixed != val:
            conn.execute('UPDATE kv SET value=? WHERE key=?', (fixed, row['key']))
    conn.commit()

    # 3. Delete image records with no data (leftover from old schema)
    deleted = conn.execute('DELETE FROM images WHERE data IS NULL').rowcount
    if deleted:
        print(f'[清理] 删除了 {deleted} 条无数据图片记录')

    conn.close()

_migrate()

@app.route('/api/images', methods=['POST'])
def upload_image():
    data = request.json
    raw = data['data']
    mime_type = 'image/png'
    if ';' in raw and ',' in raw:
        header = raw.split(',')[0]
        mime_type = header.split(';')[0].split(':')[1] or 'image/png'
        img_data = raw.split(',', 1)[1]
    else:
        img_data = raw
    img_hash = data.get('hash', '')
    image_id = uuid.uuid4().hex

    conn = get_db()
    conn.execute(
        'INSERT OR IGNORE INTO images (id, filename, data, mime_type, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        (image_id, image_id + '.png', img_data, mime_type, img_hash or None, int(time.time()))
    )
    conn.commit()

    if img_hash:
        actual = conn.execute('SELECT id FROM images WHERE id=?', (image_id,)).fetchone()
        if actual is None:
            existing = conn.execute('SELECT id FROM images WHERE hash=?', (img_hash,)).fetchone()
            conn.close()
            return jsonify({'url': f'/api/images/{existing["id"]}'})
    conn.close()

    return jsonify({'url': f'/api/images/{image_id}'})

@app.route('/api/images/<path:image_path>')
def serve_image(image_path):
    ext = image_path.rsplit('.', 1)[-1].lower() if '.' in image_path else 'png'
    mime = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'webp': 'image/webp'}.get(ext, 'image/png')
    image_id = image_path.rsplit('.', 1)[0] if '.' in image_path else image_path

    conn = get_db()
    row = conn.execute('SELECT data, mime_type FROM images WHERE id=? AND data IS NOT NULL', (image_id,)).fetchone()
    conn.close()

    if row is None:
        response = make_response('', 404)
        response.headers.set('Content-Type', mime)
        return response

    img_bytes = base64.b64decode(row['data'])
    response = make_response(img_bytes)
    response.headers.set('Content-Type', row['mime_type'] or mime)
    response.headers.set('Content-Disposition', 'inline')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    return response

# ============================================================
# Task Queue
# ============================================================

_tasks = {}
_tasks_lock = threading.Lock()
_task_workers = {}
_queue_running = True

def _init_tasks_table():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            prompt TEXT NOT NULL,
            model TEXT NOT NULL,
            provider TEXT NOT NULL,
            refs TEXT DEFAULT '[]',
            image_url TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def _load_tasks():
    conn = get_db()
    rows = conn.execute('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').fetchall()
    conn.close()
    for row in rows:
        task = dict(row)
        try:
            task['refs'] = json.loads(task.get('refs', '[]'))
        except (json.JSONDecodeError, TypeError):
            task['refs'] = []
        _tasks[task['id']] = task

def _save_task(task):
    conn = get_db()
    conn.execute('''
        INSERT OR REPLACE INTO tasks (id, status, prompt, model, provider, refs, image_url, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        task['id'], task['status'], task['prompt'], task['model'], task['provider'],
        json.dumps(task.get('refs', [])),
        task.get('image_url', ''), task.get('error', ''),
        task['created_at'], task['updated_at']
    ))
    conn.commit()
    conn.close()

def _store_image_blob(b64_data, mime_type='image/png'):
    """Store a base64-encoded image blob in SQLite and return a local URL."""
    image_id = uuid.uuid4().hex
    conn = get_db()
    conn.execute(
        'INSERT INTO images (id, filename, data, mime_type, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        (image_id, f'{image_id}.png', b64_data, mime_type, None, int(time.time()))
    )
    conn.commit()
    conn.close()
    return f'/api/images/{image_id}'

def _download_and_store_image(url):
    """Download a remote image and store it locally for persistent access."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw_data = resp.read()
            img_b64 = base64.b64encode(raw_data).decode('ascii')
        mime = resp.headers.get('Content-Type', '') or 'image/png'
        return _store_image_blob(img_b64, mime)
    except Exception as e:
        print(f'[任务] 下载远程图片失败: {e}')
        return ''

def _store_image_from_response(resp_data, base_url):
    """Extract image from API response in any format and store in SQLite.

    Handles: remote URL → download+store, data: URL → store raw,
    b64_json field → store raw. Returns local /api/images/<id> URL or ''.
    """
    # Try URL-based extraction first
    url = _extract_image_url(resp_data, base_url)

    if url:
        if url.startswith('data:'):
            # Inline data URL — store the base64 payload directly
            mime = 'image/png'
            header = url.split(',')[0] if ',' in url else ''
            if ';' in header:
                mime = header.split(';')[0].split(':')[1] or mime
            raw = url.split(',', 1)[1] if ',' in url else url
            return _store_image_blob(raw, mime)

        if url.startswith('http'):
            if '127.0.0.1' in url or 'localhost' in url:
                return url  # Already a local URL
            return _download_and_store_image(url)  # Remote → download

        if url.startswith('/'):
            return _download_and_store_image(base_url + url)

        return url  # some other format, use as-is

    # No URL found — check for b64_json field (OpenAI DALL-E / image gen endpoints)
    if isinstance(resp_data, dict):
        dlist = resp_data.get('data')
        if isinstance(dlist, list):
            for entry in dlist:
                if isinstance(entry, dict):
                    b64 = entry.get('b64_json', '')
                    if b64:
                        mime = entry.get('mime_type', 'image/png')
                        return _store_image_blob(b64, mime)

    return ''

def _extract_image_url(data, base_url):
    """Extract image URL from various AI API response formats."""
    if isinstance(data, str):
        md = re_module.search(r'!\[.*?\]\((.*?)\)', data)
        if md: return md.group(1)
        url = re_module.search(r'https?://\S+\.(?:jpg|jpeg|png|gif|webp)', data)
        if url: return url.group(0)
        return ''

    if not isinstance(data, dict):
        return ''

    # Direct url field
    url = data.get('url', '')
    if url: return url

    # data[0].url format
    dlist = data.get('data')
    if isinstance(dlist, list) and dlist:
        url = dlist[0].get('url', '')
        if url: return url

    # choices[0].message.content
    choices = data.get('choices', [])
    if isinstance(choices, list) and choices:
        choice = choices[0]
        content = ''
        if isinstance(choice, dict):
            msg = choice.get('message', {})
            if isinstance(msg, dict):
                content = msg.get('content', '') or ''
            if not content:
                content = choice.get('text', '') or ''
        if content:
            md = re_module.search(r'!\[.*?\]\((.*?)\)', content)
            if md: return md.group(1)
            url = re_module.search(r'https?://\S+\.(?:jpg|jpeg|png|gif|webp)', content)
            if url: return url.group(0)

    return ''

def _execute_task(task_id):
    """Execute a generation task in a background thread."""
    with _tasks_lock:
        if task_id not in _tasks:
            return
        task = _tasks[task_id]
        if task['status'] != 'pending':
            return
        task['status'] = 'running'
        task['updated_at'] = time.time()
        _save_task(task)

    try:
        settings = kv_get('settings', {})
        providers = settings.get('providers', {})
        provider_name = task['provider']
        provider = providers.get(provider_name)
        if not provider:
            raise Exception(f'供应商 "{provider_name}" 配置未找到')

        base = provider['base_url'].rstrip('/')
        key = provider.get('api_key', '')

        # Build content — include ref images as data URLs
        refs = task.get('refs', [])
        if refs:
            content = [{'type': 'text', 'text': task['prompt']}]
            for ref in refs:
                data_url = ref.get('dataUrl', '')
                if data_url:
                    content.append({
                        'type': 'image_url',
                        'image_url': {'url': data_url}
                    })
        else:
            content = task['prompt']

        body = {
            'model': task['model'],
            'messages': [{'role': 'user', 'content': content}]
        }

        encoded = json.dumps(body).encode('utf-8')
        req = urllib.request.Request(
            f'{base}/v1/chat/completions',
            data=encoded,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {key}'
            },
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=300) as resp:
            resp_data = json.loads(resp.read().decode('utf-8'))

        image_url = _store_image_from_response(resp_data, base)

        with _tasks_lock:
            if task_id not in _tasks:
                return
            task = _tasks[task_id]
            if task['status'] == 'cancelled':
                return
            task['status'] = 'completed'
            task['image_url'] = image_url or ''
            task['updated_at'] = time.time()
            _save_task(task)

    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')[:500]
        with _tasks_lock:
            if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                t = _tasks[task_id]
                t['status'] = 'failed'
                t['error'] = f'HTTP {e.code}: {err_body}'
                t['updated_at'] = time.time()
                _save_task(t)
    except Exception as e:
        with _tasks_lock:
            if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                t = _tasks[task_id]
                t['status'] = 'failed'
                t['error'] = str(e)[:500]
                t['updated_at'] = time.time()
                _save_task(t)
    finally:
        _task_workers.pop(task_id, None)

def _cleanup_old_tasks():
    """Remove completed/cancelled tasks older than 1 hour."""
    cutoff = time.time() - 3600
    to_delete = []
    with _tasks_lock:
        for tid, t in list(_tasks.items()):
            if t['status'] in ('completed', 'cancelled') and t['updated_at'] < cutoff:
                to_delete.append(tid)
        for tid in to_delete:
            del _tasks[tid]
    if to_delete:
        conn = get_db()
        conn.executemany('DELETE FROM tasks WHERE id=?', [(tid,) for tid in to_delete])
        conn.commit()
        conn.close()

def _queue_worker():
    """Background thread: pick up pending tasks and spawn workers."""
    while _queue_running:
        pending = []
        with _tasks_lock:
            for tid, t in list(_tasks.items()):
                if t['status'] == 'pending' and tid not in _task_workers:
                    pending.append(tid)
        for tid in pending:
            w = threading.Thread(target=_execute_task, args=(tid,), daemon=True)
            _task_workers[tid] = w
            w.start()
        _cleanup_old_tasks()
        time.sleep(2)

# Initialize task queue
_init_tasks_table()
_load_tasks()
_queue_thread = threading.Thread(target=_queue_worker, daemon=True)
_queue_thread.start()

# --- Migrate existing images in session data into SQLite ---

def _migrate_existing_images():
    """Scan existing session data and download remote/data: image URLs into SQLite."""
    sessions = kv_get('sessions', {})
    if not sessions or not isinstance(sessions, dict):
        return

    migrated = 0
    for sid, session in sessions.items():
        for msg in (session.get('messages') or []):
            if msg.get('role') != 'assistant':
                continue
            url = msg.get('imageUrl', '') or ''
            if not url:
                continue

            # Already using relative local path — skip
            if url.startswith('/api/images/'):
                continue

            # Full localhost URL with /api/images/ → normalize to relative path
            if ('127.0.0.1' in url or 'localhost' in url) and '/api/images/' in url:
                idx = url.find('/api/images/')
                msg['imageUrl'] = url[idx:]
                migrated += 1
                print(f'[迁移] 规范化本地URL → {url[idx:]}')
                continue

            if url.startswith('data:'):
                mime = 'image/png'
                header = url.split(',')[0] if ',' in url else ''
                if ';' in header:
                    mime = header.split(';')[0].split(':')[1] or mime
                raw = url.split(',', 1)[1] if ',' in url else url
                new_url = _store_image_blob(raw, mime)
                if new_url:
                    msg['imageUrl'] = new_url
                    migrated += 1
                    print(f'[迁移] 现有内联图片 → {new_url}')
            elif url.startswith('http'):
                new_url = _download_and_store_image(url)
                if new_url:
                    msg['imageUrl'] = new_url
                    migrated += 1
                    print(f'[迁移] 现有远程图片 → {new_url}')

    if migrated:
        kv_set('sessions', sessions)
        print(f'[迁移] 共迁移 {migrated} 张现有图片到 SQLite')

_migrate_existing_images()

# --- Task API endpoints ---

@app.route('/api/tasks', methods=['POST'])
def create_task():
    data = request.json
    prompt = (data.get('prompt') or '').strip()
    if not prompt:
        return jsonify({'error': 'prompt is required'}), 400

    task_id = 'task-' + uuid.uuid4().hex
    now = time.time()

    task = {
        'id': task_id,
        'status': 'pending',
        'prompt': prompt,
        'model': data.get('model', ''),
        'provider': data.get('provider', ''),
        'refs': data.get('refs', []),
        'image_url': '',
        'error': '',
        'created_at': now,
        'updated_at': now
    }

    with _tasks_lock:
        _tasks[task_id] = task
        _save_task(task)

    return jsonify({'id': task_id, 'status': 'pending'})

@app.route('/api/tasks', methods=['GET'])
def list_tasks():
    with _tasks_lock:
        result = []
        for t in _tasks.values():
            entry = dict(t)
            # Strip data URLs from refs to keep response compact
            entry['refs'] = [{'name': r.get('name', '')} for r in entry.get('refs', [])]
            result.append(entry)
        result.sort(key=lambda t: t['created_at'], reverse=True)
    return jsonify(result[:50])

@app.route('/api/tasks/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    with _tasks_lock:
        if task_id not in _tasks:
            return jsonify({'error': 'task not found'}), 404
        t = _tasks[task_id]
        if t['status'] in ('completed', 'cancelled'):
            return jsonify({'status': t['status']})
        t['status'] = 'cancelled'
        t['updated_at'] = time.time()
        _save_task(t)
    return jsonify({'status': 'cancelled'})

if __name__ == '__main__':
    print('Backend running on http://127.0.0.1:5001')
    app.run(host='127.0.0.1', port=5001)
