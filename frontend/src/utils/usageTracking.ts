import type { AppScreen } from '../types';

interface UsageEventPayload {
  event: string;
  module: string;
  teacherName?: string;
  className?: string;
  screen?: string;
  detail?: string;
}

const MODULE_BY_SCREEN: Partial<Record<AppScreen, string>> = {
  welcome: 'welcome',
  hub: 'class-hub',
  flow: 'mp-distribution',
  seating: 'seating',
  overview: 'overview',
  makeup: 'makeup',
  'camp-report': 'camp-report',
  'daily-report': 'daily-report',
  roster: 'roster',
  'usage-insights': 'usage-insights',
  'test-score-entry': 'test-score-entry',
};

export function inferModuleFromScreen(screen: AppScreen): string {
  return MODULE_BY_SCREEN[screen] || '';
}

export async function trackUsageEvent(payload: UsageEventPayload): Promise<void> {
  if (!payload.event || !payload.module) return;

  try {
    await fetch('/api/usage-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch {
    // Usage tracking should never block the user flow.
  }
}
