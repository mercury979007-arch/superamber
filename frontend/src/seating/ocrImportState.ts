import { monthDayToDateKey } from './calendar';
import { getRowsSlotMap, normalizeStudentList } from './layouts';
import { MAX_STUDENT_LIMIT, getLayoutGroupSeatCapacity, makeEmptyCampGroups, makeEmptyCircularGroups, makeEmptyFourGroups, makeEmptyLocationInfo } from './state';
import { normalizeSummerCampSeatSlots, resolveImportedSummerCampGroupCount } from './summerCampSeatSlots';
import type { ClassConfig, LayoutType, LocationInfo, TimeMode } from './types';

export interface OCRImportDraftInput {
  layout: LayoutType;
  groupsText: string;
  date: string;
  day: string;
  weekday: string;
  time: string;
  campus: string;
  floor: string;
  room: string;
  fullDate: string;
}

export function draftToModeData(
  draft: OCRImportDraftInput,
  options: {
    parseGroupsText: (layout: LayoutType, text: string) => string[][];
  },
): ClassConfig[TimeMode] {
  const info: LocationInfo = {
    ...makeEmptyLocationInfo(),
    date: draft.date,
    day: draft.day,
    weekday: draft.weekday,
    time: draft.time,
    campus: draft.campus,
    floor: draft.floor,
    room: draft.room,
    fullDate: draft.fullDate || monthDayToDateKey(draft.date, draft.day) || '',
  };

  const assertLimit = (groups: string[][]): number => {
    const count = normalizeStudentList(groups.flat()).length;
    if (count > MAX_STUDENT_LIMIT) {
      throw new Error(`所有布局最多${MAX_STUDENT_LIMIT}人，当前${count}人`);
    }
    return count;
  };

  if (draft.layout === 'circular') {
    const parsedGroups = options.parseGroupsText('circular', draft.groupsText);
    const seatCapacity = getLayoutGroupSeatCapacity('circular', assertLimit(parsedGroups), 6);
    const groups = makeEmptyCircularGroups(seatCapacity);
    parsedGroups.slice(0, 6).forEach((group, index) => {
      groups[index] = normalizeStudentList(group).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
    });

    return {
      layout: 'circular',
      groups,
      groupOrder: [1, 2, 3, 4, 5, 6],
      rowGroups: null,
      fourGroups: null,
      currentArrangement: 0,
      locationInfo: info,
    };
  }

  if (draft.layout === 'rows') {
    const parsedGroups = options.parseGroupsText('rows', draft.groupsText);
    const groupCount = parsedGroups.filter((group) => group.some((name) => name.trim())).length || 4;
    const seatCapacity = getLayoutGroupSeatCapacity('rows', assertLimit(parsedGroups), groupCount);
    const slotMap = getRowsSlotMap(groupCount);
    const slotGroups = Array.from({ length: 6 }, () => Array(seatCapacity).fill(''));

    slotMap.forEach((logicalIndex, slotIndex) => {
      if (logicalIndex === null) {
        return;
      }
      slotGroups[slotIndex] = normalizeStudentList(parsedGroups[logicalIndex] || []).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
    });

    return {
      layout: 'rows',
      groups: null,
      groupOrder: null,
      rowGroups: {
        rows: [
          { left: slotGroups[0], right: slotGroups[1] },
          { left: slotGroups[2], right: slotGroups[3] },
          { left: slotGroups[4], right: slotGroups[5] },
        ],
      },
      fourGroups: null,
      currentArrangement: 0,
      locationInfo: info,
    };
  }

  if (draft.layout === 'four') {
    const parsedGroups = options.parseGroupsText('four', draft.groupsText);
    const seatCapacity = getLayoutGroupSeatCapacity('four', assertLimit(parsedGroups), 4);
    const fourGroups = makeEmptyFourGroups(seatCapacity);
    parsedGroups.slice(0, 4).forEach((group, index) => {
      fourGroups.groups[index] = normalizeStudentList(group).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
    });

    return {
      layout: 'four',
      groups: null,
      groupOrder: [1, 2, 3, 4, 5, 6],
      rowGroups: null,
      fourGroups,
      currentArrangement: 0,
      locationInfo: info,
    };
  }

  if (draft.layout === 'camp') {
    const parsedGroups = options.parseGroupsText('camp', draft.groupsText);
    assertLimit(parsedGroups);
    const detectedCount = resolveImportedSummerCampGroupCount(parsedGroups);
    const groups = makeEmptyCampGroups(detectedCount);
    parsedGroups.slice(0, detectedCount).forEach((group, index) => {
      groups[index] = normalizeSummerCampSeatSlots(group);
    });

    return {
      layout: 'camp',
      groups,
      groupOrder: Array.from({ length: detectedCount }, (_, index) => index + 1),
      groupLabels: Array.from({ length: detectedCount }, (_, index) => String(index + 1)),
      rowGroups: null,
      fourGroups: null,
      currentArrangement: 0,
      locationInfo: info,
    };
  }

  throw new Error('不支持的布局类型');
}
