import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { weeklyRotationAvailability } from '../utils/weeklyRotationAvailability';
import type { ClassInfo, WelcomeView } from '../types';
import { getCurrentWeek, getWeekRange } from '../utils/weekNumber';
import { listKnownClassCodes } from '../utils/classProfiles';
import { getBundledScheduleMetaMap, saveScheduleMetaForClasses } from '../utils/classScheduleMeta';
import { performWeeklyRotation, getLastRotationInfo, getWeeklyRotationPlan, undoWeeklyRotation } from '../services/weeklyRotationService';
import { buildWelcomeClassCards, buildWelcomeDayGroups } from '../services/welcomeViewModels';
import { useVersionStatus } from './useVersionStatus';
import type { AcademicTermLaunchResult } from '../services/academicTermLaunchService';
import { forceReloadTestSite } from '../utils/testVersionSync';
import {
  applyRosterSnapshot,
  formatRosterSnapshotTime,
  getRosterSnapshot,
  refreshRosterSnapshot,
  RosterSnapshotApiError,
  summarizeRosterSnapshot,
  type RosterSnapshot,
} from '../services/rosterSnapshotService';

type GuideAnchor = 'top' | 'batch-import';

function getShanghaiDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function snapshotMatchesClasses(snapshot: RosterSnapshot, classes: ClassInfo[]): boolean {
  const expected = classes.map((item) => item.name.trim().toUpperCase()).filter(Boolean).sort();
  const prepared = (snapshot.classes || []).map((item) => item.name.trim().toUpperCase()).filter(Boolean).sort();
  return expected.length === prepared.length && expected.every((name, index) => name === prepared[index]);
}

export function useWelcomePageState(classes: ClassInfo[]) {
  const [rotationClock, setRotationClock] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setRotationClock(new Date());
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const week = getCurrentWeek();
  const { start, end } = getWeekRange(week);
  const [showGuide, setShowGuide] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<GuideAnchor>('top');
  const [view, setView] = useState<WelcomeView>('byClass');
  const [batchFetchBusy, setBatchFetchBusy] = useState(false);
  const [batchFetchStartedAt, setBatchFetchStartedAt] = useState<number | null>(null);
  const [batchFetchDurationSeconds, setBatchFetchDurationSeconds] = useState<number | null>(null);
  const [batchFetchRevision, setBatchFetchRevision] = useState(0);
  const [batchFetchStatus, setBatchFetchStatus] = useState('');
  const [batchFetchDone, setBatchFetchDone] = useState(false);
  const [rosterSnapshot, setRosterSnapshot] = useState<RosterSnapshot | null>(null);
  const [showReLogin, setShowReLogin] = useState(false);
  const [pendingBatchRetry, setPendingBatchRetry] = useState(false);
  const [scheduleImportStatus, setScheduleImportStatus] = useState('');
  const [, setRotationRefreshNonce] = useState(0);
  const [rotationMsg, setRotationMsg] = useState('');
  const [rotationBusy, setRotationBusy] = useState(false);
  const [termLaunch, setTermLaunch] = useState<AcademicTermLaunchResult | null>(null);
  const rotationInFlight = useRef(false);
  const rosterSyncRunKey = useRef('');
  const rosterSyncRequestId = useRef(0);
  const versionStatus = useVersionStatus();
  const versionInfo = versionStatus.versionInfo;

  const localDraftClasses = classes.length === 0
    ? listKnownClassCodes().map((code) => ({ id: code, name: code }))
    : [];
  const displayClasses = classes.length > 0 ? classes : localDraftClasses;
  const activeClassKey = useMemo(
    () => classes.map((item) => item.name.trim().toUpperCase()).filter(Boolean).sort().join('|'),
    [classes],
  );

  function saveSnapshotAndDescribe(snapshot: RosterSnapshot | null) {
    setRosterSnapshot(snapshot);
    const { classCount, studentCount } = applyRosterSnapshot(snapshot);
    const snapshotSummary = summarizeRosterSnapshot(snapshot);
    const updatedAt = formatRosterSnapshotTime(snapshot);
    return {
      classCount,
      studentCount,
      ...snapshotSummary,
      updatedAt,
      suffix: updatedAt ? `，更新于 ${updatedAt}` : '',
    };
  }

  function describePreparedData(summary: ReturnType<typeof saveSnapshotAndDescribe>): string {
    const taskDescription = summary.checkedTaskClassCount > 0
      ? `作业 ${summary.taskDataClassCount} 个班有数据、${summary.taskEmptyClassCount} 个班暂无挑战`
      : '作业挑战目录尚未准备';
    return `${taskDescription}；每日开口 ${summary.speakingClassCount} 个班已更新${summary.suffix}`;
  }

  useEffect(() => {
    if (!activeClassKey || rosterSyncRunKey.current === activeClassKey) return;
    rosterSyncRunKey.current = activeClassKey;
    let cancelled = false;
    const requestId = ++rosterSyncRequestId.current;
    const isCurrentRequest = () => !cancelled && rosterSyncRequestId.current === requestId;

    const { matchedClassCount, keptClassCount } = saveScheduleMetaForClasses(classes, getBundledScheduleMetaMap());
    setScheduleImportStatus(`课表已自动匹配：${matchedClassCount}/${keptClassCount} 个班有时间地点数据。`);

    async function syncInBackground() {
      let refreshStartedAt: number | null = null;
      try {
        const cached = await getRosterSnapshot();
        if (!isCurrentRequest()) return;
        if (cached.snapshot) {
          const summary = saveSnapshotAndDescribe(cached.snapshot);
          setBatchFetchDone(summary.checkedTaskClassCount > 0 || summary.speakingClassCount > 0);
          const isPreparedToday = cached.snapshot.context?.dataDate === getShanghaiDateKey()
            && cached.state !== 'partial' && cached.status !== 'partial'
            && !cached.snapshot.failures?.length && !cached.snapshot.taskFailures?.length
            && !cached.snapshot.speakingFailures?.length
            && snapshotMatchesClasses(cached.snapshot, classes);
          setBatchFetchStatus(
            isPreparedToday
              ? `今日数据已准备：${describePreparedData(summary)}。`
              : `已先读取最近数据：${describePreparedData(summary)}；正在后台更新…`,
          );
          if (isPreparedToday) return;
        } else {
          setBatchFetchStatus('正在后台准备今日班级数据…');
        }

        refreshStartedAt = Date.now();
        setBatchFetchStartedAt(refreshStartedAt);
        setBatchFetchBusy(true);
        const refreshed = await refreshRosterSnapshot('homepage');
        if (!isCurrentRequest()) return;
        const summary = saveSnapshotAndDescribe(refreshed.snapshot);
        setBatchFetchDone(summary.checkedTaskClassCount > 0 || summary.speakingClassCount > 0);
        setBatchFetchRevision((value) => value + 1);
          setBatchFetchStatus(
            refreshed.status === 'partial'
              ? `今日数据已部分更新：${describePreparedData(summary)}；少量班级沿用上次数据。`
              : `今日数据已更新：${describePreparedData(summary)}。`,
        );
      } catch (error) {
        if (!isCurrentRequest()) return;
        if (error instanceof RosterSnapshotApiError && error.snapshot) {
          const summary = saveSnapshotAndDescribe(error.snapshot);
          setBatchFetchDone(summary.checkedTaskClassCount > 0 || summary.speakingClassCount > 0);
          setBatchFetchStatus(`后台更新暂时失败，已保留最近的日报挑战和每日开口数据${summary.suffix}。`);
        } else if (error instanceof RosterSnapshotApiError && error.status === 401) {
          setBatchFetchStatus('教务登录已过期，当前已保存的日报挑战和每日开口数据仍可使用。');
        } else {
          setBatchFetchStatus('后台更新暂时失败，当前已保存的日报挑战和每日开口数据仍可使用。');
        }
      } finally {
        if (isCurrentRequest()) {
          if (refreshStartedAt !== null) setBatchFetchDurationSeconds(Math.max(1, Math.ceil((Date.now() - refreshStartedAt) / 1000)));
          setBatchFetchBusy(false);
        }
      }
    }

    void syncInBackground();
    return () => {
      cancelled = true;
    };
  }, [activeClassKey, classes]);

  const showingLocalDrafts = classes.length === 0 && localDraftClasses.length > 0;
  const classCards = useMemo(() => buildWelcomeClassCards(displayClasses), [displayClasses]);
  const daySchedule = useMemo(() => (
    view === 'byDate' ? buildWelcomeDayGroups(displayClasses) : []
  ), [displayClasses, view]);
  const guideSrc = showGuide ? `/guide.html${guideAnchor === 'batch-import' ? '#batch-import' : ''}` : '';

  const rotationPlan = getWeeklyRotationPlan(displayClasses.map((item) => item.name));
  const seatingClassCount = rotationPlan?.classCount || 0;
  const lastRotation = getLastRotationInfo();
  const rotationAvailability = weeklyRotationAvailability(rotationPlan?.targetWeek, rotationClock);
  const rotationPanelState = rotationPlan && rotationAvailability.allowed ? 'rotation-ready' : 'rotation-current';
  const rotationTitle = rotationPlan
    ? `生成第 ${rotationPlan.targetWeek} 周座位表`
    : '暂无可轮转的本地座位表';
  const rotationDescription = rotationPlan
    ? `${rotationAvailability.allowed ? '' : `${rotationAvailability.reason} `}以本地第 ${rotationPlan.sourceWeek} 周座位为准，点击后将 ${seatingClassCount} 个班级的对应场次推进 7 天并轮转座位；已在较新周次的场次保持原样。`
    : '请先在班级座位表中保存学生座位和上课日期；进入页面不会自动生成或覆盖本地座位。';
  const canRunWeeklyRotation = Boolean(rotationPlan && rotationAvailability.allowed);

  async function doBatchFetch() {
    const requestId = ++rosterSyncRequestId.current;
    const isCurrentRequest = () => rosterSyncRequestId.current === requestId;
    const startedAt = Date.now();
    setBatchFetchStartedAt(startedAt);
    setBatchFetchBusy(true);
    setBatchFetchDone(false);
    const { matchedClassCount, keptClassCount } = saveScheduleMetaForClasses(classes, getBundledScheduleMetaMap());
    setScheduleImportStatus(`已自动匹配课表：当前老师 ${matchedClassCount}/${keptClassCount} 个班有时间地点数据。`);
    setBatchFetchStatus(`正在刷新 ${classes.length} 个班的日报挑战和本周每日开口…`);

    try {
      const data = await refreshRosterSnapshot('manual');
      if (!isCurrentRequest()) return;
      const summary = saveSnapshotAndDescribe(data.snapshot);
      setBatchFetchStatus(
        data.status === 'partial'
          ? `已部分更新：${describePreparedData(summary)}；失败班级沿用上次数据。`
          : `刷新完成：${describePreparedData(summary)}。`,
      );
      setBatchFetchDone(summary.checkedTaskClassCount > 0 || summary.speakingClassCount > 0);
      setBatchFetchRevision((value) => value + 1);
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error instanceof RosterSnapshotApiError && error.status === 401) {
        setBatchFetchStatus('需要重新登录教务系统...');
        setPendingBatchRetry(true);
        setShowReLogin(true);
        return;
      }
      if (error instanceof RosterSnapshotApiError && error.snapshot) {
        const summary = saveSnapshotAndDescribe(error.snapshot);
        setBatchFetchDone(summary.checkedTaskClassCount > 0 || summary.speakingClassCount > 0);
        setBatchFetchStatus(`刷新失败，已保留最近的日报挑战和每日开口数据${summary.suffix}。`);
      } else {
        setBatchFetchStatus(error instanceof Error ? error.message : '刷新失败');
      }
    } finally {
      if (isCurrentRequest()) {
        setBatchFetchDurationSeconds(Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)));
        setBatchFetchBusy(false);
      }
    }
  }

  function handleBatchFetchAll() {
    if (batchFetchBusy || classes.length === 0) return;
    void doBatchFetch();
  }

  function handleReLoginSuccess(_nextClasses: ClassInfo[]) {
    setShowReLogin(false);
    setPendingBatchRetry(false);
    setBatchFetchStatus('教务系统已重新连接，正在自动更新班级数据…');
    void doBatchFetch();
  }

  function handleReLoginDismiss() {
    setShowReLogin(false);
    if (pendingBatchRetry) {
      setBatchFetchStatus('已取消登录');
    }
    setPendingBatchRetry(false);
  }

  const handleAuthenticationRequired = useCallback(() => {
    setShowReLogin(true);
  }, []);

  async function handleWeeklyRotation() {
    if (rotationInFlight.current || !rotationPlan) return;
    const availability = weeklyRotationAvailability(rotationPlan.targetWeek);
    if (!availability.allowed) { setRotationMsg(availability.reason); return; }
    rotationInFlight.current = true;
    setRotationBusy(true);
    setRotationMsg(`正在生成并保存第 ${rotationPlan.targetWeek} 周座位表…`);
    try {
      const result = await performWeeklyRotation(rotationPlan.sourceWeek, rotationPlan);
      setRotationRefreshNonce((value) => value + 1);
      setRotationMsg(
        result.cloudSynced
          ? `已完成并保存！${result.classCount} 个班级全部轮转到第 ${rotationPlan.targetWeek} 周。`
          : result.undoAvailable
            ? `当前浏览器已完成 ${result.classCount} 个班级的轮转，但云端保存失败；本地结果已保存，稍后可重试备份。`
            : `当前浏览器已完成 ${result.classCount} 个班级的轮转，但云端保存失败且未保留撤回快照；请先导出备份。`
      );
    } catch (error) {
      setRotationMsg(error instanceof Error ? error.message : '轮转失败');
    } finally {
      rotationInFlight.current = false;
      setRotationBusy(false);
    }
  }

  async function handleUndoRotation() {
    if (rotationInFlight.current) return;
    if (!window.confirm('确定撤回上次周轮转？所有班级将恢复到轮转前的状态。')) return;
    rotationInFlight.current = true;
    setRotationBusy(true);
    try {
      const result = await undoWeeklyRotation();
      if (result.restored) {
        setRotationRefreshNonce((value) => value + 1);
        setRotationMsg(result.cloudSynced
          ? '已撤回并同步，座位表恢复到轮转前。'
          : '当前浏览器已撤回，但云端同步失败；本地结果已保存。');
      } else {
        setRotationMsg('没有可撤回的记录。');
      }
    } catch (error) {
      setRotationMsg(error instanceof Error ? error.message : '撤回失败');
    } finally {
      rotationInFlight.current = false;
      setRotationBusy(false);
    }
  }

  function openGuide(anchor: GuideAnchor = 'top') {
    setGuideAnchor(anchor);
    setShowGuide(true);
  }

  function toggleGuide() {
    setGuideAnchor('top');
    setShowGuide((current) => !current);
  }

  return {
    week,
    start,
    end,
    showGuide,
    guideSrc,
    view,
    setView,
    openGuide,
    toggleGuide,
    displayClasses,
    showingLocalDrafts,
    classCards,
    daySchedule,
    versionInfo,
    versionStatus,
    batchFetchBusy,
    batchFetchStartedAt,
    batchFetchDurationSeconds,
    batchFetchRevision,
    batchFetchStatus,
    batchFetchDone,
    rosterSnapshot,
    showReLogin,
    scheduleImportStatus,
    handleBatchFetchAll,
    handleReLoginSuccess,
    handleReLoginDismiss,
    handleAuthenticationRequired,
    seatingClassCount,
    currentSeatingWeek: rotationPlan?.sourceWeek ?? null,
    latestSeatingWeek: rotationPlan?.latestSourceWeek ?? null,
    pendingSeatingModes: rotationPlan?.pendingModes ?? [],
    isSeatingCatchUp: Boolean(rotationPlan && rotationPlan.targetWeek <= week),
    nextSeatingWeek: rotationPlan?.targetWeek ?? null,
    rotationUnavailableReason: rotationAvailability.reason,
    rotationPanelState,
    rotationTitle,
    rotationDescription,
    rotationMsg,
    rotationBusy,
    canRunWeeklyRotation,
    canUndoWeeklyRotation: Boolean(lastRotation),
    handleWeeklyRotation,
    handleUndoRotation,
    termLaunch,
    dismissTermLaunch: () => setTermLaunch(null),
    handleForceRefresh: () => { void forceReloadTestSite(); },
    handleVersionReload: versionStatus.reloadToLatestVersion,
  };
}
