const cheerio = require('cheerio');

function normalizeClassName(value = '') {
  return String(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractClassCode(value = '') {
  const text = normalizeClassName(value);
  if (!text) return '';

  const patterns = [
    /(?:^|\s)([A-Z]{1,12}\d+(?:平方|班)?)(?=\s|$)/u,
    /(?:^|\s)([A-Z]{1,12}²[-－]\d+)(?=\s|$)/u,
    /(?:^|\s)([A-Z]{1,12}\d*[-－]\d+)(?=\s|$)/u,
    /(?:^|\s)((?:\d+专项课[A-Z]班|专项集训[A-Z]班|[一二三四五六七八九十]\d+班))(?=\s|$)/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/－/g, '-');
  }
  return '';
}

function dedupeClassMap(entries = []) {
  const bySquadId = new Map();
  for (const entry of entries) {
    const classCode = normalizeClassName(entry?.classCode);
    const squadId = String(entry?.squadId || '').trim();
    if (!classCode || !squadId) continue;

    const existing = bySquadId.get(squadId);
    const sources = Array.from(new Set([...(existing?.sources || []), ...(entry.sources || [])]));
    bySquadId.set(squadId, {
      ...(existing || {}),
      ...entry,
      classCode,
      squadId,
      relationship: existing?.relationship === 'current-head-teacher'
        ? existing.relationship
        : (entry.relationship || existing?.relationship || 'manageable'),
      sources,
    });
  }
  return Array.from(bySquadId.values());
}

function extractMySquadClassMap(html = '') {
  const $ = cheerio.load(html);
  const entries = [];
  $('a[href*="squad_console"]').each((_, link) => {
    const href = $(link).attr('href') || '';
    const idMatch = href.match(/[?&](?:id|squad_id)=(\d+)/);
    if (!idMatch) return;
    const classCode = extractClassCode($(link).text())
      || extractClassCode($(link).closest('.column-name').text());
    if (!classCode) return;
    entries.push({
      classCode,
      squadId: idMatch[1],
      relationship: 'current-head-teacher',
      sources: ['my_squad'],
      type: 'offline',
    });
  });
  return dedupeClassMap(entries);
}

function extractDashboardTutorId(html = '') {
  const patterns = [
    /axios\.get\(\s*["']\/admin\/dashboard\/getSquadData\?id=(\d+)["']/i,
    /\/admin\/dashboard\/getSquadData\?id=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function extractDashboardClassMap(payload = {}) {
  const candidates = Array.isArray(payload?.myClasses)
    ? payload.myClasses
    : (Array.isArray(payload?.data?.myClasses) ? payload.data.myClasses : []);
  return dedupeClassMap(candidates
    .filter((item) => String(item?.type || 'offline').toLowerCase() === 'offline')
    .map((item) => ({
      classCode: normalizeClassName(item?.name),
      squadId: String(item?.squad_id || item?.id || ''),
      relationship: 'manageable',
      sources: ['dashboard'],
      type: 'offline',
    })));
}

function extractClassMapFromHtml(html = '') {
  const $ = cheerio.load(html);
  const selectors = ['.small-box', '.box', '.panel', '.col-md-3', '.col-sm-3', '.col-xs-6', 'li', 'tr'];
  const entries = [];
  $('a[href*="/admin/squad_console"]').each((_, link) => {
    const href = $(link).attr('href') || '';
    const idMatch = href.match(/[?&](?:id|squad_id)=(\d+)/);
    if (!idMatch) return;
    const candidates = selectors.map((selector) => $(link).closest(selector).text());
    candidates.push($(link).parent().text(), $(link).text());
    const classCode = candidates.map(extractClassCode).find(Boolean);
    if (!classCode) return;
    entries.push({ classCode, squadId: idMatch[1] });
  });
  return dedupeClassMap(entries).map(({ classCode, squadId }) => ({ classCode, squadId }));
}

module.exports = {
  dedupeClassMap,
  extractClassCode,
  extractClassMapFromHtml,
  extractDashboardClassMap,
  extractDashboardTutorId,
  extractMySquadClassMap,
  normalizeClassName,
};
