const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTeacherScheduleEvents,
  splitClassroom,
  summarizeTeacherSchedule,
} = require('../lib/teacherSchedule');

test('teacher schedule normalizes the official timetable fields and filters inaccessible classes', () => {
  const events = normalizeTeacherScheduleEvents([
    {
      id: 1,
      title: 'K339',
      start: '2026-08-31T18:20',
      end: '2026-08-31T19:20',
      classroom_name: 'C86-2楼-17',
      crouse_name: '主题口语课',
      teacher_name: 'Sam',
      tutor_name: 'Amber',
    },
    {
      id: 2,
      title: 'OTHER',
      start: '2026-09-01T18:20',
      end: '2026-09-01T19:20',
    },
  ], ['K339']);

  assert.deepEqual(events, [{
    id: '1',
    classCode: 'K339',
    date: '2026-08-31',
    day: '周一',
    time: '18:20',
    endTime: '19:20',
    campus: 'C86',
    room: '2楼-17',
    classroomName: 'C86-2楼-17',
    courseName: '主题口语课',
    teacherName: 'Sam',
    tutorName: 'Amber',
    source: 'official_schedule',
  }]);
});

test('teacher schedule keeps same-day consecutive classes as separate official slots', () => {
  const events = normalizeTeacherScheduleEvents([
    { title: 'J342', start: '2026-09-05T18:20', end: '2026-09-05T19:20', classroom_name: '七彩-403' },
    { title: 'J342', start: '2026-09-05T19:30', end: '2026-09-05T20:30', classroom_name: '七彩-403' },
  ]);
  const summary = summarizeTeacherSchedule(events);
  assert.equal(summary.J342.length, 2);
  assert.deepEqual(summary.J342.map((slot) => slot.time), ['18:20', '19:30']);
  assert.deepEqual(splitClassroom('七彩-403'), { campus: '七彩', room: '403' });
});
