const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { createCheckinWorkbookFromPunchRows, createStudentWorkbookFromTableRows } = require('../dailyReportWorkbook');

function runPython(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { env: process.env, ...options });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `python exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test('publicity table rows can be converted into a workbook consumable by both daily report scripts', async () => {
  const rows = [
    ['', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 AI语音[AI语音]', '', 'Lesson 1 词王[词王]', '', '', '', 'Lesson 1 小挑战[小挑战]'],
    ['', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 AI语音[AI语音]', '', 'Lesson 1 词王[词王]', '', '', '', 'Lesson 1 小挑战[小挑战]'],
    ['', '学号', '中文名', '英文名', '是否完成', '分数(15)', '是否完成', '平均分', '是否完成', '是否达到词王', 'PK次数', '词王平均正确率', '是否完成'],
    ['', '20240001', '张三', 'Amy', '已完成', 13, '已完成', '82%', '已完成', '是', 3, '88%', '已完成'],
    ['', '20240002', '李四', 'Ben', '未完成', 10, '已完成', '71%', '未完成', '否', 1, '65%', '未完成'],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J328_publicity.xlsx');
    const checkinPath = path.join(tempDir, 'checkin.xlsx');

    await createStudentWorkbookFromTableRows(rows, studentPath);
    await createCheckinWorkbookFromPunchRows([
      {
        no: '20240001',
        ch_name: '张三',
        all_check_days: 5,
        normal_record_total: 5,
        supplement_times: 0,
        date_values: {
          '2026-04-07': '√',
          '2026-04-08': '√',
          '2026-04-09': '√',
          '2026-04-10': '√',
          '2026-04-11': '√',
        },
      },
      {
        no: '20240002',
        ch_name: '李四',
        all_check_days: 3,
        normal_record_total: 2,
        supplement_times: 1,
        date_values: {
          '2026-04-07': '√',
          '2026-04-08': '补',
          '2026-04-09': '√',
        },
      },
    ], checkinPath);

    const inspect = await runPython(['-c', `
from openpyxl import load_workbook
import json
import sys
wb = load_workbook(sys.argv[1], data_only=True)
print(json.dumps({
  "sheets": wb.sheetnames,
  "base_b4": wb["数据底表"]["B4"].value,
  "stats_b2": wb["数据情况"]["B2"].value,
}))
`, studentPath]);
    const inspectData = JSON.parse(inspect.stdout.trim());
    assert.deepEqual(inspectData.sheets, ['数据底表', '概览', '数据情况']);
    assert.equal(String(inspectData.base_b4), '20240001');
    assert.equal(String(inspectData.stats_b2), '20240001');

    const checkinInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb['data']
print(json.dumps({
  "row3": [ws.cell(3, c).value for c in range(1, 9)],
  "headers": [ws.cell(1, c).value for c in range(1, 11)],
  "row2": [ws.cell(2, c).value for c in range(1, 11)],
  "row3": [ws.cell(3, c).value for c in range(1, 11)],
}, ensure_ascii=False))
`, checkinPath]);
    const checkinData = JSON.parse(checkinInspect.stdout.trim());
    assert.equal(checkinData.headers[0], '学号');
    assert.equal(checkinData.headers[2], '2026-04-07');
    assert.equal(checkinData.headers[7], '总计');
    assert.equal(Number(checkinData.row2[7]), 5);
    assert.equal(Number(checkinData.row3[8]), 2);
    assert.equal(Number(checkinData.row3[9]), 1);

    const standard = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report.py'),
      checkinPath,
      studentPath,
      'J328班',
    ], { cwd: tempDir });
    const detail = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report_detail.py'),
      checkinPath,
      studentPath,
      'J328班',
    ], { cwd: tempDir });
    const detailWithCustomPass = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report_detail.py'),
      checkinPath,
      studentPath,
      'J328班自定义',
      '--test-pass',
      '13.5',
    ], { cwd: tempDir });

    const standardPath = standard.stdout.trim().split('\n').filter(Boolean).at(-1);
    const detailPath = detail.stdout.trim().split('\n').filter(Boolean).at(-1);
    const detailCustomPath = detailWithCustomPass.stdout.trim().split('\n').filter(Boolean).at(-1);
    assert.ok(standardPath && standardPath.endsWith('.xlsx'));
    assert.ok(detailPath && detailPath.endsWith('.xlsx'));
    assert.ok(detailCustomPath && detailCustomPath.endsWith('.xlsx'));

    const detailInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb[wb.sheetnames[0]]
print(json.dumps({
  "legend": ws["A2"].value,
  "row3": [ws.cell(3, c).value for c in range(1, 9)],
  "row4": [ws.cell(4, c).value for c in range(1, 9)],
  "row5": [ws.cell(5, c).value for c in range(1, 9)],
}, ensure_ascii=False))
`, detailPath]);
    const detailData = JSON.parse(detailInspect.stdout.trim());
    assert.equal(detailData.legend, '👑 = 王冠达标     ✅ = 已完成     ⭕ = 未完成');
    assert.equal(detailData.row3[3], '待完成');
    assert.equal(detailData.row4[4], '✅ 13/15');
    assert.equal(detailData.row4[6], '👑 88.0%');
    assert.equal(detailData.row4[7], '✅');
    assert.equal(detailData.row5[4], '⭕');
    assert.equal(detailData.row5[6], '⭕');

    const detailFormulaInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=False)
ws = wb[wb.sheetnames[0]]
print(json.dumps({
  "row4_waiting": ws.cell(4, 4).value,
  "row5_waiting": ws.cell(5, 4).value,
}, ensure_ascii=False))
`, detailPath]);
    const detailFormulaData = JSON.parse(detailFormulaInspect.stdout.trim());
    assert.match(String(detailFormulaData.row4_waiting || ''), /^=COUNTIF\(/);
    assert.match(String(detailFormulaData.row5_waiting || ''), /^=COUNTIF\(/);

    const standardInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb[wb.sheetnames[0]]
qa = wb['质量分析']
print(json.dumps({
  "row3": [ws.cell(3, c).value for c in range(1, 9)],
  "qa_row1": [qa.cell(1, c).value for c in range(1, 10)],
  "qa_row2": [qa.cell(2, c).value for c in range(1, 10)],
}, ensure_ascii=False))
`, standardPath]);
    const standardData = JSON.parse(standardInspect.stdout.trim());
    assert.deepEqual(standardData.row3.slice(0, 4), ['中文名', '英文名', '打卡', '待完成']);
    assert.deepEqual(detailData.row3.slice(0, 4), ['中文名', '英文名', '打卡', '待完成']);

    const detailQaInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
qa = wb['质量分析']
print(json.dumps({
  "qa_row1": [qa.cell(1, c).value for c in range(1, 10)],
  "qa_row2": [qa.cell(2, c).value for c in range(1, 10)],
}, ensure_ascii=False))
`, detailPath]);
    const detailQaData = JSON.parse(detailQaInspect.stdout.trim());
    assert.deepEqual(detailQaData.qa_row1, standardData.qa_row1);
    assert.deepEqual(detailQaData.qa_row2, standardData.qa_row2);

    const detailCustomInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb[wb.sheetnames[0]]
print(json.dumps({
  "row4_font_color": ws["E4"].font.color.rgb if ws["E4"].font.color and ws["E4"].font.color.type == "rgb" else None,
  "row4_fill": ws["E4"].fill.fgColor.rgb if ws["E4"].fill.fgColor else None,
}, ensure_ascii=False))
`, detailCustomPath]);
    const detailCustomData = JSON.parse(detailCustomInspect.stdout.trim());
    assert.equal(detailCustomData.row4_font_color, '00D9822B');
    assert.equal(detailCustomData.row4_fill, '00FFF2E8');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('checkin workbook generation fails fast when date columns are missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const checkinPath = path.join(tempDir, 'bad-checkin.xlsx');
    await assert.rejects(
      createCheckinWorkbookFromPunchRows([
        { no: '20240001', ch_name: '张三', all_check_days: 5, supplement_times: 0 },
      ], checkinPath),
      /缺少日期列/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('publicity workbook keeps shifted task headers aligned for real CNF export shape', async () => {
  const rows = [
    ['序号', '学号', '中文', '英文', 'Week6', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['L4·Reading·U5L5知新[音频]', 'L4·Reading·U5L4 温故[测试]', 'L4·Vocabulary·U5L4 温故[主题表达积累]', 'L4·Vocabulary·U5L5 知新[主题表达积累]', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['是否完成', '播放进度', '播放次数', '播放时长', '是否完成', '分数(10)', '是否完成', '是否达到词王', 'pk次数', '词王平均正确率', '重复环节首次完成正确率', '重复环节平均正确率', '是否完成', '是否达到词王', 'pk次数', '词王平均正确率', '重复环节首次完成正确率', '重复环节平均正确率', '', '', '', ''],
    ['31682', '22302103', '武李泽颍', 'Alice', '进行中', '%', '', '', '未完成', '', '已完成', '是', '5', '84.4%', '85%', '80%', '进行中', '', '0', '', '', ''],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J342_publicity.xlsx');
    await createStudentWorkbookFromTableRows(rows, studentPath);

    const inspect = await runPython(['-c', `
from openpyxl import load_workbook
import json
import sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb["数据底表"]
print(json.dumps({
  "e2": ws["E2"].value,
  "e3": ws["E3"].value,
  "e4": ws["E4"].value,
  "i2": ws["I2"].value,
  "i3": ws["I3"].value,
  "k2": ws["K2"].value,
  "k3": ws["K3"].value,
  "q2": ws["Q2"].value,
  "q3": ws["Q3"].value
}, ensure_ascii=False))
`, studentPath]);
    const data = JSON.parse(inspect.stdout.trim());
    assert.equal(data.e2, 'L4·Reading·U5L5知新[音频]');
    assert.equal(data.e3, '是否完成');
    assert.equal(data.e4, '进行中');
    assert.equal(data.i2, 'L4·Reading·U5L4 温故[测试]');
    assert.equal(data.i3, '是否完成');
    assert.equal(data.k2, 'L4·Vocabulary·U5L4 温故[主题表达积累]');
    assert.equal(data.k3, '是否完成');
    assert.equal(data.q2, 'L4·Vocabulary·U5L5 知新[主题表达积累]');
    assert.equal(data.q3, '是否完成');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('senior detail report keeps repeated-stage accuracy visible for auto-publicity workbook shape', async () => {
  const rows = [
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 词王[主题表达积累]', '', '', '', '', ''],
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 词王[主题表达积累]', '', '', '', '', ''],
    ['', '学号', '中文名', '英文名', '是否完成', '是否达到词王', 'pk次数', '词王平均正确率', '【不是词王pk数据！！！重复环节首次完成正确率】', '【不是词王pk数据！！！重复环节平均正确率】'],
    ['', '20240001', '张三', 'Amy', '已完成', '是', 6, '88%', '61%', '58%'],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J999_publicity.xlsx');
    const checkinPath = path.join(tempDir, 'ignored-checkin.xlsx');

    await createStudentWorkbookFromTableRows(rows, studentPath);

    const detail = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report_detail.py'),
      checkinPath,
      studentPath,
      'J999班',
      '--no-checkin',
      '--word-acc',
      'repeated',
    ], { cwd: tempDir });

    const detailPath = detail.stdout.trim().split('\n').filter(Boolean).at(-1);
    assert.ok(detailPath && detailPath.endsWith('.xlsx'));

    const inspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
src = load_workbook(sys.argv[1], data_only=True)
out = load_workbook(sys.argv[2], data_only=True)
base = src["数据底表"]
main = out["完成公示"]
qa = out["质量分析"]
print(json.dumps({
  "src_row3": [base.cell(3, c).value for c in range(1, base.max_column + 1)],
  "src_row4": [base.cell(4, c).value for c in range(1, base.max_column + 1)],
  "main_row4": [main.cell(4, c).value for c in range(1, main.max_column + 1)],
  "qa_row3": [qa.cell(3, c).value for c in range(1, qa.max_column + 1)],
}, ensure_ascii=False))
`, studentPath, detailPath]);
    const data = JSON.parse(inspect.stdout.trim());

    assert.ok(data.src_row3.includes('【不是词王pk数据！！！重复环节首次完成正确率】'));
    assert.ok(data.src_row3.includes('【不是词王pk数据！！！重复环节平均正确率】'));
    assert.ok(data.src_row4.includes('61%'));
    assert.ok(data.src_row4.includes('58%'));
    assert.equal(data.main_row4[3], '👑 58.0%');
    assert.equal(data.qa_row3[2], 6);
    assert.equal(data.qa_row3[3], '58%');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('senior detail report keeps dynamic test total score from auto-publicity workbook shape', async () => {
  const rows = [
    ['序号', '学号', '中文名', '英文名', 'L4·Reading·U4L2温故[测试]', ''],
    ['序号', '学号', '中文名', '英文名', 'L4·Reading·U4L2温故[测试]', ''],
    ['', '学号', '中文名', '英文名', '是否完成', '分数(11)'],
    ['', '22300474', '周颢凌', 'Andy', '已完成', 10],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J328_publicity.xlsx');
    const checkinPath = path.join(tempDir, 'ignored-checkin.xlsx');

    await createStudentWorkbookFromTableRows(rows, studentPath);

    const detail = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report_detail.py'),
      checkinPath,
      studentPath,
      'J328班',
      '--no-checkin',
      '--word-acc',
      'repeated',
    ], { cwd: tempDir });

    const detailPath = detail.stdout.trim().split('\n').filter(Boolean).at(-1);
    assert.ok(detailPath && detailPath.endsWith('.xlsx'));

    const inspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=False)
main = wb["完成公示"]
qa = wb["质量分析"]
print(json.dumps({
  "main_row4": [main.cell(4, c).value for c in range(1, main.max_column + 1)],
  "qa_row3": [qa.cell(3, c).value for c in range(1, qa.max_column + 1)],
}, ensure_ascii=False))
`, detailPath]);
    const data = JSON.parse(inspect.stdout.trim());

    assert.equal(data.main_row4[3], '✅ 10/11');
    assert.equal(data.qa_row3[2], '10/11');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('standard report keeps header/value alignment for auto-publicity workbook shape', async () => {
  const rows = [
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 词王[主题表达积累]', '', '', '', '', ''],
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 词王[主题表达积累]', '', '', '', '', ''],
    ['', '学号', '中文名', '英文名', '是否完成', '分数(15)', '是否完成', '是否达到词王', 'pk次数', '词王平均正确率', '【不是词王pk数据！！！重复环节首次完成正确率】', '【不是词王pk数据！！！重复环节平均正确率】'],
    ['', '20240001', '张三', 'Amy', '已完成', 12, '已完成', '是', 6, '88%', '61%', '58%'],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J999_publicity.xlsx');
    const checkinPath = path.join(tempDir, 'checkin.xlsx');

    await createStudentWorkbookFromTableRows(rows, studentPath);
    await createCheckinWorkbookFromPunchRows([
      {
        no: '20240001',
        ch_name: '张三',
        all_check_days: 1,
        normal_record_total: 1,
        supplement_times: 0,
        date_values: {
          '2026-05-30': '√',
        },
      },
    ], checkinPath);

    const standard = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report.py'),
      checkinPath,
      studentPath,
      'J999班',
      '--no-checkin',
    ], { cwd: tempDir });

    const standardPath = standard.stdout.trim().split('\n').filter(Boolean).at(-1);
    assert.ok(standardPath && standardPath.endsWith('.xlsx'));

    const inspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
main = wb["完成公示"]
print(json.dumps({
  "row3": [main.cell(3, c).value for c in range(1, main.max_column + 1)],
  "row4": [main.cell(4, c).value for c in range(1, main.max_column + 1)],
}, ensure_ascii=False))
`, standardPath]);
    const data = JSON.parse(inspect.stdout.trim());

    assert.deepEqual(data.row3, ['中文名', '英文名', '待完成', 'Lesson 1 测试', 'Lesson 1 词王']);
    assert.deepEqual(data.row4, ['张三', 'Amy', 0, '✅', '👑']);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('quality analysis recognizes lowercase pk headers and applies custom test pass line in both report variants', async () => {
  const rows = [
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 AI语音[AI语音]', '', 'Lesson 1 词王[主题表达积累]', '', '', ''],
    ['序号', '学号', '中文名', '英文名', 'Lesson 1 测试[测试]', '', 'Lesson 1 AI语音[AI语音]', '', 'Lesson 1 词王[主题表达积累]', '', '', ''],
    ['', '学号', '中文名', '英文名', '是否完成', '分数(15)', '是否完成', '平均分', '是否完成', '是否达到词王', 'pk次数', '词王平均正确率'],
    ['', '20240001', '张三', 'Amy', '已完成', 12.5, '已完成', '72%', '已完成', '否', 16, '58%'],
  ];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-report-workbook-test-'));
  try {
    const studentPath = path.join(tempDir, 'J328_publicity.xlsx');
    const checkinPath = path.join(tempDir, 'checkin.xlsx');

    await createStudentWorkbookFromTableRows(rows, studentPath);
    await createCheckinWorkbookFromPunchRows([
      {
        no: '20240001',
        ch_name: '张三',
        all_check_days: 1,
        normal_record_total: 1,
        supplement_times: 0,
        date_values: {
          '2026-04-07': '√',
        },
      },
    ], checkinPath);

    const standard = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report.py'),
      checkinPath,
      studentPath,
      'J328班',
      '--test-pass',
      '13.5',
    ], { cwd: tempDir });
    const detail = await runPython([
      path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts/class_daily_report_detail.py'),
      checkinPath,
      studentPath,
      'J328班',
      '--test-pass',
      '13.5',
    ], { cwd: tempDir });

    const standardPath = standard.stdout.trim().split('\n').filter(Boolean).at(-1);
    const detailPath = detail.stdout.trim().split('\n').filter(Boolean).at(-1);

    const standardInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb['质量分析']
print(json.dumps({
  "headers1": [ws.cell(1, c).value for c in range(1, ws.max_column + 1)],
  "headers2": [ws.cell(2, c).value for c in range(1, ws.max_column + 1)],
  "row3": [ws.cell(3, c).value for c in range(1, ws.max_column + 1)],
}, ensure_ascii=False))
`, standardPath]);
    const standardData = JSON.parse(standardInspect.stdout.trim());
    assert.ok(standardData.row3.includes(16));
    const standardDiag = String(standardData.row3.at(-1) || '');
    assert.match(standardDiag, /(?:刷了16次PK但正确率仅58%|PK16次正确率58%)/);
    assert.match(standardDiag, /得分12.5\/15，未达最低要求（13.5分）/);
    assert.match(standardDiag, /打卡仅1天/);

    const detailInspect = await runPython(['-c', `
from openpyxl import load_workbook
import json, sys
wb = load_workbook(sys.argv[1], data_only=True)
ws = wb['质量分析']
print(json.dumps({
  "row3": [ws.cell(3, c).value for c in range(1, ws.max_column + 1)],
  "rows": [[ws.cell(r, c).value for c in range(1, ws.max_column + 1)] for r in range(1, ws.max_row + 1)],
}, ensure_ascii=False))
`, detailPath]);
    const detailData = JSON.parse(detailInspect.stdout.trim());
    assert.ok(detailData.row3.includes(16));
    const detailDiag = String(detailData.row3.at(-1) || '');
    assert.match(detailDiag, /(?:刷了16次PK但正确率仅58%|PK16次正确率58%)/);
    assert.ok(detailData.rows.some((row) => row.includes('重点问题学生详细诊断')));
    assert.ok(
      detailData.rows.some((row) => row.some((cell) => /[ABCD]类（1人）/.test(String(cell || ''))))
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
