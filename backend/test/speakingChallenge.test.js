const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applySupplementPolicy,
  buildSpeakingLeaderboard,
  calculateCumulativeReward,
  calculateRewardBreakdown,
  normalizeRewardConfig,
  resolveChallengeWindow,
} = require('../lib/speakingChallenge');

const window = {
  id: 'test-challenge',
  start: '2026-08-31',
  end: '2026-09-02',
  fullEnd: '2026-09-13',
  dates: ['2026-08-31', '2026-09-01', '2026-09-02'],
};

test('speaking challenge ranks real streaks before totals and supplements', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'K339',
    squadId: '1874',
    window,
    roster: [
      { no: '1', chName: '甲', enName: 'Amy' },
      { no: '2', chName: '乙', enName: 'Ben' },
      { no: '3', chName: '丙', enName: 'Cara' },
      { no: '4', chName: '丁', enName: 'Dora' },
    ],
    rows: [
      { no: '1', date_values: { '2026-08-31': '√', '2026-09-01': '√', '2026-09-02': '√' } },
      { no: '2', date_values: { '2026-08-31': '√', '2026-09-01': '√', '2026-09-02': '补' } },
      { no: '3', date_values: { '2026-08-31': '√', '2026-09-01': '√' } },
      { no: '4', date_values: { '2026-08-31': '√', '2026-09-01': '补', '2026-09-02': '√' } },
    ],
  });

  assert.deepEqual(leaderboard.students.map((student) => student.englishName), ['Amy', 'Ben', 'Cara', 'Dora']);
  assert.deepEqual(leaderboard.students.map((student) => student.rank), [1, 2, 3, 4]);
  assert.deepEqual(leaderboard.students.map((student) => student.streakDays), [3, 2, 2, 1]);
  assert.equal(leaderboard.threeDayStudents, 1);
  assert.equal(leaderboard.activeStudents, 4);
});

test('roster excludes staff rows absent from the speaking export and deduplicates student ids', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'K214',
    window,
    roster: [
      { no: 'teacher-1', chName: '老师', enName: 'Belinda' },
      { no: '001', chName: '学生甲', enName: 'Aaron' },
      { no: '001', chName: '学生甲', enName: 'Aaron' },
    ],
    rows: [{ no: '001', ch_name: '学生甲', date_values: { '2026-08-31': '√' } }],
  });
  assert.deepEqual(leaderboard.students.map((student) => student.englishName), ['Aaron']);
  assert.equal(leaderboard.totalStudents, 1);
});

test('speaking export rows stay canonical when stale roster entries repeat one student', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'J328',
    window,
    roster: [
      { no: 'old-008', chName: '王小红', enName: 'Scarlett' },
      { no: 'new-108', chName: '王小红', enName: 'Scarlett' },
      { no: '009', chName: '李小明', enName: '' },
    ],
    rows: [
      { no: 'new-108', ch_name: '王小红', date_values: { '2026-08-31': '√' } },
      { no: '009', ch_name: '李小明', date_values: { '2026-08-31': '√' } },
    ],
  });

  assert.equal(leaderboard.students.filter((student) => student.englishName === 'Scarlett').length, 1);
  assert.equal(leaderboard.students.find((student) => student.chineseName === '李小明').englishName, '李小明');
  assert.equal(leaderboard.totalStudents, 2);
});

test('speaking export supplies student ids and bilingual names without a second roster source', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'J328',
    window,
    roster: [],
    rows: [
      { no: '32801', ch_name: '王小红', en_name: 'Scarlett', date_values: { '2026-08-31': '√' } },
      { no: '32802', ch_name: '李小红', en_name: 'Scarlett', date_values: { '2026-08-31': '√' } },
    ],
  });

  assert.deepEqual(leaderboard.students.map((student) => student.studentId), ['32801', '32802']);
  assert.deepEqual(leaderboard.students.map((student) => student.englishName), ['Scarlett', 'Scarlett']);
  assert.deepEqual(leaderboard.students.map((student) => student.chineseName), ['王小红', '李小红']);
});

test('speaking challenge gives equal metrics the same rank', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'K339',
    window,
    roster: [
      { no: '1', chName: '甲', enName: 'Amy' },
      { no: '2', chName: '乙', enName: 'Ben' },
      { no: '3', chName: '丙', enName: 'Cara' },
    ],
    rows: [
      { no: '1', date_values: { '2026-08-31': '√', '2026-09-01': '√' } },
      { no: '2', date_values: { '2026-08-31': '√', '2026-09-01': '√' } },
      { no: '3', date_values: { '2026-08-31': '√' } },
    ],
  });
  assert.deepEqual(leaderboard.students.map((student) => student.rank), [1, 1, 3]);
});

test('preserves roster name disambiguators and falls back to a usable export name', () => {
  const leaderboard = buildSpeakingLeaderboard({
    classCode: 'J328', window,
    roster: [
      { no: '01', chName: '同名甲', enName: 'Test A甲' },
      { no: '02', chName: '同名乙', enName: 'Test B乙' },
      { no: '03', chName: '学生丙', enName: '学生丙' },
    ],
    rows: [
      { no: '01', ch_name: '同名甲', en_name: 'Cici', date_values: { '2026-08-31': '√' } },
      { no: '02', ch_name: '同名乙', en_name: 'Cici', date_values: { '2026-08-31': '√' } },
      { no: '03', ch_name: '学生丙', en_name: 'Demo复姓', date_values: { '2026-08-31': '补' } },
    ],
  });
  assert.equal(leaderboard.totalStudents, 3);
  const byId = new Map(leaderboard.students.map(student => [student.studentId, student]));
  assert.equal(byId.get('01').englishName, 'Test A甲');
  assert.equal(byId.get('02').englishName, 'Test B乙');
  assert.equal(byId.get('03').englishName, 'Demo复姓');
  assert.equal(byId.get('01').rank, byId.get('02').rank);
  assert.equal(byId.get('03').daily[0].status, 'supplement');
});

test('supplements receive base reward but never streak multiplier', () => {
  assert.equal(normalizeRewardConfig({}).streakMultiplier, 1);
  assert.equal(normalizeRewardConfig({}).rewardMode, 'fixed');
  assert.equal(normalizeRewardConfig({}).ignoreSupplementVariance, false);
  const config = normalizeRewardConfig({ basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 1.5 });
  assert.equal(calculateCumulativeReward({ normalDays: 3, supplementDays: 0, streakDays: 3 }, config), 0.5);
  assert.equal(calculateCumulativeReward({ normalDays: 2, supplementDays: 1, streakDays: 2 }, config), 0.3);
  assert.equal(calculateCumulativeReward({ normalDays: 3, supplementDays: 1, streakDays: 3 }, config), 0.6);
});

test('optional supplement variance policy treats every valid completion equally', () => {
  const strictLeaderboard = buildSpeakingLeaderboard({
    classCode: 'K339',
    squadId: '1874',
    window,
    roster: [
      { no: '1', chName: '甲', enName: 'Amy' },
      { no: '2', chName: '乙', enName: 'Ben' },
    ],
    rows: [
      { no: '1', date_values: { '2026-08-31': '√', '2026-09-01': '√' } },
      { no: '2', date_values: { '2026-08-31': '√', '2026-09-01': '补', '2026-09-02': '√' } },
    ],
  });
  const adjusted = applySupplementPolicy(strictLeaderboard, true);

  assert.deepEqual(adjusted.students.map((student) => student.englishName), ['Ben', 'Amy']);
  assert.deepEqual(adjusted.students.map((student) => student.rank), [1, 2]);
  assert.equal(adjusted.students[0].streakDays, 3);
  assert.equal(adjusted.students[0].normalDays, 3);
  assert.equal(adjusted.students[0].supplementDays, 0);
  assert.equal(adjusted.students[0].daily[1].status, 'normal');
  assert.equal(adjusted.threeDayStudents, 1);
  assert.equal(strictLeaderboard.students.find((student) => student.englishName === 'Ben').daily[1].status, 'supplement');

  assert.deepEqual(calculateRewardBreakdown(
    strictLeaderboard.students.find((student) => student.englishName === 'Ben'),
    {
      basePerDay: 0.1,
      streakThreshold: 3,
      streakMultiplier: 2,
      rewardMode: 'multiplier',
      ignoreSupplementVariance: true,
    },
  ), {
    '2026-08-31': 0.1,
    '2026-09-01': 0.1,
    '2026-09-02': 0.2,
  });
});

test('fixed reward mode grants its default-zero bonus once on the threshold date', () => {
  const student = {
    streakDays: 3,
    daily: [
      { date: '2026-08-31', status: 'normal' },
      { date: '2026-09-01', status: 'normal' },
      { date: '2026-09-02', status: 'normal' },
    ],
  };
  const zeroBonus = normalizeRewardConfig({ rewardMode: 'fixed', basePerDay: 0.1, streakThreshold: 3 });
  assert.equal(zeroBonus.thresholdBonus, 0);
  assert.equal(calculateCumulativeReward(student, zeroBonus), 0.3);
  assert.deepEqual(calculateRewardBreakdown(student, { ...zeroBonus, thresholdBonus: 0.5 }), {
    '2026-08-31': 0.1,
    '2026-09-01': 0.1,
    '2026-09-02': 0.6,
  });
});

test('fixed reward mode can issue only the threshold bonus when daily reward is zero', () => {
  const student = {
    streakDays: 3,
    daily: [
      { date: '2026-08-31', status: 'normal' },
      { date: '2026-09-01', status: 'normal' },
      { date: '2026-09-02', status: 'normal' },
    ],
  };
  const config = normalizeRewardConfig({
    rewardMode: 'fixed',
    basePerDay: 0,
    streakThreshold: 3,
    thresholdBonus: 0.5,
  });
  assert.equal(calculateCumulativeReward(student, config), 0.5);
  assert.deepEqual(calculateRewardBreakdown(student, config), {
    '2026-08-31': 0,
    '2026-09-01': 0,
    '2026-09-02': 0.5,
  });
});

test('multiplier starts on the threshold day instead of rewriting earlier settled dates', () => {
  const breakdown = calculateRewardBreakdown({
    streakDays: 4,
    daily: [
      { date: '2026-08-31', status: 'normal' },
      { date: '2026-09-01', status: 'normal' },
      { date: '2026-09-02', status: 'normal' },
      { date: '2026-09-03', status: 'normal' },
    ],
  }, { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 2, rewardMode: 'multiplier' });
  assert.deepEqual(breakdown, {
    '2026-08-31': 0.1,
    '2026-09-01': 0.1,
    '2026-09-02': 0.2,
    '2026-09-03': 0.2,
  });
});

test('challenge window starts August 31 and keeps advancing after week two', () => {
  assert.equal(resolveChallengeWindow(new Date('2026-09-01T02:00:00Z')).end, '2026-09-01');
  const weekThree = resolveChallengeWindow(new Date('2026-09-17T02:00:00Z'));
  assert.equal(weekThree.end, '2026-09-17');
  assert.equal(weekThree.fullEnd, '2026-09-17');
  assert.equal(weekThree.dates.at(-1), '2026-09-17');
  assert.equal(weekThree.complete, false);
});
