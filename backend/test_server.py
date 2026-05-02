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
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    @property
    def fp(self):
        return None

    def __iter__(self):
        return iter([
            b'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n',
            b'data: {"choices":[{"delta":{"content":"![img](https://example.com/out.png)"}}]}\n',
            b'data: [DONE]\n',
        ])

    def close(self):
        pass


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
        self.assertTrue(captured['body']['stream'])
        self.assertEqual(captured['body']['messages'][0]['role'], 'user')
        content = captured['body']['messages'][0]['content']
        self.assertEqual(content[0], {'type': 'text', 'text': '画一只猫'})
        self.assertEqual(content[1], {
            'type': 'image_url',
            'image_url': {'url': 'data:image/png;base64,AAAA'},
        })


if __name__ == '__main__':
    unittest.main()
