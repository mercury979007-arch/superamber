import { describe, expect, it } from 'vitest';
import { makeEmptyCampGroups } from './state';
import {
  normalizeSummerCampSeatSlots,
  resolveImportedSummerCampGroupCount,
  resolveSavedSummerCampGroupCount,
  sanitizeSummerCampSeatGroups,
} from './summerCampSeatSlots';

describe('summerCampSeatSlots', () => {
  it('normalizes fixed seat slots without compacting blank seats', () => {
    expect(normalizeSummerCampSeatSlots([' Alice ', '', 'Bob', '', '', '', '', ' Seat 8 ']))
      .toEqual(['Alice', '', 'Bob', '', '', '', '', 'Seat 8']);
    expect(normalizeSummerCampSeatSlots(['Only'])).toEqual(['Only', '', '', '', '', '', '', '']);
  });

  it('sanitizes saved groups while preserving teacher-controlled empty slots', () => {
    const groups = makeEmptyCampGroups(6);
    groups[0][0] = ' TeacherPriorityQA ';
    groups[0][7] = ' SeatEightQA ';
    groups[5][7] = ' LastSeatQA ';

    const sanitized = sanitizeSummerCampSeatGroups(groups);

    expect(sanitized).toHaveLength(6);
    expect(sanitized[0]).toEqual(['TeacherPriorityQA', '', '', '', '', '', '', 'SeatEightQA']);
    expect(sanitized[5][7]).toBe('LastSeatQA');
  });

  it('keeps the saved 8-group shape even when the extra groups are empty', () => {
    const groups = makeEmptyCampGroups(8);

    expect(resolveSavedSummerCampGroupCount(groups)).toBe(8);
    expect(sanitizeSummerCampSeatGroups(groups)).toHaveLength(8);
  });

  it('does not expand imported text to 8 groups unless group 7 or 8 has content', () => {
    const emptyEightGroups = makeEmptyCampGroups(8);
    const occupiedEightGroups = makeEmptyCampGroups(8);
    occupiedEightGroups[7][0] = 'GroupEightStudent';

    expect(resolveImportedSummerCampGroupCount(emptyEightGroups)).toBe(6);
    expect(resolveImportedSummerCampGroupCount(occupiedEightGroups)).toBe(8);
  });
});
