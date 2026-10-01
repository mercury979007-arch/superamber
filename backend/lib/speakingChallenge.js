const { normalizeEnglishName, englishNameOrPlaceholder } = require('./studentNames');

const CHALLENGE_ID = '2026-autumn-opening-speaking';
const CHALLENGE_START = '2026-08-31';
const CHALLENGE_TIMEZONE = 'Asia/Shanghai';

const ENGLISH_NAME_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

const DEFAULT_REWARD_CONFIG = Object.freeze({
  basePerDay: 0.1,
  streakThreshold: 3,
  streakMultiplier: 1,
  rewardMode: 'fixed',
  thresholdBonus: 0,
  ignoreSupplementVariance: false,
});

function roundOne(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeRewardConfig(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const rewardMode = value.rewardMode === 'fixed' || value.rewardMode === 'multiplier'
    ? value.rewardMode
    // Keep old callers that only supplied a multiplier compatible while
    // making fixed amount the safe default for a new configuration.
    : Number(value.streakMultiplier) > 1 ? 'multiplier' : DEFAULT_REWARD_CONFIG.rewardMode;
  return {
    basePerDay: roundOne(clamp(value.basePerDay, 0, 2, DEFAULT_REWARD_CONFIG.basePerDay)),
    streakThreshold: Math.round(clamp(
      value.streakThreshold,
      2,
      14,
      DEFAULT_REWARD_CONFIG.streakThreshold,
    )),
    streakMultiplier: roundOne(clamp(
      value.streakMultiplier,
      1,
      3,
      DEFAULT_REWARD_CONFIG.streakMultiplier,
    )),
    rewardMode,
    thresholdBonus: roundOne(clamp(
      value.thresholdBonus,
      0,
      20,
      DEFAULT_REWARD_CONFIG.thresholdBonus,
    )),
    ignoreSupplementVariance: value.ignoreSupplementVariance === true,
  };
}

function rewardConfigsEqual(left, right) {
  const a = normalizeRewardConfig(left);
  const b = normalizeRewardConfig(right);
  return a.basePerDay === b.basePerDay
    && a.streakThreshold === b.streakThreshold
    && a.streakMultiplier === b.streakMultiplier
    && a.rewardMode === b.rewardMode
    && a.thresholdBonus === b.thresholdBonus
    && a.ignoreSupplementVariance === b.ignoreSupplementVariance;
}

function formatDateInTimezone(value, timezone = CHALLENGE_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dateKeysBetween(start, end) {
  const startDate = new Date(`${start}T12:00:00+08:00`);
  const endDate = new Date(`${end}T12:00:00+08:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return [];
  }
  const result = [];
  for (const cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

function resolveChallengeWindow(now = new Date()) {
  const today = formatDateInTimezone(now);
  // 每日开口已从“两周开学挑战”成为持续使用的班级工具。统计窗口应随
  // 上海当天继续向后推进，否则第三周起接口仍会被截断在 9 月 13 日。
  const end = today < CHALLENGE_START ? CHALLENGE_START : today;
  return {
    id: CHALLENGE_ID,
    start: CHALLENGE_START,
    end,
    fullEnd: end,
    timezone: CHALLENGE_TIMEZONE,
    dates: dateKeysBetween(CHALLENGE_START, end),
    complete: false,
  };
}

function normalizeDayStatus(value) {
  const text = String(value || '').trim();
  if (!text) return 'missed';
  if (text.includes('补')) return 'supplement';
  return 'normal';
}

function summarizeStudentDays(dateValues = {}, dates = []) {
  let longestStreak = 0;
  let runningStreak = 0;
  let normalDays = 0;
  let supplementDays = 0;
  const daily = dates.map((date) => {
    const status = normalizeDayStatus(dateValues?.[date]);
    if (status === 'normal') {
      normalDays += 1;
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
      if (status === 'supplement') supplementDays += 1;
    }
    return { date, status };
  });
  return {
    daily,
    normalDays,
    supplementDays,
    totalDays: normalDays + supplementDays,
    streakDays: longestStreak,
  };
}

function rankingMetricsEqual(left, right) {
  return left.streakDays === right.streakDays
    && left.totalDays === right.totalDays
    && left.supplementDays === right.supplementDays;
}

function compareStudents(left, right) {
  return right.streakDays - left.streakDays
    || right.totalDays - left.totalDays
    || left.supplementDays - right.supplementDays
    || ENGLISH_NAME_COLLATOR.compare(left.englishName, right.englishName);
}

function buildSpeakingLeaderboard({
  classCode = '',
  squadId = '',
  roster = [],
  rows = [],
  window,
}) {
  const dates = Array.isArray(window?.dates) ? window.dates : dateKeysBetween(window?.start, window?.end);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const byNo = new Map(normalizedRows
    .map((row) => [String(row?.no || row?.student_no || '').trim(), row])
    .filter(([key]) => key));
  const byChinese = new Map(normalizedRows
    .map((row) => [String(row?.ch_name || row?.中文名 || '').trim(), row])
    .filter(([key]) => key));
  const normalizedRoster = (Array.isArray(roster) ? roster : []).map((student) => ({
    no: String(student?.no || student?.studentId || '').trim(),
    chName: String(student?.chName || student?.ch_name || '').trim(),
    enName: String(student?.enName || student?.en_name || '').trim(),
  }));
  const rosterByNo = new Map(normalizedRoster.filter((student) => student.no).map((student) => [student.no, student]));
  const rosterByChinese = new Map(normalizedRoster.filter((student) => student.chName).map((student) => [student.chName, student]));
  const rosterCandidates = normalizedRows.length
    ? normalizedRows.map((row) => {
      const rowNo = String(row?.no || row?.student_no || '').trim();
      const rowChineseName = String(row?.ch_name || row?.中文名 || '').trim();
      const matched = rosterByNo.get(rowNo) || rosterByChinese.get(rowChineseName) || {};
      return {
        no: rowNo || matched.no || '',
        chName: rowChineseName || matched.chName || '',
        enName: normalizeEnglishName(matched.enName) || normalizeEnglishName(row?.en_name || row?.enName),
      };
    })
    : normalizedRoster;
  const seenStudents = new Set();
  const sourceRoster = rosterCandidates.filter((student) => {
    const studentId = String(student?.no || student?.studentId || '').trim();
    const chineseName = String(student?.chName || student?.ch_name || '').trim();
    const key = studentId ? `id:${studentId}` : chineseName ? `name:${chineseName}` : '';
    if (!key || seenStudents.has(key)) return false;
    seenStudents.add(key);
    return true;
  });

  const students = sourceRoster.map((student, index) => {
    const studentId = String(student?.no || student?.studentId || '').trim();
    const chineseName = String(student?.chName || student?.ch_name || '').trim();
    const row = byNo.get(studentId) || byChinese.get(chineseName) || {};
    return {
      studentId,
      englishName: englishNameOrPlaceholder(student?.enName || student?.en_name, studentId, index, chineseName),
      chineseName,
      ...summarizeStudentDays(row?.date_values, dates),
    };
  }).sort(compareStudents);

  let lastRank = 0;
  students.forEach((student, index) => {
    if (index === 0 || !rankingMetricsEqual(student, students[index - 1])) {
      lastRank = index + 1;
    }
    student.rank = lastRank;
  });

  return {
    challenge: {
      id: window?.id || CHALLENGE_ID,
      start: window?.start || CHALLENGE_START,
      end: window?.end || CHALLENGE_START,
      fullEnd: window?.fullEnd || window?.end || CHALLENGE_START,
      dates,
      complete: Boolean(window?.complete),
    },
    classCode: String(classCode || '').trim().toUpperCase(),
    squadId: String(squadId || '').trim(),
    totalStudents: students.length,
    activeStudents: students.filter((student) => student.totalDays > 0).length,
    threeDayStudents: students.filter((student) => student.streakDays >= 3).length,
    maxStreak: students.reduce((max, student) => Math.max(max, student.streakDays), 0),
    students,
  };
}

function applySupplementPolicy(leaderboard, ignoreSupplementVariance = false) {
  if (!ignoreSupplementVariance) return leaderboard;

  const students = (Array.isArray(leaderboard?.students) ? leaderboard.students : []).map((student) => {
    let runningStreak = 0;
    let longestStreak = 0;
    let completedDays = 0;
    const daily = (Array.isArray(student?.daily) ? student.daily : []).map((day) => {
      const completed = day?.status === 'normal' || day?.status === 'supplement';
      if (completed) {
        completedDays += 1;
        runningStreak += 1;
        longestStreak = Math.max(longestStreak, runningStreak);
      } else {
        runningStreak = 0;
      }
      return {
        ...day,
        status: day?.status === 'supplement' ? 'normal' : day?.status,
      };
    });
    return {
      ...student,
      daily,
      normalDays: completedDays,
      supplementDays: 0,
      totalDays: completedDays,
      streakDays: longestStreak,
    };
  }).sort(compareStudents);

  let lastRank = 0;
  students.forEach((student, index) => {
    if (index === 0 || !rankingMetricsEqual(student, students[index - 1])) {
      lastRank = index + 1;
    }
    student.rank = lastRank;
  });

  return {
    ...leaderboard,
    totalStudents: students.length,
    activeStudents: students.filter((student) => student.totalDays > 0).length,
    threeDayStudents: students.filter((student) => student.streakDays >= 3).length,
    maxStreak: students.reduce((max, student) => Math.max(max, student.streakDays), 0),
    students,
  };
}

function calculateCumulativeReward(student, configValue) {
  const config = normalizeRewardConfig(configValue);
  if (Array.isArray(student?.daily)) {
    return roundOne(Object.values(calculateRewardBreakdown(student, config))
      .reduce((sum, amount) => sum + amount, 0));
  }
  const multiplier = Number(student?.streakDays || 0) >= config.streakThreshold
    && config.rewardMode === 'multiplier' ? config.streakMultiplier
    : 1;
  const supplementDays = Number(student?.supplementDays || 0);
  const normalDays = Number(student?.normalDays || 0)
    + (config.ignoreSupplementVariance ? supplementDays : 0);
  const normalReward = normalDays * config.basePerDay * multiplier;
  const supplementReward = config.ignoreSupplementVariance ? 0 : supplementDays * config.basePerDay;
  const thresholdBonus = config.rewardMode === 'fixed'
    && Number(student?.streakDays || 0) >= config.streakThreshold
    ? config.thresholdBonus
    : 0;
  return roundOne(normalReward + supplementReward + thresholdBonus);
}

function calculateRewardComponents(student, configValue) {
  const config = normalizeRewardConfig(configValue);
  const daily = Array.isArray(student?.daily) ? student.daily : [];
  const baseByDate = {};
  const streakByDate = {};
  let runningStreak = 0;
  let thresholdDate = '';
  for (const day of daily) {
    const date = String(day?.date || '').trim();
    if (!date) continue;
    const countsAsNormal = day.status === 'normal'
      || (config.ignoreSupplementVariance && day.status === 'supplement');
    if (countsAsNormal) {
      runningStreak += 1;
      if (!thresholdDate && runningStreak >= config.streakThreshold) thresholdDate = date;
      baseByDate[date] = config.basePerDay;
      if (config.rewardMode === 'multiplier' && runningStreak >= config.streakThreshold) {
        const streakAmount = roundOne(config.basePerDay * (config.streakMultiplier - 1));
        if (streakAmount > 0) streakByDate[date] = streakAmount;
      }
    } else {
      runningStreak = 0;
      if (day.status === 'supplement') baseByDate[date] = config.basePerDay;
    }
  }
  if (config.rewardMode === 'fixed' && thresholdDate && config.thresholdBonus > 0) {
    streakByDate[thresholdDate] = roundOne(
      (streakByDate[thresholdDate] || 0) + config.thresholdBonus,
    );
  }
  const totalByDate = {};
  for (const date of new Set([...Object.keys(baseByDate), ...Object.keys(streakByDate)])) {
    totalByDate[date] = roundOne(
      (Number(baseByDate[date]) || 0) + (Number(streakByDate[date]) || 0),
    );
  }
  return { baseByDate, streakByDate, totalByDate };
}

function calculateRewardBreakdown(student, configValue) {
  return calculateRewardComponents(student, configValue).totalByDate;
}

module.exports = {
  CHALLENGE_ID,
  CHALLENGE_START,
  CHALLENGE_TIMEZONE,
  DEFAULT_REWARD_CONFIG,
  applySupplementPolicy,
  buildSpeakingLeaderboard,
  calculateCumulativeReward,
  calculateRewardBreakdown,
  calculateRewardComponents,
  compareStudents,
  dateKeysBetween,
  englishNameOrPlaceholder,
  formatDateInTimezone,
  normalizeDayStatus,
  normalizeRewardConfig,
  resolveChallengeWindow,
  rewardConfigsEqual,
  roundOne,
  summarizeStudentDays,
};
