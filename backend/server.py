from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import sqlite3, json, os, base64, uuid, time, shutil

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
    import re as _re
    for row in conn.execute('SELECT key, value FROM kv WHERE key IN ("sessions", "materials")').fetchall():
        val = row['value']
        fixed = _re.sub(r'(/api/images/[a-f0-9]+)\.\w+', r'\1', val)
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

if __name__ == '__main__':
    print('Backend running on http://127.0.0.1:5001')
    app.run(host='127.0.0.1', port=5001)
