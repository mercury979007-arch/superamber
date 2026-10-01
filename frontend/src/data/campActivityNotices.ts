// Add organization-specific notice data in a private deployment layer.
import type { CampMajorLevel } from './campReportCatalog';

export interface CampActivityNoticeEntry {
  date: string;
  majorLevel: CampMajorLevel;
  minorCamp: string;
  periodLabel: string;
  time: string;
  activityName: string;
  activityType: string;
}

export const CAMP_ACTIVITY_NOTICE_TEXT: Record<string, string> = {};
export const CAMP_ACTIVITY_NOTICE_ALIASES: Record<string, string> = {};
export const CAMP_ACTIVITY_NOTICE_ENTRIES: CampActivityNoticeEntry[] = [];
