import type { AppScreen } from '../types';
import type { VersionInfo } from './versionInfo';

export type RuntimeEnvironment = 'test' | 'production' | 'unknown';
export type FeatureAudience = 'all' | 'test-only';
export type FeatureKey = AppScreen | 'class-control';

export interface FeatureCapability {
  screen: FeatureKey;
  audience: FeatureAudience;
  badge?: string;
}

const TEST_HOST_PATTERN = /(^|\.)staging\.example\.invalid$/i;

const FEATURE_CAPABILITIES: Record<FeatureKey, FeatureCapability> = {
  login: { screen: 'login', audience: 'all' },
  welcome: { screen: 'welcome', audience: 'all' },
  hub: { screen: 'hub', audience: 'all' },
  flow: { screen: 'flow', audience: 'all' },
  seating: { screen: 'seating', audience: 'all' },
  overview: { screen: 'overview', audience: 'all' },
  'communication-planner': { screen: 'communication-planner', audience: 'all' },
  makeup: { screen: 'makeup', audience: 'all' },
  'daily-report': { screen: 'daily-report', audience: 'all' },
  'classroom-agent': { screen: 'classroom-agent', audience: 'test-only', badge: '测试站' },
  roster: { screen: 'roster', audience: 'all' },
  'usage-insights': { screen: 'usage-insights', audience: 'test-only', badge: '测试站' },
  'data-review': { screen: 'data-review', audience: 'test-only', badge: '测试站' },
  'test-score-entry': { screen: 'test-score-entry', audience: 'test-only', badge: '测试站' },
  'camp-report': { screen: 'camp-report', audience: 'test-only', badge: '测试站' },
  'camp-schedule': { screen: 'camp-schedule', audience: 'test-only', badge: '测试站' },
  'summer-camp': { screen: 'summer-camp', audience: 'all' },
  'class-control': { screen: 'class-control', audience: 'all' },
};

function isTestHost(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || TEST_HOST_PATTERN.test(host);
}

function normalizeEnvironment(raw: string): RuntimeEnvironment {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) {
    return 'unknown';
  }
  if (
    value === 'test'
    || value === 'staging'
    || value === 'stage'
    || value === 'dev'
    || value === 'development'
  ) {
    return 'test';
  }
  if (
    value === 'production'
    || value === 'prod'
    || value === 'stable'
    || value === 'main'
    || value === 'master'
  ) {
    return 'production';
  }
  return 'unknown';
}

export function detectRuntimeEnvironment(versionInfo: Pick<VersionInfo, 'environment'> | null | undefined): RuntimeEnvironment {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'test';
  }

  if (typeof window !== 'undefined' && isTestHost(window.location.hostname)) {
    return 'test';
  }

  const normalized = normalizeEnvironment(versionInfo?.environment || '');
  return normalized;
}

export function getFeatureCapability(screen: FeatureKey): FeatureCapability {
  return FEATURE_CAPABILITIES[screen];
}

export function isFeatureEnabled(screen: FeatureKey, versionInfo: Pick<VersionInfo, 'environment'> | null | undefined): boolean {
  const capability = getFeatureCapability(screen);
  if (capability.audience !== 'test-only') {
    return true;
  }
  return detectRuntimeEnvironment(versionInfo) === 'test';
}

export function filterEnabledFeatures(screens: AppScreen[], versionInfo: Pick<VersionInfo, 'environment'> | null | undefined): AppScreen[] {
  return screens.filter((screen) => isFeatureEnabled(screen, versionInfo));
}
