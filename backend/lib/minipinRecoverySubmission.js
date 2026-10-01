const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// An exclusive on-disk claim survives process restarts and concurrent requests.
// Incomplete claims are never retried: the upstream has no idempotency key.
async function submitRecoveryOnce({ directory, username, requestId, payload, submit }) {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(String(requestId || ''))) {
    throw new Error('回收请求缺少有效的一次性编号，请重新生成确认单。');
  }
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const key = digest(`${username}\0${requestId}`);
  const payloadHash = digest(JSON.stringify(payload));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const claimPath = path.join(directory, `${key}.json`);
  let claim;
  try {
    claim = await fs.open(claimPath, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await fs.readFile(claimPath, 'utf8').then(JSON.parse).catch(() => null);
    if (previous?.payloadHash && previous.payloadHash !== payloadHash) throw new Error('同一回收编号的名单或数量已改变，请重新生成确认单。');
    if (previous?.result) return { ...previous.result, duplicate: true };
    throw new Error('该回收请求已经提交或结果无法确认，请先到教务系统核对；禁止自动重试。');
  }
  try {
    await claim.writeFile(JSON.stringify({ payloadHash, state: 'submitting' }));
    await claim.sync();
  } finally {
    await claim.close();
  }
  const result = await submit();
  await fs.writeFile(claimPath, JSON.stringify({ payloadHash, state: 'complete', result }), { mode: 0o600 });
  return result;
}

module.exports = { submitRecoveryOnce };
