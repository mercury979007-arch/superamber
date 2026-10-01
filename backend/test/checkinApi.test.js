const test = require('node:test');
const assert = require('node:assert/strict');

const {
  choosePreferredTerm,
  enqueueCheckinExport,
  fetchCheckinRowsForRange,
  summarizePunchRowsForRange,
} = require('../lib/checkinApi');

test('check-in exports are serialized across different teachers and features', async () => {
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstScraper = { username: 'TeacherA' };
  const secondScraper = { username: 'TeacherB' };

  const first = enqueueCheckinExport(firstScraper, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await firstGate;
    active -= 1;
    return 'first';
  });
  const second = enqueueCheckinExport(secondScraper, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    active -= 1;
    return 'second';
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(maxActive, 1);
});

test('choosePreferredTerm prefers exact semester and then year fallback', () => {
  const terms = [
    { id: 1, name: '2025学年春季学期' },
    { id: 2, name: '2025学年秋季学期' },
    { id: 3, name: '2026学年春季学期' },
  ];

  assert.equal(choosePreferredTerm(terms, '2025', '2025学年秋季学期')?.id, 2);
  assert.equal(choosePreferredTerm(terms, '2026', '')?.id, 3);
  assert.equal(choosePreferredTerm(terms, '', '')?.id, 1);
});

test('summarizePunchRowsForRange converts date columns into workbook rows', () => {
  const rows = summarizePunchRowsForRange([
    {
      学号: '20240001',
      姓名: '张三',
      英文名: 'Sam',
      '2026-04-07': '√',
      '2026-04-08': '补',
      '2026-04-09': '',
    },
    {
      no: '20240002',
      ch_name: '李四',
      '2026-04-07': '1',
      '2026-04-08': '正常',
      '2026-04-09': '未打卡',
    },
  ], '2026-04-07', '2026-04-09');

  assert.deepEqual(rows[0], {
    no: '20240001',
    ch_name: '张三',
    en_name: 'Sam',
    all_check_days: 2,
    normal_record_total: 1,
    supplement_times: 1,
    date_values: {
      '2026-04-07': '√',
      '2026-04-08': '补',
      '2026-04-09': '',
    },
    range_start: '2026-04-07',
    range_end: '2026-04-09',
  });
  assert.equal(rows[1].all_check_days, 2);
  assert.equal(rows[1].normal_record_total, 2);
  assert.equal(rows[1].supplement_times, 0);
  assert.equal(rows[1].en_name, '');
});

test('fetchCheckinRowsForRange uses HTTP endpoints without browser state', async () => {
  const calls = [];
  const scraper = {
    async resolveSquadId(classId) {
      assert.equal(classId, 'J328');
      return { classCode: 'J328', squadId: '900' };
    },
    async request(path) {
      calls.push(path);
      if (path === '/admin/check_every_day/getTerms') {
        return {
          async json() {
            return {
              code: 200,
              termData: [
                { id: 11, name: '2025学年春季学期' },
                { id: 22, name: '2025学年秋季学期' },
              ],
            };
          },
        };
      }
      if (path.includes('/admin/check_every_day/getTableData?')) {
        return {
          async json() {
            return {
              code: 200,
              returnData: [
                {
                  学号: '20240001',
                  中文名: '张三',
                  '2026-04-07': '√',
                  '2026-04-08': '补',
                },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };

  const result = await fetchCheckinRowsForRange(scraper, {
    classId: 'J328',
    rangeStart: '2026-04-07',
    rangeEnd: '2026-04-08',
    preferredYear: '2025',
    preferredSemester: '2025学年秋季学期',
  });

  assert.equal(result.classCode, 'J328');
  assert.equal(result.squadId, '900');
  assert.equal(result.termId, '22');
  assert.equal(result.termName, '2025学年秋季学期');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].all_check_days, 2);
  assert.deepEqual(calls, [
    '/admin/check_every_day/getTerms',
    '/admin/check_every_day/getTableData?squad_id=900&squad_type=offline&term_id=22&student_id=',
  ]);
});
