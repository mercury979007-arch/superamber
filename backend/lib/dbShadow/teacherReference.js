function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isCompleted(value) {
  return String(value || '').trim() === '已完成';
}

function extractTeacherResult(databaseRow, teacherRow) {
  const prefix = `${databaseRow.taskId}_${databaseRow.resourceId}`;
  if (databaseRow.resourceTable === 'online_word_pack') {
    return {
      completed: isCompleted(teacherRow[`${prefix}_packAttr`]),
      wordKing: String(teacherRow[`${prefix}_packAttr_rank`] || '').trim() === '是',
      pkAttempts: parseNumber(teacherRow[`${prefix}_packAttr_pk_count`]),
      pkAccuracy: parseNumber(teacherRow[`${prefix}_packAttr_pk_ratio`]),
      repetitionFirstAccuracy: parseNumber(teacherRow[`${prefix}_packAttr_first_ratio`]),
      repetitionAccuracy: parseNumber(teacherRow[`${prefix}_packAttr_ratio`]),
    };
  }
  if (databaseRow.resourceTable === 'online_voice') {
    return {
      completed: isCompleted(teacherRow[`${prefix}_voice`]),
      averageScore: parseNumber(teacherRow[`${prefix}_voicescore`]),
      voiceCount: parseNumber(teacherRow[`${prefix}_voicecount`]),
      firstScore: parseNumber(teacherRow[`${prefix}_voicefirst`]),
      highestScore: parseNumber(teacherRow[`${prefix}_voiceheighest`]),
    };
  }
  if (databaseRow.resourceTable === 'online_test') {
    return {
      completed: isCompleted(teacherRow[`${prefix}_test`]),
      realScore: parseNumber(teacherRow[`${prefix}_testscore`]),
    };
  }
  return null;
}

function normalizeTeacherFilterPayload(payload, databaseRows) {
  const teacherRows = Array.isArray(payload?.data) ? payload.data : payload;
  if (!Array.isArray(teacherRows)) {
    throw new Error('班主任端对账文件必须是 getStudentPersonFilter 返回值或其 data 数组');
  }

  const byStudentId = new Map(teacherRows.map((row) => [Number(row.id), row]));
  const byStudentNo = new Map(teacherRows.map((row) => [String(row.no || row.student_no || ''), row]));
  const matchedTeacherRows = new Set();
  const normalizedRows = [];
  const databaseStudents = new Set();

  for (const databaseRow of databaseRows) {
    if (!databaseRow.supported || !databaseRow.result) continue;
    databaseStudents.add(Number(databaseRow.studentId));
    const teacherRow = byStudentId.get(Number(databaseRow.studentId))
      || byStudentNo.get(String(databaseRow.studentNo || ''));
    if (!teacherRow) continue;
    const result = extractTeacherResult(databaseRow, teacherRow);
    if (!result) continue;
    matchedTeacherRows.add(teacherRow);
    normalizedRows.push({ key: databaseRow.key, result });
  }

  const matchedDatabaseStudents = new Set(normalizedRows.map((row) => {
    const parts = row.key.split('_');
    return Number(parts.at(-1));
  }));
  return {
    rows: normalizedRows,
    identity: {
      databaseStudentCount: databaseStudents.size,
      teacherStudentCount: teacherRows.length,
      matchedStudentCount: matchedDatabaseStudents.size,
      assignmentOnlyStudentCount: databaseStudents.size - matchedDatabaseStudents.size,
      teacherOnlyStudentCount: teacherRows.filter((row) => !matchedTeacherRows.has(row)).length,
    },
  };
}

module.exports = {
  extractTeacherResult,
  isCompleted,
  normalizeTeacherFilterPayload,
  parseNumber,
};
