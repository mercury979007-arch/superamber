import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SpeakingChallengeApiError,
  createSpeakingRewardPlan,
  fetchSpeakingChallengeClass,
  issueSpeakingRewardPlan,
} from './speakingChallengeApi';

describe('speakingChallengeApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads a class and creates a reward preview through protected POST endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        leaderboard: { classCode: 'K339', students: [] },
        rewardState: { configLocked: false },
        updatedAt: '2026-09-01T02:00:00.000Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        plan: { planId: 'plan-1', classCode: 'K339', rewards: [], studentCount: 0, totalMP: 0 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        result: { successCount: 2, failedCount: 0, totalMP: 0.8 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSpeakingChallengeClass('K339');
    await createSpeakingRewardPlan('K339', {
      basePerDay: 0.1,
      streakThreshold: 3,
      streakMultiplier: 1.5,
      rewardMode: 'multiplier',
      thresholdBonus: 0,
      ignoreSupplementVariance: true,
    }, ['2026-08-31', '2026-09-01'], {
      baseStrategy: 'unissued',
      includeStreak: true,
    });
    await issueSpeakingRewardPlan('plan-1');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/data/speaking-challenge/class',
      '/api/data/speaking-challenge/reward-plan',
      '/api/data/speaking-challenge/issue',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      classId: 'K339',
      config: { basePerDay: 0.1, streakThreshold: 3, streakMultiplier: 1.5, rewardMode: 'multiplier', thresholdBonus: 0, ignoreSupplementVariance: true },
      selectedDates: ['2026-08-31', '2026-09-01'],
      selection: { baseStrategy: 'unissued', includeStreak: true },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      planId: 'plan-1',
      acknowledged: true,
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('preserves authentication failures for the relogin flow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: '登录失效' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(fetchSpeakingChallengeClass('K339')).rejects.toEqual(expect.objectContaining({
      name: 'SpeakingChallengeApiError',
      message: '未登录，请先登录',
      status: 401,
    } satisfies Partial<SpeakingChallengeApiError>));
  });
});
