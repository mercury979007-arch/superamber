import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useClassControlDashboard', () => ({
  useClassControlDashboard: dashboardMock,
}));

import ClassControlPanel from './ClassControlPanel';
import { saveConfirmedClassControlSchedule } from '../services/classControlSchedule';

let roots: Root[] = [];

function renderPanel(preparedSnapshot?: React.ComponentProps<typeof ClassControlPanel>['preparedSnapshot']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(<ClassControlPanel classes={[{ id: 'k339', name: 'K339' }]} teacherName="Amber" preparedSnapshot={preparedSnapshot} onOpenReport={vi.fn()} />);
  });
  return container;
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function makeTrendCycle(weekNumber: number, completionRate: number, averageAccuracy: number) {
  const ranges = [
    ['2026-07-06', '2026-07-12'],
    ['2026-07-13', '2026-07-19'],
    ['2026-07-20', '2026-07-26'],
    ['2026-07-27', '2026-08-02'],
  ];
  const [rangeStart, rangeEnd] = ranges[weekNumber - 1];
  return {
    role: 'trend' as const,
    weekNumber,
    weekLabel: `W${weekNumber}`,
    weekIds: [`w${weekNumber}`],
    rangeStart,
    rangeEnd,
    openedAt: `${rangeStart}T11:20:00.000Z`,
    openedHours: 170,
    historical: true,
    task: {
      available: true,
      completionRate,
      fullyCompletedCount: 24,
      totalStudents: 30,
      requiredTaskCount: 5,
      optionalTaskCount: 1,
      incompleteStudents: ['Amber'],
      averageAccuracy,
      accuracyStudentCount: 28,
      completionDistribution: { excellent: 24, good: 1, watch: 2, critical: 3, noData: 0, total: 30 },
      accuracyDistribution: { excellent: 12, good: 8, watch: 6, critical: 2, noData: 2, total: 30 },
      taskBreakdown: [],
      studentProfiles: [
        {
          name: 'Amber', completionRate: [85, 80, 70, 60][weekNumber - 1], completedTaskCount: 3, requiredTaskCount: 5,
          incompleteTaskCount: 2, incompleteTasks: ['Reading', 'Speaking'], averageAccuracy: [88, 82, 75, 72][weekNumber - 1], accuracyTaskCount: 4,
        },
        {
          name: 'Ben', completionRate: [60, 70, 75, 80][weekNumber - 1], completedTaskCount: 4, requiredTaskCount: 5,
          incompleteTaskCount: 1, incompleteTasks: ['Reading'], averageAccuracy: [70, 75, 82, 88][weekNumber - 1], accuracyTaskCount: 4,
        },
        {
          name: 'Cindy', completionRate: 100, completedTaskCount: 5, requiredTaskCount: 5,
          incompleteTaskCount: 0, incompleteTasks: [], averageAccuracy: 92, accuracyTaskCount: 5,
        },
      ],
    },
    speaking: null,
  };
}

describe('ClassControlPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    dashboardMock.mockReset();
    dashboardMock.mockReturnValue({
      summaries: {
        K339: {
          classId: 'K339',
          preferredSemester: '2026学年秋季学期',
          historical: false,
          review: {
            role: 'review',
            weekNumber: 1,
            weekLabel: 'W1',
            weekIds: ['w1'],
            rangeStart: '2026-08-31',
            rangeEnd: '2026-09-06',
            openedAt: '2026-08-31T11:20:00.000Z',
            openedHours: 170,
            historical: false,
            task: {
              available: true,
              completionRate: 82,
              fullyCompletedCount: 24,
              totalStudents: 30,
              requiredTaskCount: 5,
              optionalTaskCount: 1,
              incompleteStudents: ['Daniel', 'Amber', 'Cindy', 'Ben'],
              averageAccuracy: 86.4,
              accuracyStudentCount: 28,
              completionDistribution: {
                excellent: 24, good: 1, watch: 2, critical: 3, noData: 0, total: 30,
              },
              accuracyDistribution: {
                excellent: 12, good: 8, watch: 6, critical: 2, noData: 2, total: 30,
              },
              taskBreakdown: [{
                id: 'task-reading',
                title: '【必做】Reading Practice',
                completionRate: 80,
                completedCount: 24,
                totalStudents: 30,
                incompleteStudents: ['Daniel', 'Amber', 'Ben'],
                averageAccuracy: 88.2,
                accuracyStudentCount: 24,
              }],
              studentProfiles: [
                {
                  name: 'Amber', completionRate: 60, completedTaskCount: 3, requiredTaskCount: 5,
                  incompleteTaskCount: 2, incompleteTasks: ['Reading', 'Speaking'], averageAccuracy: 72, accuracyTaskCount: 4,
                },
                {
                  name: 'Ben', completionRate: 80, completedTaskCount: 4, requiredTaskCount: 5,
                  incompleteTaskCount: 1, incompleteTasks: ['Reading'], averageAccuracy: 88, accuracyTaskCount: 4,
                },
                {
                  name: 'Cindy', completionRate: 100, completedTaskCount: 5, requiredTaskCount: 5,
                  incompleteTaskCount: 0, incompleteTasks: [], averageAccuracy: 92, accuracyTaskCount: 5,
                },
              ],
            },
            speaking: {
              available: true,
              averageDays: 4.6,
              zeroStudents: ['Eric', 'Frank'],
              supplementCount: 3,
              totalStudents: 30,
            },
          },
          current: {
            role: 'current',
            weekNumber: 2,
            weekLabel: 'W2',
            weekIds: ['w2'],
            rangeStart: '2026-09-07',
            rangeEnd: '2026-09-08',
            openedAt: '2026-09-07T11:20:00.000Z',
            openedHours: 15,
            historical: false,
            task: {
              available: true,
              completionRate: 31,
              fullyCompletedCount: 4,
              totalStudents: 30,
              requiredTaskCount: 5,
              optionalTaskCount: 1,
              incompleteStudents: ['Amber'],
              averageAccuracy: 91,
              accuracyStudentCount: 4,
              completionDistribution: {
                excellent: 4, good: 0, watch: 3, critical: 23, noData: 0, total: 30,
              },
              accuracyDistribution: {
                excellent: 3, good: 1, watch: 0, critical: 0, noData: 26, total: 30,
              },
              taskBreakdown: [{
                id: 'task-speaking',
                title: '【必做】Speaking Practice',
                completionRate: 31,
                completedCount: 9,
                totalStudents: 30,
                incompleteStudents: ['Amber'],
                averageAccuracy: 91,
                accuracyStudentCount: 4,
              }],
              studentProfiles: [
                {
                  name: 'Amber', completionRate: 20, completedTaskCount: 1, requiredTaskCount: 5,
                  incompleteTaskCount: 4, incompleteTasks: ['Speaking'], averageAccuracy: 91, accuracyTaskCount: 1,
                },
              ],
            },
            speaking: {
              available: true,
              averageDays: 0.8,
              zeroStudents: ['Ben'],
              supplementCount: 0,
              totalStudents: 30,
            },
          },
          trend: [
            makeTrendCycle(1, 70, 81),
            makeTrendCycle(2, 74, 83),
            makeTrendCycle(3, 78, 84),
            makeTrendCycle(4, 82, 86.4),
          ],
          attendance: {
            available: true,
            studentProfiles: [
              { name: 'Amber', absenceCount: 1, lateCount: 0, attendanceRate: 90 },
              { name: 'Ben', absenceCount: 0, lateCount: 1, attendanceRate: 96 },
              { name: 'Cindy', absenceCount: 0, lateCount: 0, attendanceRate: 100 },
            ],
          },
          updatedAt: '2026-09-08T02:24:00.000Z',
        },
      },
      busyClasses: new Set<string>(),
      trendBusyClasses: new Set<string>(),
      attendanceBusyClasses: new Set<string>(),
      preparedTaskStates: {},
      errors: {},
      refreshingAll: false,
      updatedAt: '2026-09-08T02:24:00.000Z',
      refreshAll: vi.fn(),
      refreshOne: vi.fn(),
      loadTrend: vi.fn(),
      loadAttendance: vi.fn(),
    });
  });

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts with a teacher-friendly class overview and keeps the highest-priority class detail open', () => {
    const container = renderPanel();
    expect(container.textContent).toContain('逐班查看');
    expect(container.textContent).toContain('点击挑战名称可切换统计口径');
    expect(container.textContent).toContain('当前统计挑战 · 完成情况');
    expect(container.textContent).toContain('统计挑战W1');
    expect(container.querySelector('.class-control-portfolio-hero')).toBeNull();
    expect(container.querySelector('.class-control-portfolio-brief')).toBeNull();
    expect(container.textContent).not.toContain('今天先看');
    expect(container.textContent).not.toContain('数据透视');
    expect(container.textContent).not.toContain('正式比较');
    expect(container.textContent).not.toContain('完整周期');
    expect(container.textContent).toContain('全完成 24');
    expect(container.textContent).toContain('有欠项 4');
    expect(container.textContent).toContain('名单更新中 2');
    expect(container.textContent).toContain('90+ 12');
    expect(container.textContent).toContain('60–79 6');
    expect(container.querySelectorAll('.class-control-xray-quality-pie')).toHaveLength(1);
    expect(container.querySelectorAll('.class-control-xray-row .class-control-distribution-track')).toHaveLength(1);
    expect(container.textContent).toContain('待补上课时间');
    expect(container.textContent).toContain('4/30 人有质量记录 · 样本暂不足');
    expect(container.textContent).toContain('W1 · 上一轮回顾');
    expect(container.textContent).toContain('点击上方班级可切换');
    expect(container.querySelector('.class-control-xray-open.is-active')?.textContent).toContain('当前班级');
    expect(container.textContent).not.toContain('收起详情');
    expect(container.textContent).toContain('82%');
    expect(container.textContent).toContain('W2 · 本轮作业');
    expect(container.textContent).toContain('31%');
    expect(container.querySelectorAll('[role="progressbar"]')).not.toHaveLength(0);
  });

  it('uses the current cycle when a first-week class has no review cycle yet', () => {
    const dashboard = dashboardMock();
    const summary = dashboard.summaries.K339;
    dashboardMock.mockReturnValue({
      ...dashboard,
      summaries: { K339: { ...summary, review: null, trend: [] } },
    });

    const container = renderPanel();
    expect(container.textContent).toContain('31%');
    expect(container.textContent).toContain('W2 · 本轮数据');
    expect(container.textContent).toContain('4 / 30 人已全部完成');
    expect(container.textContent).not.toContain('暂时没有可分析的数据');
  });

  it('shows the selected challenge and lets the teacher switch it in place', async () => {
    const currentTask = dashboardMock().summaries.K339.current.task;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        report: {
          classId: 'K339',
          preferredSemester: '2026学年秋季学期',
          selectedWeekIds: ['w2'],
          selectedTasks: [],
          selectionFingerprint: 'w2',
          task: { ...currentTask, completionRate: 31 },
          detail: { options: {}, tasks: [], students: [], qualityTiers: { A: [], B: [], C: [], D: [] }, problemStudents: [] },
          speakingAvailable: false,
          snapshotUpdatedAt: '2026-09-08T02:24:00.000Z',
          updatedAt: '2026-09-08T02:24:00.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = renderPanel({
      classes: [], rosters: [], failures: [], totalStudents: 30, updatedAt: '2026-09-08T02:24:00.000Z',
      dailyReportTasks: [{
        classId: 'K339', updatedAt: '2026-09-08T02:24:00.000Z',
        weekTasks: [
          { id: 'w1', name: '第一轮挑战', resourceCount: 6, startAt: '2026-08-31 10:00:00' },
          { id: 'w2', name: '第二轮挑战', resourceCount: 5, startAt: '2026-09-07 10:00:00' },
        ],
      }],
    });
    const taskSwitch = container.querySelector('.class-control-task-switch') as HTMLButtonElement;
    expect(taskSwitch.textContent).toContain('第一轮挑战');
    flushSync(() => taskSwitch.click());
    const secondTask = [...container.querySelectorAll('.class-control-task-options button')]
      .find((button) => button.textContent?.includes('第二轮挑战')) as HTMLButtonElement;
    expect(secondTask).toBeTruthy();
    flushSync(() => secondTask.click());
    await vi.waitFor(() => expect(container.querySelector('.class-control-task-switch')?.textContent).toContain('第二轮挑战'));
    const taskRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(taskRequest.selectedWeekIds).toEqual(['w2']);
  });

  it('keeps every analysis entry clickable while the default class is still syncing', () => {
    const dashboard = dashboardMock();
    dashboardMock.mockReturnValue({
      ...dashboard,
      summaries: {},
      busyClasses: new Set(['K339']),
    });

    const container = renderPanel();
    expect(container.textContent).toContain('正在查看 K339：学生、作业和趋势');
    expect(container.textContent).toContain('正在更新班级数据');
    expect(findButton(container, '整体情况')).toBeTruthy();
    flushSync(() => {
      findButton(container, '重点学生').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('正在更新学生数据');
    flushSync(() => {
      findButton(container, '具体作业').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('正在更新作业数据');
  });

  it('treats a checked class with no current-term tasks as resolved instead of loading', () => {
    const dashboard = dashboardMock();
    dashboardMock.mockReturnValue({
      ...dashboard,
      summaries: {},
      preparedTaskStates: {
        K339: {
          state: 'ready-empty',
          taskCount: 0,
          updatedAt: '2026-09-02T06:51:00.000Z',
          error: '',
        },
      },
    });

    const container = renderPanel();
    expect(container.querySelector('.class-control-portfolio-hero')).toBeNull();
    expect(container.textContent).toContain('本学期暂未布置作业');
    expect(container.textContent).toContain('这不是加载中');
    expect(container.textContent).not.toContain('正在更新班级数据');
    expect(container.querySelector('.class-control-analysis-shell')).toBeNull();
  });

  it('does not flag a Friday class on Monday while the current cycle is still early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
    saveConfirmedClassControlSchedule('K339', [
      { day: '周五', time: '18:30', campus: 'C86', room: '301', source: 'manual' },
    ], 'Amber');

    const container = renderPanel();
    expect(container.textContent).toContain('刚开始');
    expect(container.textContent).toContain('距周五 18:30 上课还有 5 天');
    expect(container.textContent).toContain('4/30 人有质量记录 · 样本暂不足');
    expect(container.textContent).not.toContain('上课前需跟进');
  });

  it('raises a deadline warning only when the Friday class is genuinely close', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'));
    saveConfirmedClassControlSchedule('K339', [
      { day: '周五', time: '18:30', campus: 'C86', room: '301', source: 'manual' },
    ], 'Amber');

    const container = renderPanel();
    expect(container.textContent).toContain('上课前需跟进');
    expect(container.textContent).toContain('距今天 18:30 上课还有 不足 30 分钟');
  });

  it('expands exception lists in English-name order and copies the complete reminder', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const container = renderPanel();
    flushSync(() => {
      findButton(container, '查看名单 · 4人').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const names = [...document.body.querySelectorAll('.class-control-name-list span')].map((item) => item.textContent);
    expect(names).toEqual(['Amber', 'Ben', 'Cindy', 'Daniel']);
    expect(document.body.textContent).not.toMatch(/[张李王][三四五]/);
    findButton(document.body, '复制名单').click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('待完成：Amber、Ben、Cindy、Daniel');
  });

  it('shows analysis by default and separates overview, student and assignment drill-down', () => {
    const container = renderPanel();
    expect(container.textContent).not.toContain('Reading Practice');
    expect(container.textContent).toContain('进一步分析');
    expect(container.textContent).toContain('点击上方班级可切换');
    expect(container.textContent).toContain('值得关注');
    expect(container.textContent).toContain('最近四轮变化');
    expect(container.textContent).toContain('4/4 轮数据');
    expect(container.querySelectorAll('.class-control-point.is-completion')).toHaveLength(4);
    expect(container.querySelectorAll('.class-control-distribution-pie')).toHaveLength(2);
    expect(container.textContent).toContain('W1 完成情况');
    expect(container.textContent).toContain('W1 完成质量');
    flushSync(() => {
      findButton(container, '重点学生').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('学生完成与质量分布');
    expect(container.textContent).toContain('重点学生');
    expect(container.textContent).toContain('作业有欠项');
    expect(container.textContent).toContain('还差 2 项');
    expect(container.textContent).toContain('比班级均分低 14.4 个百分点');
    expect(container.textContent).toContain('缺勤 1 次');
    expect(container.textContent).toContain('状态波动');
    expect(container.textContent).toContain('持续下降');
    expect(container.textContent).toContain('明显进步');
    flushSync(() => {
      findButton(container, '具体作业').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('Reading Practice');
    expect(container.textContent).toContain('查看未完成学生 · 3人');
  });
});
