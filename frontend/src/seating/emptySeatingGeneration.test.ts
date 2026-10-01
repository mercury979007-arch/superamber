import { describe, expect, it } from 'vitest';
import { collectStudentsFromCircular } from './layouts';
import { makeClassShell, makeEmptyCircularGroups } from './state';
import { classConfigHasAnySeating, populateEmptyClassWithStudents } from './emptySeatingGeneration';

describe('empty seating generation', () => {
  it('fills both time modes while preserving their schedule details', () => {
    const config = makeClassShell('circular', 'paper');
    config.weekday.locationInfo.room = '101';
    config.weekend.locationInfo.room = '202';

    expect(populateEmptyClassWithStudents(config, ['Amy', 'Ben', 'Cara'])).toBe(true);
    expect(collectStudentsFromCircular(config.weekday.groups || [])).toEqual(['Amy', 'Ben', 'Cara']);
    expect(collectStudentsFromCircular(config.weekend.groups || [])).toEqual(['Amy', 'Ben', 'Cara']);
    expect(config.weekday.locationInfo.room).toBe('101');
    expect(config.weekend.locationInfo.room).toBe('202');
    expect(classConfigHasAnySeating(config)).toBe(true);
  });

  it('never overwrites a class that already has seating', () => {
    const config = makeClassShell('circular', 'paper');
    config.weekday.groups = makeEmptyCircularGroups();
    config.weekday.groups![0][0] = 'Existing';

    expect(populateEmptyClassWithStudents(config, ['New Student'])).toBe(false);
    expect(collectStudentsFromCircular(config.weekday.groups || [])).toEqual(['Existing']);
    expect(collectStudentsFromCircular(config.weekend.groups || [])).toEqual([]);
  });
});
