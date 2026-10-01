import { beforeEach, describe, expect, it } from 'vitest';
import { computeRosterDiff, extractRosterStudents, findMatchingCnfSquad, loadKnownRosterForClass, mergeStudentListsByMaxCount, saveKnownRosterForClass } from './rosterSync';

describe('rosterSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads known roster data by class code', () => {
    saveKnownRosterForClass('j101', ['Alice', ' Alice ', '张三']);
    expect(loadKnownRosterForClass('J101')).toEqual(['Alice', '张三']);
  });

  it('can preserve duplicate names for camp rosters', () => {
    saveKnownRosterForClass('L2第一期-营1', ['Amy', 'Amy', 'Bob'], { preserveDuplicates: true });
    expect(loadKnownRosterForClass('l2第一期-营1')).toEqual(['Amy', 'Amy', 'Bob']);
  });

  it('matches CNF squads by exact code first and then by contained label', () => {
    const squads = [
      { id: 1, name: 'J101', type: 'offline', section: '', group: '', tutor: '' },
      { id: 2, name: '人民广场 J102 精英班', type: 'offline', section: '', group: '', tutor: '' },
    ];

    expect(findMatchingCnfSquad(squads, 'J101')?.id).toBe(1);
    expect(findMatchingCnfSquad(squads, 'J102')?.id).toBe(2);
  });

  it('extracts roster names and computes missing or extra students', () => {
    expect(extractRosterStudents([
      { enName: 'Alice', chName: '艾丽丝' },
      { chName: '张三' },
      { displayName: 'Bob' },
    ])).toEqual(['Alice', '张三', 'Bob']);

    expect(computeRosterDiff(['Alice', 'Bob'], ['Alice', 'Cara'])).toEqual({
      missing: ['Bob'],
      extra: ['Cara'],
    });
    expect(computeRosterDiff(['Amy', 'Amy', 'Bob'], ['Amy', 'Bob'])).toEqual({
      missing: ['Amy'],
      extra: [],
    });
  });

  it('merges seating modes without deduping same-name students inside a mode', () => {
    expect(mergeStudentListsByMaxCount(['Amy', 'Amy', 'Bob'], ['Amy', 'Bob'])).toEqual(['Amy', 'Amy', 'Bob']);
    expect(computeRosterDiff(['Amy', 'Amy', 'Bob'], mergeStudentListsByMaxCount(['Amy', 'Amy', 'Bob'], ['Amy', 'Bob']))).toEqual({
      missing: [],
      extra: [],
    });
  });
});
