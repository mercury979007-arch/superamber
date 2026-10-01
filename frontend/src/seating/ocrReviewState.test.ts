import { describe, expect, it } from 'vitest';
import { buildOcrReviewCardHtml, createFailedOcrDraftView, createOcrDraftView } from './ocrReviewState';

describe('ocrReviewState', () => {
  it('creates OCR drafts from recognition results', () => {
    const draft = createOcrDraftView({
      fileName: 'J101.png',
      rawText: '',
      className: 'J101',
      source: 'tencent',
      layout: 'circular',
      groups: [['Alice', 'Bob']],
      detectedStudentCount: 2,
      placedStudentCount: 2,
      confidence: 0.9,
      info: {
        date: '4',
        day: '14',
        weekday: '周二',
        time: '19:00',
        campus: '人民广场',
        floor: '3F',
        room: '301',
        fullDate: '2026-04-14',
      },
    }, {
      groupsToText: () => 'Alice, Bob',
      makeId: () => 'draft-1',
    });

    expect(draft.id).toBe('draft-1');
    expect(draft.className).toBe('J101');
    expect(draft.groupsText).toBe('Alice, Bob');
  });

  it('builds failed OCR drafts and review card html', () => {
    const failed = createFailedOcrDraftView('bad.png', 'hybrid', '识别失败', {
      makeId: () => 'failed-1',
    });

    const html = buildOcrReviewCardHtml(failed, (value) => value);
    expect(failed.source).toBe('failed:hybrid');
    expect(html).toContain('失败原因：识别失败');
    expect(html).toContain('bad.png');
  });
});
