const test = require('node:test');
const assert = require('node:assert/strict');
const Scraper = require('../scraper/scraper');

for (const variant of ['success', 'rejected', 'unknown', 'timeout']) {
  test(`MiniPin ${variant}: sends one uploadGrant and never probes other write endpoints`, async () => {
    const scraper = new Scraper();
    const writes = [];
    scraper.resolveSquadId = async () => ({ classCode: 'K339', squadId: '339' });
    scraper.requestText = async () => ({ text: '<input name="_token" value="fixture-token">' });
    scraper.request = async (url, options = {}) => {
      if (url.includes('getStudentList')) return Response.json({ data: [{ id: 1, no: '001', en_name: 'Amy', ch_name: '张三' }] });
      if (url.includes('getTableDataTag')) return Response.json({ data: { rows: [{ id: 10, name: 'MP奖励' }] } });
      writes.push(url);
      assert.equal(url, '/admin/squad/cop_mip/uploadGrant');
      assert.equal(options.method, 'POST');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('student_arr[0][no]'), '001');
      assert.equal(body.get('student_arr[0][number]'), '1.2');
      assert.equal(body.get('squad_id'), '339');
      if (variant === 'timeout') throw new Error('connection timeout');
      if (variant === 'unknown') return new Response('bad gateway', { status: 502 });
      return Response.json(variant === 'success' ? { code: 1, msg: '成功' } : { code: 0, msg: '额度不足' });
    };
    const submit = () => scraper.submitMinipinDirect('K339', [{ studentId: '001', studentName: 'Amy', amount: 1.2 }]);
    if (variant === 'unknown' || variant === 'timeout') await assert.rejects(submit, /未确认|timeout/);
    else {
      const result = await submit();
      assert.equal(result.success, variant === 'success' ? 1 : 0);
      if (variant === 'rejected') {
        assert.equal(result.retryable, false);
        assert.equal(result.failedList[0].error, '额度不足');
      }
    }
    assert.equal(writes.length, 1);
  });
}
