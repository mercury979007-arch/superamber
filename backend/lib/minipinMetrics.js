function extractStats(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const extractNumber = (patterns) => {
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return Number(match[1]);
    }
    return null;
  };

  return {
    coupon: extractNumber([
      /可发放\s*Coupon[:：\s]*(\d+)/i,
      /Coupon[:：\s]*(\d+)/i,
      /["']coupon["']\s*[:=]\s*["']?(\d+)/i,
    ]),
    minipin: extractNumber([
      /可发放\s*Mini\s*[Pp]in[:：\s]*(\d+)/i,
      /Mini\s*[Pp]in[:：\s]*(\d+)/i,
      /可发放\s*MP[:：\s]*(\d+)/i,
      /当前(?:班内)?余额[:：\s]*(\d+)\s*MP/i,
      /["']minipin["']\s*[:=]\s*["']?(\d+)/i,
      /["']mini[_\s-]*pin["']\s*[:=]\s*["']?(\d+)/i,
      /["']mp["']\s*[:=]\s*["']?(\d+)/i,
    ]),
    distributed: extractNumber([/发放\s*MP[:：\s]*(\d+)/i]),
    pending: extractNumber([/待发\s*MP[:：\s]*(\d+)/i]),
  };
}

function extractJsonStats(value) {
  const metrics = {
    coupon: null,
    minipin: null,
    distributed: null,
    pending: null,
  };

  const assign = (field, candidate) => {
    if (metrics[field] != null) return;
    if (candidate == null || candidate === '') return;
    const num = Number(candidate);
    if (Number.isFinite(num)) {
      metrics[field] = num;
    }
  };

  const visit = (node, path = '') => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== 'object') return;

    for (const [rawKey, rawValue] of Object.entries(node)) {
      const key = String(rawKey || '');
      const nextPath = path ? `${path}.${key}` : key;

      if (rawValue && typeof rawValue === 'object') {
        visit(rawValue, nextPath);
        continue;
      }

      if (typeof rawValue === 'number' || (typeof rawValue === 'string' && /^-?\d+(?:\.\d+)?$/.test(rawValue.trim()))) {
        if (/(pending|wait|waiting|todo|remain)/i.test(nextPath) && /(mini_?pin|mp)/i.test(nextPath)) {
          assign('pending', rawValue);
          continue;
        }
        if (/(distributed|granted|sent|issued)/i.test(nextPath) && /(mini_?pin|mp)/i.test(nextPath)) {
          assign('distributed', rawValue);
          continue;
        }
        if (/(^|_|\.)(mini_?pin|mini\s*pin|minipin|mp)(_|$)/i.test(nextPath)) {
          assign('minipin', rawValue);
          continue;
        }
        if (/(^|_|\.)(coupon|cp)(_|$)/i.test(nextPath)) {
          assign('coupon', rawValue);
          continue;
        }
      }
    }
  };

  visit(value);
  return metrics;
}

function extractComponentStats(html = '') {
  const snippets = [];
  const collectSnippets = (source = '') => {
    for (const match of source.matchAll(/.{0,240}(?:counpon-minipin|coupon-minipin|minipin|Mini\s*Pin|Coupon).{0,240}/gi)) {
      const snippet = String(match[0] || '').replace(/\s+/g, ' ').trim();
      if (snippet && !snippets.includes(snippet)) {
        snippets.push(snippet);
      }
      if (snippets.length >= 8) break;
    }
  };

  collectSnippets(html);
  const joined = snippets.join(' ');
  const metrics = extractStats(joined);

  return {
    metrics,
    snippets,
  };
}

function mergeMetrics(target, candidate = {}) {
  if (target.coupon == null && candidate.coupon != null) target.coupon = candidate.coupon;
  if (target.minipin == null && candidate.minipin != null) target.minipin = candidate.minipin;
  if (target.distributed == null && candidate.distributed != null) target.distributed = candidate.distributed;
  if (target.pending == null && candidate.pending != null) target.pending = candidate.pending;
}

module.exports = {
  extractStats,
  extractJsonStats,
  extractComponentStats,
  mergeMetrics,
};
