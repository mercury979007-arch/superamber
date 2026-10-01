const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractClassCode,
  extractClassMapFromHtml,
  extractDashboardClassMap,
  extractDashboardTutorId,
  extractMySquadClassMap,
} = require('../lib/classMapParser');

test('special class names are recognized without truncation', () => {
  assert.equal(extractClassCode('FS1 我的班级'), 'FS1');
  assert.equal(extractClassCode('DK28 我的班级'), 'DK28');
  assert.equal(extractClassCode('X1平方 我的班级'), 'X1平方');
  assert.equal(extractClassCode('MOVERS-1 我的班级'), 'MOVERS-1');
  assert.equal(extractClassCode('C²-2 我的班级'), 'C²-2');
});

test('my-squad parser keeps relationship source for special class names', () => {
  const html = `
    <table><tbody>
      <tr><td class="column-name"><a href="/admin/squad_console?type=offline&id=11">FS1</a></td></tr>
      <tr><td class="column-name"><a href="/admin/squad_console?type=offline&id=12">X1平方</a></td></tr>
      <tr><td class="column-name"><a href="/admin/squad_console?type=offline&id=13">C²-2</a></td></tr>
    </tbody></table>`;
  assert.deepEqual(extractMySquadClassMap(html), [
    { classCode: 'FS1', squadId: '11', relationship: 'current-head-teacher', sources: ['my_squad'], type: 'offline' },
    { classCode: 'X1平方', squadId: '12', relationship: 'current-head-teacher', sources: ['my_squad'], type: 'offline' },
    { classCode: 'C²-2', squadId: '13', relationship: 'current-head-teacher', sources: ['my_squad'], type: 'offline' },
  ]);
});

test('dashboard parser keeps manageable offline classes and excludes online classes', () => {
  assert.equal(extractDashboardTutorId('<script>axios.get("/admin/dashboard/getSquadData?id=297")</script>'), '297');
  assert.deepEqual(extractDashboardClassMap({ myClasses: [
    { name: 'DK28', squad_id: 28, type: 'offline' },
    { name: 'X1平方', squad_id: 29, type: 'offline' },
    { name: '繁星1班', squad_id: 30, type: 'online' },
  ] }), [
    { classCode: 'DK28', squadId: '28', relationship: 'manageable', sources: ['dashboard'], type: 'offline' },
    { classCode: 'X1平方', squadId: '29', relationship: 'manageable', sources: ['dashboard'], type: 'offline' },
  ]);
});

test('extractClassMapFromHtml parses unique class codes from dashboard html', () => {
  const html = `
    <div class="small-box">
      <div>K2 我的班级列表</div>
      <a href="/admin/squad_console?id=101&type=offline">进入班级</a>
    </div>
    <div class="panel">
      <span>GN67 晚辅班</span>
      <a href="/admin/squad_console?id=202&type=offline">查看详情</a>
    </div>
    <div class="panel">
      <span>GN67 晚辅班</span>
      <a href="/admin/squad_console?id=202&type=offline">重复详情</a>
    </div>
    <div class="panel"><span>DK28 特殊班</span><a href="/admin/squad_console?id=303&type=offline">详情</a></div>
    <div class="panel"><span>X1平方 特殊班</span><a href="/admin/squad_console?id=404&type=offline">详情</a></div>
  `;

  assert.deepEqual(extractClassMapFromHtml(html), [
    { classCode: 'K2', squadId: '101' },
    { classCode: 'GN67', squadId: '202' },
    { classCode: 'DK28', squadId: '303' },
    { classCode: 'X1平方', squadId: '404' },
  ]);
});
