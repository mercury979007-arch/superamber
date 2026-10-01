const { dedupeClassMap, normalizeClassName } = require('./classMapParser');

// The upstream teaching system exposes only one primary homeroom teacher in
// /admin/my_squad. Explicit co-head assignments keep the second teacher's
// legitimate class visible without treating every historically manageable
// class as a current homeroom class.
const CO_HEAD_TEACHER_CLASSES = [
  {
    classCode: 'C²-2',
    squadId: '1731',
    usernames: ['Pan', 'shalom'],
  },
];

function normalizeUsername(value = '') {
  return String(value).trim().toLowerCase();
}

function applyCoHeadTeacherClasses(entries = [], username = '') {
  const normalizedUsername = normalizeUsername(username);
  const assignments = CO_HEAD_TEACHER_CLASSES.filter((assignment) =>
    assignment.usernames.some((candidate) => normalizeUsername(candidate) === normalizedUsername));

  if (assignments.length === 0) return entries;

  const merged = dedupeClassMap([
    ...entries,
    ...assignments.map((assignment) => ({
      classCode: assignment.classCode,
      squadId: assignment.squadId,
      relationship: 'co-head-teacher',
      sources: ['co-head-assignment'],
      type: 'offline',
    })),
  ]);

  const assignedSquadIds = new Set(assignments.map((assignment) => String(assignment.squadId)));
  return merged.map((entry) => assignedSquadIds.has(String(entry.squadId))
    ? {
        ...entry,
        classCode: normalizeClassName(entry.classCode),
        relationship: 'co-head-teacher',
        sources: Array.from(new Set([...(entry.sources || []), 'co-head-assignment'])),
      }
    : entry);
}

module.exports = {
  CO_HEAD_TEACHER_CLASSES,
  applyCoHeadTeacherClasses,
  normalizeUsername,
};
