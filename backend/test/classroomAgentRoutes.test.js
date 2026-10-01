const test = require('node:test');
const assert = require('node:assert/strict');
const { createDelegationStore, normalizeClasses } = require('../routes/classroomAgentRoutes');

test('normalizes only verifiable class permissions', () => {
  assert.deepEqual(normalizeClasses([
    { classCode: 'k339', squadId: 's-1' },
    { name: ' J342 ', squadId: 's-2' },
    { classCode: 'NO-SQUAD' },
  ]), [
    { id: 'K339', name: 'K339', squadId: 's-1' },
    { id: 'J342', name: 'J342', squadId: 's-2' },
  ]);
});

test('delegation is one-time and remains bound to a live logged-in session', () => {
  let timestamp = 1_000;
  const sessions = new Map([['sid-1', { scraper: {}, username: 'Amber' }]]);
  const store = createDelegationStore({ sessions, tokenTtlMs: 45_000, now: () => timestamp });
  const issued = store.issue({
    sid: 'sid-1',
    username: 'Amber',
    classes: [{ classCode: 'K339', squadId: 's-1' }],
  });
  const first = store.exchange(issued.token);
  assert.equal(first.sid, 'sid-1');
  assert.equal(first.username, 'Amber');
  assert.equal(first.classes.length, 1);
  assert.equal(store.exchange(issued.token), null);

  const revoked = store.issue({ sid: 'sid-1', username: 'Amber', classes: [] });
  sessions.get('sid-1').scraper = null;
  assert.equal(store.exchange(revoked.token), null);
});

test('expired delegation cannot be exchanged', () => {
  let timestamp = 1_000;
  const sessions = new Map([['sid-1', { scraper: {} }]]);
  const store = createDelegationStore({ sessions, tokenTtlMs: 10, now: () => timestamp });
  const issued = store.issue({ sid: 'sid-1', username: 'Amber', classes: [] });
  timestamp += 11;
  assert.equal(store.exchange(issued.token), null);
});
