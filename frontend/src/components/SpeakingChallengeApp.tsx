import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SpeakingControls.css';
import type { ClassInfo, DayOfWeek } from '../types';
import {
  SpeakingChallengeApiError,
  resolveSpeakingPending,
  type SpeakingPendingResolution,
  type SpeakingPendingRecovery,
  createSpeakingRewardPlan,
  fetchSpeakingChallengeClass,
  issueSpeakingRewardPlan,
  type SpeakingChallengeClassResult,
  type SpeakingChallengeStudent,
  type SpeakingLeaderboard,
  type SpeakingRewardConfig,
  type SpeakingRewardIssueResult,
  type SpeakingRewardPlan,
  type SpeakingRewardSelection,
} from '../services/speakingChallengeApi';
import { getClassDays, getClassTimeOnDay } from '../utils/classSchedule';
import { getClassDisplaySession } from '../services/classControlSchedule';
import { deliverExportImageBlob, requestExportImageBlob } from '../utils/reportExportHelpers';
import './SpeakingChallengeApp.css';
import './ReportCoach.css';
import { speakingVisibleDates, speakingWeekMetrics, speakingStudentInRange, sortSpeakingStudents, settlementDatesInRange, type SpeakingSort } from '../utils/speakingVisibleDates';

interface Props {
  classes: ClassInfo[];
  teacherName: string;
  onAuthenticationRequired?: () => void;
  deferLoad?: boolean;
  activeClassCode?: string;
  onActiveClassChange?: (code: string) => void;
}

type LoadStatus = 'loading' | 'ready' | 'error';

interface ClassEntry {
  status: LoadStatus;
  result?: SpeakingChallengeClassResult;
  error?: string;
}

interface ClassOption {
  code: string;
  today: boolean;
  time: string;
}

interface IssueReceipt extends SpeakingRewardIssueResult {
  classCode: string;
  selectedDates: string[];
}

interface ClassBoardProps {
  code: string;
  entry: ClassEntry | undefined;
  teacherName: string;
  todayLabel: string;
  isToday: boolean;
  config: SpeakingRewardConfig;
  selection: SpeakingRewardSelection;
  selectedDates: string[];
  previewBusy: boolean;
  notice: { kind: 'success' | 'warning'; text: string } | null;
  onReload: () => void;
  onRecovery: (result: SpeakingPendingResolution) => Promise<void>;
  onUpdateConfig: <K extends keyof SpeakingRewardConfig>(field: K, value: SpeakingRewardConfig[K]) => void;
  onUpdateSelection: (value: SpeakingRewardSelection) => void;
  onToggleDate: (date: string) => void;
  onSelectDates: (dates: string[]) => void;
  onPreview: () => void;
}

interface PosterStudentEdit {
  displayName: string;
  hidden: boolean;
}

interface CachedSpeakingClassResult {
  savedAt: number;
  result: SpeakingChallengeClassResult;
}

// v6 drops cached Chinese fallbacks for English names with Chinese qualifiers.
const SPEAKING_CLASS_CACHE_PREFIX = 'amber_speaking_class_cache:v6';
const SPEAKING_CLASS_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

const DEFAULT_REWARD_CONFIG: SpeakingRewardConfig = {
  basePerDay: 0.1,
  streakThreshold: 3,
  streakMultiplier: 1,
  rewardMode: 'fixed',
  thresholdBonus: 0,
  ignoreSupplementVariance: false,
};

const DEFAULT_REWARD_SELECTION: SpeakingRewardSelection = {
  baseStrategy: 'unissued',
  includeStreak: true,
  missedBasePerDay: 0.1,
};

function issuedDateStrategySummary(strategy: SpeakingRewardSelection['baseStrategy']): string {
  if (strategy === 'repeat') return '已发日期再发一次';
  if (strategy === 'unissued') return '已发日期只补漏发';
  return '已发日期跳过基础奖励';
}

function speakingClassCacheKey(teacherName: string, classCode: string): string {
  const teacher = String(teacherName || 'current-teacher').trim().toLowerCase();
  return `${SPEAKING_CLASS_CACHE_PREFIX}:${encodeURIComponent(teacher)}:${classCode}`;
}

function readCachedSpeakingClass(teacherName: string, classCode: string): SpeakingChallengeClassResult | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(speakingClassCacheKey(teacherName, classCode)) || 'null') as CachedSpeakingClassResult | null;
    if (!parsed?.result?.leaderboard || !Number.isFinite(parsed.savedAt)) return null;
    if (Date.now() - parsed.savedAt > SPEAKING_CLASS_CACHE_MAX_AGE_MS) return null;
    if (String(parsed.result.leaderboard.classCode || '').toUpperCase() !== classCode) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

function saveCachedSpeakingClass(teacherName: string, classCode: string, result: SpeakingChallengeClassResult) {
  try {
    localStorage.setItem(speakingClassCacheKey(teacherName, classCode), JSON.stringify({
      savedAt: Date.now(),
      result,
    } satisfies CachedSpeakingClassResult));
  } catch {}
}

function roundOne(value: number): number {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function formatMp(value: number | null | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '—';
}

function formatBaseRateRange(values: number[]): string {
  const normalized = [...new Set(values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map(roundOne))].sort((left, right) => left - right);
  if (!normalized.length) return '此前未发基础奖励';
  if (normalized.length === 1) return `${formatMp(normalized[0])} MP/有效日`;
  return `${formatMp(normalized[0])}—${formatMp(normalized[normalized.length - 1])} MP/有效日`;
}

function streakConfigSummary(config: SpeakingRewardConfig): string {
  return config.rewardMode === 'fixed'
    ? `${config.streakThreshold} 天后额外 ${formatMp(config.thresholdBonus)} MP`
    : `${config.streakThreshold} 天后 ${config.streakMultiplier} 倍`;
}

function rewardConfigChanges(previous: SpeakingRewardConfig, current: SpeakingRewardConfig): string[] {
  const changes: string[] = [];
  if (roundOne(previous.basePerDay) !== roundOne(current.basePerDay)) {
    changes.push(`每日奖励 ${formatMp(previous.basePerDay)} → ${formatMp(current.basePerDay)} MP`);
  }
  if (previous.streakThreshold !== current.streakThreshold
    || previous.rewardMode !== current.rewardMode
    || (current.rewardMode === 'fixed'
      ? roundOne(previous.thresholdBonus) !== roundOne(current.thresholdBonus)
      : roundOne(previous.streakMultiplier) !== roundOne(current.streakMultiplier))) {
    changes.push(`连续奖励“${streakConfigSummary(previous)}”→“${streakConfigSummary(current)}”`);
  }
  if (previous.ignoreSupplementVariance !== current.ignoreSupplementVariance) {
    changes.push(current.ignoreSupplementVariance ? '补卡改为按正常打卡计算' : '补卡改为单独计算');
  }
  return changes;
}

function formatPeriodDate(value: string): string {
  const [, month, day] = String(value || '').split('-').map(Number);
  return month && day ? `${month}月${day}日` : value;
}

function dateHeader(value: string): { day: string; weekday: string } {
  const [, month, day] = value.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(new Date(`${value}T12:00:00+08:00`));
  return { day: `${month}/${day}`, weekday };
}

function currentDayInShanghai(): DayOfWeek {
  const value = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(new Date());
  const normalized = value === '周天' ? '周日' : value;
  return (['周一', '周二', '周三', '周四', '周五', '周六', '周日'].includes(normalized)
    ? normalized
    : '周一') as DayOfWeek;
}

function studentDayStatus(student: SpeakingChallengeStudent, date: string, availableDates: Set<string>) {
  if (!availableDates.has(date)) return 'future';
  return student.daily.find((day) => day.date === date)?.status || 'missed';
}

function applySupplementVariancePolicy(
  source: SpeakingLeaderboard,
  ignoreSupplementVariance: boolean,
): SpeakingLeaderboard {
  if (!ignoreSupplementVariance) return source;
  const students = source.students.map((student) => {
    let completedDays = 0;
    let runningStreak = 0;
    let longestStreak = 0;
    const daily = student.daily.map((day) => {
      const completed = day.status === 'normal' || day.status === 'supplement';
      if (completed) {
        completedDays += 1;
        runningStreak += 1;
        longestStreak = Math.max(longestStreak, runningStreak);
      } else {
        runningStreak = 0;
      }
      return { ...day, status: day.status === 'supplement' ? 'normal' as const : day.status };
    });
    return {
      ...student,
      daily,
      normalDays: completedDays,
      supplementDays: 0,
      totalDays: completedDays,
      streakDays: longestStreak,
    };
  }).sort((left, right) => right.streakDays - left.streakDays
    || right.totalDays - left.totalDays
    || left.englishName.localeCompare(right.englishName, 'en', { numeric: true, sensitivity: 'base' }));

  let lastRank = 0;
  const rankedStudents = students.map((student, index) => {
    const previous = students[index - 1];
    if (!previous
      || student.streakDays !== previous.streakDays
      || student.totalDays !== previous.totalDays) {
      lastRank = index + 1;
    }
    return { ...student, rank: lastRank };
  });

  return {
    ...source,
    totalStudents: rankedStudents.length,
    activeStudents: rankedStudents.filter((student) => student.totalDays > 0).length,
    threeDayStudents: rankedStudents.filter((student) => student.streakDays >= 3).length,
    maxStreak: rankedStudents.reduce((maximum, student) => Math.max(maximum, student.streakDays), 0),
    students: rankedStudents,
  };
}

function formatDataCutoff(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '数据统计截至本次更新';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `数据统计截至 ${Number(values.month)}月${Number(values.day)}日 ${values.hour}:${values.minute}（北京时间）`;
}

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function formatSelectedDates(dates: string[]): string {
  if (!dates.length) return '暂无待结算日期';
  if (dates.length === 1) return formatPeriodDate(dates[0]);
  return `${formatPeriodDate(dates[0])}—${formatPeriodDate(dates[dates.length - 1])}`;
}

function formatSelectedDateRanges(dates: string[]): string {
  if (!dates.length) return '暂无待结算日期';
  const ordered = [...dates].sort();
  const ranges: Array<[string, string]> = [];
  let start = ordered[0];
  let end = ordered[0];
  ordered.slice(1).forEach((date) => {
    const previousTime = Date.parse(`${end}T00:00:00Z`);
    const currentTime = Date.parse(`${date}T00:00:00Z`);
    if (currentTime - previousTime === 24 * 60 * 60 * 1000) {
      end = date;
      return;
    }
    ranges.push([start, end]);
    start = date;
    end = date;
  });
  ranges.push([start, end]);
  return ranges.map(([rangeStart, rangeEnd]) => rangeStart === rangeEnd
    ? formatPeriodDate(rangeStart)
    : `${formatPeriodDate(rangeStart)}—${formatPeriodDate(rangeEnd)}`).join('、');
}

function posterStudentKey(student: SpeakingChallengeStudent, index: number): string {
  return student.studentKey || student.studentId || `${student.chineseName}:${student.englishName}:${index}`;
}

async function waitForScoreboardAssets(root: HTMLElement): Promise<void> {
  const fontSet = document.fonts;
  if (fontSet) {
    await Promise.race([
      Promise.all([
        fontSet.load('16px "得意黑"', '每日开口挑战榜'),
        fontSet.load('16px "Smiley Sans"', 'DAILY SPEAKING CHALLENGE'),
        fontSet.ready,
      ]),
      new Promise<never>((_, reject) => window.setTimeout(
        () => reject(new Error('得意黑字体加载超时，请稍后重试导出。')),
        8000,
      )),
    ]);
  }

  const pendingImages = Array.from(root.querySelectorAll('img')).filter((image) => !image.complete);
  await Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
    const finish = () => resolve();
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    window.setTimeout(finish, 4000);
  })));
}

function rankPresentationStudents(students: SpeakingChallengeStudent[]): SpeakingChallengeStudent[] {
  const ordered = [...students].sort((left, right) => right.streakDays - left.streakDays
    || right.totalDays - left.totalDays
    || left.supplementDays - right.supplementDays
    || left.englishName.localeCompare(right.englishName, 'en', { numeric: true, sensitivity: 'base' })
    || left.chineseName.localeCompare(right.chineseName, 'zh-CN'));
  let lastRank = 0;
  return ordered.map((student, index) => {
    const previous = ordered[index - 1];
    if (!previous
      || student.streakDays !== previous.streakDays
      || student.totalDays !== previous.totalDays
      || student.supplementDays !== previous.supplementDays) {
      lastRank = index + 1;
    }
    return { ...student, rank: lastRank };
  });
}

function PendingRewardRecovery({ code, recovery, onResolved }: {
  code: string; recovery: SpeakingPendingRecovery; onResolved: (result: SpeakingPendingResolution) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  async function resolve(action: 'check' | 'defer' | 'retry') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await resolveSpeakingPending(code, recovery.planId, action, acknowledged);
      setAcknowledged(false);
      await onResolved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '旧单处理失败，请重试');
    } finally { setBusy(false); }
  }
  return <section className="speaking-pending-recovery" aria-label="上次发放处理" aria-busy={busy}>
    <strong>{recovery.deferred ? '旧单已暂缓，可继续其他日期' : '上次发放尚未全部确认，已停止发放尝试'}</strong>
    <p>{formatSelectedDates(recovery.selectedDates)} · 已核实到账 {recovery.confirmedCount} 人 / {formatMp(recovery.confirmedTotalMP)} MP，剩余 {recovery.unresolvedCount} 人 / {formatMp(recovery.totalMP)} MP 待核对。</p>
    <p>未匹配到流水不等于未到账。核对后可以生成补发清单，也可以暂缓旧单，继续其他日期的奖励。</p>
    {recovery.lastError && <p role="status">上次返回：{recovery.lastError}</p>}
    <details><summary>查看待核对名单（{recovery.unresolvedCount} 人）</summary><ul>{recovery.students.map((student, index) => <li key={index}>{student.name} · {formatMp(student.amount)} MP</li>)}</ul></details>
    <div className="speaking-pending-recovery__actions">
      <button type="button" disabled={busy} onClick={() => void resolve('check')}>重新核对到账</button>
      {!recovery.deferred && <button type="button" disabled={busy} onClick={() => void resolve('defer')}>暂缓旧单，继续其他日期</button>}
    </div>
    <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />我已在教务系统核对，确认剩余名单未到账</label>
    <button type="button" disabled={busy || !acknowledged} onClick={() => void resolve('retry')}>生成剩余部分的补发清单</button>
    <small>生成清单后还需核对人数、金额和余额并确认，才会实际发放。</small>
    {busy && <p role="status">正在处理旧单，请稍候…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function SpeakingClassBoard({
  code,
  entry,
  teacherName,
  todayLabel,
  isToday,
  config,
  selection,
  selectedDates,
  previewBusy,
  notice,
  onReload,
  onRecovery,
  onUpdateConfig,
  onUpdateSelection,
  onToggleDate,
  onSelectDates,
  onPreview,
}: ClassBoardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showHistoryDates, setShowHistoryDates] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [reportRange, setReportRange] = useState<{ start: string; end: string } | null>(null);
  const [sort, setSort] = useState<SpeakingSort>('rank');
  const [posterEditorOpen, setPosterEditorOpen] = useState(false);
  const [posterEdits, setPosterEdits] = useState<Record<string, PosterStudentEdit>>({});
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const scoreboardRef = useRef<HTMLElement | null>(null);
  const posterEditStorageKey = `amber_speaking_poster_edits:${code}`;

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(posterEditStorageKey) || '{}');
      setPosterEdits(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setPosterEdits({});
    }
  }, [posterEditStorageKey]);

  function updatePosterEdit(studentKey: string, patch: Partial<PosterStudentEdit>) {
    setPosterEdits((current) => {
      const next = {
        ...current,
        [studentKey]: {
          displayName: current[studentKey]?.displayName || '',
          hidden: current[studentKey]?.hidden || false,
          ...patch,
        },
      };
      try { localStorage.setItem(posterEditStorageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function resetPosterEdits() {
    setPosterEdits({});
    try { localStorage.removeItem(posterEditStorageKey); } catch {}
  }

  async function handlePosterExport() {
    if (!scoreboardRef.current || exportBusy || entry?.status !== 'ready') return;
    setExportBusy(true);
    setExportNotice('正在等待字体与最新榜单就绪…');
    const scoreboard = scoreboardRef.current;
    try {
      await waitForScoreboardAssets(scoreboard);
      scoreboard.classList.add('is-exporting');
      setExportNotice('正在生成高清挑战榜图片…');
      const blob = await requestExportImageBlob(scoreboard);
      const message = await deliverExportImageBlob(blob, `${code}每日开口挑战榜${reportRange ? `_${reportRange.start}_${reportRange.end}` : ''}`);
      setExportNotice(message.split('座位表').join('挑战榜'));
    } catch (error) {
      setExportNotice(error instanceof Error ? error.message : '挑战榜图片生成失败，请稍后重试。');
    } finally {
      scoreboard.classList.remove('is-exporting');
      setExportBusy(false);
    }
  }

  if (!entry || (entry.status === 'loading' && !entry.result)) {
    return (
      <section className="speaking-challenge__detail" aria-live="polite">
        <div className="speaking-challenge__loading-card">
          <span className="speaking-challenge__loader" />
          <strong>正在读取 {code} 的每日开口榜…</strong>
          <small>今天的班级优先读取，其他班级不会占用等待时间。</small>
        </div>
      </section>
    );
  }

  if (entry.status === 'error' && !entry.result) {
    return (
      <section className="speaking-challenge__detail" aria-live="polite">
        <div className="speaking-challenge__error-card">
          <div><strong>{code} 暂时没读取成功</strong><p>{entry.error}</p></div>
          <button type="button" onClick={onReload}>重新读取</button>
        </div>
      </section>
    );
  }

  const result = entry.result;
  if (!result) return null;
  const sourceLeaderboard = applySupplementVariancePolicy(
    result.leaderboard,
    config.ignoreSupplementVariance,
  );
  const presentationStudents = rankPresentationStudents(sourceLeaderboard.students.flatMap((student, index) => {
    const edit = posterEdits[posterStudentKey(student, index)];
    if (edit?.hidden) return [];
    return [{
      ...(reportRange ? speakingStudentInRange(student, reportRange.start, reportRange.end) : student),
      englishName: edit?.displayName.trim() || student.englishName,
    }];
  }));
  const leaderboard = {
    ...sourceLeaderboard,
    students: presentationStudents,
    totalStudents: presentationStudents.length,
    activeStudents: presentationStudents.filter((student) => student.totalDays > 0).length,
    threeDayStudents: presentationStudents.filter((student) => student.streakDays >= 3).length,
    maxStreak: presentationStudents.reduce((maximum, student) => Math.max(maximum, student.streakDays), 0),
  };
  const challenge = leaderboard.challenge;
  const dateWindow = speakingVisibleDates(challenge.dates, showHistoryDates);
  const reportStart = reportRange?.start || dateWindow.start;
  const reportEnd = reportRange?.end || dateWindow.end;
  const metricLabel = reportRange ? '区间' : '本周';
  const fullDates = reportRange ? settlementDatesInRange(challenge.dates, reportStart, reportEnd) : dateWindow.calendarDates;
  const sortedStudents = sortSpeakingStudents(leaderboard.students, sort, reportStart, reportEnd);
  const rangeDates = settlementDatesInRange(challenge.dates, rangeStart, rangeEnd);
  const canGenerateReport = rangeDates.length > 0 && rangeStart >= challenge.start && rangeEnd <= challenge.end;
  const availableDates = new Set(challenge.dates);
  const selectedIssuedDates = selectedDates.filter((date) => result.rewardState.issuedDates.includes(date));
  const selectedUnissuedDates = selectedDates.filter((date) => !result.rewardState.issuedDates.includes(date));
  const selectedIssuedBaseRates = selectedIssuedDates.flatMap((date) => {
    const value = Number(result.rewardState.issuedBasePerDayByDate?.[date]);
    return Number.isFinite(value) && value >= 0 ? [value] : [];
  });
  const issuedBaseRateRange = formatBaseRateRange(selectedIssuedBaseRates);
  const missedBaseRewardValue = roundOne(Number.isFinite(selection.missedBasePerDay)
    ? Number(selection.missedBasePerDay)
    : selectedIssuedBaseRates.length === 1
      ? selectedIssuedBaseRates[0]
      : DEFAULT_REWARD_SELECTION.missedBasePerDay || 0.1);
  const changedConfigItems = selectedIssuedDates.length > 0
    ? rewardConfigChanges(result.rewardState.config, config)
    : [];
  const selectedIssuedRateDiffers = selectedIssuedBaseRates
    .some((value) => roundOne(value) !== roundOne(
      selection.baseStrategy === 'unissued' ? missedBaseRewardValue : config.basePerDay,
    ));
  if (selectedIssuedRateDiffers
    && selection.baseStrategy === 'unissued') {
    changedConfigItems.unshift(
      `补卡金额不同：这些已发日期原发 ${issuedBaseRateRange}，本次补卡 ${formatMp(missedBaseRewardValue)} MP/有效日`,
    );
  } else if (selectedIssuedRateDiffers
    && !changedConfigItems.some((item) => item.startsWith('每日奖励'))) {
    changedConfigItems.unshift(
      `已选已发日期原金额 ${issuedBaseRateRange}，当前每日奖励 ${formatMp(config.basePerDay)} MP`,
    );
  }
  const selectedDateRuleSummary = selectedIssuedDates.length === 0
    ? `${selectedDates.length} 天 · 按当前设置正常发放`
    : selectedUnissuedDates.length === 0
      ? `${selectedIssuedDates.length} 天已发 · ${issuedDateStrategySummary(selection.baseStrategy)}`
      : `${selectedUnissuedDates.length} 天正常发放 · ${selectedIssuedDates.length} 天已发另行处理`;
  const detailIntro = selectedIssuedDates.length === 0
    ? {
      title: '当前选中的日期均未发过，可按当前设置直接发放',
      body: '这里只设置本次正常发放的日期和奖励规则，确认后会生成清晰的发放清单。',
    }
    : selectedUnissuedDates.length === 0
      ? {
        title: '当前选中的日期均已发过，请确认处理方式',
        body: '基础奖励可以跳过、只处理漏发，或明确再发一次；连续奖励仍会防止重复发放。',
      }
      : {
        title: '当前同时选中了未发日期和已发日期',
        body: '未发日期按默认规则正常发放；已发日期的基础奖励在下方单独处理。',
      };
  const streakScopeCopy = selectedIssuedDates.length === 0
    ? '符合连续规则的学生将按奖励设置正常发放。'
    : selectedUnissuedDates.length === 0
      ? '只处理这些已发日期中尚未领取的连续奖励，不会重复。'
      : '未发日期正常发放；已发日期只处理尚未领取的连续奖励。';
  const streakRuleCopy = config.rewardMode === 'multiplier'
    ? `连续达到 ${config.streakThreshold} 天后，从达标当天起每天按 ${config.streakMultiplier} 倍发放连续奖励；`
    : `首次连续达到 ${config.streakThreshold} 天时额外发放 ${formatMp(config.thresholdBonus)} MP；`;
  // Daily base reward applies to this settlement. Previous settlements are
  // protected by the dated reward ledger and must not lock future controls.
  const baseRewardLocked = result.rewardState.pending;
  const baseRewardValue = roundOne(config.basePerDay);
  const updateBaseReward = (nextValue: number) => {
    onUpdateConfig('basePerDay', Math.min(2, Math.max(0, roundOne(nextValue))));
  };
  const updateMissedBaseReward = (nextValue: number) => {
    onUpdateSelection({
      ...selection,
      missedBasePerDay: Math.min(2, Math.max(0, roundOne(nextValue))),
    });
  };
  const toggleStreakOnly = () => {
    if (baseRewardValue === 0) {
      updateBaseReward(DEFAULT_REWARD_CONFIG.basePerDay);
      return;
    }
    updateBaseReward(0);
    setDetailsOpen(true);
  };
  const honorGroups = [1]
    .map((rank) => ({
      rank,
      students: leaderboard.students
        .filter((student) => student.rank === rank)
        .sort((left, right) => left.englishName.localeCompare(right.englishName, 'en', { sensitivity: 'base' })),
    }))
    .filter((group) => group.students.length > 0);

  return (
    <section className="speaking-challenge__detail" aria-live="polite">
      <section className="speaking-controls">
        <div className="speaking-controls-heading">
          <div><span>{isToday ? `${todayLabel}上课 · 当前班级` : '当前班级'}</span><strong>{code} · 每日开口</strong></div>
          <div className="speaking-controls-meta"><small>累计已发 {formatMp(result.rewardState.issuedTotal)} MP</small><button type="button" disabled={entry.status === 'loading'} onClick={onReload}>{entry.status === 'loading' ? '更新中…' : '更新数据'}</button></div>
        </div>
        <div className="speaking-controls-overview">
          <div className="speaking-challenge__quick-date"><span>日期选择</span><strong>{formatSelectedDateRanges(selectedDates)}</strong><small>发放日期 · {selectedDateRuleSummary}</small><small>榜单日期 · {formatPeriodDate(reportStart)}—{formatPeriodDate(reportEnd)}</small></div>
          <div><span>MiniPin 发放</span><strong>{baseRewardValue === 0 ? selection.includeStreak ? '仅连续奖励' : '本次不发奖励' : `${formatMp(baseRewardValue)} MP / 有效日`}</strong><small>{selection.includeStreak ? streakConfigSummary(config) : '不含连续奖励'}</small><small>{config.ignoreSupplementVariance ? '补卡按正常完成统计' : '区分正常打卡与补卡'}</small></div>
        </div>
        <div className="speaking-controls-actions">
          <button type="button" className="speaking-controls-edit" aria-expanded={detailsOpen} aria-controls={`speaking-settings-${code}`} onClick={() => setDetailsOpen(open => !open)}>{detailsOpen ? '完成编辑' : '编辑日期与奖励'}</button>
          <button
            type="button"
            className="speaking-challenge__preview-button"
            disabled={previewBusy || entry.status !== 'ready' || result.rewardState.pending || selectedDates.length === 0}
            onClick={onPreview}
          >
            {previewBusy ? '正在计算…' : entry.status !== 'ready' ? '最新数据就绪后可发放' : '预览并发放'}
          </button>
        </div>
        {entry.status === 'loading' && entry.result && (
          <div className="speaking-challenge__stale-notice" role="status">
            <span aria-hidden="true">↻</span>
            <div><strong>已先显示上次榜单</strong><small>{formatDataCutoff(result.updatedAt)}，最新数据正在后台同步，完成后会自动覆盖。</small></div>
          </div>
        )}
        {entry.status === 'error' && entry.result && (
          <div className="speaking-challenge__stale-notice is-error" role="status">
            <span aria-hidden="true">!</span>
            <div><strong>当前显示上次榜单</strong><small>本次更新没有成功，可继续查看；为避免数据错误，暂时不能发放奖励。</small></div>
          </div>
        )}
        {detailsOpen && (
          <div className="speaking-controls-editor" id={`speaking-settings-${code}`}>
            <div className="speaking-controls-editor-title"><strong>日期与奖励设置</strong><small>修改后可预览发放清单；确认清单才会发放。</small></div>
            <div className="speaking-controls-grid">
              <section className="speaking-challenge__rule-card is-dates">
                <header><b>1</b><div><strong>日期选择</strong><small>{selectedIssuedDates.length === 0
                  ? '当前选中的日期均未发过，将按当前设置正常发放。'
                  : selectedUnissuedDates.length === 0
                    ? '当前选中的日期均已发过，请在下方确认处理方式。'
                    : '当前同时包含未发和已发日期，两类日期将分别处理。'}</small></div></header>
                <div className="speaking-challenge__date-range">
                  <label>开始日期<input type="date" aria-label="开始日期" min={challenge.start} max={challenge.end} value={rangeStart} onChange={event => setRangeStart(event.target.value)} /></label>
                  <label>结束日期<input type="date" aria-label="结束日期" min={rangeStart || challenge.start} max={challenge.end} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} /></label>
                  <button type="button" disabled={!rangeDates.length} onClick={() => { onSelectDates(rangeDates); if (rangeDates.some(date => date < dateWindow.start)) setShowHistoryDates(true); }}>用于奖励发放</button>
                  <button type="button" className="speaking-challenge__generate-report" disabled={!canGenerateReport || exportBusy || entry.status !== 'ready'} onClick={() => {
                    setReportRange({ start: rangeStart, end: rangeEnd });
                    setExportNotice('');
                  }}>按日期生成</button>
                </div>
                {rangeStart && rangeEnd && rangeStart > rangeEnd && <p role="alert">结束日期不能早于开始日期。</p>}
                <small className="speaking-challenge__range-hint">点「用于奖励发放」选择结算日期，可逐日微调；点「按日期生成」更新榜单和导出图片。</small>
                {reportRange && (rangeStart !== reportRange.start || rangeEnd !== reportRange.end) && <small className="speaking-challenge__range-hint" role="status">日期已修改，请点击「按日期生成」更新榜单。</small>}
                {dateWindow.weeks.map(week => <div className="speaking-challenge__calendar-week" key={week[0]}>
                  <small>{week[0] === dateWindow.start ? '本周' : '历史周'} · {formatPeriodDate(week[0])}—{formatPeriodDate(week[6])}</small>
                  <div className="speaking-challenge__date-chips">
                    {week.map((date) => {
                      const issued = result.rewardState.issuedDates.includes(date);
                      const checked = selectedDates.includes(date);
                      const available = availableDates.has(date);
                      return (
                        <label key={date} className={`${checked ? 'is-selected' : ''}${issued ? ' is-issued' : ''}${!available ? ' is-unavailable' : ''}`}>
                          <input type="checkbox" aria-label={`结算 ${date}`} disabled={!available} checked={checked && available} onChange={() => onToggleDate(date)} />
                          <span>{dateHeader(date).day}</span>
                          <small>{dateHeader(date).weekday}</small>
                          {issued && <small>已发</small>}
                        </label>
                      );
                    })}
                  </div>
                </div>)}
                {dateWindow.history.length > 0 && <button type="button" className="speaking-date-history" onClick={() => setShowHistoryDates(value => !value)}>{showHistoryDates ? '收起历史日期' : `展开历史日期 · ${dateWindow.history.length} 天`}</button>}
              </section>
              <section className="speaking-challenge__rule-card is-rewards">
                <header><b>2</b><div><strong>MiniPin 发放</strong><small>设置每日金额、连续奖励和已发日期的处理方式。</small></div></header>
          <label className="speaking-challenge__base-reward">
            <span>每个有效打卡日</span>
            <div className="speaking-challenge__base-reward-row">
              <div className="speaking-challenge__reward-stepper">
                <button type="button" aria-label="每日奖励减少 0.1 MP" disabled={baseRewardLocked || baseRewardValue <= 0} onClick={() => updateBaseReward(baseRewardValue - 0.1)}>−</button>
                <input aria-label="每个有效打卡日奖励" type="number" inputMode="decimal" min="0" max="2" step="0.1" value={config.basePerDay} disabled={baseRewardLocked} onChange={(event) => updateBaseReward(Number(event.target.value))} />
                <button type="button" aria-label="每日奖励增加 0.1 MP" disabled={baseRewardLocked || baseRewardValue >= 2} onClick={() => updateBaseReward(baseRewardValue + 0.1)}>＋</button>
              </div>
              <b>MP</b>
              <button
                type="button"
                className={`speaking-challenge__streak-only${baseRewardValue === 0 ? ' is-active' : ''}`}
                disabled={baseRewardLocked}
                onClick={toggleStreakOnly}
              >
                {baseRewardValue === 0 ? '恢复每日 0.1' : '仅发连续奖励'}
              </button>
            </div>
          </label>
                <h3 className="speaking-controls-subheading">连续打卡奖励</h3>{result.rewardState.streakConfigLocked && <small>连续奖励规则已锁定，每日奖励金额仍可调整。</small>}
                <div className="speaking-challenge__advanced-grid">
                  <label>
                    <span>连续达到</span>
                    <div><input type="number" min="2" max="14" step="1" value={config.streakThreshold} disabled={result.rewardState.streakConfigLocked} onChange={(event) => onUpdateConfig('streakThreshold', Number(event.target.value))} /><b>天</b></div>
                  </label>
                  <div className="speaking-challenge__reward-mode">
                    <span>奖励方式</span>
                    <div>
                      <button type="button" className={config.rewardMode === 'fixed' ? 'is-active' : ''} disabled={result.rewardState.streakConfigLocked} onClick={() => onUpdateConfig('rewardMode', 'fixed')}>指定数量</button>
                      <button type="button" className={config.rewardMode === 'multiplier' ? 'is-active' : ''} disabled={result.rewardState.streakConfigLocked} onClick={() => onUpdateConfig('rewardMode', 'multiplier')}>奖励系数</button>
                    </div>
                  </div>
                  {config.rewardMode === 'multiplier' ? (
                    <label>
                      <span>达标后每天</span>
                      <div><input type="number" min="1" max="3" step="0.1" value={config.streakMultiplier} disabled={result.rewardState.streakConfigLocked} onChange={(event) => onUpdateConfig('streakMultiplier', Number(event.target.value))} /><b>倍</b></div>
                    </label>
                  ) : (
                    <label>
                      <span>达标当天额外发</span>
                      <div><input type="number" min="0" max="20" step="0.1" value={config.thresholdBonus} disabled={result.rewardState.streakConfigLocked} onChange={(event) => onUpdateConfig('thresholdBonus', Number(event.target.value))} /><b>MP</b></div>
                    </label>
                  )}
                </div>
                <label className={`speaking-challenge__streak-scope${selection.includeStreak ? ' is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selection.includeStreak}
                    onChange={(event) => onUpdateSelection({ ...selection, includeStreak: event.target.checked })}
                  />
                  <span><strong>本次包含连续打卡奖励</strong><small>{streakScopeCopy}</small></span>
                </label>
        <div className={`speaking-challenge__supplement-policy${config.ignoreSupplementVariance ? ' is-enabled' : ''}${result.rewardState.streakConfigLocked ? ' is-locked' : ''}`}>
          <div>
            <span>特殊统计口径</span>
            <strong>是否忽略补卡误差</strong>
            <small>开启后，补卡按正常完成计入连续天数、榜单排名和 MiniPin 奖励。</small>
          </div>
          <label>
            <input
              type="checkbox"
              aria-label="忽略补卡误差"
              checked={config.ignoreSupplementVariance}
              disabled={result.rewardState.streakConfigLocked}
              onChange={(event) => onUpdateConfig('ignoreSupplementVariance', event.target.checked)}
            />
            <i aria-hidden="true"><b /></i>
            <em>{result.rewardState.streakConfigLocked
              ? config.ignoreSupplementVariance ? '已忽略误差 · 已锁定' : '区分补卡 · 已锁定'
              : config.ignoreSupplementVariance ? '已忽略误差' : '区分正常与补卡'}</em>
          </label>
        </div>
                <div className="speaking-challenge__reward-details-intro"><strong>{detailIntro.title}</strong><p>{detailIntro.body}</p></div>
                {selectedIssuedDates.length > 0 && (
                  <div className="speaking-challenge__issue-scope has-issued-dates">
                    <div className="speaking-challenge__issued-date-alert" role="status">
                      <strong>{selectedUnissuedDates.length > 0
                        ? `混合选择：${selectedUnissuedDates.length} 天未发、${selectedIssuedDates.length} 天已发`
                        : `本次只选了 ${selectedIssuedDates.length} 天已发日期`}</strong>
                      <span>{selectedUnissuedDates.length > 0
                        ? '未发日期照常结算；下面只处理已发日期。'
                        : '请选择这些已发日期的处理方式。'}</span>
                    </div>
                    <div className="speaking-challenge__scope-heading">
                      <span>已发日期的基础奖励</span>
                      <small>可跳过；选择时两项互斥</small>
                    </div>
                    <div className="speaking-challenge__scope-options" role="group" aria-label="已发日期的基础奖励处理方式">
                      <label className={selection.baseStrategy === 'repeat' ? 'is-active is-warning' : ''}>
                        <input
                          type="checkbox"
                          checked={selection.baseStrategy === 'repeat'}
                          onChange={(event) => onUpdateSelection({
                            ...selection,
                            baseStrategy: event.target.checked ? 'repeat' : 'none',
                          })}
                        />
                        <span><strong>这些日期再发一次</strong><small>已领过的学生也会再次领取，仅作用于上方已发日期。</small></span>
                      </label>
                      <label className={selection.baseStrategy === 'unissued' ? 'is-active' : ''}>
                        <input
                          type="checkbox"
                          checked={selection.baseStrategy === 'unissued'}
                          onChange={(event) => onUpdateSelection({
                            ...selection,
                            baseStrategy: event.target.checked ? 'unissued' : 'none',
                          })}
                        />
                        <span><strong>只补这些日期的漏发</strong><small>只发给后来新增打卡或上次遗漏的学生，不重复。</small></span>
                      </label>
                    </div>
                    {selection.baseStrategy === 'none' && (
                      <div className="speaking-challenge__base-scope-empty" role="status">
                        已发日期不再发基础奖励{selectedUnissuedDates.length > 0
                          ? '，未发日期仍按当前设置正常发放。'
                          : selection.includeStreak
                            ? '；本次只结算连续打卡奖励。'
                            : '；本次不会发放任何奖励。'}
                      </div>
                    )}
                  </div>
                )}
        {selectedDates.length > 0 && (
          <div className="speaking-challenge__date-rate-summary" aria-label="所选日期 MiniPin 发放金额">
            {selectedIssuedDates.length > 0 && (
              <div className={`speaking-challenge__date-rate-line is-issued${selectedIssuedRateDiffers ? ' has-change' : ''}`}>
                <div className="speaking-challenge__date-rate-name">
                  <strong>{selection.baseStrategy === 'unissued'
                    ? '补发日期'
                    : selection.baseStrategy === 'repeat'
                      ? '再次发放日期'
                      : '已发日期'}</strong>
                  <small>{formatSelectedDateRanges(selectedIssuedDates)} · 原发 {issuedBaseRateRange}</small>
                </div>
                <div className="speaking-challenge__date-rate-value">
                  {selection.baseStrategy === 'unissued' ? (
                    <div className="speaking-challenge__makeup-rate-row">
                      <button
                        type="button"
                        aria-label="补卡奖励减少 0.1 MP"
                        disabled={baseRewardLocked || missedBaseRewardValue <= 0}
                        onClick={() => updateMissedBaseReward(missedBaseRewardValue - 0.1)}
                      >−</button>
                      <strong>{formatMp(missedBaseRewardValue)}</strong>
                      <b>MP</b>
                      <button
                        type="button"
                        aria-label="补卡奖励增加 0.1 MP"
                        disabled={baseRewardLocked || missedBaseRewardValue >= 2}
                        onClick={() => updateMissedBaseReward(missedBaseRewardValue + 0.1)}
                      >＋</button>
                    </div>
                  ) : selection.baseStrategy === 'repeat' ? (
                    <strong>{formatMp(baseRewardValue)} MP</strong>
                  ) : (
                    <strong className="is-skipped">本次跳过</strong>
                  )}
                  <small>{selection.baseStrategy === 'unissued'
                    ? '每个有效日 · 只给漏发学生'
                    : selection.baseStrategy === 'repeat'
                      ? '每个有效日 · 已领学生也会再领一次'
                      : '不再发放基础奖励'}</small>
                </div>
                {changedConfigItems.length > 0 && (
                  <div className="speaking-challenge__date-rate-change" role="status">
                    <strong>与上次不同，请核对</strong>
                    <span>{changedConfigItems.join('；')}</span>
                  </div>
                )}
              </div>
            )}
            {selectedUnissuedDates.length > 0 && (
              <div className="speaking-challenge__date-rate-line is-unissued">
                <div className="speaking-challenge__date-rate-name">
                  <strong>新增日期</strong>
                  <small>{formatSelectedDateRanges(selectedUnissuedDates)} · 正常首次发放</small>
                </div>
                <div className="speaking-challenge__date-rate-value">
                  <strong>{formatMp(baseRewardValue)} MP</strong>
                  <small>每个有效日</small>
                </div>
              </div>
            )}
          </div>
        )}
              </section>
            </div>
            <div className="speaking-challenge__rule-summary">
              <div className="speaking-challenge__formula">
                <strong>本次规则</strong>
                <span>{selectedUnissuedDates.length > 0
                  ? `${selectedUnissuedDates.length} 天未发日期按当前设置发基础奖励；`
                  : ''}
                  {selectedIssuedDates.length > 0
                    ? selection.baseStrategy === 'repeat'
                      ? `${selectedIssuedDates.length} 天已发日期明确再发一次；`
                      : selection.baseStrategy === 'unissued'
                        ? `${selectedIssuedDates.length} 天已发日期只补漏发，每个有效日 ${formatMp(missedBaseRewardValue)} MP；`
                        : `${selectedIssuedDates.length} 天已发日期跳过基础奖励；`
                    : ''}
                  {selection.includeStreak
                    ? `${streakRuleCopy}${selectedIssuedDates.length > 0
                      ? selectedUnissuedDates.length > 0
                        ? '未发日期正常发放，已发日期仅处理尚未领取部分；'
                        : '已发日期仅处理尚未领取部分；'
                      : ''}`
                    : '本次不发连续奖励；'}
                  {config.ignoreSupplementVariance ? '补卡按正常完成计入连续。' : '补卡只领基础奖励。'}</span>
              </div>
              <div className="speaking-challenge__teacher-chip">
                <span aria-hidden="true">👤</span><span>发放账号</span><strong>{teacherName || '当前登录老师'}</strong>
              </div>
            </div>
          </div>
        )}
        {!result.rewardState.recovery && result.rewardState.recoveryMessage && <p className="speaking-challenge__notice is-success" role="status">{result.rewardState.recoveryMessage}</p>}
        {result.rewardState.recovery
          ? <PendingRewardRecovery key={`${result.rewardState.recovery.planId}:${result.rewardState.recovery.unresolvedCount}`} code={code} recovery={result.rewardState.recovery} onResolved={onRecovery} />
          : result.rewardState.pending && <div className="speaking-challenge__pending-warning">{result.rewardState.pendingMessage}<button type="button" onClick={onReload}>读取旧单处理选项</button></div>}
        {!!result.rewardState.deferredDates?.length && <p className="speaking-challenge__pending-warning">暂缓旧单涉及 {formatSelectedDates(result.rewardState.deferredDates)}，这些日期会从新清单中排除，核清旧单后可恢复。</p>}
        {notice && <div className={`speaking-challenge__notice is-${notice.kind}`}>{notice.text}</div>}
      </section>

      <div className="speaking-challenge__poster-divider">
        <div className="speaking-challenge__poster-divider-title"><span>学生展示榜</span><strong>{code} 每日开口挑战榜</strong></div>
        <button type="button" className="speaking-challenge__poster-export" disabled={exportBusy || entry.status !== 'ready'} onClick={() => void handlePosterExport()}>{exportBusy ? '生成中…' : entry.status !== 'ready' ? '数据更新中' : '复制导出'}</button>
      </div>

      {exportNotice && <div className="speaking-challenge__poster-notice" role="status">{exportNotice}</div>}


      <div className="speaking-challenge__sort-controls">
        <details className="speaking-display-settings"><summary>榜单显示</summary><div>        <label>榜单排序 <select aria-label="榜单排序" value={sort} onChange={event => setSort(event.target.value as SpeakingSort)}>
          <option value="rank">打卡排名</option><option value="name-asc">英文名 A → Z</option><option value="name-desc">英文名 Z → A</option>
          <option value="words-desc">{metricLabel}总词数 · 从多到少</option><option value="words-asc">{metricLabel}总词数 · 从少到多</option>
        </select></label><button type="button" className="speaking-challenge__poster-edit" onClick={() => setPosterEditorOpen(true)}>编辑公示名单</button></div></details>
        <span>{reportRange ? '已生成' : '本周'}：{formatPeriodDate(reportStart)}—{formatPeriodDate(reportEnd)}</span>
        {reportRange && <button type="button" className="speaking-date-history" disabled={exportBusy} onClick={() => { setReportRange(null); setShowHistoryDates(false); setExportNotice(''); }}>恢复本周</button>}
      </div>
      <section ref={scoreboardRef} className="speaking-challenge__scoreboard" aria-label={`${code} 每日开口挑战榜`}>
        <div className="speaking-challenge__confetti" aria-hidden="true">
          <span>✨</span><span>🎉</span><span>⭐</span><span>🎈</span><span>✨</span><span>🎊</span>
        </div>
        <header className="speaking-challenge__scoreboard-head">
          <div>
            <span>🏆 DAILY SPEAKING CHALLENGE</span>
            <h2><span aria-hidden="true">🎙️</span>{code} 每日开口挑战榜</h2>
            <p><strong>闪闪发光的开口小勇士</strong><i>·</i>{reportRange ? '统计范围' : '本周'} {formatPeriodDate(reportStart)}—{formatPeriodDate(reportEnd)}{!reportRange && <> · 累计范围 {formatPeriodDate(challenge.start)}—{formatPeriodDate(challenge.end)}</>}<i>·</i>{config.ignoreSupplementVariance ? '先比连续，再比完成；所有有效打卡均按完成计算。' : '先比连续，再比完成；补卡只计完成，不接续连续天数。'}</p>
            <div className="speaking-challenge__data-cutoff"><span aria-hidden="true">⏱</span>{formatDataCutoff(result.updatedAt)}</div>
          </div>
        </header>

        {honorGroups.length > 0 && (
          <div className={`speaking-challenge__honor-board has-${honorGroups.length}-groups`}>
            {honorGroups.map((group) => (
              <section key={group.rank} className={`speaking-challenge__honor-group is-rank-${group.rank}`}>
                <div className="speaking-challenge__honor-title">
                  <span aria-hidden="true">{rankLabel(group.rank)}</span>
                  <div><strong>{group.students.length > 1 ? `${group.students.length} 人并列第 ${group.rank} 名` : `第 ${group.rank} 名`}</strong><small>连续 {group.students[0].streakDays} 天 · 共 {group.students[0].totalDays} 天</small></div>
                </div>
                <div className="speaking-challenge__honor-names">
                  {group.students.map((student, index) => (
                    <b key={posterStudentKey(student, index)} className="speaking-challenge__honor-name"><span>{student.englishName}</span>{student.chineseName && student.chineseName !== student.englishName && <small>{student.chineseName}</small>}</b>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="speaking-challenge__summary-row">
          <div><span>已开口</span><strong>{leaderboard.activeStudents}</strong><small>/ {leaderboard.totalStudents} 人</small></div>
          <div><span>连续 3 天+</span><strong>{leaderboard.threeDayStudents}</strong><small>人</small></div>
          <div><span>本班最高</span><strong>{leaderboard.maxStreak}</strong><small>天</small></div>
        </div>

        <div className="speaking-challenge__legend">
          <span><i className="is-normal">✓</i>{config.ignoreSupplementVariance ? '有效打卡' : '正常打卡'}</span>
          {!config.ignoreSupplementVariance && <span><i className="is-supplement">补</i>补卡</span>}
          <span><i className="is-missed">·</i>未打卡</span>
          {config.ignoreSupplementVariance && <span className="speaking-challenge__adjusted-legend">补卡误差已忽略</span>}
          <span className="speaking-challenge__scroll-hint">← 左右滑动看每天 →</span>
        </div>

        {!reportRange && !dateWindow.dates.length && <p className="speaking-date-window">本周暂无打卡数据，可展开查看历史日期。</p>}
        <div className="speaking-challenge__table-shell">
          <table className="speaking-challenge__table">
            <thead>
              <tr>
                <th className="is-rank">排名</th><th className="is-name">学生</th>
                <th className="is-metric">{metricLabel}打卡天数</th><th className="is-metric">{reportRange ? '区间总词数' : '本周总词数'}</th><th className="is-metric">连续</th>{!config.ignoreSupplementVariance && <th className="is-metric">补卡</th>}
                {fullDates.map((date) => {
                  const label = dateHeader(date);
                  return <th key={date} className={!availableDates.has(date) ? 'is-future-date' : ''}><span>{label.day}</span><small>{label.weekday}</small></th>;
                })}
                {!reportRange && <th className="is-metric">累计打卡天数</th>}
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student, studentIndex) => (
                <tr key={posterStudentKey(student, studentIndex)} className={student.rank <= 3 ? `is-top is-top-${student.rank}` : ''}>
                  <td className="is-rank"><span>{rankLabel(student.rank)}</span></td>
                  <td className="is-name"><strong>{student.englishName}</strong>{student.chineseName && student.chineseName !== student.englishName && <small>{student.chineseName}</small>}</td>
                  <td className="is-metric"><b>{speakingWeekMetrics(student, reportStart, reportEnd).days}</b><small>天</small></td>
                  <td className="is-metric"><b>{speakingWeekMetrics(student, reportStart, reportEnd).words?.toLocaleString('en-US') ?? '暂无'}</b><small>词</small></td>
                  <td className="is-metric"><b>{student.streakDays}</b><small>天</small></td>
                  {!config.ignoreSupplementVariance && <td className="is-metric"><b>{student.supplementDays}</b><small>次</small></td>}
                  {fullDates.map((date) => {
                    const status = studentDayStatus(student, date, availableDates);
                    return (
                      <td key={date} className="is-day">
                        <span className={`speaking-challenge__day is-${status}`} title={`${date} ${status === 'normal' ? '正常打卡' : status === 'supplement' ? '补卡' : status === 'future' ? '还未到' : '未打卡'}`}>
                          {status === 'normal' ? '✓' : status === 'supplement' ? '补' : status === 'missed' ? '·' : ''}
                        </span>
                        {status !== 'future' && <small className="speaking-challenge__day-words">{student.daily.find(day => day.date === date)?.words?.toLocaleString('en-US') != null ? `${student.daily.find(day => day.date === date)!.words!.toLocaleString('en-US')} 词` : '词数暂无'}</small>}
                      </td>
                    );
                  })}
                  {!reportRange && <td className="is-metric"><b>{student.totalDays}</b><small>天</small></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="speaking-challenge__words-note">{reportRange && '打卡、连续天数和排名均按所选日期范围统计。'}词数来自每日开口识别记录，同日合计；{metricLabel}总词数仅统计{reportRange ? '所选范围' : '本周'}，数据缺失时显示暂无。排序只调整展示顺序。</p>
        <footer className="speaking-challenge__scoreboard-footer">🌟 坚持每天开口，让每一次进步都闪闪发光 ✨</footer>
      </section>

      {posterEditorOpen && (
        <div className="speaking-challenge__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPosterEditorOpen(false); }}>
          <section className="speaking-challenge__modal speaking-challenge__poster-editor" role="dialog" aria-modal="true" aria-labelledby="speaking-poster-editor-title">
            <header><div><span>{code} · 仅调整公示图片</span><h2 id="speaking-poster-editor-title">编辑挑战榜名单</h2></div><button type="button" aria-label="关闭" onClick={() => setPosterEditorOpen(false)}>×</button></header>
            <div className="speaking-challenge__poster-editor-note">这里的改名和移除只影响挑战榜与导出图片，不会修改教务系统名单，也不会改变 MiniPin 发放对象。</div>
            <div className="speaking-challenge__poster-editor-list">
              {sourceLeaderboard.students.map((student, index) => {
                const studentKey = posterStudentKey(student, index);
                const edit = posterEdits[studentKey];
                return (
                  <div key={studentKey} className={`speaking-challenge__poster-editor-row${edit?.hidden ? ' is-hidden' : ''}`}>
                    <div><strong>{student.chineseName || '中文名未登记'}</strong><small>原英文名：{student.englishName}</small></div>
                    <input aria-label={`${student.chineseName || student.englishName}公示名`} value={edit?.displayName ?? ''} placeholder={student.englishName} disabled={edit?.hidden} onChange={(event) => updatePosterEdit(studentKey, { displayName: event.target.value })} />
                    <button type="button" onClick={() => updatePosterEdit(studentKey, { hidden: !edit?.hidden })}>{edit?.hidden ? '恢复' : '从公示移除'}</button>
                  </div>
                );
              })}
            </div>
            <footer><button type="button" className="is-secondary" onClick={resetPosterEdits}>恢复原名单</button><button type="button" className="is-primary" onClick={() => setPosterEditorOpen(false)}>完成编辑</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}

export default function SpeakingChallengeApp({ classes, teacherName, onAuthenticationRequired, deferLoad = true, activeClassCode, onActiveClassChange }: Props) {
  const todayDay = useMemo(currentDayInShanghai, []);
  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    return classes.reduce<ClassOption[]>((list, source) => {
      const code = String(source.name || source.id || '').replace(/\s+/g, '').trim().toUpperCase();
      if (!code || seen.has(code)) return list;
      seen.add(code);
      const days = getClassDays(code);
      const today = days.includes(todayDay);
      list.push({ code, today, time: today ? getClassTimeOnDay(code, todayDay) : '' });
      return list;
    }, []).sort((a, b) => Number(b.today) - Number(a.today)
      || (a.today && b.today ? a.time.localeCompare(b.time) : (getClassDisplaySession(a.code, [], new Date(), teacherName)?.minutesUntil ?? Infinity) - (getClassDisplaySession(b.code, [], new Date(), teacherName)?.minutesUntil ?? Infinity))
      || a.code.localeCompare(b.code));
  }, [classes, todayDay, teacherName]);
  const classKey = classOptions.map((item) => `${item.code}:${item.today ? 1 : 0}`).join('|');
  const initialCode = useMemo(() => {
    const todayCodes = classOptions.filter((item) => item.today).map((item) => item.code);
    return todayCodes[0] || classOptions[0]?.code || '';
  }, [classOptions]);
  const todayClassCount = classOptions.filter((item) => item.today).length;
  const sectionRef = useRef<HTMLElement | null>(null);
  const authCallbackRef = useRef(onAuthenticationRequired);
  const [activated, setActivated] = useState(!deferLoad);
  const [entries, setEntries] = useState<Record<string, ClassEntry>>({});
  const [activeCode, setActiveCode] = useState(initialCode);
  const activeCodeRef = useRef(initialCode);
  const [configs, setConfigs] = useState<Record<string, SpeakingRewardConfig>>({});
  const [selections, setSelections] = useState<Record<string, SpeakingRewardSelection>>({});
  const [selectedDatesByClass, setSelectedDatesByClass] = useState<Record<string, string[]>>({});
  const [plan, setPlan] = useState<SpeakingRewardPlan | null>(null);
  const [receipt, setReceipt] = useState<IssueReceipt | null>(null);
  const [previewBusyCode, setPreviewBusyCode] = useState('');
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueStage, setIssueStage] = useState(0);
  const issueStageTimers = useRef<number[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [modalError, setModalError] = useState('');
  const [notices, setNotices] = useState<Record<string, { kind: 'success' | 'warning'; text: string } | null>>({});

  useEffect(() => { authCallbackRef.current = onAuthenticationRequired; }, [onAuthenticationRequired]);

  const clearIssueStageTimers = useCallback(() => {
    issueStageTimers.current.forEach((timer) => window.clearTimeout(timer));
    issueStageTimers.current = [];
  }, []);

  useEffect(() => clearIssueStageTimers, [clearIssueStageTimers]);

  useEffect(() => {
    if (!deferLoad || activated) return;
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') { setActivated(true); return; }
    const observer = new IntersectionObserver((observations) => {
      if (!observations.some((observation) => observation.isIntersecting)) return;
      setActivated(true);
      observer.disconnect();
    }, { rootMargin: '420px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, [activated, deferLoad]);

  const reloadClass = useCallback(async (code: string, options: { resetSelection?: boolean } = {}) => {
    setEntries((previous) => ({ ...previous, [code]: { ...previous[code], status: 'loading', error: '' } }));
    try {
      const result = await fetchSpeakingChallengeClass(code);
      const returnedClassCode = String(result?.leaderboard?.classCode || '').trim().toUpperCase();
      if (returnedClassCode !== code) {
        throw new Error(`班级数据核对失败：当前选择 ${code}，读取到 ${returnedClassCode || '未知班级'}，已阻止显示和发放。`);
      }
      saveCachedSpeakingClass(teacherName, code, result);
      setEntries((previous) => ({ ...previous, [code]: { status: 'ready', result } }));
      setConfigs((previous) => {
        const current = previous[code] || result.rewardState.config;
        const locked = result.rewardState.config;
        return {
          ...previous,
          [code]: {
            basePerDay: current.basePerDay,
            streakThreshold: result.rewardState.streakConfigLocked ? locked.streakThreshold : current.streakThreshold,
            streakMultiplier: result.rewardState.streakConfigLocked ? locked.streakMultiplier : current.streakMultiplier,
            rewardMode: result.rewardState.streakConfigLocked ? locked.rewardMode : current.rewardMode,
            thresholdBonus: result.rewardState.streakConfigLocked ? locked.thresholdBonus : current.thresholdBonus,
            ignoreSupplementVariance: result.rewardState.streakConfigLocked
              ? locked.ignoreSupplementVariance
              : current.ignoreSupplementVariance,
          },
        };
      });
      setSelections((previous) => ({
        ...previous,
        [code]: previous[code] || DEFAULT_REWARD_SELECTION,
      }));
      setSelectedDatesByClass((previous) => {
        const allowedDates = new Set(result.leaderboard.challenge.dates);
        const shouldInitialize = options.resetSelection
          || !Object.prototype.hasOwnProperty.call(previous, code);
        return {
          ...previous,
          [code]: shouldInitialize
            ? result.leaderboard.challenge.dates.filter((date) => !result.rewardState.issuedDates.includes(date))
            : (previous[code] || []).filter((date) => allowedDates.has(date)),
        };
      });
      return result;
    } catch (error) {
      if (error instanceof SpeakingChallengeApiError && error.status === 401) authCallbackRef.current?.();
      const message = error instanceof Error ? error.message : '每日开口数据读取失败';
      setEntries((previous) => ({ ...previous, [code]: { ...previous[code], status: 'error', error: message } }));
      return null;
    }
  }, [teacherName]);

  useEffect(() => {
    if (!classKey) {
      setEntries({});
      setActiveCode('');
      activeCodeRef.current = '';
      return;
    }
    if (!activated) return;
    setActiveCode(initialCode);
    activeCodeRef.current = initialCode;
    const cachedEntries = Object.fromEntries(classOptions.flatMap(({ code }) => {
      const result = readCachedSpeakingClass(teacherName, code);
      return result ? [[code, { status: 'ready' as const, result }]] : [];
    }));
    setEntries(cachedEntries);
    classOptions.forEach(({ code }) => { void reloadClass(code); });
  }, [activated, classKey, classOptions, initialCode, reloadClass, teacherName]);

  function selectClass(code: string) {
    onActiveClassChange?.(code);
    if (code === activeCodeRef.current && entries[code]?.status !== 'error') return;
    activeCodeRef.current = code;
    setActiveCode(code);
    setPlan(null);
    setReceipt(null);
    setAcknowledged(false);
    setModalError('');
    setNotices((previous) => ({ ...previous, [code]: null }));
    if (!entries[code] || entries[code].status === 'error') void reloadClass(code);
  }

  useEffect(() => {
    if (!activated || !activeClassCode || !classOptions.some((item) => item.code === activeClassCode)) return;
    if (activeCode !== activeClassCode) selectClass(activeClassCode);
  }, [activated, activeClassCode, activeCode]);

  function updateConfig<K extends keyof SpeakingRewardConfig>(code: string, field: K, value: SpeakingRewardConfig[K]) {
    const result = entries[code]?.result;
    const current = configs[code] || result?.rewardState.config || DEFAULT_REWARD_CONFIG;
    setConfigs((previous) => ({ ...previous, [code]: { ...current, [field]: value } }));
  }

  function updateSelection(code: string, value: SpeakingRewardSelection) {
    setSelections((previous) => ({ ...previous, [code]: value }));
  }

  function toggleSettlementDate(code: string, date: string) {
    setSelectedDatesByClass((previous) => {
      const current = new Set(previous[code] || []);
      if (current.has(date)) current.delete(date); else current.add(date);
      return { ...previous, [code]: [...current].sort() };
    });
  }

  async function handleRecovery(code: string, result: SpeakingPendingResolution) {
    setPlan(null);
    setEntries((previous) => {
      const entry = previous[code];
      if (!entry?.result) return previous;
      return { ...previous, [code]: { ...entry, result: { ...entry.result, rewardState: result.rewardState } } };
    });
    setNotices((previous) => ({ ...previous, [code]: { kind: 'success', text: result.message } }));
    if (result.retryReady && activeCodeRef.current === code) {
      const selection: SpeakingRewardSelection = { baseStrategy: 'unissued', includeStreak: true, missedBasePerDay: result.config.basePerDay };
      setConfigs((previous) => ({ ...previous, [code]: result.config }));
      setSelections((previous) => ({ ...previous, [code]: selection }));
      setSelectedDatesByClass((previous) => ({ ...previous, [code]: result.selectedDates }));
      try {
        const nextPlan = result.plan || await createSpeakingRewardPlan(code, result.config, result.selectedDates, selection);
        if (activeCodeRef.current !== code) return;
        setPlan(nextPlan); setAcknowledged(false); setModalError('');
      } catch (error) {
        setNotices((previous) => ({ ...previous, [code]: { kind: 'warning', text: error instanceof Error ? error.message : '补发清单生成失败，请重新预览。' } }));
      }
    }
  }

  async function handlePreview(code: string) {
    const result = entries[code]?.result;
    if (!result || result.rewardState.pending) return;
    const config = configs[code] || result.rewardState.config || DEFAULT_REWARD_CONFIG;
    const selectedDates = selectedDatesByClass[code] || [];
    const selection = selections[code] || DEFAULT_REWARD_SELECTION;
    setPreviewBusyCode(code);
    setNotices((previous) => ({ ...previous, [code]: null }));
    setModalError('');
    try {
      const nextPlan = await createSpeakingRewardPlan(code, config, selectedDates, selection);
      if (activeCodeRef.current !== code) return;
      if (nextPlan.classCode !== code) {
        setNotices((previous) => ({ ...previous, [code]: { kind: 'warning', text: '发放清单班级与当前班级不一致，请重新读取后再试。' } }));
        return;
      }
      setPlan(nextPlan);
      setAcknowledged(false);
      setConfigs((previous) => ({ ...previous, [code]: { ...nextPlan.config } }));
    } catch (error) {
      if (error instanceof SpeakingChallengeApiError && error.status === 401) authCallbackRef.current?.();
      setNotices((previous) => ({ ...previous, [code]: { kind: 'warning', text: error instanceof Error ? error.message : '发放清单生成失败' } }));
    } finally {
      setPreviewBusyCode('');
    }
  }

  async function handleIssue() {
    if (!plan?.planId || !acknowledged) return;
    const code = plan.classCode;
    if (activeCodeRef.current !== code) {
      setModalError('当前班级已经切换，请重新预览发放清单。');
      return;
    }
    setIssueBusy(true);
    setIssueStage(1);
    clearIssueStageTimers();
    issueStageTimers.current = [
      window.setTimeout(() => setIssueStage(2), 6000),
      window.setTimeout(() => setIssueStage(3), 18000),
    ];
    setModalError('');
    try {
      const result = await issueSpeakingRewardPlan(plan.planId);
      setReceipt({
        ...result,
        classCode: code,
        selectedDates: plan.selectedDates,
      });
      setPlan(null);
      setAcknowledged(false);
      setNotices((previous) => ({ ...previous, [code]: {
        kind: result.failedCount > 0 ? 'warning' : 'success',
        text: result.failedCount > 0
          ? `已成功发给 ${result.successCount} 人，${result.failedCount} 人未成功，共 ${formatMp(result.totalMP)} MP。${result.failureMessage || ""} 已停止尝试；如需补发，请关闭结果并重新生成清单核对。`
          : `已发给 ${result.successCount} 人，共 ${formatMp(result.totalMP)} MP。已结算日期不会重复发。`,
      } }));
      void reloadClass(code, { resetSelection: true });
    } catch (error) {
      if (error instanceof SpeakingChallengeApiError && error.status === 401) authCallbackRef.current?.();
      const text = error instanceof Error ? error.message : 'MiniPin 发放失败';
      setModalError(text);
      setPlan(null); setAcknowledged(false);
      setNotices((previous) => ({ ...previous, [code]: { kind: 'warning', text } }));
      if (error instanceof SpeakingChallengeApiError && error.rewardState) {
        const rewardState = error.rewardState;
        setEntries((previous) => {
          const entry = previous[code];
          return entry?.result ? { ...previous, [code]: { ...entry, result: { ...entry.result, rewardState } } } : previous;
        });
      }
      void reloadClass(code);
    } finally {
      clearIssueStageTimers();
      setIssueStage(0);
      setIssueBusy(false);
    }
  }

  const insufficientBalance = Boolean(plan && plan.balance !== null && roundOne(plan.balance) < roundOne(plan.totalMP));
  const activeOption = classOptions.find((item) => item.code === activeCode);
  const activeResult = activeCode ? entries[activeCode]?.result : undefined;

  return (
    <section ref={sectionRef} className="speaking-challenge fade-in" aria-labelledby="speaking-challenge-title">
      <h2 id="speaking-challenge-title" className="speaking-challenge__sr-only">每日开口挑战榜</h2>

      {!activated && classOptions.length > 0 ? (
        <section className="speaking-challenge__loading-card speaking-challenge__loading-card--deferred" aria-live="polite">
          <span className="speaking-challenge__loader" /><strong>即将自动读取每日开口数据</strong><small>只优先读取今天上课的班级，无需点击。</small>
        </section>
      ) : classOptions.length === 0 ? (
        <section className="speaking-challenge__empty"><span aria-hidden="true">🎙️</span><h2>还没有可读取的班级</h2><p>登录后会自动读取当前班主任的班级。</p></section>
      ) : (
        <>
          <section className="speaking-challenge__class-section">
            <div className="speaking-challenge__section-heading speaking-challenge__section-heading--challenge">
              <div><span>班主任工作区</span><h2>每日开口管理</h2><p>查看班级每日打卡明细 · 切换班级 · 设置并发放 MiniPin 奖励</p></div>
              <div className="speaking-challenge__console-meta"><strong>{todayClassCount > 0 ? `${todayDay}有课 ${todayClassCount} 个班 · 当前查看 ${activeCode || initialCode}` : `当前查看 ${activeCode || initialCode}`}</strong><small><b>8月31日起持续更新</b> · 点击班级会直接切换下方榜单与发放对象</small></div>
            </div>
            <div className="speaking-challenge__class-grid speaking-challenge__class-grid--compact">
              {classOptions.map((option) => {
                const entry = entries[option.code];
                const active = activeCode === option.code;
                return (
                  <button key={option.code} type="button" aria-pressed={active} className={`speaking-challenge__class-card${active ? ' is-active' : ''}${option.today ? ' is-today' : ''}`} onClick={() => selectClass(option.code)}>
                    <div className="speaking-challenge__class-name"><strong>{option.code}</strong>{option.today && <em>{todayDay}{option.time ? ` ${option.time}` : ''}</em>}</div>
                    <span>{entry?.status === 'loading' ? entry.result ? `${entry.result.leaderboard.activeStudents}/${entry.result.leaderboard.totalStudents} 人 · 后台更新中` : '首次读取中…' : entry?.status === 'error' ? entry.result ? `${entry.result.leaderboard.activeStudents}/${entry.result.leaderboard.totalStudents} 人 · 更新失败` : '读取失败，点击后重试' : entry?.result ? `${entry.result.leaderboard.activeStudents}/${entry.result.leaderboard.totalStudents} 人已开口` : active ? '正在打开' : '点击切换'}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="speaking-challenge__boards">
            {activeCode && (
              <SpeakingClassBoard
                key={activeCode}
                code={activeCode}
                entry={entries[activeCode]}
                teacherName={teacherName}
                todayLabel={todayDay}
                isToday={Boolean(activeOption?.today)}
                config={configs[activeCode] || activeResult?.rewardState.config || DEFAULT_REWARD_CONFIG}
                selection={selections[activeCode] || DEFAULT_REWARD_SELECTION}
                selectedDates={selectedDatesByClass[activeCode] || []}
                previewBusy={previewBusyCode === activeCode}
                notice={notices[activeCode] || null}
                onReload={() => void reloadClass(activeCode)}
                onRecovery={(result) => handleRecovery(activeCode, result)}
                onUpdateConfig={(field, value) => updateConfig(activeCode, field, value)}
                onUpdateSelection={(value) => updateSelection(activeCode, value)}
                onToggleDate={(date) => toggleSettlementDate(activeCode, date)}
                onSelectDates={(dates) => setSelectedDatesByClass(current => ({ ...current, [activeCode]: dates }))}
                onPreview={() => void handlePreview(activeCode)}
              />
            )}
          </div>
        </>
      )}

      {plan && (
        <div className="speaking-challenge__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !issueBusy) setPlan(null); }}>
          <section className="speaking-challenge__modal" role="dialog" aria-modal="true" aria-labelledby="speaking-reward-title">
            <header><div><span>{plan.classCode} · {formatSelectedDates(plan.selectedDates)}{plan.config.ignoreSupplementVariance ? ' · 已忽略补卡误差' : ''}</span><h2 id="speaking-reward-title">{plan.recoveryOf ? '旧单补发清单 · 按原金额' : 'MiniPin 发放清单'}</h2></div><button type="button" aria-label="关闭" disabled={issueBusy} onClick={() => setPlan(null)}>×</button></header>
            {plan.studentCount === 0 ? (
              <div className="speaking-challenge__nothing-due"><span aria-hidden="true">✓</span><strong>所选范围没有需要发放的奖励</strong><p>可以返回修改日期、基础奖励范围或连续奖励选项。</p></div>
            ) : (
              <>
                <div className="speaking-challenge__modal-summary">
                  <div><span>本次发放</span><strong>{plan.studentCount} 人</strong></div><div><span>合计</span><strong>{formatMp(plan.totalMP)} MP</strong></div><div><span>当前余额</span><strong>{plan.balance === null ? '暂未读取' : `${formatMp(plan.balance)} MP`}</strong></div>
                </div>
                <div className="speaking-challenge__plan-breakdown" aria-label="本次奖励分类">
                  {plan.breakdown.standardBase.totalMP > 0 && <div><span>未发日期基础奖励</span><strong>{plan.breakdown.standardBase.studentCount} 人 · {formatMp(plan.breakdown.standardBase.totalMP)} MP</strong><small>所选未发日期按本次金额首次发放</small></div>}
                  {plan.breakdown.repeatedBase.totalMP > 0 && <div className="is-warning"><span>已发日期重复奖励</span><strong>{plan.breakdown.repeatedBase.studentCount} 人 · {formatMp(plan.breakdown.repeatedBase.totalMP)} MP</strong><small>已领过的人按本次金额再领一次</small></div>}
                  {plan.breakdown.unissuedBase.totalMP > 0 && <div><span>已发日期漏发奖励</span><strong>{plan.breakdown.unissuedBase.studentCount} 人 · {formatMp(plan.breakdown.unissuedBase.totalMP)} MP</strong><small>只包含后来新增或上次遗漏，按本次设置的补卡金额发放</small></div>}
                  {plan.breakdown.streak.totalMP > 0 && <div className="is-streak"><span>连续打卡奖励</span><strong>{plan.breakdown.streak.studentCount} 人 · {formatMp(plan.breakdown.streak.totalMP)} MP</strong><small>只包含尚未发放的连续奖励</small></div>}
                </div>
                {issueBusy && (
                  <div className="speaking-challenge__issue-progress" role="status" aria-live="polite">
                    <div className="speaking-challenge__issue-progress-head"><span className="speaking-challenge__loader" /><div><strong>{issueStage <= 1 ? '正在向教务系统提交奖励' : issueStage === 2 ? '教务系统正在逐个处理学生' : '正在等待结果并核对班级余额'}</strong><small>这一步可能需要 1—2 分钟，请保持页面打开，无需重复点击；稍后可直接查看发放结果。</small></div></div>
                    <div className={`speaking-challenge__issue-progress-track is-stage-${Math.max(1, issueStage)}`}><i /><i /><i /></div>
                    <div className="speaking-challenge__issue-progress-labels"><span>提交奖励</span><span>处理学生</span><span>核对结果</span></div>
                  </div>
                )}
                <div className="speaking-challenge__plan-table-shell"><table><thead><tr><th>排名</th><th>学生</th><th>连续</th><th>有效天数</th><th>已发</th><th>本次应发</th></tr></thead><tbody>{plan.rewards.map((reward) => (
                  <tr key={`${reward.rank}:${reward.englishName}:${reward.chineseName}`}><td>{rankLabel(reward.rank)}</td><td><strong>{reward.englishName}</strong>{reward.chineseName && reward.chineseName !== reward.englishName && <small className="speaking-challenge__plan-chinese">{reward.chineseName}</small>}</td><td>{reward.streakDays} 天</td><td>{reward.totalDays} 天{reward.supplementDays > 0 ? `（补${reward.supplementDays}）` : ''}</td><td>{formatMp(reward.alreadyIssued)} MP</td><td><strong className="speaking-challenge__amount">+{formatMp(reward.amount)} MP</strong><small className="speaking-challenge__amount-detail">{[
                    reward.standardBaseAmount > 0 ? `基础 ${formatMp(reward.standardBaseAmount)}` : '',
                    reward.repeatedBaseAmount > 0 ? `重复基础 ${formatMp(reward.repeatedBaseAmount)}` : '',
                    reward.unissuedBaseAmount > 0 ? `漏发基础 ${formatMp(reward.unissuedBaseAmount)}` : '',
                    reward.streakAmount > 0 ? `连续 ${formatMp(reward.streakAmount)}` : '',
                  ].filter(Boolean).join(' · ')}</small></td></tr>
                ))}</tbody></table></div>
                {insufficientBalance && <div className="speaking-challenge__balance-warning">当前 MiniPin 余额不足，需要先补足余额才能发放。</div>}
                {modalError && <div className="speaking-challenge__modal-error">{modalError}</div>}
                <label className="speaking-challenge__acknowledge"><input type="checkbox" checked={acknowledged} disabled={issueBusy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已核对班级、学生名单和本次发放金额</span></label>
              </>
            )}
            <footer><button type="button" className="is-secondary" disabled={issueBusy} onClick={() => setPlan(null)}>{plan.studentCount === 0 ? '完成' : '返回修改'}</button>{plan.studentCount > 0 && <button type="button" className="is-primary" disabled={!acknowledged || issueBusy || insufficientBalance} onClick={() => void handleIssue()}>{issueBusy ? '正在发放…' : `确认发放 ${formatMp(plan.totalMP)} MP`}</button>}</footer>
          </section>
        </div>
      )}

      {receipt && (
        <div className="speaking-challenge__modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceipt(null); }}>
          <section className="speaking-challenge__modal speaking-challenge__receipt" role="dialog" aria-modal="true" aria-labelledby="speaking-receipt-title">
            <header>
              <div><span>{receipt.classCode} · {formatSelectedDates(receipt.selectedDates)}</span><h2 id="speaking-receipt-title">{receipt.failedCount > 0 ? 'MiniPin 部分发放完成' : 'MiniPin 发放完成'}</h2></div>
              <button type="button" aria-label="关闭" onClick={() => setReceipt(null)}>×</button>
            </header>
            <div className="speaking-challenge__receipt-body">
              <div className={`speaking-challenge__receipt-icon${receipt.failedCount > 0 ? ' is-partial' : ''}`} aria-hidden="true">{receipt.failedCount > 0 ? '!' : '✓'}</div>
              <div className="speaking-challenge__receipt-copy">
                <strong>已成功发放给 {receipt.successCount} 人</strong>
                <span>本次共发放 {formatMp(receipt.totalMP)} MP，已结算日期不会重复发放。</span>
              </div>
              <div className="speaking-challenge__receipt-balance">
                <span>班级 MiniPin 余额</span>
                <div><strong>{formatMp(receipt.balanceBefore)}</strong><b aria-hidden="true">→</b><strong>{formatMp(receipt.balanceAfter)}</strong><em>MP</em></div>
                <small>{receipt.balanceVerified ? '发放后余额已重新核对' : '发放后余额按本次实际发放额计算'}</small>
              </div>
              {receipt.failedCount > 0 && (
                <div className="speaking-challenge__receipt-failed"><strong>{receipt.failedCount} 人未发放成功</strong><span>{receipt.failedStudents.length ? receipt.failedStudents.join('、') : '可返回班级后重新生成发放清单。'}</span></div>
              )}
            </div>
            <footer><button type="button" className="is-primary" onClick={() => setReceipt(null)}>完成</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
