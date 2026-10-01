import { describe, expect, it } from 'vitest';
import { weeklyRotationAvailability as available } from './weeklyRotationAvailability';
describe('weekly generation uses the Shanghai Sunday boundary', () => {
  it('keeps next week locked Monday through Saturday', () => {
    for (const day of ['07', '08', '09', '10', '11', '12']) expect(available(3, new Date(`2026-09-${day}T04:00:00Z`)).allowed).toBe(false);
    expect(available(3, new Date('2026-09-12T15:59:59Z')).allowed).toBe(false);
  });
  it('opens on Sunday at midnight, and cannot advance twice into future weeks', () => {
    expect(available(3, new Date('2026-09-12T16:00:00Z')).allowed).toBe(true);
    expect(available(4, new Date('2026-09-13T04:00:00Z')).allowed).toBe(false);
  });
  it('allows missed current weeks every day without unlocking the following week', () => {
    expect(available(2, new Date('2026-09-07T04:00:00Z')).allowed).toBe(true);
    expect(available(2, new Date('2026-09-13T04:00:00Z')).allowed).toBe(true);
    expect(available(3, new Date('2026-09-14T04:00:00Z')).allowed).toBe(true);
    expect(available(3, new Date('2026-09-13T16:00:00Z')).allowed).toBe(true);
    expect(available(undefined).allowed).toBe(false);
  });
});
