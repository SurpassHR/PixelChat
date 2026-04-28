// 为 jsdom 环境添加 sendBeacon polyfill
if (!navigator.sendBeacon) {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: () => true,
    writable: true,
    configurable: true,
  });
}
