import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassInfo } from '../types';
import {
  getPreparedDailyReportStates,
  type RosterSnapshot,
} from '../services/rosterSnapshotService';
import {
  ClassControlApiError,
  classControlCycleKey,
  fetchClassControlAttendance,
  fetchClassControlTrendBatch,
  loadClassControlCache,
  mergeClassControlSummary,
  refreshClassControlSummary,
  saveClassControlCache,
  type ClassControlCycle,
  type ClassControlSummary,
} from '../services/classControlApi';

const REFRESH_CONCURRENCY = 1;

function mergeTrendCycles(cycles: ClassControlCycle[], planKeys?: string[]): ClassControlCycle[] {
  const byKey = new Map<string, ClassControlCycle>();
  for (const cycle of cycles) {
    if (!cycle?.rangeStart || !cycle?.rangeEnd || !cycle?.weekIds?.length) continue;
    byKey.set(classControlCycleKey(cycle), { ...cycle, role: 'trend' });
  }
  const allowed = planKeys?.length ? new Set(planKeys) : null;
  return [...byKey.entries()]
    .filter(([key]) => !allowed || allowed.has(key))
    .map(([, cycle]) => cycle)
    .sort((left, right) => left.rangeStart.localeCompare(right.rangeStart));
}

function seedTrendCycles(summary: ClassControlSummary | undefined): ClassControlCycle[] {
  if (!summary) return [];
  const seeds = [...(summary.trend || [])];
  if (summary.review?.task) seeds.push({ ...summary.review, role: 'trend' });
  if (summary.historical && summary.current?.task) seeds.push({ ...summary.current, role: 'trend' });
  return mergeTrendCycles(seeds, summary.trendPlanKeys);
}

export function useClassControlDashboard(
  classes: ClassInfo[],
  teacherName: string,
  onAuthenticationRequired?: () => void,
  preparedSnapshot: RosterSnapshot | null = null,
  autoRefreshPrepared = true,
) {
  const [summaries, setSummaries] = useState<Record<string, ClassControlSummary>>(() => (
    loadClassControlCache(teacherName)
  ));
  const [busyClasses, setBusyClasses] = useState<Set<string>>(() => new Set());
  const [trendBusyClasses, setTrendBusyClasses] = useState<Set<string>>(() => new Set());
  const [attendanceBusyClasses, setAttendanceBusyClasses] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const authenticationNotified = useRef(false);
  const summariesRef = useRef(summaries);
  const classRefreshJobs = useRef(new Map<string, Promise<ClassControlSummary | null>>());
  const preparedSyncRunKey = useRef('');
  const trendJobs = useRef(new Map<string, Promise<void>>());
  const attendanceJobs = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    const cached = loadClassControlCache(teacherName);
    summariesRef.current = cached;
    preparedSyncRunKey.current = '';
    setSummaries(cached);
    setErrors({});
    authenticationNotified.current = false;
  }, [teacherName]);

  const updateClassSummary = useCallback((
    classId: string,
    updater: (current: ClassControlSummary | undefined) => ClassControlSummary,
  ) => {
    setSummaries((current) => {
      const next = { ...current, [classId]: updater(current[classId]) };
      summariesRef.current = next;
      saveClassControlCache(teacherName, next);
      return next;
    });
  }, [teacherName]);

  const refreshOne = useCallback(async (classInfo: ClassInfo) => {
    const classId = String(classInfo.name || classInfo.id || '').trim().toUpperCase();
    if (!classId) return null;
    const activeJob = classRefreshJobs.current.get(classId);
    if (activeJob) return activeJob;
    const job = (async () => {
      setBusyClasses((current) => new Set(current).add(classId));
      setErrors((current) => {
        const next = { ...current };
        delete next[classId];
        return next;
      });
      try {
        const summary = await refreshClassControlSummary(classId);
        updateClassSummary(classId, (current) => mergeClassControlSummary(current, summary));
        return summary;
      } catch (error) {
        if (error instanceof ClassControlApiError && error.status === 401 && !authenticationNotified.current) {
          authenticationNotified.current = true;
          onAuthenticationRequired?.();
        }
        setErrors((current) => ({
          ...current,
          [classId]: error instanceof Error ? error.message : '班级数据读取失败',
        }));
        return null;
      } finally {
        setBusyClasses((current) => {
          const next = new Set(current);
          next.delete(classId);
          return next;
        });
      }
    })();
    classRefreshJobs.current.set(classId, job);
    try {
      return await job;
    } finally {
      classRefreshJobs.current.delete(classId);
    }
  }, [onAuthenticationRequired, updateClassSummary]);

  const preparedTaskStates = useMemo(
    () => getPreparedDailyReportStates(preparedSnapshot, classes),
    [classes, preparedSnapshot],
  );

  useEffect(() => {
    if (!autoRefreshPrepared) return;
    if (classes.length === 0) return;
    const candidates = classes.filter((classInfo) => {
      const classId = String(classInfo.name || classInfo.id || '').trim().toUpperCase();
      const prepared = preparedTaskStates[classId];
      if (!summariesRef.current[classId]) return prepared?.state !== 'ready-empty';
      if (!preparedSnapshot?.updatedAt || prepared?.state !== 'ready-data') return false;
      const summaryTime = Date.parse(summariesRef.current[classId]?.updatedAt || '');
      const preparedTime = Date.parse(prepared.updatedAt || preparedSnapshot.updatedAt || '');
      return !Number.isFinite(summaryTime) || !Number.isFinite(preparedTime) || summaryTime < preparedTime;
    });
    const runKey = `${preparedSnapshot?.updatedAt || 'no-snapshot'}:${candidates.map((item) => item.name.toUpperCase()).sort().join('|')}`;
    if (!candidates.length || preparedSyncRunKey.current === runKey) return;
    preparedSyncRunKey.current = runKey;
    let cancelled = false;
    void (async () => {
      for (const classInfo of candidates) {
        if (cancelled || authenticationNotified.current) return;
        await refreshOne(classInfo);
      }
    })();
    return () => { cancelled = true; };
  }, [autoRefreshPrepared, classes, preparedSnapshot, preparedTaskStates, refreshOne]);

  const refreshAll = useCallback(async () => {
    if (classes.length === 0 || refreshingAll) return;
    setRefreshingAll(true);
    const prioritized = [...classes].sort((left, right) => left.name.localeCompare(right.name));
    let cursor = 0;
    async function worker() {
      while (cursor < prioritized.length) {
        if (authenticationNotified.current) return;
        const index = cursor;
        cursor += 1;
        await refreshOne(prioritized[index]);
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, prioritized.length) }, () => worker()));
    } finally {
      setRefreshingAll(false);
    }
  }, [classes, refreshOne, refreshingAll, summaries]);

  const updateTimes = Object.values(summaries)
    .map((summary) => summary.updatedAt)
    .filter(Boolean)
    .sort();
  const updatedAt = updateTimes[updateTimes.length - 1] || '';
  const loadTrend = useCallback(async (classInfo: ClassInfo) => {
    const classId = String(classInfo.name || classInfo.id || '').trim().toUpperCase();
    if (!classId) return;
    if (trendJobs.current.has(classId)) return trendJobs.current.get(classId);
    const job = (async () => {
      setTrendBusyClasses((current) => new Set(current).add(classId));
      let collected = seedTrendCycles(summariesRef.current[classId]);
      updateClassSummary(classId, (current) => ({
        ...(current as ClassControlSummary),
        trend: collected,
        trendExpectedCount: current?.trendExpectedCount || Math.max(4, collected.length),
        trendComplete: current?.trendComplete === true,
      }));
      try {
        for (let batchIndex = 0; batchIndex < 3; batchIndex += 1) {
          const knownCycleKeys = collected.map(classControlCycleKey);
          const batch = await fetchClassControlTrendBatch(classId, knownCycleKeys);
          collected = mergeTrendCycles(
            [...collected, ...batch.trend],
            batch.trendPlanKeys,
          );
          updateClassSummary(classId, (current) => ({
            ...(current as ClassControlSummary),
            preferredSemester: batch.preferredSemester || current?.preferredSemester || '',
            historical: batch.historical,
            trend: collected,
            trendPlanKeys: batch.trendPlanKeys,
            trendExpectedCount: batch.trendExpectedCount,
            trendComplete: batch.trendComplete,
            trendUpdatedAt: batch.updatedAt,
          }));
          if (batch.trendComplete || batch.trendRemainingCount <= 0) break;
        }
      } catch (error) {
        if (error instanceof ClassControlApiError && error.status === 401 && !authenticationNotified.current) {
          authenticationNotified.current = true;
          onAuthenticationRequired?.();
        }
        setErrors((current) => ({
          ...current,
          [classId]: error instanceof Error ? error.message : '四周趋势读取失败',
        }));
      } finally {
        setTrendBusyClasses((current) => {
          const next = new Set(current);
          next.delete(classId);
          return next;
        });
      }
    })();
    trendJobs.current.set(classId, job);
    try {
      await job;
    } finally {
      trendJobs.current.delete(classId);
    }
  }, [onAuthenticationRequired, updateClassSummary]);

  const loadAttendance = useCallback(async (classInfo: ClassInfo) => {
    const classId = String(classInfo.name || classInfo.id || '').trim().toUpperCase();
    if (!classId || summariesRef.current[classId]?.attendance !== undefined) return;
    if (attendanceJobs.current.has(classId)) return attendanceJobs.current.get(classId);
    const job = (async () => {
      setAttendanceBusyClasses((current) => new Set(current).add(classId));
      try {
        const result = await fetchClassControlAttendance(classId);
        updateClassSummary(classId, (current) => ({
          ...(current as ClassControlSummary),
          attendance: result.attendance,
          attendanceError: result.attendanceError,
        }));
      } catch (error) {
        if (error instanceof ClassControlApiError && error.status === 401 && !authenticationNotified.current) {
          authenticationNotified.current = true;
          onAuthenticationRequired?.();
        }
        updateClassSummary(classId, (current) => ({
          ...(current as ClassControlSummary),
          attendance: null,
          attendanceError: error instanceof Error ? error.message : '考勤数据读取失败',
        }));
      } finally {
        setAttendanceBusyClasses((current) => {
          const next = new Set(current);
          next.delete(classId);
          return next;
        });
      }
    })();
    attendanceJobs.current.set(classId, job);
    try {
      await job;
    } finally {
      attendanceJobs.current.delete(classId);
    }
  }, [onAuthenticationRequired, updateClassSummary]);

  return {
    summaries,
    busyClasses,
    trendBusyClasses,
    attendanceBusyClasses,
    preparedTaskStates,
    errors,
    refreshingAll,
    updatedAt,
    refreshAll,
    refreshOne,
    loadTrend,
    loadAttendance,
  };
}
