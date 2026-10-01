const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCompleteTaskCatalog } = require('../lib/taskCatalog');

test('task catalog preserves every official task group instead of limiting it to three weeks', () => {
  const officialGroups = Array.from({ length: 8 }, (_, index) => ({
    name: `Week${index + 1}`,
    tasks: [`Task ${index + 1}`],
  }));
  const received = [];
  const result = buildCompleteTaskCatalog({ taskGroups: officialGroups }, (groups) => {
    received.push(...groups);
    return groups;
  });

  assert.equal(received.length, 8);
  assert.deepEqual(result.map((group) => group.name), [
    'Week1', 'Week2', 'Week3', 'Week4', 'Week5', 'Week6', 'Week7', 'Week8',
  ]);
});

const EducationSystemScraper = require('../scraper/scraper');
const { filterVideoTaskSnapshot } = require('../lib/videoTaskPolicy');

const resource = (taskId, id, type, name) => ({
  id: `1_${taskId}_${id}_${type}`, name: `${name} 类型:${type === 'video' ? '视频' : '朗读'}`, children: [],
});
const task = (id, children) => ({ id: `${id}_task`, name: 'Week1 任务时间:2026-09-01 12:00:00', children });

function catalogFromTree(nodes) {
  const scraper = new EducationSystemScraper({ baseUrl: 'https://example.test' });
  return buildCompleteTaskCatalog({
    taskGroups: scraper.parseFilterDataToTaskGroups({ data: { task: nodes } }),
  }, groups => groups);
}

test('same-name resources retain their identities and counts through catalog and video filtering', () => {
  const catalog = catalogFromTree([task(10, [
    resource(10, 1, 'voice', 'Week1 朗读'),
    resource(10, 2, 'voice', 'Week1 朗读'),
    resource(10, 3, 'voice', 'Week1 朗读'),
    resource(10, 4, 'voice', 'Week1 朗读'),
    resource(10, 5, 'video', 'Week1 视频'),
  ])]);
  assert.equal(catalog[0].resourceCount, 5);
  assert.equal(catalog[0].taskSelection.taskIds.length, 5);
  const filtered = filterVideoTaskSnapshot({ weekTasks: catalog,
    weekMap: { 'task-10': catalog[0].tasks },
    weekSelectionMap: { 'task-10': catalog[0].taskSelection },
  }, true);
  assert.equal(filtered.weekTasks[0].resourceCount, 4);
  assert.equal(filtered.weekSelectionMap['task-10'].taskIds.length, 4);
});

test('official tasks sharing the same title and timestamp never share selected resources', () => {
  const catalog = catalogFromTree([
    task(10, [resource(10, 1, 'voice', '朗读')]),
    task(20, [resource(20, 1, 'voice', '朗读'), resource(20, 2, 'voice', '朗读')]),
  ]);
  assert.deepEqual(catalog.map(c => c.resourceCount), [1, 2]);
  assert.deepEqual(catalog.map(c => c.taskSelection.taskIds), [
    ['1_10_1_voice'], ['1_20_1_voice', '1_20_2_voice'],
  ]);
});

test('catalog merging counts distinct IDs even when older groups undercount identical labels', () => {
  const groups = [1, 2].map(id => ({ officialTaskId: '10', name: 'Week1', tasks: ['朗读'],
    resourceCount: 1, taskSelection: { taskIds: [`1_10_${id}_voice`] },
  }));
  assert.equal(buildCompleteTaskCatalog({ taskGroups: groups }, x => x)[0].resourceCount, 2);
});

test('report cache identities version the conversion and distinguish incomplete selections', () => {
  const { taskSelectionFingerprint } = require('../lib/taskCatalog');
  const snapshot = { weekSelectionMap: { a: { taskIds: ['20_2', '10_1'] }, b: { taskIds: ['30_3'] } } };
  const fingerprint = taskSelectionFingerprint(snapshot, ['a', 'b']);
  assert.equal(fingerprint, taskSelectionFingerprint(snapshot, ['b', 'a', 'a']));
  assert.notEqual(fingerprint, '10_1,20_2,30_3');
  assert.notEqual(fingerprint, taskSelectionFingerprint(snapshot, ['a', 'b', 'missing']));
  assert.notEqual(taskSelectionFingerprint(snapshot, ['a']), taskSelectionFingerprint(snapshot, ['b']));
});

test('resource titles containing Week remain in the task names as well as the ID selection', () => {
  const catalog = catalogFromTree([task(10, [
    resource(10, 1, 'voice', 'Vocabulary Lesson1'),
    resource(10, 2, 'voice', 'Reading Lesson1'),
    { id: '1_10_3_studyMark', name: 'L4·班级小挑战·Week1 类型:小挑战', children: [] },
    { id: '1_10_4_composite', name: 'Week1 类型:复合资源', children: [] },
  ])]);
  assert.equal(catalog[0].resourceCount, 4);
  assert.equal(catalog[0].tasks.length, 4);
  assert(catalog[0].tasks.includes('Week1 类型:复合资源'));
  assert.equal(catalog[0].taskSelection.taskIds.length, 4);
});
