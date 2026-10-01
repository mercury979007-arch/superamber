import './HomeReportControls.css';
import { buildReportColumnLayout, type ReportColumnSpec } from '../utils/classDailyReportLayout';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClassInfo, Module, SavedCustomScheme, StudentData } from '../types';
import type { RosterSnapshot } from '../services/rosterSnapshotService';
import {
  ClassControlApiError,
  clearClassDailyReportRewardPolicy,
  fetchClassTaskCatalog,
  fetchClassTaskReport,
  fetchDailyReportRewardPolicy,
  saveDailyReportRewardPolicy,
  type ClassTaskReport,
  type ClassTaskCatalog,
  type DailyReportMode,
  type DailyReportRewardPolicy,
  type DailyReportRewardPolicyResult,
} from '../services/classControlApi';
import { getClassDisplaySession, getSuggestedClassControlSessions } from '../services/classControlSchedule';
import ReportQualityAnalysis from './ReportQualityAnalysis';
import { recommendTasksForMatchingSession, sortTaskCatalog } from '../services/taskSessionSelection';
import { reportRewardScheme, reportRuleLabel, reportRewardDetails } from '../utils/reportRewardDetails';
import { calculateMP } from '../utils/calculateMP';
import { defaultRuleConfigsForResourceTypes } from '../utils/customScheme';
import CustomSchemeEditor from './CustomSchemeEditor';
import {
  DistributionSubmitError,
  downloadDistributionFallbackExcel,
  fetchDailyReportRewardIssueStatus,
  fetchDistributionBalance,
  reconcileDailyReportRewardIssue,
  releaseDailyReportRewardIssue,
  submitDistributionRewards,
  type DailyReportRewardIssueStatus,
  type DistributionRewardPayload,
} from '../services/distributionQuickApi';
import { deliverExportImageBlob, requestExportImageBlob } from '../utils/reportExportHelpers';
import { renderClassDailyReportImage } from '../utils/classDailyReportImage';
import { currentShanghaiWeekToDateRange, previousShanghaiWeekRange, shanghaiExportTimestamp } from '../utils/classDailyReportDates';
import './ReportCoach.css';

type Props = {
  classes: ClassInfo[];
  teacherName: string;
  preparedSnapshot: RosterSnapshot | null;
  onOpenDistribution: (classInfo: ClassInfo, selectedWeekIds: string[], snapshotUpdatedAt: string) => void;
  onAuthenticationRequired?: () => void;
  onRefreshData?: () => void;
  batchRefreshBusy?: boolean;
  batchRefreshElapsedSeconds?: number;
  refreshRevision?: number;
  onRefreshStateChange?: (busy: boolean, classCode: string) => void;
  activeClassCode?: string;
  onActiveClassChange?: (classCode: string) => void;
  now?: Date;
};

const FALLBACK_POLICY: DailyReportRewardPolicy = {
  version: 1,
  report: { mode: 'standard', includeSpeaking: true, minSpeakingDays: 2, testPassScore: null, aiVoicePassRate: 75 },
  sources: { basic: true, speaking: true },
  basic: { schemeId: 'scheme2', allDoneAmount: 0.5, customName: '', customRules: [] },
  speaking: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 1, rewardMode: 'fixed', thresholdBonus: 0, ignoreSupplementVariance: false },
};

function withPolicyDefaults(policy: DailyReportRewardPolicy): DailyReportRewardPolicy {
  const merged = {
    ...FALLBACK_POLICY,
    ...policy,
    report: { ...FALLBACK_POLICY.report, ...(policy?.report || {}) },
    sources: { ...FALLBACK_POLICY.sources, ...(policy?.sources || {}) },
    basic: { ...FALLBACK_POLICY.basic, ...(policy?.basic || {}) },
    speaking: { ...FALLBACK_POLICY.speaking, ...(policy?.speaking || {}) },
  };
  // 每日开口只有一个入口：选择奖励来源时，同时决定日报是否展示该列。
  merged.report.includeSpeaking = Boolean(merged.sources.speaking);
  return merged;
}

function reportLogicSeenKey(teacherName: string): string {
  return `amber_daily_report_logic_seen:v1:${String(teacherName || 'current-teacher').trim().toLowerCase()}`;
}

function reportTaskOrderKey(teacherName: string, classCode: string): string {
  return `amber_daily_report_task_order:v1:${String(teacherName || 'current-teacher').trim().toLowerCase()}:${classCode}`;
}

function reportHiddenColumnsKey(teacherName: string, classCode: string): string {
  return `amber_daily_report_hidden_columns:v1:${String(teacherName || 'current-teacher').trim().toLowerCase()}:${classCode}`;
}

function reportStudentKey(student: { studentId?: string; englishName?: string; chineseName?: string }): string {
  return String(student.studentId || student.englishName || student.chineseName || '').trim().toLowerCase();
}

function createReportExportCopy(source: HTMLElement): { host: HTMLDivElement; target: HTMLElement } {
  const host = document.createElement('div');
  host.className = 'class-daily-home-export-host';
  host.setAttribute('aria-hidden', 'true');
  const target = source.cloneNode(true) as HTMLElement;
  target.classList.add('is-export-copy');
  target.classList.remove('is-exporting');
  const taskCount = target.querySelectorAll('th.is-task').length;
  const fixedColumnCount = target.querySelectorAll('th:not(.is-task)').length;
  const exportWidth = Math.max(1080, 210 + fixedColumnCount * 115 + taskCount * 132);
  target.style.width = `${exportWidth}px`;
  target.style.minWidth = `${exportWidth}px`;
  host.appendChild(target);
  document.body.appendChild(host);
  return { host, target };
}

function reportSortKey(teacherName: string): string {
  return `amber_daily_report_sort:v1:${String(teacherName || 'current-teacher').trim().toLowerCase()}`;
}

function compactCellDisplay(display: string): string {
  if (display === '★') return '👑';
  if (display === '✓') return '✅';
  if (display === '❌' || display === '—') return '⭕';
  return display;
}

function formatTaskDate(value?: string): string {
  return String(value || '').slice(0, 10) || '日期待确认';
}

function sameIds(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((id, index) => id === sortedRight[index]);
}

function formatDataCutoff(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '数据统计截至本次更新';
  return `数据统计截至 ${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)}（北京时间）`;
}

function policyLabel(scope: DailyReportRewardPolicyResult['scope']): string {
  if (scope === 'class') return '当前班级模板';
  if (scope === 'teacher') return '班主任通用模板';
  return '系统默认模板';
}

function ClickableDateInput({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showPicker = () => {
    try {
      inputRef.current?.showPicker?.();
    } catch {
      inputRef.current?.focus();
    }
  };
  return (
    <label className="class-daily-home-date-field" onClick={(event) => {
      if (event.target === event.currentTarget) showPicker();
    }}>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        type="date"
        value={value}
        onClick={showPicker}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function formatMp(value: number): string {
  return `${Number((Number(value) || 0).toFixed(2))} MP`;
}

function roundOne(value: number): number {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function calculateSpeakingAmount(
  daily: Array<{ date: string; status: 'normal' | 'supplement' | 'missed' }>,
  config: DailyReportRewardPolicy['speaking'],
): number {
  let runningStreak = 0;
  let thresholdReached = false;
  let total = 0;
  for (const day of [...daily].sort((left, right) => left.date.localeCompare(right.date))) {
    const normal = day.status === 'normal' || (config.ignoreSupplementVariance && day.status === 'supplement');
    if (normal) {
      runningStreak += 1;
      total += config.basePerDay;
      if (runningStreak >= config.streakThreshold) {
        thresholdReached = true;
        if (config.rewardMode === 'multiplier') total += config.basePerDay * (config.streakMultiplier - 1);
      }
    } else {
      runningStreak = 0;
      if (day.status === 'supplement') total += config.basePerDay;
    }
  }
  if (config.rewardMode === 'fixed' && thresholdReached) total += config.thresholdBonus;
  return roundOne(total);
}

export default function ClassDailyReportHome({
  classes, teacherName, preparedSnapshot, onAuthenticationRequired, onRefreshData,
  batchRefreshBusy = false, batchRefreshElapsedSeconds = 0, refreshRevision = 0, onRefreshStateChange,
  activeClassCode, onActiveClassChange, now,
}: Props) {
  const referenceNow = useMemo(() => now || new Date(), [now]);
  const defaultSpeakingRange = useMemo(() => previousShanghaiWeekRange(referenceNow), [referenceNow]);
  const currentSpeakingRange = useMemo(() => currentShanghaiWeekToDateRange(referenceNow), [referenceNow]);
  const sortedClasses = useMemo(() => [...classes].sort((left, right) => {
    const leftSession = getClassDisplaySession(left.name, [], referenceNow, teacherName);
    const rightSession = getClassDisplaySession(right.name, [], referenceNow, teacherName);
    return (leftSession?.minutesUntil ?? Number.POSITIVE_INFINITY)
      - (rightSession?.minutesUntil ?? Number.POSITIVE_INFINITY)
      || left.name.localeCompare(right.name);
  }), [classes, referenceNow, teacherName]);
  const [selectedClassCode, setSelectedClassCode] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [report, setReport] = useState<ClassTaskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState('');
  const [error, setError] = useState('');
  const [policyState, setPolicyState] = useState<DailyReportRewardPolicyResult>({ policy: FALLBACK_POLICY, scope: 'system', updatedAt: '' });
  const [policyDraft, setPolicyDraft] = useState<DailyReportRewardPolicy>(FALLBACK_POLICY);
  const [appliedPolicy, setAppliedPolicy] = useState<DailyReportRewardPolicy>(FALLBACK_POLICY);
  const [speakingRangeDraft, setSpeakingRangeDraft] = useState(defaultSpeakingRange);
  const [appliedSpeakingRange, setAppliedSpeakingRange] = useState(defaultSpeakingRange);
  const [policyClassCode, setPolicyClassCode] = useState('');
  const [generationNonce, setGenerationNonce] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [reportZoom, setReportZoom] = useState(1);
  const [reportFullScreen, setReportFullScreen] = useState(false);
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [basicDetailsOpen, setBasicDetailsOpen] = useState(true);
  const [speakingDetailsOpen, setSpeakingDetailsOpen] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState('');
  const [policyStatus, setPolicyStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [policyRetryNonce, setPolicyRetryNonce] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [submitStageLabel, setSubmitStageLabel] = useState('发放中…');
  const issueInFlight = useRef(false);
  const [issueReviewOpen, setIssueReviewOpen] = useState(false);
  const [issueReviewLoading, setIssueReviewLoading] = useState(false);
  const [issueReviewBalance, setIssueReviewBalance] = useState<number | null>(null);
  const [issueReviewError, setIssueReviewError] = useState('');
  const [issueAcknowledged, setIssueAcknowledged] = useState(false);
  const [balanceRetry, setBalanceRetry] = useState<{ refs: string[]; classCode: string; before: number; resultMessage: string } | null>(null);
  const [pendingIssue, setPendingIssue] = useState<DailyReportRewardIssueStatus | null>(null);
  const [issueRecoveryBusy, setIssueRecoveryBusy] = useState(false);
  const [issueRecoveryMessage, setIssueRecoveryMessage] = useState('');
  const [failedIssueRows, setFailedIssueRows] = useState<DistributionRewardPayload[]>([]);
  const [issuedCurrentReport, setIssuedCurrentReport] = useState(false);
  const [fallbackTaskCatalog, setFallbackTaskCatalog] = useState<ClassTaskCatalog | null>(null);
  const [taskCatalogLoading, setTaskCatalogLoading] = useState(false);
  const [taskCatalogError, setTaskCatalogError] = useState('');
  const [taskCatalogRetryNonce, setTaskCatalogRetryNonce] = useState(0);
  const [reportExporting, setReportExporting] = useState(false);
  const [reportExportMessage, setReportExportMessage] = useState('');
  const [taskOrder, setTaskOrder] = useState<string[]>([]);
  const [taskOrderOpen, setTaskOrderOpen] = useState(false);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  const [removedStudentIds, setRemovedStudentIds] = useState<string[]>([]);
  const [studentSort, setStudentSort] = useState<'english' | 'completion'>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(reportSortKey(teacherName)) || '{}');
      return saved.by === 'completion' ? 'completion' : 'english';
    } catch { return 'english'; }
  });
  const [studentSortDirection, setStudentSortDirection] = useState<'asc' | 'desc'>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(reportSortKey(teacherName)) || '{}');
      return saved.direction === 'desc' ? 'desc' : 'asc';
    } catch { return 'asc'; }
  });
  const reportPosterRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!reportFullScreen) return;
    const update = () => {
      const poster = reportPosterRef.current;
      const count = poster?.querySelectorAll('tbody tr').length || 1;
      const bodyHeight = poster?.querySelector('tbody')?.getBoundingClientRect().height || 0;
      const chromeHeight = poster && bodyHeight ? poster.scrollHeight - bodyHeight : 210;
      const rowHeight = Math.max(18, Math.min(64, (window.innerHeight - chromeHeight - 8) / count));
      poster?.style.setProperty('--report-fit-row', `${rowHeight}px`);
      poster?.style.setProperty('--report-fit-font', `${Math.max(16, Math.min(32, rowHeight * .72))}px`);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setReportFullScreen(false); };
    update(); window.addEventListener('resize', update); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('keydown', escape); };
  }, [reportFullScreen, report]);

  const classSectionRef = useRef<HTMLElement>(null);
  const returnToClassAfterGeneration = useRef(false);
  useEffect(() => {
    if (!report || !returnToClassAfterGeneration.current) return;
    returnToClassAfterGeneration.current = false;
    const frame = requestAnimationFrame(() => reportPosterRef.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [report]);
  const manualGenerationRef = useRef(false);
  const manualGenerationMessageRef = useRef('');
  const externalDataRefreshRef = useRef(false);
  const seenRefreshRevisionRef = useRef(refreshRevision);
  const authenticationRequiredRef = useRef(onAuthenticationRequired);
  authenticationRequiredRef.current = onAuthenticationRequired;
  const refreshStateChangeRef = useRef(onRefreshStateChange);
  refreshStateChangeRef.current = onRefreshStateChange;
  const initializedSelectionRef = useRef({ classCode: '', hasSelection: false });

  useEffect(() => {
    if (refreshRevision <= seenRefreshRevisionRef.current) return;
    seenRefreshRevisionRef.current = refreshRevision;
    if (!selectedClassCode || policyClassCode !== selectedClassCode || appliedIds.length === 0) return;
    externalDataRefreshRef.current = true;
    refreshStateChangeRef.current?.(true, selectedClassCode);
    setGenerationNonce((value) => value + 1);
  }, [appliedIds.length, policyClassCode, refreshRevision, selectedClassCode]);

  useEffect(() => {
    try {
      localStorage.setItem(reportSortKey(teacherName), JSON.stringify({ by: studentSort, direction: studentSortDirection }));
    } catch {}
  }, [studentSort, studentSortDirection, teacherName]);

  useEffect(() => {
    const requestedClassCode = String(activeClassCode || '').toUpperCase();
    if (requestedClassCode && sortedClasses.some((item) => item.name.toUpperCase() === requestedClassCode)) {
      if (requestedClassCode !== selectedClassCode) setSelectedClassCode(requestedClassCode);
      return;
    }
    if (selectedClassCode && sortedClasses.some((item) => item.name.toUpperCase() === selectedClassCode)) return;
    setSelectedClassCode(String(sortedClasses[0]?.name || '').toUpperCase());
  }, [activeClassCode, selectedClassCode, sortedClasses]);

  useEffect(() => {
    if (selectedClassCode && !activeClassCode) onActiveClassChange?.(selectedClassCode);
  }, [activeClassCode, onActiveClassChange, selectedClassCode]);

  const selectedClass = sortedClasses.find((item) => item.name.toUpperCase() === selectedClassCode) || null;
  const preparedTaskSnapshot = (preparedSnapshot?.dailyReportTasks || []).find((item) => String(item.classId || '').toUpperCase() === selectedClassCode);
  const taskSnapshot = preparedTaskSnapshot?.weekTasks?.length
    ? preparedTaskSnapshot
    : fallbackTaskCatalog?.classId === selectedClassCode
      ? fallbackTaskCatalog
      : preparedTaskSnapshot;
  const catalog = useMemo(() => sortTaskCatalog(taskSnapshot?.weekTasks || []), [taskSnapshot]);
  const sessions = useMemo(() => getSuggestedClassControlSessions(selectedClassCode, [], teacherName), [selectedClassCode, teacherName]);
  const recommendation = useMemo(() => recommendTasksForMatchingSession({
    tasks: catalog, defaultSelectedWeekIds: taskSnapshot?.defaultSelectedWeekIds || [], sessions, now: referenceNow,
  }), [catalog, referenceNow, sessions, taskSnapshot?.defaultSelectedWeekIds]);

  useEffect(() => {
    let active = true;
    if (!selectedClassCode) return () => { active = false; };
    if (preparedTaskSnapshot?.weekTasks?.length) {
      setFallbackTaskCatalog(null);
      setTaskCatalogLoading(false);
      setTaskCatalogError('');
      return () => { active = false; };
    }
    setFallbackTaskCatalog(null);
    setTaskCatalogLoading(true);
    setTaskCatalogError('');
    void fetchClassTaskCatalog(selectedClassCode).then((nextCatalog) => {
      if (!active) return;
      setFallbackTaskCatalog(nextCatalog);
      setTaskCatalogError(nextCatalog.weekTasks.length ? '' : '当前班级的挑战快照中确实没有可用挑战');
    }).catch((nextError) => {
      if (!active) return;
      setTaskCatalogError(nextError instanceof Error ? nextError.message : '挑战目录读取失败');
      if (nextError instanceof ClassControlApiError && nextError.status === 401) authenticationRequiredRef.current?.();
    }).finally(() => {
      if (active) setTaskCatalogLoading(false);
    });
    return () => { active = false; };
  }, [preparedTaskSnapshot?.weekTasks?.length, selectedClassCode, taskCatalogRetryNonce]);

  useEffect(() => {
    // Snapshot arrival/parent renders must not replace a teacher's draft or
    // cancel an in-flight report. Initialize once when this class has a catalog.
    if (initializedSelectionRef.current.classCode === selectedClassCode
      && initializedSelectionRef.current.hasSelection) return;
    initializedSelectionRef.current = {
      classCode: selectedClassCode,
      hasSelection: recommendation.selectedWeekIds.length > 0,
    };
    setDraftIds(recommendation.selectedWeekIds);
    setAppliedIds(recommendation.selectedWeekIds);
    setSelectionConfirmed(!recommendation.needsConfirmation && recommendation.selectedWeekIds.length === 1);
    setReport(null);
    setRefreshingReport(false);
    setRefreshNotice('');
    setReportExportMessage('');
    setError('');
  }, [selectedClassCode, recommendation]);

  useEffect(() => {
    setSpeakingRangeDraft(defaultSpeakingRange);
    setAppliedSpeakingRange(defaultSpeakingRange);
  }, [defaultSpeakingRange, selectedClassCode]);

  useEffect(() => {
    let active = true;
    if (!selectedClassCode) return () => { active = false; };
    setPolicyStatus('loading');
    setPolicyClassCode('');
    setPolicyMessage('');
    void fetchDailyReportRewardPolicy(selectedClassCode).then((result) => {
      if (!active) return;
      const policy = withPolicyDefaults(result.policy);
      setPolicyState({ ...result, policy });
      setPolicyDraft(policy);
      setAppliedPolicy(policy);
      setPolicyClassCode(selectedClassCode);
      setPolicyStatus('ready');
    }).catch((nextError) => {
      if (!active) return;
      setPolicyState({ policy: FALLBACK_POLICY, scope: 'system', updatedAt: '' });
      setPolicyDraft(FALLBACK_POLICY);
      setAppliedPolicy(FALLBACK_POLICY);
      setPolicyClassCode(selectedClassCode);
      setPolicyMessage(nextError instanceof Error ? nextError.message : '奖励规则读取失败');
      setPolicyStatus('error');
    });
    return () => { active = false; };
  }, [policyRetryNonce, selectedClassCode]);

  useEffect(() => {
    setSubmitMessage('');
    setBalanceRetry(null);
    setIssueReviewOpen(false);
    setIssueReviewLoading(false);
    setIssueReviewBalance(null);
    setIssueReviewError('');
    setIssueAcknowledged(false);
    setPendingIssue(null);
    setIssueRecoveryMessage('');
    setFailedIssueRows([]);
    setIssuedCurrentReport(false);
    if (selectedClassCode) {
      void fetchDailyReportRewardIssueStatus(selectedClassCode)
        .then((issue) => setPendingIssue(issue))
        .catch(() => {});
    }
  }, [selectedClassCode]);

  useEffect(() => {
    let active = true;
    if (!selectedClassCode || policyClassCode !== selectedClassCode || appliedIds.length === 0) {
      setLoading(false);
      setReport(null);
      return () => { active = false; };
    }
    const externalDataRefresh = externalDataRefreshRef.current;
    externalDataRefreshRef.current = false;
    let sharedRefreshActive = externalDataRefresh;
    const startSharedRefresh = () => {
      if (sharedRefreshActive) return;
      sharedRefreshActive = true;
      refreshStateChangeRef.current?.(true, selectedClassCode);
    };
    const endSharedRefresh = () => {
      if (!sharedRefreshActive) return;
      sharedRefreshActive = false;
      refreshStateChangeRef.current?.(false, selectedClassCode);
    };
    setLoading(!externalDataRefresh);
    setRefreshingReport(externalDataRefresh);
    setRefreshNotice('');
    setError('');
    const manualGeneration = manualGenerationRef.current;
    manualGenerationRef.current = false;
    const reportOptions = {
      ...appliedPolicy.report,
      speakingRangeStart: appliedSpeakingRange.start,
      speakingRangeEnd: appliedSpeakingRange.end,
    };
    void (async () => {
      try {
        const initialReport = await fetchClassTaskReport(
          selectedClassCode,
          appliedIds,
          reportOptions,
          false,
        );
        if (!active) return;
        setReport(initialReport);
        setLoading(false);
        if (manualGeneration) {
          setPolicyMessage(manualGenerationMessageRef.current || '日报已按本次确认的设置生成完成。');
          manualGenerationMessageRef.current = '';
        }
        if (initialReport.source !== 'snapshot' && initialReport.source !== 'snapshot-fallback') {
          setRefreshingReport(false);
          if (externalDataRefresh) setRefreshNotice('当前日报已同步到刚刚更新的数据。');
          endSharedRefresh();
          return;
        }

        startSharedRefresh();
        setRefreshingReport(true);
        try {
          const refreshedReport = await fetchClassTaskReport(
            selectedClassCode,
            appliedIds,
            reportOptions,
            true,
          );
          if (!active) return;
          setReport(refreshedReport);
          setRefreshNotice(refreshedReport.refreshError
            ? `实时刷新暂未成功，继续显示已有快照：${refreshedReport.refreshError}`
            : '日报已在快照基础上刷新到最新数据。');
        } catch (nextError) {
          if (!active) return;
          setRefreshNotice(`实时刷新暂未成功，继续显示已有快照：${nextError instanceof Error ? nextError.message : '请稍后再试'}`);
          if (nextError instanceof ClassControlApiError && nextError.status === 401) authenticationRequiredRef.current?.();
        } finally {
          if (active) setRefreshingReport(false);
          endSharedRefresh();
        }
      } catch (nextError) {
        if (!active) return;
        setReport(null);
        setRefreshingReport(false);
        endSharedRefresh();
        setError(nextError instanceof Error ? nextError.message : '班级日报数据读取失败');
        if (nextError instanceof ClassControlApiError && nextError.status === 401) authenticationRequiredRef.current?.();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; endSharedRefresh(); };
  }, [appliedIds, appliedPolicy.report, appliedSpeakingRange, generationNonce, policyClassCode, selectedClassCode]);

  function toggleTask(taskId: string) {
    const nextIds = draftIds.includes(taskId) ? draftIds.filter((id) => id !== taskId) : [...draftIds, taskId];
    if (nextIds.length === 0) {
      setError('请至少保留一个挑战列表。');
      return;
    }
    setDraftIds(nextIds);
    setSelectionConfirmed(false);
    setError('');
    setPolicyMessage(`已选择 ${nextIds.length} 组挑战；点击“应用并重新生成日报”后统一生成。`);
  }

  function restoreRecommendedTasks() {
    if (recommendation.selectedWeekIds.length === 0) return;
    setDraftIds(recommendation.selectedWeekIds);
    if (sameIds(recommendation.selectedWeekIds, appliedIds)) {
      setSelectionConfirmed(true);
      setError('');
      setPolicyMessage('已恢复系统推荐，当前日报已经使用这组挑战。');
      return;
    }
    setSelectionConfirmed(false);
    setError('');
    setPolicyMessage('已恢复系统推荐；点击“应用并重新生成日报”后统一生成。');
  }

  function patchPolicy(patch: Partial<DailyReportRewardPolicy>) {
    setPolicyDraft((current) => ({ ...current, ...patch }));
    setPolicyMessage('配置已修改，当前日报不会刷新；确认生成后才会应用。');
  }

  function patchReport(patch: Partial<DailyReportRewardPolicy['report']>) {
    setPolicyDraft((current) => ({ ...current, report: { ...current.report, ...patch } }));
    setPolicyMessage('配置已修改，当前日报不会刷新；确认生成后才会应用。');
  }

  function patchSpeakingRange(patch: Partial<{ start: string; end: string }>) {
    setSpeakingRangeDraft((current) => ({ ...current, ...patch }));
    setPolicyMessage('每日开口统计区间已修改；确认生成后会按新日期重新读取。');
  }

  function applyPolicyAndRegenerate(nextPolicy: DailyReportRewardPolicy, completionMessage: string) {
    if (draftIds.length === 0) return setError('请至少选择一个挑战列表。');
    if (nextPolicy.sources.speaking && (!speakingRangeDraft.start || !speakingRangeDraft.end)) {
      return setError('请选择完整的每日开口开始和结束日期。');
    }
    if (nextPolicy.sources.speaking && speakingRangeDraft.start > speakingRangeDraft.end) {
      return setError('每日开口开始日期不能晚于结束日期。');
    }
    manualGenerationRef.current = true;
    manualGenerationMessageRef.current = completionMessage;
    setIssuedCurrentReport(false);
    returnToClassAfterGeneration.current = true;
    setAppliedIds([...draftIds]);
    setAppliedPolicy(nextPolicy);
    setAppliedSpeakingRange(speakingRangeDraft);
    setSelectionConfirmed(true);
    try { localStorage.setItem(reportLogicSeenKey(teacherName), '1'); } catch {}
    setError('');
    setPolicyMessage('正在按当前配置重新抓取；下方完成后会整体更新。');
    setGenerationNonce((current) => current + 1);
  }

  function confirmGeneration() {
    return applyPolicyAndRegenerate(policyDraft, '日报已按本次设置应用并重新生成。');
  }

  async function savePolicy(scope: 'teacher' | 'class') {
    if (draftIds.length === 0) return setPolicyMessage('请至少选择一个挑战列表。');
    if (policyDraft.sources.speaking && (!speakingRangeDraft.start || !speakingRangeDraft.end || speakingRangeDraft.start > speakingRangeDraft.end)) {
      return setPolicyMessage('请先确认每日开口日期范围有效。');
    }
    setSavingPolicy(true);
    setPolicyMessage('');
    try {
      let result = await saveDailyReportRewardPolicy(selectedClassCode, scope, policyDraft);
      // Setting a common template means the current class should inherit it as
      // well; otherwise an older class override makes the button appear inert.
      if (scope === 'teacher') result = await clearClassDailyReportRewardPolicy(selectedClassCode);
      const policy = withPolicyDefaults(result.policy);
      setPolicyState({ ...result, policy });
      setPolicyDraft(policy);
      applyPolicyAndRegenerate(policy, scope === 'teacher'
        ? '已应用并设为通用模板；当前班已改为继承通用模板。其他已有独立模板的班级不会被覆盖。'
        : `已应用并保存为 ${selectedClassCode} 班级模板。`);
    } catch (nextError) {
      setPolicyMessage(nextError instanceof Error ? nextError.message : '统计与奖励模板保存失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function restoreTeacherPolicy() {
    setSavingPolicy(true);
    try {
      const result = await clearClassDailyReportRewardPolicy(selectedClassCode);
      const policy = withPolicyDefaults(result.policy);
      setPolicyState({ ...result, policy });
      setPolicyDraft(policy);
      applyPolicyAndRegenerate(policy, '当前班级已恢复通用模板，并按该模板重新生成日报。');
    } catch (nextError) {
      setPolicyMessage(nextError instanceof Error ? nextError.message : '恢复默认规则失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  const selectedTasks = catalog.filter((task) => draftIds.includes(String(task.id)));
  const detail = report?.detail;
  const currentTaskNames = (loading ? appliedIds : report?.selectedWeekIds || appliedIds)
    .map(id => catalog.find(task => String(task.id) === String(id))?.name || String(id)).join('、');
  const resourceAwareDefaultRules = useMemo(
    () => defaultRuleConfigsForResourceTypes((detail?.tasks || []).map((task) => task.type)),
    [detail?.tasks],
  );

  useEffect(() => {
    if (!detail || !selectedClassCode) {
      setTaskOrder([]);
      setHiddenColumnIds([]);
      setRemovedStudentIds([]);
      setTaskOrderOpen(false);
      return;
    }
    const availableIds = detail.tasks.map((task) => String(task.id));
    let savedIds: string[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(reportTaskOrderKey(teacherName, selectedClassCode)) || '[]');
      if (Array.isArray(parsed)) savedIds = parsed.map(String);
    } catch {}
    const available = new Set(availableIds);
    setTaskOrder([
      ...savedIds.filter((id, index) => available.has(id) && savedIds.indexOf(id) === index),
      ...availableIds.filter((id) => !savedIds.includes(id)),
    ]);
    try {
      const parsed = JSON.parse(localStorage.getItem(reportHiddenColumnsKey(teacherName, selectedClassCode)) || '[]');
      const allowed = new Set(['student', 'progress', 'speaking', 'minip', ...availableIds.map((id) => `task:${id}`)]);
      setHiddenColumnIds(Array.isArray(parsed) ? parsed.map(String).filter((id) => allowed.has(id)) : []);
    } catch {
      setHiddenColumnIds([]);
    }
    setRemovedStudentIds([]);
    setTaskOrderOpen(false);
  }, [detail, selectedClassCode, teacherName]);

  const orderedTasks = useMemo(() => {
    if (!detail) return [];
    const orderIndex = new Map(taskOrder.map((id, index) => [id, index]));
    return [...detail.tasks].sort((left, right) => {
      const leftIndex = orderIndex.get(String(left.id));
      const rightIndex = orderIndex.get(String(right.id));
      return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
    });
  }, [detail, taskOrder]);

  const visibleOrderedTasks = useMemo(
    () => orderedTasks.filter((task) => !hiddenColumnIds.includes(`task:${String(task.id)}`)),
    [hiddenColumnIds, orderedTasks],
  );
  const visibleReportStudents = useMemo(
    () => (detail?.students || []).filter((student) => !removedStudentIds.includes(reportStudentKey(student))),
    [detail?.students, removedStudentIds],
  );
  const showStudentColumn = !hiddenColumnIds.includes('student');
  const showProgressColumn = !hiddenColumnIds.includes('progress');
  const showSpeakingColumn = appliedPolicy.report.includeSpeaking && !hiddenColumnIds.includes('speaking');
  const showMinipColumn = !hiddenColumnIds.includes('minip');

  const sortedReportStudents = useMemo(() => {
    if (!detail) return [];
    const requiredTaskIds = new Set(detail.tasks.filter((task) => !task.optional).map((task) => String(task.id)));
    const completionScore = (student: (typeof detail.students)[number]) => student.cells.reduce(
      (sum, cell) => sum + (requiredTaskIds.has(String(cell.taskId)) && cell.complete ? 1 : 0),
      0,
    );
    return [...visibleReportStudents].sort((left, right) => {
      const englishCompare = String(left.englishName || left.chineseName).localeCompare(
        String(right.englishName || right.chineseName),
        'en',
        { sensitivity: 'base', numeric: true },
      );
      const comparison = studentSort === 'completion'
        ? completionScore(left) - completionScore(right) || englishCompare
        : englishCompare;
      return studentSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [detail, studentSort, studentSortDirection, visibleReportStudents]);
  const rewardStudents = useMemo<StudentData[]>(() => visibleReportStudents.map((student) => ({
    studentId: student.studentId,
    chineseName: student.chineseName,
    englishName: student.englishName,
    classCode: selectedClassCode,
    resources: student.rewardResources,
    dailyCheckIns: student.speaking.days,
    classParticipation: 0,
    bonusItems: [],
  })), [selectedClassCode, visibleReportStudents]);
  const modules = useMemo(() => {
    const selected = new Set<Module>();
    if (appliedPolicy.sources.basic) selected.add('基础落实');
    if (appliedPolicy.sources.speaking) selected.add('每日开口');
    return selected;
  }, [appliedPolicy.sources.basic, appliedPolicy.sources.speaking]);
  const customScheme = useMemo<SavedCustomScheme | undefined>(() => appliedPolicy.basic.schemeId === 'custom' ? {
    id: 'custom_report', name: appliedPolicy.basic.customName || '自定义规则', rules: appliedPolicy.basic.customRules, createdAt: 0,
  } : undefined, [appliedPolicy.basic]);
  const rewards = useMemo(() => {
    const basicResults = calculateMP(
      rewardStudents,
      appliedPolicy.basic.schemeId === 'custom' ? 'custom_report' : appliedPolicy.basic.schemeId,
      0,
      modules,
      customScheme,
      { scheme2AllDoneAmount: appliedPolicy.basic.allDoneAmount },
    );
    const detailById = new Map((detail?.students || []).map((student) => [student.studentId, student]));
    return basicResults.map((reward) => {
      const speaking = appliedPolicy.sources.speaking
        ? calculateSpeakingAmount(detailById.get(reward.studentId)?.speaking.daily || [], appliedPolicy.speaking)
        : 0;
      return { ...reward, 每日开口: speaking, total: roundOne(reward.基础落实 + speaking) };
    });
  }, [appliedPolicy, customScheme, detail?.students, modules, rewardStudents]);
  const distributionRows = useMemo<DistributionRewardPayload[]>(() => rewards
    .filter((reward) => reward.total > 0)
    .map((reward) => ({
      studentId: reward.studentId,
      studentName: reward.englishName,
      chineseName: reward.chineseName,
      aliases: [reward.englishName, reward.chineseName].filter(Boolean),
      amount: reward.total,
      components: { basic: reward.基础落实, speaking: reward.每日开口 },
    })), [rewards]);
  const explanationScheme = useMemo(() => reportRewardScheme(appliedPolicy.basic), [appliedPolicy.basic]);
  const rewardByStudentId = useMemo(() => new Map(rewards.map((reward) => [reward.studentId, reward])), [rewards]);
  const totalMp = rewards.reduce((sum, reward) => sum + reward.total, 0);
  const recipientCount = rewards.filter((reward) => reward.total > 0).length;
  const activeReportOptions = appliedPolicy.report;
  const reportFitsViewport = Boolean(detail && visibleOrderedTasks.length <= (showSpeakingColumn ? 6 : 7));
  const reportHasManyTasks = visibleOrderedTasks.length >= 5;
  const reportColumns: ReportColumnSpec[] = [
    ...(showStudentColumn ? [{ key: 'student', kind: 'student' as const, values: visibleReportStudents.flatMap(student => [student.englishName || '', student.chineseName || '']) }] : []),
    ...(showMinipColumn ? [{ key: 'minip', kind: 'minip' as const }] : []),
    ...(showProgressColumn ? [{ key: 'progress', kind: 'progress' as const }] : []),
    ...(showSpeakingColumn ? [{ key: 'speaking', kind: 'speaking' as const }] : []),
    ...visibleOrderedTasks.map(task => ({ key: String(task.id), kind: 'task' as const, label: task.label })),
  ];
  const reportColumnLayout = buildReportColumnLayout(reportColumns);
  const reportTableMinWidth = reportColumnLayout.minWidth;
  const visibleReportStats = useMemo(() => {
    if (!detail) return { fullyCompletedCount: 0, totalStudents: 0, completionRate: 0 };
    const requiredTaskIds = new Set(detail.tasks.filter((task) => !task.optional).map((task) => String(task.id)));
    const totalRequired = requiredTaskIds.size * visibleReportStudents.length;
    let completedRequired = 0;
    let fullyCompletedCount = 0;
    visibleReportStudents.forEach((student) => {
      const completed = student.cells.filter((cell) => requiredTaskIds.has(String(cell.taskId)) && cell.complete).length;
      completedRequired += completed;
      if (requiredTaskIds.size === 0 || completed === requiredTaskIds.size) fullyCompletedCount += 1;
    });
    return {
      fullyCompletedCount,
      totalStudents: visibleReportStudents.length,
      completionRate: totalRequired ? Math.round((completedRequired / totalRequired) * 100) : 100,
    };
  }, [detail, visibleReportStudents]);
  const visibleStudentNames = useMemo(
    () => new Set(visibleReportStudents.map((student) => String(student.englishName || student.chineseName))),
    [visibleReportStudents],
  );
  const visibleProblemStudents = useMemo(
    () => (detail?.problemStudents || []).filter((student) => !removedStudentIds.includes(reportStudentKey(student))),
    [detail?.problemStudents, removedStudentIds],
  );
  const hasPendingConfig = !sameIds(draftIds, appliedIds)
    || JSON.stringify(policyDraft) !== JSON.stringify(appliedPolicy)
    || speakingRangeDraft.start !== appliedSpeakingRange.start
    || speakingRangeDraft.end !== appliedSpeakingRange.end;
  const taskSelectionChanged = !sameIds(draftIds, appliedIds);
  const issueSafetyReason = !selectedClass?.squadId
    ? '当前班级缺少可验证的班级编号'
    : pendingIssue && (pendingIssue.status === 'pending' || pendingIssue.status === 'uncertain')
      ? pendingIssue.status === 'pending' ? '上一笔发放仍在安全等待期，请先检查处理状态' : '上一笔发放结果仍待核对，请先处理旧单'
      : issuedCurrentReport
        ? '本张日报已经提交过发放，请查看下方回执'
    : policyStatus === 'loading'
      ? '正在读取已保存的奖励规则'
      : policyStatus === 'error'
        ? '奖励规则读取失败，不能按兜底金额发放'
        : loading
          ? '日报仍在生成'
          : refreshingReport
            ? '正在刷新实时数据，完成前不能发放'
            : !report
              ? '请先生成日报'
              : report.source !== 'live' || Boolean(report.refreshError) || refreshNotice.includes('未成功')
                ? '当前仅有旧快照，实时数据确认后才能发放'
                : recommendation.needsConfirmation && !selectionConfirmed
                  ? '系统匹配到多个或非精确挑战，请先确认本次任务'
                  : !sameIds(report.selectedWeekIds, appliedIds)
                    ? '日报任务与当前选择不一致，请重新生成'
                    : hasPendingConfig
                      ? '有尚未应用的设置，请先应用并重新生成日报'
                      : modules.size === 0
                        ? '本次未启用任何奖励来源'
                        : recipientCount === 0
                          ? '当前规则下没有可发放的学生'
                          : '';
  const canIssue = issueSafetyReason === '';
  const draftHasSources = policyDraft.sources.basic || policyDraft.sources.speaking;
  const draftModeLabel = policyDraft.report.mode === 'standard' ? '标准版' : policyDraft.report.mode === 'detail' ? '明细版' : '大龄版';
  const compactPolicySummary = `${draftModeLabel} · AI语音 ${policyDraft.report.aiVoicePassRate}% · 测试 ${policyDraft.report.testPassScore ?? 80}分 · ${policyDraft.sources.speaking ? `每日开口 ${policyDraft.report.minSpeakingDays}天 / ${formatMp(policyDraft.speaking.basePerDay)}每天` : '不统计每日开口'}`;
  const parentRewardRuleText = [
    appliedPolicy.sources.basic
      ? appliedPolicy.basic.schemeId === 'scheme2'
        ? `完成全部基础挑战，可获得 ${formatMp(appliedPolicy.basic.allDoneAmount)}`
        : '按本轮挑战完成与质量达标情况获得奖励'
      : '',
    appliedPolicy.sources.speaking ? '坚持完成每日开口，可获得对应奖励' : '',
  ].filter(Boolean).join('；') || '本次未启用 MiniP 奖励';

  function persistTaskOrder(nextOrder: string[]) {
    setTaskOrder(nextOrder);
    try { localStorage.setItem(reportTaskOrderKey(teacherName, selectedClassCode), JSON.stringify(nextOrder)); } catch {}
  }

  function persistHiddenColumns(nextIds: string[]) {
    setHiddenColumnIds(nextIds);
    try { localStorage.setItem(reportHiddenColumnsKey(teacherName, selectedClassCode), JSON.stringify(nextIds)); } catch {}
  }

  function toggleColumnVisibility(columnId: string) {
    persistHiddenColumns(hiddenColumnIds.includes(columnId)
      ? hiddenColumnIds.filter((id) => id !== columnId)
      : [...hiddenColumnIds, columnId]);
  }

  function toggleStudentRow(studentKey: string) {
    setRemovedStudentIds((current) => current.includes(studentKey)
      ? current.filter((id) => id !== studentKey)
      : [...current, studentKey]);
  }

  function moveTaskColumn(taskId: string, offset: -1 | 1) {
    const currentOrder = orderedTasks.map((task) => String(task.id));
    const currentIndex = currentOrder.indexOf(taskId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
    persistTaskOrder(nextOrder);
  }

  function resetReportEdits() {
    if (!detail) return;
    persistTaskOrder(detail.tasks.map((task) => String(task.id)));
    persistHiddenColumns([]);
    setRemovedStudentIds([]);
  }

  function confirmVisibleTaskSelection() {
    if (taskSelectionChanged) {
      confirmGeneration();
      return;
    }
    setSelectionConfirmed(true);
    setPolicyMessage('本次任务已确认，可以核对发放清单。');
  }

  async function openIssueReview() {
    if (!canIssue || issueInFlight.current || !selectedClass?.squadId) return;
    setIssueReviewOpen(true);
    setIssueReviewLoading(true);
    setIssueReviewBalance(null);
    setIssueReviewError('');
    setIssueAcknowledged(false);
    try {
      const balance = await fetchDistributionBalance([selectedClass.squadId, selectedClassCode]);
      if (balance.expired) {
        onAuthenticationRequired?.();
        setIssueReviewError('登录已过期，请重新登录后再核对发放。');
      } else if (balance.value === null) {
        setIssueReviewError('班内余额暂未读取成功。请返回后重试，本次尚未发放。');
      } else {
        setIssueReviewBalance(balance.value);
      }
    } catch (nextError) {
      const detailMessage = nextError instanceof Error ? `：${nextError.message}` : '';
      setIssueReviewError(`班内余额读取失败${detailMessage}。请返回后重试，本次尚未发放。`);
    } finally {
      setIssueReviewLoading(false);
    }
  }

  async function issueRewards() {
    if (!selectedClass?.squadId || !report || issueInFlight.current || !issueReviewOpen || !issueAcknowledged) return;
    const issueRows = distributionRows;
    if (!issueRows.length) return setSubmitMessage('当前规则下没有可发放的 MiniP。');
    const refs = [selectedClass.squadId, selectedClassCode];
    const amount = Number(issueRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2));
    let balanceBefore: number | null = issueReviewBalance;
    let submissionAttempted = false;
    let resultMessage = '';
    issueInFlight.current = true;
    setSubmitting(true);
    setBalanceRetry(null);
    setFailedIssueRows([]);
    setSubmitStageLabel('发放中…');
    setSubmitMessage(`${selectedClassCode} 正在发放 MiniP…`);
    try {
      if (balanceBefore === null) return setSubmitMessage(`${selectedClassCode} 余额未能读取，本次尚未发放，请返回后重试。`);
      if (balanceBefore + 0.0001 < amount) return setSubmitMessage(`${selectedClassCode} 班内余额 ${balanceBefore} MP，不足以发放 ${amount} MP，本次尚未发放。`);
      submissionAttempted = true;
      const { expired, data } = await submitDistributionRewards({
        squadId: selectedClass.squadId,
        className: selectedClassCode,
        rewards: issueRows,
        taskSelection: {
          source: 'class-daily-report',
          selectedWeekIds: appliedPolicy.sources.basic ? report.selectedWeekIds : [],
          snapshotUpdatedAt: report.snapshotUpdatedAt,
          speakingRange: appliedPolicy.sources.speaking ? { start: detail?.options.speakingRangeStart || '', end: detail?.options.speakingRangeEnd || '' } : undefined,
        },
      });
      if (expired) {
        onAuthenticationRequired?.();
        resultMessage = '登录已过期，请重新登录后查询发放结果。';
      } else {
        const failedIds = Array.isArray(data.failedStudentIds) ? data.failedStudentIds.map(String) : [];
        resultMessage = `发放完成：成功 ${data.success ?? 0} 人，失败 ${data.failed ?? 0} 人。`;
        if ((Number(data.success) || 0) > 0) setIssuedCurrentReport(true);
        if (failedIds.length) {
          const failedRows = issueRows.filter((reward) => failedIds.includes(reward.studentId));
          setFailedIssueRows(failedRows);
          try {
            await downloadDistributionFallbackExcel({ rewards: failedRows, classCode: selectedClassCode, fileName: `${selectedClassCode}_MiniP发放失败兜底.xlsx` });
            resultMessage += '失败名单已下载。';
          } catch {
            resultMessage += '失败名单下载未完成，请稍后单独导出。';
          }
        }
      }
    } catch (nextError) {
      resultMessage = nextError instanceof DistributionSubmitError || nextError instanceof Error ? nextError.message : '发放结果暂未确认';
      if (nextError instanceof DistributionSubmitError) {
        const response = nextError.responseData || {};
        const failedIds = Array.isArray(response.failedStudentIds) ? response.failedStudentIds.map(String) : [];
        if (response.code === 'TASK_REWARD_UNCERTAIN' && response.taskRewardEntryId) {
          const unresolved = issueRows.filter((reward) => failedIds.includes(reward.studentId));
          setPendingIssue({
            id: String(response.taskRewardEntryId), classId: selectedClassCode, status: 'uncertain',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: resultMessage,
            students: unresolved.map((reward) => ({ ...reward, status: 'unresolved' as const })),
          });
          setIssueRecoveryMessage('结果尚未确认，系统已停止自动重试。请使用下方官网流水核对。');
        } else if (failedIds.length) {
          const failedRows = issueRows.filter((reward) => failedIds.includes(reward.studentId));
          setFailedIssueRows(failedRows);
          try {
            await downloadDistributionFallbackExcel({ rewards: failedRows, classCode: selectedClassCode, fileName: `${selectedClassCode}_MiniP发放失败兜底.xlsx` });
            resultMessage += '失败名单已下载。';
          } catch {
            resultMessage += '可在下方重新下载失败名单。';
          }
        }
      }
      if (!submissionAttempted) setSubmitMessage(`${selectedClassCode} 余额查询失败，本次尚未发放。${resultMessage}`);
    } finally {
      if (submissionAttempted) {
        setSubmitStageLabel('核对余额…');
        setSubmitMessage(`${selectedClassCode} ${resultMessage}正在查询发放后余额…`);
        let verified = false;
        let balanceMessage = `发放前余额 ${balanceBefore} MP；发放后余额暂未查询到，请稍后重新查询余额。`;
        try {
          const after = await fetchDistributionBalance(refs);
          if (after.value !== null && !after.expired) {
            verified = true;
            balanceMessage = `班内余额 ${balanceBefore} → ${after.value} MP（已重新查询）。`;
          }
        } catch { /* A read failure must never replace a confirmed issue result or resend rewards. */ }
        if (!verified && balanceBefore !== null) setBalanceRetry({ refs, classCode: selectedClassCode, before: balanceBefore, resultMessage });
        setSubmitMessage(`${selectedClassCode} ${resultMessage}${balanceMessage}`);
        setIssueReviewOpen(false);
        setIssueAcknowledged(false);
      }
      issueInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function retryIssueBalance() {
    if (!balanceRetry || issueInFlight.current) return;
    issueInFlight.current = true;
    setSubmitting(true);
    setSubmitStageLabel('查询余额…');
    try {
      const after = await fetchDistributionBalance(balanceRetry.refs);
      if (after.expired) onAuthenticationRequired?.();
      if (after.value !== null && !after.expired) {
        setSubmitMessage(`${balanceRetry.classCode} ${balanceRetry.resultMessage}班内余额 ${balanceRetry.before} → ${after.value} MP（已重新查询）。`);
        setBalanceRetry(null);
      }
    } catch { setSubmitMessage(`${balanceRetry.classCode} 余额仍未查询成功，未重新发放；可稍后再次查询。`); }
    finally { issueInFlight.current = false; setSubmitting(false); }
  }

  function unresolvedIssueRewards(issue = pendingIssue) {
    return (issue?.students || []).filter((student) => student.status === 'unresolved').map((student) => ({
      studentId: student.studentId,
      studentName: student.studentName,
      chineseName: student.chineseName,
      aliases: [student.studentName, student.chineseName].filter(Boolean),
      amount: student.amount,
    }));
  }

  async function downloadPendingIssue() {
    if (!pendingIssue) return;
    try {
      await downloadDistributionFallbackExcel({ rewards: unresolvedIssueRewards(), classCode: selectedClassCode, fileName: `${selectedClassCode}_MiniP待核对名单.xlsx` });
      setIssueRecoveryMessage('待核对名单已下载；下载不会重新发放。');
    } catch (nextError) {
      setIssueRecoveryMessage(nextError instanceof Error ? nextError.message : '待核对名单下载失败，请重试。');
    }
  }

  async function downloadFailedIssueRows() {
    if (!failedIssueRows.length) return;
    try {
      await downloadDistributionFallbackExcel({ rewards: failedIssueRows, classCode: selectedClassCode, fileName: `${selectedClassCode}_MiniP发放失败兜底.xlsx` });
      setIssueRecoveryMessage(`失败名单已重新下载，共 ${failedIssueRows.length} 人；下载不会重复发放。`);
    } catch (nextError) {
      setIssueRecoveryMessage(nextError instanceof Error ? nextError.message : '失败名单下载失败，请重试。');
    }
  }

  async function reconcilePendingIssue() {
    if (!pendingIssue || issueRecoveryBusy) return;
    setIssueRecoveryBusy(true);
    setIssueRecoveryMessage('正在读取官网逐人发放流水；不会重新发放…');
    try {
      const issue = await reconcileDailyReportRewardIssue(selectedClassCode, pendingIssue.id);
      if (!issue || issue.status === 'complete') {
        setPendingIssue(null);
        setIssuedCurrentReport(true);
        setIssueRecoveryMessage('官网流水已确认全部到账，本张日报已完成发放。');
      } else {
        setPendingIssue(issue);
        const confirmed = issue.students.filter((student) => student.status === 'confirmed').length;
        setIssueRecoveryMessage(`已确认到账 ${confirmed} 人，仍有 ${unresolvedIssueRewards(issue).length} 人待核对。系统不会自动重发。`);
      }
    } catch (nextError) {
      setIssueRecoveryMessage(nextError instanceof Error ? nextError.message : '官网流水核对失败，请稍后重试。');
    } finally {
      setIssueRecoveryBusy(false);
    }
  }

  async function releasePendingIssue() {
    if (!pendingIssue || issueRecoveryBusy) return;
    const unresolved = unresolvedIssueRewards();
    if (!unresolved.length) return;
    if (!window.confirm(`请先在官网逐人确认以下 ${unresolved.length} 名学生确实未到账。\n确认后只解除这些学生的防重复锁，不会自动发放。是否继续？`)) return;
    setIssueRecoveryBusy(true);
    try {
      const issue = await releaseDailyReportRewardIssue(selectedClassCode, pendingIssue.id);
      const confirmedIds = (issue?.students || []).filter((student) => student.status === 'confirmed').map((student) => student.studentId.toLowerCase());
      setRemovedStudentIds(confirmedIds);
      setPendingIssue(null);
      setIssuedCurrentReport(false);
      setIssueRecoveryMessage(confirmedIds.length
        ? `旧单已处理：已到账 ${confirmedIds.length} 人已从本次重发名单排除；请核对剩余学生后再发放。`
        : '旧单已标记为官网确认未到账；现在可以核对后重新发放。');
    } catch (nextError) {
      setIssueRecoveryMessage(nextError instanceof Error ? nextError.message : '旧单处理失败，请重试。');
    } finally {
      setIssueRecoveryBusy(false);
    }
  }

  async function exportReportImage() {
    const poster = reportPosterRef.current;
    if (!poster || reportExporting) return;
    setReportExporting(true);
    setReportExportMessage('正在生成日报图片；完成后会同时复制并下载…');
    let exportCopy: { host: HTMLDivElement; target: HTMLElement } | null = null;
    try {
      let blob: Blob;
      try {
        blob = await renderClassDailyReportImage(poster);
      } catch (error) {
        if ((error as { code?: string })?.code === 'EXPORT_FONT_UNAVAILABLE') throw error;
        exportCopy = createReportExportCopy(poster);
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
        blob = await requestExportImageBlob(exportCopy.target, { backgroundColor: '#fffdf8' });
      }
      const message = await deliverExportImageBlob(blob, `${selectedClassCode}_班级挑战完成日报_${shanghaiExportTimestamp()}`, { alwaysDownload: true });
      setReportExportMessage(message.split('座位表').join('班级日报'));
    } catch (nextError) {
      setReportExportMessage(nextError instanceof Error ? nextError.message : '班级日报图片生成失败');
    } finally {
      exportCopy?.host.remove();
      setReportExporting(false);
    }
  }

  async function exportReportExcel() {
    if (!detail || !report || reportExporting) return;
    setReportExporting(true);
    setReportExportMessage('正在生成 Excel…');
    try {
      const { getXlsx } = await import('../utils/xlsxFile');
      const XLSX = await getXlsx();
      const reportHeaders = [
        ...(showStudentColumn ? ['中文名', '英文名'] : []),
        ...(showMinipColumn ? ['MiniP 合计'] : []),
        ...(showProgressColumn ? ['待完成'] : []),
        ...(showSpeakingColumn ? ['每日开口'] : []),
        ...visibleOrderedTasks.map((task) => task.title || task.label),
      ];
      const reportRows = sortedReportStudents.map((student) => {
        const cellByTaskId = new Map(student.cells.map((cell) => [String(cell.taskId), cell]));
        return [
        ...(showStudentColumn ? [student.chineseName, student.englishName] : []),
        ...(showMinipColumn ? [rewardByStudentId.get(student.studentId)?.total || 0] : []),
        ...(showProgressColumn ? [student.incompleteCount] : []),
        ...(showSpeakingColumn ? [`${student.speaking.days} 天`] : []),
        ...visibleOrderedTasks.map((task) => cellByTaskId.get(String(task.id))?.display || ''),
        ];
      });
      const rewardRows = rewards.map((reward) => [
        reward.studentId,
        reward.chineseName,
        reward.englishName,
        reward.基础落实,
        reward.每日开口,
        reward.total,
      ]);
      const workbook = XLSX.utils.book_new();
      const reportSheet = XLSX.utils.aoa_to_sheet([reportHeaders, ...reportRows]);
      reportSheet['!cols'] = reportHeaders.map((header, index) => ({ wch: index < 2 ? 14 : Math.min(28, Math.max(10, String(header).length * 2)) }));
      const rewardSheet = XLSX.utils.aoa_to_sheet([['学号', '中文名', '英文名', '基础落实 MP', '每日开口 MP', '合计 MP'], ...rewardRows]);
      rewardSheet['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(workbook, reportSheet, '班级日报');
      XLSX.utils.book_append_sheet(workbook, rewardSheet, 'MiniP明细');
      const raw = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([raw], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedClassCode}_班级挑战完成日报_${shanghaiExportTimestamp()}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setReportExportMessage('Excel 已生成，包含班级日报和 MiniP 明细两个工作表。');
    } catch (nextError) {
      setReportExportMessage(nextError instanceof Error ? nextError.message : 'Excel 生成失败');
    } finally {
      setReportExporting(false);
    }
  }

  if (classes.length === 0) return <section className="class-daily-home" aria-labelledby="class-daily-home-title"><div className="class-daily-home-empty-state" role="status"><span>📚</span><strong id="class-daily-home-title">暂时没有可用班级</strong><p>可能是班级权限尚未同步、登录已过期，或当前账号没有班级。可以先重新获取数据；仍为空时请重新登录。</p><div className="class-daily-home-state-actions"><button type="button" className="btn btn-primary" onClick={onRefreshData}>重新获取班级</button><button type="button" className="btn btn-ghost" onClick={onAuthenticationRequired}>重新登录</button></div></div></section>;

  return (
    <section className="class-daily-home" aria-labelledby="class-daily-home-title">
      <section ref={classSectionRef} className="report-class-section">
        <header className="report-page-heading">
          <div><div className="class-control-kicker">班主任工作区</div><h2 id="class-daily-home-title">班级日报</h2><p>按上一对应上课场次自动抓取挑战，直接生成完整网页日报。</p></div>
          <div className="report-current-class">当前查看 <strong>{selectedClassCode}</strong></div>
        </header>
        <div className="report-class-selector" role="list" aria-label="切换日报班级">
          {sortedClasses.map((classInfo) => {
            const code = classInfo.name.toUpperCase();
            const active = code === selectedClassCode;
            const displaySession = getClassDisplaySession(code, [], referenceNow, teacherName);
            const preparedClassTasks = (preparedSnapshot?.dailyReportTasks || []).find((item) => String(item.classId || '').toUpperCase() === code);
            const snapshot = preparedClassTasks?.weekTasks?.length
              ? preparedClassTasks
              : fallbackTaskCatalog?.classId === code
                ? fallbackTaskCatalog
                : preparedClassTasks;
            return <button key={classInfo.id || classInfo.name} type="button" role="listitem" aria-pressed={active} className={`report-class-option${active ? ' is-active' : ''}`} onClick={() => { setSelectedClassCode(code); onActiveClassChange?.(code); }}><strong>{classInfo.name}</strong><span>{displaySession ? `${displaySession.dayLabel} ${displaySession.time}` : snapshot?.weekTasks?.length ? `${snapshot.weekTasks.length} 组挑战可用` : '正在准备挑战'}</span></button>;
          })}
        </div>
      </section>

      <div className="report-command-row">
      <div className="report-settings-toggle"><button type="button" className="btn btn-ghost" aria-expanded={rulesOpen} aria-controls="report-inline-settings" onClick={() => setRulesOpen(open => !open)}>{rulesOpen ? '收起奖励明细' : '设置奖励明细'}</button><div className="report-settings-summary"><span className="report-current-task" title={currentTaskNames} aria-live="polite">{loading ? '正在抓取' : '日报使用'}：<strong>{currentTaskNames || '尚未选择任务'}</strong></span><small>{hasPendingConfig ? '有未应用的设置调整' : `${policyLabel(policyState.scope)} · 自动沿用`}</small></div></div>
        {!loading && detail && report && (<div className="report-toolbar">
            <button type="button" onClick={() => setReportFullScreen(true)}>全屏查看日报</button>
            <details className="report-display-options"><summary>调整显示与名单</summary><div className="report-display-options-body">            <label className="report-zoom">显示大小 <input aria-label="日报显示大小" type="range" min="0.4" max="2" step="0.1" value={reportZoom} onChange={event => setReportZoom(Number(event.target.value))}/><span>{Math.round(reportZoom*100)}%</span><button type="button" onClick={() => { const shell = reportPosterRef.current?.querySelector<HTMLElement>('.class-daily-home-matrix-shell'); const table = shell?.querySelector('table'); setReportZoom(shell && table ? Math.min(1, Math.max(.4, shell.clientWidth / table.offsetWidth)) : 1); }}>适应窗口</button></label>
            <div className="class-daily-home-sort-control">
              <span>学生排序</span>
              <select aria-label="学生排序依据" value={studentSort} onChange={(event) => setStudentSort(event.target.value as 'english' | 'completion')}>
                <option value="english">按英文名</option>
                <option value="completion">按完成程度</option>
              </select>
              <button type="button" aria-label="切换排序方向" onClick={() => setStudentSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')}>
                {studentSort === 'english'
                  ? studentSortDirection === 'asc' ? 'A → Z' : 'Z → A'
                  : studentSortDirection === 'asc' ? '低 → 高' : '高 → 低'}
              </button>
            </div>
            <button type="button" className={`class-daily-home-order-toggle${taskOrderOpen ? ' active' : ''}`} onClick={() => setTaskOrderOpen((open) => !open)}>✎ {taskOrderOpen ? '收起编辑' : '编辑显示与发放名单'}</button>
</div></details>
            <div className="class-daily-home-legend"><span><i className="is-crown">👑</i>词王</span><span><i className="is-complete">✅</i>完成</span><span><i className="is-follow">⭕</i>待完成</span></div>
            <div className="class-daily-home-export-actions"><button type="button" disabled={reportExporting} onClick={() => void exportReportImage()}>{reportExporting ? '生成中…' : '导出日报图片'}</button><button type="button" disabled={reportExporting} onClick={() => void exportReportExcel()}>导出日报 Excel</button></div>
        </div>)}
      </div>
      {policyStatus === 'error' && <div className="class-daily-home-warning" role="alert"><strong>奖励规则未能读取，已禁止发放。</strong><span>{policyMessage || '请重新读取已保存规则。'}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPolicyRetryNonce((value) => value + 1)}>重新读取奖励规则</button></div>}
      {taskCatalogError && <div className="class-daily-home-warning" role="alert"><strong>挑战目录没有准备完成。</strong><span>{taskCatalogError}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskCatalogRetryNonce((value) => value + 1)}>重新读取挑战</button></div>}
      <section className={`class-daily-home-distribution-flow${recommendation.needsConfirmation && !selectionConfirmed ? ' needs-confirmation' : ''}`} aria-label="日报任务与 MiniP 发放准备">
        <header><div><span>发放准备</span><strong>先核对任务，再核对发放清单</strong></div><small>任务选择是本次发放依据，不在高级设置中</small></header>
        <div className="class-daily-home-flow-step"><i>1</i><div><strong>选择本次任务</strong><span>{recommendation.previousMatchingSessionDate ? `系统匹配 ${recommendation.previousMatchingSessionDate} 布置的挑战；可直接增减` : recommendation.reason}</span></div></div>
        <div className="class-daily-home-picker is-direct"><div className="class-daily-home-picker-toolbar"><span>{taskCatalogLoading ? '正在读取挑战…' : `已选 ${draftIds.length} 组 · ${selectionConfirmed && !taskSelectionChanged ? '本次任务已确认' : '发放前需要确认'}`}</span><button type="button" onClick={restoreRecommendedTasks}>恢复系统推荐</button></div><div className="class-daily-home-task-list">{catalog.map((task) => { const checked = draftIds.includes(String(task.id)); return <label key={task.id} data-task-id={String(task.id)} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggleTask(String(task.id))}/><span><strong>{task.name}</strong><small>{formatTaskDate(task.startAt || task.addedAt)} · {task.resourceCount || 0} 个资源</small></span></label>; })}</div></div>
        <footer className="class-daily-home-flow-actions"><div><span>2</span><p><strong>核对并发放 MiniP</strong><small>{report && detail ? `${recipientCount} 名学生 · 合计 ${Number(totalMp.toFixed(2))} MP` : '日报生成后显示人数与金额'}</small></p></div><div><button type="button" className="btn btn-ghost" disabled={loading || !draftIds.length || (!taskSelectionChanged && selectionConfirmed)} onClick={confirmVisibleTaskSelection}>{loading ? '正在更新日报…' : taskSelectionChanged ? '按所选任务更新日报' : selectionConfirmed ? '任务已确认' : '确认所选任务'}</button><button type="button" className="btn btn-primary" disabled={!canIssue || submitting || recipientCount === 0} onClick={() => void openIssueReview()}>{submitting ? submitStageLabel : '核对并发放 MiniP'}</button></div></footer>
        {!canIssue && report && <div className="class-daily-home-issue-lock" role="status">暂不可进入发放核对：{issueSafetyReason}</div>}
      </section>
      <div id="report-inline-settings" className="report-inline-details" hidden={!rulesOpen}>

      <section className={`class-daily-home-config-board${configCollapsed ? ' is-collapsed' : ''}`} aria-label="日报生成设置">
        {configCollapsed ? (
          <div className="class-daily-home-config-compact">
            <div><strong>统计与奖励逻辑</strong><span>{compactPolicySummary}</span></div>
            <div className="class-daily-home-config-compact-reward"><b>MiniP</b><span>{report && detail ? `${recipientCount} 人 · ${Number(totalMp.toFixed(2))} MP` : '制作后核算'}</span></div>
            <div className="class-daily-home-config-compact-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfigCollapsed(false)}>调整设置</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={loading || !draftIds.length} onClick={confirmGeneration}>{loading ? '正在制作…' : hasPendingConfig ? '应用并重新生成' : '重新生成'}</button>
            </div>
          </div>
        ) : (
          <>
            <header className="class-daily-home-config-head">
              <div><span>✨ 班级日报设置</span><strong>统计与奖励逻辑</strong></div>
              <p>{policyLabel(policyState.scope)} · 选好后统一制作一次</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfigCollapsed(true)}>收起设置 ↑</button>
            </header>
            <div className="class-daily-home-config-sections">
              <article className="class-daily-home-logic-card is-basic">
                <header><div><span>📘</span><div><strong>落实数据</strong><small>日报质量判断与 MiniP 奖励分开设置</small></div></div><b>{draftModeLabel}</b></header>
                <div className="class-daily-home-setting-scope"><strong>日报展示与质量判断</strong><span>下列选项只改变日报展示、颜色和问题诊断，不改变 MiniP。</span></div>
                <div className="class-daily-home-mode-tabs" aria-label="日报版本">
                  {([['standard', '标准版'], ['detail', '明细版'], ['senior', '大龄版']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={policyDraft.report.mode === id} className={policyDraft.report.mode === id ? 'active' : ''} onClick={() => patchReport({ mode: id as DailyReportMode })}>{label}</button>)}
                </div>
                <div className="class-daily-home-logic-quick-grid">
                  <label><span>AI 语音质量线（仅日报）</span><input aria-label="AI语音基准值" type="number" min="0" max="100" value={policyDraft.report.aiVoicePassRate} onChange={(event) => patchReport({ aiVoicePassRate: Number(event.target.value) || 0 })}/><b>%</b></label>
                  <label><span>测试质量线（仅日报）</span><input aria-label="测试基准值" type="number" min="0" max="100" placeholder="80" value={policyDraft.report.testPassScore ?? ''} onChange={(event) => patchReport({ testPassScore: event.target.value === '' ? null : Number(event.target.value) })}/><b>分</b></label>
                </div>
                <div className="class-daily-home-setting-scope is-reward"><strong>MiniP 奖励计算</strong><span>以下规则会直接改变预计发放金额。</span></div>
                <div className="class-daily-home-logic-quick-grid">
                  <label><span>基础奖励</span><select aria-label="基础落实奖励方式" value={policyDraft.basic.schemeId} onChange={(event) => { const schemeId = event.target.value as 'scheme1' | 'scheme2' | 'custom'; patchPolicy({ basic: { ...policyDraft.basic, schemeId, customName: schemeId === 'custom' ? policyDraft.basic.customName || '默认逐项奖励' : policyDraft.basic.customName, customRules: schemeId === 'custom' && policyDraft.basic.customRules.length === 0 ? resourceAwareDefaultRules : policyDraft.basic.customRules } }); }}><option value="scheme1">逐项发放</option><option value="scheme2">全部完成</option><option value="custom">自定义逐项</option></select></label>
                  <label><span>全部完成奖励</span><input aria-label="快捷设置全部完成奖励" type="number" min="0" step="0.1" value={policyDraft.basic.allDoneAmount} disabled={policyDraft.basic.schemeId !== 'scheme2'} onChange={(event) => patchPolicy({ basic: { ...policyDraft.basic, allDoneAmount: Number(event.target.value) || 0 } })}/><b>MP</b></label>
                </div>
                <label className="class-daily-home-logic-details-toggle"><input type="checkbox" aria-label="启用基础奖励" checked={policyDraft.sources.basic} onChange={(event) => patchPolicy({ sources: { ...policyDraft.sources, basic: event.target.checked } })}/> 计算基础奖励</label>
                <button type="button" className="class-daily-home-logic-details-toggle" onClick={() => setBasicDetailsOpen((open) => !open)}>{basicDetailsOpen ? '收起落实明细 ↑' : '展开落实明细与逐项规则 →'}</button>
                {basicDetailsOpen && <div className="class-daily-home-logic-details">
                  {policyDraft.basic.schemeId === 'scheme1' && <div className="class-daily-home-preset-rules"><header><strong>逐项发放规则</strong><span>分别累计，无需全部完成</span></header><div className="report-rule-grid">{reportRewardScheme(policyDraft.basic).rules.filter(rule => rule.enabled).map(rule => <div key={rule.templateId}><span>{reportRuleLabel(rule)}</span><strong>+{rule.amount} MP</strong></div>)}</div><p>需要调整每项金额或奖励分数线，可切换「自定义逐项」。</p></div>}
                  {policyDraft.basic.schemeId === 'scheme2' && <div className="class-daily-home-preset-rules is-all-done"><header><strong>当前规则</strong><span>全部完成才发放</span></header><div className="class-daily-home-preset-rule"><span>所有基础挑战全部完成</span><b>+ {policyDraft.basic.allDoneAmount} MP</b></div><p>选做挑战不影响判定。</p></div>}
                  {policyDraft.basic.schemeId === 'custom' && <CustomSchemeEditor key={`${selectedClassCode}:${policyState.updatedAt}`}
                    existing={{ id: 'custom_report', name: policyDraft.basic.customName || '我的日报奖励', rules: policyDraft.basic.customRules.length ? policyDraft.basic.customRules : resourceAwareDefaultRules, createdAt: 0 }}
                    onCancel={() => setBasicDetailsOpen(false)}
                    onSave={(scheme) => {
                      patchPolicy({ basic: { ...policyDraft.basic, customName: scheme.name, customRules: scheme.rules } });
                    }}
                  />}
                </div>}
              </article>

              <article className="class-daily-home-logic-card is-speaking">
                <header><div><span>🎤</span><div><strong>每日开口</strong><small>统计区间、达标天数与开口奖励</small></div></div><label className="class-daily-home-logic-switch"><input aria-label="启用每日开口" type="checkbox" checked={policyDraft.sources.speaking} onChange={(event) => { const speaking = event.target.checked; patchPolicy({ sources: { ...policyDraft.sources, speaking }, report: { ...policyDraft.report, includeSpeaking: speaking } }); }}/><i/></label></header>
                {policyDraft.sources.speaking ? <>
                  <div className="class-daily-home-speaking-presets" aria-label="每日开口快捷日期"><button type="button" aria-pressed={speakingRangeDraft.start === currentSpeakingRange.start && speakingRangeDraft.end === currentSpeakingRange.end} onClick={() => patchSpeakingRange(currentSpeakingRange)}>本周至今</button><button type="button" aria-pressed={speakingRangeDraft.start === defaultSpeakingRange.start && speakingRangeDraft.end === defaultSpeakingRange.end} onClick={() => patchSpeakingRange(defaultSpeakingRange)}>上周</button><span>也可在下方自定义</span></div>
                  <div className="class-daily-home-speaking-range"><span>日期</span><ClickableDateInput ariaLabel="每日开口开始日期" value={speakingRangeDraft.start} onChange={(value) => patchSpeakingRange({ start: value })}/><i>至</i><ClickableDateInput ariaLabel="每日开口结束日期" value={speakingRangeDraft.end} onChange={(value) => patchSpeakingRange({ end: value })}/><small>默认上周，可一键切换本周至今</small></div>
                  <div className="class-daily-home-logic-quick-grid is-speaking">
                    <label><span>日报关注天数（不影响奖励）</span><input aria-label="最低开口天数" type="number" min="0" max="7" value={policyDraft.report.minSpeakingDays} onChange={(event) => patchReport({ minSpeakingDays: Number(event.target.value) || 0 })}/><b>天</b></label>
                    <label><span>每天奖励</span><input aria-label="快捷设置每日开口奖励" type="number" min="0" max="2" step="0.05" value={policyDraft.speaking.basePerDay} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, basePerDay: Number(event.target.value) || 0 } })}/><b>MP</b></label>
                  </div>
                  <button type="button" className="class-daily-home-logic-details-toggle" onClick={() => setSpeakingDetailsOpen((open) => !open)}>{speakingDetailsOpen ? '收起开口明细 ↑' : '展开连续奖励明细 →'}</button>
                  {speakingDetailsOpen && <div className="class-daily-home-logic-details"><div className="class-daily-home-policy-row class-daily-home-speaking-rule"><strong>连续奖励</strong><label>连续 <input type="number" min="2" max="14" value={policyDraft.speaking.streakThreshold} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, streakThreshold: Number(event.target.value) || 2 } })}/> 天后</label><select value={policyDraft.speaking.rewardMode} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, rewardMode: event.target.value as 'fixed' | 'multiplier' } })}><option value="fixed">额外固定奖励</option><option value="multiplier">按倍数奖励</option></select>{policyDraft.speaking.rewardMode === 'fixed' ? <label><input type="number" min="0" max="20" step="0.1" value={policyDraft.speaking.thresholdBonus} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, thresholdBonus: Number(event.target.value) || 0 } })}/> MP</label> : <label><input type="number" min="1" max="3" step="0.1" value={policyDraft.speaking.streakMultiplier} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, streakMultiplier: Number(event.target.value) || 1 } })}/> 倍</label>}<label><input type="checkbox" checked={policyDraft.speaking.ignoreSupplementVariance} onChange={(event) => patchPolicy({ speaking: { ...policyDraft.speaking, ignoreSupplementVariance: event.target.checked } })}/> 补卡按正常开口计连续</label></div></div>}
                </> : <div className="class-daily-home-logic-off">本次日报不显示、统计或奖励每日开口。</div>}
              </article>
            </div>
            <div className="class-daily-home-template-actions"><span>模板操作会同时应用并重新生成当前日报；其他已有独立模板的班级不会被通用模板覆盖。</span><div>{policyState.scope === 'class' && <button type="button" className="btn btn-ghost btn-sm" disabled={savingPolicy} onClick={restoreTeacherPolicy}>{savingPolicy ? '处理中…' : '恢复并应用通用模板'}</button>}<button type="button" className="btn btn-ghost btn-sm" disabled={savingPolicy || !draftHasSources} onClick={() => savePolicy('class')}>{savingPolicy ? '保存中…' : '应用并保存当前班'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={savingPolicy || !draftHasSources} onClick={() => savePolicy('teacher')}>{savingPolicy ? '保存中…' : '应用并设为通用模板'}</button></div></div>
            {policyMessage && <div className="class-daily-home-policy-message">{policyMessage}</div>}
            <div className="class-daily-home-config-actions">
              <footer className="class-daily-home-generate-bar"><div><strong>{hasPendingConfig ? '有尚未应用的新设置' : '当前设置与下方日报一致'}</strong><span>编辑期间不改动当前日报；点击后才会应用并重新计算。</span></div><button type="button" className="btn btn-primary class-daily-home-generate" disabled={loading || !draftIds.length} onClick={confirmGeneration}>{loading ? '正在制作…' : '应用并重新生成日报'}</button></footer>
            </div>
          </>
        )}
        {configCollapsed && hasPendingConfig && policyMessage && <div className="class-daily-home-policy-message">{policyMessage}</div>}
      </section>

        {detail && report && <section className="report-reward-details" aria-label="MiniP 逐项核算明细">
          <details><summary>逐人奖励核算明细（{rewardStudents.length} 人）</summary><h3>MiniP 逐项核算明细</h3><p>按本张日报所选挑战和统计日期核算，是预计奖励，不代表已经发放；合计沿用日报原有精度，保留 1 位小数。调整规则后请重新制作。</p>
          <div className="report-rule-grid">{appliedPolicy.sources.basic ? explanationScheme.rules.filter(rule => rule.enabled).map(rule => <div key={rule.templateId}><span>{reportRuleLabel(rule)}</span><strong>+{rule.amount} MP</strong></div>) : <p>基础落实奖励已关闭</p>}</div>
          {rewardStudents.map(student => { const reward = rewardByStudentId.get(student.studentId); return <details data-student-reward key={student.studentId}><summary>{student.englishName || student.chineseName} · 预计 {reward?.total.toFixed(1)} MP</summary>
            {appliedPolicy.sources.basic && <ul>{reportRewardDetails(student, explanationScheme).map((item, index) => <li key={index}><div><strong>{item.task} · {item.rule}</strong><small>{item.evidence}</small></div><b>{item.amount > 0 ? '+' : ''}{item.amount} MP</b></li>)}</ul>}
            {appliedPolicy.sources.speaking && <p>每日开口：{student.dailyCheckIns} 天 · +{reward?.每日开口 || 0} MP（按当前每日开口规则）</p>}
            <p>基础落实 {reward?.基础落实 || 0} + 每日开口 {reward?.每日开口 || 0} = {reward?.total.toFixed(1)} MP</p>
          </details>; })}
          </details>
        </section>}
      </div>

      {submitMessage && <div className="class-daily-home-policy-message class-daily-home-submit-message" role="status" aria-live="polite">{submitMessage}{balanceRetry && <button type="button" className="btn btn-ghost btn-sm" disabled={submitting} onClick={retryIssueBalance}>{submitting ? '查询中…' : '重新查询余额'}</button>}</div>}

      {(pendingIssue || issueRecoveryMessage) && <section className="class-daily-home-issue-recovery" aria-label="待核对发放记录"><strong>{pendingIssue ? pendingIssue.status === 'pending' ? '上一笔发放仍在安全等待期' : '上一笔发放结果待核对' : '发放处理结果'}</strong>{pendingIssue && <><p>{pendingIssue.status === 'pending' ? '服务未收到明确完成结果。为避免与仍在处理的请求冲突，请先核对官网流水；安全等待期结束后，页面才会开放人工解除。' : '为避免重复奖励，系统已停止自动重发。'} 待核对 {unresolvedIssueRewards().length} 人。</p><ul>{pendingIssue.students.map((student) => <li key={student.studentId}><span>{student.studentName || student.chineseName || student.studentId}</span><b>{student.amount} MP · {student.status === 'confirmed' ? '已确认到账' : '待核对'}</b></li>)}</ul><div className="class-daily-home-state-actions"><button type="button" className="btn btn-primary btn-sm" disabled={issueRecoveryBusy} onClick={() => void reconcilePendingIssue()}>{issueRecoveryBusy ? '核对中…' : '重新核对官网流水'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={issueRecoveryBusy} onClick={() => void downloadPendingIssue()}>下载待核对名单</button>{pendingIssue.status === 'uncertain' && <button type="button" className="btn btn-ghost btn-sm" disabled={issueRecoveryBusy} onClick={() => void releasePendingIssue()}>已在官网确认未到账</button>}</div></>}{issueRecoveryMessage && <p role="status">{issueRecoveryMessage}</p>}</section>}

      {failedIssueRows.length > 0 && <section className="class-daily-home-issue-recovery is-definitive" aria-label="发放失败名单"><strong>有 {failedIssueRows.length} 名学生明确发放失败</strong><p>成功学生不会再次进入名单。请下载失败名单，通过官网兜底处理。</p><div className="class-daily-home-state-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadFailedIssueRows()}>重新下载失败名单</button></div></section>}

      {!loading && detail && report && <>
        {(report.source === 'snapshot' || report.source === 'snapshot-fallback' || batchRefreshBusy || refreshingReport || refreshNotice) && (
          <div className={`class-daily-home-snapshot-state${report.refreshError || refreshNotice.includes('未成功') ? ' is-warning' : ''}${batchRefreshBusy || refreshingReport ? ' is-refreshing' : ''}`}>
            <div className="class-daily-home-snapshot-copy">
              <strong>{batchRefreshBusy ? '正在更新全部数据，完成后本页会自动刷新' : refreshingReport ? `正在刷新 ${selectedClassCode} 最新日报` : report.source === 'live' ? '当前日报已更新到最新数据' : '当前显示最近一次可用快照'}</strong>
              <span>{batchRefreshBusy || refreshingReport ? `已用 ${batchRefreshElapsedSeconds} 秒 · ${batchRefreshBusy ? '整批通常约 20–30 秒' : '当前班级通常约 5–15 秒'}，请保持页面打开` : refreshNotice || formatDataCutoff(report.dataUpdatedAt || report.updatedAt)}</span>
              {(batchRefreshBusy || refreshingReport) && <div className="class-daily-home-refresh-progress" role="progressbar" aria-label="日报数据更新进行中"><i /></div>}
            </div>
            {!batchRefreshBusy && !refreshingReport && (report.refreshError || refreshNotice.includes('未成功')) && onRefreshData && <button type="button" className="btn btn-primary btn-sm" onClick={onRefreshData}>重新更新全部数据</button>}
          </div>
        )}
        {(activeReportOptions.includeSpeaking || appliedPolicy.sources.speaking) && !report.speakingAvailable && <div className="class-daily-home-warning">每日开口数据暂未读取成功{report.speakingError ? `：${report.speakingError}` : ''}；为避免错误，本次每日开口奖励按 0 显示且不会发放。</div>}
        <div className="class-daily-home-poster-divider">
          <div><span>学生展示版</span><strong>{selectedClassCode} 班级挑战完成日报</strong></div>
        </div>
        {reportExportMessage && <div className="class-daily-home-export-notice" role="status">{reportExportMessage}</div>}
        {taskOrderOpen && <div className="class-daily-home-column-order" aria-label="编辑日报列与学生行">
            <header><div><strong>编辑显示与本次发放名单</strong><span>这里不只是排版：取消学生会同时从网页、导出文件和本次 MiniP 发放名单中排除；不会删除学生中心数据。发放确认时会再次列出排除人数。</span></div><button type="button" onClick={resetReportEdits}>恢复全部</button></header>
            <section className="class-daily-home-fixed-columns" aria-label="固定列显示设置">
              <strong>显示列</strong>
              <label><input type="checkbox" checked={showStudentColumn} onChange={() => toggleColumnVisibility('student')}/>学生姓名</label>
              <label><input type="checkbox" checked={showProgressColumn} onChange={() => toggleColumnVisibility('progress')}/>完成情况</label>
              {activeReportOptions.includeSpeaking && <label><input type="checkbox" checked={showSpeakingColumn} onChange={() => toggleColumnVisibility('speaking')}/>每日开口</label>}
              <label><input type="checkbox" checked={showMinipColumn} onChange={() => toggleColumnVisibility('minip')}/>MiniP 奖励</label>
            </section>
            <div className="class-daily-home-task-column-editor">{orderedTasks.map((task, index) => { const columnId = `task:${String(task.id)}`; const visible = !hiddenColumnIds.includes(columnId); return <article className={visible ? '' : 'is-hidden'} key={task.id}><input aria-label={`显示 ${task.label}`} type="checkbox" checked={visible} onChange={() => toggleColumnVisibility(columnId)}/><span>{index + 1}</span><strong>{task.label}</strong><div><button type="button" aria-label={`将 ${task.label} 向左移动`} disabled={index === 0} onClick={() => moveTaskColumn(String(task.id), -1)}>←</button><button type="button" aria-label={`将 ${task.label} 向右移动`} disabled={index === orderedTasks.length - 1} onClick={() => moveTaskColumn(String(task.id), 1)}>→</button></div></article>; })}</div>
            <section className="class-daily-home-student-editor" aria-label="本次展示与发放学生设置"><strong>展示并发放的学生</strong><div>{detail.students.map((student) => { const key = reportStudentKey(student); const included = !removedStudentIds.includes(key); return <label className={included ? '' : 'is-hidden'} key={key}><input aria-label={`本次展示并发放给 ${student.englishName || student.chineseName}`} type="checkbox" checked={included} onChange={() => toggleStudentRow(key)}/><span><b>{student.englishName || student.chineseName}</b><small>{student.chineseName && student.chineseName !== student.englishName ? student.chineseName : ''}</small></span></label>; })}</div></section>
        </div>}
        <section ref={reportPosterRef} style={{ '--report-zoom': reportZoom } as React.CSSProperties} className={`class-daily-home-poster class-daily-home-full-report is-${activeReportOptions.mode}${reportFullScreen ? ' is-fullscreen-reading' : ''}`} aria-label={`${selectedClassCode} 班级挑战完成日报`}>
          {reportFullScreen && <button type="button" className="report-exit-fullscreen" onClick={() => setReportFullScreen(false)}>退出全屏 ×</button>}
          <header className="class-daily-home-poster-head"><span>🌟 CLASS CHALLENGE DAILY REPORT</span><h2><span aria-hidden="true">📚</span>{selectedClassCode} 班级挑战完成日报</h2><p><strong>{activeReportOptions.mode === 'standard' ? '标准版' : activeReportOptions.mode === 'detail' ? '明细版' : '大龄版'}</strong><i>·</i>{formatDataCutoff(report.dataUpdatedAt || report.updatedAt)}</p></header>
          <div className="class-daily-home-report-summary"><div><span>全部完成</span><strong>{visibleReportStats.fullyCompletedCount}</strong><small>/ {visibleReportStats.totalStudents} 人</small></div><div><span>班级完成率</span><strong>{visibleReportStats.completionRate}%</strong><small>基础落实</small></div><div><span>显示挑战</span><strong>{visibleOrderedTasks.length}</strong><small>/ {detail.tasks.length} 项</small></div></div>
          {!reportFitsViewport && <div className="class-daily-home-scroll-hint">挑战较多，可左右滑动查看完整日报 →</div>}
          <div className="class-daily-home-matrix-shell"><table className={`class-daily-home-matrix ${reportFitsViewport ? 'is-fit' : 'is-scroll'}${reportHasManyTasks ? ' is-many' : ''}`} style={{ tableLayout: 'fixed', width: '100%', minWidth: reportTableMinWidth, '--report-table-min-width': `${reportTableMinWidth}px` } as React.CSSProperties}><colgroup>
            {reportColumnLayout.columns.map(column => <col key={`${column.kind}:${column.key}`} data-report-width={column.width} style={{ width: `${column.percent}%` }}/>) }
          </colgroup><thead><tr>{showStudentColumn && <th className="is-student">学生</th>}{showMinipColumn && <th className="is-minip">MiniP 奖励（MP）</th>}{showProgressColumn && <th className="is-progress">完成情况</th>}{showSpeakingColumn && <th className="is-metric">每日开口<small>{detail.options.speakingRangeStart.slice(5)}—{detail.options.speakingRangeEnd.slice(5)}</small></th>}{visibleOrderedTasks.map((task, index) => <th className="is-task" key={task.id}><span className="class-daily-home-task-number">{index + 1}</span>{task.label}{task.optional && <small>选做</small>}</th>)}</tr></thead><tbody>{sortedReportStudents.map((student) => { const reward = rewardByStudentId.get(student.studentId); const cellByTaskId = new Map(student.cells.map((cell) => [String(cell.taskId), cell])); const requiredCount = detail.tasks.filter((task) => !task.optional).length; const completedCount = Math.max(0, requiredCount - student.incompleteCount); const completionRate = requiredCount ? Math.round((completedCount / requiredCount) * 100) : 100; return <tr key={student.studentId || student.englishName} data-student-name={student.englishName} className={`issue-${student.issueLevel}${student.incompleteCount > 0 ? ' is-incomplete' : ''}`}>{showStudentColumn && <td data-label="学生" className="is-student"><strong>{student.englishName || student.chineseName}</strong><small>{student.chineseName && student.chineseName !== student.englishName ? student.chineseName : '—'}</small></td>}{showMinipColumn && <td data-label="MiniP 奖励" className="is-minip"><strong>{(reward?.total || 0).toFixed(1)}</strong></td>}{showProgressColumn && <td data-label="完成情况" className={`is-progress${completionRate === 0 ? ' level-3 is-zero' : ''}`}><div><b>{completionRate}%</b><small>完成 {completedCount}/{requiredCount}</small></div><span><i style={{ width: `${completionRate}%` }}/></span></td>}{showSpeakingColumn && <td data-label="每日开口" className={`is-metric level-${student.speaking.days === 0 ? 3 : student.speaking.days < activeReportOptions.minSpeakingDays ? 1 : 0}`}><b>{student.speaking.days}</b><small>天</small></td>}{visibleOrderedTasks.map((task) => { const cell = cellByTaskId.get(String(task.id)); return <td data-label={task.label} key={task.id} className={`is-task level-${cell?.level ?? 3}`} title={cell?.label || task.label}><span className={`class-daily-home-cell-mark level-${cell?.level ?? 3}`}>{compactCellDisplay(cell?.display || '⭕')}</span></td>; })}</tr>; })}</tbody></table></div>
          {showMinipColumn && <footer className="class-daily-home-parent-reward-note"><span>⭐ 本次 MiniP 说明</span><strong>{parentRewardRuleText}</strong><small>奖励数额见学生对应行。</small></footer>}
        </section>

        <ReportQualityAnalysis key={selectedClassCode} tiers={detail.qualityTiers} visibleNames={visibleStudentNames} students={visibleProblemStudents}/>
      </>}

      {error && <div className="class-daily-home-error" role="alert"><strong>{error}</strong><div className="class-daily-home-state-actions"><button type="button" className="btn btn-primary btn-sm" disabled={!appliedIds.length} onClick={() => setGenerationNonce((value) => value + 1)}>重新生成日报</button><button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshData}>更新全部数据</button></div></div>}
      {loading && <div className="class-daily-home-loading"><span className="spinner"/> 正在生成 {selectedClassCode} 完整班级日报…</div>}


      {!loading && !error && appliedIds.length === 0 && <div className="class-daily-home-empty-state"><span>📚</span><strong>{taskCatalogLoading ? '正在读取早间挑战快照' : '暂时没有匹配到本轮挑战'}</strong><p>{taskCatalogLoading ? '读取完成后会直接按默认挑战和已保存规则生成日报。' : '可在上方「选择本次任务」中选择挑战，或从左侧更新全部数据。'}</p></div>}

      {issueReviewOpen && <div className="class-daily-home-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setIssueReviewOpen(false); }}>
        <section className="class-daily-home-review-modal" role="dialog" aria-modal="true" aria-labelledby="class-daily-home-review-title">
          <header><div><span>{selectedClassCode} · {currentTaskNames}</span><h2 id="class-daily-home-review-title">核对 MiniP 发放</h2></div><button type="button" aria-label="关闭发放清单" disabled={submitting} onClick={() => setIssueReviewOpen(false)}>×</button></header>
          <div className="class-daily-home-review-summary"><div><span>本次任务</span><strong>{appliedIds.length} 组</strong></div><div><span>本次发放</span><strong>{distributionRows.length} 人</strong></div><div><span>合计</span><strong>{formatMp(distributionRows.reduce((sum, row) => sum + row.amount, 0))}</strong></div><div><span>当前余额</span><strong>{issueReviewLoading ? '读取中…' : issueReviewBalance === null ? '暂未读取' : formatMp(issueReviewBalance)}</strong></div></div>
          <div className="class-daily-home-review-tasks"><strong>已确认任务</strong><div>{selectedTasks.map((task) => <span key={task.id}>{task.name}</span>)}</div></div>
          {issueReviewLoading && <div className="class-daily-home-review-progress" role="status"><span className="spinner"/><div><strong>正在读取班内余额</strong><small>这里只读取余额，不会发放。</small></div></div>}
          {submitting && <div className="class-daily-home-review-progress" role="status" aria-live="polite"><span className="spinner"/><div><strong>{submitStageLabel}</strong><small>正在提交并核对结果，请保持页面打开，不要重复操作。</small></div></div>}
          <div className="class-daily-home-review-table-shell"><table><thead><tr><th>学生</th><th>基础落实</th><th>每日开口</th><th>本次应发</th></tr></thead><tbody>{distributionRows.map((reward) => <tr key={reward.studentId}><td><strong>{reward.studentName || reward.chineseName || reward.studentId}</strong>{reward.chineseName && reward.chineseName !== reward.studentName && <small>{reward.chineseName}</small>}</td><td>{formatMp(reward.components?.basic || 0)}</td><td>{formatMp(reward.components?.speaking || 0)}</td><td><strong>+{formatMp(reward.amount)}</strong></td></tr>)}</tbody></table></div>
          {(detail?.students || []).some((student) => removedStudentIds.includes(reportStudentKey(student))) && <div className="class-daily-home-review-excluded"><strong>本次排除</strong><span>{(detail?.students || []).filter((student) => removedStudentIds.includes(reportStudentKey(student))).map((student) => student.englishName || student.chineseName).join('、')}</span></div>}
          {issueReviewBalance !== null && issueReviewBalance + 0.0001 < distributionRows.reduce((sum, row) => sum + row.amount, 0) && <div className="class-daily-home-review-error">当前班内余额不足，本次不能发放。</div>}
          {issueReviewError && <div className="class-daily-home-review-error" role="alert">{issueReviewError}</div>}
          <label className="class-daily-home-review-ack"><input type="checkbox" checked={issueAcknowledged} disabled={submitting || issueReviewLoading || issueReviewBalance === null || Boolean(issueReviewError)} onChange={(event) => setIssueAcknowledged(event.target.checked)}/><span>我已核对班级、任务、学生名单和本次发放金额</span></label>
          <footer><button type="button" className="btn btn-ghost" disabled={submitting} onClick={() => setIssueReviewOpen(false)}>返回修改</button><button type="button" className="btn btn-primary" disabled={!issueAcknowledged || submitting || issueReviewLoading || issueReviewBalance === null || Boolean(issueReviewError) || issueReviewBalance + 0.0001 < distributionRows.reduce((sum, row) => sum + row.amount, 0)} onClick={() => void issueRewards()}>{submitting ? submitStageLabel : `确认发放 ${formatMp(distributionRows.reduce((sum, row) => sum + row.amount, 0))}`}</button></footer>
        </section>
      </div>}
    </section>
  );
}
