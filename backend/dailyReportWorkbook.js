const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function normalizeTableRows(tableRows) {
  if (!Array.isArray(tableRows) || tableRows.length < 4) {
    throw new Error('学生完成数据表为空或行数不足');
  }

  const width = tableRows.reduce((max, row) => (
    Array.isArray(row) ? Math.max(max, row.length) : max
  ), 0);

  if (width < 4) {
    throw new Error('学生完成数据表列数不足');
  }

  const normalized = tableRows.map((row) => {
    const cells = Array.isArray(row) ? [...row] : [];
    while (cells.length < width) cells.push('');
    return cells;
  });

  const headerRow = normalized[0] || [];
  const hasLeadingStudentColumns = (
    String(headerRow[0] || '').trim().includes('序号')
    && String(headerRow[1] || '').trim().includes('学号')
    && String(headerRow[2] || '').trim().includes('中文')
    && String(headerRow[3] || '').trim().includes('英文')
  );

  if (hasLeadingStudentColumns) {
    for (const rowIndex of [1, 2]) {
      const row = normalized[rowIndex];
      if (!row) continue;
      const firstCell = String(row[0] || '').trim();
      if (!firstCell || firstCell.includes('序号') || firstCell.includes('学号')) continue;

      // 教务公示表的第 2/3 行有时会把任务表头左移 4 列，导致日报脚本识别不到模块。
      normalized[rowIndex] = [...Array(4).fill(''), ...row].slice(0, width);
    }

    const titleRow = normalized[1] || [];
    const metricRow = normalized[2] || [];
    const completeColumns = metricRow
      .map((cell, index) => (String(cell || '').trim() === '是否完成' ? index : -1))
      .filter((index) => index >= 0);
    const taskTitles = titleRow.map((cell) => String(cell || '').trim()).filter(Boolean);

    if (taskTitles.length > 0 && completeColumns.length >= taskTitles.length) {
      const expandedTitleRow = Array(width).fill('');
      for (let index = 0; index < taskTitles.length; index += 1) {
        expandedTitleRow[completeColumns[index]] = taskTitles[index];
      }
      normalized[1] = expandedTitleRow;
    }
  }

  return normalized;
}

async function createStudentWorkbookFromTableRows(tableRows, targetPath) {
  const normalizedRows = normalizeTableRows(tableRows);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-'));
  const jsonPath = path.join(tempDir, 'tableRows.json');

  try {
    await fs.writeFile(jsonPath, JSON.stringify(normalizedRows), 'utf8');

    const script = `
import json
import sys
from openpyxl import Workbook

json_path = sys.argv[1]
target = sys.argv[2]

with open(json_path, 'r', encoding='utf-8') as f:
    rows = json.load(f)

if not isinstance(rows, list) or len(rows) < 4:
    raise RuntimeError('学生完成数据表为空或行数不足')

wb = Workbook()
ws_base = wb.active
ws_base.title = '数据底表'

for row in rows:
    ws_base.append(row)

ws_overview = wb.create_sheet('概览')
ws_overview.append(['指标', '值'])
student_rows = [row for row in rows[3:] if len(row) >= 4 and str(row[1]).strip() and str(row[1]).strip() != '学号']
ws_overview.append(['学生数', len(student_rows)])
ws_overview.append(['任务列数', max(0, len(rows[0]) - 4)])

ws_stats = wb.create_sheet('数据情况')
ws_stats.append(['序号', '学号', '中文名', '英文名', '视频进度', '词汇进度'])

for idx, row in enumerate(student_rows, start=1):
    sid = str(row[1]).strip()
    cn = str(row[2]).strip() if len(row) > 2 and row[2] is not None else ''
    en = str(row[3]).strip() if len(row) > 3 and row[3] is not None else ''
    ws_stats.append([idx, sid, cn, en, None, None])

wb.save(target)
`;

    await new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', script, jsonPath, targetPath], { env: process.env });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || '学生数据工作簿生成失败'));
          return;
        }
        resolve();
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createCheckinWorkbookFromPunchRows(punchRows, targetPath, options = {}) {
  const rows = Array.isArray(punchRows) ? punchRows : [];
  const dateColumns = new Set();
  const allowSummaryOnly = options?.allowSummaryOnly === true;
  const summaryDateHeaders = Array.isArray(options?.summaryDateHeaders) && options.summaryDateHeaders.length > 0
    ? options.summaryDateHeaders.map((item) => String(item || '').trim()).filter(Boolean)
    : ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const normalizedRows = rows.map((row) => {
    const no = String(row?.no || row?.student_no || row?.学号 || '').trim();
    const ch_name = String(row?.ch_name || row?.姓名 || row?.中文名 || '').trim();
    const total = Number(row?.all_check_days);
    const supplement = Number(row?.supplement_times);
    const normal = Number(row?.normal_record_total);
    const date_values = {};

    if (row?.date_values && typeof row.date_values === 'object') {
      for (const [key, value] of Object.entries(row.date_values)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) continue;
        dateColumns.add(String(key));
        date_values[String(key)] = String(value || '').trim();
      }
    }

    return {
      no,
      ch_name,
      all_check_days: Number.isFinite(total) ? total : 0,
      supplement_times: Number.isFinite(supplement) ? supplement : 0,
      normal_record_total: Number.isFinite(normal) ? normal : null,
      date_values,
    };
  }).filter((row) => row.no);

  if (normalizedRows.length === 0) {
    throw new Error('每日打卡数据为空，无法生成日报');
  }

  let sortedDateColumns = [...dateColumns].sort((a, b) => a.localeCompare(b));
  if (sortedDateColumns.length === 0 && allowSummaryOnly) {
    sortedDateColumns = [...summaryDateHeaders];
  }
  if (sortedDateColumns.length === 0) {
    throw new Error('每日打卡数据缺少日期列，无法生成日报');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-checkin-'));
  const jsonPath = path.join(tempDir, 'punchRows.json');

  try {
    await fs.writeFile(jsonPath, JSON.stringify({
      dateColumns: sortedDateColumns,
      rows: normalizedRows,
    }), 'utf8');

    const script = `
import json
import sys
from openpyxl import Workbook

json_path = sys.argv[1]
target = sys.argv[2]

with open(json_path, 'r', encoding='utf-8') as f:
    payload = json.load(f)

date_columns = payload.get('dateColumns') or []
rows = payload.get('rows') or []

wb = Workbook()
ws = wb.active
ws.title = 'data'
headers = ['学号', '姓名', *date_columns, '总计', '正常记录总计', '补卡记录总计']
ws.append(headers)

for row in rows:
    total = int(row.get('all_check_days') or 0)
    supplement = int(row.get('supplement_times') or 0)
    normal = row.get('normal_record_total')
    normal = int(normal if normal is not None else max(0, total - supplement))
    date_values = row.get('date_values') or {}
    ws.append([
        row.get('no') or '',
        row.get('ch_name') or '',
        *[date_values.get(column, '') for column in date_columns],
        total,
        normal,
        supplement,
    ])

wb.save(target)
`;

    await new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', script, jsonPath, targetPath], { env: process.env });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || '打卡工作簿生成失败'));
          return;
        }
        resolve();
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  createCheckinWorkbookFromPunchRows,
  createStudentWorkbookFromTableRows,
  normalizeTableRows,
};
