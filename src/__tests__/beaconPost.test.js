import { describe, it, expect, vi, beforeEach } from 'vitest';

import { beaconPost } from '../store.js';

describe('beaconPost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  });

  it('应使用 application/json 作为 Content-Type 发送数据', () => {
    beaconPost('/api/active', { id: 'test-id' });

    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);

    const [url, body] = navigator.sendBeacon.mock.calls[0];

    expect(url).toBe('http://127.0.0.1:5001/api/active');

    expect(body).toBeInstanceOf(Blob);
    expect(body.type).toBe('application/json');
  });

  it('应正确序列化 JSON 数据', async () => {
    const testData = { id: 'session-123', name: 'test' };
    beaconPost('/api/active', testData);

    const [, body] = navigator.sendBeacon.mock.calls[0];

    const text = await body.text();
    const parsed = JSON.parse(text);
    expect(parsed).toEqual(testData);
  });

  it('beaconPost 调用不应抛异常', () => {
    expect(() => beaconPost('/api/active', { id: 'x' })).not.toThrow();
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });
});
