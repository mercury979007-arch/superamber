import { describe, expect, it, vi } from 'vitest';
import { detectRuntimeEnvironment, filterEnabledFeatures, isFeatureEnabled } from './featureRegistry';

describe('featureRegistry', () => {
  it('treats the test host as test environment even before version info is loaded', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'staging.example.invalid' },
    });

    expect(detectRuntimeEnvironment(null)).toBe('test');
    expect(isFeatureEnabled('camp-report', null)).toBe(true);
  });

  it('hides the classroom agent and camp report from production', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'superamber.example.invalid' },
    });

    expect(detectRuntimeEnvironment({ environment: 'production' } as never)).toBe('production');
    expect(isFeatureEnabled('classroom-agent', { environment: 'production' } as never)).toBe(false);
    expect(isFeatureEnabled('camp-report', { environment: 'production' } as never)).toBe(false);
    expect(isFeatureEnabled('camp-schedule', { environment: 'production' } as never)).toBe(false);
    expect(isFeatureEnabled('class-control', { environment: 'production' } as never)).toBe(true);
    expect(isFeatureEnabled('daily-report', { environment: 'production' } as never)).toBe(true);
  });

  it('makes the approved report and class overview public without changing private capabilities', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'staging.example.invalid' },
    });
    expect(isFeatureEnabled('class-control', null)).toBe(true);

    vi.stubGlobal('window', {
      location: { hostname: 'unexpected.example.com' },
    });
    expect(detectRuntimeEnvironment(null)).toBe('unknown');
    expect(isFeatureEnabled('class-control', null)).toBe(true);
  });

  it('filters test-only screens out of production entry lists', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'superamber.example.invalid' },
    });

    expect(filterEnabledFeatures(
      ['daily-report', 'camp-report', 'camp-schedule', 'usage-insights', 'test-score-entry'],
      { environment: 'stable' } as never,
    )).toEqual(['daily-report']);
  });
});
