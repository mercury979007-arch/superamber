export type SpeakingDayStatus = 'normal' | 'supplement' | 'missed';

export interface SpeakingChallengeDay {
  date: string;
  status: SpeakingDayStatus;
  words?: number | null;
}

export interface SpeakingChallengeStudent {
  rank: number;
  studentKey?: string;
  studentId?: string;
  englishName: string;
  chineseName: string;
  daily: SpeakingChallengeDay[];
  normalDays: number;
  supplementDays: number;
  totalDays: number;
  streakDays: number;
}

export interface SpeakingChallengeWindow {
  id: string;
  start: string;
  end: string;
  fullEnd: string;
  dates: string[];
  complete: boolean;
}

export interface SpeakingLeaderboard {
  challenge: SpeakingChallengeWindow;
  classCode: string;
  totalStudents: number;
  activeStudents: number;
  threeDayStudents: number;
  maxStreak: number;
  students: SpeakingChallengeStudent[];
}

export interface SpeakingRewardConfig {
  basePerDay: number;
  streakThreshold: number;
  streakMultiplier: number;
  rewardMode: 'multiplier' | 'fixed';
  thresholdBonus: number;
  ignoreSupplementVariance: boolean;
}

export interface SpeakingPendingRecovery {
  planId: string; startedAt: string; deferred: boolean;
  confirmedCount: number; confirmedTotalMP: number; unresolvedCount: number; totalMP: number;
  selectedDates: string[]; config: SpeakingRewardConfig; lastError: string; checkedAt: string | null;
  students: Array<{ name: string; amount: number }>;
}

export interface SpeakingPendingResolution {
  rewardState: SpeakingRewardState; message: string; retryReady: boolean;
  selectedDates: string[]; config: SpeakingRewardConfig; plan?: SpeakingRewardPlan | null;
}

export interface SpeakingRewardState {
  configLocked: boolean;
  baseConfigLocked: boolean;
  streakConfigLocked: boolean;
  config: SpeakingRewardConfig;
  issuedTotal: number;
  issuedDates: string[];
  issuedBasePerDayByDate: Record<string, number>;
  pending: boolean;
  pendingMessage: string;
  recoveryMessage?: string;
  recovery?: SpeakingPendingRecovery | null;
  deferredDates?: string[];
}

export interface SpeakingRewardSelection {
  baseStrategy: 'none' | 'repeat' | 'unissued';
  includeStreak: boolean;
  missedBasePerDay?: number;
}

export interface SpeakingRewardBreakdownSummary {
  standardBase: { studentCount: number; totalMP: number };
  repeatedBase: { studentCount: number; totalMP: number };
  unissuedBase: { studentCount: number; totalMP: number };
  streak: { studentCount: number; totalMP: number };
}

export interface SpeakingChallengeClassResult {
  leaderboard: SpeakingLeaderboard;
  rewardState: SpeakingRewardState;
  updatedAt: string;
}

export interface SpeakingRewardPlanItem {
  rank: number;
  englishName: string;
  chineseName: string;
  streakDays: number;
  totalDays: number;
  supplementDays: number;
  alreadyIssued: number;
  cumulativeAmount: number;
  standardBaseAmount: number;
  repeatedBaseAmount: number;
  unissuedBaseAmount: number;
  streakAmount: number;
  amount: number;
}

export interface SpeakingRewardPlan {
  recoveryOf?: string | null;
  planId: string;
  expiresAt: string;
  classCode: string;
  challenge: SpeakingChallengeWindow;
  config: SpeakingRewardConfig;
  configLocked: boolean;
  baseConfigLocked: boolean;
  streakConfigLocked: boolean;
  selection: SpeakingRewardSelection;
  selectedDates: string[];
  rewards: SpeakingRewardPlanItem[];
  studentCount: number;
  totalMP: number;
  breakdown: SpeakingRewardBreakdownSummary;
  balance: number | null;
}

export interface SpeakingRewardIssueResult {
  successCount: number;
  failedCount: number;
  totalMP: number;
  failedStudents: string[];
  failureMessage?: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  balanceVerified: boolean;
  rewardState: SpeakingRewardState;
}

export class SpeakingChallengeApiError extends Error {
  status: number;
  rewardState: SpeakingRewardState | null;

  constructor(message: string, status: number, rewardState: SpeakingRewardState | null = null) {
    super(message);
    this.name = 'SpeakingChallengeApiError';
    this.status = status;
    this.rewardState = rewardState;
  }
}

async function postJson<T>(path: string, body: unknown, fallbackMessage: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    signal: AbortSignal.timeout(path.endsWith('/issue') ? 120000 : 60000),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SpeakingChallengeApiError(
      response.status === 401 ? '未登录，请先登录' : String(data?.error || fallbackMessage),
      response.status,
      data?.rewardState || null,
    );
  }
  return data as T;
}

export async function fetchSpeakingChallengeClass(classId: string): Promise<SpeakingChallengeClassResult> {
  const data = await postJson<{
    status: 'success';
    leaderboard: SpeakingLeaderboard;
    rewardState: SpeakingRewardState;
    updatedAt: string;
  }>('/api/data/speaking-challenge/class', { classId }, '每日开口数据读取失败');
  return {
    leaderboard: data.leaderboard,
    rewardState: data.rewardState,
    updatedAt: data.updatedAt,
  };
}

export async function createSpeakingRewardPlan(
  classId: string,
  config: SpeakingRewardConfig,
  selectedDates: string[],
  selection: SpeakingRewardSelection,
): Promise<SpeakingRewardPlan> {
  const data = await postJson<{ status: 'success'; plan: SpeakingRewardPlan }>(
    '/api/data/speaking-challenge/reward-plan',
    { classId, config, selectedDates, selection },
    'MiniPin 发放清单生成失败',
  );
  return data.plan;
}

export async function issueSpeakingRewardPlan(planId: string): Promise<SpeakingRewardIssueResult> {
  const data = await postJson<{ status: 'success'; result: SpeakingRewardIssueResult }>(
    '/api/data/speaking-challenge/issue',
    { planId, acknowledged: true },
    'MiniPin 发放失败',
  );
  return data.result;
}

export async function resolveSpeakingPending(classId: string, planId: string, action: 'check' | 'defer' | 'retry', acknowledgedNotReceived = false): Promise<SpeakingPendingResolution> {
  return postJson('/api/data/speaking-challenge/resolve-pending', { classId, planId, action, acknowledgedNotReceived }, '旧单处理失败，请稍后再试');
}
