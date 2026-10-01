import { beforeEach, expect, it, vi } from 'vitest';
import { makeClassShell } from '../seating/state';
import { saveSeatingClassData } from './seatingStorage';
import { runAcademicTermLaunch } from './academicTermLaunchService';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
it('never rotates, fetches backups, or rewrites local storage on entry, including repeated term launches', async () => {
  const config = makeClassShell();
  config.weekday.locationInfo.fullDate = '2026-08-31';
  config.weekday.groups = [['Local A', 'Local B', '', '', '', '']];
  saveSeatingClassData({ J101: config });
  localStorage.setItem('superamberAcademicTermLaunch', JSON.stringify({ termId: '2026-autumn', rotatedClassCodes: ['J101'] }));
  const before = { ...localStorage };
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  for (const date of ['2026-08-30', '2026-09-07', '2026-09-14']) {
    expect(await runAcademicTermLaunch(['J101'], new Date(date))).toMatchObject({ performed: false, shouldCelebrate: false });
    expect({ ...localStorage }).toEqual(before);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
