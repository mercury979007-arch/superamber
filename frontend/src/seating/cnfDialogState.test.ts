import { describe, expect, it } from 'vitest';
import { makeClassShell } from './state';
import { applyFetchedCnfRoster, buildCnfSquadOptions, resolvePreferredCnfSquadId } from './cnfDialogState';
import type { ClassConfig } from './types';

describe('cnfDialogState', () => {
  it('builds option models and resolves the preferred squad id', () => {
    const squads = [
      { id: 1, name: 'J101', type: 'offline', section: '', group: '', tutor: '' },
      { id: 2, name: '人民广场 J102 精英班', type: 'online', section: '', group: '', tutor: '' },
    ];

    expect(buildCnfSquadOptions(squads)[1].label).toContain('J102');
    expect(resolvePreferredCnfSquadId({ squads, preferredClass: 'J102' })).toBe('2');
    expect(resolvePreferredCnfSquadId({ squads, preferredClass: 'J102', currentCnfSquadId: '1' })).toBe('1');
  });

  it('applies fetched roster data onto a class config', () => {
    const config = makeClassShell() as ClassConfig;
    applyFetchedCnfRoster(config, ['Alice', 'Bob'], {
      squadId: '12',
      squadType: 'offline',
      loginUsername: 'amber',
      timestamp: '2026-04-14T00:00:00.000Z',
    });

    expect(config.cnf?.squadId).toBe('12');
    expect(config.weekday.layout).toBe('circular');
    expect(config.weekday.groups?.flat().filter(Boolean)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
  });
});
