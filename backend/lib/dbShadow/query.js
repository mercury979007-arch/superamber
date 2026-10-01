const SUPPORTED_RESOURCE_TABLES = new Set([
  'online_word_pack',
  'online_voice',
  'online_test',
]);

function uniquePositiveIntegers(values = []) {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function buildInClause(values, params) {
  const normalized = uniquePositiveIntegers(values);
  if (normalized.length === 0) return null;
  params.push(...normalized);
  return `(${normalized.map(() => '?').join(',')})`;
}

function buildScope(filters, aliases) {
  const params = [];
  const clauses = [
    'ot.status = 1',
    'ot.deleted_user IS NULL',
    'task_squad.type = 1',
  ];

  const taskIds = buildInClause(filters.taskIds, params);
  if (taskIds) clauses.push(`${aliases.task} IN ${taskIds}`);
  const squadIds = buildInClause(filters.squadIds, params);
  if (squadIds) clauses.push(`${aliases.squad} IN ${squadIds}`);

  if (filters.from) {
    clauses.push(`${aliases.startAt} >= ?`);
    params.push(String(filters.from));
  }
  if (filters.toExclusive) {
    clauses.push(`${aliases.startAt} < ?`);
    params.push(String(filters.toExclusive));
  }

  if (!taskIds && !filters.from) {
    throw new Error('影子读取必须指定 taskIds 或 from/toExclusive 时间窗，禁止无边界扫描');
  }

  return { clauses, params };
}

function buildStudentAssignmentQuery(filters = {}) {
  const { clauses, params } = buildScope(filters, {
    task: 'student_task.task_id',
    squad: 'student_task.squad_id',
    startAt: 'task_squad.start_at',
  });

  return {
    sql: `
      SELECT DISTINCT
        student_task.task_id AS taskId,
        student_task.student_id AS studentId,
        student_task.squad_id AS squadId,
        student_task.add_at AS assignedAt,
        student.no AS studentNo,
        student.en_name AS studentEnName,
        student.ch_name AS studentChName,
        squad.name AS squadName,
        section_group.name AS sectionGroupName,
        ot.name AS taskName,
        ot.show_name AS taskShowName,
        ot.lesson_name AS lessonName,
        ot.term AS term,
        ot.week AS week,
        task_squad.start_at AS taskStartAt
      FROM candfedu.online_task_student AS student_task
      JOIN candfedu.online_task AS ot
        ON ot.id = student_task.task_id
      JOIN candfedu.online_task_squad AS task_squad
        ON task_squad.task_id = student_task.task_id
       AND task_squad.squad_id = student_task.squad_id
      LEFT JOIN candfedu.students AS student
        ON student.id = student_task.student_id
      LEFT JOIN candfedu.squads AS squad
        ON squad.id = student_task.squad_id
      LEFT JOIN candfedu.class_section_groups AS section_group
        ON section_group.id = squad.\`group\`
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY task_squad.start_at, student_task.task_id, student_task.student_id
    `,
    params,
  };
}

function buildTaskResourceQuery(filters = {}) {
  const { clauses, params } = buildScope(filters, {
    task: 'ot.id',
    squad: 'task_squad.squad_id',
    startAt: 'task_squad.start_at',
  });
  clauses.push('otc.deleted_user IS NULL');
  return {
    sql: `
      SELECT DISTINCT
        ot.id AS taskId,
        resource.resource_table AS resourceTable,
        resource.resource_id AS resourceId,
        resource.resource_name AS resourceName,
        resource.resource_type AS resourceType,
        resource.must_do AS mustDo
      FROM candfedu.online_task AS ot
      JOIN candfedu.online_task_squad AS task_squad
        ON task_squad.task_id = ot.id
      JOIN candfedu.online_task_content AS otc
        ON otc.task_id = ot.id
      JOIN JSON_TABLE(
        otc.resource,
        '$[*]' COLUMNS (
          resource_id INT PATH '$.resource_id',
          resource_name VARCHAR(255) PATH '$.name',
          resource_type VARCHAR(255) PATH '$.resource_type',
          resource_table VARCHAR(255) PATH '$.resource_table',
          must_do INT PATH '$.must_do'
        )
      ) AS resource
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY ot.id, resource.resource_id
    `,
    params,
  };
}

function buildResultFilters(assignments, resourceTable, resourceColumn) {
  const selected = assignments.filter((row) => row.resourceTable === resourceTable);
  return {
    selected,
    taskIds: uniquePositiveIntegers(selected.map((row) => row.taskId)),
    resourceIds: uniquePositiveIntegers(selected.map((row) => row.resourceId)),
    studentIds: uniquePositiveIntegers(selected.map((row) => row.studentId)),
    resourceColumn,
  };
}

function appendResultFilters(sql, params, filters, aliases = {}) {
  const taskAlias = aliases.task || 'task_id';
  const resourceAlias = aliases.resource || filters.resourceColumn;
  const studentAlias = aliases.student || 'student_id';
  const taskIds = buildInClause(filters.taskIds, params);
  const resourceIds = buildInClause(filters.resourceIds, params);
  const studentIds = buildInClause(filters.studentIds, params);
  if (!taskIds || !resourceIds || !studentIds) return null;
  return `${sql}
    ${taskAlias} IN ${taskIds}
    AND ${resourceAlias} IN ${resourceIds}
    AND ${studentAlias} IN ${studentIds}`;
}

module.exports = {
  SUPPORTED_RESOURCE_TABLES,
  appendResultFilters,
  buildStudentAssignmentQuery,
  buildTaskResourceQuery,
  buildResultFilters,
  uniquePositiveIntegers,
};
