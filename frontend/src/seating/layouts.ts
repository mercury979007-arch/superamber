import type { FourGroups, GroupRotation, InternalRotation, LayoutType, RotationConfig, RowGroups } from './types';
import {
  CAMP_ALLOWED_GROUP_COUNTS,
  CAMP_DEFAULT_GROUP_COUNT,
  CAMP_GROUP_SIZE,
  CIRCULAR_EXPANDED_GROUP_SIZE,
  CIRCULAR_GROUP_SIZE,
  FOUR_EXPANDED_GROUP_SIZE,
  FOUR_GROUP_SIZE,
  MAX_STUDENT_LIMIT,
  ROW_EXPANDED_GROUP_SIZE,
  ROW_GROUP_SIZE,
  getLayoutGroupSeatCapacity,
  makeEmptyCampGroups,
  makeEmptyCircularGroups,
  makeEmptyFourGroups,
  makeEmptyRowGroups
} from './state';

const CIRCULAR_THRESHOLD = [
  { min: 31, groups: 6 },
  { min: 25, groups: 5 },
  { min: 19, groups: 4 },
  { min: 1, groups: 3 }
] as const;

const ROW_THRESHOLD = [
  { min: 31, groups: 6 },
  { min: 25, groups: 5 },
  { min: 1, groups: 4 }
] as const;

const FOUR_DEFAULT_GROUP_COUNT = 4;

const maxStoredGroupLength = (groups: string[][], fallback: number, maximum: number): number => {
  const storedMaximum = groups.reduce((largest, group) => Math.max(largest, group.length), 0);
  return Math.max(fallback, Math.min(maximum, storedMaximum || fallback));
};

const copyGroup = (group: string[], size: number): string[] => {
  const normalized = group
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, size);
  return [...normalized, ...Array(size - normalized.length).fill('')];
};

export const normalizeStudentList = (students: string[]): string[] =>
  students
    .map((name) => name.trim())
    .filter(Boolean);

const assertStudentLimit = (students: string[]): void => {
  if (students.length > MAX_STUDENT_LIMIT) {
    throw new Error(`所有布局最多${MAX_STUDENT_LIMIT}人，当前${students.length}人`);
  }
};

export const getCircularGroupCount = (totalStudents: number): number => {
  if (totalStudents > 36) return 6;
  for (const item of CIRCULAR_THRESHOLD) {
    if (totalStudents >= item.min) {
      return item.groups;
    }
  }
  return 0;
};

export const getRowGroupCount = (totalStudents: number): number => {
  if (totalStudents > 36) return 6;
  for (const item of ROW_THRESHOLD) {
    if (totalStudents >= item.min) {
      return item.groups;
    }
  }
  return 0;
};

export const getCircularSlotMap = (groupCount: number): Array<number | null> => {
  if (groupCount >= 6) return [0, 1, 2, 3, 4, 5];
  if (groupCount === 5) return [0, 1, 2, 3, 4, null];
  if (groupCount === 4) return [0, 1, 2, null, 3, null];
  if (groupCount === 3) return [0, 1, 2, null, null, null];
  if (groupCount === 2) return [0, 1, null, null, null, null];
  if (groupCount === 1) return [0, null, null, null, null, null];
  return [null, null, null, null, null, null];
};

export const getRowsSlotMap = (groupCount: number): Array<number | null> => {
  if (groupCount >= 6) return [0, 1, 2, 3, 4, 5];
  if (groupCount === 5) return [0, 1, 2, 3, 4, null];
  if (groupCount === 4) return [0, 1, 2, 3, null, null];
  if (groupCount === 3) return [0, 1, 2, null, null, null];
  if (groupCount === 2) return [0, 1, null, null, null, null];
  if (groupCount === 1) return [0, null, null, null, null, null];
  return [null, null, null, null, null, null];
};

const splitEvenly = (students: string[], groupCount: number, capacity: number): string[][] => {
  const normalized = normalizeStudentList(students);
  if (groupCount <= 0) {
    return [];
  }

  if (normalized.length > groupCount * capacity) {
    throw new Error(`人数超出限制：${groupCount}组每组最多${capacity}人，当前${normalized.length}人`);
  }

  const base = Math.floor(normalized.length / groupCount);
  const extra = normalized.length % groupCount;

  const groups: string[][] = [];
  let cursor = 0;

  for (let index = 0; index < groupCount; index += 1) {
    const thisCount = base + (index < extra ? 1 : 0);
    const chunk = normalized.slice(cursor, cursor + thisCount);
    cursor += thisCount;
    groups.push(chunk);
  }

  return groups;
};

const countNonEmptyGroups = (groups: string[][]): number => groups.filter((group) => group.some((name) => name.trim())).length;

const occupiedGroupIndexes = (groups: string[][]): number[] =>
  groups.reduce<number[]>((indexes, group, index) => {
    if (group.some((name) => name.trim())) {
      indexes.push(index);
    }
    return indexes;
  }, []);

const visibleCountFromOccupiedIndexes = (indexes: number[], maxCount: number): number => {
  if (indexes.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(maxCount, Math.max(...indexes) + 1));
};

const rotateNames = (group: string[], shift: number): string[] => {
  const nonEmpty = group.filter((name) => name.trim());
  const emptyCount = group.length - nonEmpty.length;

  if (nonEmpty.length <= 1) {
    return copyGroup(group, group.length);
  }

  const normalizedShift = ((shift % nonEmpty.length) + nonEmpty.length) % nonEmpty.length || 1;
  const rotated = [...nonEmpty.slice(-normalizedShift), ...nonEmpty.slice(0, -normalizedShift)];
  return [...rotated, ...Array(emptyCount).fill('')];
};

export const placeCentered = (targetArray: string[], names: string[]): void => {
  const width = targetArray.length;
  let centerLeft = Math.floor((width - 1) / 2);
  let centerRight = centerLeft + 1;
  let useLeft = true;
  let idx = 0;

  while (idx < names.length && (centerLeft >= 0 || centerRight < width)) {
    if (useLeft && centerLeft >= 0) {
      targetArray[centerLeft--] = names[idx++];
    } else if (!useLeft && centerRight < width) {
      targetArray[centerRight++] = names[idx++];
    }
    useLeft = !useLeft;
  }
};

export const convertStudentsToCircular = (students: string[], forcedGroupCount?: number): string[][] => {
  const normalized = normalizeStudentList(students);
  assertStudentLimit(normalized);
  const groupCount = forcedGroupCount ?? getCircularGroupCount(normalized.length);
  if (groupCount <= 0) {
    return makeEmptyCircularGroups();
  }

  const seatCapacity = getLayoutGroupSeatCapacity('circular', normalized.length, groupCount);
  const logicalGroups = splitEvenly(normalized, groupCount, seatCapacity);
  const groups = makeEmptyCircularGroups(seatCapacity);

  logicalGroups.forEach((group, index) => {
    groups[index] = copyGroup(group, seatCapacity);
  });

  return groups;
};

const slotGroupsToRowGroups = (
  slotGroups: string[][],
  seatCapacity = maxStoredGroupLength(slotGroups, ROW_GROUP_SIZE, ROW_EXPANDED_GROUP_SIZE),
): RowGroups => ({
  rows: [
    { left: copyGroup(slotGroups[0] ?? [], seatCapacity), right: copyGroup(slotGroups[1] ?? [], seatCapacity) },
    { left: copyGroup(slotGroups[2] ?? [], seatCapacity), right: copyGroup(slotGroups[3] ?? [], seatCapacity) },
    { left: copyGroup(slotGroups[4] ?? [], seatCapacity), right: copyGroup(slotGroups[5] ?? [], seatCapacity) }
  ]
});

export const rowGroupsToSlotGroups = (rowGroups: RowGroups): string[][] => {
  const rows = rowGroups.rows;
  const rawGroups = [
    rows[0]?.left ?? [], rows[0]?.right ?? [],
    rows[1]?.left ?? [], rows[1]?.right ?? [],
    rows[2]?.left ?? [], rows[2]?.right ?? [],
  ];
  const seatCapacity = maxStoredGroupLength(rawGroups, ROW_GROUP_SIZE, ROW_EXPANDED_GROUP_SIZE);
  return [
    copyGroup(rows[0]?.left ?? [], seatCapacity),
    copyGroup(rows[0]?.right ?? [], seatCapacity),
    copyGroup(rows[1]?.left ?? [], seatCapacity),
    copyGroup(rows[1]?.right ?? [], seatCapacity),
    copyGroup(rows[2]?.left ?? [], seatCapacity),
    copyGroup(rows[2]?.right ?? [], seatCapacity)
  ];
};

export const getRowsOccupiedSlotsFromGroups = (rowGroups: RowGroups): number[] =>
  rowGroupsToSlotGroups(rowGroups).reduce<number[]>((slots, group, slotIndex) => {
    if (group.some((name) => name.trim())) {
      slots.push(slotIndex);
    }
    return slots;
  }, []);

export const convertStudentsToRows = (students: string[], forcedGroupCount?: number): RowGroups => {
  const normalized = normalizeStudentList(students);
  assertStudentLimit(normalized);
  const groupCount = forcedGroupCount ?? getRowGroupCount(normalized.length);
  if (groupCount <= 0) {
    return makeEmptyRowGroups();
  }

  const seatCapacity = getLayoutGroupSeatCapacity('rows', normalized.length, groupCount);
  if (groupCount === 6) {
    let offset = 0;
    const rows = Array.from({ length: 3 }, (_, rowIndex) => {
      const rowSize = Math.floor(normalized.length / 3) + (rowIndex < normalized.length % 3 ? 1 : 0);
      const rowStudents = normalized.slice(offset, offset + rowSize);
      offset += rowSize;
      const leftSize = Math.ceil(rowStudents.length / 2);
      return {
        left: copyGroup(rowStudents.slice(0, leftSize), seatCapacity),
        right: copyGroup(rowStudents.slice(leftSize), seatCapacity),
      };
    });
    return { rows };
  }
  const logicalGroups = splitEvenly(normalized, groupCount, seatCapacity);
  const slotMap = getRowsSlotMap(groupCount);
  const slotGroups = Array.from({ length: 6 }, () => Array(seatCapacity).fill(''));

  slotMap.forEach((logicalIndex, slotIndex) => {
    if (logicalIndex === null) {
      return;
    }
    slotGroups[slotIndex] = copyGroup(logicalGroups[logicalIndex] ?? [], seatCapacity);
  });

  return slotGroupsToRowGroups(slotGroups, seatCapacity);
};

export const convertStudentsToFour = (students: string[], forcedGroupCount = FOUR_DEFAULT_GROUP_COUNT): FourGroups => {
  const normalized = normalizeStudentList(students);
  assertStudentLimit(normalized);
  const groupCount = Math.max(3, Math.min(4, forcedGroupCount));
  const seatCapacity = getLayoutGroupSeatCapacity('four', normalized.length, groupCount);
  const logicalGroups = splitEvenly(normalized, groupCount, seatCapacity);
  const fourGroups = makeEmptyFourGroups(seatCapacity);
  fourGroups.groupCount = groupCount;

  logicalGroups.forEach((group, index) => {
    fourGroups.groups[index] = copyGroup(group, seatCapacity);
  });

  return fourGroups;
};

export const normalizeCampGroupCount = (groupCount: number | null | undefined): 6 | 8 =>
  CAMP_ALLOWED_GROUP_COUNTS.includes(groupCount as 6 | 8) ? groupCount as 6 | 8 : CAMP_DEFAULT_GROUP_COUNT;

export const convertStudentsToCamp = (students: string[], forcedGroupCount = CAMP_DEFAULT_GROUP_COUNT): string[][] => {
  const normalized = normalizeStudentList(students);
  assertStudentLimit(normalized);
  const groupCount = normalizeCampGroupCount(forcedGroupCount);
  const logicalGroups = splitEvenly(normalized, groupCount, CAMP_GROUP_SIZE);
  const groups = makeEmptyCampGroups(groupCount);

  logicalGroups.forEach((group, index) => {
    groups[index] = copyGroup(group, CAMP_GROUP_SIZE);
  });

  return groups;
};

export const collectStudentsFromCircular = (groups: string[][]): string[] => {
  return groups.flatMap((group) => group.map((name) => name.trim()).filter(Boolean));
};

export const collectStudentsFromCamp = (groups: string[][]): string[] => collectStudentsFromCircular(groups);

export const collectStudentsFromRows = (rowGroups: RowGroups): string[] => {
  return rowGroupsToSlotGroups(rowGroups).flatMap((group) => group.map((name) => name.trim()).filter(Boolean));
};

export const collectStudentsFromFour = (fourGroups: FourGroups): string[] =>
  fourGroups.groups.flatMap((group) => group.map((name) => name.trim()).filter(Boolean));

const internalShiftValue = (mode: InternalRotation): number => {
  switch (mode) {
    case 'none': return 0;
    case 'right1': return 1;
    case 'right2': return 2;
    case 'left1': return -1;
    case 'left2': return -2;
    default: return 2;
  }
};

export const defaultRotationConfig = (layout: LayoutType): RotationConfig => {
  if (layout === 'circular') return { groupRotation: 'clockwise', internalRotation: 'right2', labelRotation: 'rotate', labelNameMode: 'standard' };
  if (layout === 'rows') return { groupRotation: 'snake', internalRotation: 'right1', labelRotation: 'rotate', labelNameMode: 'standard' };
  if (layout === 'four') return { groupRotation: 'clockwise', internalRotation: 'right2', labelRotation: 'rotate', labelNameMode: 'standard' };
  if (layout === 'camp') return { groupRotation: 'front-back-swap', internalRotation: 'right2', labelRotation: 'rotate', labelNameMode: 'standard' };
  return { groupRotation: 'clockwise', internalRotation: 'right2', labelRotation: 'rotate', labelNameMode: 'standard' };
};

export const normalizeGroupLabels = (labels: string[] | null | undefined, count = 6): string[] =>
  Array.from({ length: count }, (_, index) => String(labels?.[index] || `${index + 1}`).trim() || `${index + 1}`);

export const getCircularGroupCountFromGroups = (groups: string[][]): number => countNonEmptyGroups(groups);

export const getCircularOccupiedGroupIndexesFromGroups = (groups: string[][]): number[] =>
  occupiedGroupIndexes(groups).filter((index) => index >= 0 && index < 6);

export const getCircularVisibleGroupCountFromGroups = (groups: string[][]): number =>
  visibleCountFromOccupiedIndexes(getCircularOccupiedGroupIndexesFromGroups(groups), 6);

export const getRowsGroupCountFromGroups = (rowGroups: RowGroups): number =>
  countNonEmptyGroups(rowGroupsToSlotGroups(rowGroups));

export const getFourOccupiedGroupIndexesFromGroups = (fourGroups: FourGroups): number[] =>
  occupiedGroupIndexes(fourGroups.groups || []).filter((index) => index >= 0 && index < 4);

export const getFourGroupCountFromGroups = (fourGroups: FourGroups): number => {
  const declaredCount = Math.max(3, Math.min(4, Number(fourGroups.groupCount) || 4));
  const visibleCount = visibleCountFromOccupiedIndexes(getFourOccupiedGroupIndexesFromGroups(fourGroups), 4);
  return Math.max(declaredCount, visibleCount);
};

export const getCampOccupiedGroupIndexesFromGroups = (groups: string[][]): number[] =>
  occupiedGroupIndexes(groups).filter((index) => index >= 0 && index < 8);

export const getCampGroupCountFromGroups = (groups: string[][]): 6 | 8 => {
  const visibleCount = visibleCountFromOccupiedIndexes(getCampOccupiedGroupIndexesFromGroups(groups), 8);
  if (groups.length >= 8 || visibleCount > 6) {
    return 8;
  }
  return 6;
};

const resolveCircularActiveEntries = (activeGroups: number | number[]): Array<{ slotIndex: number; logicalIndex: number }> => {
  if (Array.isArray(activeGroups)) {
    const occupiedSet = new Set(activeGroups.filter((index) => index >= 0 && index < 6));
    const visibleCount = visibleCountFromOccupiedIndexes([...occupiedSet], 6);
    const slotMap = getCircularSlotMap(visibleCount);
    return [0, 1, 2, 3, 4, 5].reduce<Array<{ slotIndex: number; logicalIndex: number }>>((entries, slotIndex) => {
      const logicalIndex = slotMap[slotIndex];
      if (logicalIndex !== null && occupiedSet.has(logicalIndex)) {
        entries.push({ slotIndex, logicalIndex });
      }
      return entries;
    }, []);
  }

  const slotMap = getCircularSlotMap(activeGroups);
  return [0, 1, 2, 3, 4, 5].reduce<Array<{ slotIndex: number; logicalIndex: number }>>((entries, slotIndex) => {
    const logicalIndex = slotMap[slotIndex];
    if (logicalIndex !== null) {
      entries.push({ slotIndex, logicalIndex });
    }
    return entries;
  }, []);
};

const orderCircularEntries = (activeGroups: number | number[], rotation: GroupRotation) => {
  const entries = resolveCircularActiveEntries(activeGroups);
  if (rotation !== 'front-back-swap') return entries;
  // Physical rows read 1,2,3 / 4,5,6, independently of the labels that travel with a group.
  const path = [0, 4, 2, 3, 1, 5];
  return entries.sort((a, b) => path.indexOf(a.slotIndex) - path.indexOf(b.slotIndex));
};

export const rotateCircularLayoutForWeek = (groups: string[][], config?: RotationConfig | null): string[][] => {
  const rc = config ?? defaultRotationConfig('circular');
  const shift = internalShiftValue(rc.internalRotation);
  const seatCapacity = maxStoredGroupLength(groups, CIRCULAR_GROUP_SIZE, CIRCULAR_EXPANDED_GROUP_SIZE);
  const internalRotated = shift === 0
    ? groups.map((group) => copyGroup(group, seatCapacity))
    : groups.map((group) => rotateNames(copyGroup(group, seatCapacity), shift));
  const activeEntries = orderCircularEntries(getCircularOccupiedGroupIndexesFromGroups(internalRotated), rc.groupRotation);
  if (activeEntries.length <= 1) {
    return internalRotated;
  }

  const rotated = makeEmptyCircularGroups(seatCapacity);
  rotated.forEach((_, index) => {
    rotated[index] = copyGroup(internalRotated[index], seatCapacity);
  });

  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeEntries.forEach((targetEntry, index) => {
    const sourceIdx = ((index + direction) % activeEntries.length + activeEntries.length) % activeEntries.length;
    const sourceEntry = activeEntries[sourceIdx];
    rotated[targetEntry.logicalIndex] = copyGroup(internalRotated[sourceEntry.logicalIndex], seatCapacity);
  });

  return rotated;
};

export const rotateCircularGroupOrderForWeek = (groupOrder: number[], activeGroups: number | number[], config?: RotationConfig | null): number[] => {
  const rc = config ?? defaultRotationConfig('circular');
  const activeEntries = orderCircularEntries(activeGroups, rc.groupRotation);
  const rotated = [...groupOrder];

  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeEntries.forEach((targetEntry, index) => {
    const sourceIdx = ((index + direction) % activeEntries.length + activeEntries.length) % activeEntries.length;
    const sourceEntry = activeEntries[sourceIdx];
    rotated[targetEntry.logicalIndex] = groupOrder[sourceEntry.logicalIndex] || sourceEntry.logicalIndex + 1;
  });

  return rotated;
};

export const rotateCircularGroupLabelsForWeek = (groupLabels: string[], activeGroups: number | number[], config?: RotationConfig | null): string[] => {
  const rc = config ?? defaultRotationConfig('circular');
  if (rc.labelRotation !== 'rotate') {
    return normalizeGroupLabels(groupLabels);
  }
  const activeEntries = orderCircularEntries(activeGroups, rc.groupRotation);
  const rotated = normalizeGroupLabels(groupLabels);
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeEntries.forEach((targetEntry, index) => {
    const sourceIdx = ((index + direction) % activeEntries.length + activeEntries.length) % activeEntries.length;
    const sourceEntry = activeEntries[sourceIdx];
    rotated[targetEntry.logicalIndex] = groupLabels[sourceEntry.logicalIndex] || `${sourceEntry.logicalIndex + 1}`;
  });

  return rotated;
};

const ROWS_GROUP_PATHS: Partial<Record<GroupRotation, number[]>> = {
  'front-back-swap': [0, 3, 4, 1, 2, 5],
  snake: [0, 1, 3, 2, 4, 5],
  clockwise: [0, 1, 3, 5, 4, 2],
  counterclockwise: [0, 1, 3, 5, 4, 2],
};
const LEGACY_ROWS_GROUP_PATHS: Partial<Record<GroupRotation, number[]>> = {
  snake: [0, 2, 4, 1, 3, 5],
  clockwise: [0, 1, 3, 2, 4, 5],
  counterclockwise: [0, 1, 3, 2, 4, 5],
};
const ROWS_DEFAULT_GROUP_PATH = ROWS_GROUP_PATHS.snake ?? [0, 1, 3, 2, 4, 5];
const LEGACY_ROWS_DEFAULT_GROUP_PATH = LEGACY_ROWS_GROUP_PATHS.snake ?? [0, 2, 4, 1, 3, 5];

type RowsRotationPathVersion = 'current' | 'legacy';

const getRowsRotationPath = (rotation: GroupRotation, version: RowsRotationPathVersion): number[] => {
  if (version === 'legacy') {
    return LEGACY_ROWS_GROUP_PATHS[rotation] ?? LEGACY_ROWS_DEFAULT_GROUP_PATH;
  }
  return ROWS_GROUP_PATHS[rotation] ?? ROWS_DEFAULT_GROUP_PATH;
};

export const rotateRowsLayoutForWeek = (
  rowGroups: RowGroups,
  config?: RotationConfig | null,
  pathVersion: RowsRotationPathVersion = 'current',
): RowGroups => {
  const rc = config ?? defaultRotationConfig('rows');
  const slotGroups = rowGroupsToSlotGroups(rowGroups);
  const occupiedSlots = getRowsOccupiedSlotsFromGroups(rowGroups);
  const shift = internalShiftValue(rc.internalRotation);
  const seatCapacity = maxStoredGroupLength(slotGroups, ROW_GROUP_SIZE, ROW_EXPANDED_GROUP_SIZE);
  const internalRotated = shift === 0
    ? slotGroups.map((group) => copyGroup(group, seatCapacity))
    : slotGroups.map((group) => rotateNames(copyGroup(group, seatCapacity), shift));

  if (occupiedSlots.length <= 1) {
    return slotGroupsToRowGroups(internalRotated);
  }

  const rotationPath = getRowsRotationPath(rc.groupRotation, pathVersion);
  const activeSlots = rotationPath.filter((slotIndex) => occupiedSlots.includes(slotIndex));
  const rotatedSlots = Array.from({ length: 6 }, () => Array(seatCapacity).fill(''));

  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
    const sourceSlot = activeSlots[sourceIdx];
    rotatedSlots[targetSlot] = copyGroup(internalRotated[sourceSlot], seatCapacity);
  });

  return slotGroupsToRowGroups(rotatedSlots, seatCapacity);
};

const resolveRowsActiveSlots = (activeRows: number | number[]): number[] => {
  if (Array.isArray(activeRows)) {
    return activeRows;
  }
  const slotMap = getRowsSlotMap(activeRows);
  return slotMap.reduce<number[]>((slots, logicalGroupIndex, slotIndex) => {
    if (logicalGroupIndex !== null) {
      slots.push(slotIndex);
    }
    return slots;
  }, []);
};

export const rotateRowsGroupOrderForWeek = (
  groupOrder: number[],
  activeRows: number | number[],
  config?: RotationConfig | null,
  pathVersion: RowsRotationPathVersion = 'current',
): number[] => {
  const rc = config ?? defaultRotationConfig('rows');
  const rotationPath = getRowsRotationPath(rc.groupRotation, pathVersion);
  const activeSlotSet = new Set(resolveRowsActiveSlots(activeRows));
  const activeSlots = rotationPath.filter((slotIndex) => activeSlotSet.has(slotIndex));
  const rotated = [...groupOrder];

  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
    const sourceSlot = activeSlots[sourceIdx];
    rotated[targetSlot] = groupOrder[sourceSlot] || sourceSlot + 1;
  });

  return rotated;
};

export const rotateRowsGroupLabelsForWeek = (
  groupLabels: string[],
  activeRows: number | number[],
  config?: RotationConfig | null,
  pathVersion: RowsRotationPathVersion = 'current',
): string[] => {
  const rc = config ?? defaultRotationConfig('rows');
  if (rc.labelRotation !== 'rotate') {
    return normalizeGroupLabels(groupLabels);
  }
  const rotationPath = getRowsRotationPath(rc.groupRotation, pathVersion);
  const activeSlotSet = new Set(resolveRowsActiveSlots(activeRows));
  const activeSlots = rotationPath.filter((slotIndex) => activeSlotSet.has(slotIndex));
  const rotated = normalizeGroupLabels(groupLabels);
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
    const sourceSlot = activeSlots[sourceIdx];
    rotated[targetSlot] = groupLabels[sourceSlot] || `${sourceSlot + 1}`;
  });

  return rotated;
};

export const rotateFourLayoutForWeek = (fourGroups: FourGroups, config?: RotationConfig | null): FourGroups => {
  const rc = config ?? defaultRotationConfig('four');
  const shift = internalShiftValue(rc.internalRotation);
  const seatCapacity = maxStoredGroupLength(fourGroups.groups, FOUR_GROUP_SIZE, FOUR_EXPANDED_GROUP_SIZE);
  const internalRotated = shift === 0
    ? fourGroups.groups.map((group) => copyGroup(group, seatCapacity))
    : fourGroups.groups.map((group) => rotateNames(copyGroup(group, seatCapacity), shift));
  const activeCount = getFourGroupCountFromGroups(fourGroups);
  const occupiedSlots = getFourOccupiedGroupIndexesFromGroups({ ...fourGroups, groups: internalRotated });
  if (occupiedSlots.length <= 1) {
    return { groups: internalRotated, groupCount: activeCount };
  }

  const rotated = makeEmptyFourGroups(seatCapacity);
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  occupiedSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % occupiedSlots.length + occupiedSlots.length) % occupiedSlots.length;
    const sourceSlot = occupiedSlots[sourceIdx];
    rotated.groups[targetSlot] = copyGroup(internalRotated[sourceSlot], seatCapacity);
  });

  rotated.groupCount = activeCount;
  return rotated;
};

const resolveFourActiveSlots = (activeGroups: number | number[]): number[] => {
  if (Array.isArray(activeGroups)) {
    return activeGroups.filter((index) => index >= 0 && index < 4);
  }
  return Array.from({ length: activeGroups }, (_, index) => index);
};

export const rotateFourGroupOrderForWeek = (groupOrder: number[], activeGroups: number | number[], config?: RotationConfig | null): number[] => {
  const rc = config ?? defaultRotationConfig('four');
  const activeSlots = resolveFourActiveSlots(activeGroups);
  const rotated = [...groupOrder];
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
    const sourceSlot = activeSlots[sourceIdx];
    rotated[targetSlot] = groupOrder[sourceSlot] || sourceSlot + 1;
  });

  return rotated;
};

export const rotateFourGroupLabelsForWeek = (groupLabels: string[], activeGroups: number | number[], config?: RotationConfig | null): string[] => {
  const rc = config ?? defaultRotationConfig('four');
  if (rc.labelRotation !== 'rotate') {
    return normalizeGroupLabels(groupLabels);
  }
  const activeSlots = resolveFourActiveSlots(activeGroups);
  const rotated = normalizeGroupLabels(groupLabels);
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeSlots.forEach((targetSlot, index) => {
    const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
    const sourceSlot = activeSlots[sourceIdx];
    rotated[targetSlot] = groupLabels[sourceSlot] || `${sourceSlot + 1}`;
  });

  return rotated;
};

const getCampRotationCycles = (groupCount: number, rotation: GroupRotation): number[][] => {
  const count = normalizeCampGroupCount(groupCount);
  if (rotation === 'row-left') {
    return [Array.from({ length: count }, (_, index) => index)];
  }
  if (rotation === 'clockwise' || rotation === 'counterclockwise') {
    return [count === 8 ? [0, 1, 2, 3, 7, 6, 5, 4] : [0, 1, 2, 5, 4, 3]];
  }
  if (rotation === 'front-back-swap') {
    return [count === 8 ? [0, 4, 2, 6, 3, 7, 1, 5] : [0, 4, 2, 3, 1, 5]];
  }
  if (rotation === 'row-right') {
    return count === 8 ? [[0, 1, 2, 3], [4, 5, 6, 7]] : [[0, 1, 2], [3, 4, 5]];
  }
  if (rotation === 'row-swap') {
    return count === 8 ? [[0, 4], [1, 5], [2, 6], [3, 7]] : [[0, 3], [1, 4], [2, 5]];
  }
  return [Array.from({ length: count }, (_, index) => index)];
};

const resolveCampActiveCycles = (activeGroups: number | number[], groupCount = CAMP_DEFAULT_GROUP_COUNT, config?: RotationConfig | null): number[][] => {
  const rc = config ?? defaultRotationConfig('camp');
  const normalizedCount = normalizeCampGroupCount(groupCount);
  const activeSet = new Set(
    Array.isArray(activeGroups)
      ? activeGroups.filter((index) => index >= 0 && index < normalizedCount)
      : Array.from({ length: Math.min(activeGroups, normalizedCount) }, (_, index) => index)
  );
  return getCampRotationCycles(normalizedCount, rc.groupRotation)
    .map((cycle) => cycle.filter((slotIndex) => activeSet.has(slotIndex)))
    .filter((cycle) => cycle.length > 0);
};

export const rotateCampLayoutForWeek = (groups: string[][], config?: RotationConfig | null): string[][] => {
  const rc = config ?? defaultRotationConfig('camp');
  const groupCount = getCampGroupCountFromGroups(groups);
  const normalizedGroups = makeEmptyCampGroups(groupCount);
  groups.slice(0, groupCount).forEach((group, index) => {
    normalizedGroups[index] = copyGroup(group, CAMP_GROUP_SIZE);
  });

  const shift = internalShiftValue(rc.internalRotation);
  const internalRotated = shift === 0
    ? normalizedGroups.map((group) => copyGroup(group, CAMP_GROUP_SIZE))
    : normalizedGroups.map((group) => rotateNames(copyGroup(group, CAMP_GROUP_SIZE), shift));
  const occupiedSlots = getCampOccupiedGroupIndexesFromGroups(internalRotated);
  if (occupiedSlots.length <= 1) {
    return internalRotated;
  }

  const activeCycles = resolveCampActiveCycles(occupiedSlots, groupCount, rc);
  const rotated = internalRotated.map((group) => copyGroup(group, CAMP_GROUP_SIZE));
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeCycles.forEach((activeSlots) => {
    if (activeSlots.length <= 1) {
      return;
    }
    activeSlots.forEach((targetSlot, index) => {
      const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
      const sourceSlot = activeSlots[sourceIdx];
      rotated[targetSlot] = copyGroup(internalRotated[sourceSlot], CAMP_GROUP_SIZE);
    });
  });

  return rotated;
};

export const rotateCampGroupOrderForWeek = (groupOrder: number[], activeGroups: number | number[], config?: RotationConfig | null, groupCount = CAMP_DEFAULT_GROUP_COUNT): number[] => {
  const rc = config ?? defaultRotationConfig('camp');
  const normalizedCount = normalizeCampGroupCount(groupCount);
  const activeCycles = resolveCampActiveCycles(activeGroups, normalizedCount, rc);
  const rotated = [...Array.from({ length: normalizedCount }, (_, index) => groupOrder[index] || index + 1)];
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeCycles.forEach((activeSlots) => {
    if (activeSlots.length <= 1) {
      return;
    }
    activeSlots.forEach((targetSlot, index) => {
      const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
      const sourceSlot = activeSlots[sourceIdx];
      rotated[targetSlot] = groupOrder[sourceSlot] || sourceSlot + 1;
    });
  });

  return rotated;
};

export const rotateCampGroupLabelsForWeek = (groupLabels: string[], activeGroups: number | number[], config?: RotationConfig | null, groupCount = CAMP_DEFAULT_GROUP_COUNT): string[] => {
  const rc = config ?? defaultRotationConfig('camp');
  const normalizedCount = normalizeCampGroupCount(groupCount);
  if (rc.labelRotation !== 'rotate') {
    return normalizeGroupLabels(groupLabels, normalizedCount);
  }
  const activeCycles = resolveCampActiveCycles(activeGroups, normalizedCount, rc);
  const rotated = normalizeGroupLabels(groupLabels, normalizedCount);
  const direction = rc.groupRotation === 'counterclockwise' ? 1 : -1;

  activeCycles.forEach((activeSlots) => {
    if (activeSlots.length <= 1) {
      return;
    }
    activeSlots.forEach((targetSlot, index) => {
      const sourceIdx = ((index + direction) % activeSlots.length + activeSlots.length) % activeSlots.length;
      const sourceSlot = activeSlots[sourceIdx];
      rotated[targetSlot] = groupLabels[sourceSlot] || `${sourceSlot + 1}`;
    });
  });

  return rotated;
};

export const applyManualGrouping = (
  layout: LayoutType,
  groupCount: number,
  students: string[]
): { layout: LayoutType; groups: string[][]; rowGroups: RowGroups; fourGroups: FourGroups } => {
  const normalized = normalizeStudentList(students);
  assertStudentLimit(normalized);

  if (!Number.isInteger(groupCount)) {
    throw new Error('组数必须是有效整数');
  }

  if (layout === 'circular') {
    if (groupCount < 1 || groupCount > 6) {
      throw new Error('圆桌布局组数需在1-6之间');
    }
    const seatCapacity = getLayoutGroupSeatCapacity('circular', normalized.length, groupCount);
    if (normalized.length > groupCount * seatCapacity) {
      throw new Error(`圆桌布局${groupCount}组时每组最多${seatCapacity}人，当前无法分配`);
    }

    return {
      layout,
      groups: convertStudentsToCircular(normalized, groupCount),
      rowGroups: makeEmptyRowGroups(),
      fourGroups: makeEmptyFourGroups()
    };
  }

  if (layout === 'rows') {
    if (groupCount < 1 || groupCount > 6) {
      throw new Error('三横排组数需在1-6之间');
    }
    const seatCapacity = getLayoutGroupSeatCapacity('rows', normalized.length, groupCount);
    if (normalized.length > groupCount * seatCapacity) {
      throw new Error(`三横排${groupCount}组时每组最多${seatCapacity}人，当前无法分配`);
    }

    return {
      layout,
      groups: makeEmptyCircularGroups(),
      rowGroups: convertStudentsToRows(normalized, groupCount),
      fourGroups: makeEmptyFourGroups()
    };
  }

  if (layout === 'four') {
    if (groupCount < 3 || groupCount > 4) {
      throw new Error('四大组布局组数需在3-4之间');
    }
    const seatCapacity = getLayoutGroupSeatCapacity('four', normalized.length, groupCount);
    if (normalized.length > groupCount * seatCapacity) {
      throw new Error(`四大组布局${groupCount}组时每组最多${seatCapacity}人，当前无法分配`);
    }

    return {
      layout,
      groups: makeEmptyCircularGroups(),
      rowGroups: makeEmptyRowGroups(),
      fourGroups: convertStudentsToFour(normalized, groupCount)
    };
  }

  if (layout === 'camp') {
    const normalizedGroupCount = normalizeCampGroupCount(groupCount);
    if (normalizedGroupCount !== groupCount) {
      throw new Error('夏令营布局组数只能是6组或8组');
    }
    if (normalized.length > normalizedGroupCount * CAMP_GROUP_SIZE) {
      throw new Error(`夏令营布局${normalizedGroupCount}组时最多${normalizedGroupCount * CAMP_GROUP_SIZE}人，当前无法分配`);
    }

    return {
      layout,
      groups: convertStudentsToCamp(normalized, normalizedGroupCount),
      rowGroups: makeEmptyRowGroups(),
      fourGroups: makeEmptyFourGroups()
    };
  }

  throw new Error('不支持的布局类型');
};

export const layoutMaxStudents = (layout: LayoutType): number => {
  if (layout === 'circular' || layout === 'rows' || layout === 'four' || layout === 'camp') {
    return MAX_STUDENT_LIMIT;
  }
  return MAX_STUDENT_LIMIT;
};
