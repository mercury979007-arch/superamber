const test = require('node:test');
const assert = require('node:assert/strict');

const { applyCoHeadTeacherClasses } = require('../lib/coHeadTeacherClasses');

test('Pan and Shalom both receive C²-2 as a co-head-teacher class', () => {
  for (const username of ['Pan', 'shalom', 'SHALOM']) {
    assert.deepEqual(applyCoHeadTeacherClasses([], username), [{
      classCode: 'C²-2',
      squadId: '1731',
      relationship: 'co-head-teacher',
      sources: ['co-head-assignment'],
      type: 'offline',
    }]);
  }
});

test('co-head assignment upgrades an existing manageable class without duplication', () => {
  assert.deepEqual(applyCoHeadTeacherClasses([{
    classCode: 'c²-2',
    squadId: '1731',
    relationship: 'manageable',
    sources: ['dashboard'],
    type: 'offline',
  }], 'shalom'), [{
    classCode: 'C²-2',
    squadId: '1731',
    relationship: 'co-head-teacher',
    sources: ['dashboard', 'co-head-assignment'],
    type: 'offline',
  }]);
});

test('unrelated teachers and classes are unchanged', () => {
  const classes = [{
    classCode: 'J569',
    squadId: '1688',
    relationship: 'current-head-teacher',
    sources: ['my_squad'],
    type: 'offline',
  }];
  assert.deepEqual(applyCoHeadTeacherClasses(classes, 'Nancy'), classes);
});
