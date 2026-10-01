// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { loadWelcomeTodoMeta, saveWelcomeTodoMeta } from './welcomeStorage';

afterEach(() => { vi.restoreAllMocks(); });

it('reports a failed todo save without crashing or removing previous data', () => {
  localStorage.clear();
  const old = { enabled: true, weeklyConfirmedWeek: 3, weeklyConfirmedAt: '', completedByDate: {} };
  expect(saveWelcomeTodoMeta(old)).toBe(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(saveWelcomeTodoMeta({ ...old, weeklyConfirmedWeek: 4 })).toBe(false);
  expect(loadWelcomeTodoMeta()).toEqual(old);
});
