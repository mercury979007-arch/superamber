export interface ScoreBookTask {
  noticeId: string;
  noticeType: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

function isScoreBookTask(task: ScoreBookTask) {
  const noticeType = String(task?.noticeType || '').trim();
  const title = String(task?.title || '').trim();
  return noticeType.includes('测试') || title.includes('成绩录入') || title.includes('测试');
}

export function hasUsableScoreBookTasksCache(tasks: ScoreBookTask[] | null | undefined) {
  return Array.isArray(tasks) && tasks.some((task) => isScoreBookTask(task));
}

export class ScoreBookApiError extends Error {
  status?: number;
  responseData?: unknown;
}

export interface TencentOcrWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScoreBookRow {
  rowId: number;
  noticeId: number;
  studentId: string;
  studentNo: string;
  chName: string;
  enName: string;
  status: string;
  type: string;
  comment: string;
  exstatus: string[];
  item: Array<{
    key: string;
    name: string;
    limit: string | number;
    total: string | number;
    children: Array<{
      key: string;
      name: string;
      limit: string | number;
      total: string | number;
    }>;
  }>;
  score: Array<{
    item: string;
    label: string;
    limit: number;
    score: string;
    comment?: string | null;
  }>;
  itemKey: string;
  childKey: string;
  itemLimit: number;
  childLimit: number;
}

export interface ScoreBookRosterPayload {
  noticeId: string;
  token: string;
  initData: {
    className: string;
    teacherName: string;
    testName: string;
    currentCount: number;
    expectedCount: number;
    absentCount: number;
    testType: string;
  };
  rows: ScoreBookRow[];
}

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    const error = new Error('UNAUTHORIZED');
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ScoreBookApiError(String((data as { error?: string })?.error || '请求失败'));
    error.status = response.status;
    error.responseData = data;
    throw error;
  }
  return data as T;
}

export async function fetchScoreBookTasks(classId: string, termIds: string[] = []) {
  const data = await postJson<{ data?: ScoreBookTask[] }>('/api/score-book/tasks', { classId, termIds });
  return Array.isArray(data.data) ? data.data.filter((task) => isScoreBookTask(task)) : [];
}

export async function fetchScoreBookRoster(classId: string, noticeId: string) {
  const data = await postJson<{ data?: ScoreBookRosterPayload }>('/api/score-book/roster', { classId, noticeId });
  if (!data.data) {
    throw new Error('未返回学生成绩数据');
  }
  return data.data;
}

export async function submitScoreBookEntries(payload: {
  classId: string;
  noticeId: string;
  mode: 'named' | 'grouped';
  entries?: Array<{
    rowId?: string | number;
    rawName: string;
    score: number;
    comment?: string;
    fallbackName?: string;
    aliasCandidates?: string[];
  }>;
  groups?: Array<{ score: number; studentIds: Array<string | number>; comment?: string }>;
  fillMissingAbsent?: boolean;
  overwriteExisting?: boolean;
}) {
  return postJson<{
    data?: {
      summary?: {
        submittedCount: number;
        matchedCount: number;
        absentFilledCount: number;
        skippedExisting?: Array<{ rowId: number; student: string; currentScore: string }>;
      };
      rows?: ScoreBookRow[];
    };
    unmatchedEntries?: Array<{ rawName: string; error: string }>;
    ambiguousEntries?: Array<{ rawName: string; candidates: string[] }>;
    duplicateAssignments?: Array<{ rowId: number; student: string; rawName: string }>;
  }>('/api/score-book/submit', payload);
}

export async function runTencentOcr(imageBase64: string, action: 'Auto' | 'GeneralAccurateOCR' | 'GeneralBasicOCR' = 'GeneralAccurateOCR') {
  return postJson<{
    rawText?: string;
    words?: TencentOcrWord[];
    action?: string;
    error?: string;
  }>('/api/tencent-ocr', {
    imageBase64,
    action,
    region: 'ap-guangzhou',
  });
}
