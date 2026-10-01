import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { MakeupDataset, MakeupOccurrence, MakeupClassMeta, ScoredCandidate, StageKey } from '../types/makeup';
import { ALL_STAGES } from '../types/makeup';
import { loadMultiStageStore, saveStageData, clearStageData, loadStageData, getLoadedStages, parseJsonImport, parseXlsxImport, importAmberScheduleBundle, shouldSyncAmberBundle, AMBER_BUNDLED_STAGES, isStorageQuotaExceeded, replaceStoreWithBundle } from '../utils/makeupData';
import { calcScore, evaluateLessonMatch, evaluateSpecialLessonMatch, evaluateCoverageFallbackMatch } from '../utils/makeupScoring';
import { generateParentMessage, generateTeacherMessage } from '../utils/makeupMessages';
import { initWeekDetection, parseQuickInput, getSortedWeekLabels, getWeekNumber } from '../utils/makeupParser';
import './MakeupTool.css';
import { recommendScheduleMakeup } from '../utils/scheduleRecommendations.mjs';
import { unavailableStageMessage } from '../utils/scheduleExtraction.mjs';

interface Props {
  onBack: () => void;
}

function compareOccByWeek(a: MakeupOccurrence, b: MakeupOccurrence): number {
  const colA = Number.isFinite(a.week_col) ? a.week_col : Number.MAX_SAFE_INTEGER;
  const colB = Number.isFinite(b.week_col) ? b.week_col : Number.MAX_SAFE_INTEGER;
  if (colA !== colB) return colA - colB;
  return a.week_label.localeCompare(b.week_label);
}

const DAY_ORDER = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_INDEX: Record<string, number> = {
  '周一': 1,
  '周二': 2,
  '周三': 3,
  '周四': 4,
  '周五': 5,
  '周六': 6,
  '周日': 7,
};
const FIXED_WEEKDAY_SLOT_TIMES = ['18:20', '19:30'];
const FIXED_WEEKEND_SLOT_TIMES = ['09:00', '10:10', '11:20', '12:30', '13:40', '14:50', '16:00', '17:10', '18:20', '19:30', '20:30'];
const MAKEUP_TOOL_VERSION = '时间矩阵版 2026-04-14 06:11';
const AMBER_STAGE_SET = new Set<StageKey>(AMBER_BUNDLED_STAGES);
const AMBER_BUNDLE_PATH = '4.13';
const AMBER_BUNDLE_LABEL = '2026秋季课表';
const AMBER_IMPORT_TIP = '各学段进度实时调整，建议老师上传学段最新进度表。';
let pendingAutomaticBundle: ReturnType<typeof importAmberScheduleBundle> | null = null;
function loadAutomaticBundle(onProgress: (message: string) => void) {
  if (!pendingAutomaticBundle) {
    pendingAutomaticBundle = importAmberScheduleBundle(AMBER_BUNDLE_PATH, onProgress)
      .finally(() => { pendingAutomaticBundle = null; });
  }
  return pendingAutomaticBundle;
}


function timeToMinutes(value: string): number | null {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function parseTimeRanges(value: string): Array<{ start: number; end: number; label: string }> {
  return String(value || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const range = part.match(/(\d{1,2}:\d{2})\s*[-—~～]\s*(\d{1,2}:\d{2})/);
      if (range) {
        const start = timeToMinutes(range[1]);
        const end = timeToMinutes(range[2]);
        if (start != null && end != null && end > start) {
          return { start, end, label: `${range[1]}-${range[2]}` };
        }
      }
      const start = timeToMinutes(part);
      if (start != null) {
        return { start, end: start + 60, label: part };
      }
      return null;
    })
    .filter(Boolean) as Array<{ start: number; end: number; label: string }>;
}

function formatMinutes(total: number): string {
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): { start: number; end: number } | null {
  if (!ranges.length) return null;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let start = sorted[0].start;
  let end = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current.start <= end + SLOT_BOUNDARY_TOLERANCE_MINUTES) {
      end = Math.max(end, current.end);
      continue;
    }
    break;
  }
  return { start, end };
}

function getOccurrenceRanges(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): Array<{ start: number; end: number }> {
  const ranges = parseTimeRanges(occ.time);
  if (ranges.length) return ranges.map(({ start, end }) => ({ start, end }));
  const meta = classesByCode.get(occ.class_code);
  const schedule = occ.mode === '周末' ? meta?.weekend : meta?.weekday;
  const fallback = parseTimeRanges(schedule?.time || '');
  if (fallback.length) return fallback.map(({ start, end }) => ({ start, end }));
  const start = timeToMinutes(String(occ.time).slice(0, 5));
  return start != null ? [{ start, end: start + 60 }] : [];
}

function getOccurrenceWindowLabel(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): string {
  const merged = mergeRanges(getOccurrenceRanges(occ, classesByCode));
  if (!merged) return occ.time;
  return `${formatMinutes(merged.start)}-${formatMinutes(merged.end)}`;
}

function getOccurrenceDuration(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): number | null {
  const merged = mergeRanges(getOccurrenceRanges(occ, classesByCode));
  return merged ? merged.end - merged.start : null;
}

function getOccurrenceStartBucket(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): string {
  const merged = mergeRanges(getOccurrenceRanges(occ, classesByCode));
  return merged ? formatMinutes(merged.start) : normalizeSlotBucketTime(String(occ.time).slice(0, 5));
}

function getOccurrenceBlockKey(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): string {
  const merged = mergeRanges(getOccurrenceRanges(occ, classesByCode));
  const windowKey = merged ? `${merged.start}-${merged.end}` : occ.time;
  return `${occ.class_code}|${occ.week_label}|${occ.day}|${windowKey}`;
}

function getDisplayGrade(occ: MakeupOccurrence, classesByCode: Map<string, MakeupClassMeta>): string {
  return occ.grade || classesByCode.get(occ.class_code)?.grade || '';
}

function formatClassLabel(meta: MakeupClassMeta, showGrade: boolean): string {
  const parts = [meta.class_code];
  if (showGrade && meta.grade) parts.push(meta.grade);
  if (meta.type) parts.push(meta.type);
  return parts.join('｜');
}

function hasGeneralMakeupIntent(text: string): boolean {
  return /想补|补课|调课|调到|改到|挪到|换到|特殊调整|考虑补课|需要补课|要补课|安排补课|补一下课|补一节课|补上这节课|补这节课|补回这节课/.test(text);
}

function getMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function getDefaultFutureSlotKeys(slots: string[], now: Date): string[] {
  const uniqueSlots: string[] = [];
  for (const slotKey of slots) {
    if (!uniqueSlots.includes(slotKey)) uniqueSlots.push(slotKey);
  }
  return uniqueSlots;
}

function sortSlotKeys(slotKeys: Iterable<string>): string[] {
  const order = getAllFixedSlotKeys();
  const selected = new Set(slotKeys);
  return order.filter((slotKey) => selected.has(slotKey));
}

function isFutureOccurrenceFromNow(occ: MakeupOccurrence, currentWeek: string | null, now: Date): boolean {
  if (occ.week_col >= 10000) return true;
  const occWeek = getWeekNumber(occ.week_label);
  const currentWeekNum = getWeekNumber(currentWeek);
  if (occWeek == null || currentWeekNum == null) return true;
  if (occWeek > currentWeekNum) return true;
  if (occWeek < currentWeekNum) return false;
  const today = DAY_INDEX[DAY_ORDER[(now.getDay() + 6) % 7]] ?? 1;
  const occDay = DAY_INDEX[occ.day] ?? 0;
  if (occDay > today) return true;
  if (occDay < today) return false;
  const occMinutes = timeToMinutes(String(occ.time).slice(0, 5));
  return occMinutes == null || occMinutes >= getMinutesOfDay(now);
}

function normalizeSlotBucketTime(value: string): string {
  const ranges = parseTimeRanges(value);
  const minutes = ranges.length ? ranges[0].start : timeToMinutes(value);
  if (minutes == null) return value;
  const rounded = Math.round(minutes / 10) * 10;
  const hour = Math.floor(rounded / 60) % 24;
  const minute = rounded % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function getFixedSlotTimesByDay(day: string): string[] {
  return day === '周六' || day === '周日' ? FIXED_WEEKEND_SLOT_TIMES : FIXED_WEEKDAY_SLOT_TIMES;
}

function getAllFixedSlotKeys(): string[] {
  const keys: string[] = [];
  for (const day of DAY_ORDER) {
    for (const time of getFixedSlotTimesByDay(day)) {
      keys.push(`${day}|${time}`);
    }
  }
  return keys;
}

function mapToFixedSlotTime(day: string, rawTime: string): string {
  const bucket = normalizeSlotBucketTime(rawTime);
  const bucketMinutes = timeToMinutes(bucket);
  const slotTimes = getFixedSlotTimesByDay(day);
  if (bucketMinutes == null || !slotTimes.length) return bucket;
  const nearest = slotTimes
    .map((time) => ({ time, diff: Math.abs((timeToMinutes(time) ?? 0) - bucketMinutes) }))
    .sort((a, b) => a.diff - b.diff)[0];
  return nearest?.time || bucket;
}

function isSlotDayAllowedForGenericMakeup(originDay: string, candidateDay: string): boolean {
  const originIndex = DAY_INDEX[originDay] ?? 0;
  const candidateIndex = DAY_INDEX[candidateDay] ?? 0;
  if (!originIndex || !candidateIndex) return true;
  return candidateIndex >= originIndex;
}

function isWithinFuzzyWindow(baseTime: string, targetTime: string, tolerance = 5): boolean {
  const baseMinutes = timeToMinutes(baseTime);
  const targetMinutes = timeToMinutes(targetTime);
  if (baseMinutes == null || targetMinutes == null) return false;
  return Math.abs(baseMinutes - targetMinutes) <= tolerance;
}

const SLOT_BOUNDARY_TOLERANCE_MINUTES = 15;

export default function MakeupTool({ onBack }: Props) {
  // Multi-stage
  const [activeStage, setActiveStage] = useState<StageKey>(() => loadMultiStageStore().activeStage);
  const [stageInfo, setStageInfo] = useState(() => getLoadedStages());

  // Data
  const [dataset, setDataset] = useState<MakeupDataset | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [amberImporting, setAmberImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form
  const [originClass, setOriginClass] = useState('');
  const [missedLessonId, setMissedLessonId] = useState('');
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [studentName, setStudentName] = useState('');
  const [quickInput, setQuickInput] = useState('');
  const [quickFeedback, setQuickFeedback] = useState('');
  const [currentMatches, setCurrentMatches] = useState<ReturnType<typeof recommendScheduleMakeup> | null>(null);
  const [chosenMatch, setChosenMatch] = useState<number | null>(null);
  const [matchConfirmed, setMatchConfirmed] = useState(false);
  useEffect(() => { setCurrentMatches(null); setChosenMatch(null); setMatchConfirmed(false); }, [dataset, quickInput]);
  const [quickSelectionError, setQuickSelectionError] = useState('');

  // Interaction
  const [activeCandidate, setActiveCandidate] = useState<{ origin: MakeupOccurrence; candidate: MakeupOccurrence; kind: 'primary' | 'special' } | null>(null);

  // Load on mount & stage switch
  useEffect(() => {
    const saved = loadStageData(activeStage);
    setDataset(saved);
    resetForm();
    setImportStatus('');
  }, [activeStage]);

  useEffect(() => {
    if (!shouldSyncAmberBundle()) return;
    let cancelled = false;
    setAmberImporting(true);
    setImportStatus('正在检查并同步最新 Amber 进度表…');
    loadAutomaticBundle((msg) => { if (!cancelled) setImportStatus(msg); })
      .then((bundle) => {
        if (cancelled) return;
        const importedStages = Object.keys(bundle).length;
        replaceStoreWithBundle(bundle, activeStage, true);
        const currentStageData = loadStageData(activeStage);
        if (currentStageData?.meta.source_kind === 'amber_bundle') { setDataset(currentStageData); resetForm(); }
        setStageInfo(getLoadedStages());
        setImportStatus(`已自动同步 ${AMBER_BUNDLE_LABEL}，共 ${importedStages} 个学段；手动上传的进度表保留。${AMBER_IMPORT_TIP}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setImportStatus('自动刷新 Amber 课表失败：' + (err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        if (!cancelled) setAmberImporting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStage]);

  // ── Derived data ──

  const classesByCode = useMemo(() => {
    if (!dataset) return new Map<string, MakeupClassMeta>();
    return new Map(dataset.classes.map((c) => [c.class_code, c]));
  }, [dataset]);

  const occByClass = useMemo(() => {
    if (!dataset) return new Map<string, MakeupOccurrence[]>();
    const m = new Map<string, MakeupOccurrence[]>();
    for (const occ of dataset.occurrences) {
      if (!m.has(occ.class_code)) m.set(occ.class_code, []);
      m.get(occ.class_code)!.push(occ);
    }
    return m;
  }, [dataset]);

  const weekCtx = useMemo(() => {
    if (!dataset) return null;
    return initWeekDetection(dataset.occurrences);
  }, [dataset]);

  const datasetHasGrade = useMemo(() => {
    if (!dataset) return false;
    return dataset.meta.has_grade ?? dataset.classes.some((item) => !!String(item.grade || '').trim());
  }, [dataset]);

  const lessonOptions = useMemo(() => {
    if (!originClass) return [];
    return (occByClass.get(originClass) || []).slice().sort(compareOccByWeek);
  }, [originClass, occByClass]);

  const lessonMeta = useMemo(() => {
    if (!originClass) return '';
    const labels = getSortedWeekLabels(lessonOptions);
    return labels.length
      ? `已识别 ${lessonOptions.length} 节课，覆盖 ${labels.length} 个周次`
      : '当前班级在底表里还没有可用课次';
  }, [originClass, lessonOptions]);

  const originOcc = useMemo(() => {
    if (!missedLessonId || !dataset) return null;
    return dataset.occurrences.find((o) => o.id === missedLessonId) || null;
  }, [missedLessonId, dataset]);

  // ── Results ──

  const primaryResultsBySlot = useMemo(() => {
    const hasCoverageGap = quickSelectionError.includes('当前进度表只到');
    if (!originOcc || !dataset || selectedSlots.length === 0 || hasCoverageGap) return new Map<string, ScoredCandidate[]>();
    const bySlot = new Map<string, ScoredCandidate[]>();
    const now = new Date();
    const originSlotTime = mapToFixedSlotTime(originOcc.day, getOccurrenceStartBucket(originOcc, classesByCode));

    for (const candidate of dataset.occurrences) {
      if (candidate.class_code === originOcc.class_code) continue;
      if (!evaluateLessonMatch(originOcc, candidate).matched) continue;
      if (!isFutureOccurrenceFromNow(candidate, weekCtx?.currentWeek || null, now)) continue;
      const originDuration = getOccurrenceDuration(originOcc, classesByCode);
      const candidateDuration = getOccurrenceDuration(candidate, classesByCode);
      if (originDuration && candidateDuration && Math.abs(originDuration - candidateDuration) > 20) continue;
      const candidateSlotTime = mapToFixedSlotTime(candidate.day, getOccurrenceStartBucket(candidate, classesByCode));
      if (candidate.day === originOcc.day && (timeToMinutes(candidateSlotTime) ?? -1) <= (timeToMinutes(originSlotTime) ?? -1)) continue;
      const matchedSlot = selectedSlots.find((slotKey) => {
        const [day, time] = slotKey.split('|');
        return day === candidate.day && (time === candidateSlotTime || isWithinFuzzyWindow(time, candidateSlotTime, 15));
      });
      if (!matchedSlot) continue;
      const candidateBlockKey = getOccurrenceBlockKey(candidate, classesByCode);
      const existing = bySlot.get(matchedSlot) || [];
      if (existing.some((item) => getOccurrenceBlockKey(item.candidate, classesByCode) === candidateBlockKey)) continue;
      const scored = calcScore(originOcc, candidate, selectedSlots.indexOf(matchedSlot), classesByCode, {
        considerGrade: datasetHasGrade,
      });
      if (!bySlot.has(matchedSlot)) bySlot.set(matchedSlot, []);
      bySlot.get(matchedSlot)!.push(scored);
    }

    for (const arr of bySlot.values()) {
      arr.sort((a, b) => b.sortKey - a.sortKey);
    }
    return bySlot;
  }, [originOcc, dataset, selectedSlots, classesByCode, datasetHasGrade, weekCtx, quickSelectionError]);

  const totalPrimaryMatches = useMemo(() => {
    let n = 0;
    for (const arr of primaryResultsBySlot.values()) n += arr.length;
    return n;
  }, [primaryResultsBySlot]);

  const specialResultsBySlot = useMemo(() => {
    if (!originOcc || !dataset || selectedSlots.length === 0 || totalPrimaryMatches > 0) return new Map<string, ScoredCandidate[]>();
    const bySlot = new Map<string, ScoredCandidate[]>();
    const now = new Date();

    for (const candidate of dataset.occurrences) {
      if (candidate.class_code === originOcc.class_code) continue;
      const specialMatch = evaluateSpecialLessonMatch(originOcc, candidate);
      if (!specialMatch.matched) continue;
      if (!isFutureOccurrenceFromNow(candidate, weekCtx?.currentWeek || null, now)) continue;
      const originDuration = getOccurrenceDuration(originOcc, classesByCode);
      const candidateDuration = getOccurrenceDuration(candidate, classesByCode);
      if (originDuration && candidateDuration && Math.abs(originDuration - candidateDuration) > 20) continue;
      const candidateSlotTime = mapToFixedSlotTime(candidate.day, getOccurrenceStartBucket(candidate, classesByCode));
      const matchedSlot = selectedSlots.find((slotKey) => {
        const [day, time] = slotKey.split('|');
        return day === candidate.day && (time === candidateSlotTime || isWithinFuzzyWindow(time, candidateSlotTime, 15));
      });
      if (!matchedSlot) continue;
      const candidateBlockKey = getOccurrenceBlockKey(candidate, classesByCode);
      const existing = bySlot.get(matchedSlot) || [];
      if (existing.some((item) => getOccurrenceBlockKey(item.candidate, classesByCode) === candidateBlockKey)) continue;
      const scored = calcScore(originOcc, candidate, selectedSlots.indexOf(matchedSlot), classesByCode, {
        considerGrade: datasetHasGrade,
        specialMode: true,
      });
      if (!bySlot.has(matchedSlot)) bySlot.set(matchedSlot, []);
      bySlot.get(matchedSlot)!.push(scored);
    }

    for (const arr of bySlot.values()) {
      arr.sort((a, b) => b.sortKey - a.sortKey);
    }
    return bySlot;
  }, [originOcc, dataset, selectedSlots, totalPrimaryMatches, classesByCode, datasetHasGrade, weekCtx]);

  const totalSpecialMatches = useMemo(() => {
    let n = 0;
    for (const arr of specialResultsBySlot.values()) n += arr.length;
    return n;
  }, [specialResultsBySlot]);

  const coverageResultsBySlot = useMemo(() => {
    const hasCoverageGap = quickSelectionError.includes('当前进度表只到');
    if (!originOcc || !dataset || selectedSlots.length === 0 || totalPrimaryMatches > 0 || totalSpecialMatches > 0 || !hasCoverageGap) {
      return new Map<string, ScoredCandidate[]>();
    }
    const bySlot = new Map<string, ScoredCandidate[]>();
    const now = new Date();

    for (const candidate of dataset.occurrences) {
      if (candidate.class_code === originOcc.class_code) continue;
      if (!evaluateCoverageFallbackMatch(originOcc, candidate).matched) continue;
      if (!isFutureOccurrenceFromNow(candidate, weekCtx?.currentWeek || null, now)) continue;
      const originDuration = getOccurrenceDuration(originOcc, classesByCode);
      const candidateDuration = getOccurrenceDuration(candidate, classesByCode);
      if (originDuration && candidateDuration && Math.abs(originDuration - candidateDuration) > 20) continue;
      const candidateSlotTime = mapToFixedSlotTime(candidate.day, getOccurrenceStartBucket(candidate, classesByCode));
      const matchedSlot = selectedSlots.find((slotKey) => {
        const [day, time] = slotKey.split('|');
        return day === candidate.day && (time === candidateSlotTime || isWithinFuzzyWindow(time, candidateSlotTime, 15));
      });
      if (!matchedSlot) continue;
      const candidateBlockKey = getOccurrenceBlockKey(candidate, classesByCode);
      const existing = bySlot.get(matchedSlot) || [];
      if (existing.some((item) => getOccurrenceBlockKey(item.candidate, classesByCode) === candidateBlockKey)) continue;
      const scored = calcScore(originOcc, candidate, selectedSlots.indexOf(matchedSlot), classesByCode, {
        considerGrade: datasetHasGrade,
        coverageMode: true,
      });
      if (!bySlot.has(matchedSlot)) bySlot.set(matchedSlot, []);
      bySlot.get(matchedSlot)!.push(scored);
    }

    for (const arr of bySlot.values()) {
      arr.sort((a, b) => b.sortKey - a.sortKey);
    }
    return bySlot;
  }, [originOcc, dataset, selectedSlots, totalPrimaryMatches, totalSpecialMatches, quickSelectionError, classesByCode, datasetHasGrade, weekCtx]);

  const totalCoverageMatches = useMemo(() => {
    let n = 0;
    for (const arr of coverageResultsBySlot.values()) n += arr.length;
    return n;
  }, [coverageResultsBySlot]);

  // ── Messages ──

  const parentMsg = useMemo(() => {
    if (!activeCandidate) return '';
    return generateParentMessage(activeCandidate.origin, activeCandidate.candidate, studentName, {
      specialMode: activeCandidate.kind === 'special',
    });
  }, [activeCandidate, studentName]);

  const teacherMsg = useMemo(() => {
    if (!activeCandidate) return '';
    return generateTeacherMessage(activeCandidate.origin, activeCandidate.candidate, studentName, {
      specialMode: activeCandidate.kind === 'special',
    });
  }, [activeCandidate, studentName]);

  // ── Handlers ──

  const handleImport = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setImportStatus('请先选择文件'); return; }
    setImportStatus(`正在导入 ${file.name}...`);
    try {
      let data: MakeupDataset;
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.json')) {
        data = await parseJsonImport(file);
      } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.numbers') || lowerName.endsWith('.csv')) {
        data = await parseXlsxImport(file, activeStage);
      } else {
        throw new Error('支持 .json、.xlsx、.xls、.csv 或 .numbers 文件');
      }
      data.meta.active_stage = activeStage;
      saveStageData(activeStage, data);
      setDataset(data);
      setStageInfo(getLoadedStages());
      setImportStatus(`已提取 ${data.classes.length} 个班级，${data.occurrences.length} 条课次${data.meta.extraction ? `，${data.meta.extraction.review_items.length} 项待核实` : ''}`);
      resetForm();
    } catch (err) {
      setImportStatus('导入失败：' + (err instanceof Error ? err.message : String(err)));
    }
  }, [activeStage]);

  const handleImportAmber = useCallback(async () => {
    if (!AMBER_STAGE_SET.has(activeStage)) {
      setImportStatus(unavailableStageMessage(activeStage));
      return;
    }
    setAmberImporting(true);
    setImportStatus(`正在获取 Amber ${AMBER_BUNDLE_LABEL}（同步全部已提供学段）...`);
    try {
      const bundle = await importAmberScheduleBundle(AMBER_BUNDLE_PATH, (msg) => setImportStatus(msg));
      const importedStages = Object.keys(bundle).length;
      try {
        const resolvedStage = replaceStoreWithBundle(bundle, activeStage);
        if (resolvedStage !== activeStage) setActiveStage(resolvedStage);
      } catch (err) {
        if (!isStorageQuotaExceeded(err)) {
          throw err;
        }
        const currentStageData = bundle[activeStage];
        if (!currentStageData) {
          throw new Error('手机浏览器存储空间不足，且当前学段数据不可用');
        }
        setDataset(currentStageData);
        setStageInfo(getLoadedStages());
        setImportStatus(`浏览器存储空间不足，最新 ${activeStage} 仅在本次页面使用，尚未保存；原有各学段数据保留。${AMBER_IMPORT_TIP}`);
        resetForm();
        return;
      }
      const currentStageData = bundle[activeStage] || loadStageData(activeStage);
      setDataset(currentStageData);
      setStageInfo(getLoadedStages());
      if (!currentStageData) {
        setImportStatus(`已同步 ${AMBER_BUNDLE_LABEL}，共 ${importedStages} 个学段。${AMBER_IMPORT_TIP}`);
      } else {
        setImportStatus(`已同步 ${AMBER_BUNDLE_LABEL}，共 ${importedStages} 个学段；当前 ${activeStage}：${currentStageData.classes.length} 个班级，${currentStageData.occurrences.length} 条课次。${AMBER_IMPORT_TIP}`);
      }
      resetForm();
    } catch (err) {
      setImportStatus('同步 Amber 课表失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAmberImporting(false);
    }
  }, [activeStage]);

  function resetForm() {
    setOriginClass('');
    setMissedLessonId('');
    setSelectedSlots([]);
    setActiveCandidate(null);
    setQuickFeedback('');
  }

  function handleStageSwitch(stage: StageKey) {
    setActiveStage(stage);
  }

  function handleClassChange(code: string) {
    setOriginClass(code);
    setMissedLessonId('');
    setActiveCandidate(null);
  }

  function handleLessonChange(id: string) {
    setMissedLessonId(id);
    setActiveCandidate(null);
  }

  function toggleSlot(key: string) {
    setSelectedSlots((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
    setActiveCandidate(null);
  }

  function applyRequestedSlot(
    day: string,
    time: string,
    mode: 'exact' | 'after' | 'before' | 'range',
    availableKeys: string[],
    endTime?: string,
  ): string[] {
    const dayKeys = availableKeys.filter((slotKey) => slotKey.startsWith(`${day}|`));
    const targetMinutes = timeToMinutes(time);
    if (targetMinutes == null) return [];
    if (mode === 'range') {
      const endMinutes = timeToMinutes(endTime || '');
      if (endMinutes == null) return [];
      const minMinutes = Math.min(targetMinutes, endMinutes) - SLOT_BOUNDARY_TOLERANCE_MINUTES;
      const maxMinutes = Math.max(targetMinutes, endMinutes) + SLOT_BOUNDARY_TOLERANCE_MINUTES;
      return dayKeys.filter((slotKey) => {
        const slotMinutes = timeToMinutes(slotKey.split('|')[1]);
        return slotMinutes != null && slotMinutes >= minMinutes && slotMinutes <= maxMinutes;
      });
    }
    if (mode === 'after') {
      return dayKeys.filter((slotKey) => (timeToMinutes(slotKey.split('|')[1]) ?? -1) >= targetMinutes - SLOT_BOUNDARY_TOLERANCE_MINUTES);
    }
    if (mode === 'before') {
      return dayKeys.filter((slotKey) => (timeToMinutes(slotKey.split('|')[1]) ?? 9999) <= targetMinutes + SLOT_BOUNDARY_TOLERANCE_MINUTES);
    }
    const exact = dayKeys.find((slotKey) => slotKey.endsWith(`|${time}`));
    if (exact) return [exact];
    const sorted = dayKeys
      .map((slotKey) => ({ slotKey, diff: Math.abs((timeToMinutes(slotKey.split('|')[1]) ?? 0) - targetMinutes) }))
      .sort((a, b) => a.diff - b.diff);
    return sorted[0] ? [sorted[0].slotKey] : [];
  }

  function handleQuickParse() {
    if (!dataset || !weekCtx) return;
    const result = parseQuickInput(quickInput, classesByCode, occByClass, weekCtx);

    if (result.classCode) {
      setOriginClass(result.classCode);
    }
    if (result.missedOccId) {
      setMissedLessonId(result.missedOccId);
    }

    const availableSlotKeys = getAllFixedSlotKeys();
    const orderedSlots: string[] = [];
    const pushSlot = (slotKey: string) => {
      if (!orderedSlots.includes(slotKey)) orderedSlots.push(slotKey);
    };
    for (const req of result.makeupRequests) {
      for (const slotKey of applyRequestedSlot(req.day, req.time, req.mode, availableSlotKeys, req.endTime)) {
        pushSlot(slotKey);
      }
    }
    if (result.makeupDaysOnly.length) {
      for (const day of DAY_ORDER) {
        if (result.makeupDaysOnly.includes(day)) {
          for (const time of getFixedSlotTimesByDay(day)) {
            pushSlot(`${day}|${time}`);
          }
        }
      }
    }
    let autoFutureFallback: 'generic' | 'coverage' | null = null;
    if (orderedSlots.length === 0 && hasGeneralMakeupIntent(quickInput)) {
      const originOcc = result.missedOccId
        ? dataset.occurrences.find((item) => item.id === result.missedOccId) || null
        : null;

      if (originOcc) {
        const originSlotKey = `${originOcc.day}|${mapToFixedSlotTime(originOcc.day, getOccurrenceStartBucket(originOcc, classesByCode))}`;
        const originSlotMinutes = timeToMinutes(originSlotKey.split('|')[1]);
        for (const day of DAY_ORDER) {
          if (!isSlotDayAllowedForGenericMakeup(originOcc.day, day)) continue;
          for (const time of getFixedSlotTimesByDay(day)) {
            const slotKey = `${day}|${time}`;
            if (!availableSlotKeys.includes(slotKey)) continue;
            if (slotKey === originSlotKey) continue;
            if (day === originOcc.day) {
              const slotMinutes = timeToMinutes(time);
              if (slotMinutes != null && originSlotMinutes != null && slotMinutes <= originSlotMinutes) continue;
            }
            pushSlot(slotKey);
          }
        }
        if (orderedSlots.length > 0) {
          autoFutureFallback = result.selectionError?.includes('当前进度表只到') ? 'coverage' : 'generic';
        }
      }

    }
    setSelectedSlots(orderedSlots);
    setActiveCandidate(null);
    const feedbackLines = [...result.feedbackLines];
    setQuickSelectionError(result.selectionError || '');
    if (autoFutureFallback) {
      if (autoFutureFallback === 'coverage') {
        feedbackLines.push(`当前周次进度缺失，已自动勾选 ${orderedSlots.length} 个未来可选时段`);
      } else {
        feedbackLines.push(`未指定具体补课时间，已自动勾选 ${orderedSlots.length} 个未来可选时段`);
      }
    } else if (orderedSlots.length === 0 && hasGeneralMakeupIntent(quickInput)) {
      feedbackLines.push('未指定具体补课时间，当前没有筛出未来可补时段');
    }
    setQuickFeedback(feedbackLines.length ? '✓ ' + feedbackLines.join(' ｜ ') : '');
  }

  function handleClearData() {
    clearStageData(activeStage);
    setDataset(null);
    setStageInfo(getLoadedStages());
    resetForm();
    setImportStatus('数据已清除');
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ── Display helpers ──
  const DOW_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  const todayStr = `${today.getMonth() + 1}月${today.getDate()}日 ${DOW_NAMES[today.getDay()]}`;

  const loadedSet = new Set(stageInfo.map((s) => s.stage));

  const slotMatrix = useMemo(() => {
    const slotKeys = new Set(getAllFixedSlotKeys());
    const times = [...new Set([...FIXED_WEEKDAY_SLOT_TIMES, ...FIXED_WEEKEND_SLOT_TIMES])];
    return { times, slotKeys };
  }, []);

  if (dataset?.meta.schedule_revision) return (
    <main className="makeup-wrap">
      <button className="btn btn-ghost" onClick={onBack}>返回</button>
      <h2>补课助手 · 课程进度</h2>
      <div className="makeup-stage-tabs">{ALL_STAGES.map(s => <button key={s} onClick={() => handleStageSwitch(s)}>{s}</button>)}</div>
      <p>{activeStage} · {dataset.classes.length} 个班级 · {dataset.occurrences.length} 条通过提取校验的课次</p>
      <p>{dataset.meta.time_status==='complete'?'已提取具体上课时刻。':'部分或全部课次缺少具体时刻，相关候选的时间条件待核实。'}地点和接收名额需老师确认。</p>
      {dataset.meta.extraction && <details><summary>查看字段提取情况与待核实项</summary>
        <p>{Object.entries(dataset.meta.extraction.missing_field_counts).map(([field,n])=>`${({time:'上课时间',teacher:'老师',campus:'校区',room:'教室'} as Record<string,string>)[field]||field}缺失 ${n} 条`).join('；')}</p>
        {dataset.meta.extraction.review_items.map((item,i)=><p key={i}>{item.source?.sheet} {item.source?.cell}：{item.message}</p>)}
      </details>}
      <textarea aria-label="补课需求" value={quickInput} onChange={e=>setQuickInput(e.target.value)} placeholder="例如：K218 W2周二请假，想周四补课" />
      <button className="btn btn-primary" onClick={()=>{ const result=recommendScheduleMakeup(dataset,quickInput); setCurrentMatches(result); setChosenMatch(null); setMatchConfirmed(false); setQuickFeedback(result.message); }}>查找同进度候选</button>
      <pre style={{whiteSpace:'pre-wrap'}}>{quickFeedback}</pre>
      <div>{currentMatches?.candidates.map((c,i)=><label key={i} style={{display:'block',padding:'8px 0'}}>
        <input type="radio" name="makeup-candidate" checked={chosenMatch===i} onChange={()=>{setChosenMatch(i);setMatchConfirmed(false);}} />
        {c.class_code}｜{c.grade || '年级待核实'}｜{c.student_count || '人数待核实'}{c.student_count ? '人' : ''}｜班主任：{c.head_teacher || '待核实'}｜授课：{c.teacher || '待核实'}｜{c.campus || '校区待核实'}｜{c.date} {c.day} {c.time || '时间待核实'}
      </label>)}</div>
      {!!currentMatches?.candidates.length && <><input aria-label="补课学生姓名" value={studentName} onChange={e=>setStudentName(e.target.value)} placeholder="学生姓名（选填）"/>
      <button disabled={chosenMatch===null} onClick={()=>setMatchConfirmed(true)}>确认选择，生成网站原版话术</button></>}
      {matchConfirmed && chosenMatch!==null && currentMatches?.origin && <section>
        <p>以下为待核实草稿，未发送。请先确认具体时间、地点和接收名额。</p>
        <h3>给家长</h3><pre style={{whiteSpace:'pre-wrap'}}>{generateParentMessage(currentMatches.origin,currentMatches.candidates[chosenMatch],studentName)}</pre>
        <button onClick={()=>copyToClipboard(generateParentMessage(currentMatches.origin!,currentMatches.candidates[chosenMatch],studentName))}>复制家长话术</button>
        <h3>给接收班班主任</h3><pre style={{whiteSpace:'pre-wrap'}}>{generateTeacherMessage(currentMatches.origin,currentMatches.candidates[chosenMatch],studentName)}</pre>
        <button onClick={()=>copyToClipboard(generateTeacherMessage(currentMatches.origin!,currentMatches.candidates[chosenMatch],studentName))}>复制班主任话术</button>
      </section>}
      <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,.csv,.numbers" />
      <button onClick={handleImport}>更新当前学段</button>
      <button onClick={handleImportAmber} disabled={amberImporting}>同步最新 L1/L2</button>
      <button onClick={handleClearData}>清除当前学段</button>
      <p>{importStatus}</p>
    </main>
  );

  // ── Render ──

  return (
    <div className="makeup-wrap fade-in">
      <div className="makeup-topbar">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <h2 className="makeup-title">补课助手</h2>
        <span className="makeup-version-badge">{MAKEUP_TOOL_VERSION}</span>
        {dataset && (
          <span className="makeup-meta-badge">
            {activeStage} · {dataset.classes.length} 班 · {dataset.occurrences.length} 课次
          </span>
        )}
      </div>

      {/* Stage tabs + Import section */}
      <section className="makeup-section card">
        <h3 className="makeup-section-title">进度表数据</h3>
        <div className="makeup-stage-tabs">
          {ALL_STAGES.map((s) => (
            <button
              key={s}
              className={`makeup-stage-tab${s === activeStage ? ' active' : ''}${loadedSet.has(s) ? ' loaded' : ''}`}
              onClick={() => handleStageSwitch(s)}
            >
              {s}
              {loadedSet.has(s) && <span className="makeup-stage-dot" />}
            </button>
          ))}
        </div>

        {dataset ? (
          <div className="makeup-data-loaded">
            <div className="makeup-data-pills">
              <span className="pill">底表：{dataset.meta.source_name}</span>
              <span className="pill">导入时间：{dataset.meta.imported_at.replace('T', ' ')}</span>
              <span className="pill">{dataset.classes.length} 个班级</span>
              {weekCtx?.currentWeek && <span className="pill">当前：{weekCtx.currentWeek}</span>}
            </div>
            <div className="makeup-data-actions">
              <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,.csv,.numbers" style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={handleImport}>更新数据</button>
              <button className="btn btn-ghost btn-sm" onClick={handleImportAmber} disabled={amberImporting}>
                {amberImporting ? '同步中...' : `获取 Amber ${AMBER_BUNDLE_LABEL}`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleClearData}>清除</button>
            </div>
            {importStatus && <p className="makeup-status">{importStatus}</p>}
          </div>
        ) : (
          <div className="makeup-data-empty">
            <p>{AMBER_STAGE_SET.has(activeStage)?`当前学段 ${activeStage} 尚未导入进度表，请同步最新课表。`:unavailableStageMessage(activeStage)}</p>
            <div className="makeup-data-actions">
              <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,.csv,.numbers" style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" onClick={handleImport}>导入 {activeStage} 进度表</button>
              <button className="btn btn-ghost btn-sm" onClick={handleImportAmber} disabled={amberImporting}>
                {amberImporting ? '同步中...' : `获取 Amber ${AMBER_BUNDLE_LABEL}`}
              </button>
            </div>
            {importStatus && <p className="makeup-status">{importStatus}</p>}
          </div>
        )}
      </section>

      {dataset && (
        <>
          {/* Quick input */}
          <section className="makeup-section card">
            <h3 className="makeup-section-title">快捷输入</h3>
            <div className="makeup-quick-row">
              <textarea
                className="input-field"
                placeholder="例如：J420 本周周中请假，想周四18:20补课"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuickParse(); } }}
                rows={2}
              />
              <button className="btn btn-primary" onClick={handleQuickParse}>识别填入</button>
            </div>
            <p className="makeup-helper">
              今天 {todayStr}，{weekCtx?.currentWeek ? `当前 ${weekCtx.currentWeek}（${weekCtx.currentWeekMode}）` : '周次未知'}。
              推荐格式：`班号 + 本周周中/周末请假 + 期望补课时间`；班号只识别 `1-2 位大写字母 + 1-3 位数字`。
            </p>
            {quickFeedback && <div className="makeup-feedback">{quickFeedback}</div>}
          </section>

          {/* Main layout */}
          <div className="makeup-layout">
            {/* Left: form */}
            <section className="makeup-panel card">
              <h3 className="makeup-section-title">补课条件</h3>

              <div className="makeup-field">
                <label>学生姓名</label>
                <input
                  className="input-field"
                  placeholder="选填，用于生成通知话术"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                />
              </div>

              <div className="makeup-field">
                <label>原班级</label>
                <select className="input-field" value={originClass} onChange={(e) => handleClassChange(e.target.value)}>
                  <option value="">请选择原班级</option>
                  {dataset.classes.map((c) => (
                    <option key={c.class_code} value={c.class_code}>
                      {formatClassLabel(c, datasetHasGrade)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="makeup-field">
                <label>请假的那节课</label>
                <select
                  className="input-field"
                  value={missedLessonId}
                  onChange={(e) => handleLessonChange(e.target.value)}
                  disabled={!originClass}
                >
                  <option value="">{originClass ? '请选择请假课次' : '先选原班级'}</option>
                  {lessonOptions.map((occ) => (
                    <option key={occ.id} value={occ.id}>
                      {occ.week_label}｜{occ.lesson}｜{occ.day} {getOccurrenceWindowLabel(occ, classesByCode)}
                    </option>
                  ))}
                </select>
                {originClass && <p className="makeup-helper">{lessonMeta}</p>}
              </div>

              <div className="makeup-field">
                <label>家长可接受的补课时间</label>
                <div className="makeup-slot-grid">
                  <div className="makeup-slot-matrix">
                    <div className="makeup-slot-corner" />
                    {DAY_ORDER.map((day) => (
                      <div key={day} className="makeup-slot-day-head">{day}</div>
                    ))}
                    {slotMatrix.times.map((time) => (
                      <Fragment key={time}>
                        <div className="makeup-slot-time-head">{time}</div>
                        {DAY_ORDER.map((day) => {
                          const key = `${day}|${time}`;
                          const exists = slotMatrix.slotKeys.has(key);
                          if (!exists) return <div key={key} className="makeup-slot-cell empty" />;
                          return (
                            <div key={key} className="makeup-slot-cell">
                              <label className={`makeup-slot-toggle ${selectedSlots.includes(key) ? 'selected' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={selectedSlots.includes(key)}
                                  onChange={() => toggleSlot(key)}
                                />
                                <span>{time}</span>
                              </label>
                            </div>
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>
                <p className="makeup-helper">可多选。系统会按勾选顺序展示，再按推荐优先级排序；前后 5 分钟视为同一时间档。</p>
              </div>
            </section>

            {/* Right: results */}
            <section className="makeup-panel card">
              {/* Summary */}
              {originOcc && (
                <div className="makeup-summary">
                  <span className="pill">原班级：{originOcc.class_code}</span>
                  <span className="pill">课次：{originOcc.lesson}</span>
                  <span className="pill">原时间：{originOcc.day} {getOccurrenceWindowLabel(originOcc, classesByCode)}</span>
                  <span className="pill">{selectedSlots.length ? `已选时间：${selectedSlots.length}个` : '还没选补课时间'}</span>
                  {totalPrimaryMatches > 0 && <span className="pill">最佳候选：{totalPrimaryMatches}个</span>}
                  {totalPrimaryMatches === 0 && totalSpecialMatches > 0 && <span className="pill">特殊调整：{totalSpecialMatches}个</span>}
                  {totalPrimaryMatches === 0 && totalSpecialMatches === 0 && totalCoverageMatches > 0 && <span className="pill">弱推荐：{totalCoverageMatches}个</span>}
                </div>
              )}

              {/* Candidates */}
              {!originOcc ? (
                <div className="makeup-empty">先选原班级、请假课次，再勾选备选时间。</div>
              ) : selectedSlots.length === 0 ? (
                <div className="makeup-empty">请先勾选家长能接受的补课时间。</div>
              ) : totalPrimaryMatches === 0 && totalSpecialMatches === 0 && totalCoverageMatches === 0 ? (
                <div className="makeup-empty">这些时间里没有找到最佳补课方案，也没有找到 2 周内可参考的特殊调整方案。</div>
              ) : (
                <div className="makeup-results">
                  {totalPrimaryMatches > 0 && (() => {
                    // Split candidates into same-week and other-week tiers
                    const sameWeekSlots: Array<{ slotKey: string; rows: ScoredCandidate[] }> = [];
                    const otherWeekSlots: Array<{ slotKey: string; rows: ScoredCandidate[] }> = [];
                    for (const slotKey of selectedSlots) {
                      const all = primaryResultsBySlot.get(slotKey);
                      if (!all || !all.length) continue;
                      const same = all.filter((r) => r.weekTier === 2);
                      const other = all.filter((r) => r.weekTier < 2);
                      if (same.length) sameWeekSlots.push({ slotKey, rows: same });
                      if (other.length) otherWeekSlots.push({ slotKey, rows: other });
                    }
                    const renderSlotBlock = (slotKey: string, rows: ScoredCandidate[], keyPrefix: string) => {
                      const [day, time] = slotKey.split('|');
                      return (
                        <div key={`${keyPrefix}-${slotKey}`} className="makeup-slot-block">
                          <div className="makeup-slot-head">
                            <h4>{day} {time}</h4>
                            <span className="makeup-helper">{rows.length} 个候选</span>
                          </div>
                          {rows.map((row, idx) => (
                            <div
                              key={row.candidate.id}
                              className={`makeup-candidate ${activeCandidate?.candidate.id === row.candidate.id ? 'active' : ''}`}
                              onClick={() => setActiveCandidate({ origin: originOcc!, candidate: row.candidate, kind: 'primary' })}
                            >
                              <div className="makeup-candidate-top">
                                <div>
                                  <strong>
                                    {idx + 1}. {row.candidate.class_code}
                                    {datasetHasGrade && getDisplayGrade(row.candidate, classesByCode) ? `｜${getDisplayGrade(row.candidate, classesByCode)}` : ''}
                                  </strong>
                                  <div className="makeup-candidate-meta">
                                    <span>{row.candidate.week_label}</span>
                                    <span>{row.candidate.lesson}</span>
                                    <span>时间：{row.candidate.day} {getOccurrenceWindowLabel(row.candidate, classesByCode)}</span>
                                    <span>班主任：{row.candidate.head_teacher || '未知'}</span>
                                    <span>老师：{row.candidate.teacher || '未知'}</span>
                                    <span>{row.candidate.campus || '校区待确认'}</span>
                                    {row.candidate.student_count && <span>{row.candidate.student_count}人</span>}
                                  </div>
                                </div>
                                <div className="makeup-score">推荐度 {row.pct}%</div>
                              </div>
                              <div className="makeup-reasons">
                                {row.reasons.map((r, ri) => (
                                  <span key={ri} className={`makeup-reason ${r.good ? 'good' : ''}`}>{r.text}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    };
                    return (
                      <>
                        {sameWeekSlots.length > 0 && sameWeekSlots.map((s) => renderSlotBlock(s.slotKey, s.rows, 'same'))}
                        {otherWeekSlots.length > 0 && (
                          <>
                            {sameWeekSlots.length > 0 && (
                              <div className="makeup-feedback" style={{ marginTop: 12, marginBottom: 4 }}>
                                以下为相邻/跨周候选，同一周次候选已在上方展示完毕
                              </div>
                            )}
                            {otherWeekSlots.map((s) => renderSlotBlock(s.slotKey, s.rows, 'other'))}
                          </>
                        )}
                      </>
                    );
                  })()}
                  {totalPrimaryMatches === 0 && totalSpecialMatches > 0 && (
                    <>
                      <div className="makeup-feedback">没有最佳补课方案，以下是 2 周内可参考的特殊调整建议；仅供人工确认后使用。</div>
                      {selectedSlots.map((slotKey) => {
                        const rows = specialResultsBySlot.get(slotKey);
                        if (!rows || !rows.length) return null;
                        const [day, time] = slotKey.split('|');
                        return (
                          <div key={slotKey} className="makeup-slot-block">
                            <div className="makeup-slot-head">
                              <h4>{day} {time}</h4>
                              <span className="makeup-helper">{rows.length} 个特殊调整候选</span>
                            </div>
                            {rows.map((row, idx) => (
                              <div
                                key={row.candidate.id}
                                className={`makeup-candidate ${activeCandidate?.candidate.id === row.candidate.id ? 'active' : ''}`}
                                onClick={() => setActiveCandidate({ origin: originOcc!, candidate: row.candidate, kind: 'special' })}
                              >
                                <div className="makeup-candidate-top">
                                  <div>
                                    <strong>
                                      {idx + 1}. {row.candidate.class_code}
                                      {datasetHasGrade && getDisplayGrade(row.candidate, classesByCode) ? `｜${getDisplayGrade(row.candidate, classesByCode)}` : ''}
                                    </strong>
                                    <div className="makeup-candidate-meta">
                                      <span>{row.candidate.week_label}</span>
                                      <span>{row.candidate.lesson}</span>
                                      <span>时间：{row.candidate.day} {getOccurrenceWindowLabel(row.candidate, classesByCode)}</span>
                                      <span>班主任：{row.candidate.head_teacher || '未知'}</span>
                                      <span>老师：{row.candidate.teacher || '未知'}</span>
                                      <span>{row.candidate.campus || '校区待确认'}</span>
                                      {row.candidate.student_count && <span>{row.candidate.student_count}人</span>}
                                    </div>
                                  </div>
                                  <div className="makeup-score">参考度 {row.pct}%</div>
                                </div>
                                <div className="makeup-reasons">
                                  {row.reasons.map((r, ri) => (
                                    <span key={ri} className={`makeup-reason ${r.good ? 'good' : ''}`}>{r.text}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  )}
                  {totalPrimaryMatches === 0 && totalSpecialMatches === 0 && totalCoverageMatches > 0 && (
                    <>
                      <div className="makeup-feedback">当前周次在进度表中缺失，以下按同类型未来班级给出弱推荐；需人工确认具体进度后使用。</div>
                      {selectedSlots.map((slotKey) => {
                        const rows = coverageResultsBySlot.get(slotKey);
                        if (!rows || !rows.length) return null;
                        const [day, time] = slotKey.split('|');
                        return (
                          <div key={slotKey} className="makeup-slot-block">
                            <div className="makeup-slot-head">
                              <h4>{day} {time}</h4>
                              <span className="makeup-helper">{rows.length} 个弱推荐候选</span>
                            </div>
                            {rows.map((row, idx) => (
                              <div
                                key={row.candidate.id}
                                className={`makeup-candidate ${activeCandidate?.candidate.id === row.candidate.id ? 'active' : ''}`}
                                onClick={() => setActiveCandidate({ origin: originOcc!, candidate: row.candidate, kind: 'special' })}
                              >
                                <div className="makeup-candidate-top">
                                  <div>
                                    <strong>
                                      {idx + 1}. {row.candidate.class_code}
                                      {datasetHasGrade && getDisplayGrade(row.candidate, classesByCode) ? `｜${getDisplayGrade(row.candidate, classesByCode)}` : ''}
                                    </strong>
                                    <div className="makeup-candidate-meta">
                                      <span>{row.candidate.week_label}</span>
                                      <span>{row.candidate.lesson}</span>
                                      <span>时间：{row.candidate.day} {getOccurrenceWindowLabel(row.candidate, classesByCode)}</span>
                                      <span>班主任：{row.candidate.head_teacher || '未知'}</span>
                                      <span>老师：{row.candidate.teacher || '未知'}</span>
                                      <span>{row.candidate.campus || '校区待确认'}</span>
                                      {row.candidate.student_count && <span>{row.candidate.student_count}人</span>}
                                    </div>
                                  </div>
                                  <div className="makeup-score">参考度 {row.pct}%</div>
                                </div>
                                <div className="makeup-reasons">
                                  {row.reasons.map((r, ri) => (
                                    <span key={ri} className={`makeup-reason ${r.good ? 'good' : ''}`}>{r.text}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </section>

            <aside className="makeup-side-panel">
              <div className="makeup-messages">
                <div className="makeup-msg-box card">
                  <div className="makeup-msg-header">
                    <div className="makeup-msg-header-left">
                      {parentMsg && <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(parentMsg)}>复制</button>}
                      <h4>转发给家长</h4>
                    </div>
                  </div>
                  <pre className="makeup-msg-text">{parentMsg || '选中一个候选补课班后，这里会自动生成话术。'}</pre>
                </div>
                <div className="makeup-msg-box card">
                  <div className="makeup-msg-header">
                    <div className="makeup-msg-header-left">
                      {teacherMsg && <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(teacherMsg)}>复制</button>}
                      <h4>发给补课班班主任</h4>
                    </div>
                  </div>
                  <pre className="makeup-msg-text">{teacherMsg || '选中一个候选补课班后，这里会自动生成话术。'}</pre>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
