import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClassShell } from '../seating/state';
import { loadClassData, migrateSeatingStorage } from '../seating/storage';
import {
  appendSeatingTodoNote,
  loadAcademicTermLaunchInfo,
  loadMergedSeatingClassData,
  loadSeatingNotesByClass,
  saveAcademicTermLaunchInfo,
  saveSeatingClassData
} from './seatingStorage';

function makeClassConfig(theme: 'paper' | 'mint') {
  const config = makeClassShell('circular', theme);
  config.weekday.locationInfo.fullDate = '2026-04-14';
  return config;
}

describe('seatingStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('merges current and legacy seating payloads with current data taking precedence', () => {
    localStorage.setItem('classSeatingData', JSON.stringify({
      J101: makeClassConfig('paper'),
    }));
    localStorage.setItem('superamberClassData', JSON.stringify({
      J101: makeClassConfig('mint'),
      K202: makeClassConfig('paper'),
    }));

    const merged = loadMergedSeatingClassData();

    expect(Object.keys(merged).sort()).toEqual(['J101', 'K202']);
    expect(merged.J101.theme).toBe('mint');
  });

  it('loads legacy seating data when the current app key was left empty', () => {
    localStorage.setItem('classSeatingData', JSON.stringify({
      J101: makeClassConfig('paper'),
    }));
    localStorage.setItem('superamberClassData', JSON.stringify({}));

    const loaded = loadClassData();

    expect(Object.keys(loaded)).toEqual(['J101']);
    expect(loaded.J101.theme).toBe('paper');
  });

  it('persists todo notes through the shared seating storage service', () => {
    localStorage.setItem('superamberClassData', JSON.stringify({
      J101: makeClassConfig('paper'),
    }));

    appendSeatingTodoNote('j101', '带资料包', '2026-04-16', 'weekly');

    const notesByClass = loadSeatingNotesByClass();
    expect(notesByClass.J101).toHaveLength(1);
    expect(notesByClass.J101[0]?.text).toBe('带资料包');
    expect(notesByClass.J101[0]?.source).toBe('weekly');
  });

  it('saves seating data to the current key and removes the legacy duplicate', () => {
    localStorage.setItem('classSeatingData', JSON.stringify({
      J000: makeClassConfig('paper'),
    }));

    expect(saveSeatingClassData({
      J101: makeClassConfig('mint'),
    })).toBe(true);

    expect(localStorage.getItem('classSeatingData')).toBeNull();
    expect(JSON.parse(localStorage.getItem('superamberClassData') || '{}').J101.theme).toBe('mint');
  });

  it('clears legacy seating data and retries when the first current-key save hits quota', () => {
    localStorage.setItem('classSeatingData', JSON.stringify({
      J000: makeClassConfig('paper'),
    }));
    localStorage.setItem('superamberClassData', localStorage.getItem('classSeatingData')!);

    const originalSetItem = Storage.prototype.setItem;
    let failedOnce = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key, value) {
      if (key === 'superamberClassData' && !failedOnce) {
        failedOnce = true;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    expect(saveSeatingClassData({
      J202: makeClassConfig('mint'),
    })).toBe(true);

    expect(localStorage.getItem('classSeatingData')).toBeNull();
    expect(JSON.parse(localStorage.getItem('superamberClassData') || '{}').J202.theme).toBe('mint');
  });

  it('stores a normalized per-class academic term launch marker', () => {
    saveAcademicTermLaunchInfo({
      termId: '2026-autumn',
      week1Start: '2026-08-31',
      completedAt: '2026-08-30T02:00:00.000Z',
      rotatedClassCodes: ['j101', 'J101', ' k202 '],
    });

    expect(loadAcademicTermLaunchInfo()).toEqual({
      termId: '2026-autumn',
      week1Start: '2026-08-31',
      completedAt: '2026-08-30T02:00:00.000Z',
      rotatedClassCodes: ['J101', 'K202'],
    });
  });
});


describe('local seating survives startup and exhausted storage', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('consolidates legacy-only classes with current precedence and never recreates duplicates on reload', () => {
    const current = { J101: makeClassConfig('mint') };
    const legacy = { J101: makeClassConfig('paper'), J202: makeClassConfig('paper') };
    localStorage.setItem('superamberClassData', JSON.stringify(current));
    localStorage.setItem('classSeatingData', JSON.stringify(legacy));
    expect(migrateSeatingStorage()).toBe(true);
    expect(loadClassData()).toEqual({ ...legacy, ...current });
    expect(localStorage.getItem('classSeatingData')).toBeNull();
    const saved = localStorage.getItem('superamberClassData');
    expect(migrateSeatingStorage()).toBe(true);
    expect(localStorage.getItem('superamberClassData')).toBe(saved);
    expect(localStorage.getItem('classSeatingData')).toBeNull();
  });
  it('never destroys the only legacy copy when all current-key writes fail', () => {
    const raw = JSON.stringify({ J101: makeClassConfig('mint') });
    localStorage.setItem('classSeatingData', raw);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'superamberClassData') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    expect(migrateSeatingStorage()).toBe(false);
    expect(saveSeatingClassData({ J101: makeClassConfig('paper') })).toBe(false);
    expect(localStorage.getItem('classSeatingData')).toBe(raw);
    expect(localStorage.getItem('superamberClassData')).toBeNull();
    expect(loadClassData()).toEqual(JSON.parse(raw));
  });
  it('evicts only refetchable caches on quota failure, keeping edits, undo and login', () => {
    const protectedData = { superamberClassData: JSON.stringify({ J101: makeClassConfig('paper') }), superamberBatchUndoData: '{"old":"undo"}', amber_username: 'Teacher', amber_speaking_poster_edits: '{"title":"Manual"}', unknown_user_draft: 'Keep' };
    Object.entries(protectedData).forEach(([key, value]) => localStorage.setItem(key, value));
    localStorage.setItem('superamber_class_control_v6:teacher', 'Large cached report');
    localStorage.setItem('amber_speaking_class_cache:v6:teacher:J101', 'Cached speaking');
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'superamberClassData' && localStorage.getItem('superamber_class_control_v6:teacher')) throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    expect(saveSeatingClassData({ J101: makeClassConfig('mint') })).toBe(true);
    expect(loadClassData().J101.theme).toBe('mint');
    Object.entries(protectedData).filter(([key]) => key !== 'superamberClassData').forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value));
    expect(localStorage.getItem('superamber_class_control_v6:teacher')).toBeNull();
    expect(localStorage.getItem('amber_speaking_class_cache:v6:teacher:J101')).toBeNull();
  });
});
