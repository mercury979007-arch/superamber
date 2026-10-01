import { describe, expect, it } from 'vitest';
import { buildBackupPayload, sanitizeImportedTheme } from './backupData';
import type { ClassData } from './types';

describe('backupData', () => {
  it('sanitizes unsupported imported themes back to paper', () => {
    expect(sanitizeImportedTheme('mystery')).toBe('paper');
    expect(sanitizeImportedTheme('mint')).toBe('mint');
  });

  it('builds a backup payload with copied metadata', () => {
    const payload = buildBackupPayload({
      appName: 'Amber',
      appSlug: 'amber',
      sourceOrigin: 'http://localhost',
      classData: {} as ClassData,
      userProfile: { username: 'Amber', theme: 'paper' },
      reminderMeta: {
        enabled: true,
        panelCollapsed: false,
        weeklyConfirmedWeek: 1,
        weeklyConfirmedAt: '',
        lastAlertDate: '',
      },
      batchUndo: null,
      academicTermLaunch: {
        termId: '2026-autumn',
        week1Start: '2026-08-31',
        completedAt: '2026-08-30T02:00:00.000Z',
        rotatedClassCodes: ['J101'],
      },
      deepCopy: (value) => JSON.parse(JSON.stringify(value)),
    });

    expect(payload.app).toEqual({ name: 'Amber', slug: 'amber' });
    expect(payload.userProfile.username).toBe('Amber');
    expect(payload.classData).toEqual({});
    expect(payload.academicTermLaunch?.rotatedClassCodes).toEqual(['J101']);
    expect(typeof payload.exportedAt).toBe('string');
  });
});
