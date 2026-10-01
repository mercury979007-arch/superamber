const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function normalizeClassCode(value) {
  return String(value || '').trim().toUpperCase();
}

function splitClassroom(value) {
  const classroomName = String(value || '').replace(/\s+/g, ' ').trim();
  if (!classroomName) return { campus: '', room: '' };
  const separatorIndex = classroomName.indexOf('-');
  if (separatorIndex <= 0) return { campus: '', room: classroomName };
  return {
    campus: classroomName.slice(0, separatorIndex).trim(),
    room: classroomName.slice(separatorIndex + 1).trim(),
  };
}

function parseLocalDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/);
  if (!match) return null;
  const date = match[1];
  const time = `${match[2].padStart(2, '0')}:${match[3]}`;
  const parsed = new Date(`${date}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return { date, time, day: DAY_LABELS[parsed.getUTCDay()] };
}

function normalizeTeacherScheduleEvents(rows = [], allowedClassCodes = []) {
  const allowed = new Set((Array.isArray(allowedClassCodes) ? allowedClassCodes : [])
    .map(normalizeClassCode)
    .filter(Boolean));

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const classCode = normalizeClassCode(row?.title || row?.squad_name);
    const start = parseLocalDateTime(row?.start || `${row?.date || ''}T${row?.start_time || ''}`);
    const end = parseLocalDateTime(row?.end || `${row?.date || ''}T${row?.end_time || ''}`);
    if (!classCode || !start || !end) return null;
    if (allowed.size > 0 && !allowed.has(classCode)) return null;
    const location = splitClassroom(row?.classroom_name);
    return {
      id: String(row?.id || '').trim(),
      classCode,
      date: start.date,
      day: start.day,
      time: start.time,
      endTime: end.time,
      campus: location.campus,
      room: location.room,
      classroomName: String(row?.classroom_name || '').trim(),
      courseName: String(row?.crouse_name || row?.course_name || '').trim(),
      teacherName: String(row?.teacher_name || '').trim(),
      tutorName: String(row?.tutor_name || '').trim(),
      source: 'official_schedule',
    };
  }).filter(Boolean).sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.time.localeCompare(right.time)
    || left.classCode.localeCompare(right.classCode)
  ));
}

function summarizeTeacherSchedule(events = []) {
  const byClass = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.classCode) continue;
    if (!byClass.has(event.classCode)) byClass.set(event.classCode, new Map());
    const key = [event.day, event.time, event.endTime, event.campus, event.room].join('|');
    const slots = byClass.get(event.classCode);
    const current = slots.get(key) || { ...event, sampleCount: 0, latestDate: '' };
    current.sampleCount += 1;
    if (!current.latestDate || event.date > current.latestDate) {
      Object.assign(current, event, { sampleCount: current.sampleCount, latestDate: event.date });
    }
    slots.set(key, current);
  }

  return Object.fromEntries([...byClass.entries()].map(([classCode, slots]) => {
    const ranked = [...slots.values()].sort((left, right) => (
      right.latestDate.localeCompare(left.latestDate)
      || right.sampleCount - left.sampleCount
      || left.day.localeCompare(right.day)
      || left.time.localeCompare(right.time)
    ));
    return [classCode, ranked];
  }));
}

module.exports = {
  normalizeTeacherScheduleEvents,
  parseLocalDateTime,
  splitClassroom,
  summarizeTeacherSchedule,
};
