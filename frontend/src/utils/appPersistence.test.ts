// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppState, loadAppState, saveAppCacheValue, saveAppState } from './appPersistence';
import type { ClassInfo } from '../types';

const sample = {
  screen: 'welcome' as const,
  teacherName: 'Teacher',
  classes: [{ id: 'K218', name: 'K218', squadId: '218', type: 'offline' as const }],
  selectedClass: null,
};

describe('non-destructive app state persistence', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('round-trips lightweight class identity and navigation', () => {
    expect(saveAppState(sample)).toBe(true);
    expect(loadAppState()).toEqual(sample);
  });

  it('does not persist runtime roster snapshots or extra API fields', () => {
    const runtimeClass = { ...sample.classes[0], rosterSnapshot: 'x'.repeat(1_000_000), students: ['private'] };
    expect(saveAppState({ ...sample, classes: [runtimeClass], selectedClass: runtimeClass })).toBe(true);
    const saved = localStorage.getItem('amber_app_state')!;
    expect(saved.length).toBeLessThan(500);
    expect(saved).not.toContain('rosterSnapshot');
    expect(saved).not.toContain('students');
    expect(loadAppState()?.selectedClass).toEqual(sample.classes[0]);
    expect(runtimeClass.rosterSnapshot.length).toBe(1_000_000);
  });

  it('preserves old navigation, seating, notes and every other key when full', () => {
    localStorage.setItem('superamberClassData', '{"K218":{"notes":["keep"]}}');
    localStorage.setItem('classSeatingData', '{"legacy":"keep"}');
    localStorage.setItem('amber_app_state', JSON.stringify(sample));
    localStorage.setItem('other-business-data', 'keep');
    const before = { ...localStorage };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const clear = vi.spyOn(Storage.prototype, 'clear');
    expect(saveAppState({ ...sample, teacherName: 'Updated' })).toBe(false);
    expect(saveAppCacheValue('amber_username', 'Updated')).toBe(false);
    expect(saveAppCacheValue('amber_class_list_refreshed_at', '1')).toBe(false);
    expect({ ...localStorage }).toEqual(before);
    expect(loadAppState()).toEqual(sample);
    expect(remove).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('skips unchanged writes even at quota', () => {
    saveAppState(sample);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveAppState(sample)).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('tolerates blocked reads and removes without affecting startup or logout', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(loadAppState()).toBeNull();
    expect(saveAppState(sample)).toBe(false);
    expect(() => clearAppState()).not.toThrow();
  });

  it('can load an old oversized snapshot and save it compactly without losing seating', () => {
    const old = { ...sample, classes: [{ ...sample.classes[0], rosterSnapshot: 'x'.repeat(1_000_000) }] };
    localStorage.setItem('amber_app_state', JSON.stringify(old));
    localStorage.setItem('superamberClassData', '{"K218":{"weekday":{"groups":[["student"]]}}}');
    const seating = localStorage.getItem('superamberClassData');
    expect(saveAppState(loadAppState()!)).toBe(true);
    expect(localStorage.getItem('amber_app_state')!.length).toBeLessThan(500);
    expect(localStorage.getItem('superamberClassData')).toBe(seating);
  });

  it('tolerates unserializable optional metadata', () => {
    const circular: unknown[] = [];
    circular.push(circular);
    expect(saveAppState({ ...sample, classes: [{ ...sample.classes[0], sources: circular } as ClassInfo] })).toBe(false);
  });
});
