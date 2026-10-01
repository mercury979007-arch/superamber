import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  fetchClass: vi.fn(),
  createPlan: vi.fn(),
  issuePlan: vi.fn(),
  resolvePending: vi.fn(),
}));

const scheduleMocks = vi.hoisted(() => ({
  getClassDays: vi.fn(),
  getClassTimeOnDay: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  requestBlob: vi.fn(),
  deliverBlob: vi.fn(),
}));

vi.mock('../services/speakingChallengeApi', async () => {
  const actual = await vi.importActual<typeof import('../services/speakingChallengeApi')>('../services/speakingChallengeApi');
  return {
    ...actual,
    fetchSpeakingChallengeClass: apiMocks.fetchClass,
    createSpeakingRewardPlan: apiMocks.createPlan,
    issueSpeakingRewardPlan: apiMocks.issuePlan,
    resolveSpeakingPending: apiMocks.resolvePending,
  };
});

vi.mock('../utils/classSchedule', () => ({
  getClassDays: scheduleMocks.getClassDays,
  getClassTimeOnDay: scheduleMocks.getClassTimeOnDay,
}));

vi.mock('../utils/reportExportHelpers', () => ({
  requestExportImageBlob: exportMocks.requestBlob,
  deliverExportImageBlob: exportMocks.deliverBlob,
}));

import SpeakingChallengeApp from './SpeakingChallengeApp';
import type { SpeakingRewardIssueResult } from '../services/speakingChallengeApi';

let roots: Root[] = [];

function renderApp({ deferLoad = false, classes = [{ id: 'k339', name: 'K339' }] }: { deferLoad?: boolean; classes?: Array<{ id: string; name: string }> } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(
      <SpeakingChallengeApp
        classes={classes}
        teacherName="Amber"
        deferLoad={deferLoad}
      />,
    );
  });
  return container;
}

function findButton(container: ParentNode, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function findClassCard(container: ParentNode, code: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.speaking-challenge__class-card')]
    .find((item) => item.querySelector('strong')?.textContent === code);
  if (!button) throw new Error(`class card not found: ${code}`);
  return button;
}

function setReportDates(container: ParentNode, start: string, end: string) {
  flushSync(() => {
    fireEvent.change(container.querySelector('input[aria-label="开始日期"]')!, { target: { value: start } });
    fireEvent.change(container.querySelector('input[aria-label="结束日期"]')!, { target: { value: end } });
  });
}

const classResult = {
  leaderboard: {
    challenge: {
      id: '2026-autumn-opening-speaking',
      start: '2026-08-31',
      end: '2026-09-02',
      fullEnd: '2026-09-13',
      dates: ['2026-08-31', '2026-09-01', '2026-09-02'],
      complete: false,
    },
    classCode: 'K339',
    totalStudents: 2,
    activeStudents: 2,
    threeDayStudents: 1,
    maxStreak: 3,
    students: [
      {
        rank: 1,
        studentKey: 'amy-key',
        englishName: 'Amy',
        chineseName: '张三',
        daily: [
          { date: '2026-08-31', status: 'normal' },
          { date: '2026-09-01', status: 'normal' },
          { date: '2026-09-02', status: 'normal' },
        ],
        normalDays: 3,
        supplementDays: 0,
        totalDays: 3,
        streakDays: 3,
      },
      {
        rank: 2,
        studentKey: 'ben-key',
        englishName: 'Ben',
        chineseName: '李四',
        daily: [
          { date: '2026-08-31', status: 'normal' },
          { date: '2026-09-01', status: 'normal' },
          { date: '2026-09-02', status: 'supplement' },
        ],
        normalDays: 2,
        supplementDays: 1,
        totalDays: 3,
        streakDays: 2,
      },
    ],
  },
  rewardState: {
    configLocked: false,
    baseConfigLocked: false,
    streakConfigLocked: false,
    config: {
      basePerDay: 0.1,
      streakThreshold: 3,
      streakMultiplier: 1,
      rewardMode: 'fixed' as const,
      thresholdBonus: 0,
      ignoreSupplementVariance: false,
    },
    issuedTotal: 0,
    issuedDates: [],
    issuedBasePerDayByDate: {},
    pending: false,
    pendingMessage: '',
  },
  updatedAt: '2026-09-02T02:00:00.000Z',
};

function rewardPlanFor(classCode = 'K339') {
  return {
    planId: 'plan-1',
    expiresAt: '2026-09-02T02:10:00.000Z',
    classCode,
    challenge: classResult.leaderboard.challenge,
    config: classResult.rewardState.config,
    configLocked: false,
    baseConfigLocked: false,
    streakConfigLocked: false,
    selection: { baseStrategy: 'unissued' as const, includeStreak: true, missedBasePerDay: 0.1 },
    selectedDates: classResult.leaderboard.challenge.dates,
    rewards: [{
      rank: 1,
      englishName: 'Amy',
      chineseName: '张三',
      streakDays: 3,
      totalDays: 3,
      supplementDays: 0,
      alreadyIssued: 0,
      cumulativeAmount: 0.5,
      standardBaseAmount: 0.3,
      repeatedBaseAmount: 0,
      unissuedBaseAmount: 0,
      streakAmount: 0.2,
      amount: 0.5,
    }],
    studentCount: 1,
    totalMP: 0.5,
    breakdown: {
      standardBase: { studentCount: 1, totalMP: 0.3 },
      repeatedBase: { studentCount: 0, totalMP: 0 },
      unissuedBase: { studentCount: 0, totalMP: 0 },
      streak: { studentCount: 1, totalMP: 0.2 },
    },
    balance: 20,
  };
}

describe('SpeakingChallengeApp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-02T04:00:00Z'));
    scheduleMocks.getClassDays.mockReset().mockImplementation((code: string) => code === 'K339' || code === 'K340'
      ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
      : []);
    scheduleMocks.getClassTimeOnDay.mockReset().mockImplementation((code: string) => code === 'K339' ? '16:30' : code === 'K340' ? '18:30' : '');
    apiMocks.fetchClass.mockReset().mockResolvedValue(classResult);
    apiMocks.createPlan.mockReset().mockResolvedValue(rewardPlanFor());
    apiMocks.issuePlan.mockReset().mockResolvedValue({
      successCount: 1,
      failedCount: 0,
      totalMP: 0.5,
      failedStudents: [],
      balanceBefore: 20,
      balanceAfter: 19.5,
      balanceVerified: true,
      rewardState: { ...classResult.rewardState, configLocked: true, baseConfigLocked: true, streakConfigLocked: true, issuedTotal: 0.5, issuedDates: classResult.leaderboard.challenge.dates },
    });
    exportMocks.requestBlob.mockReset().mockResolvedValue(new Blob(['poster'], { type: 'image/png' }));
    exportMocks.deliverBlob.mockReset().mockResolvedValue('座位表已生成，图片已复制到剪贴板，可直接粘贴发送。');
  });

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    document.body.innerHTML = '';
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows pending choices, requires verification and opens a review plan without issuing', async () => {
    const recovery = { planId: 'old-plan', startedAt: '2026-09-03T00:00:00Z', deferred: false,
      confirmedCount: 25, confirmedTotalMP: 28.8, unresolvedCount: 1, totalMP: 1.2,
      selectedDates: ['2026-08-31'], config: classResult.rewardState.config, lastError: '上游超时', checkedAt: null,
      students: [{ name: 'Ben 李四', amount: 1.2 }] };
    apiMocks.fetchClass.mockResolvedValue({ ...classResult, rewardState: { ...classResult.rewardState, pending: true, recovery } });
    apiMocks.resolvePending.mockReset().mockResolvedValue({ rewardState: { ...classResult.rewardState, pending: false, recovery: null },
      message: '可以核对补发清单', retryReady: true, config: recovery.config, selectedDates: recovery.selectedDates });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('已停止发放尝试'));
    expect(container.textContent).toContain('25 人 / 28.8 MP');
    expect(container.textContent).toContain('上游超时');
    const button = findButton(container, '生成剩余部分的补发清单');
    expect(button.disabled).toBe(true);
    flushSync(() => (container.querySelector('.speaking-pending-recovery input') as HTMLInputElement).click());
    expect(button.disabled).toBe(false);
    flushSync(() => button.click());
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalled());
    expect(apiMocks.resolvePending).toHaveBeenCalledWith('K339', 'old-plan', 'retry', true);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();
  });

  it('can defer a pending grant and continue previewing another reward without issuing', async () => {
    const recovery = { planId: 'old-plan', startedAt: '2026-09-03T00:00:00Z', deferred: false,
      confirmedCount: 0, confirmedTotalMP: 0, unresolvedCount: 1, totalMP: 0.1,
      selectedDates: ['2026-08-31'], config: classResult.rewardState.config, lastError: '', checkedAt: null,
      students: [{ name: 'Ben', amount: 0.1 }] };
    apiMocks.fetchClass.mockResolvedValue({ ...classResult, rewardState: { ...classResult.rewardState, pending: true, recovery } });
    apiMocks.resolvePending.mockReset().mockResolvedValue({ rewardState: { ...classResult.rewardState, pending: false,
      recovery: { ...recovery, deferred: true }, deferredDates: ['2026-08-31'] }, message: '旧单已暂缓', retryReady: false });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('暂缓旧单，继续其他日期'));
    flushSync(() => findButton(container, '暂缓旧单，继续其他日期').click());
    await vi.waitFor(() => expect(container.textContent).toContain('旧单已暂缓，可继续其他日期'));
    expect(container.textContent).toContain('这些日期会从新清单中排除');
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();
    expect(apiMocks.createPlan).not.toHaveBeenCalled();
  });

  it('shows the new Monday first and expands last week without changing settlement choices', async () => {
    vi.setSystemTime(new Date('2026-09-07T04:00:00Z'));
    apiMocks.fetchClass.mockResolvedValue({ ...classResult, leaderboard: { ...classResult.leaderboard,
      challenge: { ...classResult.leaderboard.challenge, dates: [...classResult.leaderboard.challenge.dates, '2026-09-07'] } } });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    const headers = () => [...container.querySelectorAll('.speaking-challenge__table thead th span')].map(e => e.textContent);
    expect(headers()).toEqual(['9/7', '9/8', '9/9', '9/10', '9/11', '9/12', '9/13']);
    const before = apiMocks.fetchClass.mock.calls.length;
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    flushSync(() => findButton(container, '展开历史日期 · 3 天').click());
    expect(headers()[0]).toBe('9/7');
    expect(headers()).toContain('8/31');
    expect(apiMocks.fetchClass.mock.calls.length).toBe(before);
    expect(container.querySelector('.speaking-challenge__scoreboard .speaking-date-history')).toBeNull();
  });

  it('generates and exports only the requested dates, recalculates ranking and preserves reward selection', async () => {
    vi.setSystemTime(new Date('2026-09-07T04:00:00Z'));
    apiMocks.fetchClass.mockResolvedValue({ ...classResult, leaderboard: { ...classResult.leaderboard,
      students: classResult.leaderboard.students.map(student => ({ ...student, daily: student.daily.map(day => ({
        ...day, status: student.englishName === 'Amy' && day.date === '2026-09-02' ? 'missed' : day.status,
        words: student.englishName === 'Amy' && day.date === '2026-09-02' ? 0 : 100,
      })) })),
    } });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const selection = () => [...container.querySelectorAll<HTMLInputElement>('.speaking-challenge__date-chips input:checked')].map(input => input.getAttribute('aria-label'));
    const before = selection();
    setReportDates(container, '2026-09-02', '2026-09-02');
    const board = container.querySelector<HTMLElement>('.speaking-challenge__scoreboard')!;
    expect(board.textContent).toContain('本周 9月7日—9月13日');
    flushSync(() => findButton(container, '按日期生成').click());
    expect(board.textContent).toContain('统计范围 9月2日—9月2日');
    expect(board.textContent).not.toContain('累计范围');
    expect([...board.querySelectorAll('thead th span')].map(cell => cell.textContent)).toEqual(['9/2']);
    expect([...board.querySelectorAll('tbody .is-name strong')].map(cell => cell.textContent)).toEqual(['Ben', 'Amy']);
    expect([...board.querySelectorAll('tbody tr:first-child td')].map(cell => cell.textContent).slice(2, 6)).toEqual(['1天', '100词', '0天', '1次']);
    expect(board.querySelector('.speaking-challenge__summary-row')?.textContent).toBe('已开口1/ 2 人连续 3 天+0人本班最高0天');
    expect(selection()).toEqual(before);
    exportMocks.requestBlob.mockImplementationOnce(async (target: HTMLElement) => {
      expect(target.textContent).toContain('统计范围 9月2日—9月2日');
      expect([...target.querySelectorAll('thead th span')].map(cell => cell.textContent)).toEqual(['9/2']);
      return new Blob(['poster'], { type: 'image/png' });
    });
    flushSync(() => findButton(container, '复制导出').click());
    await vi.waitFor(() => expect(exportMocks.deliverBlob).toHaveBeenCalledWith(expect.any(Blob), 'K339每日开口挑战榜_2026-09-02_2026-09-02'));
    expect(apiMocks.createPlan).not.toHaveBeenCalled();
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();
    flushSync(() => findButton(container, '恢复本周').click());
    expect(board.textContent).toContain('本周 9月7日—9月13日');
    expect(board.textContent).toContain('累计打卡天数');
    expect([...board.querySelectorAll('tbody .is-name strong')].map(cell => cell.textContent)).toEqual(['Amy', 'Ben']);
  });

  it('requires a valid available range and applies edited dates only after generating again', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const generate = () => findButton(container, '按日期生成');
    expect(generate().disabled).toBe(true);
    setReportDates(container, '2026-09-02', '2026-08-31');
    expect(generate().disabled).toBe(true);
    setReportDates(container, '2026-08-31', '2026-09-03');
    expect(generate().disabled).toBe(true);
    setReportDates(container, '2026-08-31', '2026-09-01');
    flushSync(() => generate().click());
    const board = container.querySelector('.speaking-challenge__scoreboard')!;
    expect(board.textContent).toContain('统计范围 8月31日—9月1日');
    expect(board.querySelector('.speaking-challenge__honor-title small')?.textContent).toBe('连续 2 天 · 共 2 天');
    setReportDates(container, '2026-09-02', '2026-09-02');
    expect(container.textContent).toContain('日期已修改，请点击「按日期生成」更新榜单。');
    expect(board.textContent).toContain('统计范围 8月31日—9月1日');
    flushSync(() => generate().click());
    expect(board.textContent).toContain('统计范围 9月2日—9月2日');
  });

  it('renders as a homepage section without an independent-page back bar', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    expect(container.querySelector('main')).toBeNull();
    expect(container.textContent).not.toContain('返回主页');
    expect(container.querySelector('#speaking-challenge-title')?.textContent).toBe('每日开口挑战榜');
    expect(container.textContent).toContain('班主任工作区');
    expect(container.textContent).toContain('查看班级每日打卡明细 · 切换班级 · 设置并发放 MiniPin 奖励');
    expect(container.textContent).toContain('学生展示榜');
  });

  it('uses one collapsed editor for dates and MiniPin, with no issuance when editing', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    expect(container.querySelector('.speaking-controls-editor')).toBeNull();
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="每个有效打卡日奖励"]');
    expect(input?.value).toBe('0.1');
    expect(container.querySelector('.speaking-controls-editor')?.textContent).toContain('日期选择');
    expect(apiMocks.createPlan).not.toHaveBeenCalled();
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();

    flushSync(() => findButton(container, '仅发连续奖励').click());
    expect(input?.value).toBe('0');
    expect(findButton(container, '恢复每日 0.1')).toBeTruthy();
    expect(container.querySelector('.speaking-controls-editor')?.textContent).toContain('日期选择');
    expect([...container.querySelectorAll<HTMLButtonElement>('.speaking-challenge__reward-mode button')]
      .map((button) => button.textContent)).toEqual(['指定数量', '奖励系数']);
    expect(findButton(container, '指定数量').classList.contains('is-active')).toBe(true);

    flushSync(() => findButton(container, '＋').click());
    expect(input?.value).toBe('0.1');
    flushSync(() => findButton(container, '完成编辑').click());
    expect(container.querySelector('.speaking-controls-editor')).toBeNull();
    expect(container.querySelector('.speaking-controls-overview')?.textContent).toContain('0.1 MP / 有效日');
    expect(apiMocks.createPlan).not.toHaveBeenCalled();
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();
  });

  it('waits until the homepage section is near the viewport before loading class data', async () => {
    let callback: IntersectionObserverCallback | null = null;
    const disconnect = vi.fn();
    const observe = vi.fn();
    class TestIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '420px 0px';
      thresholds = [0];
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);

    const container = renderApp({ deferLoad: true });
    expect(apiMocks.fetchClass).not.toHaveBeenCalled();
    expect(container.textContent).toContain('即将自动读取每日开口数据');

    const observerCallback = callback as IntersectionObserverCallback | null;
    if (!observerCallback) throw new Error('intersection observer was not created');
    flushSync(() => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await vi.waitFor(() => expect(apiMocks.fetchClass).toHaveBeenCalledWith('K339'));
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    expect(disconnect).toHaveBeenCalled();
  });

  it('shows one class leaderboard and keeps real streaks ahead of makeup days', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    expect(container.textContent).toContain('先比连续，再比完成');
    expect(container.textContent).toContain('补卡只计完成，不接续连续天数。');
    expect(container.textContent).toContain('累计范围 8月31日—9月2日');
    expect(container.textContent).not.toContain('累计范围 8月31日—9月13日');
    expect(container.textContent).toContain('数据统计截至 9月2日 10:00（北京时间）');
    const names = [...container.querySelectorAll('.speaking-challenge__table tbody .is-name')].map((cell) => cell.textContent);
    expect(names).toEqual(['Amy张三', 'Ben李四']);
    expect(container.querySelectorAll('.speaking-challenge__day.is-supplement')).toHaveLength(1);
    expect(container.querySelector('.speaking-challenge__table td.is-name')?.textContent).toContain('Amy张三');
    expect(container.querySelector('.speaking-challenge__scoreboard-stamp')).toBeNull();
    const reward = container.querySelector('.speaking-controls');
    const table = container.querySelector('.speaking-challenge__table-shell');
    expect(Boolean(reward && table && (reward.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  });

  it('lets the teacher edit only the public poster roster and copy-export the result', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    exportMocks.requestBlob.mockImplementationOnce(async (target: HTMLElement) => {
      expect(target.classList.contains('is-exporting')).toBe(true);
      return new Blob(['poster'], { type: 'image/png' });
    });

    flushSync(() => findButton(container, '编辑公示名单').click());
    const editor = document.querySelector('.speaking-challenge__poster-editor');
    expect(editor?.textContent).toContain('不会改变 MiniPin 发放对象');
    const amyInput = document.querySelector<HTMLInputElement>('input[aria-label="张三公示名"]');
    if (!amyInput) throw new Error('Amy poster input not found');
    flushSync(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(amyInput, 'Amy Zhang');
      amyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const benRow = [...document.querySelectorAll<HTMLElement>('.speaking-challenge__poster-editor-row')]
      .find((row) => row.textContent?.includes('李四'));
    const removeBen = benRow?.querySelector<HTMLButtonElement>('button');
    if (!removeBen) throw new Error('Ben remove button not found');
    flushSync(() => removeBen.click());
    flushSync(() => findButton(document, '完成编辑').click());

    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__table tbody')?.textContent).toContain('Amy Zhang'));
    expect(container.querySelector('.speaking-challenge__table tbody')?.textContent).not.toContain('Ben');
    expect(container.textContent).toContain('/ 1 人');

    flushSync(() => findButton(container, '复制导出').click());
    await vi.waitFor(() => expect(exportMocks.requestBlob).toHaveBeenCalledWith(container.querySelector('.speaking-challenge__scoreboard')));
    await vi.waitFor(() => expect(exportMocks.deliverBlob).toHaveBeenCalledWith(expect.any(Blob), 'K339每日开口挑战榜'));
    await vi.waitFor(() => expect(container.textContent).toContain('挑战榜已生成，图片已复制到剪贴板'));
    expect(container.querySelector('.speaking-challenge__scoreboard')?.classList.contains('is-exporting')).toBe(false);
  });

  it('prepares every class in the background and replaces the board when another class is selected', async () => {
    apiMocks.fetchClass.mockImplementation(async (code: string) => ({
      ...classResult,
      leaderboard: { ...classResult.leaderboard, classCode: code },
    }));
    const container = renderApp({
      classes: [
        { id: 'k339', name: 'K339' },
        { id: 'k340', name: 'K340' },
        { id: 'k341', name: 'K341' },
      ],
    });
    await vi.waitFor(() => expect(apiMocks.fetchClass).toHaveBeenCalledTimes(3));
    expect(apiMocks.fetchClass).toHaveBeenCalledWith('K339');
    expect(apiMocks.fetchClass).toHaveBeenCalledWith('K340');
    expect(apiMocks.fetchClass).toHaveBeenCalledWith('K341');
    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K339'));
    expect(container.querySelectorAll('.speaking-challenge__scoreboard')).toHaveLength(1);
    expect(findClassCard(container, 'K339').getAttribute('aria-pressed')).toBe('true');
    expect(findClassCard(container, 'K340').getAttribute('aria-pressed')).toBe('false');

    flushSync(() => findClassCard(container, 'K340').click());

    await vi.waitFor(() => expect(apiMocks.fetchClass).toHaveBeenCalledWith('K340'));
    await vi.waitFor(() => expect(container.textContent).toContain('K340 每日开口挑战榜'));
    expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K340');
    expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).not.toContain('K339');
    expect(container.querySelectorAll('.speaking-challenge__scoreboard')).toHaveLength(1);
    expect(findClassCard(container, 'K339').getAttribute('aria-pressed')).toBe('false');
    expect(findClassCard(container, 'K340').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('有课 2 个班 · 当前查看 K340');
  });

  it('shows the previous class board immediately while refreshing it in the background', async () => {
    let resolveRefresh!: (result: typeof classResult) => void;
    const pendingRefresh = new Promise<typeof classResult>((resolve) => { resolveRefresh = resolve; });
    localStorage.setItem('amber_speaking_class_cache:v6:amber:K339', JSON.stringify({
      savedAt: Date.now(),
      result: classResult,
    }));
    apiMocks.fetchClass.mockImplementationOnce(() => pendingRefresh);

    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('已先显示上次榜单'));
    expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K339');
    expect(container.textContent).toContain('2/2 人 · 后台更新中');
    expect(findButton(container, '最新数据就绪后可发放').disabled).toBe(true);
    expect(findButton(container, '数据更新中').disabled).toBe(true);
    expect(exportMocks.requestBlob).not.toHaveBeenCalled();

    resolveRefresh({ ...classResult, updatedAt: '2026-09-02T02:02:00.000Z' });
    await vi.waitFor(() => expect(container.textContent).not.toContain('已先显示上次榜单'));
    expect(container.textContent).toContain('2/2 人已开口');
    expect(findButton(container, '预览并发放').disabled).toBe(false);
    expect(findButton(container, '复制导出').disabled).toBe(false);
  });

  it('discards old name-fallback cache and preserves qualified English names in range reports and export', async () => {
    const fresh = { ...classResult, leaderboard: { ...classResult.leaderboard,
      students: classResult.leaderboard.students.map((student, index) => ({ ...student, englishName: index === 0 ? 'Test A甲' : 'Test B乙' })),
    } };
    localStorage.setItem('amber_speaking_class_cache:v5:amber:K339', JSON.stringify({
      savedAt: Date.now(),
      result: { ...classResult, leaderboard: { ...classResult.leaderboard,
        students: classResult.leaderboard.students.map(student => ({ ...student, englishName: student.chineseName })),
      } },
    }));
    let finish!: (value: typeof fresh) => void;
    apiMocks.fetchClass.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const container = renderApp();
    expect(container.querySelector('.speaking-challenge__scoreboard')).toBeNull();
    finish(fresh);
    const names = () => [...container.querySelectorAll('.speaking-challenge__table tbody .is-name strong')].map(cell => cell.textContent);
    await vi.waitFor(() => expect(names()).toEqual(['Test A甲', 'Test B乙']));
    expect(JSON.parse(localStorage.getItem('amber_speaking_class_cache:v6:amber:K339')!).result.leaderboard.students[0].englishName).toBe('Test A甲');
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    setReportDates(container, '2026-08-31', '2026-09-01');
    flushSync(() => findButton(container, '按日期生成').click());
    expect(names()).toEqual(['Test A甲', 'Test B乙']);
    expect(container.querySelector('.speaking-challenge__honor-names')?.textContent).toContain('Test A甲');
    expect(container.querySelector('.speaking-challenge__honor-names')?.textContent).toContain('Test B乙');
    exportMocks.requestBlob.mockImplementationOnce(async (target: HTMLElement) => {
      expect([...target.querySelectorAll('tbody .is-name strong')].map(cell => cell.textContent)).toEqual(['Test A甲', 'Test B乙']);
      return new Blob(['poster'], { type: 'image/png' });
    });
    flushSync(() => findButton(container, '复制导出').click());
    await vi.waitFor(() => expect(exportMocks.deliverBlob).toHaveBeenCalled());
    flushSync(() => findButton(container, '恢复本周').click());
    expect(names()).toEqual(['Test A甲', 'Test B乙']);
    expect(apiMocks.createPlan).not.toHaveBeenCalled();
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();
  });

  it('blocks a live response labeled as another class and never caches it', async () => {
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      leaderboard: {
        ...classResult.leaderboard,
        classCode: 'J413',
        students: [{
          ...classResult.leaderboard.students[0],
          studentKey: 'j413-student',
          englishName: 'Wrong Class Student',
        }],
      },
    });

    const container = renderApp({ classes: [{ id: 'j328', name: 'J328' }] });
    await vi.waitFor(() => expect(container.textContent).toContain('班级数据核对失败'));
    expect(container.textContent).not.toContain('Wrong Class Student');
    expect(localStorage.getItem('amber_speaking_class_cache:v6:amber:J328')).toBeNull();
  });

  it('previews rewards only for the currently selected class', async () => {
    apiMocks.fetchClass.mockImplementation(async (code: string) => ({
      ...classResult,
      leaderboard: { ...classResult.leaderboard, classCode: code },
    }));
    apiMocks.createPlan.mockImplementationOnce(async (classCode: string) => rewardPlanFor(classCode));
    const container = renderApp({
      classes: [
        { id: 'k339', name: 'K339' },
        { id: 'k340', name: 'K340' },
      ],
    });
    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K339'));

    flushSync(() => findClassCard(container, 'K340').click());
    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K340'));
    flushSync(() => findButton(container, '预览并发放').click());

    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K340',
      classResult.rewardState.config,
      classResult.leaderboard.challenge.dates,
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('K340'));
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('K339');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('未发日期基础奖励');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('补发基础奖励');
  });

  it('drops an old reward preview if the teacher switches classes while it is loading', async () => {
    let resolvePlan!: (plan: ReturnType<typeof rewardPlanFor>) => void;
    const pendingPlan = new Promise<ReturnType<typeof rewardPlanFor>>((resolve) => { resolvePlan = resolve; });
    apiMocks.fetchClass.mockImplementation(async (code: string) => ({
      ...classResult,
      leaderboard: { ...classResult.leaderboard, classCode: code },
    }));
    apiMocks.createPlan.mockImplementationOnce(() => pendingPlan);
    const container = renderApp({
      classes: [
        { id: 'k339', name: 'K339' },
        { id: 'k340', name: 'K340' },
      ],
    });
    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K339'));

    flushSync(() => findButton(container, '预览并发放').click());
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      classResult.rewardState.config,
      classResult.leaderboard.challenge.dates,
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
    flushSync(() => findClassCard(container, 'K340').click());
    await vi.waitFor(() => expect(container.querySelector('.speaking-challenge__scoreboard h2')?.textContent).toContain('K340'));

    resolvePlan(rewardPlanFor('K339'));
    await vi.waitFor(() => expect(findButton(container, '预览并发放').textContent).toBe('预览并发放'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps every tied student in the same honor group instead of choosing three names', async () => {
    const tiedStudents = ['Amy', 'Abby', 'Ava', 'Alice'].map((englishName, index) => ({
      studentId: `student-${index + 1}`,
      rank: 1,
      englishName,
      daily: [
        { date: '2026-08-31', status: 'normal' as const },
        { date: '2026-09-01', status: 'normal' as const },
        { date: '2026-09-02', status: 'normal' as const },
      ],
      normalDays: 3,
      supplementDays: 0,
      totalDays: 3,
      streakDays: 3,
    }));
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      leaderboard: {
        ...classResult.leaderboard,
        totalStudents: tiedStudents.length,
        activeStudents: tiedStudents.length,
        threeDayStudents: tiedStudents.length,
        students: tiedStudents,
      },
    });

    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('4 人并列第 1 名'));

    const honorNames = [...container.querySelectorAll('.speaking-challenge__honor-name')]
      .map((item) => item.textContent);
    expect(honorNames).toEqual(['Abby', 'Alice', 'Amy', 'Ava']);
    expect(container.textContent).not.toContain('姓名按字母顺序排版，不代表先后');
  });

  it('only promotes the highest check-in group above the full table', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    const honorBoard = container.querySelector('.speaking-challenge__honor-board');
    expect(honorBoard?.textContent).toContain('第 1 名');
    expect(honorBoard?.textContent).toContain('Amy');
    expect(honorBoard?.textContent).not.toContain('第 2 名');
    expect(honorBoard?.textContent).not.toContain('Ben');
    expect(container.querySelector('.speaking-challenge__table tbody')?.textContent).toContain('Ben');
  });

  it('can ignore supplement variance consistently across the poster and reward preview', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="忽略补卡误差"]');
    if (!checkbox) throw new Error('supplement variance checkbox not found');
    flushSync(() => checkbox.click());

    expect(checkbox.checked).toBe(true);
    expect(container.textContent).toContain('所有有效打卡均按完成计算。');
    expect(container.textContent).toContain('补卡误差已忽略');
    expect(container.querySelectorAll('.speaking-challenge__day.is-supplement')).toHaveLength(0);
    expect(container.querySelectorAll('.speaking-challenge__day.is-normal')).toHaveLength(6);
    expect([...container.querySelectorAll('.speaking-challenge__table thead th')].map((cell) => cell.textContent)).not.toContain('补卡');
    expect(container.textContent).toContain('2 人并列第 1 名');

    flushSync(() => findButton(container, '预览并发放').click());
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      { ...classResult.rewardState.config, ignoreSupplementVariance: true },
      classResult.leaderboard.challenge.dates,
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
  });

  it('keeps issued-date handling hidden when the class has never settled any selected date', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());

    expect(container.textContent).toContain('3 天 · 按当前设置正常发放');
    expect(container.querySelector('.speaking-challenge__issue-scope')).toBeNull();
    expect(container.textContent).not.toContain('已发日期的基础奖励');
    const rewardDetails = container.querySelector('.speaking-controls-editor');
    const streakScope = container.querySelector('.speaking-challenge__streak-scope');
    expect(rewardDetails?.textContent).not.toContain('补发');
    expect(streakScope?.textContent).toContain('按奖励设置正常发放');
  });

  it('defaults to dates that have not been settled and still lets old dates remain visible', async () => {
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      rewardState: {
        ...classResult.rewardState,
        issuedDates: ['2026-08-31', '2026-09-01'],
        issuedTotal: 0.4,
      },
    });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelectorAll('.speaking-challenge__date-chips label')).toHaveLength(7);
    expect(container.querySelectorAll('.speaking-challenge__date-chips input:disabled')).toHaveLength(4);
    expect(container.querySelectorAll('.speaking-challenge__rule-card')).toHaveLength(2);
    expect(container.textContent).toContain('完成编辑');
    expect(container.textContent).toContain('当前选中的日期均未发过，可按当前设置直接发放');
    expect(container.textContent).toContain('本次规则');
    expect(container.querySelector('.speaking-challenge__issue-scope')).toBeNull();
    expect(container.textContent).not.toContain('已发日期的基础奖励');
    expect(container.querySelector('.speaking-challenge__rule-card.is-rewards .speaking-challenge__streak-scope')).not.toBeNull();

    flushSync(() => {
      findButton(container, '预览并发放').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      classResult.rewardState.config,
      ['2026-09-02'],
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
  });

  it('only expands issued-date choices when an issued date is selected and distinguishes mixed selection', async () => {
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      rewardState: {
        ...classResult.rewardState,
        baseConfigLocked: true,
        issuedDates: ['2026-08-31', '2026-09-01'],
        issuedBasePerDayByDate: { '2026-08-31': 0.2, '2026-09-01': 0.2 },
        issuedTotal: 0.4,
      },
    });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());

    const dateLabels = container.querySelectorAll<HTMLLabelElement>('.speaking-challenge__date-chips label');
    flushSync(() => dateLabels[0].click());
    expect(container.textContent).toContain('混合选择：1 天未发、1 天已发');
    expect(container.textContent).toContain('未发日期照常结算；下面只处理已发日期');

    flushSync(() => dateLabels[2].click());
    expect(container.textContent).toContain('本次只选了 1 天已发日期');
    flushSync(() => dateLabels[2].click());
    expect(container.textContent).toContain('混合选择：1 天未发、1 天已发');

    const repeatLabel = [...container.querySelectorAll<HTMLLabelElement>('.speaking-challenge__scope-options label')]
      .find((label) => label.textContent?.includes('再发一次'));
    const streakToggle = container.querySelector<HTMLInputElement>('.speaking-challenge__streak-scope input');
    if (!repeatLabel || !streakToggle) throw new Error('reward scope controls not found');
    const repeatInput = repeatLabel.querySelector<HTMLInputElement>('input');
    if (!repeatInput) throw new Error('repeat reward control not found');
    flushSync(() => repeatLabel.click());
    expect(repeatInput.checked).toBe(true);
    flushSync(() => repeatLabel.click());
    expect(repeatInput.checked).toBe(false);
    expect(container.textContent).toContain('已发日期不再发基础奖励，未发日期仍按当前设置正常发放');
    flushSync(() => {
      repeatLabel.click();
      streakToggle.click();
      findButton(container, '预览并发放').click();
    });

    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      classResult.rewardState.config,
      ['2026-08-31', '2026-09-02'],
      { baseStrategy: 'repeat', includeStreak: false, missedBasePerDay: 0.1 },
    ));
  });

  it('separates issued and fresh rates and warns when a mixed top-up changes configuration', async () => {
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      rewardState: {
        ...classResult.rewardState,
        config: { ...classResult.rewardState.config, basePerDay: 0.2 },
        issuedDates: ['2026-08-31', '2026-09-01'],
        issuedBasePerDayByDate: { '2026-08-31': 0.2, '2026-09-01': 0.2 },
        issuedTotal: 0.4,
      },
    });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const dateLabels = container.querySelectorAll<HTMLLabelElement>('.speaking-challenge__date-chips label');
    flushSync(() => dateLabels[0].click());
    expect(container.textContent).toContain('补发日期');
    expect(container.textContent).toContain('8月31日 · 原发 0.2 MP/有效日');
    expect(container.textContent).toContain('新增日期');
    expect(container.textContent).toContain('9月2日 · 正常首次发放');
    expect(container.textContent).toContain('与上次不同，请核对');
    expect(container.textContent).toContain('补卡金额不同：这些已发日期原发 0.2 MP/有效日，本次补卡 0.1 MP/有效日');

    const quickDate = container.querySelector('.speaking-challenge__quick-date strong');
    expect(quickDate?.textContent).toBe('8月31日、9月2日');
    const rateSummary = container.querySelector('.speaking-challenge__date-rate-summary');
    const rewardEditor = container.querySelector('.speaking-challenge__rule-card.is-rewards');
    expect(rateSummary).not.toBeNull();
    expect(rewardEditor?.contains(rateSummary)).toBe(true);
    expect(container.querySelector('.speaking-challenge__reward-rate-panel')).toBeNull();

    const makeupIncrease = container.querySelector<HTMLButtonElement>('button[aria-label="补卡奖励增加 0.1 MP"]');
    const makeupDecrease = container.querySelector<HTMLButtonElement>('button[aria-label="补卡奖励减少 0.1 MP"]');
    if (!makeupIncrease || !makeupDecrease) throw new Error('makeup reward stepper not found');
    flushSync(() => makeupIncrease.click());
    expect(container.textContent).not.toContain('补卡金额不同');
    flushSync(() => makeupDecrease.click());
    expect(container.textContent).toContain('本次补卡 0.1 MP/有效日');

    flushSync(() => findButton(container, '预览并发放').click());
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      { ...classResult.rewardState.config, basePerDay: 0.2 },
      ['2026-08-31', '2026-09-02'],
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
  });

  it('keeps a teacher date choice when a background refresh finishes', async () => {
    const issuedResult = {
      ...classResult,
      rewardState: {
        ...classResult.rewardState,
        baseConfigLocked: true,
        issuedDates: ['2026-08-31', '2026-09-01'],
        issuedBasePerDayByDate: { '2026-08-31': 0.1, '2026-09-01': 0.1 },
        issuedTotal: 0.4,
      },
    };
    apiMocks.fetchClass.mockResolvedValue(issuedResult);
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const firstDate = container.querySelector<HTMLInputElement>('.speaking-challenge__date-chips label input');
    if (!firstDate) throw new Error('date checkbox not found');
    flushSync(() => firstDate.click());
    expect(firstDate.checked).toBe(true);

    flushSync(() => findButton(container, '更新数据').click());
    await vi.waitFor(() => expect(apiMocks.fetchClass).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(findButton(container, '更新数据').disabled).toBe(false));
    expect(container.querySelector<HTMLInputElement>('.speaking-challenge__date-chips label input')?.checked).toBe(true);
  });

  it('keeps the daily reward adjustable after earlier dates were issued', async () => {
    apiMocks.fetchClass.mockResolvedValueOnce({
      ...classResult,
      rewardState: {
        ...classResult.rewardState,
        configLocked: true,
        baseConfigLocked: true,
        streakConfigLocked: true,
        issuedDates: ['2026-08-31', '2026-09-01'],
        issuedBasePerDayByDate: { '2026-08-31': 0.1, '2026-09-01': 0.1 },
        issuedTotal: 0.4,
      },
    });
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    expect(container.querySelector('.speaking-controls-editor')).toBeNull();
    flushSync(() => findButton(container, '编辑日期与奖励').click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="每个有效打卡日奖励"]');
    const increase = findButton(container, '＋');
    const decrease = findButton(container, '−');
    expect(input?.disabled).toBe(false);
    expect(increase.disabled).toBe(false);
    expect(decrease.disabled).toBe(false);

    flushSync(() => increase.click());
    expect(input?.value).toBe('0.2');
    expect(container.textContent).toContain('连续奖励规则已锁定，每日奖励金额仍可调整');

    flushSync(() => findButton(container, '预览并发放').click());
    await vi.waitFor(() => expect(apiMocks.createPlan).toHaveBeenCalledWith(
      'K339',
      { ...classResult.rewardState.config, basePerDay: 0.2 },
      ['2026-09-02'],
      { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: 0.1 },
    ));
  });

  it('really retries a failed class when its class card is clicked', async () => {
    apiMocks.fetchClass
      .mockRejectedValueOnce(new Error('网络暂时不可用'))
      .mockResolvedValueOnce(classResult);
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('点击后重试'));

    const classCard = container.querySelector<HTMLButtonElement>('.speaking-challenge__class-card');
    if (!classCard) throw new Error('class card not found');
    flushSync(() => classCard.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await vi.waitFor(() => expect(apiMocks.fetchClass).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
  });

  it('requires an explicit checklist confirmation before issuing MiniPin', async () => {
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    flushSync(() => {
      findButton(container, '预览并发放').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const issueButton = findButton(document, '确认发放 0.5 MP');
    expect(issueButton.disabled).toBe(true);
    expect(apiMocks.issuePlan).not.toHaveBeenCalled();

    const checkbox = document.querySelector<HTMLInputElement>('.speaking-challenge__acknowledge input[type="checkbox"]');
    if (!checkbox) throw new Error('confirmation checkbox not found');
    flushSync(() => checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(issueButton.disabled).toBe(false);
    flushSync(() => issueButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await vi.waitFor(() => expect(apiMocks.issuePlan).toHaveBeenCalledWith('plan-1'));
    await vi.waitFor(() => expect(document.querySelector('#speaking-receipt-title')?.textContent).toBe('MiniPin 发放完成'));
    const receipt = document.querySelector('.speaking-challenge__receipt');
    expect(receipt?.textContent).toContain('K339');
    expect(receipt?.textContent).toContain('已成功发放给 1 人');
    expect(receipt?.textContent).toContain('本次共发放 0.5 MP');
    expect(receipt?.textContent).toContain('20.0→19.5MP');
    expect(receipt?.textContent).toContain('发放后余额已重新核对');
  });

  it('shows a durable progress explanation while the education system is issuing rewards', async () => {
    let resolveIssue!: (result: SpeakingRewardIssueResult) => void;
    const pendingIssue = new Promise<SpeakingRewardIssueResult>((resolve) => { resolveIssue = resolve; });
    apiMocks.issuePlan.mockImplementationOnce(() => pendingIssue);
    const container = renderApp();
    await vi.waitFor(() => expect(container.textContent).toContain('Amy'));

    flushSync(() => findButton(container, '预览并发放').click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const checkbox = document.querySelector<HTMLInputElement>('.speaking-challenge__acknowledge input[type="checkbox"]');
    if (!checkbox) throw new Error('confirmation checkbox not found');
    flushSync(() => checkbox.click());
    flushSync(() => findButton(document, '确认发放 0.5 MP').click());

    await vi.waitFor(() => expect(document.querySelector('.speaking-challenge__issue-progress')?.textContent).toContain('正在向教务系统提交奖励'));
    expect(document.querySelector('.speaking-challenge__issue-progress')?.textContent).toContain('可能需要 1—2 分钟');
    expect(findButton(document, '正在发放…').disabled).toBe(true);

    resolveIssue({
      successCount: 1,
      failedCount: 0,
      totalMP: 0.5,
      failedStudents: [],
      balanceBefore: 20,
      balanceAfter: 19.5,
      balanceVerified: true,
      rewardState: { ...classResult.rewardState, configLocked: true, baseConfigLocked: true, streakConfigLocked: true, issuedTotal: 0.5, issuedDates: classResult.leaderboard.challenge.dates },
    });
    await vi.waitFor(() => expect(document.querySelector('#speaking-receipt-title')?.textContent).toBe('MiniPin 发放完成'));
  });
});
