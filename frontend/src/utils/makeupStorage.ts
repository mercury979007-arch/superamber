const LEGACY_STORAGE_KEY = 'amber_makeup_data';
const MULTI_STAGE_KEY = 'amber_makeup_stages';

export function hasStoredMakeupData(): boolean {
  try {
    const multiStage = localStorage.getItem(MULTI_STAGE_KEY);
    if (multiStage) {
      const parsed = JSON.parse(multiStage) as { stages?: Record<string, unknown> };
      if (parsed.stages && Object.keys(parsed.stages).length > 0) {
        return true;
      }
    }

    return Boolean(localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return false;
  }
}
