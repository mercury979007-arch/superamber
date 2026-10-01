import { DEFAULT_TODO_META, type TodoMetaState } from './welcomeTodoRules';
import { saveAppCacheValue } from '../utils/appPersistence';

const TODO_META_KEY = 'amber_welcome_todo_meta_v1';

export function loadWelcomeTodoMeta(): TodoMetaState {
  try {
    const raw = localStorage.getItem(TODO_META_KEY);
    if (!raw) {
      return DEFAULT_TODO_META;
    }

    const parsed = JSON.parse(raw) as Partial<TodoMetaState>;
    return {
      enabled: parsed.enabled === true,
      weeklyConfirmedWeek: Number.isFinite(parsed.weeklyConfirmedWeek) ? Number(parsed.weeklyConfirmedWeek) : 0,
      weeklyConfirmedAt: typeof parsed.weeklyConfirmedAt === 'string' ? parsed.weeklyConfirmedAt : '',
      completedByDate: parsed.completedByDate && typeof parsed.completedByDate === 'object'
        ? parsed.completedByDate
        : {},
    };
  } catch {
    return DEFAULT_TODO_META;
  }
}

export function saveWelcomeTodoMeta(meta: TodoMetaState): boolean {
  return saveAppCacheValue(TODO_META_KEY, JSON.stringify(meta));
}
