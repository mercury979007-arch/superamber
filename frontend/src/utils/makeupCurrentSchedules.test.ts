// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadMultiStageStore, replaceStoreWithBundle, shouldSyncAmberBundle, AMBER_BUNDLE_REVISION, AMBER_BUNDLED_STAGES } from './makeupData';

describe('current Numbers progress and shared Agent matcher', () => {
  it('keeps uploaded stages and legacy data when new bundled schedules arrive', () => {
    const old = { meta: { active_stage: 'L3' }, classes: [], occurrences: [] };
    const original = JSON.stringify({ stages: { L3: old }, activeStage: 'L3' });
    const storage=new Map([['amber_makeup_stages',original],['amber_makeup_data','legacy'],['seating','keep']]);
    vi.stubGlobal('localStorage', {getItem:(key:string)=>storage.get(key)??null,removeItem:(key:string)=>storage.delete(key),setItem:(key:string,value:string)=>storage.set(key,value)});
    try {
      expect(loadMultiStageStore().stages.L3).toEqual(old);
      expect(storage.get('amber_makeup_stages')).toBe(original);
      expect(storage.get('seating')).toBe('keep');
      replaceStoreWithBundle({ L1: { ...old, meta: { active_stage: 'L1' } } } as never, 'L1');
      expect(loadMultiStageStore().stages.L3).toEqual(old);
      expect(loadMultiStageStore().activeStage).toBe('L1');
    } finally { vi.unstubAllGlobals(); }
  });
  it('syncs missing and same-format outdated bundles while preserving manual uploads', () => {
    const storage = new Map<string,string>();
    vi.stubGlobal('localStorage', { getItem:(key:string)=>storage.get(key)??null, setItem:(key:string,value:string)=>storage.set(key,value), removeItem:(key:string)=>storage.delete(key) });
    const current = {meta:{source_kind:'amber_bundle',data_format_version:8,bundle_revision:AMBER_BUNDLE_REVISION}, classes:[],occurrences:[]};
    const manual = {...current,meta:{source_kind:'manual',source_name:'teacher.xlsx'}};
    try {
      expect(shouldSyncAmberBundle()).toBe(false);
      storage.set('amber_makeup_stages', JSON.stringify({stages:{L1:current,L2:current},activeStage:'L2'}));
      expect(shouldSyncAmberBundle()).toBe(false);
      storage.set('amber_makeup_stages', JSON.stringify({stages:{L1:{...current,meta:{...current.meta,bundle_revision:'old'}},L2:manual},activeStage:'L2'}));
      expect(shouldSyncAmberBundle()).toBe(false);
      replaceStoreWithBundle({L1:current,L2:current} as never,'L2',true);
      expect(loadMultiStageStore().stages.L2).toEqual(manual);
      expect(shouldSyncAmberBundle()).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('reads a legacy schedule even when migration cannot fit in localStorage', () => {
    const old = { meta: { active_stage: 'L2' }, classes: [], occurrences: [] };
    const storage = new Map([['amber_makeup_data', JSON.stringify(old)]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    });
    try {
      expect(loadMultiStageStore().stages.L2).toEqual(old);
      expect(storage.has('amber_makeup_data')).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not bundle private school schedules in the public build', () => {
    expect(AMBER_BUNDLED_STAGES).toEqual([]);
  });
});
