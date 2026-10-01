import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClassHub from './ClassHub';

let runtimeEnvironment = 'production';

vi.mock('../utils/weekNumber', () => ({
  getCurrentWeek: () => 12,
}));

vi.mock('../utils/classSchedule', () => ({
  getClassDays: () => ['周三'],
}));

vi.mock('../utils/classProfiles', () => ({
  getStudentCount: () => 10,
  hasSeatingData: () => true,
}));

vi.mock('../hooks/useVersionStatus', () => ({
  useVersionStatus: () => ({
    versionInfo: { environment: runtimeEnvironment },
  }),
}));

vi.mock('../services/featureRegistry', () => {
  const testOnly = new Set(['camp-report', 'data-review', 'test-score-entry', 'usage-insights']);
  return {
    getFeatureCapability: (screen: string) => ({
      screen,
      audience: testOnly.has(screen) ? 'test-only' : 'all',
      badge: testOnly.has(screen) ? '测试站' : undefined,
    }),
    isFeatureEnabled: (screen: string) => !testOnly.has(screen) || runtimeEnvironment === 'test',
  };
});

describe('ClassHub', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    runtimeEnvironment = 'production';
  });

  const baseProps = {
    classInfo: { id: '1', name: 'J328' },
    classes: [{ id: '1', name: 'J328' }],
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onSwitchClass: vi.fn(),
  };

  function renderHub(environment: string) {
    runtimeEnvironment = environment;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(<ClassHub {...baseProps} />);
    });
    return container;
  }

  it('hides test score entry outside experimental environments', () => {
    const container = renderHub('production');

    expect(container.textContent || '').not.toContain('测试成绩录入');
    expect(container.textContent || '').toContain('班级公示');
  });

  it('shows test score entry in experimental environments', () => {
    const container = renderHub('test');

    expect(container.textContent || '').toContain('测试成绩录入');
    expect(container.textContent || '').toContain('【测试站】');
  });
});
