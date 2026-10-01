// @ts-nocheck
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MakeupTool from './MakeupTool';
import { saveStageData } from '../utils/makeupData';
import { initWeekDetection, parseQuickInput } from '../utils/makeupParser';
import type { MakeupDataset, MakeupClassMeta, MakeupOccurrence } from '../types/makeup';


const DAY_ORDER = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TIME_ORDER = ['18:20', '19:30', '09:00', '10:10', '11:20', '12:30', '13:40', '14:50', '16:00', '17:10', '20:30'];
let dataset: MakeupDataset;

function getSlotCell(container: HTMLElement, day: string, time: string): HTMLInputElement | null {
  const matrix = container.querySelector('.makeup-slot-matrix');
  if (!matrix) return null;
  const children = Array.from(matrix.children);
  const headerOffset = 1 + DAY_ORDER.length;
  const rowIndex = TIME_ORDER.indexOf(time);
  const dayIndex = DAY_ORDER.indexOf(day);
  if (rowIndex < 0 || dayIndex < 0) return null;
  const cell = children[headerOffset + rowIndex * (1 + DAY_ORDER.length) + 1 + dayIndex] as HTMLElement | undefined;
  return cell?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
}

function classMap(data: MakeupDataset): Map<string, MakeupClassMeta> {
  return new Map(data.classes.map((item) => [item.class_code, item]));
}

function occMap(data: MakeupDataset): Map<string, MakeupOccurrence[]> {
  const map = new Map<string, MakeupOccurrence[]>();
  for (const occ of data.occurrences) {
    if (!map.has(occ.class_code)) map.set(occ.class_code, []);
    map.get(occ.class_code)!.push(occ);
  }
  return map;
}

describe('MakeupTool regression', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T04:00:00.000Z'));
    // Stable legacy-format sample: current bundled workbooks use a newer UI
    // and must not silently change what these legacy controls are testing.
    const codes = ['K218', 'K339', ...Array.from({ length: 8 }, (_, i) => `J${400 + i}`)];
    const details = (day: string, time: string) => ({ day, time, teacher: 'Demo', campus: 'Demo', room: '1' });
    const classes = codes.map((class_code, i) => ({ class_code, batch: 'A', type: 'BC', head_teacher: 'Demo', grade: 'L2', student_count: '20',
      weekday: details(i === 1 ? '周一' : '周二', '18:20'), weekend: details(i === 1 ? '周日' : '周六', '12:30'),
    }));
    const occurrences = classes.flatMap(c => [1, 2, 3].flatMap(week => ['weekday', 'weekend'].map(mode => {
      const day = (mode === 'weekday' ? (c.class_code === 'K339' ? 0 : 1) : (c.class_code === 'K339' ? 6 : 5)) + (week - 1) * 7;
      const date = new Date(Date.UTC(2026, 7, 31 + day)).toISOString().slice(0, 10);
      return { ...c, ...c[mode], id: `${c.class_code}-${week}-${mode}`, week_label: `W${week} ${mode === 'weekday' ? '周中' : '周末'} [${date}]`, week_col: week,
        mode: mode === 'weekday' ? '周中' : '周末', lesson: `Lesson ${week}`, date };
    })));
    dataset = { classes, occurrences, slots: [], meta: { active_stage: 'L2', supported_stages: [], source_name: 'legacy-regression', source_kind: 'file', imported_at: '2026-09-08', invalid_week_labels: [] } };
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    localStorage.clear();
    saveStageData('L2', dataset);
  });

  it('does not auto-select past Monday slots or the origin Tuesday 18:20 slot for K218 general makeup intent', async () => {
    const { container } = render(<MakeupTool onBack={() => {}} />);
    const textarea = screen.getByPlaceholderText(/例如：J420/i);
    fireEvent.change(textarea, { target: { value: 'K218周二请假，想补课' } });
    fireEvent.click(screen.getByRole('button', { name: '识别填入' }));

    await waitFor(() => {
      expect(screen.getAllByText(/K218/).length).toBeGreaterThan(0);
    });

    expect(getSlotCell(container, '周一', '18:20')?.checked).toBe(false);
    expect(getSlotCell(container, '周一', '19:30')?.checked).toBe(false);
    expect(getSlotCell(container, '周二', '18:20')?.checked).toBe(false);
    expect(screen.queryByText(/全部 32 个固定时段/)).toBeNull();
  });

  it('handles the four required formats without parser regression', async () => {
    const classesByCode = classMap(dataset);
    const occByClass = occMap(dataset);
    const weekCtx = initWeekDetection(dataset.occurrences);

    const samples = [
      'K218周中请假，想在周四补课',
      'K218周末请假，想在周六12：00点后补课',
      'K339周一请假，想补课',
      'K339周末请假，想在周日11：00-15：00补课',
    ];

    for (const text of samples) {
      const result = parseQuickInput(text, classesByCode, occByClass, weekCtx);
      expect(result.classCode, text).toBeTruthy();
      expect(result.missedOccId, text).toBeTruthy();
    }
  });

  it('covers 10 random classes with weekday/weekend quick-input smoke checks', async () => {
    const classesByCode = classMap(dataset);
    const occByClass = occMap(dataset);
    const weekCtx = initWeekDetection(dataset.occurrences);
    const candidates = dataset.classes
      .filter((item) => item.weekday.day && item.weekday.time && item.weekend.day && item.weekend.time)
      .slice(0, 10);

    expect(candidates.length).toBe(10);

    const cases = candidates.flatMap((item, index) => [
      `${item.class_code}${item.weekday.day}请假，想补课`,
      `${item.class_code}周末请假，想在${item.weekend.day}${index % 2 === 0 ? '11：00-15：00' : '12：00点后'}补课`,
    ]);

    for (const text of cases) {
      const result = parseQuickInput(text, classesByCode, occByClass, weekCtx);
      expect(result.classCode, text).toBeTruthy();
      expect(result.missedOccId || result.selectionError, text).toBeTruthy();
    }
  });

  it('surfaces schedule coverage insufficiency when requested week exceeds the available progress table', async () => {
    const classesByCode = classMap(dataset);
    const occByClass = occMap(dataset);
    const weekCtx = initWeekDetection(dataset.occurrences);
    const result = parseQuickInput('K218 W99周二请假，想补课', classesByCode, occByClass, weekCtx);
    expect(result.feedbackLines.join('｜')).toMatch(/当前进度表只到/);
  });
});
