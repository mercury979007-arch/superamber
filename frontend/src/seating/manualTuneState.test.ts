import { describe, expect, it } from 'vitest';
import { makeEmptyCampGroups, makeEmptyFourGroups, makeEmptyRowGroups } from './state';
import { buildManualSeatSections, compareStudentMultisets, findFirstEmptyManualSeat, getManualSeatValue, setManualSeatValue, shuffleManualSeatAssignments, validateBalancedManualGroups, type ManualTuneDraft } from './manualTuneState';

function makeDraft(layout: ManualTuneDraft['layout']): ManualTuneDraft {
  return {
    layout,
    groups: Array.from({ length: 6 }, () => Array(6).fill('')),
    rowGroups: makeEmptyRowGroups(),
    fourGroups: makeEmptyFourGroups(),
    groupCount: 4,
    selectedSeatKey: null,
    editingSeatKey: null,
    isDirty: false,
  };
}

describe('manualTuneState', () => {
  it('builds seat sections and can read or write seat values', () => {
    const draft = makeDraft('rows');
    const seat = buildManualSeatSections(draft)[0].seats[0];
    setManualSeatValue(draft, seat, 'Alice');
    expect(getManualSeatValue(draft, seat)).toBe('Alice');
  });

  it('finds empty seats and shuffles occupied names', () => {
    const draft = makeDraft('circular');
    draft.groups[0][0] = 'Alice';
    draft.groups[0][1] = 'Bob';

    expect(findFirstEmptyManualSeat(draft)?.key).toBe('c-0-2');
    expect(shuffleManualSeatAssignments(draft)).toBe(true);
    expect([draft.groups[0][0], draft.groups[0][1]].sort()).toEqual(['Alice', 'Bob']);
  });

  it('builds camp manual seats for 6 groups of 8', () => {
    const draft = makeDraft('camp');
    draft.groups = makeEmptyCampGroups(6);
    const sections = buildManualSeatSections(draft);

    expect(sections).toHaveLength(6);
    expect(sections.flatMap((section) => section.seats)).toHaveLength(48);
    setManualSeatValue(draft, sections[5].seats[7], 'Zoe');
    expect(getManualSeatValue(draft, sections[5].seats[7])).toBe('Zoe');
    expect(findFirstEmptyManualSeat(draft)?.key).toBe('camp-0-0');
  });

  it('detects lost or duplicated students before saving a regroup preview', () => {
    expect(compareStudentMultisets(['Amy', 'Bob', 'Bob'], ['Bob', 'Amy', 'Bob']).ok).toBe(true);
    expect(compareStudentMultisets(['Amy', 'Bob'], ['Amy', 'Cara'])).toEqual({
      ok: false,
      missing: ['Bob'],
      added: ['Cara'],
    });
  });

  it('requires regrouped seats to differ by at most one student', () => {
    const draft = makeDraft('circular');
    draft.groupCount = 3;
    draft.groups[0] = ['A', 'B', '', '', '', ''];
    draft.groups[1] = ['C', 'D', '', '', '', ''];
    draft.groups[2] = ['E', '', '', '', '', ''];
    expect(validateBalancedManualGroups(draft)).toEqual({ ok: true, counts: [2, 2, 1] });

    draft.groups[0] = ['A', 'B', 'C', '', '', ''];
    draft.groups[1] = ['D', '', '', '', '', ''];
    expect(validateBalancedManualGroups(draft)).toEqual({ ok: false, counts: [3, 1, 1] });
  });
});
