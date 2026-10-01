import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasUsableScoreBookTasksCache, ScoreBookApiError, submitScoreBookEntries } from './testScoreEntryApi';

describe('testScoreEntryApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only reuses non-empty task caches so empty task responses do not freeze submission', () => {
    expect(hasUsableScoreBookTasksCache(undefined)).toBe(false);
    expect(hasUsableScoreBookTasksCache(null)).toBe(false);
    expect(hasUsableScoreBookTasksCache([])).toBe(false);
    expect(hasUsableScoreBookTasksCache([
      {
        noticeId: '489541',
        noticeType: '测试',
        title: 'W7周度小测成绩录入录入-J328/2026-04-18',
        startTime: '2026-04-18 00:00:00',
        endTime: '2026-04-18 23:59:59',
        status: '待处理',
      },
    ])).toBe(true);
  });

  it('keeps backend conflict details so submit errors can explain which students failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: '录入数据存在未匹配、歧义或重复分配，未执行提交',
        unmatchedEntries: [{ rawName: 'Alice', error: '未匹配到学生' }],
      }),
    }));

    await expect(
      submitScoreBookEntries({
        classId: 'J413',
        noticeId: '489541',
        mode: 'named',
        entries: [{ rawName: 'Alice', score: 18 }],
      }),
    ).rejects.toMatchObject({
      name: 'Error',
      message: '录入数据存在未匹配、歧义或重复分配，未执行提交',
      status: 400,
      responseData: {
        unmatchedEntries: [{ rawName: 'Alice', error: '未匹配到学生' }],
      },
    } satisfies Partial<ScoreBookApiError>);
  });
});
