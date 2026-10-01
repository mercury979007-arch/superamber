import { buildClassDailyReportFixture } from '../testFixtures/classDailyReport';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ClassDailyReportHome from './ClassDailyReportHome';
import { saveConfirmedClassControlSchedule } from '../services/classControlSchedule';

let roots: Root[] = [];

afterEach(() => {
  roots.forEach((root) => root.unmount());
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ClassDailyReportHome', () => {
  it.each([{ days: 3, amount: 0.8 }, { days: 5, amount: 1 }, { days: 7, amount: 1.2 }])('renders $days check-in days plus all-complete bonus as $amount MP', async ({ days, amount }) => {
    let releaseInitialReport!: () => void;
    let failNextRefresh = false;
    const initialReportReady = new Promise<void>((resolve) => { releaseInitialReport = resolve; });
    saveConfirmedClassControlSchedule('J328', [
      { day: '周六', time: '10:00', campus: '', room: '', source: 'manual' },
    ], 'Amber');
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('reward-policy')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success', scope: 'teacher', updatedAt: '2026-09-05T01:00:00.000Z',
            policy: {
              version: 1,
              report: { mode: 'standard', includeSpeaking: true, minSpeakingDays: 2, testPassScore: null, aiVoicePassRate: 75 },
              sources: { basic: true, speaking: true },
              basic: { schemeId: 'scheme2', allDoneAmount: 0.5, customName: '', customRules: [] },
              speaking: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 1, rewardMode: 'fixed', thresholdBonus: 0, ignoreSupplementVariance: false },
            },
          }),
        };
      }
      if (url.includes('task-catalog')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            catalog: {
              classId: 'J328',
              preferredSemester: '2026学年秋季学期',
              updatedAt: 'snapshot-1',
              defaultSelectedWeekIds: [],
              defaultCheckinRange: {},
              weekTasks: [
                { id: 'a', name: '第一轮', resourceCount: 1, startAt: '2026-08-29 10:00:00' },
                { id: 'b', name: '第二轮', resourceCount: 1, startAt: '2026-08-29 10:00:00' },
              ],
            },
          }),
        };
      }
      const request = JSON.parse(String(init?.body || '{}'));
      if (url.includes('task-report') && !request.refresh) await initialReportReady;
      if (url.includes('task-report') && request.refresh && failNextRefresh) {
        failNextRefresh = false;
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: '上游导航超时' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
        status: 'success',
        report: buildClassDailyReportFixture(days, Boolean(JSON.parse(String(init?.body || '{}')).refresh)),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenDistribution = vi.fn();
    const onRefreshData = vi.fn();
    const onRefreshStateChange = vi.fn();
    let refreshRevision = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const referenceNow = new Date('2026-09-05T02:00:00Z');
    const renderHome = () => root.render(
      <ClassDailyReportHome
        classes={[{ id: 'J328', name: 'J328', squadId: '328' }]}
        teacherName="Amber"
        preparedSnapshot={{
          classes: [], rosters: [], failures: [], updatedAt: 'snapshot-1', totalStudents: 4,
          dailyReportTasks: [],
        }}
        onOpenDistribution={onOpenDistribution}
        onAuthenticationRequired={() => {}}
        onRefreshData={onRefreshData}
        refreshRevision={refreshRevision}
        onRefreshStateChange={onRefreshStateChange}
        now={referenceNow}
      />,
    );
    flushSync(renderHome);

    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(1));
    flushSync(renderHome);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(1);
    releaseInitialReport();
    await vi.waitFor(() => expect(container.textContent).toContain('已选 2 组 · 发放前需要确认'));
    await vi.waitFor(() => expect(container.textContent).toContain('J328 班级挑战完成日报'));
    await vi.waitFor(() => expect(container.textContent).toContain('日报已在快照基础上刷新到最新数据'));
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-catalog'))).toHaveLength(1);
    const reportRequests = fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'));
    expect(reportRequests).toHaveLength(2);
    expect(JSON.parse(String(reportRequests[0][1]?.body)).refresh).toBe(false);
    expect(JSON.parse(String(reportRequests[1][1]?.body)).refresh).toBe(true);
    expect(JSON.parse(String(reportRequests[0][1]?.body)).options).toMatchObject({
      includeSpeaking: true,
      speakingRangeStart: '2026-08-24',
      speakingRangeEnd: '2026-08-30',
    });
    const speakingStartInput = container.querySelector('input[aria-label="每日开口开始日期"]') as HTMLInputElement;
    expect(speakingStartInput.value).toBe('2026-08-24');
    expect((container.querySelector('input[aria-label="每日开口结束日期"]') as HTMLInputElement).value).toBe('2026-08-30');
    expect(container.textContent).toContain('本周至今');
    const showPicker = vi.fn();
    speakingStartInput.showPicker = showPicker;
    flushSync(() => speakingStartInput.click());
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('落实数据');
    expect(container.textContent).toContain('每日开口');
    expect(container.querySelector('input[aria-label="测试基准值"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="快捷设置全部完成奖励"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="快捷设置每日开口奖励"]')).not.toBeNull();
    expect(container.textContent).toContain('本次 MiniP 说明');
    expect(container.textContent).toContain('落实质量分析');
    expect(container.querySelector('.class-daily-home-poster')?.textContent).not.toContain('质量分层');
    expect(container.querySelector('.class-daily-home-minipin')).toBeNull();
    expect(container.textContent).toContain('收起落实明细');
    expect(container.textContent).toContain('当前规则');
    expect(container.textContent).toContain('所有基础挑战全部完成');
    expect(container.textContent).toContain('AI 语音');
    expect(container.textContent).toContain('Amy');
    expect(container.textContent).toContain('主题表达未完成；本周零开口');
    expect(container.textContent).toContain(`${amount} MP`);
    const miniCell = container.querySelector<HTMLTableCellElement>('tr[data-student-name="Amy"] td.is-minip');
    expect(miniCell?.textContent).toBe(amount.toFixed(1));
    expect(miniCell?.querySelector('small')).toBeNull();
    expect(container.querySelector('tr[data-student-name="Ben"] td.is-minip')?.textContent).toBe('0.0');
    const reportTable = container.querySelector('.class-daily-home-matrix') as HTMLTableElement;
    expect([...reportTable.tHead!.rows[0].cells].slice(0, 4).map(cell => cell.className)).toEqual(['is-student', 'is-minip', 'is-progress', 'is-metric']);
    expect(miniCell?.cellIndex).toBe(1);
    expect(container.querySelector('.report-current-task')?.textContent).toContain('第一轮、第二轮');
    expect(reportTable.querySelector('th.is-student')?.textContent).toBe('学生');
    expect(reportTable.querySelector('th.is-progress')?.textContent).toBe('完成情况');
    expect(reportTable.querySelector('th.is-metric')?.textContent).toContain('08-24—08-30');
    expect(reportTable.querySelector('td.is-student')?.textContent).toContain('Amy');
    expect(reportTable.querySelector('td.is-student')?.textContent).toContain('艾米');
    expect(reportTable.textContent).toContain('👑');
    expect(reportTable.textContent).toContain('✅');
    expect(reportTable.textContent).toContain('⭕');
    expect(reportTable.textContent).not.toContain('❌');
    expect(reportTable.textContent).not.toContain('★');

    const studentSortSelect = container.querySelector('select[aria-label="学生排序依据"]') as HTMLSelectElement;
    const setSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    flushSync(() => {
      setSelectValue?.call(studentSortSelect, 'completion');
      studentSortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(reportTable.querySelector('tbody tr')?.getAttribute('data-student-name')).toBe('Ben');
    const directionButton = container.querySelector('button[aria-label="切换排序方向"]') as HTMLButtonElement;
    expect(directionButton.textContent).toContain('低 → 高');
    flushSync(() => directionButton.click());
    expect(reportTable.querySelector('tbody tr')?.getAttribute('data-student-name')).toBe('Amy');

    const orderButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('编辑显示与发放名单')) as HTMLButtonElement;
    flushSync(() => orderButton.click());
    expect(container.querySelector('.class-daily-home-poster .report-toolbar')).toBeNull();
    expect(container.querySelector('.class-daily-home-poster .class-daily-home-column-order')).toBeNull();
    const moveTestLeftButton = container.querySelector('button[aria-label="将 Lesson 1 测试 向左移动"]') as HTMLButtonElement;
    flushSync(() => moveTestLeftButton.click());
    expect([...reportTable.querySelectorAll('th.is-task')].map((header) => header.textContent)).toEqual([
      '1Lesson 1 测试',
      '2主题表达',
    ]);
    const showTestColumn = container.querySelector('input[aria-label="显示 Lesson 1 测试"]') as HTMLInputElement;
    flushSync(() => showTestColumn.click());
    expect([...reportTable.querySelectorAll('th.is-task')].map((header) => header.textContent)).toEqual(['1主题表达']);
    flushSync(() => showTestColumn.click());
    expect(reportTable.querySelectorAll('th.is-task')).toHaveLength(2);
    const showBenRow = container.querySelector('input[aria-label="本次展示并发放给 Ben"]') as HTMLInputElement;
    flushSync(() => showBenRow.click());
    expect(reportTable.querySelector('tr[data-student-name="Ben"]')).toBeNull();
    expect(container.querySelector('.class-daily-home-report-summary')?.textContent).toContain('/ 1 人');
    flushSync(() => showBenRow.click());
    expect(reportTable.querySelector('tr[data-student-name="Ben"]')).not.toBeNull();
    let issueButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '核对并发放 MiniP') as HTMLButtonElement;
    expect(container.querySelector('.class-daily-home-flow-actions')?.textContent).toContain(`1 名学生 · 合计 ${amount} MP`);
    expect(container.querySelector('.class-daily-home-teacher-analysis .class-daily-home-teacher-reward-actions')).toBeNull();
    const confirmChallengeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '确认所选任务') as HTMLButtonElement;
    expect(confirmChallengeButton).not.toBeNull();
    flushSync(() => confirmChallengeButton.click());
    expect(issueButton.disabled).toBe(false);
    expect((container.querySelector('#report-inline-settings') as HTMLElement).hidden).toBe(true);
    expect(container.querySelectorAll('.class-daily-home-distribution-flow .class-daily-home-task-list input')).toHaveLength(2);
    const basicRuleSelect = container.querySelector('select[aria-label="基础落实奖励方式"]') as HTMLSelectElement;
    expect([...basicRuleSelect.options].map((option) => option.value)).toEqual(['scheme1', 'scheme2', 'custom']);
    flushSync(() => {
      setSelectValue?.call(basicRuleSelect, 'custom');
      basicRuleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelectorAll('.cse-rule-row.enabled')).toHaveLength(5);
    flushSync(() => {
      setSelectValue?.call(basicRuleSelect, 'scheme2');
      basicRuleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('统计与奖励逻辑');
    expect(container.textContent).toContain('设置奖励明细');
    expect(container.textContent).toContain('全屏查看日报');
    expect(container.textContent).toContain('调整显示与名单');
    expect(container.textContent).toContain('导出日报图片');
    expect(container.textContent).toContain('导出日报 Excel');
    expect([...container.querySelectorAll('.report-toolbar .class-daily-home-export-actions button')].map(button => button.textContent)).toEqual(['导出日报图片', '导出日报 Excel']);
    expect(container.querySelector('.class-daily-home-poster-divider .class-daily-home-export-actions')).toBeNull();
    const aiVoiceInput = container.querySelector('input[aria-label="AI语音基准值"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    flushSync(() => {
      setValue?.call(aiVoiceInput, '82');
      aiVoiceInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(2);
    const speakingSource = container.querySelector('input[aria-label="启用每日开口"]') as HTMLInputElement;
    expect(container.querySelectorAll('input[aria-label="启用每日开口"]')).toHaveLength(1);
    flushSync(() => speakingSource.click());
    expect(speakingSource.checked).toBe(false);
    expect(issueButton.disabled).toBe(true);
    expect(container.textContent).toContain('暂不可进入发放核对：有尚未应用的设置，请先应用并重新生成日报');
    const secondRoundInput = [...container.querySelectorAll('.class-daily-home-task-list label')]
      .find((label) => label.querySelector('strong')?.textContent === '第二轮')
      ?.querySelector('input') as HTMLInputElement;
    flushSync(() => secondRoundInput.click());
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(2);
    const refreshedSecondRoundInput = [...container.querySelectorAll('.class-daily-home-task-list label')]
      .find((label) => label.querySelector('strong')?.textContent === '第二轮')
      ?.querySelector('input') as HTMLInputElement;
    flushSync(() => refreshedSecondRoundInput.click());
    expect(container.querySelector('.report-current-task')?.textContent).toContain('第一轮、第二轮');
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(2);
    expect(container.textContent).toContain('已选择 2 组挑战；点击“应用并重新生成日报”后统一生成');
    expect(issueButton.disabled).toBe(true);
    const generateButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '应用并重新生成日报') as HTMLButtonElement;
    const scrollTargets: HTMLElement[] = [];
    const scrollToReport = vi.fn(function(this: HTMLElement) { scrollTargets.push(this); });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrollToReport, configurable: true, writable: true });
    failNextRefresh = true;
    flushSync(() => generateButton.click());
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(4));
    const generatedRequest = JSON.parse(String(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))[2][1]?.body));
    const generatedRefreshRequest = JSON.parse(String(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))[3][1]?.body));
    expect(generatedRequest.refresh).toBe(false);
    expect(generatedRefreshRequest.refresh).toBe(true);
    expect(generatedRequest.selectedWeekIds).toEqual(['a', 'b']);
    expect(generatedRefreshRequest.selectedWeekIds).toEqual(['a', 'b']);
    expect(generatedRequest.options.aiVoicePassRate).toBe(82);
    expect(generatedRequest.options.includeSpeaking).toBe(false);
    await vi.waitFor(() => expect(container.textContent).toContain('实时刷新暂未成功，继续显示已有快照：上游导航超时'));
    expect(container.textContent).toContain('J328 班级挑战完成日报');
    expect(container.querySelector('.class-daily-home-config-board.is-collapsed')).toBeNull();
    expect(container.querySelector('.class-daily-home-config-compact')).toBeNull();
    await vi.waitFor(() => expect(scrollToReport).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' }));
    expect(scrollTargets.some((target) => target.classList.contains('class-daily-home-full-report'))).toBe(true);
    await vi.waitFor(() => expect(container.querySelector('.class-daily-home-matrix th.is-metric')).toBeNull());
    await vi.waitFor(() => {
      issueButton = [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '核对并发放 MiniP') as HTMLButtonElement;
      expect(issueButton.disabled).toBe(true);
    });
    expect(container.textContent).toContain('当前仅有旧快照，实时数据确认后才能发放');
    expect(onOpenDistribution).not.toHaveBeenCalled();
    // Version checks, clipboard focus and snapshot delivery re-render Welcome.
    // New callback/prop identities must not fetch or replace the confirmed report.
    const requestCount = fetchMock.mock.calls.length;
    for (let index = 0; index < 3; index++) {
      flushSync(renderHome);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(fetchMock.mock.calls).toHaveLength(requestCount);
    expect(container.querySelector('.class-daily-home-config-board.is-collapsed')).toBeNull();
    expect(container.querySelector('.class-daily-home-matrix th.is-metric')).toBeNull();
    const retryAllButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '重新更新全部数据') as HTMLButtonElement;
    expect(retryAllButton).not.toBeNull();
    flushSync(() => retryAllButton.click());
    expect(onRefreshData).toHaveBeenCalledTimes(1);

    refreshRevision = 1;
    flushSync(renderHome);
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report'))).toHaveLength(6));
    const synchronizedRequests = fetchMock.mock.calls.filter((call) => String(call[0]).includes('task-report')).slice(-2);
    expect(synchronizedRequests.map((call) => JSON.parse(String(call[1]?.body)).refresh)).toEqual([false, true]);
    await vi.waitFor(() => expect(container.textContent).toContain('当前日报已更新到最新数据'));
    expect(onRefreshStateChange).toHaveBeenCalledWith(true, 'J328');
    expect(onRefreshStateChange).toHaveBeenLastCalledWith(false, 'J328');
  });
});
