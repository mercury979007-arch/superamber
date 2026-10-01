import { getWeek1StartDate, getWeekNumberForDate } from '../utils/weekNumber';
import { countModeStudents } from '../seating/emptySeatingGeneration';
import { rotateLocationInfoByWeek, rotateTimeModeData } from '../seating/layoutOperations';
import { addDays, dateKeyToMonthDay } from '../seating/calendar';
import { APP_NAME, APP_SLUG } from '../seating/appMeta';
import type { BackupPayload } from '../seating/backupData';
import type { ClassData, LocationInfo, TimeMode } from '../seating/types';
import { fetchSeatingBackup, saveSeatingBackup } from './seatingBackupApi';
import {
  clearLastWeeklyRotationInfo,
  clearWeeklyRotationUndoSnapshot,
  getLastWeeklyRotationInfo,
  getSeatingClassCount as getStoredSeatingClassCount,
  getSeatingDateKeys as getStoredSeatingDateKeys,
  loadMergedSeatingClassData,
  loadWeeklyRotationUndoSnapshot,
  saveLastWeeklyRotationInfo,
  saveSeatingClassData,
  saveWeeklyRotationUndoSnapshot,
} from './seatingStorage';

export interface WeeklyRotationResult {
  classCount: number;
  undoAvailable: boolean;
  cloudSynced: boolean;
}

export interface WeeklyRotationUndoResult {
  restored: boolean;
  cloudSynced: boolean;
}

export interface WeeklyRotationScope {
  currentWeekStart: string;
  currentWeekEnd: string;
  classCodes?: string[];
  requireSavedSeating?: boolean;
  expectedLocalData?: string;
}

export interface WeeklyRotationPlan extends WeeklyRotationScope {
  sourceWeek: number;
  targetWeek: number;
  classCount: number;
  latestSourceWeek: number;
  pendingModes: Array<{ classCode: string; mode: TimeMode; week: number }>;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getWeeklyRotationPlan(activeClassCodes: string[]): WeeklyRotationPlan | null {
  const active = new Set(activeClassCodes.map((code) => code.trim().toUpperCase()));
  const data = loadMergedSeatingClassData();
  const classCodes = Object.keys(data).filter((code) => active.has(code.trim().toUpperCase()));
  const termStart = dateKey(getWeek1StartDate());
  const dates = classCodes.flatMap((code) => [data[code].weekday, data[code].weekend])
    .filter((mode) => countModeStudents(mode) > 0)
    .map((mode) => mode.locationInfo.fullDate || '')
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)
      && key >= termStart && dateKey(new Date(`${key}T12:00:00`)) === key).sort();
  if (!dates.length) return null;
  const monday = new Date(`${dates[0]}T12:00:00`);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sourceWeek = getWeekNumberForDate(monday);
  const scope = {
    currentWeekStart: dateKey(monday), currentWeekEnd: dateKey(sunday),
    classCodes, requireSavedSeating: true,
    expectedLocalData: JSON.stringify(classCodes.map((code) => [code, data[code]])),
  };
  return {
    ...scope, sourceWeek, targetWeek: sourceWeek + 1,
    latestSourceWeek: getWeekNumberForDate(new Date(`${dates[dates.length - 1]}T12:00:00`)),
    pendingModes: classCodes.flatMap((code) => (['weekday', 'weekend'] as const)
      .filter((mode) => isModeInRotationScope(data[code][mode], scope))
      .map((mode) => ({ classCode: code, mode, week: sourceWeek }))),
    classCount: classCodes.filter((code) => [data[code].weekday, data[code].weekend]
      .some((mode) => isModeInRotationScope(mode, scope))).length,
  };
}

function isModeInRotationScope(mode: ClassData[string][TimeMode], scope: WeeklyRotationScope): boolean {
  if (scope.requireSavedSeating && countModeStudents(mode) === 0) return false;
  const dateKey = String(mode?.locationInfo?.fullDate || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
    && dateKey >= scope.currentWeekStart
    && dateKey <= scope.currentWeekEnd;
}

async function syncRotatedClassData(
  classData: ClassData,
  batchUndo: ClassData | null,
  options: { allowDateRegression?: boolean } = {},
): Promise<boolean> {
  try {
    const remote = await fetchSeatingBackup();
    const now = new Date().toISOString();
    const payload: BackupPayload = remote
      ? {
          ...remote,
          exportedAt: now,
          sourceOrigin: window.location.origin,
          classData: { ...remote.classData, ...classData },
          batchUndo,
        }
      : {
          app: { name: APP_NAME, slug: APP_SLUG },
          exportedAt: now,
          sourceOrigin: window.location.origin,
          classData,
          userProfile: { username: '', theme: 'paper' },
          batchUndo,
        };
    await saveSeatingBackup(payload, options);
    return true;
  } catch {
    return false;
  }
}

export function getLastRotationInfo() {
  return getLastWeeklyRotationInfo();
}

export function hasRotatedThisWeek(currentWeek: number): boolean {
  return getLastRotationInfo()?.week === currentWeek;
}

export function getSeatingClassCount(): number {
  return getStoredSeatingClassCount();
}

export function getSeatingDateKeys(): string[] {
  return getStoredSeatingDateKeys();
}

export async function performWeeklyRotation(
  currentWeek: number,
  scope?: WeeklyRotationScope,
): Promise<WeeklyRotationResult> {
  const classData = loadMergedSeatingClassData();
  if (scope?.expectedLocalData && scope.expectedLocalData !== JSON.stringify(
    scope.classCodes?.map((code) => [code, classData[code]]),
  )) throw new Error('本地座位已发生变化，请重新打开首页后再生成。');
  const allowed = scope?.classCodes ? new Set(scope.classCodes) : null;
  const classNames = Object.keys(classData).filter((className) => (!allowed || allowed.has(className)) && (
    !scope
    || isModeInRotationScope(classData[className].weekday, scope)
    || isModeInRotationScope(classData[className].weekend, scope)
  ));

  if (classNames.length === 0) {
    throw new Error('没有座位表数据，请先在座位表中创建班级。');
  }

  const beforeRotation = JSON.parse(JSON.stringify(classData)) as ClassData;

  for (const className of classNames) {
    const current = classData[className];
    const previousWeek = {
      theme: current.theme,
      weekday: current.weekday,
      weekend: current.weekend,
    };
    classData[className] = {
      ...current,
      previousWeek,
      weekday: !scope || isModeInRotationScope(current.weekday, scope)
        ? rotateTimeModeData(current.weekday, rotateLocationInfoByWeek(current.weekday.locationInfo))
        : current.weekday,
      weekend: !scope || isModeInRotationScope(current.weekend, scope)
        ? rotateTimeModeData(current.weekend, rotateLocationInfoByWeek(current.weekend.locationInfo))
        : current.weekend,
    };
  }

  if (!saveSeatingClassData(classData)) {
    throw new Error('浏览器空间不足，座位表没有保存，也没有推进到下一周。');
  }
  const persisted = loadMergedSeatingClassData();
  if (classNames.some((code) => JSON.stringify(persisted[code]) !== JSON.stringify(classData[code]))) {
    throw new Error('本地座位保存核对失败，未确认生成成功。');
  }
  // Primary seating gets storage priority. An optional undo copy must never
  // consume the space required to persist the actual new week.
  const undoAvailable = saveWeeklyRotationUndoSnapshot(beforeRotation);
  if (!undoAvailable) clearWeeklyRotationUndoSnapshot();
  const timestamp = new Date().toISOString();
  try {
    saveLastWeeklyRotationInfo({ week: currentWeek, timestamp });
  } catch {
    // The dates themselves are the source of truth; the marker is only UI metadata.
  }
  const cloudSynced = await syncRotatedClassData(
    Object.fromEntries(classNames.map((code) => [code, classData[code]])),
    undoAvailable ? beforeRotation : null,
    { allowDateRegression: true },
  );

  return { classCount: classNames.length, undoAvailable, cloudSynced };
}

const CHINESE_WEEKDAY_INDEX: Record<string, number> = {
  '周一': 0,
  '星期一': 0,
  '周二': 1,
  '星期二': 1,
  '周三': 2,
  '星期三': 2,
  '周四': 3,
  '星期四': 3,
  '周五': 4,
  '星期五': 4,
  '周六': 5,
  '星期六': 5,
  '周日': 6,
  '星期日': 6,
  '周天': 6,
  '星期天': 6,
};

function resolveWeekdayOffset(locationInfo: LocationInfo, mode: TimeMode): number {
  const normalized = String(locationInfo.weekday || '').trim();
  if (normalized in CHINESE_WEEKDAY_INDEX) {
    return CHINESE_WEEKDAY_INDEX[normalized];
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(locationInfo.fullDate || '')) {
    const date = new Date(`${locationInfo.fullDate}T12:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return (date.getDay() + 6) % 7;
    }
  }

  return mode === 'weekend' ? 6 : 0;
}

function alignLocationInfoToWeekOne(locationInfo: LocationInfo, mode: TimeMode, week1Start: string): LocationInfo {
  const targetDate = addDays(week1Start, resolveWeekdayOffset(locationInfo, mode)) || week1Start;
  const parts = dateKeyToMonthDay(targetDate);
  if (!parts) return { ...locationInfo };
  return {
    ...locationInfo,
    fullDate: targetDate,
    date: parts.month,
    day: parts.day,
    weekday: parts.weekday,
  };
}

export function buildAcademicTermLaunchClassData(
  source: ClassData,
  activeClassCodes: string[],
  week1Start: string,
): { classData: ClassData; rotatedClassCodes: string[] } {
  const activeCodes = new Set(activeClassCodes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const classData: ClassData = { ...source };
  const rotatedClassCodes: string[] = [];

  Object.entries(source).forEach(([className, current]) => {
    const normalizedClassName = className.trim().toUpperCase();
    if (!activeCodes.has(normalizedClassName)) return;

    const previousWeek = {
      theme: current.theme,
      weekday: current.weekday,
      weekend: current.weekend,
    };
    classData[className] = {
      ...current,
      previousWeek,
      weekday: rotateTimeModeData(
        current.weekday,
        alignLocationInfoToWeekOne(current.weekday.locationInfo, 'weekday', week1Start),
      ),
      weekend: rotateTimeModeData(
        current.weekend,
        alignLocationInfoToWeekOne(current.weekend.locationInfo, 'weekend', week1Start),
      ),
    };
    rotatedClassCodes.push(normalizedClassName);
  });

  return { classData, rotatedClassCodes };
}

export async function undoWeeklyRotation(): Promise<WeeklyRotationUndoResult> {
  const snapshot = loadWeeklyRotationUndoSnapshot();
  if (!snapshot) {
    return { restored: false, cloudSynced: false };
  }

  if (!saveSeatingClassData(snapshot)) {
    throw new Error('浏览器空间不足，座位表未能撤回。');
  }
  clearWeeklyRotationUndoSnapshot();
  clearLastWeeklyRotationInfo();
  const cloudSynced = await syncRotatedClassData(snapshot, null, { allowDateRegression: true });
  return { restored: true, cloudSynced };
}
