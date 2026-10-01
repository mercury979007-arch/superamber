const { appendResultFilters, buildResultFilters, uniquePositiveIntegers } = require('./query');

async function queryIfSelected(pool, assignments, resourceTable, resourceColumn, makeQuery) {
  const filters = buildResultFilters(assignments, resourceTable, resourceColumn);
  if (filters.selected.length === 0) return [];
  const { sql, params } = makeQuery(filters);
  const [rows] = await pool.query(sql, params);
  return rows;
}

function makeFilteredQuery(prefix, filters, aliases = {}, suffix = '') {
  const params = [];
  const sql = appendResultFilters(prefix, params, filters, aliases);
  if (!sql) return { sql: 'SELECT 1 WHERE 0', params: [] };
  return { sql: `${sql}\n${suffix}`, params };
}

async function readWordResults(pool, assignments) {
  const completionPromise = queryIfSelected(pool, assignments, 'online_word_pack', 'pack_id', (filters) => (
    makeFilteredQuery(`
      SELECT task_id AS taskId, pack_id AS resourceId, student_id AS studentId,
        MAX(challenge_status = 3) AS completed,
        MAX(challenge_status) AS challengeStatus,
        MIN(challenge_start_at) AS startedAt,
        MAX(challenge_end_at) AS completedAt
      FROM stu_center.online_word_result
      WHERE`, filters, {}, 'GROUP BY task_id, pack_id, student_id')
  ));

  const repetitionPromise = queryIfSelected(pool, assignments, 'online_word_pack', 'pack_id', (filters) => {
    const base = makeFilteredQuery(`
      WITH ranked AS (
        SELECT task_id, pack_id, student_id, attr_id, is_right,
          ROW_NUMBER() OVER (
            PARTITION BY task_id, pack_id, student_id, attr_id
            ORDER BY add_at, id
          ) AS firstRank
        FROM stu_center.online_word_log
        WHERE`, filters, {}, `)
      SELECT task_id AS taskId, pack_id AS resourceId, student_id AS studentId,
        COUNT(*) AS repetitionAttempts,
        ROUND(AVG(is_right = 1) * 100, 2) AS repetitionAccuracy,
        SUM(firstRank = 1) AS repetitionItems,
        ROUND(AVG(CASE WHEN firstRank = 1 THEN is_right = 1 ELSE NULL END) * 100, 2) AS repetitionFirstAccuracy
      FROM ranked
      GROUP BY task_id, pack_id, student_id`);
    return base;
  });

  const pkPromise = queryIfSelected(pool, assignments, 'online_word_pack', 'pack_id', (filters) => {
    const params = [];
    const packIds = uniquePositiveIntegers(filters.resourceIds);
    const studentIds = uniquePositiveIntegers(filters.studentIds);
    params.push(...packIds, ...studentIds);
    return {
      sql: `
        SELECT pack_id AS resourceId, student_id AS studentId,
          COUNT(*) AS pkAttempts,
          MAX(current_rank = 3) AS wordKing,
          ROUND(AVG(CASE WHEN complete_status = 1 THEN score_rate ELSE NULL END), 2) AS pkAccuracy
        FROM stu_center.online_word_pk_record
        WHERE pack_id IN (${packIds.map(() => '?').join(',')})
          AND student_id IN (${studentIds.map(() => '?').join(',')})
        GROUP BY pack_id, student_id
      `,
      params,
    };
  });

  const [completion, repetition, pk] = await Promise.all([
    completionPromise,
    repetitionPromise,
    pkPromise,
  ]);
  return { completion, repetition, pk };
}

async function readVoiceResults(pool, assignments) {
  const basePromise = queryIfSelected(pool, assignments, 'online_voice', 'voice_id', (filters) => (
    makeFilteredQuery(`
      SELECT task_id AS taskId, voice_id AS resourceId, student_id AS studentId,
        MAX(status = 3) AS completed,
        MAX(status) AS status,
        MAX(done_count) AS doneCount,
        MIN(start_at) AS startedAt,
        MAX(end_at) AS completedAt
      FROM stu_center.online_voice_result
      WHERE`, filters, {}, 'GROUP BY task_id, voice_id, student_id')
  ));

  const historyPromise = queryIfSelected(pool, assignments, 'online_voice', 'voice_id', (filters) => (
    makeFilteredQuery(`
      SELECT result.task_id AS taskId, result.voice_id AS resourceId, result.student_id AS studentId,
        COUNT(history.id) AS historyRows,
        COUNT(history.total_score) AS voiceCount,
        ROUND(AVG(CASE WHEN history.id IS NULL THEN NULL ELSE COALESCE(history.total_score, 0) END) * 100, 2) AS averageScore,
        ROUND(MAX(history.total_score) * 100, 2) AS highestScore
      FROM stu_center.online_voice_result AS result
      LEFT JOIN stu_center.online_voice_history AS history
        ON history.result_id = result.id
      WHERE`, filters, {
      task: 'result.task_id',
      resource: 'result.voice_id',
      student: 'result.student_id',
    }, 'GROUP BY result.task_id, result.voice_id, result.student_id')
  ));

  const firstPromise = queryIfSelected(pool, assignments, 'online_voice', 'voice_id', (filters) => {
    const base = makeFilteredQuery(`
      WITH ranked AS (
        SELECT result.task_id, result.voice_id, result.student_id, history.total_score,
          ROW_NUMBER() OVER (
            PARTITION BY result.task_id, result.voice_id, result.student_id
            ORDER BY COALESCE(history.end_at, history.start_at), history.id
          ) AS scoreRank
        FROM stu_center.online_voice_result AS result
        JOIN stu_center.online_voice_history AS history
          ON history.result_id = result.id
         AND history.total_score IS NOT NULL
        WHERE`, filters, {
      task: 'result.task_id',
      resource: 'result.voice_id',
      student: 'result.student_id',
    }, `)
      SELECT task_id AS taskId, voice_id AS resourceId, student_id AS studentId,
        ROUND(total_score * 100, 2) AS firstScore
      FROM ranked
      WHERE scoreRank = 1`);
    return base;
  });

  const dimensionsPromise = queryIfSelected(pool, assignments, 'online_voice', 'voice_id', (filters) => (
    makeFilteredQuery(`
      SELECT result.task_id AS taskId, result.voice_id AS resourceId, result.student_id AS studentId,
        COUNT(record.id) AS dimensionSamples,
        ROUND(AVG(record.accuracy_score), 4) AS averageAccuracy,
        ROUND(AVG(record.fluency_score), 4) AS averageFluency,
        ROUND(AVG(record.standard_score), 4) AS averageStandard,
        ROUND(AVG(record.integrity_score), 4) AS averageIntegrity,
        ROUND(AVG(record.total_score), 4) AS averageDimensionTotal
      FROM stu_center.online_voice_result AS result
      JOIN stu_center.online_voice_record AS record
        ON record.result_id = result.id
       AND (record.is_exercise IS NULL OR record.is_exercise = 0)
      WHERE`, filters, {
      task: 'result.task_id',
      resource: 'result.voice_id',
      student: 'result.student_id',
    }, 'GROUP BY result.task_id, result.voice_id, result.student_id')
  ));

  const [base, history, first, dimensions] = await Promise.all([
    basePromise,
    historyPromise,
    firstPromise,
    dimensionsPromise,
  ]);
  return { base, history, first, dimensions };
}

async function readTestResults(pool, assignments) {
  return queryIfSelected(pool, assignments, 'online_test', 'test_id', (filters) => {
    const base = makeFilteredQuery(`
      WITH ranked AS (
        SELECT task_id, test_id, student_id, status, real_score, all_score,
          right_question, all_question, after_test, start_at, end_at, id,
          ROW_NUMBER() OVER (
            PARTITION BY task_id, test_id, student_id
            ORDER BY (status = 3) DESC, COALESCE(end_at, start_at) DESC, id DESC
          ) AS resultRank
        FROM stu_center.online_test_result
        WHERE`, filters, {}, `)
      SELECT task_id AS taskId, test_id AS resourceId, student_id AS studentId,
        (status = 3) AS completed, status,
        real_score AS realScore, all_score AS allScore,
        right_question AS rightQuestions, all_question AS allQuestions,
        after_test AS afterTest, start_at AS startedAt, end_at AS completedAt
      FROM ranked
      WHERE resultRank = 1`);
    return base;
  });
}

async function readAttendanceResults(pool, assignments, { from, toExclusive } = {}) {
  if (!from || !toExclusive) return [];
  const squadIds = uniquePositiveIntegers(assignments.map((row) => row.squadId));
  const studentIds = uniquePositiveIntegers(assignments.map((row) => row.studentId));
  if (squadIds.length === 0 || studentIds.length === 0) return [];
  const params = [...squadIds, ...studentIds, String(from), String(toExclusive)];
  const [rows] = await pool.query(`
    SELECT squad_id AS squadId, st_id AS studentId, date,
      MAX(status = 1) AS completed,
      COUNT(*) AS submissionCount,
      MAX(is_supplement = 1) AS hasSupplement,
      SUM(COALESCE(words, 0)) AS words,
      ROUND(AVG(wpm), 2) AS averageWpm,
      ROUND(SUM(COALESCE(duration, seconds, 0)), 2) AS durationSeconds
    FROM stu_center.daily_attendance_records
    WHERE squad_id IN (${squadIds.map(() => '?').join(',')})
      AND st_id IN (${studentIds.map(() => '?').join(',')})
      AND date >= ?
      AND date < ?
    GROUP BY squad_id, st_id, date
    ORDER BY squad_id, date, st_id
  `, params);
  return rows;
}

module.exports = {
  readAttendanceResults,
  readTestResults,
  readVoiceResults,
  readWordResults,
};
