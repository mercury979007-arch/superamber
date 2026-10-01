const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTaskRewardLedger } = require('../lib/taskRewardLedger');

test('task reward ledger blocks overlapping task lists only for students already issued', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-'));
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json') });
  const first = await ledger.begin({
    username: 'Teacher', classId: 'J328', selectedWeekIds: ['A', 'B'],
    rewards: [{ studentId: 's1', amount: 0.5 }, { studentId: 's2', amount: 0.5 }],
  });
  assert.equal(first.ok, true);
  await ledger.complete(first.entryId, { successfulStudentIds: ['s1'], failedStudentIds: ['s2'] });

  const overlap = await ledger.begin({
    username: 'teacher', classId: 'j328', selectedWeekIds: ['B', 'C'],
    rewards: [{ studentId: 's1', amount: 0.5 }, { studentId: 's2', amount: 0.5 }],
  });
  assert.equal(overlap.ok, false);
  assert.deepEqual(overlap.conflictingStudentIds, ['s1']);

  const retry = await ledger.begin({
    username: 'teacher', classId: 'J328', selectedWeekIds: ['A', 'B'],
    rewards: [{ studentId: 's2', amount: 0.5 }],
  });
  assert.equal(retry.ok, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('task reward ledger treats uncertain upstream results as protected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-'));
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json') });
  const first = await ledger.begin({
    username: 'teacher', classId: 'J328', selectedWeekIds: ['A'],
    rewards: [{ studentId: 's1', amount: 0.5 }],
  });
  await ledger.uncertain(first.entryId, 'connection lost');
  const retry = await ledger.begin({
    username: 'teacher', classId: 'J328', selectedWeekIds: ['A'],
    rewards: [{ studentId: 's1', amount: 0.5 }],
  });
  assert.equal(retry.ok, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('pending entries remain visible and become manually recoverable only after the safety window', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-pending-'));
  let now = new Date('2026-09-12T10:00:00.000Z');
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json'), now: () => now });
  const first = await ledger.begin({
    username: 'teacher', classId: 'J328', selectedWeekIds: ['A'],
    rewards: [{ studentId: 's1', amount: 0.5 }],
  });
  const pending = await ledger.recoverable({ username: 'teacher', classId: 'J328' });
  assert.equal(pending.status, 'pending');
  assert.equal(await ledger.releaseUnconfirmed({
    username: 'teacher', classId: 'J328', entryId: first.entryId, acknowledgedNotReceived: true,
  }), null);
  now = new Date('2026-09-12T10:05:01.000Z');
  const uncertain = await ledger.recoverable({ username: 'teacher', classId: 'J328' });
  assert.equal(uncertain.status, 'uncertain');
  const released = await ledger.releaseUnconfirmed({
    username: 'teacher', classId: 'J328', entryId: first.entryId, acknowledgedNotReceived: true,
  });
  assert.equal(released.students[0].status, 'not-received');
  await fs.rm(dir, { recursive: true, force: true });
});

test('task reward ledger protects task and speaking components independently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-components-'));
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json') });
  const first = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1', 'speaking:2026-08-25'],
    rewards: [{ studentId: '1', amount: 0.8, sourceKeys: ['week-1', 'speaking:2026-08-25'] }],
  });
  await ledger.complete(first.entryId, { successfulStudentIds: ['1'] });

  const newSpeakingDate = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['speaking:2026-08-26'],
    rewards: [{ studentId: '1', amount: 0.1, sourceKeys: ['speaking:2026-08-26'] }],
  });
  assert.equal(newSpeakingDate.ok, true);

  const repeatedTask = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1'],
    rewards: [{ studentId: '1', amount: 0.5, sourceKeys: ['week-1'] }],
  });
  assert.equal(repeatedTask.ok, false);
  assert.deepEqual(repeatedTask.conflictingStudentIds, ['1']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('uncertain task rewards reconcile only exact student, time and amount matches', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-reconcile-'));
  const now = new Date('2026-09-12T10:00:00.000Z');
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json'), now: () => now });
  const first = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1'],
    rewards: [
      { studentId: '001', studentName: 'Amy', chineseName: '艾米', amount: 0.5 },
      { studentId: '002', studentName: 'Ben', chineseName: '本', amount: 0.8 },
    ],
  });
  await ledger.uncertain(first.entryId, 'connection lost');

  const issue = await ledger.reconcile({
    username: 'amber', classId: 'j328', entryId: first.entryId,
    records: [
      { id: 'a', studentNo: '001', amount: 0.5, occurredAt: '2026-09-12T10:00:12.000Z', type: '发放', tagName: 'MP' },
      { id: 'b', studentNo: '002', amount: 0.7, occurredAt: '2026-09-12T10:00:15.000Z', type: '发放', tagName: 'MP' },
      { id: 'c', studentNo: '002', amount: 0.8, occurredAt: '2026-09-12T10:06:00.000Z', type: '发放', tagName: 'MP' },
    ],
  });
  assert.equal(issue.status, 'uncertain');
  assert.deepEqual(issue.students.map(({ studentId, studentName, status }) => ({ studentId, studentName, status })), [
    { studentId: '001', studentName: 'Amy', status: 'confirmed' },
    { studentId: '002', studentName: 'Ben', status: 'unresolved' },
  ]);

  const released = await ledger.releaseUnconfirmed({
    username: 'Amber', classId: 'J328', entryId: first.entryId, acknowledgedNotReceived: true,
  });
  assert.equal(released.status, 'complete');
  assert.equal(released.students.find((student) => student.studentId === '002').status, 'not-received');
  const retry = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1'],
    rewards: [{ studentId: '002', amount: 0.8 }],
  });
  assert.equal(retry.ok, true);
  const duplicate = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1'],
    rewards: [{ studentId: '001', amount: 0.5 }],
  });
  assert.equal(duplicate.ok, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('uncertain task rewards close when every exact grant is found', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-reward-ledger-full-reconcile-'));
  const now = new Date('2026-09-12T10:00:00.000Z');
  const ledger = createTaskRewardLedger({ storePath: path.join(dir, 'ledger.json'), now: () => now });
  const first = await ledger.begin({
    username: 'Amber', classId: 'J328', selectedWeekIds: ['week-1'],
    rewards: [{ studentId: '001', amount: 0.8 }],
  });
  await ledger.uncertain(first.entryId, 'timeout');
  const issue = await ledger.reconcile({
    username: 'Amber', classId: 'J328', entryId: first.entryId,
    records: [
      { id: 'mp', studentNo: '001', amount: 0.5, occurredAt: '2026-09-12T10:00:12.000Z', type: '1', tagName: 'MiniPin', grantName: 'MP' },
      { id: 'cp', studentNo: '001', amount: 0.3, occurredAt: '2026-09-12T10:00:12.000Z', type: '1', tagName: 'MiniPin', grantName: 'CP' },
    ],
  });
  assert.equal(issue.status, 'complete');
  assert.equal(issue.students[0].status, 'confirmed');
  assert.equal(await ledger.latest({ username: 'Amber', classId: 'J328', status: 'uncertain' }), null);
  await fs.rm(dir, { recursive: true, force: true });
});
