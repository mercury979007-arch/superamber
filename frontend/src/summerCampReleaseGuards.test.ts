import { describe, expect, it } from 'vitest';
import reportSource from './components/CampReportApp.tsx?raw';
import portalSource from './components/SummerCampPortal.tsx?raw';
import {
  buildGoalTextFromPlan,
  buildPrepTextFromPlan,
  findCampDayPlan,
} from './data/campReportCatalog';
import { makeEmptyCampGroups } from './seating/state';
import { shouldPreserveExistingCampPresetSeating } from './seating/summerCampLaunchRules';
import { sanitizeSummerCampSeatGroups } from './seating/summerCampSeatSlots';

describe('summer camp release guards', () => {
  it('keeps the locked camp report editor instead of the old report-only view', () => {
    expect(reportSource).toContain('2026 Summer Camp 日报');
    expect(reportSource).toContain('模块管理');
    expect(reportSource).toContain('粘贴学生数据');
    expect(reportSource).toContain('复制图片');
    expect(reportSource).not.toContain('camp-report-kicker">Summer Camp Report');
    expect(reportSource).not.toContain('camp-preview-section-title">今日课程');
  });

  it('does not expose the unfinished schedule entry on the public summer camp home', () => {
    expect(portalSource).not.toContain('进入课表');
    expect(portalSource).not.toContain('<span>Schedule</span>');
    expect(portalSource).not.toContain("lastTool === 'schedule'");
  });

  it('ships latest report copy and manual seating priority together', () => {
    const plan = findCampDayPlan('2026-07-20', 'L2', 'Camp 1');
    const goalText = buildGoalTextFromPlan(plan, 'Sparkchat Camp 1');
    const prepText = buildPrepTextFromPlan(plan);

    expect(goalText).toContain('Sparkchat Camp 1 Day 1 今日竞赛里程');
    expect(goalText).toContain('今日话题：Topic 1');
    expect(prepText).toContain('明日暂未匹配到额外活动提醒');
    expect(prepText).not.toContain('明天苦令营将迎来');

    const groups = makeEmptyCampGroups(6);
    groups[0][0] = 'TeacherPriorityQA';
    groups[0][7] = 'SeatEightQA';
    groups[5][7] = 'LastSeatQA';

    const sanitized = sanitizeSummerCampSeatGroups(groups);

    expect(sanitized[0][0]).toBe('TeacherPriorityQA');
    expect(sanitized[0][7]).toBe('SeatEightQA');
    expect(sanitized[5][7]).toBe('LastSeatQA');
    expect(shouldPreserveExistingCampPresetSeating(32, false, false)).toBe(true);
  });
});
