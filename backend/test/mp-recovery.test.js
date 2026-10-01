const test = require('node:test');
const assert = require('node:assert/strict');
const EducationSystemScraper = require('../scraper/scraper');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createScraper({ recoveryResponse = { code: 1, msg: '成功' } } = {}) {
  const scraper = new EducationSystemScraper({ baseUrl: 'https://mock.invalid' });
  const posts = [];
  scraper.resolveSquadId = async () => ({ classCode: 'J342', squadId: '1046' });
  scraper.getDecodedCookieValue = () => 'xsrf-cookie';
  scraper.requestText = async () => ({ text: '<input name="_token" value="csrf-live">' });
  scraper.request = async (pathname, options = {}) => {
    if (pathname.startsWith('/admin/squad/cop_mip/getStudentData?')) {
      return jsonResponse({ code: 1, data: { students: [
        { id: 91, no: 'S001', en_name: 'Amy', ch_name: '安安', mp_number: 2, cp_number: 5 },
        { id: 92, no: 'S002', en_name: 'Bob', ch_name: '博博', mp_number: 1, cp_number: 0 },
      ], count: 2 } });
    }
    if (pathname.startsWith('/admin/squad/cop_mip/getTableDataTag?')) {
      return jsonResponse({ code: 1, data: { rows: [
        { id: 22, name: '行为习惯', type: 2 },
        { id: 8, name: '误操作', type: 2 },
      ], total: 2 } });
    }
    if (pathname === '/admin/squad/cop_mip/recoverBatch') {
      posts.push({ pathname, options });
      return jsonResponse(recoveryResponse.payload || recoveryResponse, recoveryResponse.status || 200);
    }
    throw new Error(`unexpected endpoint: ${pathname}`);
  };
  return { scraper, posts };
}

test('MP recovery context exposes precise balances and defaults to 行为习惯', async () => {
  const { scraper } = createScraper();
  const context = await scraper.getMinipinRecoveryContext('J342');
  assert.equal(context.defaultReason, '行为习惯');
  assert.deepEqual(context.tags.map((tag) => tag.name), ['行为习惯', '误操作']);
  assert.equal(context.students[0].availableMp, 2.5);
  assert.equal(context.students[1].availableMp, 1);
});

test('MP recovery submits one native batch request with nested tag fields', async () => {
  const { scraper, posts } = createScraper();
  const result = await scraper.recoverMinipinDirect('J342', [
    { studentId: 'S001', amount: 0.5 },
    { studentId: 'S002', amount: 1 },
  ]);
  assert.equal(posts.length, 1);
  const form = new URLSearchParams(posts[0].options.body);
  assert.equal(form.get('squad_id'), '1046');
  assert.equal(form.get('type'), '2');
  assert.equal(form.get('number'), '1.5');
  assert.equal(form.get('student_arr[0][id]'), '91');
  assert.equal(form.get('student_arr[0][tag][0][id]'), '22');
  assert.equal(form.get('student_arr[0][tag][0][name]'), '行为习惯');
  assert.equal(form.get('student_arr[0][tag][0][number]'), '0.5');
  assert.equal(form.get('student_arr[1][id]'), '92');
  assert.equal(result.success, 2);
  assert.equal(result.totalMP, 1.5);
  assert.equal(result.reason, '行为习惯');
});

test('MP recovery validates the whole batch against live balances before writing', async () => {
  const { scraper, posts } = createScraper();
  await assert.rejects(
    scraper.recoverMinipinDirect('J342', [
      { studentId: 'S001', amount: 0.5 },
      { studentId: 'S002', amount: 1.1 },
    ]),
    /当前仅有 1 MP.*整批未提交/,
  );
  assert.equal(posts.length, 0);
});

test('MP recovery treats an ambiguous upstream result as at-most-once and never falls back', async () => {
  const { scraper, posts } = createScraper({ recoveryResponse: { payload: { message: 'maybe' }, status: 200 } });
  await assert.rejects(
    scraper.recoverMinipinDirect('J342', [{ studentId: 'S001', amount: 0.5 }]),
    /结果无法确认.*禁止自动重试/,
  );
  assert.equal(posts.length, 1);
});
