from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3, json, os, base64, uuid, time

app = Flask(__name__)
CORS(app)

DATA_DIR = 'data'
IMAGES_DIR = os.path.join(DATA_DIR, 'images')
os.makedirs(IMAGES_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, 'store.db')

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
            filename TEXT NOT NULL,
            hash TEXT,
            created_at INTEGER NOT NULL
        )
    ''')
    # Migration: add hash column if table existed before the column was added
    try:
        conn.execute('ALTER TABLE images ADD COLUMN hash TEXT')
    except sqlite3.OperationalError:
        pass  # column already exists
    # Create unique index for hash dedup (IF NOT EXISTS skips if already present)
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

# --- Active session id ---

@app.route('/api/active', methods=['GET'])
def get_active():
    val = kv_get('active', '')
    return val if isinstance(val, str) else ''

@app.route('/api/active', methods=['POST'])
def save_active():
    kv_set('active', request.json.get('id', ''))
    return jsonify({'ok': True})

# --- Image upload / serve ---

@app.route('/api/images', methods=['POST'])
def upload_image():
    data = request.json
    img_data = data['data']
    if ',' in img_data:
        img_data = img_data.split(',')[1]
    ext = data.get('ext', 'png')
    img_hash = data.get('hash', '')

    image_id = uuid.uuid4().hex
    filename = f"{image_id}.{ext}"

    conn = get_db()
    conn.execute(
        'INSERT OR IGNORE INTO images (id, filename, hash, created_at) VALUES (?, ?, ?, ?)',
        (image_id, filename, img_hash or None, int(time.time()))
    )
    conn.commit()

    if img_hash:
        # Check if our insert was accepted or ignored due to hash conflict
        actual = conn.execute(
            'SELECT filename FROM images WHERE id=?', (image_id,)
        ).fetchone()
        if actual is None:
            # Another request inserted first with the same hash
            existing = conn.execute(
                'SELECT filename FROM images WHERE hash=?', (img_hash,)
            ).fetchone()
            conn.close()
            return jsonify({'url': f'/api/images/{existing["filename"]}'})
    conn.close()

    with open(os.path.join(IMAGES_DIR, filename), 'wb') as f:
        f.write(base64.b64decode(img_data))

    return jsonify({'url': f'/api/images/{filename}'})

@app.route('/api/images/<filename>')
def serve_image(filename):
    return send_from_directory(IMAGES_DIR, filename)

if __name__ == '__main__':
    print('Backend running on http://127.0.0.1:5001')
    app.run(host='127.0.0.1', port=5001)
