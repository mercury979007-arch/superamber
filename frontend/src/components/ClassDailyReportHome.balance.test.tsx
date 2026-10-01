import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ClassDailyReportHome from './ClassDailyReportHome';
import { buildClassDailyReportFixture } from '../testFixtures/classDailyReport';
import { saveConfirmedClassControlSchedule } from '../services/classControlSchedule';

let root: Root | null = null;
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderHome({ before = 100 as number | null, after = 97.6 as number | null, afterThrows = false, beforeThrows = false, uncertain = false } = {}) {
  const calls: string[] = [];
  const report = buildClassDailyReportFixture();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (url.includes('/mp/balance')) {
      calls.push('balance');
      const submitted = calls.includes('submit');
      if ((!submitted && beforeThrows) || (submitted && afterThrows)) throw new Error('read timeout');
      return response({ minipin: submitted ? after : before });
    }
    if (url.includes('submit-minipin')) {
      calls.push('submit');
      return uncertain
        ? response({ code: 'TASK_REWARD_UNCERTAIN', error: '官网回包中断', failedStudentIds: ['1'], taskRewardEntryId: 'issue-1' }, 500)
        : response({ success: 1, failed: 0, failedStudentIds: [] });
    }
    if (url.includes('reward-policy')) return response({ scope: 'system', updatedAt: '', policy: {
      version: 1, report: report.detail.options, sources: { basic: true, speaking: true },
      basic: { schemeId: 'scheme2', allDoneAmount: 0.5, customName: '', customRules: [] },
      speaking: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 1, rewardMode: 'fixed', thresholdBonus: 0, ignoreSupplementVariance: false },
    } });
    if (url.includes('reward-issue-status')) return response({ status: 'success', issue: null });
    if (url.includes('task-report')) {
      const request = JSON.parse(String(init?.body || '{}'));
      return response({ status: 'success', report: { ...report, source: request.refresh ? 'live' : 'snapshot' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  saveConfirmedClassControlSchedule('J328', [{ day: '周六', time: '10:00', campus: '', room: '', source: 'manual' }], 'Preview');
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  const now = new Date('2026-09-05T02:00:00Z');
  flushSync(() => root!.render(<ClassDailyReportHome classes={[{ id: 'J328', name: 'J328', squadId: '328' }]} teacherName="Preview" now={now} onOpenDistribution={() => {}} preparedSnapshot={{ classes: [], rosters: [], failures: [], updatedAt: 'snapshot-1', totalStudents: 2, dailyReportTasks: [{ classId: 'J328', preferredSemester: '2026学年秋季学期', updatedAt: 'snapshot-1', weekTasks: [{ id: 'a', name: '第一轮', resourceCount: 1, startAt: '2026-08-29 10:00:00' }, { id: 'b', name: '第二轮', resourceCount: 1, startAt: '2026-08-29 10:00:00' }], defaultSelectedWeekIds: ['a', 'b'], defaultCheckinRange: {} }] }} />));
  const openButton = () => [...container.querySelectorAll('button')].find(b => b.textContent === '核对并发放 MiniP') as HTMLButtonElement;
  const finalButton = () => [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith('确认发放 ')) as HTMLButtonElement;
  const acknowledgment = () => container.querySelector('.class-daily-home-review-ack input') as HTMLInputElement;
  await vi.waitFor(() => expect(container.textContent).toContain('Amy'));
  const generate = container.querySelector('.class-daily-home-generate') as HTMLButtonElement;
  flushSync(() => generate.click());
  await vi.waitFor(() => expect(openButton()?.disabled).toBe(false));
  return { container, openButton, finalButton, acknowledgment, calls, fetchMock };
}

async function openReview(home: Awaited<ReturnType<typeof renderHome>>) {
  flushSync(() => home.openButton().click());
  await vi.waitFor(() => expect(home.container.querySelector('[role="dialog"]')).not.toBeNull());
  await vi.waitFor(() => expect(home.container.textContent).not.toContain('正在读取班内余额'));
}

async function acknowledgeAndIssue(home: Awaited<ReturnType<typeof renderHome>>) {
  flushSync(() => home.acknowledgment().click());
  expect(home.finalButton().disabled).toBe(false);
  flushSync(() => { home.finalButton().click(); home.finalButton().click(); });
}

it('shows a complete in-app review and requires explicit acknowledgment before one submission', async () => {
  const home = await renderHome();
  await openReview(home);
  expect(home.container.textContent).toContain('核对 MiniP 发放');
  expect(home.container.textContent).toContain('第一轮');
  expect(home.container.textContent).toContain('Amy');
  expect(home.container.textContent).toContain('当前余额');
  expect(home.finalButton().disabled).toBe(true);
  await acknowledgeAndIssue(home);
  await vi.waitFor(() => expect(home.container.textContent).toContain('100 → 97.6 MP'));
  expect(home.calls).toEqual(['balance', 'submit', 'balance']);
  expect(home.container.textContent).toContain('成功 1 人，失败 0 人');
});

it.each([{ before: 0 }, { before: null }, { beforeThrows: true }])('does not submit when preflight balance is unavailable or insufficient: %j', async options => {
  const home = await renderHome(options);
  await openReview(home);
  expect(home.finalButton().disabled).toBe(true);
  expect(home.calls).not.toContain('submit');
  expect(home.container.textContent).toMatch(/余额不足|本次尚未发放/);
});

it('returning from the review performs no write and keeps the report editable', async () => {
  const home = await renderHome();
  await openReview(home);
  const back = [...home.container.querySelectorAll('button')].find(b => b.textContent === '返回修改') as HTMLButtonElement;
  flushSync(() => back.click());
  expect(home.container.querySelector('[role="dialog"]')).toBeNull();
  expect(home.calls).toEqual(['balance']);
  expect(home.openButton().disabled).toBe(false);
});

it.each([{ after: null }, { afterThrows: true }])('retains successful receipt and never resends when final balance cannot be read: %j', async options => {
  const home = await renderHome(options);
  await openReview(home);
  await acknowledgeAndIssue(home);
  await vi.waitFor(() => expect(home.container.textContent).toContain('发放后余额暂未查询到'));
  expect(home.container.textContent).toContain('成功 1 人，失败 0 人');
  expect(home.calls.filter(c => c === 'submit')).toHaveLength(1);
  home.fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ minipin: 98 }) }));
  const retry = [...home.container.querySelectorAll('button')].find(b => b.textContent === '重新查询余额')!;
  flushSync(() => retry.click());
  await vi.waitFor(() => expect(home.container.textContent).toContain('100 → 98 MP'));
  expect(home.calls.filter(c => c === 'submit')).toHaveLength(1);
});

it('shows an uncertain receipt outside settings and requires ledger recovery instead of resending', async () => {
  const home = await renderHome({ uncertain: true });
  await openReview(home);
  await acknowledgeAndIssue(home);
  await vi.waitFor(() => expect(home.container.textContent).toContain('上一笔发放结果待核对'));
  expect(home.container.textContent).toContain('系统已停止自动重发');
  expect(home.container.textContent).toContain('重新核对官网流水');
  expect(home.container.textContent).toContain('已在官网确认未到账');
  expect((home.container.querySelector('#report-inline-settings') as HTMLElement).hidden).toBe(true);
  expect(home.openButton().disabled).toBe(true);
  expect(home.calls.filter(c => c === 'submit')).toHaveLength(1);
});
