const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDailyReportRewardPolicyStore } = require('../lib/dailyReportRewardPolicyStore');

test('system default includes last-week speaking data and reward source', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-policy-default-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createDailyReportRewardPolicyStore({ storePath: path.join(dir, 'policy.json') });
  const result = await store.get('NewTeacher', 'J328');
  assert.equal(result.scope, 'system');
  assert.equal(result.policy.report.includeSpeaking, true);
  assert.equal(result.policy.sources.speaking, true);
});

test('reward policy inherits teacher default and allows one class to override then restore', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-policy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createDailyReportRewardPolicyStore({ storePath: path.join(dir, 'policy.json') });
  const teacherPolicy = {
    report: { mode: 'senior', includeSpeaking: true, minSpeakingDays: 3, testPassScore: 12, aiVoicePassRate: 82 },
    sources: { basic: true, speaking: true },
    basic: { schemeId: 'scheme2', allDoneAmount: 0.8 },
    speaking: { basePerDay: 0.2, streakThreshold: 3, streakMultiplier: 1, rewardMode: 'fixed', thresholdBonus: 0, ignoreSupplementVariance: false },
  };
  await store.save('Amber', 'J328', 'teacher', teacherPolicy);
  assert.equal((await store.get('Amber', 'J329')).policy.basic.allDoneAmount, 0.8);
  assert.equal((await store.get('Amber', 'J329')).policy.report.mode, 'senior');
  assert.equal((await store.get('Amber', 'J329')).policy.report.aiVoicePassRate, 82);
  assert.equal((await store.get('Amber', 'J329')).scope, 'teacher');

  await store.save('Amber', 'J329', 'class', { ...teacherPolicy, sources: { basic: false, speaking: true } });
  assert.equal((await store.get('Amber', 'J329')).scope, 'class');
  assert.equal((await store.get('Amber', 'J329')).policy.sources.basic, false);
  assert.equal((await store.get('Amber', 'J328')).policy.sources.basic, true);

  await store.clearClass('Amber', 'J329');
  assert.equal((await store.get('Amber', 'J329')).scope, 'teacher');
});
