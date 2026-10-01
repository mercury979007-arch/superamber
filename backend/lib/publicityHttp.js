const cheerio = require('cheerio');

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanTaskLabel(value = '') {
  return normalizeText(value).replace(/\s*添加人:.*/, '').trim();
}

function extractWeekName(text = '') {
  const cleaned = cleanTaskLabel(text);
  const weekMatch = cleaned.match(/Week\s*\d+/i);
  if (weekMatch?.[0]) return weekMatch[0].replace(/\s+/g, '');
  const chineseWeekMatch = cleaned.match(/第\s*\d+\s*周/);
  if (chineseWeekMatch?.[0]) return chineseWeekMatch[0].replace(/\s+/g, '');
  return cleaned;
}

function isWeekNode(text = '') {
  const cleaned = cleanTaskLabel(text);
  return /^Week\s*\d+$/i.test(cleaned) || /^第\s*\d+\s*周$/.test(cleaned) || cleaned.includes('任务时间:');
}

function isHiddenNode($node) {
  const style = String($node.attr('style') || '').replace(/\s+/g, '').toLowerCase();
  const className = String($node.attr('class') || '');
  return style.includes('display:none') || style.includes('visibility:hidden') || /\bis-hidden\b/.test(className);
}

function getDirectLabel($, $node) {
  const direct = $node.children('.el-tree-node__content').first().find('.el-tree-node__label').first();
  if (direct.length > 0) {
    return cleanTaskLabel(direct.text());
  }
  const fallback = $node.find('> .label, > [data-label], > .task-label').first();
  if (fallback.length > 0) {
    return cleanTaskLabel(fallback.text() || fallback.attr('data-label') || '');
  }
  return '';
}

function getDirectTreeChildren($, $node) {
  const container = $node.children('.el-tree-node__children').first();
  if (container.length === 0) return [];
  return container.children('.el-tree-node').toArray().filter((child) => !isHiddenNode($(child)));
}

function collectLeafTasks($, $node) {
  const children = getDirectTreeChildren($, $node);
  const tasks = [];

  for (const child of children) {
    const $child = $(child);
    const label = getDirectLabel($, $child);
    const grandChildren = getDirectTreeChildren($, $child);
    if (!label) continue;
    if (isWeekNode(label)) continue;

    if (grandChildren.length === 0) {
      tasks.push(label);
      continue;
    }

    const nested = collectLeafTasks($, $child);
    if (nested.length > 0) {
      tasks.push(...nested);
    } else {
      tasks.push(label);
    }
  }

  return [...new Set(tasks.map((item) => cleanTaskLabel(item)).filter(Boolean))];
}

function extractTaskGroupsFromTreeHtml(html = '') {
  const $ = cheerio.load(html);
  const groups = [];
  const seen = new Set();

  const walk = (nodes) => {
    for (const node of nodes) {
      const $node = $(node);
      if (isHiddenNode($node)) continue;
      const label = getDirectLabel($, $node);
      const children = getDirectTreeChildren($, $node);

      if (!label) {
        if (children.length > 0) walk(children);
        continue;
      }

      if (isWeekNode(label)) {
        const weekName = extractWeekName(label);
        const tasks = collectLeafTasks($, $node);
        const key = `${weekName}__${tasks.join('|')}`;
        if (!seen.has(key)) {
          groups.push({
            id: weekName,
            name: weekName,
            sourceLabel: label,
            resourceCount: tasks.length || 1,
            tasks: tasks.length > 0 ? tasks : [label],
          });
          seen.add(key);
        }
        continue;
      }

      if (children.length > 0) {
        walk(children);
      }
    }
  };

  const roots = $('.el-dialog .el-tree > .el-tree-node, .el-tree > .el-tree-node').toArray();
  if (roots.length > 0) {
    walk(roots);
  }

  return groups;
}

function getRowCells($, row) {
  return $(row)
    .find('th,td')
    .toArray()
    .map((cell) => normalizeText($(cell).text()));
}

function padRows(rows = []) {
  const width = Math.max(...rows.map((row) => row.length), 0);
  return rows.map((row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function scorePublicityTable(table) {
  const header = table.rows[0]?.join('|') || '';
  const studentLikeRowCount = table.rows.filter((row) => {
    const left = String(row[0] || '').trim();
    const no = String(row[1] || '').trim();
    const fallbackNo = String(row[2] || '').trim();
    return (
      ((left === '' || /^\d+$/.test(left)) && /^\d{6,}$/.test(no)) ||
      (/^\d{6,}$/.test(left) && (fallbackNo !== '' || no !== ''))
    );
  }).length;

  let score = 0;
  if (header.includes('中文')) score += 4;
  if (header.includes('英文')) score += 3;
  if (header.includes('My Week') || header.includes('词王')) score += 4;
  if (header.includes('周一') || header.includes('周末')) score += 2;
  if (header.includes('Key|Value')) score -= 100;
  if (studentLikeRowCount > 0) score += 8;
  if (table.rows.length <= 3 && studentLikeRowCount === 0) score -= 6;
  score += Math.min(table.rows.length, 40) / 10;

  return {
    ...table,
    header,
    studentLikeRowCount,
    score,
  };
}

function mergeSplitHeaderTables(tables = []) {
  const merged = [];
  for (let i = 0; i < tables.length - 1; i += 1) {
    const head = tables[i];
    const body = tables[i + 1];
    const headRow0 = head.rows[0] || [];
    const splitHeaderLike =
      head.rows.length >= 3 &&
      headRow0.includes('学号') &&
      (headRow0.includes('中文') || headRow0.includes('中文名')) &&
      (headRow0.includes('英文') || headRow0.includes('英文名'));
    const bodyLooksLikeStudentRows =
      body.rows.length >= 8 &&
      (
        (((body.rows[0]?.[0] || '') === '' || /^\d+$/.test(body.rows[0]?.[0] || '')) && /^\d{6,}$/.test(body.rows[0]?.[1] || '')) ||
        (/^\d{6,}$/.test(body.rows[0]?.[0] || '') && Boolean(body.rows[0]?.[2] || body.rows[0]?.[1]))
      );

    if (!splitHeaderLike || !bodyLooksLikeStudentRows) continue;

    const mergedWidth = Math.max(head.colCount, body.colCount);
    const fill = (row) => {
      const copy = [...row];
      while (copy.length < mergedWidth) copy.push('');
      return copy;
    };

    merged.push({
      index: `${head.index}+${body.index}`,
      rows: [...head.rows.map(fill), ...body.rows.map(fill)],
      rowCount: head.rows.length + body.rows.length,
      colCount: mergedWidth,
    });
  }
  return merged;
}

function isReadyPublicityTable(best) {
  if (!best || best.studentLikeRowCount <= 0 || best.rowCount < 4) {
    return false;
  }
  const header = String(best.header || '');
  const hasBaseHeader =
    header.includes('学号') &&
    (header.includes('中文') || header.includes('中文名')) &&
    (header.includes('英文') || header.includes('英文名'));
  return hasBaseHeader || String(best.index).includes('+');
}

function extractPublicityTableFromHtml(html = '') {
  const $ = cheerio.load(html);
  const tables = $('table').toArray().map((table, index) => {
    const rows = $(table)
      .find('tr')
      .toArray()
      .map((row) => getRowCells($, row))
      .filter((row) => row.some(Boolean));

    if (rows.length < 2) return null;

    const paddedRows = padRows(rows);
    return {
      index,
      rows: paddedRows,
      rowCount: paddedRows.length,
      colCount: Math.max(...paddedRows.map((row) => row.length), 0),
    };
  }).filter(Boolean);

  const candidates = [...tables, ...mergeSplitHeaderTables(tables)].map(scorePublicityTable);
  candidates.sort((a, b) => b.score - a.score);
  return {
    best: candidates[0] || null,
    candidateCount: candidates.length,
  };
}

function extractTaskNamesFromTableRows(tableRows = []) {
  const headers = [];
  for (const row of tableRows.slice(0, 3)) {
    for (const cell of row || []) {
      const cleaned = cleanTaskLabel(cell);
      if (!cleaned) continue;
      if (['学号', '中文名', '英文名', '是否完成', '平均分', '第一次得分', '分数(15)', 'PK次数', '词王平均正确率', '是否达到词王'].includes(cleaned)) {
        continue;
      }
      if (!headers.includes(cleaned)) {
        headers.push(cleaned);
      }
    }
  }
  return headers;
}

function buildTaskGroupsFromTableRows(tableRows = []) {
  const taskNames = extractTaskNamesFromTableRows(tableRows);
  if (taskNames.length === 0) return [];

  const grouped = new Map();
  for (const task of taskNames) {
    const weekName = extractWeekName(task) || '当前任务';
    const current = grouped.get(weekName) || {
      id: weekName,
      name: weekName,
      sourceLabel: weekName,
      resourceCount: 0,
      tasks: [],
    };
    current.tasks.push(task);
    current.tasks = [...new Set(current.tasks)];
    current.resourceCount = current.tasks.length;
    grouped.set(weekName, current);
  }

  return Array.from(grouped.values());
}

function tableMatchesSelectedTasks(tableRows = [], selectedTasks = []) {
  const wanted = Array.isArray(selectedTasks)
    ? [...new Set(selectedTasks.map((item) => cleanTaskLabel(item)).filter(Boolean))]
    : [];
  if (wanted.length === 0) return true;

  const headers = extractTaskNamesFromTableRows(tableRows);
  const haystack = headers.map((item) => cleanTaskLabel(item));
  return wanted.every((task) =>
    haystack.some((header) => header === task || header.includes(task) || task.includes(header))
  );
}

function extractPublicityTaskListFromHtml(html = '') {
  const taskGroups = extractTaskGroupsFromTreeHtml(html);
  if (taskGroups.length > 0) {
    return { taskGroups, tasks: [...new Set(taskGroups.flatMap((group) => group.tasks || []))] };
  }

  const parsedTable = extractPublicityTableFromHtml(html);
  if (isReadyPublicityTable(parsedTable.best)) {
    const groupsFromTable = buildTaskGroupsFromTableRows(parsedTable.best.rows);
    if (groupsFromTable.length > 0) {
      return {
        taskGroups: groupsFromTable,
        tasks: [...new Set(groupsFromTable.flatMap((group) => group.tasks || []))],
      };
    }
  }

  return { taskGroups: [], tasks: [] };
}

function extractPublicityExportDataFromHtml(html = '', options = {}) {
  const parsed = extractPublicityTableFromHtml(html);
  if (!isReadyPublicityTable(parsed.best)) {
    return null;
  }
  if (!tableMatchesSelectedTasks(parsed.best.rows, options.selectedTasks)) {
    return null;
  }

  const bodyText = normalizeText(cheerio.load(html).root().text());
  const weekMatch = bodyText.match(/第\s*(\d{1,2})\s*周/);

  return {
    week: weekMatch ? Number(weekMatch[1]) : null,
    tableRows: parsed.best.rows,
    meta: {
      tableIndex: parsed.best.index,
      rowCount: parsed.best.rowCount,
      colCount: parsed.best.colCount,
      candidateCount: parsed.candidateCount,
      transport: 'http-html',
    },
  };
}

module.exports = {
  buildTaskGroupsFromTableRows,
  extractPublicityExportDataFromHtml,
  extractPublicityTaskListFromHtml,
  extractTaskNamesFromTableRows,
  normalizeText,
  cleanTaskLabel,
  extractWeekName,
};
