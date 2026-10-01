import academicCalendar from '../../../config/academic-calendar.json';

export interface AcademicTermLaunchResult {
  shouldCelebrate: boolean;
  performed: boolean;
  classCount: number;
  week1Start: string;
  alreadyReady: boolean;
  cloudSynced: boolean;
}

// Kept inert for old callers: opening a page never rotates or restores seating.
export async function runAcademicTermLaunch(
  _activeClassCodes: string[],
  _now = new Date(),
): Promise<AcademicTermLaunchResult> {
  return {
    shouldCelebrate: false, performed: false, classCount: 0,
    week1Start: academicCalendar.currentTerm.week1Start,
    alreadyReady: false, cloudSynced: false,
  };
}
