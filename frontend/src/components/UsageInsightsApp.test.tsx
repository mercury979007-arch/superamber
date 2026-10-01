import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsageInsightsApp from './UsageInsightsApp';

const summaryResponse = {
  status: 'success',
  days: 30,
  sourceEnvironment: 'production',
  summary: {
    totalEvents: 12,
    uniqueUsers: 1,
    byEvent: [],
    byUser: [{ teacherName: 'AmberZhang', count: 12 }],
    byModule: [],
    byTool: [{ tool: '座位表', count: 8 }],
    minipin: { totalMP: 0, totalActions: 0, totalStudents: 0 },
    speakingMinipin: { totalMP: 0, totalActions: 0, totalStudents: 0, recent: [] },
    daily: [],
    recentActivity: [],
    dataQuality: {
      unidentifiedEventCount: 3,
      unverifiedEventCount: 2,
      unverifiedUserCount: 1,
      caseVariantMergeCount: 1,
    },
    identity: {
      verifiedUsers: 1,
      observedUsers: 2,
      unverifiedUsers: 1,
      mergedCaseVariants: 1,
    },
  },
};

describe('UsageInsightsApp', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('presents verified account metrics and data-quality corrections clearly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => summaryResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => root.render(<UsageInsightsApp onBack={vi.fn()} />));

    await vi.waitFor(() => expect(container.textContent).toContain('认证活跃账号'));
    expect(container.textContent).toContain('账号口径已校正');
    expect(container.textContent).toContain('1 个大小写重复已合并');
    expect(container.textContent).toContain('1 个待核验账号未计入');
    expect(container.textContent).toContain('3 条匿名记录已排除');
    expect(container.textContent).toContain('操作活跃账号');
    expect(container.textContent).toContain('常用功能');
    expect(container.textContent).not.toContain('行为分布');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/usage-summary?days=30',
      { credentials: 'include' },
    );
    flushSync(() => root.unmount());
  });
});
