// Academic rosters append Chinese disambiguators to English names (e.g. Demo复姓).
// Preserve the complete name so students sharing an English name stay distinguishable.
function normalizeEnglishName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  return /\p{Script=Latin}/u.test(name) ? name : '';
}

function englishNameOrPlaceholder(value, _studentNo, index, chineseName = '') {
  const name = normalizeEnglishName(value);
  if (name) return name;
  const chinese = String(chineseName || '').replace(/\s+/g, '').trim();
  return chinese || `待核对姓名 ${index + 1}`;
}

module.exports = { normalizeEnglishName, englishNameOrPlaceholder };
