function uniquePositiveIntegers(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))];
}

async function readCurrentRosters(pool, squadIds = []) {
  const ids = uniquePositiveIntegers(squadIds);
  if (ids.length === 0) return [];
  const [rows] = await pool.query(`
    SELECT id AS studentId, squad_id AS squadId, no AS studentNo,
      ch_name AS studentChName, en_name AS studentEnName
    FROM candfedu.students
    WHERE squad_id IN (${ids.map(() => '?').join(',')})
      AND status = '1'
    ORDER BY squad_id, no, en_name, id
  `, ids);
  return rows;
}

async function readDailyAttendance(pool, {
  studentIds = [],
  from = '',
  toExclusive = '',
} = {}) {
  const ids = uniquePositiveIntegers(studentIds);
  if (ids.length === 0) return [];
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(from))
    || !/^20\d{2}-\d{2}-\d{2}$/.test(String(toExclusive))) {
    throw new Error('每日打卡数据库读取必须提供明确的日期范围');
  }
  const params = [...ids, String(from), String(toExclusive)];
  const [rows] = await pool.query(`
    SELECT MAX(squad_id) AS sourceSquadId, st_id AS studentId, date,
      MAX(status = 1) AS completed,
      COUNT(*) AS submissionCount,
      MAX(is_supplement = 1) AS hasSupplement,
      SUM(COALESCE(words, 0)) AS words,
      ROUND(AVG(wpm), 2) AS averageWpm,
      ROUND(SUM(COALESCE(duration, seconds, 0)), 2) AS durationSeconds
    FROM stu_center.daily_attendance_records
    WHERE st_id IN (${ids.map(() => '?').join(',')})
      AND date >= ?
      AND date < ?
    GROUP BY st_id, date
    ORDER BY date, st_id
  `, params);
  return rows;
}

module.exports = {
  readCurrentRosters,
  readDailyAttendance,
  uniquePositiveIntegers,
};
