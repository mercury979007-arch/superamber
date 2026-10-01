const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const XLSX = require('xlsx');

const { buildSpeakingLeaderboard } = require('../lib/speakingChallenge');
const {
  createSpeakingChallengeRoutes,
  loadChallengeClassFromAcademicSystem,
  settlementKey,
  studentStoreKey,
  validateExportRoster,
} = require('../routes/speakingChallengeRoutes');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function fixtureLeaderboard() {
  const window = {
    id: '2026-autumn-opening-speaking',
    start: '2026-08-31',
    end: '2026-09-06',
    fullEnd: '2026-09-13',
    dates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'],
    complete: false,
  };
  return buildSpeakingLeaderboard({
    classCode: 'K339',
    squadId: '1874',
    window,
    roster: [
      { no: '001', chName: '张三', enName: 'Amy' },
      { no: '002', chName: '李四', enName: 'Ben' },
    ],
    rows: [
      { no: '001', date_values: { '2026-08-31': '√', '2026-09-01': '√', '2026-09-02': '√', '2026-09-03': '√', '2026-09-04': '√', '2026-09-05': '√', '2026-09-06': '√' } },
      { no: '002', date_values: { '2026-08-31': '√', '2026-09-01': '补' } },
    ],
  });
}

test('speaking class uses the daily export as its only student source', async () => {
  const sheet = XLSX.utils.json_to_sheet([
    {
      学号: '32801',
      中文名: '王小红',
      英文名: 'Scarlett',
      '2026-08-31': '√',
      '2026-09-01': '补',
      '2026-09-02': '',
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '每日开口');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  let exportCalls = 0;
  const scraper = {
    async resolveSquadId(classId) {
      assert.equal(classId, 'J328');
      return { classCode: 'J328', squadId: '328' };
    },
    async fetchCheckinExport() {
      exportCalls += 1;
      return new Response(buffer, {
        status: 200,
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    },
    async request(url) {
      assert.match(url, /getStudentList\?squad_id=328/);
      return new Response(JSON.stringify({
        data: [
          { no: '32801', ch_name: '王小红', en_name: 'Scarlett' },
          { no: 'staff', ch_name: '助教', en_name: 'Teacher' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const window = {
    id: 'opening',
    start: '2026-08-31',
    end: '2026-09-02',
    fullEnd: '2026-09-13',
    dates: ['2026-08-31', '2026-09-01', '2026-09-02'],
  };

  const leaderboard = await loadChallengeClassFromAcademicSystem({ scraper }, 'J328', window);
  assert.equal(exportCalls, 1);
  assert.equal(leaderboard.students.length, 1);
  assert.equal(leaderboard.students[0].studentId, '32801');
  assert.equal(leaderboard.students[0].chineseName, '王小红');
  assert.equal(leaderboard.students[0].englishName, 'Scarlett');
});

test('speaking export roster validation rejects another class workbook', () => {
  assert.throws(() => validateExportRoster([
    { 学号: '12101', 中文名: '甲同学', 英文名: 'Alice' },
    { 学号: '12102', 中文名: '乙同学', 英文名: 'Bob' },
  ], [
    { no: '31901', chName: '丙同学', enName: 'Carol' },
    { no: '31902', chName: '丁同学', enName: 'David' },
    { no: '31903', chName: '戊同学', enName: 'Evan' },
  ]), /导出名单与目标班级不一致/);
});

test('speaking class enriches only export rows whose English name is missing', async () => {
  const sheet = XLSX.utils.json_to_sheet([
    {
      学号: '32801',
      中文名: '王小红',
      英文名: 'Scarlett',
      '2026-08-31': '√',
    },
    {
      学号: '32802',
      中文名: '李小明',
      英文名: '',
      '2026-08-31': '',
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '每日开口');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  let rosterCalls = 0;
  const scraper = {
    async resolveSquadId() {
      return { classCode: 'J328', squadId: '328' };
    },
    async fetchCheckinExport() {
      return new Response(buffer, {
        status: 200,
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    },
    async request(url) {
      rosterCalls += 1;
      assert.match(url, /getStudentList\?squad_id=328/);
      return new Response(JSON.stringify({
        data: [
          { no: '32801', ch_name: '王小红', en_name: 'Scarlett' },
          { no: '32802', ch_name: '李小明', en_name: 'Leo' },
          { no: 'staff', ch_name: '助教', en_name: 'Teacher' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const challengeWindow = {
    id: 'opening',
    start: '2026-08-31',
    end: '2026-08-31',
    fullEnd: '2026-09-13',
    dates: ['2026-08-31'],
  };

  const leaderboard = await loadChallengeClassFromAcademicSystem({ scraper }, 'J328', challengeWindow);
  assert.equal(rosterCalls, 1);
  assert.deepEqual(leaderboard.students.map((student) => student.englishName), ['Scarlett', 'Leo']);
  assert.equal(leaderboard.students.some((student) => student.chineseName === '助教'), false);
});

test('speaking challenge routes require confirmation and settle only the new reward difference', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-'));
  const storePath = path.join(tempDir, 'settlements.json');
  const issuedBatches = [];
  let balance = 48.2;
  const scraper = {
    async getMinipinBalance() {
      return { minipin: balance };
    },
    async submitMinipinDirect(classId, rewards) {
      issuedBatches.push({ classId, rewards });
      balance = Math.round((balance - rewards.reduce((sum, reward) => sum + reward.amount, 0)) * 10) / 10;
      return {
        success: rewards.length,
        failed: 0,
        successList: rewards.map((reward) => reward.studentName),
        failedList: [],
      };
    },
  };
  const app = express();
  app.use(express.json());
  let wordReads = 0;
  app.use('/api', createSpeakingChallengeRoutes({
    readingWordsService: { async enrich(board) {
      wordReads += 1;
      return { ...board, students: board.students.map(student => ({ ...student,
        daily: student.daily.map(day => ({ ...day, words: 123 })),
      })) };
    } },
    requireLoggedInSession(req, res) {
      if (req.headers.authorization !== 'ready') {
        res.status(401).json({ error: '未登录' });
        return null;
      }
      return { username: 'AmberZhang', scraper };
    },
    storePath,
    now: () => new Date('2026-09-02T02:00:00Z'),
    async loadChallengeClass() {
      return fixtureLeaderboard();
    },
  }));

  const server = http.createServer(app);
  const address = await listen(server);
  const base = `http://${address.address}:${address.port}/api/data/speaking-challenge`;
  const post = (suffix, body, authenticated = true) => fetch(`${base}/${suffix}`, {
    method: 'POST',
    headers: {
      ...(authenticated ? { authorization: 'ready' } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  try {
    const blocked = await post('class', { classId: 'K339' }, false);
    assert.equal(blocked.status, 401);
    assert.equal(wordReads, 0);

    const classResponse = await post('class', { classId: 'K339' });
    const classPayload = await classResponse.json();
    assert.equal(classResponse.status, 200);
    assert.equal(classPayload.leaderboard.students[0].englishName, 'Amy');
    assert.equal(classPayload.leaderboard.students[0].daily[0].words, 123);
    assert.equal(wordReads, 1);
    assert.equal(classPayload.leaderboard.students[0].chineseName, '张三');
    assert.match(classPayload.leaderboard.students[0].studentKey, /^[a-f0-9]{32}$/);
    assert.equal(classPayload.leaderboard.students[0].studentId, undefined);
    assert.equal(classPayload.rewardState.configLocked, false);
    assert.equal(classPayload.rewardState.config.rewardMode, 'fixed');
    assert.deepEqual(classPayload.rewardState.issuedBasePerDayByDate, {});
    assert.equal(classPayload.rewardState.config.ignoreSupplementVariance, false);

    const adjustedPlanResponse = await post('reward-plan', {
      classId: 'K339',
      config: {
        basePerDay: 0.1,
        streakThreshold: 2,
        streakMultiplier: 2,
        ignoreSupplementVariance: true,
      },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    });
    const adjustedPlanPayload = await adjustedPlanResponse.json();
    assert.equal(adjustedPlanResponse.status, 200);
    assert.equal(adjustedPlanPayload.plan.totalMP, 0.8);
    assert.equal(adjustedPlanPayload.plan.config.ignoreSupplementVariance, true);
    const adjustedBen = adjustedPlanPayload.plan.rewards.find((reward) => reward.englishName === 'Ben');
    assert.equal(adjustedBen.streakDays, 2);
    assert.equal(adjustedBen.supplementDays, 0);

    const planResponse = await post('reward-plan', {
      classId: 'K339',
      config: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 2 },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    });
    const planPayload = await planResponse.json();
    assert.equal(planResponse.status, 200);
    assert.equal(planPayload.plan.studentCount, 2);
    assert.equal(planPayload.plan.totalMP, 0.6);
    assert.deepEqual(planPayload.plan.selectedDates, ['2026-08-31', '2026-09-01', '2026-09-02']);
    assert.equal(planPayload.plan.balance, 48.2);
    assert.equal(planPayload.plan.rewards[0].chineseName, '张三');

    const unconfirmed = await post('issue', {
      planId: planPayload.plan.planId,
      acknowledged: false,
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal(issuedBatches.length, 0);

    const issued = await post('issue', {
      planId: planPayload.plan.planId,
      acknowledged: true,
    });
    const issuedPayload = await issued.json();
    assert.equal(issued.status, 200, JSON.stringify(issuedPayload));
    assert.equal(issuedPayload.result.successCount, 2);
    assert.equal(issuedPayload.result.totalMP, 0.6);
    assert.equal(issuedPayload.result.balanceBefore, 48.2);
    assert.equal(issuedPayload.result.balanceAfter, 47.6);
    assert.equal(issuedPayload.result.balanceVerified, true);
    assert.equal(issuedBatches.length, 1);
    assert.equal(issuedBatches[0].classId, '1874');

    const secondPlanResponse = await post('reward-plan', {
      classId: 'K339',
      config: { basePerDay: 0.2, streakThreshold: 2, streakMultiplier: 3, ignoreSupplementVariance: true },
      selectedDates: ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'],
    });
    const secondPlanPayload = await secondPlanResponse.json();
    assert.equal(secondPlanResponse.status, 200);
    assert.equal(secondPlanPayload.plan.configLocked, false);
    assert.equal(secondPlanPayload.plan.baseConfigLocked, false);
    assert.equal(secondPlanPayload.plan.streakConfigLocked, false);
    assert.deepEqual(secondPlanPayload.plan.config, {
      basePerDay: 0.2,
      streakThreshold: 2,
      streakMultiplier: 3,
      rewardMode: 'multiplier',
      thresholdBonus: 0,
      ignoreSupplementVariance: true,
    });
    assert.equal(secondPlanPayload.plan.studentCount, 1);
    assert.equal(secondPlanPayload.plan.totalMP, 2.4);

    const secondIssued = await post('issue', {
      planId: secondPlanPayload.plan.planId,
      acknowledged: true,
    });
    assert.equal(secondIssued.status, 200);

    const repeatPlanResponse = await post('reward-plan', {
      classId: 'K339',
      config: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 2 },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    });
    const repeatPlanPayload = await repeatPlanResponse.json();
    assert.equal(repeatPlanPayload.plan.studentCount, 0);
    assert.equal(repeatPlanPayload.plan.totalMP, 0);

    const refreshedClass = await post('class', { classId: 'K339' });
    const refreshedPayload = await refreshedClass.json();
    assert.deepEqual(refreshedPayload.rewardState.issuedDates, [
      '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
    ]);

    const stored = JSON.parse(await fs.readFile(storePath, 'utf8'));
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes('AmberZhang'), false);
    assert.equal(serialized.includes('Amy'), false);
    assert.equal(serialized.includes('张三'), false);
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('speaking rewards can top up missed streaks, late check-ins, and explicit repeats independently', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-special-'));
  const storePath = path.join(tempDir, 'settlements.json');
  const issuedBatches = [];
  let includeLateStudent = false;
  const scraper = {
    async getMinipinBalance() {
      return { minipin: 20 };
    },
    async submitMinipinDirect(classId, rewards) {
      issuedBatches.push({ classId, rewards });
      return {
        success: rewards.length,
        failed: 0,
        successList: rewards.map((reward) => reward.studentName),
        failedList: [],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({
    requireLoggedInSession() {
      return { username: 'SpecialTeacher', scraper };
    },
    storePath,
    now: () => new Date('2026-09-02T02:00:00Z'),
    async loadChallengeClass() {
      const window = {
        id: 'special-reward-scope',
        start: '2026-08-31',
        end: '2026-09-03',
        fullEnd: '2026-09-13',
        dates: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'],
        complete: false,
      };
      return buildSpeakingLeaderboard({
        classCode: 'K339',
        squadId: '1874',
        window,
        roster: [
          { no: '001', chName: '张三', enName: 'Amy' },
          ...(includeLateStudent ? [{ no: '002', chName: '李四', enName: 'Ben' }] : []),
        ],
        rows: [
          { no: '001', date_values: { '2026-08-31': '√', '2026-09-01': '√', '2026-09-02': '√', '2026-09-03': '√' } },
          ...(includeLateStudent ? [{ no: '002', date_values: { '2026-08-31': '√' } }] : []),
        ],
      });
    },
  }));

  const server = http.createServer(app);
  const address = await listen(server);
  const base = `http://${address.address}:${address.port}/api/data/speaking-challenge`;
  const post = async (suffix, body) => {
    const response = await fetch(`${base}/${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  };
  const config = {
    basePerDay: 0.1,
    streakThreshold: 3,
    streakMultiplier: 2,
    rewardMode: 'multiplier',
    thresholdBonus: 0,
    ignoreSupplementVariance: false,
  };
  const allDates = ['2026-08-31', '2026-09-01', '2026-09-02'];

  try {
    const freshDatesIgnoreIssuedDateChoice = await post('reward-plan', {
      classId: 'K339',
      config,
      selectedDates: allDates,
      selection: { baseStrategy: 'none', includeStreak: false },
    });
    assert.equal(freshDatesIgnoreIssuedDateChoice.response.status, 200);
    assert.equal(freshDatesIgnoreIssuedDateChoice.payload.plan.totalMP, 0.3);
    assert.deepEqual(freshDatesIgnoreIssuedDateChoice.payload.plan.breakdown, {
      standardBase: { studentCount: 1, totalMP: 0.3 },
      repeatedBase: { studentCount: 0, totalMP: 0 },
      unissuedBase: { studentCount: 0, totalMP: 0 },
      streak: { studentCount: 0, totalMP: 0 },
    });

    const basePlan = await post('reward-plan', {
      classId: 'K339',
      config: { ...config, basePerDay: 0.2 },
      selectedDates: ['2026-08-31', '2026-09-01'],
      selection: { baseStrategy: 'unissued', includeStreak: false },
    });
    assert.equal(basePlan.response.status, 200);
    assert.deepEqual(basePlan.payload.plan.breakdown, {
      standardBase: { studentCount: 1, totalMP: 0.4 },
      repeatedBase: { studentCount: 0, totalMP: 0 },
      unissuedBase: { studentCount: 0, totalMP: 0 },
      streak: { studentCount: 0, totalMP: 0 },
    });
    await post('issue', { planId: basePlan.payload.plan.planId, acknowledged: true });

    const afterBase = await post('class', { classId: 'K339' });
    assert.equal(afterBase.payload.rewardState.baseConfigLocked, false);
    assert.equal(afterBase.payload.rewardState.streakConfigLocked, false);
    assert.deepEqual(afterBase.payload.rewardState.issuedBasePerDayByDate, {
      '2026-08-31': 0.2,
      '2026-09-01': 0.2,
    });

    const adjustedFreshPlan = await post('reward-plan', {
      classId: 'K339',
      config: { ...config, basePerDay: 0.2 },
      selectedDates: ['2026-09-02'],
      selection: { baseStrategy: 'unissued', includeStreak: false },
    });
    assert.equal(adjustedFreshPlan.payload.plan.config.basePerDay, 0.2);
    assert.deepEqual(adjustedFreshPlan.payload.plan.breakdown.standardBase, {
      studentCount: 1,
      totalMP: 0.2,
    });

    const mixedSkipPlan = await post('reward-plan', {
      classId: 'K339',
      config,
      selectedDates: ['2026-08-31', '2026-09-02'],
      selection: { baseStrategy: 'none', includeStreak: false },
    });
    assert.equal(mixedSkipPlan.payload.plan.totalMP, 0.1);
    assert.deepEqual(mixedSkipPlan.payload.plan.breakdown, {
      standardBase: { studentCount: 1, totalMP: 0.1 },
      repeatedBase: { studentCount: 0, totalMP: 0 },
      unissuedBase: { studentCount: 0, totalMP: 0 },
      streak: { studentCount: 0, totalMP: 0 },
    });

    const mixedRepeatPlan = await post('reward-plan', {
      classId: 'K339',
      config,
      selectedDates: ['2026-08-31', '2026-09-02'],
      selection: { baseStrategy: 'repeat', includeStreak: false },
    });
    assert.equal(mixedRepeatPlan.payload.plan.totalMP, 0.2);
    assert.deepEqual(mixedRepeatPlan.payload.plan.breakdown, {
      standardBase: { studentCount: 1, totalMP: 0.1 },
      repeatedBase: { studentCount: 1, totalMP: 0.1 },
      unissuedBase: { studentCount: 0, totalMP: 0 },
      streak: { studentCount: 0, totalMP: 0 },
    });
    await post('issue', { planId: mixedSkipPlan.payload.plan.planId, acknowledged: true });

    const streakPlan = await post('reward-plan', {
      classId: 'K339',
      config,
      selectedDates: allDates,
      selection: { baseStrategy: 'none', includeStreak: true },
    });
    assert.equal(streakPlan.payload.plan.totalMP, 0.1);
    assert.deepEqual(streakPlan.payload.plan.breakdown.streak, { studentCount: 1, totalMP: 0.1 });
    assert.equal(streakPlan.payload.plan.breakdown.unissuedBase.totalMP, 0);
    await post('issue', { planId: streakPlan.payload.plan.planId, acknowledged: true });

    includeLateStudent = true;
    const latePlan = await post('reward-plan', {
      classId: 'K339',
      config: { ...config, basePerDay: 0.2 },
      selectedDates: ['2026-08-31', '2026-09-03'],
      selection: { baseStrategy: 'unissued', includeStreak: false, missedBasePerDay: 0.1 },
    });
    assert.equal(latePlan.payload.plan.totalMP, 0.3);
    assert.deepEqual(latePlan.payload.plan.rewards.map((reward) => reward.englishName), ['Amy', 'Ben']);
    assert.deepEqual(latePlan.payload.plan.breakdown.standardBase, { studentCount: 1, totalMP: 0.2 });
    assert.deepEqual(latePlan.payload.plan.breakdown.unissuedBase, { studentCount: 1, totalMP: 0.1 });
    await post('issue', { planId: latePlan.payload.plan.planId, acknowledged: true });
    const afterLateTopUp = await post('class', { classId: 'K339' });
    assert.equal(latePlan.payload.plan.selection.missedBasePerDay, 0.1);
    assert.equal(afterLateTopUp.payload.rewardState.issuedBasePerDayByDate['2026-08-31'], 0.2);
    assert.equal(afterLateTopUp.payload.rewardState.issuedBasePerDayByDate['2026-09-03'], 0.2);

    const repeatPlan = await post('reward-plan', {
      classId: 'K339',
      config: { ...config, basePerDay: 0.2 },
      selectedDates: ['2026-08-31'],
      selection: { baseStrategy: 'repeat', includeStreak: false },
    });
    assert.equal(repeatPlan.payload.plan.totalMP, 0.4);
    assert.deepEqual(repeatPlan.payload.plan.breakdown.repeatedBase, { studentCount: 2, totalMP: 0.4 });
    const staleRepeatPlan = await post('reward-plan', {
      classId: 'K339',
      config: { ...config, basePerDay: 0.2 },
      selectedDates: ['2026-08-31'],
      selection: { baseStrategy: 'repeat', includeStreak: false },
    });
    const repeatIssue = await post('issue', {
      planId: repeatPlan.payload.plan.planId,
      acknowledged: true,
    });
    assert.equal(repeatIssue.response.status, 200);
    const afterExplicitRepeat = await post('class', { classId: 'K339' });
    assert.equal(afterExplicitRepeat.payload.rewardState.issuedBasePerDayByDate['2026-08-31'], 0.2);
    const blockedStaleRepeat = await post('issue', {
      planId: staleRepeatPlan.payload.plan.planId,
      acknowledged: true,
    });
    assert.equal(blockedStaleRepeat.response.status, 409);
    assert.match(blockedStaleRepeat.payload.error, /发放记录刚刚发生变化/);
    assert.equal(issuedBatches.length, 5);
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('legacy combined settlements unlock and recover a streak reward that was never issued', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-legacy-scope-'));
  const storePath = path.join(tempDir, 'settlements.json');
  const username = 'LegacyTeacher';
  const classCode = 'K339';
  const challengeId = 'legacy-special-reward-scope';
  const studentKey = studentStoreKey('001');
  await fs.writeFile(storePath, JSON.stringify({
    version: 1,
    settlements: {
      [settlementKey(username, classCode, challengeId)]: {
        classCode,
        challengeId,
        config: {
          basePerDay: 0.1,
          streakThreshold: 3,
          streakMultiplier: 1,
          rewardMode: 'multiplier',
          thresholdBonus: 0,
          ignoreSupplementVariance: false,
        },
        issuedByStudent: { [studentKey]: 0.3 },
        issuedByStudentDate: {
          [studentKey]: {
            '2026-08-31': 0.1,
            '2026-09-01': 0.1,
            '2026-09-02': 0.1,
          },
        },
        issues: [],
      },
    },
  }));
  const scraper = {
    async getMinipinBalance() {
      return { minipin: 20 };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({
    requireLoggedInSession() {
      return { username, scraper };
    },
    storePath,
    now: () => new Date('2026-09-02T02:00:00Z'),
    async loadChallengeClass() {
      return buildSpeakingLeaderboard({
        classCode,
        squadId: '1874',
        window: {
          id: challengeId,
          start: '2026-08-31',
          end: '2026-09-02',
          fullEnd: '2026-09-13',
          dates: ['2026-08-31', '2026-09-01', '2026-09-02'],
          complete: false,
        },
        roster: [{ no: '001', chName: '张三', enName: 'Amy' }],
        rows: [{
          no: '001',
          date_values: {
            '2026-08-31': '√',
            '2026-09-01': '√',
            '2026-09-02': '√',
          },
        }],
      });
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const base = `http://${address.address}:${address.port}/api/data/speaking-challenge`;
  const post = async (suffix, body) => {
    const response = await fetch(`${base}/${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };

  try {
    const classPayload = await post('class', { classId: classCode });
    assert.equal(classPayload.rewardState.baseConfigLocked, false);
    assert.equal(classPayload.rewardState.streakConfigLocked, false);
    const planPayload = await post('reward-plan', {
      classId: classCode,
      config: {
        ...classPayload.rewardState.config,
        streakMultiplier: 2,
      },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
      selection: { baseStrategy: 'unissued', includeStreak: true },
    });
    assert.equal(planPayload.plan.totalMP, 0.1);
    assert.deepEqual(planPayload.plan.breakdown.unissuedBase, { studentCount: 0, totalMP: 0 });
    assert.deepEqual(planPayload.plan.breakdown.streak, { studentCount: 1, totalMP: 0.1 });
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('stale pending speaking issue is automatically reconciled from authoritative student transactions', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-reconcile-'));
  const storePath = path.join(tempDir, 'settlements.json');
  const username = 'RecoveryTeacher';
  const leaderboard = fixtureLeaderboard();
  const key = settlementKey(username, leaderboard.classCode, leaderboard.challenge.id);
  await fs.writeFile(storePath, JSON.stringify({
    version: 1,
    settlements: {
      [key]: {
        classCode: leaderboard.classCode,
        challengeId: leaderboard.challenge.id,
        config: {
          basePerDay: 0.1,
          streakThreshold: 3,
          streakMultiplier: 2,
          rewardMode: 'multiplier',
          thresholdBonus: 0,
          ignoreSupplementVariance: false,
        },
        issuedByStudent: {},
        issuedByStudentDate: {},
        issuedByStudentRewardDate: {},
        issues: [],
        pendingIssue: {
          planId: 'stale-plan',
          startedAt: '2026-09-03T09:29:27.000Z',
          totalMP: 0.4,
          selectedDates: ['2026-09-01', '2026-09-02'],
          selection: { baseStrategy: 'repeat', includeStreak: false },
          rewards: [
            {
              student: studentStoreKey('001'),
              amount: 0.2,
              baseDateAmounts: { '2026-09-01': 0.1, '2026-09-02': 0.1 },
              streakDateAmounts: {},
              dateAmounts: { '2026-09-01': 0.1, '2026-09-02': 0.1 },
            },
            {
              student: studentStoreKey('002'),
              amount: 0.2,
              baseDateAmounts: { '2026-09-01': 0.1, '2026-09-02': 0.1 },
              streakDateAmounts: {},
              dateAmounts: { '2026-09-01': 0.1, '2026-09-02': 0.1 },
            },
          ],
        },
      },
    },
  }));
  let transactionReads = 0;
  const scraper = {
    async getMinipinGrantRecords() {
      transactionReads += 1;
      return [
        { id: '91', studentNo: '001', amount: 0.2, occurredAt: '2026-09-03T09:29:35.000Z', type: '发放', tagName: 'MP奖励' },
        { id: '92', studentNo: '002', amount: 0.2, occurredAt: '2026-09-03T09:29:35.000Z', type: '发放', tagName: 'MP奖励' },
      ];
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({
    requireLoggedInSession() {
      return { username, scraper };
    },
    storePath,
    now: () => new Date('2026-09-06T05:00:00.000Z'),
    async loadChallengeClass() {
      return leaderboard;
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/data/speaking-challenge/class`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: leaderboard.classCode }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.rewardState.pending, false);
    assert.equal(payload.rewardState.issuedTotal, 0.4);
    assert.equal(transactionReads, 1);
    const stored = JSON.parse(await fs.readFile(storePath, 'utf8')).settlements[key];
    assert.equal(stored.pendingIssue, null);
    assert.equal(stored.issues.at(-1).recovered, true);
    assert.equal(stored.issues.at(-1).recoveryMethod, 'transaction-log');
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('definitive speaking issue failure stops and requires a new teacher confirmation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-retry-'));
  const storePath = path.join(tempDir, 'settlements.json');
  let submitCalls = 0;
  const scraper = {
    async getMinipinBalance() {
      return { minipin: 20 };
    },
    async submitMinipinDirect(classId, rewards) {
      submitCalls += 1;
      if (submitCalls === 1) {
        return {
          success: 0,
          failed: rewards.length,
          successList: [],
          failedList: rewards.map((reward) => ({ studentId: reward.studentId, error: '明确拒绝' })),
          retryable: true,
        };
      }
      return {
        success: rewards.length,
        failed: 0,
        successList: rewards.map((reward) => reward.studentName),
        failedList: [],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({
    requireLoggedInSession() {
      return { username: 'RetryTeacher', scraper };
    },
    storePath,
    now: () => new Date('2026-09-02T02:00:00Z'),
    async loadChallengeClass() {
      return fixtureLeaderboard();
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const base = `http://${address.address}:${address.port}/api/data/speaking-challenge`;
  const post = async (suffix, body) => {
    const response = await fetch(`${base}/${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  };
  try {
    const planned = await post('reward-plan', {
      classId: 'K339',
      config: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 2 },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    });
    const issued = await post('issue', { planId: planned.payload.plan.planId, acknowledged: true });
    assert.equal(issued.response.status, 200, JSON.stringify(issued.payload));
    assert.equal(issued.payload.result.successCount, 0);
    assert.equal(issued.payload.result.failedCount, 2);
    assert.match(issued.payload.result.failureMessage, /明确拒绝/);
    assert.equal(issued.payload.result.rewardState.pending, false);
    assert.equal(submitCalls, 1);
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('unknown speaking issue result is reconciled without resubmitting', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-challenge-unknown-'));
  const storePath = path.join(tempDir, 'settlements.json');
  let submitCalls = 0;
  let issuedRewards = [];
  const scraper = {
    async getMinipinBalance() {
      return { minipin: 20 };
    },
    async submitMinipinDirect(classId, rewards) {
      submitCalls += 1;
      issuedRewards = rewards;
      throw new Error('response connection closed');
    },
    async getMinipinGrantRecords() {
      return issuedRewards.map((reward, index) => ({
        id: String(200 + index),
        studentNo: reward.studentId,
        amount: reward.amount,
        occurredAt: '2026-09-02T02:00:08.000Z',
        type: '发放',
        tagName: 'MP奖励',
      }));
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({
    requireLoggedInSession() {
      return { username: 'UnknownTeacher', scraper };
    },
    storePath,
    now: () => new Date('2026-09-02T02:00:00Z'),
    async loadChallengeClass() {
      return fixtureLeaderboard();
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const base = `http://${address.address}:${address.port}/api/data/speaking-challenge`;
  const post = async (suffix, body) => {
    const response = await fetch(`${base}/${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  };
  try {
    const planned = await post('reward-plan', {
      classId: 'K339',
      config: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 2 },
      selectedDates: ['2026-08-31', '2026-09-01', '2026-09-02'],
    });
    const issued = await post('issue', { planId: planned.payload.plan.planId, acknowledged: true });
    assert.equal(issued.response.status, 200, JSON.stringify(issued.payload));
    assert.equal(issued.payload.result.successCount, 2);
    assert.equal(issued.payload.result.rewardState.pending, false);
    assert.equal(submitCalls, 1);
  } finally {
    await close(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('split MP and CP reconciliation handles partial grants without summing unrelated or duplicate grants', async () => {
  const { matchPendingIssueRecords, reconcilePendingIssue } = require('../routes/speakingChallengeRoutes');
  const at = '2026-09-03T09:29:35.000Z';
  const pending = { planId: 'partial-plan', startedAt: at, totalMP: 2.4,
    selectedDates: ['2026-08-31'], rewards: ['001', '002'].map((id) => ({ student: studentStoreKey(id), amount: 1.2,
      dateAmounts: { '2026-08-31': 1.2 }, baseDateAmounts: { '2026-08-31': 1.2 }, streakDateAmounts: {} })) };
  const records = [
    { id: 'mp', studentNo: '001', amount: 1, grantName: 'MP', occurredAt: at },
    { id: 'cp', studentNo: '001', amount: 0.2, grantName: 'CP', occurredAt: at },
  ];
  assert.equal(matchPendingIssueRecords(pending, [...records, records[0]]).matchedRewards.length, 1);
  assert.equal(matchPendingIssueRecords(pending, [records[0], { ...records[1], addedBy: 'other' }]).matchedRewards.length, 0);
  assert.equal(matchPendingIssueRecords(pending, [records[0], { ...records[1], occurredAt: '2026-09-03T09:29:36Z' }]).matchedRewards.length, 0);
  assert.equal(matchPendingIssueRecords(pending, [...records, ...records.map(r => ({ ...r, id: r.id + '2', occurredAt: '2026-09-03T09:29:36Z' }))]).matchedRewards.length, 0);
  const settlement = { pendingIssue: pending };
  await reconcilePendingIssue({ getMinipinGrantRecords: async () => records }, settlement, 'K339');
  assert.equal(settlement.pendingIssue.rewards.length, 1);
  assert.equal(settlement.pendingIssue.confirmedCount, 1);
  assert.equal(settlement.issuedByStudent[studentStoreKey('001')], 1.2);
  await reconcilePendingIssue({ getMinipinGrantRecords: async () => records }, settlement, 'K339');
  assert.equal(settlement.issuedByStudent[studentStoreKey('001')], 1.2);
});

test('pending choices persist across refresh, isolate teachers and require acknowledgment; deferred dates cannot be paid', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-pending-choices-'));
  const storePath = path.join(tempDir, 'store.json');
  const leaderboard = fixtureLeaderboard();
  const key = settlementKey('Teacher', 'K339', leaderboard.challenge.id);
  const pending = { planId: 'old-plan', startedAt: '2026-09-03T09:29:35Z', totalMP: 0.2,
    config: { basePerDay: 0.1, streakMultiplier: 1 }, selectedDates: ['2026-08-31'],
    rewards: ['001', '002'].map(id => ({ student: studentStoreKey(id), amount: 0.1,
      dateAmounts: { '2026-08-31': 0.1 }, baseDateAmounts: { '2026-08-31': 0.1 }, streakDateAmounts: {} })) };
  await fs.writeFile(storePath, JSON.stringify({ settlements: { [key]: { pendingIssue: pending } } }));
  let readsFail = false, username = 'Teacher', writes = 0;
  const app = express(); app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({ storePath,
    requireLoggedInSession: () => ({ username, scraper: {
      getMinipinGrantRecords: async () => { if (readsFail) throw new Error('核账超时'); return [{ id: '1', studentNo: '001', amount: 0.1, occurredAt: pending.startedAt }]; },
      getMinipinBalance: async () => ({ minipin: 20 }), submitMinipinDirect: async () => { writes++; throw new Error('must not issue'); },
    } }), loadChallengeClass: async () => leaderboard,
  }));
  const server = http.createServer(app); const address = await listen(server);
  const post = async (suffix, body = {}) => {
    const response = await fetch(`http://${address.address}:${address.port}/api/data/speaking-challenge/${suffix}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classId: 'K339', ...body }) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const initial = await post('class');
    assert.equal(initial.data.rewardState.recovery.confirmedCount, 1);
    assert.equal(initial.data.rewardState.recovery.students[0].name, 'Ben 李四');
    assert.equal((await post('resolve-pending', { planId: 'old-plan', action: 'retry' })).status, 400);
    username = 'Other';
    assert.equal((await post('resolve-pending', { planId: 'old-plan', action: 'defer' })).status, 409);
    username = 'Teacher'; readsFail = true;
    const failed = await post('resolve-pending', { planId: 'old-plan', action: 'retry', acknowledgedNotReceived: true });
    assert.equal(failed.status, 502); assert.equal(failed.data.rewardState.pending, true);
    const deferred = await post('resolve-pending', { planId: 'old-plan', action: 'defer' });
    assert.equal(deferred.data.rewardState.pending, false);
    assert.equal(deferred.data.rewardState.recovery.deferred, true);
    const refreshed = await post('class'); assert.equal(refreshed.data.rewardState.recovery.unresolvedCount, 1);
    assert.equal((await post('reward-plan', { selectedDates: ['2026-08-31'] })).status, 400);
    const newPlan = await post('reward-plan', { selectedDates: ['2026-08-31', '2026-09-01'] });
    assert.deepEqual(newPlan.data.plan.selectedDates, ['2026-09-01']);
    readsFail = false;
    const retry = await post('resolve-pending', { planId: 'old-plan', action: 'retry', acknowledgedNotReceived: true });
    assert.equal(retry.data.retryReady, true); assert.equal(retry.data.rewardState.recovery, null);
    assert.equal(retry.data.plan.studentCount, 1);
    assert.equal(retry.data.plan.rewards[0].englishName, 'Ben');
    assert.equal(retry.data.plan.totalMP, 0.1);
    assert.equal(retry.data.plan.recoveryOf, 'old-plan');
    const supplement = await post('reward-plan', { config: pending.config, selectedDates: ['2026-08-31'], selection: { baseStrategy: 'unissued', includeStreak: false, missedBasePerDay: 0.1 } });
    assert.equal(supplement.data.plan.studentCount, 1); assert.equal(supplement.data.plan.rewards[0].englishName, 'Ben');
    assert.equal((await post('resolve-pending', { planId: 'old-plan', action: 'retry', acknowledgedNotReceived: true })).status, 409);
    assert.equal((await post('issue', { planId: newPlan.data.plan.planId, acknowledged: true })).status, 409);
    assert.equal(writes, 0);
  } finally { await close(server); await fs.rm(tempDir, { recursive: true, force: true }); }
});


test('concurrent teacher reconciliation preserves both receipts in the shared ledger', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speaking-parallel-recovery-'));
  const storePath = path.join(tempDir, 'store.json');
  const leaderboard = fixtureLeaderboard();
  const keys = ['First', 'Second'].map(username => settlementKey(username, 'K339', leaderboard.challenge.id));
  const pendingIssue = { planId: 'old-plan', startedAt: '2026-09-03T09:29:35Z', totalMP: 0.1,
    selectedDates: ['2026-08-31'], rewards: [{ student: studentStoreKey('001'), amount: 0.1,
      dateAmounts: { '2026-08-31': 0.1 }, baseDateAmounts: { '2026-08-31': 0.1 }, streakDateAmounts: {} }] };
  await fs.writeFile(storePath, JSON.stringify({ settlements: Object.fromEntries(keys.map(key => [key, { pendingIssue }])) }));
  let arrived = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const app = express(); app.use(express.json());
  app.use('/api', createSpeakingChallengeRoutes({ storePath, loadChallengeClass: async () => leaderboard,
    requireLoggedInSession: req => ({ username: req.headers.teacher, scraper: {
      getMinipinGrantRecords: async () => {
        if (++arrived === 2) release(); await barrier;
        return [{ id: '1', studentNo: '001', amount: 0.1, occurredAt: pendingIssue.startedAt }];
      },
    } }),
  }));
  const server = http.createServer(app); const address = await listen(server);
  try {
    const responses = await Promise.all(['First', 'Second'].map(teacher => fetch(`http://${address.address}:${address.port}/api/data/speaking-challenge/class`, {
      method: 'POST', headers: { 'content-type': 'application/json', teacher }, body: JSON.stringify({ classId: 'K339' }) })));
    for (const response of responses) assert.equal(response.status, 200);
    const store = JSON.parse(await fs.readFile(storePath, 'utf8'));
    for (const key of keys) {
      assert.equal(store.settlements[key].pendingIssue, null);
      assert.equal(store.settlements[key].issuedByStudent[studentStoreKey('001')], 0.1);
    }
  } finally { await close(server); await fs.rm(tempDir, { recursive: true, force: true }); }
});
