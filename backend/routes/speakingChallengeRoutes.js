const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { normalizeEnglishName } = require('../lib/studentNames');
const {
  fetchCheckinViaExport,
  summarizePunchRowsForRange,
} = require('../lib/checkinApi');
const {
  DEFAULT_REWARD_CONFIG,
  applySupplementPolicy,
  buildSpeakingLeaderboard,
  calculateCumulativeReward,
  calculateRewardComponents,
  normalizeRewardConfig,
  resolveChallengeWindow,
  rewardConfigsEqual,
  roundOne,
} = require('../lib/speakingChallenge');

const PLAN_TTL_MS = 10 * 60 * 1000;
const PENDING_RECONCILE_WINDOW_MS = 3 * 60 * 1000;
const PENDING_RECONCILE_EARLY_MS = 30 * 1000;
const MAX_AUTOMATIC_ISSUE_ATTEMPTS = 1; // A new write always requires a new teacher confirmation.

function normalizeClassCode(value) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function settlementKey(username, classCode, challengeId) {
  return `${hashKey(username).slice(0, 20)}:${normalizeClassCode(classCode)}:${challengeId}`;
}

function studentStoreKey(studentId) {
  return hashKey(studentId).slice(0, 32);
}

async function readSettlementStore(storePath) {
  if (!storePath) return { version: 1, settlements: {} };
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    return {
      version: 1,
      settlements: parsed?.settlements && typeof parsed.settlements === 'object'
        ? parsed.settlements
        : {},
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, settlements: {} };
    throw error;
  }
}

async function writeSettlementStore(storePath, store) {
  if (!storePath) return;
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, storePath);
  await fs.chmod(storePath, 0o600).catch(() => {});
}

// Writes for different classes may finish together. Merge only the changed
// settlement into the latest store so one class cannot erase another's receipt.
const settlementWrites = new Map();
async function saveSettlement(storePath, key, settlement) {
  const previous = settlementWrites.get(storePath) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const latest = await readSettlementStore(storePath);
    latest.settlements[key] = settlement;
    await writeSettlementStore(storePath, latest);
  });
  settlementWrites.set(storePath, job);
  try { await job; } finally { if (settlementWrites.get(storePath) === job) settlementWrites.delete(storePath); }
}

async function fetchExportRowsWithRetry(scraper, squadId, window) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetchCheckinViaExport(scraper, squadId, {
        rangeStart: window.start,
        rangeEnd: window.end,
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError || new Error('每日开口数据读取失败');
}

async function fetchRosterForNameEnrichment(scraper, squadId) {
  const response = await scraper.request(
    `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
    { headers: { accept: 'application/json' } },
  );
  const data = await response.json().catch(() => ({}));
  if (!Array.isArray(data?.data)) {
    throw new Error(String(data?.msg || `学生名单获取失败: HTTP ${response.status}`));
  }
  return data.data.map((student) => ({
    no: String(student?.no || '').trim(),
    chName: String(student?.ch_name || '').trim(),
    enName: String(student?.en_name || '').trim(),
  }));
}

function normalizeRosterKey(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function validateExportRoster(exportRows, roster) {
  if (!Array.isArray(exportRows) || exportRows.length === 0) {
    throw new Error('每日开口导出名单为空');
  }
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error('目标班级花名册为空，无法校验每日开口导出');
  }

  const rosterIds = new Set(roster.map((student) => normalizeRosterKey(student?.no)).filter(Boolean));
  const rosterChineseNames = new Set(roster.map((student) => normalizeRosterKey(student?.chName)).filter(Boolean));
  const rosterEnglishNames = new Set(roster.map((student) => normalizeRosterKey(student?.enName)).filter(Boolean));
  let matched = 0;
  for (const row of exportRows) {
    const studentId = normalizeRosterKey(row?.no || row?.student_no || row?.['学号']);
    const chineseName = normalizeRosterKey(row?.ch_name || row?.['中文名'] || row?.['中文'] || row?.['姓名']);
    const englishName = normalizeRosterKey(row?.en_name || row?.enName || row?.['英文名'] || row?.['英文']);
    if ((studentId && rosterIds.has(studentId))
      || (chineseName && rosterChineseNames.has(chineseName))
      || (englishName && rosterEnglishNames.has(englishName))) {
      matched += 1;
    }
  }

  const overlap = matched / exportRows.length;
  const countDifference = Math.abs(exportRows.length - roster.length);
  const allowedCountDifference = Math.max(3, Math.ceil(roster.length * 0.2));
  if (overlap < 0.8 || countDifference > allowedCountDifference) {
    throw new Error(
      `每日开口导出名单与目标班级不一致：导出 ${exportRows.length} 人，花名册 ${roster.length} 人，匹配 ${matched} 人`,
    );
  }
}

async function loadChallengeClassFromAcademicSystem(session, classId, window = resolveChallengeWindow()) {
  const requestedClassCode = normalizeClassCode(classId);
  const resolved = await session.scraper.resolveSquadId(classId);
  const classCode = normalizeClassCode(resolved?.classCode || classId);
  if (classCode !== requestedClassCode) {
    throw new Error(`班级映射不一致：请求 ${requestedClassCode}，解析为 ${classCode || '未知班级'}`);
  }
  const squadId = String(resolved?.squadId || '').trim();
  if (!squadId) throw new Error('没有找到当前班级的教务 ID');
  const roster = await fetchRosterForNameEnrichment(session.scraper, squadId);
  let exportRows = null;
  let lastExportError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const candidateRows = await fetchExportRowsWithRetry(session.scraper, squadId, window);
      validateExportRoster(candidateRows, roster);
      exportRows = candidateRows;
      break;
    } catch (error) {
      lastExportError = error;
      console.warn(`⚠️ 每日开口导出校验失败: class=${classCode}; attempt=${attempt}; ${error.message}`);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }
  if (!exportRows) {
    throw lastExportError || new Error('每日开口导出名单校验失败');
  }
  console.log(`✅ 每日开口班级导出完成: class=${classCode}; squad=${squadId}; rows=${exportRows.length}`);
  const rows = summarizePunchRowsForRange(exportRows, window.start, window.end);
  if (rows.some((row) => !normalizeEnglishName(row?.en_name))) {
    console.log(`✅ 每日开口英文名补全: class=${classCode}; roster=${roster.length}`);
  }
  return {
    // The export remains authoritative for membership and check-in status.
    // The roster validates class identity and only enriches matching export rows.
    ...buildSpeakingLeaderboard({ classCode, squadId, roster, rows, window }),
    updatedAt: new Date().toISOString(),
  };
}

function publicLeaderboard(leaderboard) {
  const { squadId: _squadId, students, ...publicSummary } = leaderboard;
  return {
    ...publicSummary,
    students: students.map((student, index) => ({
      studentKey: studentStoreKey(student.studentId || `${student.chineseName}:${index}`),
      rank: student.rank,
      englishName: student.englishName,
      chineseName: student.chineseName,
      daily: student.daily,
      normalDays: student.normalDays,
      supplementDays: student.supplementDays,
      totalDays: student.totalDays,
      streakDays: student.streakDays,
    })),
  };
}

function hasIssuedRewards(settlement) {
  return Object.values(settlement?.issuedByStudent || {}).some((value) => Number(value) > 0);
}

function typedIssuedTotal(settlement, rewardType) {
  return roundOne(Object.values(settlement?.issuedByStudentRewardDate || {})
    .reduce((sum, byType) => sum + Object.values(byType?.[rewardType] || {})
      .reduce((typeSum, amount) => typeSum + (Number(amount) || 0), 0), 0));
}

function legacyIssuedRemainder(settlement) {
  return roundOne(Math.max(
    0,
    issuedTotal(settlement)
      - typedIssuedTotal(settlement, 'base')
      - typedIssuedTotal(settlement, 'streak'),
  ));
}

function configHasStreakReward(configValue) {
  const config = normalizeRewardConfig(configValue);
  return config.rewardMode === 'fixed'
    ? config.thresholdBonus > 0
    : config.streakMultiplier > 1;
}

function hasAmbiguousLegacyStreakRewards(settlement) {
  // Preserve the production fix: typed streak history permits future rule edits.
  return typedIssuedTotal(settlement, 'streak') <= 0
    && legacyIssuedRemainder(settlement) > 0
    && configHasStreakReward(settlement?.config);
}

function issuedTotal(settlement) {
  return roundOne(Object.values(settlement?.issuedByStudent || {})
    .reduce((sum, value) => sum + (Number(value) || 0), 0));
}

function issuedRewardDates(settlement) {
  return [...new Set(Object.values(settlement?.issuedByStudentDate || {})
    .flatMap((byDate) => Object.entries(byDate || {})
      .filter(([, amount]) => Number(amount) > 0)
      .map(([date]) => date)))].sort();
}

function issuedBasePerDayByDate(settlement) {
  const explicit = settlement?.basePerDayByDate && typeof settlement.basePerDayByDate === 'object'
    ? settlement.basePerDayByDate
    : {};
  const result = {};
  for (const [date, value] of Object.entries(explicit)) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) result[date] = roundOne(amount);
  }

  const fallback = normalizeRewardConfig(settlement?.config).basePerDay;
  const typedBaseDates = new Set(Object.values(settlement?.issuedByStudentRewardDate || {})
    .flatMap((byType) => Object.entries(byType?.base || {})
      .filter(([, amount]) => Number(amount) > 0)
      .map(([date]) => date)));
  if (legacyIssuedRemainder(settlement) > 0 && fallback > 0) {
    issuedRewardDates(settlement).forEach((date) => typedBaseDates.add(date));
  }
  for (const date of typedBaseDates) {
    if (!Object.prototype.hasOwnProperty.call(result, date)) result[date] = fallback;
  }
  return result;
}

function deferredRewardDates(settlement) {
  return [...new Set((settlement?.deferredIssues || []).flatMap((issue) => issue.selectedDates || []))].sort();
}

function publicRewardState(settlement, leaderboard) {
  const streakConfigLocked = hasAmbiguousLegacyStreakRewards(settlement);
  const issuedDates = issuedRewardDates(settlement);
  return {
    // Base reward is a per-settlement choice. Historical amounts are preserved
    // by the per-student, per-date ledger instead of locking the whole challenge.
    configLocked: false,
    baseConfigLocked: false,
    streakConfigLocked,
    config: hasIssuedRewards(settlement)
      ? normalizeRewardConfig(settlement?.config)
      : DEFAULT_REWARD_CONFIG,
    issuedTotal: issuedTotal(settlement),
    issuedDates,
    issuedBasePerDayByDate: issuedBasePerDayByDate(settlement),
    pending: Boolean(settlement?.pendingIssue),
    recoveryMessage: settlement?.issues?.at(-1)?.recovered
      ? `已核实上次到账 ${settlement.issues.at(-1).successCount} 人，共 ${Number(settlement.issues.at(-1).totalMP).toFixed(1)} MP。` : '',
    recovery: publicPendingRecovery(settlement, leaderboard),
    deferredDates: deferredRewardDates(settlement),
    pendingMessage: settlement?.pendingIssue
      ? '上次发放结果尚未全部确认，已停止发放尝试。请处理旧单，或暂缓旧单继续其他日期。'
      : '',
  };
}

function publicPlan(plan, balance) {
  const standardBaseRewards = plan.rewards.filter((reward) => reward.standardBaseAmount > 0);
  const repeatedBaseRewards = plan.rewards.filter((reward) => reward.repeatedBaseAmount > 0);
  const unissuedBaseRewards = plan.rewards.filter((reward) => reward.unissuedBaseAmount > 0);
  const streakRewards = plan.rewards.filter((reward) => reward.streakAmount > 0);
  return {
    planId: plan.rewards.length ? plan.id : '',
    recoveryOf: plan.recoveryOf || null,
    expiresAt: plan.expiresAt,
    classCode: plan.classCode,
    challenge: plan.challenge,
    config: plan.config,
    configLocked: plan.configLocked,
    baseConfigLocked: plan.baseConfigLocked,
    streakConfigLocked: plan.streakConfigLocked,
    selection: plan.selection,
    selectedDates: plan.selectedDates,
    rewards: plan.rewards.map((reward) => ({
      rank: reward.rank,
      englishName: reward.studentName,
      chineseName: reward.chineseName,
      streakDays: reward.streakDays,
      totalDays: reward.totalDays,
      supplementDays: reward.supplementDays,
      alreadyIssued: reward.alreadyIssued,
      cumulativeAmount: reward.cumulativeAmount,
      standardBaseAmount: reward.standardBaseAmount,
      repeatedBaseAmount: reward.repeatedBaseAmount,
      unissuedBaseAmount: reward.unissuedBaseAmount,
      streakAmount: reward.streakAmount,
      amount: reward.amount,
    })),
    studentCount: plan.rewards.length,
    totalMP: roundOne(plan.rewards.reduce((sum, reward) => sum + reward.amount, 0)),
    breakdown: {
      standardBase: {
        studentCount: standardBaseRewards.length,
        totalMP: roundOne(standardBaseRewards.reduce((sum, reward) => sum + reward.standardBaseAmount, 0)),
      },
      repeatedBase: {
        studentCount: repeatedBaseRewards.length,
        totalMP: roundOne(repeatedBaseRewards.reduce((sum, reward) => sum + reward.repeatedBaseAmount, 0)),
      },
      unissuedBase: {
        studentCount: unissuedBaseRewards.length,
        totalMP: roundOne(unissuedBaseRewards.reduce((sum, reward) => sum + reward.unissuedBaseAmount, 0)),
      },
      streak: {
        studentCount: streakRewards.length,
        totalMP: roundOne(streakRewards.reduce((sum, reward) => sum + reward.streakAmount, 0)),
      },
    },
    balance: Number.isFinite(balance) ? balance : null,
  };
}

function normalizeSelectedDates(value, allowedDates) {
  const allowed = new Set(allowedDates || []);
  const requested = Array.isArray(value) ? value : allowedDates;
  return [...new Set(requested.map((date) => String(date || '').trim()))]
    .filter((date) => allowed.has(date))
    .sort();
}

function normalizeRewardSelection(value) {
  const requestedBaseStrategy = value?.baseStrategy;
  const normalized = {
    baseStrategy: ['none', 'repeat', 'unissued'].includes(requestedBaseStrategy)
      ? requestedBaseStrategy
      : 'unissued',
    includeStreak: value?.includeStreak !== false,
  };
  const missedBasePerDay = Number(value?.missedBasePerDay);
  if (value?.missedBasePerDay !== null
    && value?.missedBasePerDay !== undefined
    && Number.isFinite(missedBasePerDay)) {
    normalized.missedBasePerDay = roundOne(Math.min(2, Math.max(0, missedBasePerDay)));
  }
  return normalized;
}

function effectiveIssuedComponents(settlement, studentKey, baseTargetByDate, streakTargetByDate) {
  const typed = settlement?.issuedByStudentRewardDate?.[studentKey] || {};
  const baseByDate = { ...(typed.base || {}) };
  const streakByDate = { ...(typed.streak || {}) };
  const recordedTotals = { ...(settlement?.issuedByStudentDate?.[studentKey] || {}) };
  const allDates = new Set([
    ...Object.keys(recordedTotals),
    ...Object.keys(baseTargetByDate || {}),
    ...Object.keys(streakTargetByDate || {}),
  ]);

  for (const date of [...allDates].sort()) {
    let legacyRemainder = roundOne(Math.max(
      0,
      (Number(recordedTotals[date]) || 0)
        - (Number(baseByDate[date]) || 0)
        - (Number(streakByDate[date]) || 0),
    ));
    if (legacyRemainder <= 0) continue;
    const baseAllocation = Math.min(
      Math.max(0, (Number(baseTargetByDate?.[date]) || 0) - (Number(baseByDate[date]) || 0)),
      legacyRemainder,
    );
    if (baseAllocation > 0) {
      baseByDate[date] = roundOne((Number(baseByDate[date]) || 0) + baseAllocation);
      legacyRemainder = roundOne(legacyRemainder - baseAllocation);
    }
    const streakAllocation = Math.min(
      Math.max(0, (Number(streakTargetByDate?.[date]) || 0) - (Number(streakByDate[date]) || 0)),
      legacyRemainder,
    );
    if (streakAllocation > 0) {
      streakByDate[date] = roundOne((Number(streakByDate[date]) || 0) + streakAllocation);
    }
  }
  let unallocatedLegacy = roundOne(Math.max(
    0,
    (Number(settlement?.issuedByStudent?.[studentKey]) || 0)
      - Object.values(recordedTotals).reduce((sum, amount) => sum + (Number(amount) || 0), 0),
  ));
  for (const date of [...allDates].sort()) {
    if (unallocatedLegacy <= 0) break;
    const baseAllocation = Math.min(
      Math.max(0, (Number(baseTargetByDate?.[date]) || 0) - (Number(baseByDate[date]) || 0)),
      unallocatedLegacy,
    );
    if (baseAllocation > 0) {
      baseByDate[date] = roundOne((Number(baseByDate[date]) || 0) + baseAllocation);
      unallocatedLegacy = roundOne(unallocatedLegacy - baseAllocation);
    }
    const streakAllocation = Math.min(
      Math.max(0, (Number(streakTargetByDate?.[date]) || 0) - (Number(streakByDate[date]) || 0)),
      unallocatedLegacy,
    );
    if (streakAllocation > 0) {
      streakByDate[date] = roundOne((Number(streakByDate[date]) || 0) + streakAllocation);
      unallocatedLegacy = roundOne(unallocatedLegacy - streakAllocation);
    }
  }
  return { baseByDate, streakByDate };
}

function dueFromTargets({
  studentKey,
  baseTargetByDate,
  streakTargetByDate,
  selectedDates,
  settlement,
  selection,
  historicalBasePerDayByDate = {},
}) {
  const issued = effectiveIssuedComponents(
    settlement,
    studentKey,
    baseTargetByDate,
    streakTargetByDate,
  );
  const baseDateAmounts = {};
  const streakDateAmounts = {};
  const dateAmounts = {};
  const previouslyIssuedDates = new Set(issuedRewardDates(settlement));
  let standardBaseAmount = 0;
  let repeatedBaseAmount = 0;
  let unissuedBaseAmount = 0;
  for (const date of selectedDates) {
    const currentBaseTarget = Number(baseTargetByDate?.[date]) || 0;
    // A scope choice only applies to dates that already had a settlement.
    // Newly selected dates always follow the normal first-issue path.
    const dateWasPreviouslyIssued = previouslyIssuedDates.has(date);
    const dateBaseStrategy = dateWasPreviouslyIssued
      ? selection.baseStrategy
      : 'unissued';
    const historicalBasePerDay = Number(historicalBasePerDayByDate?.[date]);
    const hasHistoricalBaseRate = Number.isFinite(historicalBasePerDay)
      && historicalBasePerDay >= 0;
    const requestedMissedBasePerDay = selection?.missedBasePerDay;
    const hasRequestedMissedBaseRate = Number.isFinite(requestedMissedBasePerDay)
      && requestedMissedBasePerDay >= 0;
    const baseTarget = dateWasPreviouslyIssued
      && dateBaseStrategy === 'unissued'
      && Object.prototype.hasOwnProperty.call(baseTargetByDate || {}, date)
      ? hasRequestedMissedBaseRate
        ? roundOne(requestedMissedBasePerDay)
        : hasHistoricalBaseRate
          ? roundOne(historicalBasePerDay)
          : currentBaseTarget
      : currentBaseTarget;
    const issuedBaseAmount = Number(issued.baseByDate[date]) || 0;
    const baseAmount = dateBaseStrategy === 'none'
      ? 0
      : dateBaseStrategy === 'repeat'
        ? roundOne(baseTarget)
        // "Only missed" means a student either received this date's base
        // reward or did not. A later rate change must not top up recipients.
        : issuedBaseAmount > 0 ? 0 : roundOne(baseTarget);
    const issuedStreakAmount = Number(issued.streakByDate[date]) || 0;
    const streakAmount = selection.includeStreak
      // The same protection applies to a settled streak component: changing
      // today's configuration never creates an automatic historical top-up.
      ? issuedStreakAmount > 0 ? 0 : roundOne(Number(streakTargetByDate?.[date]) || 0)
      : 0;
    if (baseAmount > 0) {
      baseDateAmounts[date] = baseAmount;
      if (!dateWasPreviouslyIssued) {
        standardBaseAmount = roundOne(standardBaseAmount + baseAmount);
      } else if (dateBaseStrategy === 'repeat') {
        repeatedBaseAmount = roundOne(repeatedBaseAmount + baseAmount);
      } else {
        unissuedBaseAmount = roundOne(unissuedBaseAmount + baseAmount);
      }
    }
    if (streakAmount > 0) streakDateAmounts[date] = streakAmount;
    if (baseAmount > 0 || streakAmount > 0) {
      dateAmounts[date] = roundOne(baseAmount + streakAmount);
    }
  }
  const baseAmount = roundOne(Object.values(baseDateAmounts)
    .reduce((sum, value) => sum + value, 0));
  const streakAmount = roundOne(Object.values(streakDateAmounts)
    .reduce((sum, value) => sum + value, 0));
  return {
    baseDateAmounts,
    streakDateAmounts,
    dateAmounts,
    standardBaseAmount,
    repeatedBaseAmount,
    unissuedBaseAmount,
    streakAmount,
    amount: roundOne(baseAmount + streakAmount),
  };
}

function rewardDueForDates(student, config, selectedDates, settlement, selection) {
  const components = calculateRewardComponents(student, config);
  return {
    ...components,
    ...dueFromTargets({
      studentKey: studentStoreKey(student.studentId),
      baseTargetByDate: components.baseByDate,
      streakTargetByDate: components.streakByDate,
      selectedDates,
      settlement,
      selection,
      historicalBasePerDayByDate: issuedBasePerDayByDate(settlement),
    }),
  };
}

function resolveRewardConfig(settlement, requestedValue) {
  const requested = normalizeRewardConfig(requestedValue);
  if (!hasIssuedRewards(settlement)) return requested;
  const existing = normalizeRewardConfig(settlement?.config);
  const streakConfigLocked = hasAmbiguousLegacyStreakRewards(settlement);
  return {
    basePerDay: requested.basePerDay,
    streakThreshold: streakConfigLocked ? existing.streakThreshold : requested.streakThreshold,
    streakMultiplier: streakConfigLocked ? existing.streakMultiplier : requested.streakMultiplier,
    rewardMode: streakConfigLocked ? existing.rewardMode : requested.rewardMode,
    thresholdBonus: streakConfigLocked ? existing.thresholdBonus : requested.thresholdBonus,
    ignoreSupplementVariance: streakConfigLocked
      ? existing.ignoreSupplementVariance
      : requested.ignoreSupplementVariance,
  };
}

function namesForResultEntry(entry) {
  return [entry?.studentId, entry?.name, entry?.studentName, entry?.chineseName]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function classifyIssueResult(rewards, result) {
  const successNames = new Set((Array.isArray(result?.successList) ? result.successList : [])
    .flatMap((entry) => namesForResultEntry(typeof entry === 'string' ? { name: entry } : entry)));
  const failedNames = new Set((Array.isArray(result?.failedList) ? result.failedList : [])
    .flatMap(namesForResultEntry));
  const matches = (reward, names) => [
    reward.studentId,
    reward.studentName,
    reward.chineseName,
  ].map((value) => String(value || '').trim().toLowerCase()).some((value) => value && names.has(value));
  const reportedSuccess = Math.max(0, Number(result?.success) || 0);
  const reportedFailed = Math.max(0, Number(result?.failed) || 0);
  let successful = rewards.filter((reward) => matches(reward, successNames));
  const failed = rewards.filter((reward) => matches(reward, failedNames));
  if (reportedSuccess === rewards.length && reportedFailed === 0 && successful.length === 0) {
    successful = [...rewards];
  }
  const ambiguous = reportedSuccess > 0 && successful.length !== reportedSuccess;
  return { successful, failed, ambiguous, reportedSuccess, reportedFailed };
}

function pendingAttemptTimes(pendingIssue) {
  return [pendingIssue?.startedAt, ...(pendingIssue?.attempts || []).map((attempt) => attempt?.startedAt)]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
}

function matchPendingIssueRecords(pendingIssue, records) {
  const attemptTimes = pendingAttemptTimes(pendingIssue);
  if (!attemptTimes.length) return { matchedRewards: [], matchedRecordIds: [], full: false };
  const candidates = (Array.isArray(records) ? records : []).filter((record) => {
    const occurredAt = Date.parse(record?.occurredAt);
    if (!Number.isFinite(occurredAt)) return false;
    const nearAttempt = attemptTimes.some((attemptAt) => (
      occurredAt >= attemptAt - PENDING_RECONCILE_EARLY_MS
      && occurredAt <= attemptAt + PENDING_RECONCILE_WINDOW_MS
    ));
    const type = String(record?.type || '').trim();
    const tagName = String(record?.tagName || '').trim();
    return nearAttempt
      && (!type || type === '1' || type.includes('发放'))
      && (!tagName || /MP|MiniPin/i.test(tagName));
  });
  // The upstream splits one grant into MP + CP rows at the same timestamp.
  // Do not combine different operators, tags, times or repeated equal grants.
  const groups = new Map();
  const seenIds = new Set();
  for (const record of candidates) {
    if (record.id && seenIds.has(String(record.id))) continue;
    if (record.id) seenIds.add(String(record.id));
    const key = JSON.stringify([record.studentNo, record.occurredAt, record.addedBy || '', record.tagName || '']);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const matchedRewards = [];
  const matchedRecordIds = [];
  for (const reward of pendingIssue?.rewards || []) {
    const matches = [...groups.values()].filter((rows) => {
      if (studentStoreKey(rows[0].studentNo) !== reward.student) return false;
      if (pendingIssue.operator && rows[0].addedBy && hashKey(pendingIssue.operator) !== hashKey(rows[0].addedBy)) return false;
      if (rows.length > 1) {
        const names = rows.map((r) => String(r.grantName || '').toUpperCase());
        if (rows.length !== 2 || !names.includes('MP') || !names.some((n) => n === 'CP' || n === 'COUPON')) return false;
      }
      return rows.every((r) => Number(r.amount) > 0)
        && roundOne(rows.reduce((sum, r) => sum + Number(r.amount), 0)) === roundOne(reward.amount);
    });
    if (matches.length !== 1) continue;
    matchedRewards.push(reward);
    matchedRecordIds.push(...matches[0].map((r) => String(r.id || '')));
  }
  return {
    matchedRewards,
    matchedRecordIds,
    full: matchedRewards.length > 0
      && matchedRewards.length === (pendingIssue?.rewards || []).length,
  };
}

function pendingBreakdown(pendingIssue, rewards) {
  if (pendingIssue?.breakdown) return pendingIssue.breakdown;
  const baseTotal = roundOne(rewards.reduce((sum, reward) => sum
    + Object.values(reward?.baseDateAmounts || {}).reduce((inner, amount) => inner + (Number(amount) || 0), 0), 0));
  const streakTotal = roundOne(rewards.reduce((sum, reward) => sum
    + Object.values(reward?.streakDateAmounts || {}).reduce((inner, amount) => inner + (Number(amount) || 0), 0), 0));
  const baseStrategy = pendingIssue?.selection?.baseStrategy;
  const baseEntry = {
    studentCount: rewards.filter((reward) => Object.values(reward?.baseDateAmounts || {})
      .some((amount) => Number(amount) > 0)).length,
    totalMP: baseTotal,
  };
  const empty = { studentCount: 0, totalMP: 0 };
  return {
    standardBase: baseStrategy === 'repeat' || baseStrategy === 'unissued' ? empty : baseEntry,
    repeatedBase: baseStrategy === 'repeat' ? baseEntry : empty,
    unissuedBase: baseStrategy === 'unissued' ? baseEntry : empty,
    streak: {
      studentCount: rewards.filter((reward) => Object.values(reward?.streakDateAmounts || {})
        .some((amount) => Number(amount) > 0)).length,
      totalMP: streakTotal,
    },
  };
}

function finalizeRecoveredPendingIssue(settlement, { at = new Date().toISOString(), method = 'transaction-log' } = {}) {
  const pendingIssue = settlement?.pendingIssue;
  const rewards = Array.isArray(pendingIssue?.rewards) ? pendingIssue.rewards : [];
  if (!rewards.length) throw new Error('待确认发放缺少逐学生明细，无法自动核销');
  settlement.issuedByStudent = settlement.issuedByStudent || {};
  settlement.issuedByStudentDate = settlement.issuedByStudentDate || {};
  settlement.issuedByStudentRewardDate = settlement.issuedByStudentRewardDate || {};
  settlement.basePerDayByDate = { ...(settlement.basePerDayByDate || {}) };
  for (const reward of rewards) {
    const studentKey = String(reward?.student || '').trim();
    if (!studentKey) continue;
    settlement.issuedByStudent[studentKey] = roundOne(
      (Number(settlement.issuedByStudent[studentKey]) || 0) + (Number(reward.amount) || 0),
    );
    const studentDates = settlement.issuedByStudentDate[studentKey] || {};
    for (const [date, amount] of Object.entries(reward.dateAmounts || {})) {
      studentDates[date] = roundOne((Number(studentDates[date]) || 0) + Number(amount));
    }
    settlement.issuedByStudentDate[studentKey] = studentDates;
    const studentRewardDates = settlement.issuedByStudentRewardDate[studentKey] || { base: {}, streak: {} };
    for (const [date, amount] of Object.entries(reward.baseDateAmounts || {})) {
      studentRewardDates.base[date] = roundOne(
        (Number(studentRewardDates.base[date]) || 0) + Number(amount),
      );
      if (Number(amount) > 0
        && !Object.prototype.hasOwnProperty.call(settlement.basePerDayByDate, date)) {
        settlement.basePerDayByDate[date] = roundOne(Number(amount));
      }
    }
    for (const [date, amount] of Object.entries(reward.streakDateAmounts || {})) {
      studentRewardDates.streak[date] = roundOne(
        (Number(studentRewardDates.streak[date]) || 0) + Number(amount),
      );
    }
    settlement.issuedByStudentRewardDate[studentKey] = studentRewardDates;
  }
  if (pendingIssue.config) settlement.config = normalizeRewardConfig(pendingIssue.config);
  const totalMP = roundOne(rewards.reduce((sum, reward) => sum + (Number(reward.amount) || 0), 0));
  settlement.pendingIssue = null;
  settlement.updatedAt = at;
  settlement.revision = (Number(settlement.revision) || 0) + 1;
  settlement.issues = [...(settlement.issues || []), {
    at,
    successCount: rewards.length,
    failedCount: 0,
    totalMP,
    selectedDates: pendingIssue.selectedDates || [],
    selection: pendingIssue.selection || {},
    config: normalizeRewardConfig(pendingIssue.config || settlement.config),
    breakdown: pendingBreakdown(pendingIssue, rewards),
    recovered: true,
    recoveryMethod: method,
  }].slice(-20);
  return { successCount: rewards.length, failedCount: 0, totalMP };
}

async function reconcilePendingIssue(scraper, settlement, classId, checkedAt = new Date()) {
  if (!settlement?.pendingIssue || typeof scraper?.getMinipinGrantRecords !== 'function') {
    return { resolved: false, matchedCount: 0 };
  }
  const attemptTimes = pendingAttemptTimes(settlement.pendingIssue);
  if (!attemptTimes.length) return { resolved: false, matchedCount: 0 };
  const records = await scraper.getMinipinGrantRecords(classId, {
    startedAt: new Date(Math.min(...attemptTimes) - PENDING_RECONCILE_EARLY_MS).toISOString(),
    endedAt: new Date(Math.max(...attemptTimes) + PENDING_RECONCILE_WINDOW_MS).toISOString(),
  });
  const match = matchPendingIssueRecords(settlement.pendingIssue, records);
  const pending = settlement.pendingIssue;
  pending.checkedAt = new Date(checkedAt).toISOString();
  pending.lastError = '';
  if (!match.matchedRewards.length) return { resolved: false, matchedCount: 0 };
  const unmatched = pending.rewards.filter((reward) => !match.matchedRewards.includes(reward));
  settlement.pendingIssue = { ...pending, rewards: match.matchedRewards, breakdown: null };
  const receipt = finalizeRecoveredPendingIssue(settlement, {
    at: new Date(checkedAt).toISOString(),
  });
  if (unmatched.length) settlement.pendingIssue = {
    ...pending,
    rewards: unmatched,
    originalCount: pending.originalCount || pending.rewards.length,
    originalTotalMP: pending.originalTotalMP ?? pending.totalMP,
    confirmedCount: (pending.confirmedCount || 0) + match.matchedRewards.length,
    confirmedTotalMP: roundOne((pending.confirmedTotalMP || 0) + receipt.totalMP),
    totalMP: roundOne(unmatched.reduce((sum, reward) => sum + Number(reward.amount), 0)),
    breakdown: null,
  };
  return { resolved: !unmatched.length, matchedCount: match.matchedRewards.length,
    recordIds: match.matchedRecordIds, ...receipt };
}

async function reconcilePendingIssueWithRetry(scraper, settlement, classId, checkedAt = new Date()) {
  if (typeof scraper?.getMinipinGrantRecords !== 'function') {
    return { resolved: false, matchedCount: 0 };
  }
  return reconcilePendingIssue(scraper, settlement, classId, checkedAt);
}

function pendingRewardConfig(pending, settlement) {
  if (pending.config) return normalizeRewardConfig(pending.config);
  const rates = [...new Set((pending.rewards || []).flatMap((r) => Object.values(r.baseDateAmounts || {})).map(Number).filter((n) => n > 0))];
  return normalizeRewardConfig({ ...(settlement?.config || DEFAULT_REWARD_CONFIG), ...(rates.length === 1 ? { basePerDay: rates[0] } : {}) });
}

function publicPendingRecovery(settlement, leaderboard) {
  const pending = settlement?.pendingIssue || settlement?.deferredIssues?.[0];
  if (!pending) return null;
  const roster = new Map((leaderboard?.students || []).map((student) => [studentStoreKey(student.studentId), student]));
  return {
    planId: pending.planId, startedAt: pending.startedAt,
    deferred: !settlement?.pendingIssue,
    confirmedCount: pending.confirmedCount || 0,
    confirmedTotalMP: pending.confirmedTotalMP || 0,
    unresolvedCount: pending.rewards.length, totalMP: pending.totalMP,
    selectedDates: pending.selectedDates || [], config: pendingRewardConfig(pending, settlement),
    lastError: pending.lastError || '', checkedAt: pending.checkedAt || null,
    students: pending.rewards.map((reward) => {
      const student = roster.get(reward.student);
      return { name: [student?.englishName, student?.chineseName].filter(Boolean).join(' ') || '原名单学生（当前名单未找到）', amount: reward.amount };
    }),
  };
}

function createSpeakingChallengeRoutes({
  requireLoggedInSession,
  storePath = '',
  now = () => new Date(),
  loadChallengeClass = loadChallengeClassFromAcademicSystem,
  speakingSnapshotService = null,
  readingWordsService = null,
  appendUsageEvent = null,
  buildUsageEvent = null,
  usageLogPath = '',
  sanitizeText = (value) => String(value || '').trim().slice(0, 120),
}) {
  const router = express.Router();
  const jobs = new Map();
  const plans = new Map();
  const issueLocks = new Map();

  const getSettlementContext = async (session, leaderboard) => {
    const store = await readSettlementStore(storePath);
    const key = settlementKey(session.username, leaderboard.classCode, leaderboard.challenge.id);
    return { store, key, settlement: store.settlements[key] || null };
  };

  const loadClass = async (session, classId) => {
    const window = resolveChallengeWindow(now());
    const jobKey = `${hashKey(session.username).slice(0, 12)}:${normalizeClassCode(classId)}:${window.end}`;
    let job = jobs.get(jobKey);
    if (!job) {
      job = speakingSnapshotService
        ? (async () => {
          const cached = await speakingSnapshotService.getSpeakingChallenge(
            session.username,
            classId,
            window,
          );
          if (cached) return cached;
          const refreshed = await speakingSnapshotService.refreshSpeakingChallenge({
            username: session.username,
            scraper: session.scraper,
            classId,
            window,
          });
          return refreshed.leaderboard;
        })()
        : loadChallengeClass(session, classId, window);
      jobs.set(jobKey, job);
    }
    try {
      return await job;
    } finally {
      if (jobs.get(jobKey) === job) jobs.delete(jobKey);
    }
  };

  const runIssueLocked = async (key, task) => {
    const previous = issueLocks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    issueLocks.set(key, next);
    try {
      return await next;
    } finally {
      if (issueLocks.get(key) === next) issueLocks.delete(key);
    }
  };

  router.post('/data/speaking-challenge/class', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    try {
      const baseLeaderboard = await loadClass(session, classId);
      const leaderboard = readingWordsService ? await readingWordsService.enrich(baseLeaderboard) : baseLeaderboard;
      let context = await getSettlementContext(session, leaderboard);
      if (context.settlement?.pendingIssue) {
        const recovery = await runIssueLocked(context.key, async () => {
          const store = await readSettlementStore(storePath);
          const current = store.settlements[context.key];
          if (!current?.pendingIssue) return null;
          current.pendingIssue.operator ||= session.username;
          const result = await reconcilePendingIssue(
            session.scraper, current, leaderboard.squadId || leaderboard.classCode, now(),
          ).catch((error) => {
            current.pendingIssue.lastError = String(error.message || error);
            return { resolved: false, matchedCount: 0 };
          });

          store.settlements[context.key] = current;
          await saveSettlement(storePath, context.key, current);
          return result;
        }).catch((error) => {
          console.warn(`⚠️ 每日开口待确认流水自动核对失败: class=${classId}; ${error.message}`);
          return null;
        });
        if (recovery?.successCount > 0 && appendUsageEvent && buildUsageEvent && usageLogPath) {
          await appendUsageEvent(usageLogPath, buildUsageEvent(req, session, {
            event: 'minipin_issued',
            module: 'speaking-challenge',
            className: sanitizeText(leaderboard.classCode),
            detail: `challenge=${leaderboard.challenge.id};success=${recovery.successCount};failed=0;recovered=transaction-log`,
            mpTotal: recovery.totalMP,
            studentCount: recovery.successCount,
            successCount: recovery.successCount,
            failedCount: 0,
          }));
        }
        context = await getSettlementContext(session, leaderboard);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        status: 'success',
        leaderboard: publicLeaderboard(leaderboard),
        rewardState: publicRewardState(context.settlement, leaderboard),
        updatedAt: leaderboard.updatedAt || new Date(now()).toISOString(),
      });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '每日开口挑战榜读取失败') });
    }
  });

  router.post('/data/speaking-challenge/resolve-pending', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    const action = req.body?.action;
    if (!/^[A-Z][A-Z0-9-]{1,31}$/.test(classId) || !['check', 'defer', 'retry'].includes(action)) {
      return res.status(400).json({ error: '请指定班级和旧单处理方式。' });
    }
    if (action === 'retry' && req.body?.acknowledgedNotReceived !== true) {
      return res.status(400).json({ error: '请先在教务系统核对剩余名单，确认未到账后再生成补发清单。' });
    }
    try {
      const leaderboard = await loadClass(session, classId);
      const { key } = await getSettlementContext(session, leaderboard);
      const result = await runIssueLocked(key, async () => {
        const store = await readSettlementStore(storePath);
        const settlement = store.settlements[key];
        const id = String(req.body?.planId || '');
        const pending = settlement?.pendingIssue?.planId === id ? settlement.pendingIssue
          : (settlement?.deferredIssues || []).find((item) => item.planId === id);
        if (!pending) { const error = new Error('这笔旧单已处理或不属于当前班级，请刷新结果。'); error.statusCode = 409; throw error; }
        const wasDeferred = settlement.pendingIssue !== pending;
        const active = settlement.pendingIssue;
        settlement.pendingIssue = pending;
        pending.operator ||= session.username;
        // No write endpoint is called here. Re-check before releasing any unresolved reward.
        let checkError = '';
        try {
          if (typeof session.scraper?.getMinipinGrantRecords !== 'function') throw new Error('当前无法读取教务流水');
          await reconcilePendingIssue(session.scraper, settlement, leaderboard.squadId || classId, now());
        } catch (error) {
          checkError = String(error.message || error);
          pending.lastError = checkError;
        }
        const remaining = settlement.pendingIssue;
        if (remaining && action === 'retry' && remaining.rewards.some((reward) => !leaderboard.students.some((student) => studentStoreKey(student.studentId) === reward.student))) {
          checkError = '剩余名单中有学生不在当前班级，无法生成准确的补发清单，请先核对学生归属';
          remaining.lastError = checkError;
        }
        settlement.deferredIssues = (settlement.deferredIssues || []).filter((item) => item.planId !== id);
        let message = remaining ? '仍有未确认结果。请核对名单后选择补发，或暂缓处理。' : '已核实全部到账，旧单已结清，可继续发放。';
        if (remaining && action === 'defer') {
          settlement.deferredIssues.push({ ...remaining, deferredAt: new Date(now()).toISOString() });
          settlement.pendingIssue = null;
          message = '旧单已暂缓，记录保留；可继续其他日期的奖励。旧单涉及日期核清后再处理。';
        } else if (remaining && action === 'retry' && !checkError) {
          settlement.resolutionHistory = [...(settlement.resolutionHistory || []), {
            ...remaining, action: 'teacher-confirmed-not-received', resolvedAt: new Date(now()).toISOString(),
          }];
          settlement.pendingIssue = null;
          message = '已保留到账记录，剩余部分可重新生成补发清单；核对清单并再次确认后才会发放。';
        } else if (wasDeferred && remaining) {
          settlement.deferredIssues.push(remaining);
          settlement.pendingIssue = null;
        }
        if (wasDeferred) settlement.pendingIssue = active;
        settlement.revision = (Number(settlement.revision) || 0) + 1;
        await saveSettlement(storePath, key, settlement);
        if (checkError && action === 'retry') {
          const error = new Error(`本次核账失败，未解除补发保护：${checkError}。可先暂缓旧单，继续其他日期。`);
          error.statusCode = 502; error.rewardState = publicRewardState(settlement, leaderboard); throw error;
        }
        let retryPlan = null;
        if (remaining && action === 'retry') {
          const balanceResult = await session.scraper.getMinipinBalance(classId).catch(() => null);
          const balance = Number(balanceResult?.minipin);
          const rewards = remaining.rewards.map((reward) => {
            const student = leaderboard.students.find((item) => studentStoreKey(item.studentId) === reward.student);
            const base = roundOne(Object.values(reward.baseDateAmounts || {}).reduce((sum, n) => sum + Number(n), 0));
            const streak = roundOne(Object.values(reward.streakDateAmounts || {}).reduce((sum, n) => sum + Number(n), 0));
            return { ...reward, studentId: student.studentId, studentName: student.englishName,
              chineseName: student.chineseName, rank: student.rank, streakDays: student.streakDays, totalDays: student.totalDays,
              alreadyIssued: settlement.issuedByStudent?.[reward.student] || 0,
              cumulativeAmount: reward.amount, standardBaseAmount: 0, repeatedBaseAmount: 0, unissuedBaseAmount: base, streakAmount: streak };
          });
          const plan = { id: crypto.randomUUID(), recoveryOf: remaining.planId, usernameKey: hashKey(session.username),
            classCode: classId, squadId: leaderboard.squadId, challenge: leaderboard.challenge,
            config: pendingRewardConfig(remaining, settlement), selection: { baseStrategy: 'unissued', includeStreak: true },
            selectedDates: remaining.selectedDates, rewards, settlementRevision: settlement.revision,
            expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(), used: false,
            balanceBefore: Number.isFinite(balance) ? balance : null };
          plans.set(plan.id, plan);
          retryPlan = publicPlan(plan, plan.balanceBefore);
        }
        return { rewardState: publicRewardState(settlement, leaderboard), message, plan: retryPlan,
          retryReady: Boolean(remaining && action === 'retry'), selectedDates: pending.selectedDates,
          config: pendingRewardConfig(pending, settlement) };
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 502).json({ error: String(error.message || error), rewardState: error.rewardState });
    }
  });

  router.post('/data/speaking-challenge/reward-plan', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    try {
      const leaderboard = await loadClass(session, classId);
      const { settlement } = await getSettlementContext(session, leaderboard);
      if (settlement?.pendingIssue) {
        return res.status(409).json({
          error: '上一笔发放结果仍待确认，为避免重复发放，暂时不能生成新清单。',
          rewardState: publicRewardState(settlement),
        });
      }
      const requestedConfig = normalizeRewardConfig(req.body?.config);
      const streakConfigLocked = hasAmbiguousLegacyStreakRewards(settlement);
      const baseConfigLocked = false;
      const configLocked = false;
      const config = resolveRewardConfig(settlement, requestedConfig);
      const selection = normalizeRewardSelection(req.body?.selection);
      const effectiveLeaderboard = applySupplementPolicy(
        leaderboard,
        config.ignoreSupplementVariance,
      );
      const blockedDates = new Set(deferredRewardDates(settlement));
      const selectedDates = normalizeSelectedDates(
        req.body?.selectedDates,
        leaderboard.challenge.dates,
      ).filter((date) => !blockedDates.has(date));
      if (!selectedDates.length) {
        return res.status(400).json({ error: blockedDates.size ? '所选日期涉及暂缓旧单，请先处理旧单，或选择其他日期。' : '请至少选择一个需要结算的日期。' });
      }
      const rewards = effectiveLeaderboard.students.map((student) => {
        const cumulativeAmount = calculateCumulativeReward(student, config);
        const alreadyIssued = roundOne(settlement?.issuedByStudent?.[studentStoreKey(student.studentId)] || 0);
        const due = rewardDueForDates(student, config, selectedDates, settlement, selection);
        return {
          studentId: student.studentId,
          studentName: student.englishName,
          chineseName: student.chineseName,
          aliases: [student.englishName, student.chineseName].filter(Boolean),
          rank: student.rank,
          streakDays: student.streakDays,
          totalDays: student.totalDays,
          supplementDays: student.supplementDays,
          alreadyIssued,
          cumulativeAmount,
          baseTargetByDate: due.baseByDate,
          streakTargetByDate: due.streakByDate,
          allTargetByDate: due.totalByDate,
          baseDateAmounts: due.baseDateAmounts,
          streakDateAmounts: due.streakDateAmounts,
          dateAmounts: due.dateAmounts,
          standardBaseAmount: due.standardBaseAmount,
          repeatedBaseAmount: due.repeatedBaseAmount,
          unissuedBaseAmount: due.unissuedBaseAmount,
          streakAmount: due.streakAmount,
          amount: due.amount,
        };
      }).filter((reward) => reward.amount > 0);
      const createdAt = Date.now();
      const plan = {
        id: crypto.randomUUID(),
        usernameKey: hashKey(session.username),
        classCode: leaderboard.classCode,
        squadId: leaderboard.squadId,
        challenge: leaderboard.challenge,
        config,
        configLocked,
        baseConfigLocked,
        streakConfigLocked,
        selection,
        selectedDates,
        rewards,
        settlementRevision: Number(settlement?.revision) || 0,
        createdAt,
        expiresAt: new Date(createdAt + PLAN_TTL_MS).toISOString(),
        used: false,
      };
      let balance = null;
      try {
        const balanceResult = await session.scraper.getMinipinBalance(leaderboard.classCode);
        const value = Number(balanceResult?.minipin);
        if (Number.isFinite(value)) balance = value;
      } catch {
        balance = null;
      }
      plan.balanceBefore = balance;
      if (rewards.length) plans.set(plan.id, plan);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', plan: publicPlan(plan, balance) });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || 'MiniPin 发放清单生成失败') });
    }
  });

  router.post('/data/speaking-challenge/issue', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const planId = String(req.body?.planId || '').trim();
    const plan = plans.get(planId);
    if (!plan || plan.used || Date.parse(plan.expiresAt) <= Date.now()) {
      return res.status(409).json({ error: '这份发放清单已失效，请重新生成并核对。' });
    }
    if (plan.usernameKey !== hashKey(session.username)) {
      return res.status(403).json({ error: '这份发放清单不属于当前登录老师。' });
    }
    if (req.body?.acknowledged !== true) {
      return res.status(400).json({ error: '请先确认已经核对班级、学生和发放金额。' });
    }

    const key = settlementKey(session.username, plan.classCode, plan.challenge.id);
    try {
      const result = await runIssueLocked(key, async () => {
        const store = await readSettlementStore(storePath);
        const settlement = store.settlements[key] || {
          classCode: plan.classCode,
          challengeId: plan.challenge.id,
          config: null,
          issuedByStudent: {},
          issuedByStudentDate: {},
          issuedByStudentRewardDate: {},
          issues: [],
        };
        if (settlement.pendingIssue) {
          const error = new Error('上一笔发放结果仍待确认，为避免重复发放，暂时不能继续。');
          error.statusCode = 409;
          throw error;
        }
        if ((Number(settlement.revision) || 0) !== plan.settlementRevision) {
          const error = new Error('发放记录刚刚发生变化，请重新生成清单后再确认。');
          error.statusCode = 409;
          throw error;
        }
        const currentResolvedConfig = resolveRewardConfig(settlement, plan.config);
        if (!plan.recoveryOf && !rewardConfigsEqual(currentResolvedConfig, plan.config)) {
          const error = new Error('这个班的已发奖励规则发生变化，请重新生成清单。');
          error.statusCode = 409;
          throw error;
        }
        settlement.issuedByStudent = settlement.issuedByStudent || {};
        settlement.issuedByStudentDate = settlement.issuedByStudentDate || {};
        settlement.issuedByStudentRewardDate = settlement.issuedByStudentRewardDate || {};
        settlement.basePerDayByDate = {
          ...issuedBasePerDayByDate(settlement),
          ...(settlement.basePerDayByDate || {}),
        };
        const currentRewards = plan.recoveryOf ? plan.rewards : plan.rewards.map((reward) => {
          const studentKey = studentStoreKey(reward.studentId);
          const due = dueFromTargets({
            studentKey,
            baseTargetByDate: reward.baseTargetByDate,
            streakTargetByDate: reward.streakTargetByDate,
            selectedDates: plan.selectedDates,
            settlement,
            selection: plan.selection,
            historicalBasePerDayByDate: issuedBasePerDayByDate(settlement),
          });
          return {
            ...reward,
            ...due,
          };
        }).filter((reward) => reward.amount > 0);
        if (!currentRewards.length) {
          const error = new Error('这份奖励已经发放过了，没有新的差额需要结算。');
          error.statusCode = 409;
          throw error;
        }

        let issueBalanceBefore = Number.isFinite(plan.balanceBefore) ? roundOne(plan.balanceBefore) : null;
        try {
          const balanceResult = await session.scraper.getMinipinBalance(plan.classCode);
          const value = Number(balanceResult?.minipin);
          if (Number.isFinite(value)) issueBalanceBefore = roundOne(value);
        } catch {
          // Keep the balance captured when the teacher previewed the plan.
        }

        plan.used = true;
        settlement.pendingIssue = {
          planId: plan.id,
          operator: session.username,
          startedAt: new Date(now()).toISOString(),
          totalMP: roundOne(currentRewards.reduce((sum, reward) => sum + reward.amount, 0)),
          config: plan.config,
          selectedDates: plan.selectedDates,
          selection: plan.selection,
          breakdown: publicPlan({ ...plan, rewards: currentRewards }, null).breakdown,
          balanceBefore: issueBalanceBefore,
          attempts: [],
          rewards: currentRewards.map((reward) => ({
            student: studentStoreKey(reward.studentId),
            amount: reward.amount,
            baseDateAmounts: reward.baseDateAmounts,
            streakDateAmounts: reward.streakDateAmounts,
            dateAmounts: reward.dateAmounts,
          })),
        };
        store.settlements[key] = settlement;
        await saveSettlement(storePath, key, settlement);

        let upstreamResult;
        let classified;
        for (let attempt = 1; attempt <= MAX_AUTOMATIC_ISSUE_ATTEMPTS; attempt += 1) {
          settlement.pendingIssue.attempts.push({
            attempt,
            startedAt: new Date(now()).toISOString(),
          });
          store.settlements[key] = settlement;
          await saveSettlement(storePath, key, settlement);
          try {
            upstreamResult = await session.scraper.submitMinipinDirect(
              plan.squadId || plan.classCode,
              currentRewards,
            );
          } catch (error) {
            const recovered = await reconcilePendingIssueWithRetry(
              session.scraper,
              settlement,
              plan.squadId || plan.classCode,
              now(),
            ).catch(() => ({ resolved: false }));
            if (recovered.resolved) {
              store.settlements[key] = settlement;
              await saveSettlement(storePath, key, settlement);
              if (appendUsageEvent && buildUsageEvent && usageLogPath) {
                await appendUsageEvent(usageLogPath, buildUsageEvent(req, session, {
                  event: 'minipin_issued',
                  module: 'speaking-challenge',
                  className: sanitizeText(plan.classCode),
                  detail: `challenge=${plan.challenge.id};success=${recovered.successCount};failed=0;recovered=transaction-log`,
                  mpTotal: recovered.totalMP,
                  studentCount: recovered.successCount,
                  successCount: recovered.successCount,
                  failedCount: 0,
                }));
              }
              return {
                ...recovered,
                failedStudents: [],
                balanceBefore: issueBalanceBefore,
                balanceAfter: null,
                balanceVerified: false,
                rewardState: publicRewardState(settlement),
              };
            }
            settlement.pendingIssue.lastError = String(error.message || error);
            await saveSettlement(storePath, key, settlement);
            const uncertain = new Error(`上次发放结果尚未全部确认，已停止发放尝试。请查看旧单处理选项：${error.message}`);
            uncertain.statusCode = 502;
            throw uncertain;
          }

          classified = classifyIssueResult(currentRewards, upstreamResult);
          if (classified.ambiguous) {
            const recovered = await reconcilePendingIssueWithRetry(
              session.scraper,
              settlement,
              plan.squadId || plan.classCode,
              now(),
            ).catch(() => ({ resolved: false }));
            if (recovered.resolved) {
              store.settlements[key] = settlement;
              await saveSettlement(storePath, key, settlement);
              if (appendUsageEvent && buildUsageEvent && usageLogPath) {
                await appendUsageEvent(usageLogPath, buildUsageEvent(req, session, {
                  event: 'minipin_issued',
                  module: 'speaking-challenge',
                  className: sanitizeText(plan.classCode),
                  detail: `challenge=${plan.challenge.id};success=${recovered.successCount};failed=0;recovered=transaction-log`,
                  mpTotal: recovered.totalMP,
                  studentCount: recovered.successCount,
                  successCount: recovered.successCount,
                  failedCount: 0,
                }));
              }
              return {
                ...recovered,
                failedStudents: [],
                balanceBefore: issueBalanceBefore,
                balanceAfter: null,
                balanceVerified: false,
                rewardState: publicRewardState(settlement),
              };
            }
            settlement.pendingIssue.lastError = '教务系统返回的成功人数与学生名单不一致。';
            await saveSettlement(storePath, key, settlement);
            const uncertain = new Error('教务系统返回的成功人数与学生名单不一致，已停止发放尝试。请查看旧单处理选项。');
            uncertain.statusCode = 502;
            throw uncertain;
          }

          const definitelyFailed = classified.successful.length === 0
            && classified.failed.length === currentRewards.length
            && upstreamResult?.retryable === true;
          if (!definitelyFailed || attempt === MAX_AUTOMATIC_ISSUE_ATTEMPTS) break;
        }

        for (const reward of classified.successful) {
          const studentKey = studentStoreKey(reward.studentId);
          settlement.issuedByStudent[studentKey] = roundOne(
            (Number(settlement.issuedByStudent[studentKey]) || 0) + reward.amount,
          );
          const studentDates = settlement.issuedByStudentDate[studentKey] || {};
          for (const [date, amount] of Object.entries(reward.dateAmounts || {})) {
            studentDates[date] = roundOne((Number(studentDates[date]) || 0) + Number(amount));
          }
          settlement.issuedByStudentDate[studentKey] = studentDates;
          const studentRewardDates = settlement.issuedByStudentRewardDate[studentKey] || {
            base: {},
            streak: {},
          };
          for (const [date, amount] of Object.entries(reward.baseDateAmounts || {})) {
            studentRewardDates.base[date] = roundOne(
              (Number(studentRewardDates.base[date]) || 0) + Number(amount),
            );
          }
          for (const [date, amount] of Object.entries(reward.streakDateAmounts || {})) {
            studentRewardDates.streak[date] = roundOne(
              (Number(studentRewardDates.streak[date]) || 0) + Number(amount),
            );
          }
          settlement.issuedByStudentRewardDate[studentKey] = studentRewardDates;
          for (const [date, amount] of Object.entries(reward.baseDateAmounts || {})) {
            // Preserve the original normal rate for a date. A later makeup or
            // explicit repeat is a separate issue and must not rewrite the
            // reference amount shown to teachers.
            if (Number(amount) > 0
              && !Object.prototype.hasOwnProperty.call(settlement.basePerDayByDate, date)) {
              settlement.basePerDayByDate[date] = roundOne(Number(amount));
            }
          }
        }
        if (classified.successful.length > 0) settlement.config = plan.config;
        settlement.pendingIssue = null;
        settlement.updatedAt = new Date().toISOString();
        settlement.revision = (Number(settlement.revision) || 0) + 1;
        settlement.issues = [...(settlement.issues || []), {
          at: settlement.updatedAt,
          successCount: classified.successful.length,
          failedCount: classified.failed.length,
          totalMP: roundOne(classified.successful.reduce((sum, reward) => sum + reward.amount, 0)),
          selectedDates: plan.selectedDates,
          selection: plan.selection,
          config: plan.config,
          breakdown: publicPlan({ ...plan, rewards: classified.successful }, null).breakdown,
        }].slice(-20);
        store.settlements[key] = settlement;
        await saveSettlement(storePath, key, settlement);

        const totalMP = roundOne(classified.successful.reduce((sum, reward) => sum + reward.amount, 0));
        const balanceBefore = issueBalanceBefore;
        let balanceAfter = null;
        let balanceVerified = false;
        try {
          const balanceResult = await session.scraper.getMinipinBalance(plan.classCode);
          const value = Number(balanceResult?.minipin);
          if (Number.isFinite(value)) {
            balanceAfter = roundOne(value);
            balanceVerified = true;
          }
        } catch {
          balanceAfter = null;
        }
        if (balanceAfter === null && balanceBefore !== null) {
          balanceAfter = roundOne(Math.max(0, balanceBefore - totalMP));
        }
        if (classified.successful.length > 0 && appendUsageEvent && buildUsageEvent && usageLogPath) {
          await appendUsageEvent(usageLogPath, buildUsageEvent(req, session, {
            event: 'minipin_issued',
            module: 'speaking-challenge',
            className: sanitizeText(plan.classCode),
            detail: `challenge=${plan.challenge.id};success=${classified.successful.length};failed=${classified.failed.length}`,
            mpTotal: totalMP,
            studentCount: currentRewards.length,
            successCount: classified.successful.length,
            failedCount: classified.failed.length,
          }));
        }
        return {
          successCount: classified.successful.length,
          failedCount: classified.failed.length,
          totalMP,
          failedStudents: classified.failed.map((reward) => reward.studentName),
          failureMessage: (upstreamResult?.failedList || []).map((item) => item.error).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("；").slice(0, 500),
          balanceBefore,
          balanceAfter,
          balanceVerified,
          rewardState: publicRewardState(settlement),
        };
      });
      plans.delete(planId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', result });
    } catch (error) {
      const latest = await readSettlementStore(storePath).catch(() => ({ settlements: {} }));
      res.status(Number(error?.statusCode) || 502).json({
        rewardState: publicRewardState(latest.settlements[key]),
        error: String(error?.message || error || 'MiniPin 发放失败'),
      });
    }
  });

  return router;
}

module.exports = {
  matchPendingIssueRecords,
  reconcilePendingIssue,
  classifyIssueResult,
  createSpeakingChallengeRoutes,
  hashKey,
  loadChallengeClassFromAcademicSystem,
  validateExportRoster,
  publicRewardState,
  readSettlementStore,
  settlementKey,
  studentStoreKey,
  writeSettlementStore,
};
