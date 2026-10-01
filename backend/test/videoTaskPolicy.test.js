const test = require('node:test');
const assert = require('node:assert/strict');
const { filterVideoTaskSnapshot, filterVideoPublicitySelection } = require('../lib/videoTaskPolicy');
const { buildPublicityCandidateSelections } = require('../services/rosterSnapshotService');
const selection = {
  taskIds: ['1_10_20_video', '2_10_21_voice'],
  idToName: { '10_20': 'Safety 类型:视频', '10_21': 'Speaking 类型:语音' },
  orderedTaskKeys: ['10_20', '10_21'], taskMetaByKey: { '10_20': { title: 'Safety' }, '10_21': { title: 'Speaking' } },
};
const videoOnly = { ...selection, taskIds: ['1_10_20_video'], orderedTaskKeys: ['10_20'], idToName: { '10_20': 'Safety 类型:视频' } };
const snapshot = {
  weekTasks: [{ id: 'mixed', resourceCount: 2 }, { id: 'video', resourceCount: 1 }, { id: 'unhydrated', resourceCount: 3 }],
  weekMap: { mixed: Object.values(selection.idToName), video: ['Safety 类型:视频'], unhydrated: [] },
  weekSelectionMap: { mixed: selection, video: videoOnly },
  defaultSelectedWeekIds: ['video', 'mixed'], hydratedWeekIds: ['video', 'mixed'],
};
test('video policy keeps other resources and omits video-only batches without mutating stored data', () => {
  const before = JSON.stringify(snapshot);
  const filtered = filterVideoTaskSnapshot(snapshot, true);
  assert.deepEqual(filtered.weekTasks.map(x => x.id), ['mixed', 'unhydrated']);
  assert.equal(filtered.weekTasks[0].resourceCount, 1);
  assert.deepEqual(filtered.weekMap.mixed, ['Speaking 类型:语音']);
  assert.deepEqual(filtered.weekSelectionMap.mixed.taskIds, ['2_10_21_voice']);
  assert.deepEqual(filtered.weekSelectionMap.mixed.orderedTaskKeys, ['10_21']);
  assert.deepEqual(Object.keys(filtered.weekSelectionMap.mixed.taskMetaByKey), ['10_21']);
  assert.deepEqual(filtered.defaultSelectedWeekIds, ['mixed']);
  assert.equal(buildPublicityCandidateSelections(filtered).flat().includes('video'), false);
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(filterVideoTaskSnapshot(filtered, true), filtered);
});
test('disabled policy preserves original catalog and selection', () => {
  assert.equal(filterVideoTaskSnapshot(snapshot, false), snapshot);
  const input = { preparedSelection: selection };
  assert.equal(filterVideoPublicitySelection(input, false), input);
});
test('stale explicit video-only requests cannot fall back to browser or count as incomplete', () => {
  assert.throws(() => filterVideoPublicitySelection({ preparedSelection: videoOnly }, true), { code: 'VIDEO_TASKS_IGNORED', statusCode: 400 });
  assert.throws(() => filterVideoPublicitySelection({ selectedTasks: ['Safety 类型:视频'] }, true), { code: 'VIDEO_TASKS_IGNORED' });
  const filtered = filterVideoPublicitySelection({ preparedSelection: selection, selectedTasks: Object.values(selection.idToName) }, true);
  assert.deepEqual(filtered.preparedSelection.taskIds, ['2_10_21_voice']);
  assert.deepEqual(filtered.selectedTasks, ['Speaking 类型:语音']);
});
