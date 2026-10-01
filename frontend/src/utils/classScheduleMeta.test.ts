// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveScheduleMetaForClasses } from './classScheduleMeta';

afterEach(() => { vi.restoreAllMocks(); });

it('keeps homepage schedules usable without writing or deleting data at quota', () => {
  localStorage.clear();
  localStorage.setItem('superamberClassData', '{"K218":"preserve"}');
  const before = { ...localStorage };
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const code = 'ZZ999';
  const bundled = { [code]: { classCode: code, weekday: { day: '周一', time: '18:30', campus: 'Demo', room: '101', rawCount: 1 }, updatedAt: 1 } };
  expect(saveScheduleMetaForClasses([code], bundled)).toEqual({ keptClassCount: 1, matchedClassCount: 1 });
  expect({ ...localStorage }).toEqual(before);
  expect(remove).not.toHaveBeenCalled();
});
