export interface ClassInfo {
  id: string;
  name: string;
  squadId?: string;
  relationship?: 'current-head-teacher' | 'co-head-teacher' | 'manageable';
  sources?: string[];
  type?: 'offline' | 'online';
}

export interface StudentRecord {
  studentId: string;
  chineseName: string;
  englishName: string;
  classCode: string;
}

export interface ResourceEntry {
  resourceName: string;
  resourceType: string;
  columns: Record<string, string | number | null>;
}

export interface StudentData extends StudentRecord {
  resources: ResourceEntry[];
  dailyCheckIns: number;
  classParticipation: number;
  bonusItems: BonusItem[];
}

export interface BonusItem {
  name: string;
  amount: number;
  studentIds: string[];
}

export interface SchemeSettings {
  scheme2AllDoneAmount: number;
}

export interface MPBreakdown {
  studentId: string;
  chineseName: string;
  englishName: string;
  基础落实: number;
  每日开口: number;
  课堂参与: number;
  个性化奖励: number;
  total: number;
}

export type SchemeId = string;

export interface RuleTemplate {
  id: string;
  label: string;
  group: string;
  hasThreshold: boolean;
  defaultAmount: number;
  defaultThreshold: number;
}

export interface SchemeRuleConfig {
  templateId: string;
  enabled: boolean;
  amount: number;
  threshold: number;
}

export interface SavedCustomScheme {
  id: string;
  name: string;
  rules: SchemeRuleConfig[];
  createdAt: number;
}

export type Module = '基础落实' | '每日开口' | '课堂参与' | '个性化奖励';

export interface BonusHistoryRecord {
  classCode: string;
  week: number;
  studentNames: string[];
  amount: number;
  timestamp: number;
}

export interface BonusHistoryEntry {
  bonusName: string;
  lastAmount: number;
  records: BonusHistoryRecord[];
}

export type AppScreen = 'login' | 'welcome' | 'hub' | 'flow' | 'seating' | 'overview' | 'communication-planner' | 'makeup' | 'daily-report' | 'classroom-agent' | 'roster' | 'usage-insights' | 'data-review' | 'test-score-entry' | 'camp-report' | 'camp-schedule' | 'summer-camp';

export type DayOfWeek = '周一' | '周二' | '周三' | '周四' | '周五' | '周六' | '周日';

export interface ClassSchedule {
  classCode: string;
  days: DayOfWeek[];
}

export interface ScheduleSlot {
  day: DayOfWeek;
  time: string;
}

export interface StudentInfo {
  id: string;
  studentId?: string;
  chineseName: string;
  englishName?: string;
  aliases?: string[];
}

export interface ClassProfile {
  classCode: string;
  schedule: ScheduleSlot[];
  students: StudentInfo[];
  updatedAt: number;
}

export type WelcomeView = 'byClass' | 'byDate';

export interface AppState {
  screen: AppScreen;
  teacherName: string;
  classes: ClassInfo[];
  selectedClass: ClassInfo | null;
}
