import {
  SPARKCHAT_ACTIVITY_NOTICE_ENTRIES,
  SPARKCHAT_DAILY_GOAL_ENTRIES,
  SPARKCHAT_TOPIC_CONTENT,
  type SparkchatActivityNoticeEntry,
  type SparkchatDailyGoalEntry,
  type SparkchatTopicContent,
} from './campLatestStandard';

export type {
  SparkchatActivityNoticeEntry,
  SparkchatDailyGoalEntry,
  SparkchatTopicContent,
};

export const SPARKCHAT_REPORT_MAJOR_LEVEL = 'L2' as const;

export function isSparkchatReportMajor(majorLevel: string): boolean {
  return majorLevel === SPARKCHAT_REPORT_MAJOR_LEVEL;
}

export function findSparkchatDailyGoalEntry(
  date: string,
  majorLevel: string,
  normalizedMinorCamp: string,
): SparkchatDailyGoalEntry | null {
  if (!isSparkchatReportMajor(majorLevel)) return null;
  return SPARKCHAT_DAILY_GOAL_ENTRIES.find((entry) => (
    entry.date === date
    && entry.minorCamp === normalizedMinorCamp
  )) || null;
}

export function getSparkchatTopicContent(
  topic: string,
  majorLevel: string,
): SparkchatTopicContent | undefined {
  if (!isSparkchatReportMajor(majorLevel)) return undefined;
  return SPARKCHAT_TOPIC_CONTENT[topic];
}

export function getSparkchatActivityNoticeEntries(
  date: string,
  majorLevel: string,
  normalizedMinorCamp: string,
): SparkchatActivityNoticeEntry[] {
  if (!isSparkchatReportMajor(majorLevel)) return [];
  return SPARKCHAT_ACTIVITY_NOTICE_ENTRIES.filter((entry) => (
    entry.date === date
    && entry.minorCamp === normalizedMinorCamp
  ));
}

export function getSparkchatActivityNoticeText(entry: SparkchatActivityNoticeEntry): string {
  return entry.noticeText.trim();
}
