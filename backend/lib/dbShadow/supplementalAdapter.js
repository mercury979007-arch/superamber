const { dateKeysBetween } = require('../speakingChallenge');

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function addOneDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('每日打卡结束日期无效');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function buildRosterPayload(rows, { classCode = '', squadId = 0 } = {}) {
  return {
    classCode: String(classCode || '').trim().toUpperCase(),
    squadId: Number(squadId) || 0,
    students: (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row?.studentId) || 0,
      no: String(row?.studentNo || '').trim(),
      chName: String(row?.studentChName || '').trim(),
      enName: String(row?.studentEnName || '').trim(),
    })),
  };
}

function buildCheckinPayload(rosterRows, attendanceRows, {
  classCode = '',
  squadId = 0,
  rangeStart,
  rangeEnd,
  supplementMode = 'database',
} = {}) {
  const dates = dateKeysBetween(rangeStart, rangeEnd);
  if (dates.length === 0) throw new Error('每日打卡时间范围无效');
  const byStudentDate = new Map((Array.isArray(attendanceRows) ? attendanceRows : []).map((row) => [
    `${Number(row?.studentId)}:${normalizeDate(row?.date)}`,
    row,
  ]));
  const rows = (Array.isArray(rosterRows) ? rosterRows : []).map((student) => {
    const dateValues = {};
    let total = 0;
    let supplement = 0;
    for (const date of dates) {
      const record = byStudentDate.get(`${Number(student?.studentId)}:${date}`);
      const completed = Boolean(record?.completed);
      // The existing teacher export writes the same per-day value (`1`) for
      // normal and supplemental submissions. Keep that behaviour available so
      // a source migration cannot silently change speaking ranks or rewards.
      // The richer database classification can be enabled as a separate,
      // explicitly accepted product change later.
      const supplemented = supplementMode === 'database'
        && completed
        && Boolean(record?.hasSupplement);
      dateValues[date] = completed ? (supplemented ? '补' : '√') : '';
      if (completed) total += 1;
      if (supplemented) supplement += 1;
    }
    return {
      id: Number(student?.studentId) || 0,
      no: String(student?.studentNo || '').trim(),
      ch_name: String(student?.studentChName || '').trim(),
      en_name: String(student?.studentEnName || '').trim(),
      all_check_days: total,
      normal_record_total: Math.max(0, total - supplement),
      supplement_times: supplement,
      date_values: dateValues,
      range_start: rangeStart,
      range_end: rangeEnd,
    };
  });
  return {
    classCode: String(classCode || '').trim().toUpperCase(),
    squadId: Number(squadId) || 0,
    termId: 'database',
    termName: 'daily_attendance_records',
    supplementMode,
    rows,
  };
}

function normalizedStudentMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const no = String(row?.no || row?.studentNo || row?.student_no || '').trim();
    const id = Number(row?.id || row?.studentId) || 0;
    const key = no ? `no:${no}` : id ? `id:${id}` : '';
    if (key) map.set(key, row);
  }
  return map;
}

function compareRosters(databaseValue, legacyValue) {
  const databaseRows = databaseValue?.students || [];
  const legacyRows = legacyValue?.students || [];
  const db = normalizedStudentMap(databaseRows);
  const legacy = normalizedStudentMap(legacyRows);
  let matched = 0;
  let valueDifferenceCount = 0;
  for (const [key, row] of db) {
    const expected = legacy.get(key);
    if (!expected) continue;
    matched += 1;
    if (String(row.chName || '').trim() !== String(expected.chName || '').trim()) valueDifferenceCount += 1;
    if (String(row.enName || '').trim() !== String(expected.enName || '').trim()) valueDifferenceCount += 1;
  }
  return {
    passed: valueDifferenceCount === 0 && matched === db.size && matched === legacy.size,
    calculationsPassed: valueDifferenceCount === 0,
    comparedFields: matched * 2,
    valueDifferenceCount,
    identity: {
      databaseStudentCount: db.size,
      teacherStudentCount: legacy.size,
      matchedStudentCount: matched,
      databaseOnlyStudentCount: db.size - matched,
      teacherOnlyStudentCount: legacy.size - matched,
    },
  };
}

function compareCheckinRows(databaseValue, legacyValue) {
  const db = normalizedStudentMap(databaseValue?.rows || []);
  const legacy = normalizedStudentMap(legacyValue?.rows || []);
  let matched = 0;
  let comparedFields = 0;
  let valueDifferenceCount = 0;
  for (const [key, row] of db) {
    const expected = legacy.get(key);
    if (!expected) continue;
    matched += 1;
    for (const field of ['all_check_days', 'normal_record_total', 'supplement_times']) {
      comparedFields += 1;
      if (Number(row?.[field] || 0) !== Number(expected?.[field] || 0)) valueDifferenceCount += 1;
    }
    const dates = new Set([
      ...Object.keys(row?.date_values || {}),
      ...Object.keys(expected?.date_values || {}),
    ]);
    for (const date of dates) {
      comparedFields += 1;
      if (String(row?.date_values?.[date] || '') !== String(expected?.date_values?.[date] || '')) {
        valueDifferenceCount += 1;
      }
    }
  }
  return {
    passed: valueDifferenceCount === 0 && matched === db.size && matched === legacy.size,
    calculationsPassed: valueDifferenceCount === 0,
    comparedFields,
    valueDifferenceCount,
    identity: {
      databaseStudentCount: db.size,
      teacherStudentCount: legacy.size,
      matchedStudentCount: matched,
      databaseOnlyStudentCount: db.size - matched,
      teacherOnlyStudentCount: legacy.size - matched,
    },
  };
}

function compareLeaderboards(databaseValue, legacyValue) {
  const toComparable = (row) => ({
    ...row,
    no: row?.studentId || row?.studentKey || '',
  });
  const db = normalizedStudentMap((databaseValue?.students || []).map(toComparable));
  const legacy = normalizedStudentMap((legacyValue?.students || []).map(toComparable));
  let matched = 0;
  let comparedFields = 0;
  let valueDifferenceCount = 0;
  for (const [key, row] of db) {
    const expected = legacy.get(key);
    if (!expected) continue;
    matched += 1;
    for (const field of ['rank', 'normalDays', 'supplementDays', 'totalDays', 'streakDays']) {
      comparedFields += 1;
      if (Number(row?.[field] || 0) !== Number(expected?.[field] || 0)) valueDifferenceCount += 1;
    }
    const expectedDaily = new Map((expected.daily || []).map((day) => [day.date, day.status]));
    for (const day of row.daily || []) {
      comparedFields += 1;
      if (String(day.status || '') !== String(expectedDaily.get(day.date) || '')) valueDifferenceCount += 1;
    }
  }
  return {
    passed: valueDifferenceCount === 0 && matched === db.size && matched === legacy.size,
    calculationsPassed: valueDifferenceCount === 0,
    comparedFields,
    valueDifferenceCount,
    identity: {
      databaseStudentCount: db.size,
      teacherStudentCount: legacy.size,
      matchedStudentCount: matched,
      databaseOnlyStudentCount: db.size - matched,
      teacherOnlyStudentCount: legacy.size - matched,
    },
  };
}

module.exports = {
  addOneDay,
  buildCheckinPayload,
  buildRosterPayload,
  compareCheckinRows,
  compareLeaderboards,
  compareRosters,
  normalizeDate,
};
