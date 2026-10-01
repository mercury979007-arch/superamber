// Organization-specific camp content is intentionally excluded from the public source.
export interface SparkchatTopicContent {
  teachingGoals: string[];
  moralGoals: string[];
  afterClass: string;
}

export interface SparkchatDailyGoalEntry extends SparkchatTopicContent {
  date: string;
  majorLevel: 'L2';
  minorCamp: string;
  dayLabel: string;
  topic: string;
}

export interface SparkchatActivityNoticeEntry {
  date: string;
  majorLevel: 'L2';
  minorCamp: string;
  periodLabel: string;
  time: string;
  activityName: string;
  activityType: string;
  noticeText: string;
}

export const SPARKCHAT_TOPIC_CONTENT: Record<string, SparkchatTopicContent> = {};
export const SPARKCHAT_DAILY_GOAL_ENTRIES: SparkchatDailyGoalEntry[] = [];
export const SPARKCHAT_ACTIVITY_NOTICE_ENTRIES: SparkchatActivityNoticeEntry[] = [];
