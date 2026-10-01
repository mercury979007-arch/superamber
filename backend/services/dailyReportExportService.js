const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function decodeBase64File(payload, label) {
  const name = String(payload?.name || '').trim();
  const content = String(payload?.content || '').trim();
  if (!name || !content) {
    throw new Error(`${label}文件缺失`);
  }
  return {
    name,
    buffer: Buffer.from(content, 'base64'),
  };
}

function inferClassNameFromFilename(filename) {
  const match = String(filename || '').match(/([A-Za-z]\d{3,})/);
  return match ? `${match[1].toUpperCase()}班` : '';
}

function normalizeReportMode(reportMode) {
  return reportMode === 'detail' || reportMode === 'senior' ? reportMode : 'standard';
}

function buildDailyReportExportPlan({
  reportMode = 'standard',
  className = '',
  minCheckinDays,
  detailTestPassScore,
  checkinFile,
  checkinWorkbookBuilder,
  reportScriptDir,
  tempDir,
}) {
  const normalizedMode = normalizeReportMode(reportMode);
  const studentPath = path.join(tempDir, 'student-publicity.xlsx');
  const checkinPath = path.join(tempDir, String(checkinFile?.name || 'optional-checkin.xlsx'));
  const scriptPath = normalizedMode === 'detail' || normalizedMode === 'senior'
    ? path.resolve(reportScriptDir, 'class_daily_report_detail.py')
    : path.resolve(reportScriptDir, 'class_daily_report.py');

  const hasCheckinFile = Boolean(checkinFile?.name && checkinFile?.content);
  const hasCheckinBuilder = typeof checkinWorkbookBuilder === 'function';
  const trimmedClassName = String(className || '').trim();
  const args = [checkinPath, studentPath];

  if (trimmedClassName) {
    args.push(trimmedClassName);
  }
  if (!hasCheckinFile && !hasCheckinBuilder) {
    args.push('--no-checkin');
  }

  const parsedMinCheckin = parseInt(minCheckinDays, 10);
  if (!Number.isNaN(parsedMinCheckin) && parsedMinCheckin >= 0) {
    args.push('--min-checkin', String(parsedMinCheckin));
  }

  const parsedDetailTestPassScore = Number.parseFloat(detailTestPassScore);
  if (Number.isFinite(parsedDetailTestPassScore) && parsedDetailTestPassScore >= 0) {
    args.push('--test-pass', String(parsedDetailTestPassScore));
  }
  if (normalizedMode === 'senior') {
    args.push('--word-acc', 'repeated');
  }

  return {
    normalizedMode,
    studentPath,
    checkinPath,
    scriptPath,
    args,
    trimmedClassName,
    hasCheckinFile,
    hasCheckinBuilder,
  };
}

function createEmptyCheckinWorkbook(filePath) {
  return new Promise((resolve, reject) => {
    const script = `
import sys
from openpyxl import Workbook

target = sys.argv[1]
wb = Workbook()
ws = wb.active
ws.title = "data"
headers = ["学号", "姓名", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "备注", "总打卡", "正常打卡", "补卡"]
ws.append(headers)
wb.save(target)
`;

    const child = spawn('python3', ['-c', script, filePath], { env: process.env });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || '空白打卡表创建失败'));
        return;
      }
      resolve();
    });
  });
}

function cleanupNoCheckinWorkbook(workbookPath, reportMode) {
  return new Promise((resolve, reject) => {
    const script = `
import sys
from openpyxl import load_workbook

path = sys.argv[1]
mode = sys.argv[2]
wb = load_workbook(path)

if mode == "detail" or mode == "senior":
    ws = wb[wb.sheetnames[0]]
    target_col = None
    for col in range(1, ws.max_column + 1):
        value = ws.cell(3, col).value
        if str(value).strip() == "打卡":
            target_col = col
            break
    if target_col:
        ws.delete_cols(target_col, 1)
else:
    ws_analysis = wb["质量分析"]
    header_row = 1
    target_col = None
    for col in range(1, ws_analysis.max_column + 1):
        value = ws_analysis.cell(header_row, col).value
        if str(value).strip() == "打卡":
            target_col = col
            break
    if target_col:
        ws_analysis.delete_cols(target_col, 1)

for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "打卡" in cell.value:
                cell.value = cell.value.replace("质量/打卡", "质量")

wb.save(path)
`;

    const child = spawn('python3', ['-c', script, workbookPath, reportMode], { env: process.env });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || '清理打卡列失败'));
        return;
      }
      resolve();
    });
  });
}

function runPythonReport(scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath, ...args], { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('日报生成超时，请稍后再试'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `日报生成失败（退出码 ${code}）`));
        return;
      }

      const outputPath = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);

      if (!outputPath) {
        reject(new Error('日报生成失败，未拿到输出文件'));
        return;
      }

      resolve(outputPath);
    });
  });
}

function createDailyReportExportService({
  buildUsageEvent,
  appendUsageEvent,
  usageLogPath,
  reportScriptDir,
}) {
  return {
    decodeBase64File,
    inferClassNameFromFilename,
    async buildAndSendDailyReport({
      req,
      res,
      session,
      className = '',
      reportMode = 'standard',
      minCheckinDays,
      detailTestPassScore,
      studentWorkbookBuilder,
      checkinFile,
      checkinWorkbookBuilder,
      usageDetail = '',
    }) {
      let tempDir = '';

      try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'class-daily-report-'));
        const plan = buildDailyReportExportPlan({
          reportMode,
          className,
          minCheckinDays,
          detailTestPassScore,
          checkinFile,
          checkinWorkbookBuilder,
          reportScriptDir,
          tempDir,
        });

        const buildStart = Date.now();
        console.log(`🔄 日报生成开始: ${className} mode=${reportMode}`);
        await studentWorkbookBuilder(plan.studentPath);
        console.log(`  ✅ 学生数据工作簿生成完成 (${Date.now() - buildStart}ms)`);

        if (plan.hasCheckinFile) {
          const checkin = decodeBase64File(checkinFile, '打卡情况');
          await fs.writeFile(plan.checkinPath, checkin.buffer);
        } else if (plan.hasCheckinBuilder) {
          await checkinWorkbookBuilder(plan.checkinPath);
        } else {
          await createEmptyCheckinWorkbook(plan.checkinPath);
        }

        console.log(`  🔄 开始运行 Python 日报脚本: ${path.basename(plan.scriptPath)}`);
        const pyStart = Date.now();
        const outputPath = await runPythonReport(plan.scriptPath, plan.args, tempDir);
        console.log(`  ✅ Python 脚本完成 (${Date.now() - pyStart}ms), output: ${path.basename(outputPath)}`);
        if (!plan.hasCheckinFile && !plan.hasCheckinBuilder) {
          await cleanupNoCheckinWorkbook(outputPath, plan.normalizedMode);
        }
        const fileBuffer = await fs.readFile(outputPath);
        const downloadName = path.basename(outputPath);

        await appendUsageEvent(usageLogPath, buildUsageEvent(req, session, {
          event: 'report_exported',
          module: 'daily-report',
          className: plan.trimmedClassName,
          detail: usageDetail || plan.normalizedMode,
        }));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
        res.send(fileBuffer);
      } finally {
        if (tempDir) {
          fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  };
}

module.exports = {
  createDailyReportExportService,
  decodeBase64File,
  inferClassNameFromFilename,
  buildDailyReportExportPlan,
  normalizeReportMode,
};
