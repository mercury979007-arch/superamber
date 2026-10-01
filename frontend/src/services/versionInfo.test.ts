import { describe, expect, it } from 'vitest';
import { buildVersionFingerprint, normalizeVersionInfo } from './versionInfo';

describe('versionInfo helpers', () => {
  it('builds a stable fingerprint from the four canonical fields', () => {
    expect(buildVersionFingerprint({
      environment: 'staging',
      version: 'C4jrIENy',
      commit: 'c8cf549',
      deployedAt: '2026-04-14T02:33:05.256Z',
    })).toBe('staging:C4jrIENy:c8cf549:2026-04-14T02:33:05.256Z');
  });

  it('normalizes payloads and backfills fingerprint when backend omits it', () => {
    expect(normalizeVersionInfo({
      environment: 'test',
      version: 'build-123',
      commit: 'abc1234',
      deployedAt: '2026-04-14T09:30:00.000Z',
    })).toEqual({
      environment: 'test',
      version: 'build-123',
      commit: 'abc1234',
      deployedAt: '2026-04-14T09:30:00.000Z',
      fingerprint: 'test:build-123:abc1234:2026-04-14T09:30:00.000Z',
    });
  });
});
