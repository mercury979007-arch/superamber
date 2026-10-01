import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent as domFireEvent, screen, waitFor } from '@testing-library/dom';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import DistributionFlow from './DistributionFlow';

let root: Root | null = null;
const fireEvent = {
  click: (node: Element) => flushSync(() => domFireEvent.click(node)),
  change: (node: Element, options: any) => flushSync(() => domFireEvent.change(node, options)),
};
function render(element: React.ReactNode) {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  flushSync(() => root!.render(element));
}
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mockApi({ balance = 2, fail = false } = {}) {
  const writes: any[] = [];
  let contextReads = 0;
  const fetchMock = vi.fn(async (url: any, init: any) => {
    if (url === '/api/scraper/get-student-list') return { ok: true, status: 200, json: async () => ({ data: [
      { no: '1001', chName: '安安', enName: 'Ice' }, { no: '1002', chName: '博博', enName: 'Bob' },
    ] }) };
    if (url === '/api/mp/balance') return { ok: true, status: 200, json: async () => ({ minipin: 20 }) };
    if (url === '/api/mp/recovery-context') {
      contextReads += 1;
      return { ok: true, status: 200, json: async () => ({ students: [
        { no: '1001', chName: '安安', enName: 'Ice', availableMp: balance },
        { no: '1002', chName: '博博', enName: 'Bob', availableMp: balance },
      ], tags: [{ id: '22', name: '行为习惯' }], defaultReason: '行为习惯', readAt: new Date().toISOString() }) };
    }
    if (url === '/api/scraper/recover-minipin') {
      writes.push(JSON.parse(init.body));
      return { ok: !fail, status: fail ? 502 : 200, json: async () => fail
        ? { error: '回收结果无法确认，请先核对' }
        : { status: 'success', success: 2, failed: 0, totalMP: 1, reason: '行为习惯' } };
    }
    throw new Error('unexpected request ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  return { writes, reads: () => contextReads };
}

async function prepare() {
  render(<DistributionFlow classInfo={{ id: '218', squadId: '218', name: 'K218' }} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /快捷生成/ }));
  fireEvent.click(screen.getByRole('button', { name: '回收' }));
  await waitFor(() => expect(screen.getByRole('option', { name: '行为习惯' })).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ice, Bob 0.5' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待回收名单' }));
  await waitFor(() => expect(screen.getByText('本次回收总额 1 MP')).toBeTruthy());
}

it('web recovery parses names, defaults reason, refreshes balances and submits one batch', async () => {
  const api = mockApi();
  await prepare();
  expect(screen.queryByRole('button', { name: /生成Excel/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认回收' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.reads()).toBeGreaterThanOrEqual(2);
  expect(api.writes[0].reason).toBe('行为习惯');
  expect(api.writes[0].recoveries).toEqual([{ studentId: '1001', amount: 0.5 }, { studentId: '1002', amount: 0.5 }]);
  expect(api.writes[0].requestId.length).toBeGreaterThan(15);
  await waitFor(() => expect(screen.getByText(/回收成功：2 人/)).toBeTruthy());
});

it('recovery theme and warning clear when switching back to issue', async () => {
  mockApi();
  await prepare();
  expect(document.querySelector('.flow-wrap .is-mp-recovery')).toBeTruthy();
  expect(screen.getByText(/当前为回收模式/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '发放' }));
  expect(document.querySelector('.is-mp-recovery')).toBeNull();
  expect(screen.queryByText(/当前为回收模式/)).toBeNull();
});

it('web recovery blocks insufficient balance without posting', async () => {
  const api = mockApi({ balance: 0.2 });
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '确认回收' }));
  await waitFor(() => expect(screen.getByText(/整批未提交/)).toBeTruthy());
  expect(api.writes).toHaveLength(0);
});

it('web recovery disables resubmission after an uncertain result and retains the draft', async () => {
  const api = mockApi({ fail: true });
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '确认回收' }));
  await waitFor(() => expect(screen.getByText(/此批次已停止再次提交/)).toBeTruthy());
  expect((screen.getByRole('button', { name: '确认回收' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('本次回收总额 1 MP')).toBeTruthy();
  expect(api.writes).toHaveLength(1);
});
