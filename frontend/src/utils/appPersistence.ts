import type { AppScreen, ClassInfo } from '../types';

const STATE_KEY = 'amber_app_state';

interface PersistedState {
  screen: AppScreen;
  teacherName: string;
  classes: ClassInfo[];
  selectedClass: ClassInfo | null;
}

// Navigation is a disposable cache, not a reason to evict seating or other
// teacher-owned data. Keep API snapshots out of this shared, limited storage.
function compactClass(value: ClassInfo): ClassInfo {
  return {
    id: value.id,
    name: value.name,
    squadId: value.squadId,
    relationship: value.relationship,
    sources: value.sources,
    type: value.type,
  };
}

export function saveAppCacheValue(key: string, value: string): boolean {
  try {
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
    return true;
  } catch {
    // QuotaExceededError / disabled storage must never break React's effects
    // or interrupt authenticated startup. Do not remove any existing key.
    return false;
  }
}

export function saveAppState(state: PersistedState): boolean {
  try {
    return saveAppCacheValue(STATE_KEY, JSON.stringify({
      screen: state.screen,
      teacherName: state.teacherName,
      classes: state.classes.map(compactClass),
      selectedClass: state.selectedClass ? compactClass(state.selectedClass) : null,
    }));
  } catch {
    return false;
  }
}

export function loadAppState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.screen || !parsed.teacherName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAppState(): void {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // Logout can still proceed when browser storage is unavailable.
  }
}
