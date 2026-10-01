const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeReadingWords, createReadingWordsService, readWords } = require('../lib/readingWords/service');
const board = {
  squadId: '710', challenge: { start: '2026-08-31', end: '2026-09-07' },
  students: [
    { studentId: '001', totalDays: 1, rank: 1, daily: [
      { date: '2026-09-06', status: 'normal' }, { date: '2026-09-07', status: 'missed' },
    ] },
    { studentId: '002', totalDays: 1, rank: 2, daily: [{ date: '2026-09-07', status: 'normal' }] },
  ],
};
const roster = [{ studentNo: '001', studentId: 12 }];
test('enriches by student number and date without mutating status, ranks or source', () => {
  const result = mergeReadingWords(board, roster, [{ studentId: 12, date: '2026-09-06', words: '123' }]);
  assert.equal(result.students[0].daily[0].words, 123);
  assert.equal(result.students[0].daily[1].words, 0);
  assert.equal(result.students[1].daily[0].words, null);
  assert.equal(board.students[0].daily[0].words, undefined);
  for (let i=0;i<2;i++) {
    assert.equal(result.students[i].rank, board.students[i].rank);
    assert.equal(result.students[i].totalDays, board.students[i].totalDays);
  }
  assert.equal(mergeReadingWords(board, roster, []).students[0].daily[0].words, null);
  assert.equal(mergeReadingWords(board, roster, [{ studentId: 12, date: '2026-09-06', words: null }]).students[0].daily[0].words, null);
});
test('queries only matched current roster IDs and the explicit date range', async () => {
  const task = { query: async (query, params) => {
    assert.match(query.sql, /status = '1'/); assert.deepEqual(params, [710]);
    return [[...roster, { studentNo: 'foreign', studentId: 99 }]];
  }};
  const result = { query: async (query, params) => {
    assert.deepEqual(params, [12, '2026-08-31', '2026-09-07']);
    assert.match(query.sql, /GROUP BY st_id, date/);
    assert.match(query.sql, /COUNT\(words\) = COUNT\(\*\)/);
    assert.doesNotMatch(query.sql, /squad_id/); // Transferred students retain their own dated records.
    return [[]];
  }};
  const data = await readWords(task, result, board);
  assert.deepEqual(data.roster, roster);
});
test('deduplicates requests, caches briefly and degrades DB failures to unknown words', async () => {
  let calls = 0;
  let now = 100;
  const task = { query: async () => { calls++; return [roster]; } };
  const result = { query: async () => [[{ studentId: 12, date: '2026-09-06', words: 45 }]] };
  const service = createReadingWordsService({ pools: { task, result }, now: () => now });
  const values = await Promise.all([service.enrich(board), service.enrich(board)]);
  assert.equal(calls, 1); assert.equal(values[0].students[0].daily[0].words, 45);
  now += 31000; task.query = async () => { calls++; throw Error('private connection detail'); };
  assert.equal((await service.enrich(board)).students[0].daily[0].words, null);
  await service.enrich(board);
  assert.equal(calls, 2);
});
test('shared pool provider stays lazy and does not close runtime-owned connections', async () => {
  let initialized = 0; let closed = 0;
  const db = { task: { query: async () => [roster], end: async () => closed++ }, result: { query: async () => [[]], end: async () => closed++ } };
  const service = createReadingWordsService({ poolProvider: async () => { initialized++; return db; } });
  assert.equal(initialized, 0);
  await service.enrich(board);
  assert.equal(initialized, 1);
  await service.close();
  assert.equal(closed, 0);
});
