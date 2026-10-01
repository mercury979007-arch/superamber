const { Router } = require('express');
const cheerio = require('cheerio');
const { isTestOnlyRequestAllowed, rejectIfTestOnlyRouteBlocked } = require('../lib/testOnlyAccess');
const SCORE_BOOK_HTTP_TIMEOUT_MS = 20000;
const SCORE_BOOK_ROUTE_CACHE_TTL_MS = 30 * 60 * 1000;

function createTimeoutSignal(ms = SCORE_BOOK_HTTP_TIMEOUT_MS) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function getScoreBookSessionCache(session) {
  if (!session.scoreBookCache || typeof session.scoreBookCache !== 'object') {
    session.scoreBookCache = {};
  }
  return session.scoreBookCache;
}

function readScoreBookCache(session, key) {
  const cache = getScoreBookSessionCache(session);
  const entry = cache[key];
  if (!entry || !entry.fetchedAt) return null;
  if (Date.now() - entry.fetchedAt > SCORE_BOOK_ROUTE_CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function writeScoreBookCache(session, key, data) {
  const cache = getScoreBookSessionCache(session);
  cache[key] = {
    fetchedAt: Date.now(),
    data,
  };
}

function invalidateScoreBookCache(session, prefix) {
  const cache = getScoreBookSessionCache(session);
  Object.keys(cache).forEach((key) => {
    if (key.startsWith(prefix)) {
      delete cache[key];
    }
  });
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\-_.·]/g, '');
}

function sanitizeScoreInput(value) {
  if (value === '' || value == null) return '';
  const score = Number(value);
  if (!Number.isFinite(score)) return '';
  return Math.round(score * 100) / 100;
}

function appendNestedFormData(params, prefix, value) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendNestedFormData(params, `${prefix}[${index}]`, item);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      appendNestedFormData(params, `${prefix}[${key}]`, item);
    });
    return;
  }

  params.append(prefix, value == null ? '' : String(value));
}

function buildTodoPath(termIds = [], pageNumber = 1) {
  const params = new URLSearchParams();
  ['1', '2', '3', '4'].forEach((status) => params.append('status[]', status));
  const normalizedTermIds = (Array.isArray(termIds) ? termIds : [termIds])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  normalizedTermIds.forEach((termId) => params.append('term[]', termId));
  params.set('page', String(pageNumber));
  return `/admin/my_todo_notices?${params.toString()}`;
}

function hasUsableTaskCache(tasks) {
  return Array.isArray(tasks) && tasks.length > 0;
}

function parseTodoTasks(html, classCode) {
  const $ = cheerio.load(html);
  const normalizedClassCode = String(classCode || '').trim().toUpperCase();
  const results = new Map();

  function maybePushTask(task) {
    const noticeId = String(task?.noticeId || '').trim();
    const title = String(task?.title || '').replace(/\s+/g, ' ').trim();
    const noticeType = String(task?.noticeType || '').replace(/\s+/g, ' ').trim();
    const forceScoreBook = task?.forceScoreBook === true;
    if (!noticeId || !title) return;

    const titleUpper = title.toUpperCase();
    const typeUpper = noticeType.toUpperCase();
    const looksLikeScoreBook = forceScoreBook
      || typeUpper.includes('测试')
      || title.includes('测试')
      || title.includes('成绩录入')
      || titleUpper.includes('SCORE');
    if (!looksLikeScoreBook) return;
    if (normalizedClassCode && !titleUpper.includes(normalizedClassCode)) return;

    results.set(noticeId, {
      noticeId,
      noticeType: noticeType || '测试',
      title,
      startTime: String(task?.startTime || '').trim(),
      endTime: String(task?.endTime || '').trim(),
      status: String(task?.status || '').replace(/\s+/g, ' ').trim(),
    });
  }

  $('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 5) return;

    const id = $(cells[1]).text().trim();
    const noticeType = $(cells[3]).text().trim();
    const eventTitle = $(cells[4]).text().replace(/\s+/g, ' ').trim();
    const startTime = $(cells[5]).text().trim();
    const endTime = $(cells[6]).text().trim();
    const statusText = $(cells[cells.length - 1]).text().replace(/\s+/g, ' ').trim();

    maybePushTask({
      noticeId: id,
      noticeType,
      title: eventTitle,
      startTime,
      endTime,
      status: statusText,
    });
  });

  $('a[href*="/admin/score_book/index"]').each((_, anchor) => {
    const href = $(anchor).attr('href') || '';
    const noticeId = String(href.match(/notice_id=(\d+)/)?.[1] || '').trim();
    if (!noticeId) return;

    const container = $(anchor).closest('tr, li, .notice-item, .todo-item, .card, .panel');
    const text = (container.length > 0 ? container.text() : $(anchor).text()).replace(/\s+/g, ' ').trim();
    maybePushTask({
      noticeId,
      noticeType: text.includes('测试') ? '测试' : '',
      title: text,
      forceScoreBook: true,
    });
  });

  return Array.from(results.values()).sort((a, b) => Number(b.noticeId) - Number(a.noticeId));
}

function assertScoreBookRowShape(row) {
  const items = Array.isArray(row?.item) ? row.item : [];
  if (items.length !== 1) {
    throw new Error('当前任务不是单评分项结构，暂不支持快捷录入');
  }

  const children = Array.isArray(items[0]?.children) ? items[0].children : [];
  if (children.length !== 1) {
    throw new Error('当前任务不是单总分结构，暂不支持快捷录入');
  }

  return {
    itemKey: String(items[0]?.key || '').trim(),
    itemLimit: Number(items[0]?.limit) || 0,
    childKey: String(children[0]?.key || '').trim(),
    childLimit: Number(children[0]?.limit) || 0,
  };
}

function buildAliasIndex(rows) {
  const aliasMap = new Map();

  rows.forEach((row) => {
    const aliases = [
      row.enName,
      row.chName,
      row.studentNo,
      ...(Array.isArray(row.aliases) ? row.aliases : []),
    ]
      .map((item) => normalizeName(item))
      .filter(Boolean);

    aliases.forEach((alias) => {
      const current = aliasMap.get(alias) || [];
      current.push(row);
      aliasMap.set(alias, current);
    });
  });

  return aliasMap;
}

function pickRowsByRawName(aliasMap, rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) return [];

  const dedupeRows = (rows = []) => {
    const deduped = new Map();
    rows.forEach((row) => {
      deduped.set(String(row.rowId), row);
    });
    return Array.from(deduped.values());
  };

  const exact = dedupeRows(aliasMap.get(normalized) || []);
  if (exact.length > 0) return exact;

  const partial = [];
  for (const [alias, rows] of aliasMap.entries()) {
    if (alias.includes(normalized) || normalized.includes(alias)) {
      partial.push(...rows);
    }
  }

  return dedupeRows(partial);
}

function buildParticipationPayload(row, score, comment) {
  const normalizedScore = sanitizeScoreInput(score);
  const click = {
    id: row.rowId,
    ch_name: row.chName,
    en_name: row.enName,
    no: row.studentNo,
    item: JSON.parse(JSON.stringify(row.item)),
    status: '参加',
    exstatus: Array.isArray(row.exstatus) ? row.exstatus : [],
    total: normalizedScore,
    sum: row.itemLimit,
    final: normalizedScore,
    comment: comment == null ? (row.comment || '') : String(comment),
  };

  if (click.item[0]) {
    click.item[0].total = normalizedScore;
    if (Array.isArray(click.item[0].children) && click.item[0].children[0]) {
      click.item[0].children[0].total = normalizedScore;
    }
  }

  return click;
}

function buildAbsentPayload(row, comment) {
  const click = {
    id: row.rowId,
    ch_name: row.chName,
    en_name: row.enName,
    no: row.studentNo,
    item: JSON.parse(JSON.stringify(row.item)),
    status: '未参加',
    exstatus: Array.isArray(row.exstatus) ? row.exstatus : [],
    total: '',
    sum: row.itemLimit,
    final: '',
    comment: comment == null ? (row.comment || '') : String(comment),
  };

  click.item.forEach((item) => {
    item.total = '';
    (Array.isArray(item.children) ? item.children : []).forEach((child) => {
      child.total = '';
    });
  });

  return click;
}

function rowHasRecordedScore(row) {
  const scoreHit = (Array.isArray(row.score) ? row.score : []).some((item) => String(item?.score || '').trim() !== '');
  if (scoreHit) return true;
  return (Array.isArray(row.item) ? row.item : []).some((item) => {
    if (String(item?.total || '').trim() !== '') return true;
    return (Array.isArray(item?.children) ? item.children : []).some((child) => String(child?.total || '').trim() !== '');
  });
}

async function fetchScoreBookPage(scraper, noticeId) {
  const { response, text } = await scraper.requestText(`/admin/score_book/index?notice_id=${encodeURIComponent(noticeId)}`, {
    headers: { accept: 'text/html' },
    signal: createTimeoutSignal(),
  });
  if (!response.ok) {
    throw new Error(`成绩录入页获取失败 (HTTP ${response.status})`);
  }
  if (scraper.isLoginPage(text, response.url)) {
    throw new Error('登录状态已失效，请重新登录');
  }
  const token =
    text.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)/i)?.[1]
    || text.match(/_token:\s*"([^"]+)"/)?.[1]
    || '';
  if (!token) {
    throw new Error('无法提取成绩录入页 token');
  }
  return { html: text, token };
}

async function fetchScoreBookInit(scraper, noticeId) {
  const response = await scraper.request(`/admin/score_book/getInitData?id=${encodeURIComponent(noticeId)}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
    },
    signal: createTimeoutSignal(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number(data?.code) !== 1) {
    throw new Error(String(data?.msg || `初始化数据获取失败: HTTP ${response.status}`));
  }
  return data;
}

async function fetchScoreBookRows(scraper, noticeId, token, filters = {}) {
  const params = new URLSearchParams();
  params.set('notice_id', String(noticeId));
  params.set('ch_name', String(filters.chName || ''));
  params.set('en_name', String(filters.enName || ''));
  params.set('_token', String(token));
  params.set('sort[sortBy]', 'en_name');
  params.set('sort[orderBy]', 'ASC');
  params.set('page[pageSize]', '200');
  params.set('page[pageNumber]', '1');
  params.set('page[total]', '0');

  const response = await scraper.request(`/admin/score_book/getTableData?${params.toString()}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
    },
    signal: createTimeoutSignal(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number(data?.code) !== 1) {
    throw new Error(String(data?.msg || `学生表获取失败: HTTP ${response.status}`));
  }
  const rows = Array.isArray(data?.data?.rows) ? data.data.rows : [];

  return rows.map((row) => {
    const shape = assertScoreBookRowShape(row);
    return {
      rowId: Number(row?.id) || 0,
      noticeId: Number(row?.notice_id) || 0,
      studentId: String(row?.student_id || '').trim(),
      studentNo: String(row?.no || '').trim(),
      chName: String(row?.ch_name || '').trim(),
      enName: String(row?.en_name || '').trim(),
      status: String(row?.status || '').trim(),
      type: String(row?.type || '').trim(),
      comment: row?.comment == null ? '' : String(row.comment),
      exstatus: Array.isArray(row?.exstatus) ? row.exstatus.map((item) => String(item)) : [],
      item: Array.isArray(row?.item) ? row.item : [],
      score: Array.isArray(row?.score) ? row.score : [],
      itemKey: shape.itemKey,
      childKey: shape.childKey,
      itemLimit: shape.itemLimit,
      childLimit: shape.childLimit,
      aliases: [
        String(row?.en_name || ''),
        String(row?.ch_name || ''),
        String(row?.no || ''),
      ],
    };
  });
}

async function postScoreBookSubmission(scraper, noticeId, token, clickData) {
  const xsrfToken = scraper.getDecodedCookieValue('XSRF-TOKEN');
  const body = new URLSearchParams();
  appendNestedFormData(body, 'data', clickData);
  body.append('_token', token);

  const response = await scraper.request('/admin/score_book/NewSubmit', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: scraper.baseUrl,
      referer: `${scraper.baseUrl}/admin/score_book/index?notice_id=${encodeURIComponent(noticeId)}`,
      'x-requested-with': 'XMLHttpRequest',
      ...(xsrfToken ? { 'x-xsrf-token': xsrfToken } : {}),
    },
    signal: createTimeoutSignal(),
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number(data?.code) !== 1) {
    throw new Error(String(data?.msg || `成绩保存失败: HTTP ${response.status}`));
  }
}

function createScoreBookRoutes({
  requireLoggedInSession,
  buildUsageEvent,
  appendUsageEvent,
  USAGE_LOG_PATH,
  sanitizeText,
}) {
  const router = Router();

  router.post('/score-book/tasks', async (req, res) => {
    try {
      if (rejectIfTestOnlyRouteBlocked(req, res)) return;
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const classId = String(req.body?.classId || '').trim();
      const termIds = Array.isArray(req.body?.termIds) ? req.body.termIds : [];
      if (!classId) {
        return res.status(400).json({ error: '缺少班级ID' });
      }

      const cacheKey = `tasks:${classId}:${termIds.join(',')}`;
      const cachedTasks = readScoreBookCache(session, cacheKey);
      if (hasUsableTaskCache(cachedTasks)) {
        return res.json({ status: 'success', data: cachedTasks, count: cachedTasks.length, cached: true });
      }

      const tasks = [];
      for (let pageNumber = 1; pageNumber <= 8; pageNumber += 1) {
        const { text } = await session.scraper.requestText(buildTodoPath(termIds, pageNumber), {
          headers: { accept: 'text/html' },
        });
        const pageTasks = parseTodoTasks(text, classId);
        if (pageTasks.length === 0 && pageNumber > 1) {
          break;
        }
        tasks.push(...pageTasks);
      }

      const dedupedTasks = Array.from(
        new Map(tasks.map((task) => [String(task.noticeId), task])).values(),
      ).sort((a, b) => Number(b.noticeId) - Number(a.noticeId));
      if (dedupedTasks.length > 0) {
        writeScoreBookCache(session, cacheKey, dedupedTasks);
      }
      res.json({ status: 'success', data: dedupedTasks, count: dedupedTasks.length });
    } catch (error) {
      console.error('❌ 获取测试任务失败:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/score-book/roster', async (req, res) => {
    try {
      if (rejectIfTestOnlyRouteBlocked(req, res)) return;
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const classId = String(req.body?.classId || '').trim();
      const noticeId = String(req.body?.noticeId || '').trim();
      if (!classId || !noticeId) {
        return res.status(400).json({ error: '缺少班级或任务ID' });
      }

      const cacheKey = `roster:${classId}:${noticeId}`;
      const cachedRoster = readScoreBookCache(session, cacheKey);
      if (cachedRoster) {
        return res.json({ status: 'success', data: cachedRoster, cached: true });
      }

      const { token } = await fetchScoreBookPage(session.scraper, noticeId);
      const initData = await fetchScoreBookInit(session.scraper, noticeId);
      const rows = await fetchScoreBookRows(session.scraper, noticeId, token);

      const payload = {
        noticeId,
        token,
        initData: {
          className: String(initData?.squad_name || '').trim(),
          teacherName: String(initData?.tutor_name || '').trim(),
          testName: String(initData?.test_name || '').trim(),
          currentCount: Number(initData?.zaidu_num) || 0,
          expectedCount: Number(initData?.yingce_num) || 0,
          absentCount: Number(initData?.qingjia_num) || 0,
          testType: String(initData?.test_type || '').trim(),
        },
        rows,
      };
      writeScoreBookCache(session, cacheKey, payload);

      res.json({
        status: 'success',
        data: payload,
      });
    } catch (error) {
      console.error('❌ 获取测试名单失败:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/score-book/submit', async (req, res) => {
    try {
      if (rejectIfTestOnlyRouteBlocked(req, res)) return;
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const classId = String(req.body?.classId || '').trim();
      const noticeId = String(req.body?.noticeId || '').trim();
      const mode = String(req.body?.mode || '').trim();
      const fillMissingAbsent = req.body?.fillMissingAbsent === true;
      const overwriteExisting = req.body?.overwriteExisting !== false;
      if (!classId || !noticeId) {
        return res.status(400).json({ error: '缺少班级或任务ID' });
      }
      if (!['named', 'grouped'].includes(mode)) {
        return res.status(400).json({ error: '不支持的录入模式' });
      }

      console.log('📝 测试成绩提交开始:', {
        classId,
        noticeId,
        mode,
        fillMissingAbsent,
        overwriteExisting,
        namedCount: Array.isArray(req.body?.entries) ? req.body.entries.length : 0,
        groupCount: Array.isArray(req.body?.groups) ? req.body.groups.length : 0,
      });

      console.log('📝 测试成绩提交步骤: fetchScoreBookPage');
      const { token } = await fetchScoreBookPage(session.scraper, noticeId);
      console.log('📝 测试成绩提交步骤: fetchScoreBookInit');
      const initData = await fetchScoreBookInit(session.scraper, noticeId);
      console.log('📝 测试成绩提交步骤: fetchScoreBookRows');
      const rows = await fetchScoreBookRows(session.scraper, noticeId, token);
      const rowById = new Map(rows.map((row) => [String(row.rowId), row]));
      const aliasMap = buildAliasIndex(rows);
      const desiredByRowId = new Map();
      const unmatchedEntries = [];
      const ambiguousEntries = [];
      const duplicateAssignments = [];
      const skippedExisting = [];

      if (mode === 'named') {
        const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
        for (const entry of entries) {
          const rawName = String(entry?.rawName || entry?.name || '').trim();
          const explicitRowId = String(entry?.rowId || '').trim();
          const score = sanitizeScoreInput(entry?.score);
          const comment = entry?.comment == null ? '' : String(entry.comment);
          if (!rawName && !explicitRowId) continue;
          if (score === '') {
            unmatchedEntries.push({ rawName: rawName || explicitRowId, error: '缺少有效分数' });
            continue;
          }

          if (explicitRowId) {
            const directRow = rowById.get(explicitRowId);
            if (!directRow) {
              unmatchedEntries.push({ rawName: rawName || explicitRowId, error: 'rowId 未匹配到学生' });
              continue;
            }
            if (desiredByRowId.has(String(directRow.rowId))) {
              duplicateAssignments.push({ rowId: directRow.rowId, student: directRow.enName || directRow.chName, rawName: rawName || explicitRowId });
              continue;
            }
            desiredByRowId.set(String(directRow.rowId), {
              row: directRow,
              score,
              comment,
              status: '参加',
            });
            continue;
          }

          const candidateNames = Array.from(
            new Set(
              [
                rawName,
                entry?.fallbackName,
                ...(Array.isArray(entry?.aliasCandidates) ? entry.aliasCandidates : []),
              ]
                .map((item) => String(item || '').trim())
                .filter(Boolean),
            ),
          );

          let matchedRows = [];
          let matchedName = rawName;
          let ambiguousMatch = null;

          for (const candidateName of candidateNames) {
            const currentMatches = pickRowsByRawName(aliasMap, candidateName);
            if (currentMatches.length === 1) {
              matchedRows = currentMatches;
              matchedName = candidateName;
              break;
            }
            if (currentMatches.length > 1 && !ambiguousMatch) {
              ambiguousMatch = { name: candidateName, rows: currentMatches };
            }
          }

          if (matchedRows.length === 0 && !ambiguousMatch) {
            unmatchedEntries.push({ rawName, error: '未匹配到学生' });
            continue;
          }
          if (matchedRows.length === 0 && ambiguousMatch) {
            ambiguousEntries.push({
              rawName: ambiguousMatch.name,
              candidates: ambiguousMatch.rows.map((row) => `${row.enName}/${row.chName}/${row.studentNo}`),
            });
            continue;
          }
          const row = matchedRows[0];
          if (desiredByRowId.has(String(row.rowId))) {
            duplicateAssignments.push({ rowId: row.rowId, student: row.enName || row.chName, rawName: matchedName });
            continue;
          }
          desiredByRowId.set(String(row.rowId), {
            row,
            score,
            comment,
            status: '参加',
          });
        }
      }

      if (mode === 'grouped') {
        const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
        for (const group of groups) {
          const score = sanitizeScoreInput(group?.score);
          const comment = group?.comment == null ? '' : String(group.comment);
          const studentIds = Array.isArray(group?.studentIds) ? group.studentIds : [];
          if (score === '') continue;
          for (const studentId of studentIds) {
            const row = rowById.get(String(studentId));
            if (!row) continue;
            if (desiredByRowId.has(String(row.rowId))) {
              duplicateAssignments.push({ rowId: row.rowId, student: row.enName || row.chName, rawName: String(studentId) });
              continue;
            }
            desiredByRowId.set(String(row.rowId), {
              row,
              score,
              comment,
              status: '参加',
            });
          }
        }
      }

      if (unmatchedEntries.length > 0 || ambiguousEntries.length > 0 || duplicateAssignments.length > 0) {
        return res.status(400).json({
          error: '录入数据存在未匹配、歧义或重复分配，未执行提交',
          unmatchedEntries,
          ambiguousEntries,
          duplicateAssignments,
        });
      }

      if (desiredByRowId.size === 0) {
        return res.status(400).json({ error: '没有可提交的有效录入结果' });
      }

      const submissions = [];
      let absentFilledCount = 0;
      rows.forEach((row) => {
        const assignment = desiredByRowId.get(String(row.rowId));
        if (assignment) {
          if (!overwriteExisting && row.status === '已批改') {
            skippedExisting.push({
              rowId: row.rowId,
              student: row.enName || row.chName,
              currentScore: row.score?.[0]?.score || '',
            });
            return;
          }
          submissions.push(buildParticipationPayload(row, assignment.score, assignment.comment));
          return;
        }
        if (fillMissingAbsent && !rowHasRecordedScore(row)) {
          submissions.push(buildAbsentPayload(row, row.comment || ''));
          absentFilledCount += 1;
        }
      });

      console.log('📝 测试成绩提交步骤: submitRows', { total: submissions.length });
      for (let index = 0; index < submissions.length; index += 1) {
        const clickData = submissions[index];
        console.log('📝 测试成绩提交单条:', {
          index: index + 1,
          total: submissions.length,
          rowId: clickData.id,
          status: clickData.status,
          totalScore: clickData.total,
          student: clickData.en_name || clickData.ch_name || clickData.no,
        });
        await postScoreBookSubmission(session.scraper, noticeId, token, clickData);
      }

      console.log('📝 测试成绩提交步骤: verifyRows');
      const verifiedRows = await fetchScoreBookRows(session.scraper, noticeId, token);
      invalidateScoreBookCache(session, `roster:${classId}:${noticeId}`);
      invalidateScoreBookCache(session, `tasks:${classId}:`);
      const summary = {
        noticeId,
        className: String(initData?.squad_name || '').trim(),
        testName: String(initData?.test_name || '').trim(),
        submittedCount: submissions.length,
        matchedCount: desiredByRowId.size,
        absentFilledCount,
        skippedExisting,
      };

      await appendUsageEvent(USAGE_LOG_PATH, buildUsageEvent(req, session, {
        event: 'score_book_submit',
        module: 'test-score-entry',
        className: sanitizeText(classId),
        detail: `notice=${noticeId};mode=${mode};submitted=${submissions.length}`,
        studentCount: submissions.length,
        successCount: submissions.length,
      }));

      console.log('✅ 测试成绩提交完成:', {
        classId,
        noticeId,
        submittedCount: submissions.length,
        matchedCount: desiredByRowId.size,
        skippedExisting: skippedExisting.length,
        absentFilledCount: summary.absentFilledCount,
      });

      res.json({
        status: 'success',
        data: {
          summary,
          rows: verifiedRows,
        },
      });
    } catch (error) {
      console.error('❌ 提交测试成绩失败:', {
        message: error.message,
        classId: String(req.body?.classId || '').trim(),
        noticeId: String(req.body?.noticeId || '').trim(),
        mode: String(req.body?.mode || '').trim(),
      });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createScoreBookRoutes,
  isTestOnlyRequestAllowed,
};
