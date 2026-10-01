import { addDays, dateKeyToMonthDay, monthDayToDateKey, parseDateFromClassTime } from './calendar';
import {
  defaultRotationConfig,
  convertStudentsToCamp,
  convertStudentsToCircular,
  convertStudentsToFour,
  convertStudentsToRows,
  getCampGroupCountFromGroups,
  getCampOccupiedGroupIndexesFromGroups,
  getCircularGroupCount,
  getCircularOccupiedGroupIndexesFromGroups,
  getFourOccupiedGroupIndexesFromGroups,
  getRowGroupCount,
  getRowsOccupiedSlotsFromGroups,
  normalizeGroupLabels,
  normalizeStudentList,
  rotateCampGroupLabelsForWeek,
  rotateCampGroupOrderForWeek,
  rotateCampLayoutForWeek,
  rotateCircularGroupOrderForWeek,
  rotateCircularGroupLabelsForWeek,
  rotateCircularLayoutForWeek,
  rotateFourGroupOrderForWeek,
  rotateFourGroupLabelsForWeek,
  rotateFourLayoutForWeek,
  rotateRowsGroupOrderForWeek,
  rotateRowsGroupLabelsForWeek,
  rotateRowsLayoutForWeek,
} from './layouts';
import {
  buildIdentityTokenMode,
  captureLayoutIdentity,
  captureRotatedLayoutIdentity,
  getStudentIdPositionMap,
} from './layoutIdentity';
import {
  CAMP_DEFAULT_GROUP_COUNT,
  CAMP_GROUP_SIZE,
  MAX_STUDENT_LIMIT,
  makeEmptyCampGroups,
  makeEmptyCircularGroups,
  makeEmptyFourGroups,
  makeEmptyRowGroups
} from './state';
import type { AppState, ClassConfig, LocationInfo, TimeMode } from './types';

export interface ImportedLayoutState {
  currentLayout: AppState['currentLayout'];
  groups: AppState['groups'];
  currentGroupOrder: AppState['currentGroupOrder'];
  currentGroupLabels: AppState['currentGroupLabels'];
  rowGroups: AppState['rowGroups'];
  fourGroups: AppState['fourGroups'];
  currentArrangement: number;
  successMessage: string;
}

const makeBlankImportedLayoutState = (layout: AppState['currentLayout']): Omit<ImportedLayoutState, 'successMessage'> => ({
  currentLayout: layout,
  groups: makeEmptyCircularGroups(),
  currentGroupOrder: [1, 2, 3, 4, 5, 6],
  currentGroupLabels: ['1', '2', '3', '4', '5', '6'],
  rowGroups: makeEmptyRowGroups(),
  fourGroups: makeEmptyFourGroups(),
  currentArrangement: 0,
});

const fillSequentialGroups = (students: string[], groupCount: number, seatSize: number): string[][] =>
  Array.from({ length: groupCount }, (_, index) =>
    students
      .slice(index * seatSize, (index + 1) * seatSize)
      .concat(Array(seatSize).fill(''))
      .slice(0, seatSize),
  );

export const buildCircularImportState = (students: string[]): ImportedLayoutState => {
  const normalized = normalizeStudentList(students);
  if (normalized.length === 0) {
    throw new Error('请至少输入1名学生');
  }
  if (normalized.length > MAX_STUDENT_LIMIT) {
    throw new Error(`圆桌布局最多${MAX_STUDENT_LIMIT}人，当前${normalized.length}人`);
  }

  const groupCount = getCircularGroupCount(normalized.length);
  return {
    ...makeBlankImportedLayoutState('circular'),
    currentLayout: 'circular',
    groups: convertStudentsToCircular(normalized, groupCount),
    successMessage: `成功导入${normalized.length}人，分为${groupCount}组`,
  };
};

export const buildRowsImportState = (students: string[]): ImportedLayoutState => {
  const normalized = normalizeStudentList(students);
  if (normalized.length === 0) {
    throw new Error('请至少输入1名学生');
  }
  if (normalized.length > MAX_STUDENT_LIMIT) {
    throw new Error(`三横排布局最多${MAX_STUDENT_LIMIT}人，当前${normalized.length}人`);
  }

  const groupCount = getRowGroupCount(normalized.length);
  return {
    ...makeBlankImportedLayoutState('rows'),
    currentLayout: 'rows',
    rowGroups: convertStudentsToRows(normalized, groupCount),
    successMessage: `成功导入${normalized.length}人，分为${groupCount}组`,
  };
};

export const buildFourImportState = (students: string[]): ImportedLayoutState => {
  const normalized = normalizeStudentList(students);
  if (normalized.length === 0) {
    throw new Error('请至少输入1名学生');
  }
  if (normalized.length > MAX_STUDENT_LIMIT) {
    throw new Error(`四大组布局最多${MAX_STUDENT_LIMIT}人，当前${normalized.length}人`);
  }

  return {
    ...makeBlankImportedLayoutState('four'),
    currentLayout: 'four',
    fourGroups: convertStudentsToFour(normalized, 4),
    successMessage: `成功导入${normalized.length}人，默认分为4个大组`,
  };
};

export const buildCampImportState = (students: string[], groupCount = CAMP_DEFAULT_GROUP_COUNT): ImportedLayoutState => {
  const normalized = normalizeStudentList(students);
  if (normalized.length === 0) {
    throw new Error('请至少输入1名学生');
  }
  if (normalized.length > MAX_STUDENT_LIMIT) {
    throw new Error(`夏令营布局最多${MAX_STUDENT_LIMIT}人，当前${normalized.length}人`);
  }
  if (groupCount !== 6 && groupCount !== 8) {
    throw new Error('夏令营布局只能选择6组或8组');
  }
  if (normalized.length > groupCount * CAMP_GROUP_SIZE) {
    throw new Error(`夏令营${groupCount}组最多${groupCount * CAMP_GROUP_SIZE}人，当前${normalized.length}人`);
  }

  return {
    ...makeBlankImportedLayoutState('camp'),
    currentLayout: 'camp',
    groups: normalized.length > 36
      ? convertStudentsToCamp(normalized, groupCount)
      : (() => {
        const groups = makeEmptyCampGroups(groupCount);
        fillSequentialGroups(normalized, groupCount, CAMP_GROUP_SIZE).forEach((group, index) => {
          groups[index] = group;
        });
        return groups;
      })(),
    currentGroupOrder: Array.from({ length: groupCount }, (_, index) => index + 1),
    currentGroupLabels: Array.from({ length: groupCount }, (_, index) => String(index + 1)),
    successMessage: `成功导入${normalized.length}人，按夏令营布局分为${groupCount}组`,
  };
};

export const rotateLocationInfoByWeek = (info: LocationInfo): LocationInfo => {
  const next = { ...info };
  const currentKey = next.fullDate || monthDayToDateKey(next.date, next.day) || parseDateFromClassTime(next.time) || '';

  if (!currentKey) {
    return next;
  }

  const nextKey = addDays(currentKey, 7);
  if (!nextKey) {
    return next;
  }

  const converted = dateKeyToMonthDay(nextKey);
  next.fullDate = nextKey;
  if (converted) {
    next.date = converted.month;
    next.day = converted.day;
    if (!next.weekday) {
      next.weekday = converted.weekday;
    }
  }

  return next;
};

const rotateLegacyTimeModeData = (
  mode: ClassConfig[TimeMode],
  nextLocationInfo: LocationInfo,
  options: { legacyRowsPath?: boolean } = {},
): ClassConfig[TimeMode] => {
  const rc = mode.rotationConfig ?? defaultRotationConfig(mode.layout);

  if (mode.layout === 'circular') {
    const activeGroups = getCircularOccupiedGroupIndexesFromGroups(mode.groups || makeEmptyCircularGroups());
    return {
      ...mode,
      groups: rotateCircularLayoutForWeek(mode.groups || makeEmptyCircularGroups(), rc),
      groupOrder: rotateCircularGroupOrderForWeek(mode.groupOrder || [1, 2, 3, 4, 5, 6], activeGroups, rc),
      groupLabels: rotateCircularGroupLabelsForWeek(normalizeGroupLabels(mode.groupLabels), activeGroups, rc),
      currentArrangement: (mode.currentArrangement + 1) % 200,
      locationInfo: nextLocationInfo,
    };
  }

  if (mode.layout === 'rows') {
    const rowGroups = mode.rowGroups || makeEmptyRowGroups();
    const rowActiveSlots = getRowsOccupiedSlotsFromGroups(rowGroups);
    const pathVersion = options.legacyRowsPath ? 'legacy' : 'current';
    return {
      ...mode,
      rowGroups: rotateRowsLayoutForWeek(rowGroups, rc, pathVersion),
      groupOrder: rotateRowsGroupOrderForWeek(mode.groupOrder || [1, 2, 3, 4, 5, 6], rowActiveSlots, rc, pathVersion),
      groupLabels: rotateRowsGroupLabelsForWeek(normalizeGroupLabels(mode.groupLabels), rowActiveSlots, rc, pathVersion),
      currentArrangement: (mode.currentArrangement + 1) % 200,
      locationInfo: nextLocationInfo,
    };
  }

  if (mode.layout === 'four') {
    const activeGroups = getFourOccupiedGroupIndexesFromGroups(mode.fourGroups || makeEmptyFourGroups());
    return {
      ...mode,
      fourGroups: rotateFourLayoutForWeek(mode.fourGroups || makeEmptyFourGroups(), rc),
      groupOrder: rotateFourGroupOrderForWeek(mode.groupOrder || [1, 2, 3, 4, 5, 6], activeGroups, rc),
      groupLabels: rotateFourGroupLabelsForWeek(normalizeGroupLabels(mode.groupLabels), activeGroups, rc),
      currentArrangement: (mode.currentArrangement + 1) % 200,
      locationInfo: nextLocationInfo,
    };
  }
  if (mode.layout === 'camp') {
    const campGroups = mode.groups || makeEmptyCampGroups();
    const groupCount = getCampGroupCountFromGroups(campGroups);
    const activeGroups = getCampOccupiedGroupIndexesFromGroups(campGroups);
    return {
      ...mode,
      groups: rotateCampLayoutForWeek(campGroups, rc),
      groupOrder: rotateCampGroupOrderForWeek(mode.groupOrder || [1, 2, 3, 4, 5, 6, 7, 8], activeGroups, rc, groupCount),
      groupLabels: rotateCampGroupLabelsForWeek(normalizeGroupLabels(mode.groupLabels, groupCount), activeGroups, rc, groupCount),
      currentArrangement: (mode.currentArrangement + 1) % 200,
      locationInfo: nextLocationInfo,
    };
  }
  return mode;
};

export const rotateTimeModeData = (
  mode: ClassConfig[TimeMode],
  nextLocationInfo: LocationInfo,
  options: { legacyRowsPath?: boolean } = {},
): ClassConfig[TimeMode] => {
  const identity = captureLayoutIdentity(mode, mode.layoutIdentity);
  const source = { ...mode, layoutIdentity: identity };
  const rotated = rotateLegacyTimeModeData(source, nextLocationInfo, options);
  const tokenMode = buildIdentityTokenMode(source, identity);
  const rotatedTokenMode = rotateLegacyTimeModeData(tokenMode, nextLocationInfo, options);

  return {
    ...rotated,
    layoutIdentity: captureRotatedLayoutIdentity(
      rotated,
      identity,
      getStudentIdPositionMap(rotatedTokenMode),
    ),
  };
};
