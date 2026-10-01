function pick(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

const TASK_FIELDS = ['taskId', 'taskName', 'taskShowName', 'lessonName', 'term', 'week'];
const RESOURCE_FIELDS = [
  'taskId', 'resourceTable', 'resourceId', 'resourceName', 'resourceType', 'mustDo', 'supported',
];
const STUDENT_FIELDS = [
  'studentId', 'studentNo', 'studentEnName', 'studentChName',
  'squadId', 'squadName', 'sectionGroupName',
];
const ASSIGNMENT_FIELDS = ['taskId', 'studentId', 'squadId', 'assignedAt', 'taskStartAt'];

function setFirst(map, key, value) {
  if (!map.has(key)) map.set(key, value);
}

function compactSnapshot(snapshot) {
  const tasks = new Map();
  const resources = new Map();
  const students = new Map();
  const assignments = new Map();
  const results = [];

  for (const row of snapshot.rows || []) {
    setFirst(tasks, Number(row.taskId), pick(row, TASK_FIELDS));
    setFirst(
      resources,
      `${row.taskId}:${row.resourceTable}:${row.resourceId}`,
      pick(row, RESOURCE_FIELDS),
    );
    setFirst(students, `${row.squadId}:${row.studentId}`, pick(row, STUDENT_FIELDS));
    setFirst(
      assignments,
      `${row.taskId}:${row.squadId}:${row.studentId}`,
      pick(row, ASSIGNMENT_FIELDS),
    );
    if (row.supported) {
      results.push({
        key: row.key,
        result: row.result,
      });
    }
  }

  const { rows, ...metadata } = snapshot;
  return {
    ...metadata,
    storageFormat: 'normalized-v1',
    catalog: {
      tasks: [...tasks.values()],
      resources: [...resources.values()],
      students: [...students.values()],
    },
    assignments: [...assignments.values()],
    results,
  };
}

function expandCompactSnapshot(snapshot) {
  if (snapshot.storageFormat !== 'normalized-v1') {
    throw new Error(`不支持的影子快照格式：${snapshot.storageFormat || 'unknown'}`);
  }
  const tasks = new Map(snapshot.catalog.tasks.map((row) => [Number(row.taskId), row]));
  const students = new Map(snapshot.catalog.students.map((row) => [
    `${row.squadId}:${row.studentId}`,
    row,
  ]));
  const resourcesByTask = new Map();
  for (const resource of snapshot.catalog.resources) {
    const bucket = resourcesByTask.get(Number(resource.taskId)) || [];
    bucket.push(resource);
    resourcesByTask.set(Number(resource.taskId), bucket);
  }
  const results = new Map(snapshot.results.map((row) => [row.key, row.result]));
  const rows = snapshot.assignments.flatMap((assignment) => (
    (resourcesByTask.get(Number(assignment.taskId)) || []).map((resource) => {
      const task = tasks.get(Number(assignment.taskId)) || {};
      const student = students.get(`${assignment.squadId}:${assignment.studentId}`) || {};
      const key = `${resource.resourceTable}_${assignment.taskId}_${resource.resourceId}_${assignment.studentId}`;
      return {
        key,
        ...assignment,
        ...student,
        ...task,
        ...resource,
        result: resource.supported ? (results.get(key) ?? null) : null,
      };
    })
  ));
  rows.sort((left, right) => (
    String(left.taskStartAt || '').localeCompare(String(right.taskStartAt || ''))
    || Number(left.taskId) - Number(right.taskId)
    || Number(left.resourceId) - Number(right.resourceId)
    || Number(left.studentId) - Number(right.studentId)
  ));
  const { storageFormat, catalog, assignments, results: ignoredResults, ...metadata } = snapshot;
  return { ...metadata, rows };
}

module.exports = { compactSnapshot, expandCompactSnapshot };
