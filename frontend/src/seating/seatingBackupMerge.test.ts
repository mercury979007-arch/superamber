import { describe, expect, it } from 'vitest';
import { makeClassShell } from './state';
import { mergeMissingBackupClassData, selectBackupClasses } from './seatingBackupMerge';
import type { ClassConfig, ClassData } from './types';

function campConfig(student = ''): ClassConfig {
  const config = makeClassShell('camp', 'paper');
  config.weekday.layout = 'camp';
  config.weekday.groups = [[student, '', '', '', '', '', '', '']];
  config.weekend = { ...config.weekday, groups: [[student, '', '', '', '', '', '', '']] };
  return config;
}

function emptyConfig(): ClassConfig {
  return makeClassShell('camp', 'paper');
}

function hasSavedSeating(config: ClassConfig | null | undefined): boolean {
  return Boolean(config?.weekday.groups?.flat().some(Boolean) || config?.weekend.groups?.flat().some(Boolean));
}

describe('seatingBackupMerge', () => {
  it('fills classes missing from local data without replacing existing saved seating', () => {
    const local: ClassData = {
      J101: campConfig('Local A'),
      'L2第一期-营1': campConfig('Current Local'),
    };
    const backup: ClassData = {
      'L2第一期-营1': campConfig('Old Backup'),
      'L2第一期-营6': campConfig('Recovered Backup'),
    };

    const merged = mergeMissingBackupClassData(local, backup, hasSavedSeating);

    expect(merged.changed).toBe(true);
    expect(merged.classData['L2第一期-营1'].weekday.groups?.[0]?.[0]).toBe('Current Local');
    expect(merged.classData['L2第一期-营6'].weekday.groups?.[0]?.[0]).toBe('Recovered Backup');
  });

  it('preserves an intentionally empty local seating record', () => {
    const local: ClassData = {
      'L2第一期-营6': emptyConfig(),
    };
    const backup: ClassData = {
      'L2第一期-营6': campConfig('Recovered Backup'),
    };

    const merged = mergeMissingBackupClassData(local, backup, hasSavedSeating);

    expect(merged.changed).toBe(false);
    expect(merged.classData['L2第一期-营6']).toEqual(local['L2第一期-营6']);
  });

  it('seeds backup-missing classes from local data without replacing existing backup seating', () => {
    const backup: ClassData = {
      'L2第一期-营1': campConfig('Current Backup'),
    };
    const local: ClassData = {
      'L2第一期-营1': campConfig('Stale Local'),
      'L2第一期-营6': campConfig('Local Missing From Backup'),
    };

    const merged = mergeMissingBackupClassData(backup, local, hasSavedSeating);

    expect(merged.changed).toBe(true);
    expect(merged.classData['L2第一期-营1'].weekday.groups?.[0]?.[0]).toBe('Current Backup');
    expect(merged.classData['L2第一期-营6'].weekday.groups?.[0]?.[0]).toBe('Local Missing From Backup');
  });

  it('preserves every local field even when the cloud has a newer rotation', () => {
    const localConfig = campConfig('Local Week 1');
    localConfig.weekday.locationInfo.fullDate = '2026-08-31';
    localConfig.weekday.currentArrangement = 1;
    localConfig.todoNotes = [{
      id: 'local-note',
      text: '保留本地备注',
      dueDate: '2026-09-08',
      source: 'manual',
      completed: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      completedAt: null,
    }];
    const backupConfig = campConfig('Cloud Week 2');
    backupConfig.weekday.locationInfo.fullDate = '2026-09-07';
    backupConfig.weekday.currentArrangement = 2;

    const merged = mergeMissingBackupClassData(
      { J101: localConfig },
      { J101: backupConfig },
      hasSavedSeating,
    );

    expect(merged.classData.J101).toEqual(localConfig);
    expect(merged.changed).toBe(false);
    expect(merged.classData.J101.weekday.locationInfo.fullDate).toBe('2026-08-31');
    expect(merged.classData.J101.weekday.groups?.[0]?.[0]).toBe('Local Week 1');
    expect(merged.classData.J101.todoNotes?.[0]?.text).toBe('保留本地备注');
  });

  it('does not replace local seating for an ordinary date correction', () => {
    const localConfig = campConfig('Local');
    localConfig.weekday.locationInfo.fullDate = '2026-08-31';
    localConfig.weekday.currentArrangement = 1;
    const backupConfig = campConfig('Cloud');
    backupConfig.weekday.locationInfo.fullDate = '2026-09-07';
    backupConfig.weekday.currentArrangement = 1;

    const merged = mergeMissingBackupClassData(
      { J101: localConfig },
      { J101: backupConfig },
      hasSavedSeating,
    );

    expect(merged.changed).toBe(false);
    expect(merged.classData.J101.weekday.groups?.[0]?.[0]).toBe('Local');
  });
});

it('restores only allowed classes while preserving all existing local classes and manual seating', () => {
  const local = { J101: campConfig('Manual W2'), HISTORICAL: campConfig('Keep') };
  const backup = { J101: campConfig('Old Cloud'), J202: campConfig('Missing Class'), OTHER: campConfig('Another Teacher') };
  const selected = selectBackupClasses(backup, ['j101', 'J202']);
  const merged = mergeMissingBackupClassData(local, selected, hasSavedSeating);
  expect(Object.keys(merged.classData).sort()).toEqual(['HISTORICAL', 'J101', 'J202']);
  expect(merged.classData.J101).toEqual(local.J101);
  expect(merged.classData.HISTORICAL).toEqual(local.HISTORICAL);
  expect(selectBackupClasses(backup)).toBe(backup);
  expect(selectBackupClasses(backup, [])).toEqual({});
});
