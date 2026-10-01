import type { ClassInfo, StudentData, StudentRecord } from '../types';
import { generateOutputExcel } from '../utils/parseExcel';

export interface DistributionRewardPayload {
  studentId: string;
  studentName: string;
  chineseName: string;
  aliases: string[];
  amount: number;
  components?: { basic: number; speaking: number };
}

export interface MinipinRecoveryStudent {
  id: string;
  no: string;
  chName: string;
  enName: string;
  mp: number;
  cp: number;
  availableMp: number;
}

export interface MinipinRecoveryContext {
  classCode: string;
  squadId: string;
  students: MinipinRecoveryStudent[];
  tags: Array<{ id: string; name: string }>;
  defaultReason: string;
  readAt: string;
}

export class DistributionSubmitError extends Error {
  responseData: Record<string, any>;

  constructor(message: string, responseData: Record<string, any> = {}) {
    super(message);
    this.name = 'DistributionSubmitError';
    this.responseData = responseData;
  }
}

export interface DailyReportRewardIssueStatus {
  id: string;
  classId: string;
  status: 'pending' | 'uncertain' | 'complete';
  createdAt: string;
  updatedAt: string;
  error: string;
  students: Array<{
    studentId: string;
    studentName: string;
    chineseName: string;
    amount: number;
    status: 'confirmed' | 'not-received' | 'unresolved';
  }>;
}

async function parseRewardIssueResponse(response: Response): Promise<DailyReportRewardIssueStatus | null> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || '发放记录处理失败');
  return (data as { issue?: DailyReportRewardIssueStatus | null }).issue || null;
}

export async function fetchDailyReportRewardIssueStatus(classId: string): Promise<DailyReportRewardIssueStatus | null> {
  const response = await fetch(`/api/data/class-control/reward-issue-status?classId=${encodeURIComponent(classId)}`, {
    credentials: 'include', cache: 'no-store',
  });
  return parseRewardIssueResponse(response);
}

export async function reconcileDailyReportRewardIssue(classId: string, entryId: string): Promise<DailyReportRewardIssueStatus | null> {
  const response = await fetch('/api/data/class-control/reward-issue-reconcile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', cache: 'no-store',
    body: JSON.stringify({ classId, entryId }),
  });
  return parseRewardIssueResponse(response);
}

export async function releaseDailyReportRewardIssue(classId: string, entryId: string): Promise<DailyReportRewardIssueStatus | null> {
  const response = await fetch('/api/data/class-control/reward-issue-release', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', cache: 'no-store',
    body: JSON.stringify({ classId, entryId, acknowledgedNotReceived: true }),
  });
  return parseRewardIssueResponse(response);
}

export function mapQuickClassInfoList(items: Array<Partial<ClassInfo>> = []): ClassInfo[] {
  return items.map((item) => ({
    id: item.id || item.name || '',
    name: item.name || '',
    squadId: item.squadId,
  }));
}

export function mapQuickRosterRows(
  rows: Array<{ no: string; chName: string; enName: string }> = [],
  classCode: string,
): StudentRecord[] {
  return rows.map((row) => ({
    studentId: row.no,
    chineseName: row.chName,
    englishName: row.enName,
    classCode: classCode.toUpperCase(),
  }));
}

export async function loginDistributionClass({
  username,
  password,
  classCode,
}: {
  username: string;
  password: string;
  classCode: string;
}): Promise<{ classes: ClassInfo[]; matchedClass: ClassInfo | null }> {
  const res = await fetch('/api/scraper/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(40000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || '登录失败');
  }

  const classes = mapQuickClassInfoList((data as { classes?: ClassInfo[] }).classes || []);
  const target = classCode.toUpperCase();
  const matchedClass = classes.find((item) => item.name.toUpperCase() === target || item.id.toUpperCase() === target) || null;
  return { classes, matchedClass };
}

export async function resolveDistributionClassFromSession(
  classCode: string,
): Promise<{ loggedIn: boolean; matchedClass: ClassInfo | null }> {
  const healthRes = await fetch('/api/health', {
    credentials: 'include',
    cache: 'no-store',
  });
  const healthData = await healthRes.json().catch(() => ({}));
  if (!healthRes.ok || !healthData?.loggedIn) {
    return { loggedIn: false, matchedClass: null };
  }

  const classRes = await fetch('/api/scraper/get-classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
  });
  const classData = await classRes.json().catch(() => ({}));
  if (classRes.status === 401) {
    return { loggedIn: false, matchedClass: null };
  }
  if (!classRes.ok) {
    throw new Error((classData as { error?: string }).error || '班级列表获取失败');
  }

  const classes = mapQuickClassInfoList(
    (classData as { data?: ClassInfo[]; classes?: ClassInfo[] }).data
    || (classData as { data?: ClassInfo[]; classes?: ClassInfo[] }).classes
    || [],
  );
  const target = classCode.toUpperCase();
  const matchedClass = classes.find((item) => item.name.toUpperCase() === target || item.id.toUpperCase() === target) || null;
  return { loggedIn: true, matchedClass };
}

export async function fetchDistributionRoster(
  squadId: string,
  classCode: string,
): Promise<{ expired: boolean; students: StudentRecord[] }> {
  const res = await fetch('/api/scraper/get-student-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ classId: squadId }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    return { expired: true, students: [] };
  }
  if (!res.ok || !Array.isArray((data as { data?: unknown }).data)) {
    return { expired: false, students: [] };
  }

  return {
    expired: false,
    students: mapQuickRosterRows((data as { data: Array<{ no: string; chName: string; enName: string }> }).data, classCode),
  };
}

export async function fetchDistributionBalance(
  refs: string[],
): Promise<{ expired: boolean; value: number | null; label: string }> {
  let lastLabel = '余额查询失败';

  for (const ref of refs.filter((value, index, list): value is string => !!value && list.indexOf(value) === index)) {
    const res = await fetch('/api/mp/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ classId: ref }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return { expired: true, value: null, label: '登录已过期' };
    }
    if (!res.ok) {
      lastLabel = (data as { error?: string }).error || '余额查询失败';
      continue;
    }

    const rawValue = (data as { minipin?: number | string | null }).minipin;
    const nextValue = Number(rawValue);
    if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '' && Number.isFinite(nextValue)) {
      return {
        expired: false,
        value: nextValue,
        label: `${nextValue} MP`,
      };
    }

    lastLabel = '未识别到 MP 余额';
  }

  return {
    expired: false,
    value: null,
    label: lastLabel === '余额查询失败' ? '查询失败' : lastLabel,
  };
}

export async function submitDistributionRewards(payload: {
  squadId: string;
  className?: string;
  rewards: DistributionRewardPayload[];
  taskSelection?: {
    source: 'class-daily-report';
    selectedWeekIds: string[];
    snapshotUpdatedAt: string;
    speakingRange?: { start: string; end: string };
  };
}): Promise<{ expired: boolean; data: Record<string, any> }> {
  const { squadId, className, rewards, taskSelection } = payload;
  const resp = await fetch('/api/scraper/submit-minipin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      classId: squadId,
      className,
      rewards,
      taskSelection,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    return { expired: true, data: {} };
  }
  if (!resp.ok) {
    throw new DistributionSubmitError((data as { error?: string }).error || '发放失败', data as Record<string, any>);
  }
  return { expired: false, data };
}

export async function fetchMinipinRecoveryContext(
  classId: string,
): Promise<{ expired: boolean; context: MinipinRecoveryContext | null }> {
  const response = await fetch('/api/mp/recovery-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) return { expired: true, context: null };
  if (!response.ok || !Array.isArray(data?.students) || !Array.isArray(data?.tags)) {
    throw new Error((data as { error?: string }).error || '学生 MiniPin 余额读取失败');
  }
  return { expired: false, context: data as MinipinRecoveryContext };
}

export async function submitMinipinRecovery(payload: {
  requestId: string;
  squadId: string;
  className: string;
  reason?: string;
  recoveries: Array<{ studentId: string; amount: number }>;
}): Promise<{ expired: boolean; data: Record<string, any> }> {
  const response = await fetch('/api/scraper/recover-minipin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      classId: payload.squadId,
      className: payload.className,
      reason: payload.reason || '行为习惯',
      recoveries: payload.recoveries,
      requestId: payload.requestId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) return { expired: true, data: {} };
  if (!response.ok) throw new DistributionSubmitError((data as { error?: string }).error || '回收失败', data);
  if (data?.status !== 'success' || Number(data?.success) !== payload.recoveries.length || Number(data?.failed) !== 0) {
    throw new DistributionSubmitError('回收结果无法确认，请先到教务系统核对，禁止重复提交。', data);
  }
  return { expired: false, data };
}

export async function downloadDistributionFallbackExcel({
  rewards,
  classCode,
  fileName,
}: {
  rewards: DistributionRewardPayload[];
  classCode: string;
  fileName?: string;
}): Promise<number> {
  const students: StudentData[] = rewards.map((reward) => ({
    studentId: reward.studentId,
    englishName: reward.studentName,
    chineseName: reward.chineseName,
    classCode,
    resources: [],
    dailyCheckIns: 0,
    classParticipation: 0,
    bonusItems: [],
  }));
  const mpMap = new Map(rewards.map((reward) => [reward.studentId, reward.amount]));
  const buffer = await generateOutputExcel(students, mpMap);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName || `${classCode}_MP发放兜底.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return students.length;
}

function getDownloadName(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }
  const plainMatch = header.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || fallback;
}

async function fetchDistributionImportFile(
  path: string,
  payload: Record<string, unknown>,
  fallbackName: string,
): Promise<File> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    throw new Error('当前还没连接教务系统，请先连接后再试。');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || '教务导入失败');
  }

  const blob = await response.blob();
  const filename = getDownloadName(response.headers.get('Content-Disposition'), fallbackName);
  return new File([blob], filename, {
    type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function importDistributionBasicFileFromAcademicSystem(payload: {
  classId: string;
  className?: string;
  selectedWeekIds?: string[];
  taskSnapshotUpdatedAt?: string;
}): Promise<File> {
  const classId = String(payload.classId || '').trim();
  const className = String(payload.className || classId).trim();
  return fetchDistributionImportFile(
    '/api/reports/distribution-import/basic-file',
    {
      classId,
      className,
      selectedWeekIds: payload.selectedWeekIds || [],
      taskSnapshotUpdatedAt: payload.taskSnapshotUpdatedAt || '',
    },
    `${className || classId}_学生个人数据_教务系统导出.xlsx`,
  );
}

export async function importDistributionDailyCheckFileFromAcademicSystem(payload: {
  classId: string;
  className?: string;
}): Promise<File> {
  const classId = String(payload.classId || '').trim();
  const className = String(payload.className || classId).trim();
  return fetchDistributionImportFile(
    '/api/reports/distribution-import/daily-checkin-file',
    { classId, className },
    `${className || classId}_打卡情况_教务系统导出.xlsx`,
  );
}
