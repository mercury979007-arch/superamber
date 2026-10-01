const { loadShadowDbConfig } = require('../dbShadow/config');

// Enrichment only: check-in status, ranks and reward calculations retain their source.
function mergeReadingWords(leaderboard, roster, records) {
  const idsByNo = new Map(roster.map(row => [String(row.studentNo), String(row.studentId)]));
  const byDay = new Map(records.map(row => [`${row.studentId}:${String(row.date).slice(0, 10)}`, row.words]));
  return { ...leaderboard, students: leaderboard.students.map(student => {
    const id = idsByNo.get(String(student.studentId));
    return { ...student, daily: student.daily.map(day => {
      const raw = id ? byDay.get(`${id}:${day.date}`) : undefined;
      const words = !id ? null : raw === undefined ? (day.status === 'missed' ? 0 : null)
        : raw === null ? null : Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
      return { ...day, words };
    }) };
  }) };
}

async function readWords(taskPool, resultPool, leaderboard) {
  const squadId = Number(leaderboard.squadId);
  if (!Number.isSafeInteger(squadId) || squadId <= 0) throw new Error('Missing verified class ID');
  const [roster] = await taskPool.query({ sql: `SELECT id AS studentId, no AS studentNo
    FROM candfedu.students WHERE squad_id = ? AND status = '1'`, timeout: 8000 }, [squadId]);
  // Intersect the authenticated board with the current database roster; never join by names.
  const allowedNos = new Set(leaderboard.students.map(student => String(student.studentId)));
  const matched = roster.filter(row => allowedNos.has(String(row.studentNo)));
  const ids = [...new Set(matched.map(row => Number(row.studentId)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { roster: matched, records: [] };
  const { start, end } = leaderboard.challenge;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Invalid date range');
  const [records] = await resultPool.query({ sql: `SELECT st_id AS studentId, date,
    CASE WHEN COUNT(words) = COUNT(*) AND MIN(words) >= 0 THEN SUM(words) ELSE NULL END AS words
    FROM stu_center.daily_attendance_records
    WHERE st_id IN (${ids.map(() => '?').join(',')}) AND date >= ? AND date <= ?
    GROUP BY st_id, date ORDER BY st_id, date`, timeout: 8000 }, [...ids, start, end]);
  return { roster: matched, records };
}

function createReadingWordsService({ env = process.env, pools = null, poolProvider = null, now = Date.now } = {}) {
  let initialization;
  let retryAfter = 0;
  const cache = new Map();
  async function getPools() {
    if (pools) return pools;
    if (poolProvider) return poolProvider();
    if (!initialization) initialization = (async () => {
      const config = await loadShadowDbConfig({ env, allowInsecure: env.SUPERAMBER_DB_ALLOW_INSECURE === '1' });
      const mysql = require('mysql2/promise');
      return { task: mysql.createPool(config.task), result: mysql.createPool(config.result) };
    })().catch(error => { initialization = null; throw error; });
    return initialization;
  }
  return {
    async enrich(leaderboard) {
      const unavailable = () => ({ ...leaderboard, students: leaderboard.students.map(student => ({
        ...student, daily: student.daily.map(day => ({ ...day, words: null })),
      })) });
      if (now() < retryAfter) return unavailable();
      const key = `${leaderboard.squadId}:${leaderboard.challenge.start}:${leaderboard.challenge.end}:${leaderboard.students.map(s => s.studentId).sort().join(',')}`;
      try {
        let entry = cache.get(key);
        if (!entry || entry.until <= now()) {
          const promise = getPools().then(db => readWords(db.task, db.result, leaderboard));
          entry = { promise, until: now() + 30000 };
          cache.set(key, entry);
          if (cache.size > 32) cache.delete(cache.keys().next().value);
        }
        const { roster, records } = await entry.promise;
        return mergeReadingWords(leaderboard, roster, records);
      } catch {
        cache.delete(key);
        retryAfter = now() + 30000;
        // No credentials, SQL or student data in public errors/logs.
        console.warn('Reading word counts unavailable; check-in board remains available.');
        return unavailable();
      }
    },
    async close() {
      if (poolProvider) return; // Provider owns the shared pool lifecycle.
      const db = pools || await initialization?.catch(() => null);
      if (db) await Promise.all([db.task.end(), db.result.end()]);
    },
  };
}
module.exports = { createReadingWordsService, mergeReadingWords, readWords };
