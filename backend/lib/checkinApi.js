function parseFlexibleDateKey(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;

  const fullMatch = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (fullMatch) {
    const date = new Date(`${fullMatch[1]}-${String(fullMatch[2]).padStart(2, '0')}-${String(fullMatch[3]).padStart(2, '0')}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const monthDayMatch = text.match(/(\d{1,2})[月./-](\d{1,2})[日]?/);
  if (monthDayMatch) {
    const year = new Date().getFullYear();
    const date = new Date(`${year}-${String(monthDayMatch[1]).padStart(2, '0')}-${String(monthDayMatch[2]).padStart(2, '0')}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function resolveWeekdayDateKey(value = '', rangeStart, rangeEnd) {
  const text = String(value || '').trim();
  const weekdayMap = new Map([
    ['周一', 1], ['星期一', 1],
    ['周二', 2], ['星期二', 2],
    ['周三', 3], ['星期三', 3],
    ['周四', 4], ['星期四', 4],
    ['周五', 5], ['星期五', 5],
    ['周六', 6], ['星期六', 6],
    ['周日', 0], ['星期日', 0], ['星期天', 0],
  ]);
  const targetDay = weekdayMap.get(text);
  if (typeof targetDay !== 'number') return null;

  const cursor = new Date(rangeStart);
  while (cursor.getTime() <= rangeEnd.getTime()) {
    if (cursor.getDay() === targetDay) {
      return new Date(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function resolveDateFieldKey(key, rangeStart, rangeEnd) {
  return parseFlexibleDateKey(key) || resolveWeekdayDateKey(key, rangeStart, rangeEnd);
}

function formatDateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function describePunchRowKeys(rows = []) {
  return [...new Set(rows.flatMap((row) => Object.keys(row || {})))].slice(0, 30);
}

function looksLikeAggregatePunchSummary(rows = []) {
  const keys = new Set(describePunchRowKeys(rows));
  return keys.has('all_check_days') && (
    keys.has('keep_check_days')
    || keys.has('max_keep_check_days')
    || keys.has('wrong_times')
    || keys.has('all_url_time')
  );
}

function parseCheckinCell(value) {
  const text = String(value ?? '').replace(/\s+/g, '').trim();
  if (!text || text === '-' || text === '0' || text === '未打卡' || text === '未完成' || text === '否') {
    return { present: false, supplement: false };
  }
  if (text.includes('补')) {
    return { present: true, supplement: true };
  }
  if (text.includes('打卡') || text.includes('正常') || text.includes('已') || text === '√' || text === '1') {
    return { present: true, supplement: false };
  }
  return { present: false, supplement: false };
}

function summarizePunchRowsForRange(punchRows, rangeStart, rangeEnd) {
  const start = parseDateOnly(rangeStart);
  const end = parseDateOnly(rangeEnd);
  if (!start || !end || start.getTime() > end.getTime()) {
    throw new Error('每日打卡时间范围无效');
  }

  const rows = Array.isArray(punchRows) ? punchRows : [];
  if (rows.length === 0) {
    throw new Error('每日打卡数据为空');
  }

  const dateFields = [...new Set(rows.flatMap((row) => (
    Object.keys(row || {}).filter((key) => !!resolveDateFieldKey(key, start, end))
  )))].sort((a, b) => {
    const aDate = resolveDateFieldKey(a, start, end);
    const bDate = resolveDateFieldKey(b, start, end);
    return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
  });

  if (dateFields.length === 0) {
    const sampleKeys = describePunchRowKeys(rows);
    console.error('❌ 每日打卡日期列识别失败，样例字段:', sampleKeys);
    if (looksLikeAggregatePunchSummary(rows)) {
      throw new Error('教务系统当前只返回累计打卡数据，不返回按天明细，暂时无法自动抓取这一周的每日打卡');
    }
    throw new Error('每日打卡数据缺少日期列，无法按时间范围生成日报');
  }

  const rangedDateFields = dateFields.filter((key) => {
    const date = resolveDateFieldKey(key, start, end);
    return !!date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  });

  if (rangedDateFields.length === 0) {
    throw new Error('所选时间范围内没有可用的每日打卡数据');
  }

  return rows.map((row) => {
    const date_values = {};
    let total = 0;
    let supplement = 0;

    for (const key of rangedDateFields) {
      const date = resolveDateFieldKey(key, start, end);
      if (!date) continue;
      const value = row?.[key];
      const status = parseCheckinCell(value);
      date_values[formatDateOnly(date)] = status.present ? (status.supplement ? '补' : '√') : '';
      if (!status.present) continue;
      total += 1;
      if (status.supplement) supplement += 1;
    }

    return {
      no: String(row?.no || row?.student_no || row?.学号 || '').trim(),
      ch_name: String(row?.ch_name || row?.中文名 || row?.中文 || row?.姓名 || '').trim(),
      en_name: String(
        row?.en_name
        || row?.enName
        || row?.english_name
        || row?.英文名
        || row?.英文
        || row?.英文姓名
        || row?.EnglishName
        || row?.['English Name']
        || '',
      ).trim(),
      all_check_days: total,
      normal_record_total: Math.max(0, total - supplement),
      supplement_times: supplement,
      date_values,
      range_start: formatDateOnly(start),
      range_end: formatDateOnly(end),
    };
  });
}

function choosePreferredTerm(terms = [], preferredYear = '', preferredSemester = '') {
  const normalizedTerms = Array.isArray(terms) ? terms : [];
  const preferredYearText = String(preferredYear || '').trim();
  const preferredSemesterText = String(preferredSemester || '').trim();
  const pickByName = (matcher) => normalizedTerms.find((term) => matcher(String(term?.name || term?.term_name || '')));

  return (
    (preferredSemesterText && pickByName((name) => name.includes(preferredSemesterText)))
    || (preferredYearText && pickByName((name) => name.includes(`${preferredYearText}学年秋季学期`)))
    || (preferredYearText && pickByName((name) => name.includes(`${preferredYearText}学年春季学期`)))
    || normalizedTerms[0]
    || null
  );
}

// CNF's check-in export is a two-step "generate latest file, then download"
// flow. The generated filename is shared across teacher accounts, so exports
// from different teachers can overwrite each other as well. Serialize every
// complete export transaction in this process. Callers still validate the
// downloaded roster because another process or a direct CNF user can export at
// the same time.
let checkinExportQueue = Promise.resolve();

function enqueueCheckinExport(_scraper, task) {
  const current = checkinExportQueue.catch(() => {}).then(task);
  checkinExportQueue = current;
  return current.finally(() => {
    if (checkinExportQueue === current) checkinExportQueue = Promise.resolve();
  });
}

async function fetchCheckEveryDayTerms(scraper) {
  const response = await scraper.request('/admin/check_every_day/getTerms', {
    headers: { accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest' },
  });
  const data = await response.json().catch(() => ({}));
  if (Number(data?.code) !== 200 || !Array.isArray(data?.termData)) {
    throw new Error(String(data?.message || '获取每日打卡学期失败'));
  }
  return data.termData;
}

async function fetchCheckEveryDayTable(scraper, squadId, termId) {
  const params = new URLSearchParams({
    squad_id: String(squadId),
    squad_type: 'offline',
    term_id: String(termId),
    student_id: '',
  });
  const response = await scraper.request(`/admin/check_every_day/getTableData?${params.toString()}`, {
    headers: { accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest' },
  });
  const data = await response.json().catch(() => ({}));
  if (Number(data?.code) !== 200 || !Array.isArray(data?.returnData)) {
    throw new Error(String(data?.message || '获取每日打卡数据失败'));
  }
  return data.returnData;
}

async function fetchCheckinViaExportUnlocked(scraper, squadId, { rangeStart = '', rangeEnd = '', termId = '' } = {}) {
  const response = await scraper.fetchCheckinExport(squadId, {
    exportType: 2,
    dateRangeStart: rangeStart,
    dateRangeEnd: rangeEnd,
    termId,
  });
  const ct = response.headers.get('content-type') || '';

  if (response.status >= 400) {
    throw new Error(`exportCheckRecords 返回 HTTP ${response.status}`);
  }

  // The API returns JSON with a download URL, NOT the Excel directly
  if (ct.includes('json')) {
    const data = await response.json().catch(() => ({}));
    if (Number(data?.code) === 200 && data?.url) {
      // Download the actual Excel file
      console.log(`🔄 下载打卡导出 Excel: ${data.url}`);
      const xlUrl = new URL(data.url);
      const xlResponse = await scraper.session.request(xlUrl.pathname, {
        headers: { accept: '*/*' },
      });
      if (xlResponse.status >= 400) {
        throw new Error(`打卡 Excel 下载失败: HTTP ${xlResponse.status}`);
      }
      const buffer = Buffer.from(await xlResponse.arrayBuffer());
      let XLSX;
      try { XLSX = require('xlsx'); } catch { throw new Error('xlsx 模块未安装'); }
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('打卡导出 Excel 无工作表');
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rows.length === 0) throw new Error('打卡导出 Excel 无数据行');
      console.log(`✅ exportCheckRecords 解析成功: ${rows.length}行, 字段: ${Object.keys(rows[0]).slice(0, 10).join(', ')}`);
      return rows;
    }
    throw new Error(data?.message || data?.msg || 'exportCheckRecords 返回错误');
  }

  // Fallback: direct binary Excel response
  if (ct.includes('spreadsheet') || ct.includes('octet-stream') || ct.includes('excel')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    let XLSX;
    try { XLSX = require('xlsx'); } catch { throw new Error('xlsx 模块未安装'); }
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('打卡导出 Excel 无工作表');
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) throw new Error('打卡导出 Excel 无数据行');
    console.log(`✅ exportCheckRecords (direct) 解析成功: ${rows.length}行`);
    return rows;
  }

  throw new Error(`exportCheckRecords 返回意外类型: ${ct}`);
}

async function fetchCheckinViaExport(scraper, squadId, options = {}) {
  return enqueueCheckinExport(
    scraper,
    () => fetchCheckinViaExportUnlocked(scraper, squadId, options),
  );
}

function buildSummaryOnlyCheckinRows(punchRows, rangeStart, rangeEnd) {
  const rows = Array.isArray(punchRows) ? punchRows : [];
  if (rows.length === 0) throw new Error('打卡汇总数据为空');

  return rows.map((row) => {
    const total = parseInt(row?.all_check_days, 10) || 0;
    const supplement = parseInt(row?.supplement_times, 10) || 0;
    return {
      no: String(row?.no || row?.student_no || '').trim(),
      ch_name: String(row?.ch_name || '').trim(),
      all_check_days: total,
      normal_record_total: Math.max(0, total - supplement),
      supplement_times: supplement,
      date_values: {},
      range_start: rangeStart,
      range_end: rangeEnd,
      summaryOnly: true,
    };
  });
}

async function fetchCheckinRowsForRange(scraper, {
  classId,
  rangeStart,
  rangeEnd,
  preferredYear = '',
  preferredSemester = '',
}) {
  const { classCode, squadId } = await scraper.resolveSquadId(classId);

  // Strategy 1: exportCheckRecords (per-day Excel export) — retry once on transient failure
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const exportRows = await fetchCheckinViaExport(scraper, squadId, {
        rangeStart, rangeEnd,
      });
      const summarized = summarizePunchRowsForRange(exportRows, rangeStart, rangeEnd);
      console.log(`✅ 打卡数据通过 exportCheckRecords 获取成功: ${summarized.length}人 (attempt ${attempt})`);
      return {
        classCode: classCode || classId,
        squadId,
        termId: 'export',
        termName: 'exportCheckRecords',
        rows: summarized,
      };
    } catch (exportError) {
      if (attempt < 2) {
        console.warn(`⚠️ exportCheckRecords 第${attempt}次失败: ${exportError.message}，重试...`);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        console.warn(`⚠️ exportCheckRecords 最终失败: ${exportError.message}，降级到 getTableData 汇总模式...`);
      }
    }
  }

  // Strategy 2: getTableData — aggregate summary (no per-day breakdown)
  const terms = await fetchCheckEveryDayTerms(scraper);
  const selectedTerm = choosePreferredTerm(terms, preferredYear, preferredSemester);
  if (!selectedTerm?.id) {
    throw new Error('未找到可用的每日打卡学期');
  }

  const punchRows = await fetchCheckEveryDayTable(scraper, squadId, selectedTerm.id);

  // First try: see if the data has per-day date columns
  try {
    const summarized = summarizePunchRowsForRange(punchRows, rangeStart, rangeEnd);
    return {
      classCode: classCode || classId,
      squadId,
      termId: String(selectedTerm.id),
      termName: String(selectedTerm.name || selectedTerm.term_name || ''),
      rows: summarized,
    };
  } catch (detailError) {
    // If per-day parsing fails (aggregate only), use summary-only mode
    if (looksLikeAggregatePunchSummary(punchRows)) {
      console.warn(`⚠️ 打卡数据仅有学期汇总，降级为汇总模式（累计打卡天数+补卡次数，非本周明细）`);
      return {
        classCode: classCode || classId,
        squadId,
        termId: String(selectedTerm.id),
        termName: String(selectedTerm.name || selectedTerm.term_name || ''),
        rows: buildSummaryOnlyCheckinRows(punchRows, rangeStart, rangeEnd),
        summaryOnly: true,
      };
    }
    throw detailError;
  }
}

module.exports = {
  choosePreferredTerm,
  describePunchRowKeys,
  fetchCheckEveryDayTable,
  fetchCheckEveryDayTerms,
  fetchCheckinRowsForRange,
  fetchCheckinViaExport,
  enqueueCheckinExport,
  formatDateOnly,
  looksLikeAggregatePunchSummary,
  parseCheckinCell,
  parseDateOnly,
  parseFlexibleDateKey,
  resolveDateFieldKey,
  resolveWeekdayDateKey,
  summarizePunchRowsForRange,
};
