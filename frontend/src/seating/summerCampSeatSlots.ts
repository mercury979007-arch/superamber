import {
  CAMP_ALLOWED_GROUP_COUNTS,
  CAMP_DEFAULT_GROUP_COUNT,
  CAMP_GROUP_SIZE,
  makeEmptyCampGroups,
} from './state';

type CampGroupCount = typeof CAMP_ALLOWED_GROUP_COUNTS[number];

const normalizeSeatSlots = (students: string[] = [], size: number): string[] =>
  Array.from({ length: size }, (_, index) => (students[index] || '').trim());

const normalizeSummerCampGroupCount = (groupCount: number | null | undefined): CampGroupCount =>
  CAMP_ALLOWED_GROUP_COUNTS.includes(groupCount as CampGroupCount)
    ? groupCount as CampGroupCount
    : CAMP_DEFAULT_GROUP_COUNT;

export const normalizeSummerCampSeatSlots = (students: string[] = []): string[] =>
  normalizeSeatSlots(students, CAMP_GROUP_SIZE);

export const hasSummerCampSeatValue = (group: string[] = []): boolean =>
  normalizeSummerCampSeatSlots(group).some(Boolean);

export const resolveSavedSummerCampGroupCount = (groups: string[][] = []): CampGroupCount =>
  normalizeSummerCampGroupCount(groups.length > 6 || groups.slice(6).some(hasSummerCampSeatValue) ? 8 : 6);

export const resolveImportedSummerCampGroupCount = (groups: string[][] = []): CampGroupCount =>
  normalizeSummerCampGroupCount(groups.slice(6).some(hasSummerCampSeatValue) ? 8 : 6);

export function sanitizeSummerCampSeatGroups(
  groups: string[][] = [],
  groupCount: CampGroupCount = resolveSavedSummerCampGroupCount(groups),
): string[][] {
  const normalizedGroupCount = normalizeSummerCampGroupCount(groupCount);
  const base = makeEmptyCampGroups(normalizedGroupCount);
  groups.slice(0, normalizedGroupCount).forEach((group, index) => {
    base[index] = normalizeSummerCampSeatSlots(group);
  });
  return base;
}
