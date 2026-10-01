const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectGroupMode,
  extractLessonNumber,
  extractStepNumber,
  sortGroupItems,
  sortModulesByGroup,
} = require('../reportSequenceRules');

test('detects step mode when explicit step labels are present', () => {
  const mode = detectGroupMode([
    { title: '步骤2:周末内容AI语音陪练' },
    { title: '步骤1:周末磨耳朵&跟读' },
  ]);
  assert.equal(mode, 'step');
});

test('extracts lesson number only from explicit Lesson/L markers', () => {
  assert.equal(extractLessonNumber('【PT】Lesson 8小挑战（AI批改）'), 8);
  assert.equal(extractLessonNumber('【PT】L8'), 8);
  assert.equal(extractLessonNumber('本周周末温故 Lesson 2'), 2);
  assert.equal(extractLessonNumber('整体回顾'), null);
  assert.equal(extractLessonNumber('2026-05-18 任务时间'), null);
});

test('sorts step-mode groups within a main task by step number only', () => {
  const sorted = sortGroupItems([
    { title: '步骤3:新内容提前知', sourceOrder: 2 },
    { title: '步骤1:周末磨耳朵&跟读', sourceOrder: 0 },
    { title: '步骤4:本周小挑战', sourceOrder: 3 },
    { title: '步骤2:周末内容AI语音陪练', sourceOrder: 1 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.title),
    [
      '步骤1:周末磨耳朵&跟读',
      '步骤2:周末内容AI语音陪练',
      '步骤3:新内容提前知',
      '步骤4:本周小挑战',
    ]
  );
});

test('sorts semantic lesson-mode groups by lesson sequence then phase', () => {
  const sorted = sortGroupItems([
    { title: '【PT】词汇温故', groupTitle: '【PT】L8', sourceOrder: 2 },
    { title: '【PT】Lesson 8', groupTitle: '【PT】L8', sourceOrder: 0 },
    { title: '【PT】句型表达', groupTitle: '【PT】L8', sourceOrder: 1 },
    { title: '【PT】Lesson 8小挑战（AI批改）', groupTitle: '【PT】L8', sourceOrder: 3 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.title),
    [
      '【PT】Lesson 8',
      '【PT】句型表达',
      '【PT】词汇温故',
      '【PT】Lesson 8小挑战（AI批改）',
    ]
  );
});

test('sorts semantic time-bucket groups by 周中 -> 周末 -> 下周周中 while preserving bucket order', () => {
  const sorted = sortGroupItems([
    { title: '下周周中新知AI语音', groupTitle: 'WFB', sourceOrder: 2 },
    { title: '本周周末温故', groupTitle: 'WFB', sourceOrder: 1 },
    { title: '本周周中温故', groupTitle: 'WFB', sourceOrder: 0 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.title),
    [
      '本周周中温故',
      '本周周末温故',
      '下周周中新知AI语音',
    ]
  );
});

test('preserves main task boundaries when sorting all modules', () => {
  const sorted = sortModulesByGroup([
    { title: '步骤2:周末内容AI语音陪练', groupOrder: 0, sourceOrder: 1 },
    { title: '步骤1:周末磨耳朵&跟读', groupOrder: 0, sourceOrder: 0 },
    { title: '步骤2:周内内容AI语音陪练', groupOrder: 1, sourceOrder: 1 },
    { title: '步骤1:周内磨耳朵&跟读', groupOrder: 1, sourceOrder: 0 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.title),
    [
      '步骤1:周末磨耳朵&跟读',
      '步骤2:周末内容AI语音陪练',
      '步骤1:周内磨耳朵&跟读',
      '步骤2:周内内容AI语音陪练',
    ]
  );
});

test('keeps wrapped lesson numbering in first-seen order instead of resetting 1 to front', () => {
  const sorted = sortGroupItems([
    { title: '本周周末温故 Lesson 8', groupTitle: 'Lesson 7-8-1', sourceOrder: 1 },
    { title: '本周周末温故 Lesson 7', groupTitle: 'Lesson 7-8-1', sourceOrder: 0 },
    { title: '下周周中新知 Lesson 1', groupTitle: 'Lesson 7-8-1', sourceOrder: 2 },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.title),
    [
      '本周周末温故 Lesson 7',
      '本周周末温故 Lesson 8',
      '下周周中新知 Lesson 1',
    ]
  );
});

test('step number extraction supports standard labels', () => {
  assert.equal(extractStepNumber('步骤6:周末内容AI语音陪练'), 6);
  assert.equal(extractStepNumber('普通标题'), null);
});
