import { useEffect, useRef, useState } from 'react';
import type { ClassInfo, StudentRecord } from '../types';
import type { ScoreBookRosterPayload, ScoreBookRow, ScoreBookTask, TencentOcrWord } from '../services/testScoreEntryApi';
import {
  fetchScoreBookRoster,
  fetchScoreBookTasks,
  hasUsableScoreBookTasksCache,
  runTencentOcr,
  ScoreBookApiError,
  submitScoreBookEntries,
} from '../services/testScoreEntryApi';
import {
  normalizeStudentName,
  parseQuickChineseRewardText,
  parseQuickEnglishRewardText,
  resolveQuickRewards,
  sortStudentList,
  type QuickInputMode,
  type StudentSortKey,
} from '../services/distributionQuickFlow';
import { buildScoreEntryRoster } from '../services/testScoreEntryRoster';
import './TestScoreEntryApp.css';

const SCORE_BOOK_CACHE_TTL_MS = 30 * 60 * 1000;
const SCORE_BOOK_TASKS_CACHE_KEY = 'classsitdown:test-score:tasks:v1';
const SCORE_BOOK_ROSTERS_CACHE_KEY = 'classsitdown:test-score:rosters:v1';
const SCORE_BOOK_DRAFTS_CACHE_KEY = 'classsitdown:test-score:drafts:v1';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
  onSessionExpired?: () => void;
}

type InputMode = QuickInputMode;
type NoticeTone = 'info' | 'success' | 'error';
type DraftSource = QuickInputMode | 'photo';
type OcrState = 'idle' | 'selected' | 'uploading' | 'success' | 'error';
type InlineEditTarget =
  | { list: 'draft'; studentId: string; value: string }
  | { list: 'roster'; rowId: number; value: string };

interface DraftEntry {
  studentId: string;
  rowId?: number;
  chineseName: string;
  englishName: string;
  score: number;
  source: DraftSource;
}

interface OcrReviewEntry extends DraftEntry {
  rawToken: string;
}

interface SubmitResult {
  submittedCount: number;
  matchedCount: number;
  absentFilledCount: number;
  skippedExisting: Array<{ rowId: number; student: string; currentScore: string }>;
}

interface OcrCandidate {
  raw: string;
  score: number;
  nameToken: string;
}

interface TimedCacheEntry<T> {
  fetchedAt: number;
  data: T;
}

function summarizeTaskTitle(title: string) {
  return String(title || '')
    .replace(/录入录入/g, '录入')
    .replace(/-\w+\//, ' / ')
    .trim();
}

function loadTimedCacheMap<T>(storageKey: string) {
  if (typeof window === 'undefined') return {} as Record<string, TimedCacheEntry<T>>;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {} as Record<string, TimedCacheEntry<T>>;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, TimedCacheEntry<T>> : {} as Record<string, TimedCacheEntry<T>>;
  } catch {
    return {} as Record<string, TimedCacheEntry<T>>;
  }
}

function saveTimedCacheMap<T>(storageKey: string, next: Record<string, TimedCacheEntry<T>>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Ignore cache write failures.
  }
}

function readFreshCacheEntry<T>(storageKey: string, cacheKey: string): T | null {
  const cache = loadTimedCacheMap<T>(storageKey);
  const entry = cache[cacheKey];
  if (!entry || !entry.fetchedAt) return null;
  if (Date.now() - entry.fetchedAt > SCORE_BOOK_CACHE_TTL_MS) return null;
  return entry.data;
}

function writeFreshCacheEntry<T>(storageKey: string, cacheKey: string, data: T) {
  const cache = loadTimedCacheMap<T>(storageKey);
  cache[cacheKey] = {
    fetchedAt: Date.now(),
    data,
  };
  saveTimedCacheMap(storageKey, cache);
}

function removeFreshCacheEntry(storageKey: string, cacheKey: string) {
  const cache = loadTimedCacheMap(storageKey);
  if (!(cacheKey in cache)) return;
  delete cache[cacheKey];
  saveTimedCacheMap(storageKey, cache);
}

function clearTimedCacheStorage(storageKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore cache clear failures.
  }
}

function buildDraftBackupText(className: string, taskTitle: string, entries: DraftEntry[]) {
  const lines = [
    `班级：${className}`,
    `挑战：${taskTitle}`,
    '',
    ...entries.map((entry) => `${entry.englishName || entry.chineseName}\t${entry.score}`),
  ];
  return lines.join('\n');
}

function downloadDraftCsv(className: string, taskTitle: string, entries: DraftEntry[]) {
  if (typeof window === 'undefined' || entries.length === 0) return;
  const header = ['englishName', 'chineseName', 'score', 'source'];
  const rows = entries.map((entry) => [
    entry.englishName || '',
    entry.chineseName || '',
    String(entry.score),
    entry.source,
  ]);
  const csvBody = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  const safeTask = String(taskTitle || 'score-book').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  link.href = url;
  link.download = `${className}-${safeTask}-录入备份.csv`;
  link.click();
  window.URL.revokeObjectURL(url);
}

function upsertDraftEntries(current: DraftEntry[], additions: DraftEntry[]) {
  const merged = new Map<string, DraftEntry>();
  current.forEach((entry) => merged.set(entry.studentId, entry));
  additions.forEach((entry) => merged.set(entry.studentId, entry));
  return Array.from(merged.values()).sort((left, right) => {
    return String(left.englishName || left.chineseName).localeCompare(
      String(right.englishName || right.chineseName),
      'en',
      { sensitivity: 'base' },
    );
  });
}

function formatStudentPrimary(student: Pick<StudentRecord, 'englishName' | 'chineseName'>) {
  return String(student.englishName || student.chineseName || '').trim();
}

function rowHasRecordedScore(row: ScoreBookRow) {
  const scoreHit = (Array.isArray(row.score) ? row.score : []).some((item) => String(item?.score || '').trim() !== '');
  if (scoreHit) return true;
  return (Array.isArray(row.item) ? row.item : []).some((item) => {
    if (String(item?.total || '').trim() !== '') return true;
    return (Array.isArray(item?.children) ? item.children : []).some((child) => String(child?.total || '').trim() !== '');
  });
}

function getRowDisplayName(row: ScoreBookRow) {
  return String(row.enName || row.chName || row.studentId || `row-${row.rowId}`).trim();
}

function getRowCurrentScore(row: ScoreBookRow) {
  const directScore = (Array.isArray(row.score) ? row.score : []).find((item) => String(item?.score || '').trim() !== '');
  if (directScore) return String(directScore.score || '').trim();

  const itemScore = (Array.isArray(row.item) ? row.item : []).find((item) => {
    if (String(item?.total || '').trim() !== '') return true;
    return (Array.isArray(item?.children) ? item.children : []).some((child) => String(child?.total || '').trim() !== '');
  });
  if (!itemScore) return '';
  if (String(itemScore.total || '').trim() !== '') return String(itemScore.total || '').trim();
  const child = (Array.isArray(itemScore.children) ? itemScore.children : []).find((entry) => String(entry?.total || '').trim() !== '');
  return String(child?.total || '').trim();
}

function rowMatchesDraftEntry(row: ScoreBookRow, entry: DraftEntry) {
  if (entry.rowId && row.rowId === entry.rowId) return true;
  if (row.studentId && entry.studentId && row.studentId === entry.studentId) return true;
  const rowEnglish = normalizeStudentName(row.enName || '');
  const rowChinese = normalizeStudentName(row.chName || '');
  const entryEnglish = normalizeStudentName(entry.englishName || '');
  const entryChinese = normalizeStudentName(entry.chineseName || '');
  return Boolean(
    (rowEnglish && entryEnglish && rowEnglish === entryEnglish)
    || (rowChinese && entryChinese && rowChinese === entryChinese),
  );
}

function findRosterRowForStudent(rows: ScoreBookRow[], student: Pick<StudentRecord, 'studentId' | 'englishName' | 'chineseName'>) {
  return rows.find((row) => (
    (row.studentId && student.studentId && row.studentId === student.studentId)
    || normalizeStudentName(row.enName || '') === normalizeStudentName(student.englishName || '')
    || normalizeStudentName(row.chName || '') === normalizeStudentName(student.chineseName || '')
  )) || null;
}

function findRosterRowForDraftEntry(rows: ScoreBookRow[], entry: DraftEntry) {
  if (entry.rowId) {
    const exact = rows.find((row) => row.rowId === entry.rowId);
    if (exact) return exact;
  }
  return findRosterRowForStudent(rows, {
    studentId: entry.studentId,
    englishName: entry.englishName,
    chineseName: entry.chineseName,
  });
}

function hydrateDraftEntryRowIds(entries: DraftEntry[], rows: ScoreBookRow[]) {
  let changed = false;
  const nextEntries = entries.map((entry) => {
    const matchedRow = findRosterRowForDraftEntry(rows, entry);
    if (!matchedRow || entry.rowId === matchedRow.rowId) return entry;
    changed = true;
    return {
      ...entry,
      rowId: matchedRow.rowId,
    };
  });
  return changed ? nextEntries : entries;
}

function analyzeDraftAssignments(entries: DraftEntry[], rows: ScoreBookRow[]) {
  const unresolved: DraftEntry[] = [];
  const duplicateNames: string[] = [];
  const rowHits = new Map<number, DraftEntry[]>();

  entries.forEach((entry) => {
    const matchedRow = findRosterRowForDraftEntry(rows, entry);
    if (!matchedRow) {
      unresolved.push(entry);
      return;
    }
    const current = rowHits.get(matchedRow.rowId) || [];
    current.push(entry);
    rowHits.set(matchedRow.rowId, current);
  });

  rowHits.forEach((hits) => {
    if (hits.length <= 1) return;
    hits.forEach((entry) => {
      duplicateNames.push(entry.englishName || entry.chineseName || entry.studentId);
    });
  });

  return { unresolved, duplicateNames };
}

function formatSubmitConflictMessage(error: unknown) {
  if (!(error instanceof ScoreBookApiError)) return '';
  const data = error.responseData as {
    unmatchedEntries?: Array<{ rawName?: string; error?: string }>;
    ambiguousEntries?: Array<{ rawName?: string; candidates?: string[] }>;
    duplicateAssignments?: Array<{ student?: string; rawName?: string }>;
  } | undefined;
  if (!data) return '';

  const parts: string[] = [];
  if (Array.isArray(data.unmatchedEntries) && data.unmatchedEntries.length > 0) {
    parts.push(`未匹配：${data.unmatchedEntries.slice(0, 6).map((item) => item.rawName || item.error || '未知').join('、')}`);
  }
  if (Array.isArray(data.ambiguousEntries) && data.ambiguousEntries.length > 0) {
    parts.push(`重名或歧义：${data.ambiguousEntries.slice(0, 6).map((item) => item.rawName || '未知').join('、')}`);
  }
  if (Array.isArray(data.duplicateAssignments) && data.duplicateAssignments.length > 0) {
    parts.push(`重复分配：${data.duplicateAssignments.slice(0, 6).map((item) => item.student || item.rawName || '未知').join('、')}`);
  }
  return parts.join('；');
}

function normalizeEnglishToken(raw: string) {
  return String(raw || '').replace(/[^A-Za-z]/g, '').toLowerCase();
}

function levenshtein(left: string, right: string) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) dp[row][0] = row;
  for (let col = 0; col < cols; col += 1) dp[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost,
      );
    }
  }

  return dp[left.length][right.length];
}

function getNameVariants(raw: string) {
  const base = normalizeEnglishToken(raw);
  const variants = new Set<string>();
  if (base) variants.add(base);
  if (base.length > 3) variants.add(base.replace(/[tfvily]+$/, ''));
  if (base.length > 4) variants.add(base.replace(/^[il]+/, ''));
  return Array.from(variants).filter((item) => item.length >= 2);
}

function matchStudentByOcrName(roster: StudentRecord[], rawName: string) {
  let bestStudent: StudentRecord | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  const variants = getNameVariants(rawName);

  for (const student of roster) {
    const english = normalizeEnglishToken(student.englishName || '');
    if (!english) continue;

    let localBest = Number.POSITIVE_INFINITY;
    for (const variant of variants) {
      if (!variant) continue;
      if (variant === english) {
        localBest = 0;
        break;
      }
      if (english.startsWith(variant) || variant.startsWith(english)) {
        localBest = Math.min(localBest, 1);
      }
      localBest = Math.min(localBest, levenshtein(variant, english));
    }

    if (localBest < bestDistance) {
      bestDistance = localBest;
      bestStudent = student;
      tied = false;
    } else if (localBest === bestDistance) {
      tied = true;
    }
  }

  const threshold = Math.max(1, Math.floor((bestStudent?.englishName || '').length / 4));
  if (!bestStudent || tied || !Number.isFinite(bestDistance) || bestDistance > threshold) {
    return null;
  }

  return bestStudent;
}

function extractScoreCandidates(words: TencentOcrWord[]) {
  const candidates: OcrCandidate[] = [];
  const sorted = [...words].sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);

  for (const word of sorted) {
    const raw = String(word.text || '').trim();
    if (!raw) continue;
    const sanitized = raw.replace(/\s+/g, ' ');
    const matches = Array.from(sanitized.matchAll(/(\d{1,2})\s*([A-Za-z]{2,})/g));
    if (matches.length === 0) {
      const compact = sanitized.replace(/\s+/g, '');
      const compactMatch = compact.match(/^(\d{1,2})([A-Za-z]{2,})/);
      if (compactMatch) {
        candidates.push({
          raw,
          score: Number(compactMatch[1]),
          nameToken: compactMatch[2],
        });
      }
      continue;
    }

    for (const match of matches) {
      candidates.push({
        raw,
        score: Number(match[1]),
        nameToken: match[2],
      });
    }
  }

  return candidates.filter((item) => Number.isFinite(item.score) && item.score >= 0 && item.score <= 100);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',').pop() || '' : result;
      if (!base64) {
        reject(new Error('图片读取失败'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export default function TestScoreEntryApp({
  classInfo,
  classes,
  onBack,
  onBackToHome,
  onSwitchClass,
  onSessionExpired,
}: Props) {
  const tasksCacheKey = classInfo.name;
  const [tasks, setTasks] = useState<ScoreBookTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [selectedNoticeId, setSelectedNoticeId] = useState('');
  const [taskRosterMap, setTaskRosterMap] = useState<Record<string, ScoreBookRosterPayload>>({});
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [forceRefreshNoticeId, setForceRefreshNoticeId] = useState('');

  const [inputMode, setInputMode] = useState<InputMode | 'photo'>('english');
  const [sortKey, setSortKey] = useState<StudentSortKey>('en_asc');
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [fillMissingAbsent, setFillMissingAbsent] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [pickerScore, setPickerScore] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);
  const [ocrReviewEntries, setOcrReviewEntries] = useState<OcrReviewEntry[]>([]);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrImporting, setOcrImporting] = useState(false);
  const [ocrIssues, setOcrIssues] = useState<string[]>([]);
  const [ocrState, setOcrState] = useState<OcrState>('idle');
  const [ocrStatusText, setOcrStatusText] = useState('');
  const [inlineEdit, setInlineEdit] = useState<InlineEditTarget | null>(null);
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [failureBackupText, setFailureBackupText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sessionExpiredRef = useRef(onSessionExpired);
  const autoResolvedTaskRef = useRef('');

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    clearTimedCacheStorage(SCORE_BOOK_DRAFTS_CACHE_KEY);
  }, []);

  const selectedTask = tasks.find((task) => task.noticeId === selectedNoticeId) || null;
  const selectedRoster = selectedNoticeId ? taskRosterMap[selectedNoticeId] || null : null;
  const activeRoster = sortStudentList(buildScoreEntryRoster(classInfo.name, selectedRoster?.rows || []), sortKey);
  const recordedCount = (selectedRoster?.rows || []).filter((row) => rowHasRecordedScore(row)).length;
  const assignedCount = draftEntries.length;
  const pendingRows = (selectedRoster?.rows || []).filter((row) => !draftEntries.some((entry) => rowMatchesDraftEntry(row, entry)));
  const missingRows = pendingRows.filter((row) => !rowHasRecordedScore(row));
  const missingCount = selectedRoster ? missingRows.length : Math.max(0, activeRoster.length - draftEntries.length);
  const rosterPreviewRows = selectedRoster?.rows || [];
  const hasAlmostDoneReminder = missingRows.length > 0 && missingRows.length < 5;
  const draftAssignmentAnalysis = selectedRoster
    ? analyzeDraftAssignments(draftEntries, selectedRoster.rows)
    : { unresolved: [], duplicateNames: [] };

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      setTasksLoading(true);
      setTasksError('');
      setTaskRosterMap({});
      setRosterError('');
      setSelectedStudentIds([]);
      setQuickInput('');
      setPickerScore('');
      setOcrFile(null);
      setOcrReviewEntries([]);
      setOcrIssues([]);
      setOcrState('idle');
      setOcrStatusText('');
      setNoticeMessage('');
      setSubmitResult(null);
      setFailureBackupText('');

      try {
        const cachedTasks = readFreshCacheEntry<ScoreBookTask[]>(SCORE_BOOK_TASKS_CACHE_KEY, tasksCacheKey);
        const usableCachedTasks = hasUsableScoreBookTasksCache(cachedTasks) ? cachedTasks : null;
        const nextTasks: ScoreBookTask[] = usableCachedTasks
          ? usableCachedTasks
          : await fetchScoreBookTasks(classInfo.name);
        if (cancelled) return;
        if (!usableCachedTasks && nextTasks.length > 0) {
          writeFreshCacheEntry(SCORE_BOOK_TASKS_CACHE_KEY, tasksCacheKey, nextTasks);
        }
        setTasks(nextTasks);
        if (nextTasks.length > 0) {
          let preferredNoticeId = '';
          const rosterMapUpdates: Record<string, ScoreBookRosterPayload> = {};
          for (const task of nextTasks) {
            const rosterCacheKey = `${classInfo.name}::${task.noticeId}`;
            const cachedRoster = readFreshCacheEntry<ScoreBookRosterPayload>(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey);
            const roster = cachedRoster || await fetchScoreBookRoster(classInfo.name, task.noticeId);
            if (cancelled) return;
            if (!cachedRoster) {
              writeFreshCacheEntry(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey, roster);
            }
            rosterMapUpdates[task.noticeId] = roster;
            if (!preferredNoticeId && roster.rows.length > 0) {
              preferredNoticeId = task.noticeId;
            }
          }
          setTaskRosterMap(rosterMapUpdates);
          setSelectedNoticeId((current) => {
            if (current && rosterMapUpdates[current]?.rows?.length > 0) return current;
            if (preferredNoticeId) return preferredNoticeId;
            return nextTasks[0].noticeId;
          });
        } else {
          setSelectedNoticeId('');
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '挑战读取失败';
        if (message === 'UNAUTHORIZED') {
          sessionExpiredRef.current?.();
          return;
        }
        setTasks([]);
        setTasksError(message);
      } finally {
        if (!cancelled) {
          setTasksLoading(false);
        }
      }
    }

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, [classInfo.name]);

  useEffect(() => {
    if (!selectedNoticeId) {
      setDraftEntries([]);
    }
    setSelectedStudentIds([]);
    setQuickInput('');
    setPickerScore('');
    setOcrFile(null);
    setOcrReviewEntries([]);
    setOcrIssues([]);
    setOcrState('idle');
    setOcrStatusText('');
    setInlineEdit(null);
    setNoticeMessage('');
    setSubmitResult(null);
    setFailureBackupText('');
  }, [selectedNoticeId]);

  useEffect(() => {
    if (!selectedRoster || draftEntries.length === 0) return;
    setDraftEntries((current) => hydrateDraftEntryRowIds(current, selectedRoster.rows));
  }, [selectedRoster, draftEntries.length]);

  useEffect(() => {
    if (!selectedNoticeId || !selectedRoster) return;
    if (selectedRoster.rows.length > 0) return;
    if (autoResolvedTaskRef.current === `${classInfo.name}::${selectedNoticeId}`) return;
    const fallbackTask = tasks.find((task) => {
      if (task.noticeId === selectedNoticeId) return false;
      return (taskRosterMap[task.noticeId]?.rows?.length || 0) > 0;
    });
    if (!fallbackTask) return;
    autoResolvedTaskRef.current = `${classInfo.name}::${selectedNoticeId}`;
    setSelectedNoticeId(fallbackTask.noticeId);
    pushNotice(`当前挑战官网返回 0 人，已自动切到 ${summarizeTaskTitle(fallbackTask.title)}。`, 'info');
  }, [classInfo.name, selectedNoticeId, selectedRoster, taskRosterMap, tasks]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoster() {
      if (!selectedNoticeId) return;
      const shouldForceRefresh = forceRefreshNoticeId === selectedNoticeId;
      if (taskRosterMap[selectedNoticeId] && !shouldForceRefresh) return;
      setRosterLoading(true);
      setRosterError('');
      try {
        const rosterCacheKey = `${classInfo.name}::${selectedNoticeId}`;
        const cachedRoster = shouldForceRefresh
          ? null
          : readFreshCacheEntry<ScoreBookRosterPayload>(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey);
        const data = cachedRoster || await fetchScoreBookRoster(classInfo.name, selectedNoticeId);
        if (cancelled) return;
        if (!cachedRoster) {
          writeFreshCacheEntry(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey, data);
        }
        setTaskRosterMap((current) => ({ ...current, [selectedNoticeId]: data }));
        if (shouldForceRefresh) {
          setForceRefreshNoticeId('');
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '官网名单抓取失败';
        if (message === 'UNAUTHORIZED') {
          sessionExpiredRef.current?.();
          return;
        }
        setRosterError(message);
      } finally {
        if (!cancelled) {
          setRosterLoading(false);
        }
      }
    }

    void loadRoster();
    return () => {
      cancelled = true;
    };
  }, [classInfo.name, forceRefreshNoticeId, selectedNoticeId]);

  function pushNotice(message: string, tone: NoticeTone) {
    setNoticeMessage(message);
    setNoticeTone(tone);
  }

  function handleAddByNames(mode: Extract<InputMode, 'english' | 'chinese'>) {
    if (activeRoster.length === 0) {
      pushNotice(selectedNoticeId ? '官网名单还没抓回来，先等当前挑战名单加载完成。' : '先选挑战。', 'error');
      return;
    }

    const parsed = mode === 'english'
      ? parseQuickEnglishRewardText(quickInput)
      : parseQuickChineseRewardText(quickInput);

    if (parsed.length === 0) {
      pushNotice(mode === 'english' ? '请输入“英文名 + 分数”。' : '请输入“中文名 + 分数”。', 'error');
      return;
    }

    const { resolved, missingNames, ambiguousNames } = resolveQuickRewards(activeRoster, parsed, mode);
    if (resolved.length === 0) {
      const issues = [
        missingNames.length > 0 ? `未匹配 ${missingNames.join('、')}` : '',
        ambiguousNames.length > 0 ? `重名 ${ambiguousNames.map((item) => item.name).join('、')}` : '',
      ].filter(Boolean);
      pushNotice(issues.join('；') || '没有可加入的学生。', 'error');
      return;
    }

    const blockedNames: string[] = [];
    const additions = resolved.flatMap((item) => {
      const matchedRow = findRosterRowForStudent(selectedRoster?.rows || [], item);
      if (selectedRoster && selectedRoster.rows.length > 0 && !matchedRow) {
        blockedNames.push(item.englishName || item.chineseName || item.studentId);
        return [];
      }

      return [{
        rowId: matchedRow?.rowId,
        studentId: item.studentId,
        chineseName: item.chineseName,
        englishName: item.englishName || '',
        score: item.amount,
        source: mode,
      }];
    });

    if (additions.length === 0 && blockedNames.length > 0) {
      pushNotice(`这些学生不在当前挑战名单：${blockedNames.join('、')}`, 'error');
      return;
    }

    setDraftEntries((current) => upsertDraftEntries(current, additions));
    setQuickInput('');

    const parts = [`已加入 ${additions.length} 人`];
    if (missingNames.length > 0) parts.push(`未匹配 ${missingNames.join('、')}`);
    if (ambiguousNames.length > 0) parts.push(`重名 ${ambiguousNames.map((item) => item.name).join('、')}`);
    if (blockedNames.length > 0) parts.push(`不在当前挑战 ${blockedNames.join('、')}`);
    pushNotice(parts.join('；'), missingNames.length > 0 || ambiguousNames.length > 0 || blockedNames.length > 0 ? 'info' : 'success');
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) => {
      if (current.includes(studentId)) {
        return current.filter((item) => item !== studentId);
      }
      return [...current, studentId];
    });
  }

  function toggleAllStudents() {
    if (activeRoster.length === 0) return;
    if (selectedStudentIds.length === activeRoster.length) {
      setSelectedStudentIds([]);
      return;
    }
    setSelectedStudentIds(activeRoster.map((student) => student.studentId));
  }

  function handleAddPickerGroup() {
    const score = Number(pickerScore);
    if (!Number.isFinite(score) || score < 0) {
      pushNotice('先填分数。', 'error');
      return;
    }
    if (selectedStudentIds.length === 0) {
      pushNotice('先选学生。', 'error');
      return;
    }

    const additions = activeRoster
      .filter((student) => selectedStudentIds.includes(student.studentId))
      .flatMap((student) => {
        const matchedRow = findRosterRowForStudent(selectedRoster?.rows || [], student);
        if (selectedRoster && selectedRoster.rows.length > 0 && !matchedRow) {
          return [];
        }
        return [{
          rowId: matchedRow?.rowId,
          studentId: student.studentId,
          chineseName: student.chineseName,
          englishName: student.englishName || '',
          score,
          source: 'picker' as const,
        }];
      });

    if (additions.length === 0) {
      pushNotice('所选学生不在当前挑战名单。', 'error');
      return;
    }

    setDraftEntries((current) => upsertDraftEntries(current, additions));
    setSelectedStudentIds([]);
    setPickerScore('');
    pushNotice(`已加入 ${additions.length} 人。`, 'success');
  }

  function clearDraftEntries() {
    setDraftEntries([]);
    setOcrReviewEntries([]);
    setOcrIssues([]);
    setOcrState('idle');
    setOcrStatusText('');
    setSubmitResult(null);
    pushNotice('已清空。', 'info');
  }

  function removeDraftEntry(studentId: string) {
    setDraftEntries((current) => current.filter((entry) => entry.studentId !== studentId));
  }

  function acceptOcrReview(studentId: string) {
    const target = ocrReviewEntries.find((entry) => entry.studentId === studentId);
    if (!target) return;
    setDraftEntries((current) => upsertDraftEntries(current, [target]));
    setOcrReviewEntries((current) => current.filter((entry) => entry.studentId !== studentId));
  }

  function acceptAllOcrReview() {
    if (ocrReviewEntries.length === 0) return;
    setDraftEntries((current) => upsertDraftEntries(current, ocrReviewEntries));
    setOcrReviewEntries([]);
  }

  function removeOcrReview(studentId: string) {
    setOcrReviewEntries((current) => current.filter((entry) => entry.studentId !== studentId));
  }

  function startDraftInlineEdit(entry: DraftEntry) {
    setInlineEdit({
      list: 'draft',
      studentId: entry.studentId,
      value: String(entry.score ?? ''),
    });
  }

  function startRosterInlineEdit(row: ScoreBookRow) {
    const existing = draftEntries.find((entry) => rowMatchesDraftEntry(row, entry));
    setInlineEdit({
      list: 'roster',
      rowId: row.rowId,
      value: existing ? String(existing.score ?? '') : getRowCurrentScore(row),
    });
  }

  function updateInlineEditValue(value: string) {
    setInlineEdit((current) => (current ? { ...current, value } : current));
  }

  function commitInlineEdit() {
    if (!inlineEdit) return;

    const nextValue = String(inlineEdit.value || '').trim();
    const score = Number(nextValue);
    if (!nextValue || !Number.isFinite(score) || score < 0) {
      pushNotice('请输入有效分数。', 'error');
      return;
    }

    if (inlineEdit.list === 'draft') {
      setDraftEntries((current) => current.map((entry) => (
        entry.studentId === inlineEdit.studentId
          ? { ...entry, score }
          : entry
      )));
      setInlineEdit(null);
      return;
    }

    const row = (selectedRoster?.rows || []).find((item) => item.rowId === inlineEdit.rowId);
    if (!row) {
      setInlineEdit(null);
      pushNotice('这条官网记录已经变化，请重新操作。', 'error');
      return;
    }

    const matchedStudent = activeRoster.find((student) => (
      (row.studentId && student.studentId === row.studentId)
      || normalizeStudentName(student.englishName || '') === normalizeStudentName(row.enName || '')
      || normalizeStudentName(student.chineseName || '') === normalizeStudentName(row.chName || '')
    ));

    if (!matchedStudent) {
      pushNotice(`没法把 ${row.enName || row.chName} 映射到当前名单。`, 'error');
      return;
    }

    setDraftEntries((current) => upsertDraftEntries(current, [{
      rowId: row.rowId,
      studentId: matchedStudent.studentId,
      chineseName: matchedStudent.chineseName,
      englishName: matchedStudent.englishName || '',
      score,
      source: 'picker',
    }]));
    setInlineEdit(null);
    pushNotice(rowHasRecordedScore(row) ? `已把 ${getRowDisplayName(row)} 加入覆盖名单。` : `已把 ${getRowDisplayName(row)} 加入待同步名单。`, 'success');
  }

  function cancelInlineEdit() {
    setInlineEdit(null);
  }

  async function copyDraftBackupText() {
    if (draftEntries.length === 0) {
      pushNotice('还没有可复制的录入结果。', 'error');
      return;
    }
    const text = buildDraftBackupText(classInfo.name, selectedTask ? summarizeTaskTitle(selectedTask.title) : '成绩录入', draftEntries);
    try {
      await navigator.clipboard.writeText(text);
      pushNotice('已复制录入备份文字。', 'success');
    } catch {
      pushNotice('复制失败，请改用导出表格。', 'error');
    }
  }

  async function copyFailureBackupText() {
    if (!failureBackupText) return;
    try {
      await navigator.clipboard.writeText(failureBackupText);
      pushNotice('已复制失败备份文字。', 'success');
    } catch {
      pushNotice('自动复制失败，请手动选中文本框内容复制。', 'error');
    }
  }

  function exportDraftBackup() {
    if (draftEntries.length === 0) {
      pushNotice('还没有可导出的录入结果。', 'error');
      return;
    }
    downloadDraftCsv(classInfo.name, selectedTask ? summarizeTaskTitle(selectedTask.title) : '成绩录入', draftEntries);
    pushNotice('已导出录入备份表格。', 'success');
  }

  async function handleImportPhoto() {
    if (!ocrFile) {
      setOcrState('error');
      setOcrStatusText('还没选图片。');
      pushNotice('先选一张图片。', 'error');
      return;
    }
    if (activeRoster.length === 0) {
      setOcrState('error');
      setOcrStatusText(selectedNoticeId ? '当前挑战官网名单还没抓回来。' : '先选挑战。');
      pushNotice(selectedNoticeId ? '官网名单还没抓回来，先等当前挑战名单加载完成。' : '先选挑战。', 'error');
      return;
    }

    setOcrImporting(true);
    setOcrIssues([]);
    setOcrState('uploading');
    setOcrStatusText(`正在读取 ${ocrFile.name}...`);
    pushNotice('正在识别...', 'info');

    try {
      const imageBase64 = await readFileAsBase64(ocrFile);
      setOcrStatusText(`图片已上传，正在识别 ${ocrFile.name}...`);
      const response = await runTencentOcr(imageBase64, 'GeneralAccurateOCR');
      const words = Array.isArray(response.words) ? response.words : [];
      const candidates = extractScoreCandidates(words);

      if (candidates.length === 0) {
        throw new Error('这张图里没识别出可用的“分数 + 英文名”片段。');
      }

      const additions: OcrReviewEntry[] = [];
      const issues: string[] = [];

      for (const candidate of candidates) {
        const matched = matchStudentByOcrName(activeRoster, candidate.nameToken);
        if (!matched) {
          issues.push(`${candidate.nameToken} ${candidate.score}`);
          continue;
        }
        additions.push({
          rowId: findRosterRowForStudent(selectedRoster?.rows || [], matched)?.rowId,
          studentId: matched.studentId,
          chineseName: matched.chineseName,
          englishName: matched.englishName || '',
          score: candidate.score,
          source: 'photo',
          rawToken: candidate.raw,
        });
      }

      if (additions.length === 0) {
        setOcrIssues(issues.slice(0, 12));
        throw new Error('识别到了文字，但纠偏后没有可用学生。');
      }

      setOcrReviewEntries((current) => upsertDraftEntries(current, additions) as OcrReviewEntry[]);
      setOcrIssues(issues.slice(0, 12));
      setOcrFile(null);
      setOcrState('success');
      setOcrStatusText(`识别完成，待确认 ${additions.length} 人${issues.length > 0 ? `，未匹配 ${issues.length} 条` : ''}。`);
      pushNotice(
        `拍照导入完成：待确认 ${additions.length} 人${issues.length > 0 ? `，未匹配 ${issues.length} 条` : ''}。`,
        issues.length > 0 ? 'info' : 'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '拍照导入失败';
      if (message === 'UNAUTHORIZED') {
        sessionExpiredRef.current?.();
        return;
      }
      setOcrState('error');
      setOcrStatusText(message);
      pushNotice(message, 'error');
    } finally {
      setOcrImporting(false);
    }
  }

  function handlePickPhoto(file: File | null) {
    setOcrFile(file);
    setOcrIssues([]);
    if (file) {
      setOcrState('selected');
      setOcrStatusText(`已选中：${file.name}`);
    } else {
      setOcrState('idle');
      setOcrStatusText('');
    }
  }

  function handleRefreshRoster() {
    if (!selectedNoticeId) return;
    setForceRefreshNoticeId(selectedNoticeId);
  }

  async function handleSubmit() {
    if (!selectedNoticeId) {
      pushNotice('先选挑战。', 'error');
      return;
    }
    if (draftEntries.length === 0) {
      pushNotice('待同步名单还是空的。', 'error');
      return;
    }
    if (selectedRoster && draftAssignmentAnalysis.unresolved.length > 0) {
      pushNotice(
        `还有 ${draftAssignmentAnalysis.unresolved.length} 个学生没和官网名单对上：${draftAssignmentAnalysis.unresolved.slice(0, 6).map((entry) => entry.englishName || entry.chineseName || entry.studentId).join('、')}`,
        'error',
      );
      return;
    }
    if (selectedRoster && draftAssignmentAnalysis.duplicateNames.length > 0) {
      pushNotice(`待同步名单里有重复指向同一官网学生：${draftAssignmentAnalysis.duplicateNames.slice(0, 6).join('、')}`, 'error');
      return;
    }

    const confirmed = window.confirm(
      fillMissingAbsent
        ? `确认同步？\n\n已录入 ${draftEntries.length} 人；仅把官网当前空白的 ${missingCount} 人补为未参加，已有成绩不会被改。`
        : `确认同步？\n\n只同步本次待同步名单中的 ${draftEntries.length} 人；其他学生保持官网现状，不会自动改成未参加。`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setSubmitResult(null);
    setFailureBackupText('');
    pushNotice('正在同步...', 'info');

    try {
      const response = await submitScoreBookEntries({
        classId: classInfo.name,
        noticeId: selectedNoticeId,
        mode: 'named',
        entries: draftEntries.map((entry) => ({
          rowId: entry.rowId,
          rawName: entry.englishName || entry.chineseName,
          fallbackName: entry.chineseName || entry.englishName,
          aliasCandidates: [entry.englishName, entry.chineseName].filter(Boolean),
          score: entry.score,
        })),
        fillMissingAbsent,
        overwriteExisting,
      });

      const submittedCount = Number(response.data?.summary?.submittedCount || 0);
      const skippedCount = Array.isArray(response.data?.summary?.skippedExisting)
        ? response.data?.summary?.skippedExisting?.length || 0
        : 0;
      setSubmitResult({
        submittedCount,
        matchedCount: Number(response.data?.summary?.matchedCount || 0),
        absentFilledCount: Number(response.data?.summary?.absentFilledCount || 0),
        skippedExisting: Array.isArray(response.data?.summary?.skippedExisting) ? response.data?.summary?.skippedExisting || [] : [],
      });

      setDraftEntries([]);
      setOcrReviewEntries([]);
      setSelectedStudentIds([]);
      setFailureBackupText('');
      setRosterLoading(true);
      try {
        const rosterCacheKey = `${classInfo.name}::${selectedNoticeId}`;
        removeFreshCacheEntry(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey);
        removeFreshCacheEntry(SCORE_BOOK_TASKS_CACHE_KEY, tasksCacheKey);
        const refreshedRoster = await fetchScoreBookRoster(classInfo.name, selectedNoticeId);
        writeFreshCacheEntry(SCORE_BOOK_ROSTERS_CACHE_KEY, rosterCacheKey, refreshedRoster);
        setTaskRosterMap((current) => ({ ...current, [selectedNoticeId]: refreshedRoster }));
      } finally {
        setRosterLoading(false);
      }
      pushNotice(`同步完成：${submittedCount} 条${skippedCount > 0 ? `，跳过 ${skippedCount} 条` : ''}。`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交失败';
      if (message === 'UNAUTHORIZED') {
        sessionExpiredRef.current?.();
        return;
      }
      const conflictMessage = formatSubmitConflictMessage(error);
      const backupText = buildDraftBackupText(
        classInfo.name,
        selectedTask ? summarizeTaskTitle(selectedTask.title) : '成绩录入',
        draftEntries,
      );
      setFailureBackupText(backupText);
      try {
        await navigator.clipboard.writeText(backupText);
        pushNotice(`${conflictMessage || message}；官网未写入，已自动复制本次录入备份文字。`, 'error');
      } catch {
        pushNotice(`${conflictMessage || message}；官网未写入，请复制下方备份文字稍后重试。`, 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="score-quick-wrap fade-in">
      {onBackToHome && (
        <button className="tool-home-rail" onClick={onBackToHome}>
          <span className="tool-home-rail-icon">←</span>
          <span>返回主页</span>
        </button>
      )}

      <div className="score-quick-topbar">
        <button className="tool-back-btn" onClick={onBack}>← 返回</button>
        {classes && classes.length > 1 && onSwitchClass ? (
          <select className="tool-class-switch" value={classInfo.name} onChange={(event) => onSwitchClass(event.target.value)}>
            {classes.map((item) => (
              <option key={item.id} value={item.name}>{item.name}</option>
            ))}
          </select>
        ) : (
          <span className="score-quick-class">{classInfo.name}</span>
        )}
        <span className="score-quick-week">
          {selectedTask ? summarizeTaskTitle(selectedTask.title).split('/')[0].trim() : '成绩录入'}
        </span>
        <span className="score-quick-test-badge">【测试中】</span>
      </div>

      <div className="score-quick-test-notice">
        现在这页只认当前官网挑战名单。老师先选挑战，再从官网名单里录分、补漏、改分；同步后会立刻回读官网状态。
      </div>

      <div className="score-quick-steps">
        <div className="score-quick-step is-done">
          <span className="score-quick-step-dot">✓</span>
          <span>挑战</span>
        </div>
        <div className="score-quick-step-line" />
        <div className={`score-quick-step ${selectedNoticeId ? 'is-active' : ''}`}>
          <span className="score-quick-step-dot">{selectedNoticeId ? '2' : '•'}</span>
          <span>录入</span>
        </div>
      </div>

      <section className="score-quick-card card">
        <div className="score-quick-card-head">
          <h2>快捷成绩录入</h2>
          <div className="score-quick-head-badges">
            <span className="chip">{tasks.length} 条挑战</span>
            <span className="chip">{activeRoster.length} 人名单</span>
          </div>
        </div>

        <div className="score-quick-task-board">
          <div className="score-quick-section-title">挑战选择</div>
          {tasksError && <div className="score-quick-alert is-error">{tasksError}</div>}
          {tasksLoading && (
            <div className="score-quick-loading" role="status" aria-live="polite">
              正在读取挑战...
            </div>
          )}
          {!tasksLoading && tasks.length === 0 && !tasksError && (
            <div className="score-quick-empty">当前没有测试挑战。</div>
          )}
          {!tasksLoading && (
            <div className="score-quick-task-list">
            {tasks.map((task) => (
              <button
                key={task.noticeId}
                type="button"
                className={`score-quick-task-item${task.noticeId === selectedNoticeId ? ' is-active' : ''}${taskRosterMap[task.noticeId] && taskRosterMap[task.noticeId].rows.length > 0 && taskRosterMap[task.noticeId].rows.every((row) => rowHasRecordedScore(row)) ? ' is-complete' : ''}`}
                onClick={() => setSelectedNoticeId(task.noticeId)}
              >
                <div className="score-quick-task-title">{summarizeTaskTitle(task.title)}</div>
                <div className="score-quick-task-meta">
                  <span>{task.noticeId}</span>
                  {!taskRosterMap[task.noticeId] && <span>待检查</span>}
                  {taskRosterMap[task.noticeId] && (
                    taskRosterMap[task.noticeId].rows.length === 0
                      ? <span>空名单</span>
                      : taskRosterMap[task.noticeId].rows.every((row) => rowHasRecordedScore(row))
                      ? <span>已录完</span>
                      : <span>待补 {taskRosterMap[task.noticeId].rows.filter((row) => !rowHasRecordedScore(row)).length}</span>
                  )}
                </div>
              </button>
            ))}
            </div>
          )}
        </div>

        <div className="score-quick-status-row">
          <span className="chip">已录入 {assignedCount} 人</span>
          <span className="chip">待补 {missingCount} 人</span>
          {selectedRoster && <span className="chip">官网已录 {recordedCount}/{selectedRoster.rows.length}</span>}
        </div>

        {rosterLoading && <div className="score-quick-alert is-info">正在同步最新名单和成绩状态...</div>}
        {rosterError && <div className="score-quick-alert is-error">{rosterError}</div>}
        {!rosterLoading && selectedNoticeId && !selectedRoster && !rosterError && (
          <div className="score-quick-alert is-info">正在等待官网返回当前挑战名单；名单回来前，不再使用本地名单占位。</div>
        )}

        <div className="score-quick-entry-box">
          <div className="score-quick-section-title">录分操作</div>
          <div className="score-quick-action-row">
            <button className="btn btn-ghost btn-sm" type="button" onClick={handleRefreshRoster} disabled={!selectedNoticeId || rosterLoading}>
              {rosterLoading ? '抓取中...' : '重新抓取状态'}
            </button>
            <span className="score-quick-helper-text">只更新当前官网挑战状态，不清空本次待同步名单。</span>
          </div>

          {selectedRoster && rosterPreviewRows.length > 0 && (
            <div className="score-quick-roster-panel">
              <div className="score-quick-draft-head">
                <strong>当前挑战官网名单</strong>
                <div className="score-quick-draft-meta">
                  <span className="chip">{rosterPreviewRows.length} 人</span>
                  <span className="chip">已录 {recordedCount}</span>
                  <span className="chip">待补 {missingRows.length}</span>
                </div>
              </div>
              <div className="score-quick-helper-text">
                双击分数可以直接录分或改分。官网已录的学生发灰显示；加入本次待同步后会标记为“本次待同步”或“准备覆盖”。
              </div>
              <div className="score-quick-roster-grid">
                {rosterPreviewRows.map((row) => {
                  const existingDraft = draftEntries.find((entry) => rowMatchesDraftEntry(row, entry));
                  const hasRecorded = rowHasRecordedScore(row);
                  const currentScore = getRowCurrentScore(row);
                  const isEditing = inlineEdit?.list === 'roster' && inlineEdit.rowId === row.rowId;
                  return (
                    <div
                      key={row.rowId}
                      className={`score-quick-roster-item${hasRecorded ? ' is-recorded' : ''}${existingDraft ? ' is-pending' : ''}`}
                    >
                      <div>
                        <strong>{getRowDisplayName(row)}</strong>
                        {row.enName && row.chName && <span>{row.chName}</span>}
                      </div>
                      <div className="score-quick-roster-right">
                        {hasRecorded && !existingDraft && <span className="score-quick-roster-state">官网已录</span>}
                        {existingDraft && (
                          <span className="score-quick-roster-state is-pending">
                            {hasRecorded ? '准备覆盖' : '本次待同步'}
                          </span>
                        )}
                        {isEditing ? (
                          <input
                            className="input-field score-quick-inline-score"
                            type="number"
                            min="0"
                            step="1"
                            autoFocus
                            value={inlineEdit.value}
                            onChange={(event) => updateInlineEditValue(event.target.value)}
                            onBlur={commitInlineEdit}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitInlineEdit();
                              if (event.key === 'Escape') cancelInlineEdit();
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`score-quick-inline-trigger${hasRecorded ? ' is-muted' : ''}`}
                            onDoubleClick={() => startRosterInlineEdit(row)}
                            title={hasRecorded ? '双击改分并准备覆盖官网' : '双击直接录分'}
                          >
                            {existingDraft ? `${existingDraft.score} 分` : currentScore ? `${currentScore} 分` : '未录'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="score-quick-tabs">
            <button type="button" className={inputMode === 'english' ? 'active' : ''} onClick={() => setInputMode('english')}>
              英文名
            </button>
            <button type="button" className={inputMode === 'chinese' ? 'active' : ''} onClick={() => setInputMode('chinese')}>
              中文名
            </button>
            <button type="button" className={inputMode === 'picker' ? 'active' : ''} onClick={() => setInputMode('picker')}>
              展开勾选
            </button>
            <button type="button" className={inputMode === 'photo' ? 'active' : ''} onClick={() => setInputMode('photo')}>
              拍照导入【测试中】
            </button>
          </div>

          {activeRoster.length === 0 && (
            <div className="score-quick-empty">
              {selectedNoticeId
                ? selectedRoster && selectedRoster.rows.length === 0
                  ? '当前挑战官网返回 0 人，已跳过本地名单兜底。'
                  : '当前挑战官网名单还没抓回来。'
                : '先选挑战，再读取官网当前挑战名单。'}
            </div>
          )}

          {activeRoster.length > 0 && (inputMode === 'english' || inputMode === 'chinese') && (
            <>
              <textarea
                className="input-field score-quick-textarea"
                rows={7}
                placeholder={inputMode === 'english' ? 'Amy 18\nSally, Chris 20' : '李晓彤 18\n周子然 王一诺 20'}
                value={quickInput}
                onChange={(event) => setQuickInput(event.target.value)}
              />
              <div className="score-quick-action-row">
                <button className="btn btn-ghost" type="button" onClick={() => handleAddByNames(inputMode === 'english' ? 'english' : 'chinese')}>
                  加入待同步名单
                </button>
              </div>
            </>
          )}

          {activeRoster.length > 0 && inputMode === 'picker' && (
            <>
              <div className="score-quick-picker-bar">
                <button className="btn btn-ghost btn-sm" type="button" onClick={toggleAllStudents}>
                  {selectedStudentIds.length === activeRoster.length ? '取消全选' : '全选'}
                </button>
                <select
                  className="input-field score-quick-sort"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as StudentSortKey)}
                >
                  <option value="en_asc">英文名 A→Z</option>
                  <option value="en_desc">英文名 Z→A</option>
                </select>
                <input
                  className="input-field score-quick-score"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="分数"
                  value={pickerScore}
                  onChange={(event) => setPickerScore(event.target.value)}
                />
                <button className="btn btn-ghost" type="button" onClick={handleAddPickerGroup}>
                  批量加入
                </button>
              </div>
              <div className="score-quick-picker-grid">
                {activeRoster.map((student) => {
                  const matchedRow = findRosterRowForStudent(selectedRoster?.rows || [], student);
                  const hasRecorded = matchedRow ? rowHasRecordedScore(matchedRow) : false;
                  const isSelected = selectedStudentIds.includes(student.studentId);
                  return (
                    <button
                      key={student.studentId}
                      type="button"
                      className={`score-quick-student-chip${isSelected ? ' is-selected' : ''}${hasRecorded ? ' is-recorded' : ''}`}
                      onClick={() => toggleStudent(student.studentId)}
                      aria-pressed={isSelected}
                    >
                      <span className="score-quick-student-check" aria-hidden="true">
                        {isSelected ? '✓' : ''}
                      </span>
                      <strong>{formatStudentPrimary(student)}</strong>
                      {hasRecorded && <span className="score-quick-student-status">已录</span>}
                      {!student.englishName && student.chineseName && <span>{student.chineseName}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {activeRoster.length > 0 && inputMode === 'photo' && (
            <div className="score-quick-photo-box">
              <div className="score-quick-photo-row">
                <input
                  className="input-field score-quick-photo-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => handlePickPhoto(event.target.files?.[0] || null)}
                />
                <button className="btn btn-ghost" type="button" onClick={handleImportPhoto} disabled={ocrImporting || !ocrFile}>
                  {ocrImporting ? '识别中...' : '开始识别'}
                </button>
              </div>
              {(ocrFile || ocrStatusText) && (
                <div className={`score-quick-alert ${ocrState === 'success' ? 'is-success' : ocrState === 'error' ? 'is-error' : 'is-info'}`}>
                  {ocrStatusText || ocrFile?.name}
                </div>
              )}
              {ocrIssues.length > 0 && (
                <div className="score-quick-photo-issues">
                  <strong>未匹配</strong>
                  <div className="score-quick-photo-issue-list">
                    {ocrIssues.map((item) => (
                      <span key={item} className="chip">{item}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {ocrReviewEntries.length > 0 && (
            <div className="score-quick-draft-box">
              <div className="score-quick-draft-head">
                <strong>待确认</strong>
                <div className="score-quick-draft-meta">
                  <span className="chip">{ocrReviewEntries.length} 人</span>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={acceptAllOcrReview}>
                    全部加入待同步
                  </button>
                </div>
              </div>
              <div className="score-quick-draft-list">
                {ocrReviewEntries.map((entry) => (
                  <div key={`${entry.studentId}-${entry.rawToken}`} className="score-quick-draft-item">
                    <div>
                      <strong>{entry.englishName || entry.chineseName}</strong>
                      {entry.englishName && entry.chineseName && <span>{entry.chineseName}</span>}
                    </div>
                    <div className="score-quick-draft-right">
                      <span className="chip">{entry.score} 分</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => acceptOcrReview(entry.studentId)}>加入</button>
                      <button type="button" onClick={() => removeOcrReview(entry.studentId)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="score-quick-draft-box">
            <div className="score-quick-draft-head">
              <strong>待同步名单</strong>
              <div className="score-quick-draft-meta">
                <span className="chip">{draftEntries.length} 人</span>
                <span className="chip">待补 {missingCount} 人</span>
                {draftEntries.length > 0 && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={clearDraftEntries}>
                    清空
                  </button>
                )}
                {draftEntries.length > 0 && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={copyDraftBackupText}>
                    复制文字
                  </button>
                )}
                {draftEntries.length > 0 && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={exportDraftBackup}>
                    导出表格
                  </button>
                )}
              </div>
            </div>

            {draftEntries.length === 0 ? (
              <div className="score-quick-empty">还没有加入任何学生。</div>
            ) : (
              <div className="score-quick-draft-list">
                {draftEntries.map((entry) => (
                  <div key={entry.studentId} className="score-quick-draft-item">
                    <div>
                      <strong>{entry.englishName || entry.chineseName}</strong>
                      {entry.englishName && entry.chineseName && <span>{entry.chineseName}</span>}
                    </div>
                    <div className="score-quick-draft-right">
                      {inlineEdit?.list === 'draft' && inlineEdit.studentId === entry.studentId ? (
                        <input
                          className="input-field score-quick-inline-score"
                          type="number"
                          min="0"
                          step="1"
                          autoFocus
                          value={inlineEdit.value}
                          onChange={(event) => updateInlineEditValue(event.target.value)}
                          onBlur={commitInlineEdit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitInlineEdit();
                            if (event.key === 'Escape') cancelInlineEdit();
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="score-quick-inline-trigger"
                          onDoubleClick={() => startDraftInlineEdit(entry)}
                          title="双击直接改分"
                        >
                          {entry.score} 分
                        </button>
                      )}
                      <button type="button" onClick={() => removeDraftEntry(entry.studentId)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedRoster && missingRows.length > 0 && (
            <div className="score-quick-draft-box">
              <div className="score-quick-draft-head">
                <strong>待补学生</strong>
                <div className="score-quick-draft-meta">
                  <span className="chip">{missingRows.length} 人</span>
                  {hasAlmostDoneReminder && <span className="chip chip-soft">少于 5 人，直接点名确认</span>}
                </div>
              </div>

              {hasAlmostDoneReminder && (
                <div className="score-quick-alert is-info">
                  还差这 {missingRows.length} 人没有处理：
                  {missingRows.map((row) => getRowDisplayName(row)).join('、')}
                  。请确认他们是未参与，还是老师漏勾了要单独补分。
                </div>
              )}

              <div className="score-quick-draft-list">
                {missingRows.map((row) => (
                  <div key={row.rowId} className="score-quick-draft-item">
                    <div>
                      <strong>{getRowDisplayName(row)}</strong>
                      {row.enName && row.chName && <span>{row.chName}</span>}
                    </div>
                    <div className="score-quick-draft-right">
                      {inlineEdit?.list === 'roster' && inlineEdit.rowId === row.rowId ? (
                        <input
                          className="input-field score-quick-inline-score"
                          type="number"
                          min="0"
                          step="1"
                          autoFocus
                          placeholder="分数"
                          value={inlineEdit.value}
                          onChange={(event) => updateInlineEditValue(event.target.value)}
                          onBlur={commitInlineEdit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitInlineEdit();
                            if (event.key === 'Escape') cancelInlineEdit();
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="score-quick-inline-trigger is-muted"
                          onDoubleClick={() => startRosterInlineEdit(row)}
                          title="双击直接录分"
                        >
                          {getRowCurrentScore(row) || row.status || '未录'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="score-quick-roster-note">
            <label className="score-quick-checkbox">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(event) => setOverwriteExisting(event.target.checked)}
              />
              <span>允许覆盖已批改</span>
            </label>
            <label className="score-quick-checkbox">
              <input
                type="checkbox"
                checked={fillMissingAbsent}
                onChange={(event) => setFillMissingAbsent(event.target.checked)}
              />
              <span>把剩余待补学生记为未参与</span>
            </label>
            <span className="score-quick-helper-text">默认只同步本次待同步名单；未勾选时，剩余学生不会被静默改成未参与。</span>
          </div>

          {noticeMessage && <div className={`score-quick-alert is-${noticeTone}`}>{noticeMessage}</div>}

          {selectedRoster && draftAssignmentAnalysis.unresolved.length > 0 && (
            <div className="score-quick-alert is-error">
              还有 {draftAssignmentAnalysis.unresolved.length} 个学生没和官网名单对上：
              {draftAssignmentAnalysis.unresolved.slice(0, 8).map((entry) => entry.englishName || entry.chineseName || entry.studentId).join('、')}
            </div>
          )}

          {submitResult && (
            <div className="score-quick-alert is-success">
              已提交 {submitResult.submittedCount} 条，匹配 {submitResult.matchedCount} 人，补未参与 {submitResult.absentFilledCount} 人。
              {submitResult.skippedExisting.length > 0 && ` 跳过已批改 ${submitResult.skippedExisting.length} 条。`}
            </div>
          )}

          {failureBackupText && (
            <div className="score-quick-backup-box">
              <div className="score-quick-backup-head">
                <strong>官网同步失败备份</strong>
                <button className="btn btn-ghost btn-sm" type="button" onClick={copyFailureBackupText}>
                  复制备份文字
                </button>
              </div>
              <div className="score-quick-helper-text">
                这些成绩还没有写入官网。请先保留这段文字，稍后可重新粘贴录入。
              </div>
              <textarea
                className="input-field score-quick-backup-textarea"
                readOnly
                value={failureBackupText}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}

          <div className="score-quick-submit-row">
            <button className="btn btn-primary" type="button" disabled={submitting || draftEntries.length === 0 || !selectedNoticeId} onClick={handleSubmit}>
              {submitting ? '同步中...' : '同步到官网'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
