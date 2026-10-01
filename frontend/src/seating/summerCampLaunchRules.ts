const getScheduleIndex = (scheduleDates: string[], date: string): number =>
  scheduleDates.indexOf(date);

export function getSummerCampAutoAdvanceTarget(
  scheduleDates: string[],
  operationalDate: string,
  storedDate: string,
): string | null {
  const operationalIndex = getScheduleIndex(scheduleDates, operationalDate);
  const storedIndex = getScheduleIndex(scheduleDates, storedDate);
  if (operationalIndex < 0 || storedIndex < 0 || storedIndex >= operationalIndex) {
    return null;
  }
  return operationalDate;
}

export function resolveSummerCampLaunchDate(
  scheduleDates: string[],
  operationalDate: string,
  storedDate: string,
  preferredDate: string,
): string {
  const operationalIndex = getScheduleIndex(scheduleDates, operationalDate);
  const storedIndex = getScheduleIndex(scheduleDates, storedDate);
  if (storedIndex >= 0 && storedIndex >= operationalIndex) {
    return storedDate;
  }
  if (storedIndex >= 0) {
    return operationalDate;
  }

  const preferredIndex = getScheduleIndex(scheduleDates, preferredDate);
  if (preferredIndex >= 0 && preferredIndex >= operationalIndex) {
    return preferredDate;
  }

  return operationalDate;
}

export function shouldPreserveExistingCampPresetSeating(
  existingStudentCount: number,
  confirmOverwrite: boolean | undefined,
  needsShapeRefresh: boolean,
): boolean {
  return existingStudentCount > 0 && confirmOverwrite === false && !needsShapeRefresh;
}
