import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DistributionSubmitError,
  fetchDistributionBalance,
  mapQuickClassInfoList,
  mapQuickRosterRows,
  resolveDistributionClassFromSession,
  submitDistributionRewards,
} from './distributionQuickApi';

describe('distributionQuickApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps quick login class list into normalized ClassInfo objects', () => {
    expect(mapQuickClassInfoList([{ name: 'J101', squadId: '88' }])).toEqual([
      { id: 'J101', name: 'J101', squadId: '88' },
    ]);
  });

  it('maps quick roster rows into student records', () => {
    expect(mapQuickRosterRows([
      { no: '001', chName: '张三', enName: 'Amy' },
    ], 'j101')).toEqual([
      { studentId: '001', chineseName: '张三', englishName: 'Amy', classCode: 'J101' },
    ]);
  });

  it('reuses existing session to resolve current class without re-login', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ loggedIn: true, username: 'amber' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ name: 'J101', squadId: '88' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveDistributionClassFromSession('j101')).resolves.toEqual({
      loggedIn: true,
      matchedClass: { id: 'J101', name: 'J101', squadId: '88' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports no shared session when health check says not logged in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ loggedIn: false }),
    }));

    await expect(resolveDistributionClassFromSession('J101')).resolves.toEqual({
      loggedIn: false,
      matchedClass: null,
    });
  });

  it('submits rewards with classId payload expected by backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', success: 1, failed: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitDistributionRewards({
      squadId: '1046',
      className: 'J342',
      rewards: [
        {
          studentId: '20240001',
          studentName: 'Alice',
          chineseName: '张三',
          aliases: ['Alice', '张三'],
          amount: 1,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      classId: '1046',
      className: 'J342',
      rewards: [
        {
          studentId: '20240001',
          studentName: 'Alice',
          chineseName: '张三',
          aliases: ['Alice', '张三'],
          amount: 1,
        },
      ],
    });
  });

  it('throws DistributionSubmitError with parsed response body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: '发放失败，请改用兜底 Excel 上传到官网', failedStudentIds: ['20240001'] }),
    }));

    await expect(
      submitDistributionRewards({
        squadId: '1046',
        rewards: [
          {
            studentId: '20240001',
            studentName: 'Alice',
            chineseName: '张三',
            aliases: ['Alice', '张三'],
            amount: 1,
          },
        ],
      })
    ).rejects.toMatchObject({
      name: 'DistributionSubmitError',
      message: '发放失败，请改用兜底 Excel 上传到官网',
      responseData: { failedStudentIds: ['20240001'] },
    } satisfies Partial<DistributionSubmitError>);
  });
});


describe('balance response validation', () => {
  it.each([null, '', undefined])('does not mistake unavailable balance %s for zero', async (minipin) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ minipin }) }));
    expect((await fetchDistributionBalance(['328'])).value).toBeNull();
  });
  it('accepts a real zero balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ minipin: 0 }) }));
    expect((await fetchDistributionBalance(['328'])).value).toBe(0);
  });
});
