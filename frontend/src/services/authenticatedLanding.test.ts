import { describe, expect, it } from 'vitest';
import { resolveAuthenticatedLanding } from './authenticatedLanding';

describe('resolveAuthenticatedLanding', () => {
  it('always sends an ordinary authenticated visit to the welcome page', () => {
    expect(resolveAuthenticatedLanding(null, { id: 'old', name: 'J413' })).toEqual({
      screen: 'welcome',
      selectedClass: null,
    });
  });

  it('preserves an explicitly requested standalone tool', () => {
    const campClass = { id: 'camp', name: 'Sparkchat Camp' };
    expect(resolveAuthenticatedLanding('seating', campClass)).toEqual({
      screen: 'seating',
      selectedClass: campClass,
    });
    expect(resolveAuthenticatedLanding('camp-report', null)).toEqual({
      screen: 'camp-report',
      selectedClass: null,
    });
  });
});
