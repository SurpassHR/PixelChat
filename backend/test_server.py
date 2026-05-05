import json
import sys
import types
import unittest
from unittest.mock import patch


class FakeFlask:
    def __init__(self, *args, **kwargs):
        pass

    def after_request(self, fn):
        return fn

    def route(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


flask_module = types.ModuleType('flask')
flask_module.Flask = FakeFlask
flask_module.request = types.SimpleNamespace(headers={}, get_json=lambda *args, **kwargs: {})
flask_module.jsonify = lambda *args, **kwargs: args[0] if len(args) == 1 else args
flask_module.make_response = lambda response, status=None: response
cors_module = types.ModuleType('flask_cors')
cors_module.CORS = lambda *args, **kwargs: None
sys.modules.setdefault('flask', flask_module)
sys.modules.setdefault('flask_cors', cors_module)

import server


class FakeStream:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    @property
    def fp(self):
        return None

    def getheaders(self):
        return [('Content-Type', 'text/event-stream'), ('Transfer-Encoding', 'chunked')]

    def read(self, *args):
        return b'{"choices":[{"message":{"content":"![img](https://example.com/out.png)"}}]}'

    def __iter__(self):
        return iter([
            b'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
            b'data: {"choices":[{"delta":{"content":"![img](https://example.com/out.png)"}}]}\n',
            b'data: [DONE]\n',
        ])

    def close(self):
        pass


class ImageStorageTest(unittest.TestCase):
    def test_remote_image_download_failure_does_not_return_external_url(self):
        with patch.object(server, '_extract_image_url', return_value='https://example.com/out.png'), \
             patch.object(server, '_download_and_store_image', return_value=''):
            with self.assertRaises(server.ImageStorageError):
                server._store_image_from_response({}, 'https://api.example.test')

    def test_localhost_api_image_url_is_normalized(self):
        with patch.object(server, '_extract_image_url', return_value='http://127.0.0.1:5001/api/images/out'):
            self.assertEqual(
                server._store_image_from_response({}, 'https://api.example.test'),
                '/api/images/out'
            )


class GenerateRequestModelTest(unittest.TestCase):
    def setUp(self):
        self.task_id = 'task-test'
        self.task = {
            'id': self.task_id,
            'status': 'pending',
            'prompt': '画一只猫',
            'model': 'gpt-image-2',
            'provider': 'custom',
            'refs': [{'name': 'ref.png', 'dataUrl': 'data:image/png;base64,AAAA'}],
            'image_url': '',
            'error': '',
            'thinking': '',
            'retry_count': 0,
            'created_at': 1,
            'updated_at': 1,
        }

    def test_image_storage_failure_marks_task_failed(self):
        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', return_value=FakeStream()), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', side_effect=server.ImageStorageError('生成图片下载或存入数据库失败')):
            server._execute_task(self.task_id)

        self.assertEqual(self.task['status'], 'failed')
        self.assertEqual(self.task['image_url'], '')
        self.assertEqual(self.task['error'], '生成图片下载或存入数据库失败')

    def test_external_generation_request_forwards_selected_model(self):
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured['url'] = req.full_url
            captured['headers'] = dict(req.header_items())
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        self.assertEqual(captured['url'], 'https://api.example.test/v1/chat/completions')
        self.assertEqual(captured['headers']['Authorization'], 'Bearer sk-test')
        self.assertEqual(captured['body']['model'], 'gpt-image-2')
        self.assertEqual(captured['body']['messages'], [{'role': 'user', 'content': [
            {'type': 'text', 'text': '画一只猫'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA', 'detail': 'auto'}},
        ]}])

    def test_gpt_image_prompt_appends_selected_aspect_ratio(self):
        captured = {}
        self.task['aspectRatio'] = '16:9'

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        self.assertEqual(captured['body']['messages'], [{'role': 'user', 'content': [
            {'type': 'text', 'text': '画一只猫 --ar 16:9'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA', 'detail': 'auto'}},
        ]}])

    def test_gpt_image_prompt_does_not_duplicate_same_aspect_ratio(self):
        captured = {}
        self.task['prompt'] = '画一只猫 --ar 3:4'
        self.task['aspectRatio'] = '3:4'

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        self.assertEqual(captured['body']['messages'], [{'role': 'user', 'content': [
            {'type': 'text', 'text': '画一只猫 --ar 3:4'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA', 'detail': 'auto'}},
        ]}])


    def test_gpt_image_with_refs_includes_image_url_in_messages(self):
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        content = captured['body']['messages'][0]['content']
        self.assertIsInstance(content, list)
        self.assertEqual(content[0], {'type': 'text', 'text': '画一只猫'})
        self.assertEqual(content[1], {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA', 'detail': 'auto'}})

    def test_gpt_image_multiple_refs_all_attached(self):
        self.task['refs'] = [
            {'name': 'a.png', 'dataUrl': 'data:image/png;base64,AAAA'},
            {'name': 'b.jpg', 'dataUrl': 'data:image/jpeg;base64,BBBB'},
        ]
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        content = captured['body']['messages'][0]['content']
        self.assertEqual(len(content), 3)
        self.assertEqual(content[0], {'type': 'text', 'text': '画一只猫'})
        self.assertEqual(content[1], {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,AAAA', 'detail': 'auto'}})
        self.assertEqual(content[2], {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,BBBB', 'detail': 'auto'}})

    def test_gpt_image_ref_empty_dataurl_skipped(self):
        self.task['refs'] = [
            {'name': 'bad.png', 'dataUrl': ''},
            {'name': 'good.jpg', 'dataUrl': 'data:image/jpeg;base64,GOOD'},
        ]
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        content = captured['body']['messages'][0]['content']
        self.assertEqual(len(content), 2)
        self.assertEqual(content[0], {'type': 'text', 'text': '画一只猫'})
        self.assertEqual(content[1], {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,GOOD', 'detail': 'auto'}})

    def test_gpt_image_no_refs_plain_text_content(self):
        self.task['refs'] = []
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured['body'] = json.loads(req.data.decode('utf-8'))
            return FakeStream()

        settings = {
            'providers': {
                'custom': {
                    'base_url': 'https://api.example.test/v1/',
                    'api_key': 'sk-test',
                }
            }
        }

        with patch.dict(server._tasks, {self.task_id: self.task}, clear=True), \
             patch.object(server, 'kv_get', return_value=settings), \
             patch.object(server.urllib.request, 'urlopen', side_effect=fake_urlopen), \
             patch.object(server, '_save_task'), \
             patch.object(server, '_store_image_from_response', return_value='/api/images/out.png'):
            server._execute_task(self.task_id)

        self.assertEqual(captured['body']['messages'], [{'role': 'user', 'content': '画一只猫'}])


class TaskListingIntegrityTest(unittest.TestCase):
    def test_list_tasks_returns_all_tasks_in_desc_order(self):
        tasks = {
            f'task-{i}': {
                'id': f'task-{i}',
                'status': 'completed',
                'prompt': f'prompt-{i}',
                'model': 'gpt-image-2',
                'provider': 'custom',
                'refs': [{'name': f'ref-{i}.png', 'dataUrl': 'data:image/png;base64,AAAA'}],
                'image_url': f'/api/images/{i}',
                'error': '',
                'thinking': '',
                'retry_count': 0,
                'created_at': i,
                'updated_at': i,
            }
            for i in range(55)
        }

        with patch.dict(server._tasks, tasks, clear=True):
            result = server.list_tasks()

        self.assertEqual(len(result), 55)
        self.assertEqual(result[0]['id'], 'task-54')
        self.assertEqual(result[-1]['id'], 'task-0')
        self.assertEqual(result[0]['refs'], [{'name': 'ref-54.png'}])
