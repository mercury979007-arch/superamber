const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEnglishName, englishNameOrPlaceholder } = require('../lib/studentNames');

test('preserves English names with Chinese disambiguators, punctuation and accented Latin letters', () => {
  for (const name of ['Demo复姓', 'Demo甲', 'Test A甲', 'Test B乙', 'Demo乙', 'Demo丙', "Mary-Jane O’Neil", 'Éléa']) {
    assert.equal(normalizeEnglishName(`  ${name}  `), name);
    assert.equal(englishNameOrPlaceholder(name, 'S1', 0, '中文名'), name);
  }
  assert.equal(normalizeEnglishName('  Test   A甲  '), 'Test A甲');
});

test('missing or Chinese-only English fields retain identifiable fallback without inventing a name', () => {
  for (const value of ['', '   ', null, undefined, '张三', '123']) {
    assert.equal(normalizeEnglishName(value), '');
    assert.equal(englishNameOrPlaceholder(value, 'S1', 0, '张三'), '张三');
  }
  assert.equal(englishNameOrPlaceholder('', 'S1', 2), '待核对姓名 3');
});
