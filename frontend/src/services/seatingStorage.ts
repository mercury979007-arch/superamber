import {
  removeStorageValue,
  storageKeys,
  writeCurrentStorageValueSafely
} from '../seating/appMeta';
import { loadClassData, loadBatchUndoData, saveBatchUndoData } from '../seating/storage';
import { makeClassShell } from '../seating/state';
import type { AcademicTermLaunchMeta, ClassData, ReminderNote } from '../seating/types';

const LAST_ROTATION_KEY = 'superamberLastWeeklyRotation';
const ACADEMIC_TERM_LAUNCH_KEY = 'superamberAcademicTermLaunch';

export interface WeeklyRotationInfo {
  week: number;
  timestamp: string;
}

export function normalizeReminderNotes(notes: unknown): ReminderNote[] {
  if (!Array.isArray(notes)) {
    return [];
  }

  return notes
    .reduce<ReminderNote[]>((list, item, index) => {
      if (!item || typeof item !== 'object') {
        return list;
      }

      const note = item as Partial<ReminderNote>;
      const text = String(note.text || '').trim();
      const dueDate = String(note.dueDate || '').trim();
      if (!text || !dueDate) {
        return list;
      }

      list.push({
        id: String(note.id || `todo-${index}`),
        text,
        dueDate,
        source: note.source === 'weekly' ? 'weekly' : 'manual',
        completed: note.completed === true,
        createdAt: String(note.createdAt || new Date().toISOString()),
        completedAt: typeof note.completedAt === 'string' ? note.completedAt : null,
      });

      return list;
    }, [])
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.createdAt.localeCompare(right.createdAt));
}

export function loadMergedSeatingClassData(): ClassData {
  return loadClassData();
}

export function saveSeatingClassData(data: ClassData): boolean {
  return writeCurrentStorageValueSafely(storageKeys.classData, JSON.stringify(data));
}

export function loadSeatingNotesByClass(): Record<string, ReminderNote[]> {
  const classData = loadMergedSeatingClassData();
  const result: Record<string, ReminderNote[]> = {};

  Object.entries(classData).forEach(([classCode, config]) => {
    result[classCode.toUpperCase()] = normalizeReminderNotes(config?.todoNotes);
  });

  return result;
}

export function appendSeatingTodoNote(
  classCode: string,
  text: string,
  dueDate: string,
  source: ReminderNote['source'],
): void {
  const normalizedClassCode = classCode.trim().toUpperCase();
  const normalizedText = text.trim();
  const normalizedDueDate = dueDate.trim();
  if (!normalizedClassCode || !normalizedText || !normalizedDueDate) {
    return;
  }

  const classData = loadMergedSeatingClassData();
  const existing = classData[normalizedClassCode];
  const baseConfig = existing || makeClassShell();
  const todoNote: ReminderNote = {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: normalizedText,
    dueDate: normalizedDueDate,
    source,
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  classData[normalizedClassCode] = {
    ...baseConfig,
    todoNotes: normalizeReminderNotes([...(baseConfig.todoNotes || []), todoNote]),
  };

  saveSeatingClassData(classData);
}

export function getSeatingClassCount(): number {
  return Object.keys(loadMergedSeatingClassData()).length;
}

export function getSeatingDateKeys(): string[] {
  const classData = loadMergedSeatingClassData();
  const keys = new Set<string>();

  Object.values(classData).forEach((config) => {
    [config.weekday, config.weekend].forEach((mode) => {
      const fullDate = mode?.locationInfo?.fullDate || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(fullDate)) {
        keys.add(fullDate);
      }
    });
  });

  return [...keys];
}

export function loadWeeklyRotationUndoSnapshot(): ClassData | null {
  return loadBatchUndoData();
}

export function saveWeeklyRotationUndoSnapshot(data: ClassData): boolean {
  return saveBatchUndoData(data);
}

export function clearWeeklyRotationUndoSnapshot(): void {
  removeStorageValue(storageKeys.batchUndo);
}

export function getLastWeeklyRotationInfo(): WeeklyRotationInfo | null {
  try {
    const raw = localStorage.getItem(LAST_ROTATION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WeeklyRotationInfo>;
    if (!Number.isFinite(parsed.week) || typeof parsed.timestamp !== 'string') {
      return null;
    }

    return {
      week: Number(parsed.week),
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

export function saveLastWeeklyRotationInfo(info: WeeklyRotationInfo): void {
  localStorage.setItem(LAST_ROTATION_KEY, JSON.stringify(info));
}

export function clearLastWeeklyRotationInfo(): void {
  localStorage.removeItem(LAST_ROTATION_KEY);
}

export function loadAcademicTermLaunchInfo(): AcademicTermLaunchMeta | null {
  try {
    const raw = localStorage.getItem(ACADEMIC_TERM_LAUNCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AcademicTermLaunchMeta>;
    if (typeof parsed.termId !== 'string'
      || typeof parsed.week1Start !== 'string'
      || typeof parsed.completedAt !== 'string'
      || !Array.isArray(parsed.rotatedClassCodes)) {
      return null;
    }
    return {
      termId: parsed.termId,
      week1Start: parsed.week1Start,
      completedAt: parsed.completedAt,
      rotatedClassCodes: [...new Set(parsed.rotatedClassCodes.map((code) => String(code).trim().toUpperCase()).filter(Boolean))],
    };
  } catch {
    return null;
  }
}

export function saveAcademicTermLaunchInfo(info: AcademicTermLaunchMeta): void {
  localStorage.setItem(ACADEMIC_TERM_LAUNCH_KEY, JSON.stringify(info));
}
