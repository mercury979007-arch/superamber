const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractComponentStats,
  extractJsonStats,
  extractStats,
  mergeMetrics,
} = require('../lib/minipinMetrics');

test('extractStats reads minipin and coupon values from plain text', () => {
  const metrics = extractStats('当前班内余额: 658 MP，可发放 Coupon: 5，发放 MP: 401，待发 MP: 7809');
  assert.deepEqual(metrics, {
    coupon: 5,
    minipin: 658,
    distributed: 401,
    pending: 7809,
  });
});

test('extractJsonStats walks nested payloads to find mp metrics', () => {
  const metrics = extractJsonStats({
    summary: {
      minipin: '120',
      coupon_count: 3,
      pending_mp: 12,
      distributed_mp: 30,
    },
  });

  assert.deepEqual(metrics, {
    coupon: 3,
    minipin: 120,
    distributed: 30,
    pending: 12,
  });
});

test('extractComponentStats plus mergeMetrics can fill missing fields from html snippets', () => {
  const target = { coupon: null, minipin: null, distributed: null, pending: null };
  const probe = extractComponentStats('<div class="coupon-minipin">Coupon 8 Mini Pin 233</div>');
  mergeMetrics(target, probe.metrics);

  assert.equal(target.coupon, 8);
  assert.equal(target.minipin, 233);
});
