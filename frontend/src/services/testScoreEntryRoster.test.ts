import { describe, expect, it } from 'vitest';

import type { ScoreBookRow } from './testScoreEntryApi';
import { buildScoreEntryRoster } from './testScoreEntryRoster';

describe('testScoreEntryRoster', () => {
  it('only uses the current score-book rows so local roster names do not leak into score entry', () => {
    const rows: ScoreBookRow[] = [
      {
        rowId: 101,
        noticeId: 1,
        studentId: 's-2',
        studentNo: '24100002',
        chName: '周子然',
        enName: '',
        status: '',
        type: '',
        comment: '',
        exstatus: [],
        item: [],
        score: [],
        itemKey: '',
        childKey: '',
        itemLimit: 20,
        childLimit: 20,
      },
    ];

    const roster = buildScoreEntryRoster('J342', rows);

    expect(roster).toEqual([
      { studentId: 's-2', chineseName: '周子然', englishName: '', classCode: 'J342' },
    ]);
  });
});
