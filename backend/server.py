from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import sqlite3, json, os, base64, uuid, time, shutil, threading, urllib.request, urllib.error, re as re_module, random, socket

app = Flask(__name__)
CORS(app, resources={r'/api/*': {'origins': '*', 'allow_headers': '*', 'expose_headers': '*', 'supports_credentials': True}})

@app.after_request
def add_response_headers(response):
    origin = request.headers.get('Origin', '')
    response.headers['Access-Control-Allow-Origin'] = origin or '*'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS material_stacks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            children TEXT NOT NULL,
            thumbnail TEXT,
            created_at INTEGER
        )
    ''')
    # 迁移旧有 material_stacks 数据：如果存在旧表字段，自动迁移（略）
    try:
        conn.execute('SELECT children FROM material_stacks LIMIT 1')
    except sqlite3.OperationalError:
        # 如果表已存在但结构不对，可以尝试重建，这里忽略
        pass
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
    kv_set('sessions', request.get_json(force=True, silent=True) or {})
    return jsonify({'ok': True})

# --- Materials ---

@app.route('/api/materials', methods=['GET'])
def get_materials():
    # 新格式：返回 { materials, materialStacks }
    materials = kv_get('materials', [])
    # 确保每个素材有 parentStackId（将从堆叠组中重建，但后端不依赖，前端自己构建）
    stacks = _load_material_stacks()
    return jsonify({'materials': materials, 'materialStacks': stacks})

@app.route('/api/materials', methods=['POST'])
def save_materials():
    data = request.get_json(force=True, silent=True) or {}
    # 兼容旧格式：如果是数组，则当作 materials 数组，materialStacks 留空
    if isinstance(data, list):
        kv_set('materials', data)
        # 清空堆叠组（避免遗留）
        conn = get_db()
        conn.execute('DELETE FROM material_stacks')
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    # 新格式：包含 materials 和 materialStacks
    materials = data.get('materials', [])
    stacks = data.get('materialStacks', [])
    kv_set('materials', materials)
    _save_material_stacks(stacks)
    return jsonify({'ok': True})

# --- Settings ---

@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(kv_get('settings', {}))

@app.route('/api/settings', methods=['POST'])
def save_settings():
    kv_set('settings', request.get_json(force=True, silent=True) or {})
    return jsonify({'ok': True})

# --- Active session id ---

@app.route('/api/active', methods=['GET'])
def get_active():
    val = kv_get('active', '')
    return jsonify(val if isinstance(val, str) else '')

@app.route('/api/active', methods=['POST'])
def save_active():
    kv_set('active', (request.get_json(force=True, silent=True) or {}).get('id', ''))
    return jsonify({'ok': True})

# --- Image upload / serve ---

def _migrate():
    """One-time startup: import old files → SQLite, clean stale data, fix old URLs."""
    conn = get_db()
    # 注意：旧 localStorage 中的堆叠组由前端首次加载时迁移，后端无需处理

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

def _save_material_stacks(stacks):
    """替换所有堆叠组"""
    conn = get_db()
    conn.execute('DELETE FROM material_stacks')
    for stack in stacks:
        conn.execute(
            'INSERT INTO material_stacks (id, name, category, children, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (stack['id'], stack['name'], stack['category'], json.dumps(stack.get('children', [])), stack.get('thumbnail', ''), int(time.time()))
        )
    conn.commit()
    conn.close()

def _load_material_stacks():
    """加载所有堆叠组"""
    conn = get_db()
    rows = conn.execute('SELECT id, name, category, children, thumbnail, created_at FROM material_stacks').fetchall()
    conn.close()
    stacks = []
    for row in rows:
        stacks.append({
            'id': row['id'],
            'name': row['name'],
            'category': row['category'],
            'children': json.loads(row['children']),
            'thumbnail': row['thumbnail'],
            'created_at': row['created_at']
        })
    return stacks

@app.route('/api/images', methods=['POST'])
def upload_image():
    data = request.get_json(force=True, silent=True) or {}
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

@app.route('/api/images/import', methods=['POST'])
def import_image():
    """下载外部 URL 图片并存入本地 SQLite，返回本地 URL。用于修复过期的外部链接。"""
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get('url') or '').strip()
    if not url:
        return jsonify({'error': 'url is required'}), 400
    if not url.startswith('http'):
        return jsonify({'error': 'only http/https URLs are supported'}), 400
    local_url = _download_and_store_image(url)
    if not local_url:
        return jsonify({'error': '下载外部图片失败，链接可能已过期'}), 502
    return jsonify({'url': local_url, 'original_url': url})

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

def build_api_url(base, path):
    clean_base = (base or '').rstrip('/')
    clean_path = path if path.startswith('/') else '/' + path
    if clean_base.endswith('/v1') and clean_path.startswith('/v1/'):
        return clean_base + clean_path[3:]
    return clean_base + clean_path


# ============================================================
# Task Queue
# ============================================================

# Concurrency & reliability configuration
MAX_QUEUE_DEPTH = 20     # Max pending tasks before rejecting
REQUEST_TIMEOUT = 3600   # Hard ceiling (1h), only prevents infinite hang
CHUNK_READ_TIMEOUT = 180  # Socket read timeout per chunk — 允许更长的处理间隔（例如返回102时）
MAX_RETRIES = 2          # Only retry on network disconnect, not flow2api content errors; 429 also retries with longer delay
RETRY_BASE_DELAY = 5     # Base delay (s) for exponential backoff
DEFAULT_CONCURRENCY = 2  # 默认每 provider 并发数

_tasks = {}
_tasks_lock = threading.Lock()
_task_workers = {}
_queue_running = True
_provider_sems = {}       # provider_name → threading.Semaphore
_provider_sems_lock = threading.Lock()

def _get_provider_sem(provider_name):
    """获取或创建 provider 专属的信号量，并发数来自 provider 配置的 concurrency 字段。"""
    with _provider_sems_lock:
        if provider_name not in _provider_sems:
            settings = kv_get('settings', {})
            providers = settings.get('providers', {})
            provider = providers.get(provider_name, {})
            concurrency = provider.get('concurrency', DEFAULT_CONCURRENCY)
            if not isinstance(concurrency, int) or concurrency < 1:
                concurrency = DEFAULT_CONCURRENCY
            _provider_sems[provider_name] = threading.Semaphore(concurrency)
        return _provider_sems[provider_name]

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
            thinking TEXT DEFAULT '',
            retry_count INTEGER DEFAULT 0,
            request_url TEXT DEFAULT '',
            request_body TEXT DEFAULT '',
            request_headers TEXT DEFAULT '',
            response_status INTEGER DEFAULT 0,
            response_headers TEXT DEFAULT '',
            response_body TEXT DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
    ''')
    # 迁移：为已有表添加新列
    for col, col_type in [
        ('thinking', 'TEXT DEFAULT \'\''),
        ('retry_count', 'INTEGER DEFAULT 0'),
        ('request_url', 'TEXT DEFAULT \'\''),
        ('request_body', 'TEXT DEFAULT \'\''),
        ('request_headers', 'TEXT DEFAULT \'\''),
        ('response_status', 'INTEGER DEFAULT 0'),
        ('response_headers', 'TEXT DEFAULT \'\''),
        ('response_body', 'TEXT DEFAULT \'\''),
    ]:
        try:
            conn.execute(f'ALTER TABLE tasks ADD COLUMN {col} {col_type}')
        except sqlite3.OperationalError:
            pass
    # 新增：任务完成时间戳列
    try:
        conn.execute('ALTER TABLE tasks ADD COLUMN completed_at REAL')
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

def _load_tasks():
    conn = get_db()
    rows = conn.execute('SELECT * FROM tasks ORDER BY created_at DESC').fetchall()
    now = time.time()
    for row in rows:
        task = dict(row)
        # 兼容旧数据：无 retry_count 时默认 0
        if 'retry_count' not in task:
            task['retry_count'] = 0
        # 兼容旧数据：completed_at 为空但任务已处终态时用 updated_at 回退
        if not task.get('completed_at') and task['status'] in ('completed', 'failed', 'cancelled'):
            task['completed_at'] = task.get('updated_at', now)
        try:
            task['refs'] = json.loads(task.get('refs', '[]'))
        except (json.JSONDecodeError, TypeError):
            task['refs'] = []
        # Reset stuck running tasks to pending so they get retried after restart
        if task['status'] == 'running':
            task['status'] = 'pending'
            task['updated_at'] = now
            task['completed_at'] = None
            conn.execute(
                'UPDATE tasks SET status=?, updated_at=? WHERE id=?',
                ('pending', now, task['id'])
            )
        _tasks[task['id']] = task
    conn.commit()
    conn.close()

def _save_task(task):
    # 任务进入终态时自动记录完成时间戳（仅首次设置，避免重试覆盖）
    if task.get('status') in ('completed', 'failed', 'cancelled') and not task.get('completed_at'):
        task['completed_at'] = time.time()
    conn = get_db()
    conn.execute('''
        INSERT OR REPLACE INTO tasks (id, status, prompt, model, provider, refs, image_url, error, thinking, retry_count,
                                     request_url, request_body, request_headers, response_status, response_headers, response_body,
                                     created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        task['id'], task['status'], task['prompt'], task['model'], task['provider'],
        json.dumps(task.get('refs', [])),
        task.get('image_url', ''), task.get('error', ''),
        task.get('thinking', ''),
        task.get('retry_count', 0),
        task.get('request_url', ''),
        task.get('request_body', ''),
        task.get('request_headers', ''),
        task.get('response_status', 0),
        task.get('response_headers', ''),
        task.get('response_body', ''),
        task['created_at'], task['updated_at'],
        task.get('completed_at')
    ))
    conn.commit()
    conn.close()

class ImageStorageError(Exception):
    pass


def _normalize_local_image_url(url):
    if not url or not isinstance(url, str):
        return ''
    if url.startswith('/api/images/'):
        return url
    if ('127.0.0.1' in url or 'localhost' in url) and '/api/images/' in url:
        return url[url.find('/api/images/'):]
    return ''


def _store_image_blob(b64_data, mime_type='image/png'):
    """将 base64 图片写入 SQLite 并返回本地 URL。"""
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
    """下载远程图片并存入本地数据库。"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw_data = resp.read()
            img_b64 = base64.b64encode(raw_data).decode('ascii')
        mime = resp.headers.get('Content-Type', '') or 'image/png'
        return _store_image_blob(img_b64, mime)
    except Exception as e:
        print(f'[任务] 下载远程图片失败: {e}')
        return ''

def _store_image_from_response(resp_data, base_url):
    """从 API 响应提取图片并存入 SQLite。"""
    url = _extract_image_url(resp_data, base_url)

    if url:
        local_url = _normalize_local_image_url(url)
        if local_url:
            return local_url

        if url.startswith('data:'):
            mime = 'image/png'
            header = url.split(',')[0] if ',' in url else ''
            if ';' in header:
                mime = header.split(';')[0].split(':')[1] or mime
            raw = url.split(',', 1)[1] if ',' in url else url
            local = _store_image_blob(raw, mime)
            if local.startswith('/api/images/'):
                return local
            raise ImageStorageError('生成图片未能存入数据库')

        if url.startswith('http'):
            local = _download_and_store_image(url)
            if local and local.startswith('/api/images/'):
                return local
            raise ImageStorageError('生成图片下载或存入数据库失败')

        if url.startswith('/'):
            local = _download_and_store_image(base_url.rstrip('/') + url)
            if local and local.startswith('/api/images/'):
                return local
            raise ImageStorageError('生成图片下载或存入数据库失败')

        raise ImageStorageError('不支持的生成图片 URL 格式')

    if isinstance(resp_data, dict):
        dlist = resp_data.get('data')
        if isinstance(dlist, list):
            for entry in dlist:
                if isinstance(entry, dict):
                    b64 = entry.get('b64_json', '')
                    if b64:
                        mime = entry.get('mime_type', 'image/png')
                        local = _store_image_blob(b64, mime)
                        if local.startswith('/api/images/'):
                            return local
                        raise ImageStorageError('生成图片未能存入数据库')

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

def _prompt_with_aspect_ratio(prompt, aspect_ratio):
    if not aspect_ratio:
        return prompt
    ar_suffix = f'--ar {aspect_ratio}'
    if re_module.search(r'(^|\s)--ar\s+' + re_module.escape(aspect_ratio) + r'(\s|$)', prompt):
        return prompt
    return f'{prompt.rstrip()} {ar_suffix}'


def _execute_task(task_id):
    """Execute a generation task with per-provider concurrency limiting."""
    # 先读取任务获取 provider 名称
    with _tasks_lock:
        if task_id not in _tasks:
            _task_workers.pop(task_id, None)
            return
        task = _tasks[task_id]
        if task['status'] in ('cancelled', 'running', 'completed'):
            _task_workers.pop(task_id, None)
            return
        provider_name = task.get('provider', '')

    # 按 provider 控制并发
    sem = _get_provider_sem(provider_name) if provider_name else threading.Semaphore(DEFAULT_CONCURRENCY)
    with sem:
        # 等待期间可能被取消，重新检查
        with _tasks_lock:
            if task_id not in _tasks:
                _task_workers.pop(task_id, None)
                return
            task = _tasks[task_id]
            if task['status'] == 'cancelled':
                _task_workers.pop(task_id, None)
                return
            if task['status'] != 'pending':
                _task_workers.pop(task_id, None)
                return
            task['status'] = 'running'
            task['updated_at'] = time.time()
            _save_task(task)

        last_error = None

        settings = kv_get('settings', {})
        retry_count = settings.get('retryCount', MAX_RETRIES)

        for attempt in range(1 + retry_count):
            # 重试时更新 retry_count，让前端可以轮询到重试状态
            if attempt > 0:
                with _tasks_lock:
                    if task_id in _tasks:
                        task = _tasks[task_id]
                        task['retry_count'] = attempt
                        task['updated_at'] = time.time()
                        _save_task(task)

            try:
                settings = kv_get('settings', {})
                retry_count = settings.get('retryCount', MAX_RETRIES)
                providers = settings.get('providers', {})
                provider_name = task['provider']
                provider = providers.get(provider_name)
                if not provider:
                    raise Exception(f'供应商 "{provider_name}" 配置未找到')

                base = provider['base_url'].rstrip('/')
                key = provider.get('api_key', '')

                refs = task.get('refs', [])

                # gpt-image-* 模型使用非流式 prompt/n/size 格式，其他模型使用流式 messages 格式
                is_gpt_image = task['model'].startswith('gpt-image')

                if is_gpt_image:
                    prompt = _prompt_with_aspect_ratio(task['prompt'], task.get('aspectRatio'))
                    if refs:
                        content = [{'type': 'text', 'text': prompt}]
                        for ref in refs:
                            data_url = ref.get('dataUrl', '')
                            if data_url:
                                content.append({
                                    'type': 'image_url',
                                    'image_url': {'url': data_url, 'detail': 'auto'}
                                })
                    else:
                        content = prompt
                    body = {
                        'model': task['model'],
                        'messages': [{'role': 'user', 'content': content}],
                    }
                else:
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
                        'messages': [{'role': 'user', 'content': content}],
                        'stream': True
                    }

                encoded = json.dumps(body).encode('utf-8')
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {key}',
                    'Connection': 'close',
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Linux"',
                }

                request_url = build_api_url(base, '/v1/chat/completions')

                # 保存请求信息到任务，供前端详情展示
                task['request_url'] = request_url
                # 截断 body 中的 base64 图像数据，保留结构但避免存储巨量字符
                def _truncate_base64(obj):
                    if isinstance(obj, str):
                        return re_module.sub(
                            r'(data:image/\w+;base64,)[A-Za-z0-9+/=]{100,}',
                            r'\1[base64 图像数据已省略]',
                            obj
                        )
                    elif isinstance(obj, dict):
                        return {k: _truncate_base64(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [_truncate_base64(v) for v in obj]
                    return obj
                task['request_body'] = json.dumps(_truncate_base64(body), ensure_ascii=False, indent=2)
                task['request_headers'] = json.dumps(
                    {k: (v if k != 'Authorization' else f'Bearer {key[:8]}...') for k, v in headers.items()},
                    ensure_ascii=False, indent=2
                )
                # 打印请求详情（隐藏完整 API Key）
                masked_key = key[:8] + '...' if len(key) > 8 else '(空)'
                print(f'\n[后端请求] 任务 {task_id}')
                print(f'  URL: {request_url}')
                print(f'  Method: POST')
                print(f'  Headers: { {k: v if k != "Authorization" else "Bearer " + masked_key for k, v in headers.items()} }')
                print(f'  Model: {task["model"]}')
                print(f'  Prompt 长度: {len(task["prompt"])}')
                print(f'  Ref 数量: {len(refs)}')
                print(f'  尝试次数: {attempt + 1}/{1 + MAX_RETRIES}')
                # 可选：打印请求体摘要（避免过长）
                body_preview = task["prompt"][:200] + ('...' if len(task["prompt"]) > 200 else '')
                print(f'  Prompt 预览: {body_preview}')

                req = urllib.request.Request(
                    request_url,
                    data=encoded,
                    headers=headers,
                    method='POST'
                )

                # 带参考图时需要检测"打码验证"来判定是否违规
                has_refs = bool(refs)
                thinking_start_time = None
                thinking_verified = False  # 思考块中是否出现了"打码验证"

                print(f'[任务] {task_id} 发送请求: {request_url} '
                      f'(model={task["model"]}, attempt={attempt + 1}/{1 + retry_count})')

                thinking = ''
                final_content = ''

                if is_gpt_image:
                    # gpt-image 非流式响应：直接读取完整 JSON
                    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                        task['response_status'] = resp.status
                        task['response_headers'] = json.dumps(dict(resp.getheaders()), ensure_ascii=False)
                        raw = resp.read()
                    resp_data = json.loads(raw.decode('utf-8'))
                    task['response_body'] = json.dumps(resp_data, ensure_ascii=False)[:10000]
                    thinking = ''
                    final_content = resp_data.get('choices', [{}])[0].get('message', {}).get('content', '') or ''
                    print(f'[非流式] 任务 {task_id} 收到响应，content 长度={len(final_content)}')
                else:
                    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                        task['response_status'] = resp.status
                        task['response_headers'] = json.dumps(dict(resp.getheaders()), ensure_ascii=False)
                        # 穿透包装层找到底层 socket 设置读超时（多层 try/except 兜底）
                        sock = None
                        try:
                            fp = resp.fp
                            # BufferedReader → SocketIO → _sock
                            if hasattr(fp, 'raw') and hasattr(fp.raw, '_sock'):
                                sock = fp.raw._sock
                            elif hasattr(fp, '_sock'):
                                sock = fp._sock
                        except Exception:
                            pass
                        if sock:
                            try:
                                sock.settimeout(60)  # 初始 60s：为返回102等长处理留足时间
                            except Exception:
                                sock = None
                        stream_start_time = time.time()
                        if sock:
                            print(f'[流] 任务 {task_id} 连接建立，socket 超时=60s，等待首个 thinking...')
                        else:
                            print(f'[流] 任务 {task_id} 连接建立（使用线程定时器），等待首个 thinking...')
                            # 无法获取 socket 时用线程定时器兜底：60s 后关闭连接触发异常
                            _close_timer = threading.Timer(60.0, lambda: resp.close())
                            _close_timer.daemon = True
                            _close_timer.start()
                        try:
                            for line in resp:
                                line = line.decode('utf-8', errors='replace').strip()
                                if not line or not line.startswith('data:'):
                                    continue
                                data_str = line[5:].strip()
                                if data_str == '[DONE]':
                                    break
                                try:
                                    chunk = json.loads(data_str)
                                except json.JSONDecodeError:
                                    continue
    
                                # 不再因为短时间无思考内容而判定失败，允许长时间等待（例如返回102处理中）
                                elapsed = time.time() - stream_start_time
                                if not thinking and elapsed > 10:
                                    print(f'[等待] 任务 {task_id} 已等待 {elapsed:.0f}s 尚未收到思考内容，继续等待（可能服务端返回102处理中）...')
    
                                # chunk 日志
                                choices_list = chunk.get('choices')
                                if choices_list and len(choices_list) > 0:
                                    delta_preview = choices_list[0].get('delta', {})
                                    finish_reason_chunk = choices_list[0].get('finish_reason', '') or ''
                                else:
                                    delta_preview = {}
                                    finish_reason_chunk = ''
                                r_len = len(delta_preview.get('reasoning_content', '') or '')
                                c_len = len(delta_preview.get('content', '') or '')
                                if r_len or c_len:
                                    print(f'[chunk] 任务 {task_id} reasoning+{r_len} content+{c_len}')
    
                                # 检测 flow2api 返回的失败信号
                                content_preview = delta_preview.get('content', '') or ''
                                reasoning_preview = delta_preview.get('reasoning_content', '') or ''
    
                                error_keywords = ['❌', '失败', 'error', 'Error', 'ERROR', '违规', '拒绝', 'denied']
                                is_error_chunk = any(kw in content_preview or kw in reasoning_preview for kw in error_keywords)
                                is_error_finish = finish_reason_chunk and finish_reason_chunk not in ('stop', '', '102')
    
                                if is_error_chunk or is_error_finish:
                                    print(f'[失败] 任务 {task_id} flow2api 返回失败 chunk，finish={finish_reason_chunk}')
                                    print(f'  content={content_preview[:200]}')
                                    print(f'  reasoning={reasoning_preview[:200]}')
                                    print(f'  完整 chunk: {json.dumps(chunk, ensure_ascii=False)[:1000]}')
                                    err_msg = content_preview or reasoning_preview or f'finish_reason={finish_reason_chunk}'
                                    with _tasks_lock:
                                        if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                                            t = _tasks[task_id]
                                            t['status'] = 'failed'
                                            t['error'] = err_msg[:500]
                                            t['thinking'] = thinking
                                            t['updated_at'] = time.time()
                                            _save_task(t)
                                    return
    
                                choices = chunk.get('choices', [])
                                if not choices:
                                    continue
                                choice = choices[0]
                                if not isinstance(choice, dict):
                                    continue
                                delta = choice.get('delta', {})
                                if not isinstance(delta, dict):
                                    continue
    
                                # 累积 reasoning_content
                                reasoning = delta.get('reasoning_content', '') or ''
                                if reasoning:
                                    thinking += reasoning
                                    # 首个 thinking chunk 到达 → 服务正常，取消定时器/升超时
                                    if sock:
                                        try:
                                            sock.settimeout(CHUNK_READ_TIMEOUT)  # 使用更长的读取超时（见下面常量定义）
                                        except Exception:
                                            pass
                                    else:
                                        try:
                                            _close_timer.cancel()
                                        except Exception:
                                            pass
                                    # 带参考图时监测"打码验证"，15s 未出现则判定违规
                                    if has_refs and not thinking_verified:
                                        if thinking_start_time is None:
                                            thinking_start_time = time.time()
                                        if '打码验证' in thinking:
                                            thinking_verified = True
                                            print(f'[审核] 任务 {task_id} 思考出现"打码验证"，图片通过审核')
                                        elif time.time() - thinking_start_time > 15:
                                            print(f'[审核] 任务 {task_id} 思考 15s 未见"打码验证"，判定违规')
                                            with _tasks_lock:
                                                if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                                                    t = _tasks[task_id]
                                                    t['status'] = 'failed'
                                                    t['error'] = '参考图片可能包含违规内容，无法上传'
                                                    t['thinking'] = thinking
                                                    t['updated_at'] = time.time()
                                                    _save_task(t)
                                            return
    
                                    # 实时保存 thinking 到任务
                                    with _tasks_lock:
                                        if task_id in _tasks:
                                            t = _tasks[task_id]
                                            t['thinking'] = thinking
                                            t['updated_at'] = time.time()
                                            _save_task(t)
    
                                # 累积 content
                                content_delta = delta.get('content', '') or ''
                                if content_delta:
                                    final_content += content_delta
    
                                # 检查是否结束
                                finish_reason = choice.get('finish_reason', '')
                                if finish_reason == 'stop':
                                    break
                                if finish_reason in ('content_filter', 'length'):
                                    print(f'[警告] 任务 {task_id} finish_reason={finish_reason}'
                                          f' chunk: {json.dumps(chunk, ensure_ascii=False)[:500]}')
    
                        except socket.timeout:
                            elapsed = time.time() - stream_start_time
                            print(f'[调试] 任务 {task_id} socket 读取超时，已耗时 {elapsed:.1f}s，thinking={bool(thinking)}')
                            if not thinking:
                                print(f'[宕机] 任务 {task_id} {elapsed:.0f}s 无任何响应，判定服务宕机')
                                with _tasks_lock:
                                    if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                                        t = _tasks[task_id]
                                        t['status'] = 'failed'
                                        t['error'] = 'SERVICE_DOWN:生图服务无响应，可能已宕机，请重启服务'
                                        t['thinking'] = thinking
                                        t['updated_at'] = time.time()
                                        _save_task(t)
                                return
                            raise  # 已有 thinking 后的超时，交给外层重试逻辑
    
                    # 温和排空连接，避免 RST 导致 flow2api 卡在"处理中"
                    try:
                        resp.read(4096)
                    except Exception:
                        pass
    
                    # 构建兼容 _store_image_from_response 的响应格式
                    resp_data = {
                        'choices': [{
                            'message': {
                                'content': final_content,
                                'reasoning_content': thinking
                            }
                        }]
                    }
                    task['response_body'] = json.dumps(resp_data, ensure_ascii=False)[:10000]
    
                try:
                    image_url = _store_image_from_response(resp_data, base)
                except ImageStorageError as e:
                    with _tasks_lock:
                        if task_id not in _tasks:
                            return
                        task = _tasks[task_id]
                        if task['status'] == 'cancelled':
                            return
                        task['status'] = 'failed'
                        task['error'] = str(e)
                        task['image_url'] = ''
                        task['updated_at'] = time.time()
                        _save_task(task)
                    return

                with _tasks_lock:
                    if task_id not in _tasks:
                        return
                    task = _tasks[task_id]
                    if task['status'] == 'cancelled':
                        return

                    if image_url and image_url.startswith('/api/images/'):
                        task['status'] = 'completed'
                        task['image_url'] = image_url
                    elif final_content.strip():
                        has_image = bool(
                            re_module.search(r'!\[.*?\]\(.*?\)', final_content) or
                            re_module.search(r'https?://\S+\.(?:jpg|jpeg|png|gif|webp)', final_content) or
                            'data:image/' in final_content
                        )
                        task['status'] = 'failed'
                        task['image_url'] = ''
                        task['error'] = '生成图片下载或存入数据库失败' if has_image else final_content.strip()[:500]
                    else:
                        task['status'] = 'failed'
                        task['image_url'] = ''
                        task['error'] = '响应中未找到图片'

                    task['updated_at'] = time.time()
                    _save_task(task)
                return  # Success

            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')[:500]
                status_code = e.code
                task['response_status'] = status_code
                task['response_headers'] = json.dumps(dict(e.headers.items()), ensure_ascii=False)
                task['response_body'] = err_body[:10000]
                print(f'[后端响应错误] 任务 {task_id}')
                print(f'  状态码: {status_code}')
                print(f'  响应体: {err_body}')
                # 429 Too Many Requests: 使用更长退避时间重试
                if status_code == 429:
                    if attempt < retry_count:
                        delay = 30 * (attempt + 1)  # 30s, 60s, ...
                        last_error = f'HTTP 429: {err_body}'
                        print(f'[限流] 任务 {task_id} 遭遇频率限制，{delay:.0f}s 后进行第 {attempt + 1}/{retry_count} 次重试')
                        time.sleep(delay)
                        continue
                    else:
                        # 重试次数用尽，标记失败
                        with _tasks_lock:
                            if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                                t = _tasks[task_id]
                                t['status'] = 'failed'
                                t['error'] = f'请求过于频繁，请稍后重试 (HTTP 429): {err_body}'
                                t['updated_at'] = time.time()
                                _save_task(t)
                        return
                # 403 Forbidden: Cloudflare 等安全网关拦截（如 Error 1010: browser signature）
                elif status_code == 403:
                    if attempt < retry_count:
                        delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 2)
                        last_error = f'HTTP 403: {err_body}'
                        print(f'[防护墙] 任务 {task_id} 遭遇 403 拦截（可能 Cloudflare/WAF），'
                              f'{delay:.0f}s 后进行第 {attempt + 1}/{retry_count} 次重试')
                        time.sleep(delay)
                        continue
                    else:
                        # 提示用户检查 API 地址和密钥
                        with _tasks_lock:
                            if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                                t = _tasks[task_id]
                                t['status'] = 'failed'
                                t['error'] = f'请求被安全网关拒绝 (HTTP 403)，可能原因：IP 被封锁、API 地址需要验证或密钥无效\n详情: {err_body}'
                                t['updated_at'] = time.time()
                                _save_task(t)
                        return
                elif status_code >= 500 and attempt < retry_count:
                    last_error = f'HTTP {status_code}: {err_body}'
                    delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 2)
                    print(f'[重试] 任务 {task_id} HTTP {status_code}，'
                          f'第 {attempt + 1}/{MAX_RETRIES} 次重试，{delay:.0f}s 后重试 -> {base}/v1/chat/completions')
                    time.sleep(delay)
                    continue
                with _tasks_lock:
                    if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                        t = _tasks[task_id]
                        t['status'] = 'failed'
                        t['error'] = f'HTTP {status_code}: {err_body}'
                        t['updated_at'] = time.time()
                        _save_task(t)
                return

            except (urllib.error.URLError, socket.timeout, OSError) as e:
                err_msg = str(e.reason)[:200] if hasattr(e, 'reason') else str(e)[:200]
                print(f'[后端连接错误] 任务 {task_id} - {err_msg}')
                if attempt < retry_count:
                    last_error = err_msg
                    delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 2)
                    print(f'[重试] 任务 {task_id} 网络错误: {err_msg}，'
                          f'第 {attempt + 1}/{retry_count} 次重试，{delay:.0f}s 后重试 -> {base}/v1/chat/completions')
                    time.sleep(delay)
                    continue
                with _tasks_lock:
                    if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                        t = _tasks[task_id]
                        t['status'] = 'failed'
                        t['error'] = f'连接失败: {err_msg}'
                        t['updated_at'] = time.time()
                        _save_task(t)
                return

            except Exception as e:
                err_msg = str(e)[:200]
                if attempt < retry_count:
                    last_error = err_msg
                    delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 2)
                    target_url = f'{base}/v1/chat/completions' if 'base' in locals() else '未知'
                    print(f'[重试] 任务 {task_id} 错误: {err_msg}，'
                          f'第 {attempt + 1}/{retry_count} 次重试，{delay:.0f}s 后重试 -> {target_url}')
                    time.sleep(delay)
                    continue
                with _tasks_lock:
                    if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                        t = _tasks[task_id]
                        t['status'] = 'failed'
                        t['error'] = str(e)[:500]
                        t['updated_at'] = time.time()
                        _save_task(t)
                return

        # All retries exhausted
        if last_error:
            with _tasks_lock:
                if task_id in _tasks and _tasks[task_id]['status'] != 'cancelled':
                    t = _tasks[task_id]
                    if t['status'] != 'failed':
                        t['status'] = 'failed'
                        t['error'] = f'重试耗尽: {last_error[:480]}'
                        t['updated_at'] = time.time()
                        _save_task(t)

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

# --- Task API endpoints ---

@app.route('/api/tasks', methods=['POST'])
def create_task():
    data = request.get_json(force=True, silent=True) or {}
    prompt = (data.get('prompt') or '').strip()
    if not prompt:
        return jsonify({'error': 'prompt is required'}), 400

    with _tasks_lock:
        pending_count = sum(1 for t in _tasks.values() if t['status'] == 'pending')
        if pending_count >= MAX_QUEUE_DEPTH:
            return jsonify({'error': f'任务队列已满（{MAX_QUEUE_DEPTH}），请等待当前任务完成后重试'}), 503

    task_id = 'task-' + uuid.uuid4().hex
    now = time.time()

    task = {
        'id': task_id,
        'status': 'pending',
        'prompt': prompt,
        'model': data.get('model', ''),
        'provider': data.get('provider', ''),
        'refs': data.get('refs', []),
        'aspectRatio': data.get('aspectRatio', '1:1'),
        'image_url': '',
        'error': '',
        'thinking': '',
        'retry_count': 0,
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
    return jsonify(result)
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
