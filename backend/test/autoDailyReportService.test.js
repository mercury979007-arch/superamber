const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAutoDailyReportService,
  getPreferredAcademicWindow,
} = require('../services/autoDailyReportService');

function formatDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function createService() {
  return createAutoDailyReportService({
    defaultWeek1Start: '2026-03-02',
    formatDateOnly,
  });
}

test('getPreferredAcademicWindow picks spring and autumn semesters', () => {
  assert.deepEqual(
    getPreferredAcademicWindow(new Date('2026-06-02T12:00:00Z')),
    { preferredYear: '2026', preferredSemester: '2026学年春季学期' }
  );
  assert.deepEqual(
    getPreferredAcademicWindow(new Date('2026-10-02T12:00:00Z')),
    { preferredYear: '2026', preferredSemester: '2026学年秋季学期' }
  );
});

test('buildAutoDailyReportState groups week tasks and keeps semester info', () => {
  const service = createService();
  const state = service.buildAutoDailyReportState({
    classId: 'J328',
    preferredYear: '2026',
    preferredSemester: '2026学年春季学期',
    taskInfo: {
      preferredSemester: '2026学年春季学期',
      taskGroups: [
        {
          name: 'Week 12 任务时间:2026-05-26 10:00:00',
          sourceLabel: 'Week 12 任务时间:2026-05-26 10:00:00',
          tasks: ['Task A', 'Task B'],
        },
        {
          name: 'Week 12 任务时间:2026-05-26 10:00:00',
          sourceLabel: 'Week 12 任务时间:2026-05-26 10:00:00',
          tasks: ['Task B', 'Task C'],
        },
        {
          name: 'Week 11 任务时间:2026-05-19 10:00:00',
          sourceLabel: 'Week 11 任务时间:2026-05-19 10:00:00',
          tasks: ['Task Old'],
        },
      ],
    },
  });

  assert.equal(state.classId, 'J328');
  assert.equal(state.preferredYear, '2026');
  assert.equal(state.preferredSemester, '2026学年春季学期');
  assert.deepEqual(state.weekMap.Week12, ['Task A', 'Task B', 'Task C']);
  assert.deepEqual(state.weekMap.Week11, ['Task Old']);
  assert.equal(state.weekGroups.length, 2);
});

test('buildWeekTasksPayload selects previous-week tasks and exposes addedAt', () => {
  const service = createService();
  const state = service.buildAutoDailyReportState({
    classId: 'J328',
    preferredYear: '2026',
    preferredSemester: '2026学年春季学期',
    taskInfo: {
      taskGroups: [
        {
          name: 'Week 12 任务时间:2026-05-26 10:00:00',
          sourceLabel: 'Week 12 任务时间:2026-05-26 10:00:00',
          tasks: ['Task A', 'Task B'],
        },
        {
          name: 'Week 11 任务时间:2026-05-19 10:00:00',
          sourceLabel: 'Week 11 任务时间:2026-05-19 10:00:00',
          tasks: ['Task Old'],
        },
      ],
    },
  });

  const payload = service.buildWeekTasksPayload(state, new Date('2026-06-02T12:00:00Z'));

  assert.deepEqual(payload.defaultSelectedWeekIds, ['Week12']);
  assert.deepEqual(payload.defaultCheckinRange, {
    start: '2026-05-25',
    end: '2026-05-31',
  });
  assert.deepEqual(payload.weekTasks, [
    {
      id: 'Week12',
      name: 'Week12',
      resourceCount: 2,
      addedAt: '2026-05-26',
    },
    {
      id: 'Week11',
      name: 'Week11',
      resourceCount: 1,
      addedAt: '2026-05-19',
    },
  ]);
});

test('resolveEffectiveWeekIds falls back to default selection and buildPublicitySelection dedupes tasks', () => {
  const service = createService();
  const state = service.buildAutoDailyReportState({
    classId: 'J328',
    preferredYear: '2026',
    preferredSemester: '2026学年春季学期',
    taskInfo: {
      taskGroups: [
        {
          name: 'Week 12 任务时间:2026-05-26 10:00:00',
          sourceLabel: 'Week 12 任务时间:2026-05-26 10:00:00',
          tasks: ['Task A', 'Task B'],
        },
        {
          name: 'Week 12 任务时间:2026-05-26 10:00:00',
          sourceLabel: 'Week 12 任务时间:2026-05-26 10:00:00',
          tasks: ['Task B', 'Task C'],
        },
        {
          name: 'Week 11 任务时间:2026-05-19 10:00:00',
          sourceLabel: 'Week 11 任务时间:2026-05-19 10:00:00',
          tasks: ['Task Old'],
        },
      ],
    },
  });

  const effectiveWeekIds = service.resolveEffectiveWeekIds(state, [], new Date('2026-06-02T12:00:00Z'));
  assert.deepEqual(effectiveWeekIds, ['Week12']);

  const publicitySelection = service.buildPublicitySelection(state, ['Week12', 'Week12', 'Week11']);
  assert.deepEqual(publicitySelection, {
    selectedWeekIds: ['Week12', 'Week11'],
    selectedTasks: ['Task A', 'Task B', 'Task C', 'Task Old'],
    preferredYear: '2026',
    preferredSemester: '2026学年春季学期',
  });
});
