import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClassShell } from '../seating/state';
import type { ClassConfig } from '../seating/types';
import { loadMergedSeatingClassData, saveSeatingClassData } from './seatingStorage';
import { getWeeklyRotationPlan, buildAcademicTermLaunchClassData, getLastRotationInfo, performWeeklyRotation, undoWeeklyRotation } from './weeklyRotationService';

const backupMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
}));

vi.mock('./seatingBackupApi', () => ({
  fetchSeatingBackup: backupMocks.fetch,
  saveSeatingBackup: backupMocks.save,
}));

function makeRotationClass(): ClassConfig {
  const config = makeClassShell() as ClassConfig;
  config.weekday.locationInfo.fullDate = '2026-04-14';
  config.weekday.locationInfo.date = '4';
  config.weekday.locationInfo.day = '14';
  config.weekday.locationInfo.weekday = '周二';
  config.weekend.locationInfo.fullDate = '2026-04-19';
  config.weekend.locationInfo.date = '4';
  config.weekend.locationInfo.day = '19';
  config.weekend.locationInfo.weekday = '周日';
  return config;
}

describe('weeklyRotationService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    backupMocks.fetch.mockReset().mockResolvedValue(null);
    backupMocks.save.mockReset().mockResolvedValue(true);
  });

  it('rotates seating data forward one week, saves it remotely, and can undo the batch', async () => {
    saveSeatingClassData({
      J101: makeRotationClass(),
    });

    const result = await performWeeklyRotation(6);
    const rotated = loadMergedSeatingClassData();

    expect(result).toEqual({ classCount: 1, undoAvailable: true, cloudSynced: true });
    expect(rotated.J101.weekday.locationInfo.fullDate).toBe('2026-04-21');
    expect(rotated.J101.weekday.currentArrangement).toBe(1);
    expect(rotated.J101.previousWeek).not.toBeNull();
    expect(getLastRotationInfo()?.week).toBe(6);

    const undoResult = await undoWeeklyRotation();
    expect(undoResult).toEqual({ restored: true, cloudSynced: true });
    const restored = loadMergedSeatingClassData();
    expect(restored.J101.weekday.locationInfo.fullDate).toBe('2026-04-14');
    expect(getLastRotationInfo()).toBeNull();
  });

  it('continues weekly rotation when the undo snapshot exceeds browser storage quota', async () => {
    saveSeatingClassData({
      J101: makeRotationClass(),
    });

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key, value) {
      if (key === 'superamberBatchUndoData') {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    const result = await performWeeklyRotation(6);
    const rotated = loadMergedSeatingClassData();

    expect(result).toEqual({ classCount: 1, undoAvailable: false, cloudSynced: true });
    expect(rotated.J101.weekday.locationInfo.fullDate).toBe('2026-04-21');
    expect(getLastRotationInfo()?.week).toBe(6);
    await expect(undoWeeklyRotation()).resolves.toEqual({ restored: false, cloudSynced: false });
  });

  it('uses the saved manual seating arrangement as the next weekly rotation baseline', async () => {
    const config = makeRotationClass();
    config.weekday.groups = [
      ['手动A', '手动B', '', '', '', ''],
      ['手动C', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
    ];
    config.previousWeek = {
      theme: config.theme,
      weekday: {
        ...config.weekday,
        groups: [
          ['旧A', '旧B', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
        ],
      },
      weekend: config.weekend,
    };

    saveSeatingClassData({
      J101: config,
    });

    await performWeeklyRotation(6);
    const rotated = loadMergedSeatingClassData();
    const nextStudents = (rotated.J101.weekday.groups || []).flat();

    expect(rotated.J101.previousWeek?.weekday.groups?.[0]?.[0]).toBe('手动A');
    expect(nextStudents).toContain('手动A');
    expect(nextStudents).not.toContain('旧A');
  });

  it('reports a cloud failure without claiming the local rotation failed', async () => {
    backupMocks.fetch.mockRejectedValue(new Error('offline'));
    saveSeatingClassData({ J101: makeRotationClass() });

    await expect(performWeeklyRotation(6)).resolves.toEqual({
      classCount: 1,
      undoAvailable: true,
      cloudSynced: false,
    });
    expect(loadMergedSeatingClassData().J101.weekday.locationInfo.fullDate).toBe('2026-04-21');
  });

  it('only advances modes that are still inside the requested current week', async () => {
    const partial = makeRotationClass();
    partial.weekend.locationInfo.fullDate = '2026-04-26';
    partial.weekend.currentArrangement = 2;
    const historic = makeRotationClass();
    historic.weekday.locationInfo.fullDate = '2026-03-10';
    historic.weekend.locationInfo.fullDate = '2026-03-15';

    saveSeatingClassData({ J101: partial, OLD: historic });
    const result = await performWeeklyRotation(6, {
      currentWeekStart: '2026-04-13',
      currentWeekEnd: '2026-04-19',
    });
    const rotated = loadMergedSeatingClassData();

    expect(result.classCount).toBe(1);
    expect(rotated.J101.weekday.locationInfo.fullDate).toBe('2026-04-21');
    expect(rotated.J101.weekend.locationInfo.fullDate).toBe('2026-04-26');
    expect(rotated.J101.weekend.currentArrangement).toBe(2);
    expect(rotated.OLD.weekday.locationInfo.fullDate).toBe('2026-03-10');
  });

  it('rotates only active term classes and snaps their dates into Week 1', () => {
    const active = makeRotationClass();
    const historic = makeRotationClass();
    historic.weekday.currentArrangement = 7;

    const result = buildAcademicTermLaunchClassData({
      J101: active,
      'L2第一期-营1': historic,
    }, ['j101'], '2026-08-31');

    expect(result.rotatedClassCodes).toEqual(['J101']);
    expect(result.classData.J101.weekday.locationInfo.fullDate).toBe('2026-09-01');
    expect(result.classData.J101.weekday.locationInfo.weekday).toBe('星期二');
    expect(result.classData.J101.weekend.locationInfo.fullDate).toBe('2026-09-06');
    expect(result.classData.J101.weekday.currentArrangement).toBe(1);
    expect(result.classData.J101.previousWeek?.weekday.locationInfo.fullDate).toBe('2026-04-14');
    expect(result.classData['L2第一期-营1'].weekday.currentArrangement).toBe(7);
    expect(result.classData['L2第一期-营1'].weekday.locationInfo.fullDate).toBe('2026-04-14');
  });
});


describe('manual weekly generation from local seating', () => {
  beforeEach(() => { localStorage.clear(); backupMocks.fetch.mockReset().mockResolvedValue(null); backupMocks.save.mockReset().mockResolvedValue(true); });
  function seated(weekday = '2026-09-01', weekend = '2026-09-06') {
    const config = makeRotationClass();
    config.weekday.locationInfo.fullDate = weekday;
    config.weekend.locationInfo.fullDate = weekend;
    config.weekday.groups = [['A', 'B', 'C', '', '', ''], ['D', 'E', 'F', '', '', ''], ...Array.from({ length: 4 }, () => ['', '', '', '', '', ''])];
    config.weekend.groups = JSON.parse(JSON.stringify(config.weekday.groups));
    return config;
  }
  it('offers Week 2 on Monday from Week 1, ignoring other teachers and empty shells, then persists real seat movement', async () => {
    const local = seated();
    saveSeatingClassData({ J101: local, OTHER: seated('2026-09-08', '2026-09-13'), EMPTY: makeRotationClass() });
    const before = loadMergedSeatingClassData();
    const plan = getWeeklyRotationPlan(['J101', 'EMPTY'])!;
    expect(plan).toMatchObject({ sourceWeek: 1, targetWeek: 2, classCount: 1 });
    expect(loadMergedSeatingClassData()).toEqual(before);
    const result = await performWeeklyRotation(plan.sourceWeek, plan);
    const after = loadMergedSeatingClassData();
    expect(result.classCount).toBe(1);
    expect(after.J101.weekday.locationInfo.fullDate).toBe('2026-09-08');
    expect(after.J101.weekend.locationInfo.fullDate).toBe('2026-09-13');
    expect(after.J101.weekday.groups).not.toEqual(local.weekday.groups);
    expect(after.J101.weekday.currentArrangement).toBe(local.weekday.currentArrangement + 1);
    expect(after.OTHER).toEqual(before.OTHER);
    expect(after.EMPTY).toEqual(before.EMPTY);
    expect(getWeeklyRotationPlan(['J101'])?.targetWeek).toBe(3);
    await expect(performWeeklyRotation(plan.sourceWeek, plan)).rejects.toThrow('本地座位已发生变化');
    expect(loadMergedSeatingClassData()).toEqual(after);
  });
  it('advances only the pending mode and class, keeping already advanced local seats unchanged', async () => {
    saveSeatingClassData({ J101: seated('2026-09-01', '2026-09-13'), J102: seated('2026-09-08', '2026-09-13') });
    const before = loadMergedSeatingClassData();
    const plan = getWeeklyRotationPlan(['J101', 'J102'])!;
    expect(plan.classCount).toBe(1);
    expect(plan.latestSourceWeek).toBe(2);
    expect(plan.pendingModes).toEqual([{ classCode: 'J101', mode: 'weekday', week: 1 }]);
    await performWeeklyRotation(1, plan);
    const after = loadMergedSeatingClassData();
    expect(after.J101.weekday.locationInfo.fullDate).toBe('2026-09-08');
    expect(after.J101.weekend).toEqual(before.J101.weekend);
    expect(after.J102).toEqual(before.J102);
  });
  it('gives primary seating priority over the optional undo snapshot at the quota boundary', async () => {
    saveSeatingClassData({ J101: seated() });
    const plan = getWeeklyRotationPlan(['J101'])!;
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'superamberClassData' && localStorage.getItem('superamberBatchUndoData')) throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    try {
      expect((await performWeeklyRotation(1, plan)).classCount).toBe(1);
      expect(loadMergedSeatingClassData().J101.weekday.locationInfo.fullDate).toBe('2026-09-08');
    } finally { vi.restoreAllMocks(); }
  });
  it('uses local edits even when cloud backup is ahead, and supports explicit undo', async () => {
    const local = seated();
    const cloud = seated('2026-09-15', '2026-09-20');
    cloud.weekday.groups = [['Cloud A', 'Cloud B', '', '', '', '']];
    backupMocks.fetch.mockResolvedValue({ classData: { J101: cloud } });
    saveSeatingClassData({ J101: local });
    const plan = getWeeklyRotationPlan(['J101'])!;
    await performWeeklyRotation(1, plan);
    expect(loadMergedSeatingClassData().J101.weekday.groups?.flat()).toContain('A');
    expect(loadMergedSeatingClassData().J101.weekday.groups?.flat()).not.toContain('Cloud A');
    expect(backupMocks.save.mock.calls[0][1]).toEqual({ allowDateRegression: true });
    await undoWeeklyRotation();
    expect(loadMergedSeatingClassData().J101).toEqual(local);
  });
  it("never offers an empty or another teacher's class as generated seating", () => {
    saveSeatingClassData({ EMPTY: makeRotationClass(), OTHER: seated() });
    expect(getWeeklyRotationPlan(['EMPTY', 'MISSING'])).toBeNull();
  });
});
