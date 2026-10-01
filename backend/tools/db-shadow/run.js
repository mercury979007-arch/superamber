#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadShadowDbConfig } = require('../../lib/dbShadow/config');
const { compactSnapshot } = require('../../lib/dbShadow/compact');
const { createShadowRuntime } = require('../../lib/dbShadow/pipeline');
const { reconcileRows } = require('../../lib/dbShadow/reconcile');
const { normalizeTeacherFilterPayload } = require('../../lib/dbShadow/teacherReference');

function usage() {
  return `
Super Amber 双库影子读取（不会写库，也不会启动网站）

用法：
  npm run shadow:db -- --task-id 18414 --squad-id 710 --allow-insecure-db
  npm run shadow:db -- --from 2026-08-31 --to-exclusive 2026-09-07 --squad-id 947 --allow-insecure-db

选项：
  --task-id <id>             可重复
  --squad-id <id>            可重复
  --from <YYYY-MM-DD>
  --to-exclusive <YYYY-MM-DD>
  --output <path>            保存完整 JSON；默认只在终端输出摘要
  --output-format <type>     expanded（默认）或 compact
  --reference <path>         与标准化班主任端 JSON 对账
  --reference-format <type>  normalized（默认）或 teacher-filter
  --repeat <n>               同一连接池重复读取，用于冷/热性能测量
  --bypass-cache             每次都读取数据库，用于原始链路基准
  --allow-insecure-db        当前 RDS 未启用 TLS 时的显式只读验收开关
  --print-rows               将完整学生行输出到终端（默认关闭，避免泄露）
`;
}

function parseArgs(argv) {
  const options = {
    taskIds: [],
    squadIds: [],
    printRows: false,
    allowInsecure: false,
    referenceFormat: 'normalized',
    outputFormat: 'expanded',
    repeat: 1,
    bypassCache: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (!argv[index]) throw new Error(`${arg} 缺少值`);
      return argv[index];
    };
    if (arg === '--task-id') options.taskIds.push(Number(next()));
    else if (arg === '--squad-id') options.squadIds.push(Number(next()));
    else if (arg === '--from') options.from = next();
    else if (arg === '--to-exclusive') options.toExclusive = next();
    else if (arg === '--output') options.output = next();
    else if (arg === '--output-format') options.outputFormat = next();
    else if (arg === '--reference') options.reference = next();
    else if (arg === '--reference-format') options.referenceFormat = next();
    else if (arg === '--repeat') options.repeat = Math.max(1, Math.min(20, Number(next()) || 1));
    else if (arg === '--bypass-cache') options.bypassCache = true;
    else if (arg === '--allow-insecure-db') options.allowInsecure = true;
    else if (arg === '--print-rows') options.printRows = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!['expanded', 'compact'].includes(options.outputFormat)) {
    throw new Error('--output-format 只支持 expanded 或 compact');
  }

  const filters = {
    taskIds: options.taskIds,
    squadIds: options.squadIds,
    ...(options.from ? { from: options.from } : {}),
    ...(options.toExclusive ? { toExclusive: options.toExclusive } : {}),
  };
  const config = await loadShadowDbConfig({ allowInsecure: options.allowInsecure });
  const runtime = createShadowRuntime(config);
  const runs = [];
  try {
    for (let index = 0; index < options.repeat; index += 1) {
      runs.push(await runtime.run(filters, { bypassCache: options.bypassCache }));
    }
  } finally {
    await runtime.close();
  }
  const snapshot = runs.at(-1);
  snapshot.benchmark = {
    runs: runs.map((run, index) => ({ index: index + 1, ...run.timings, ...run.delivery })),
  };

  if (options.reference) {
    const reference = JSON.parse(await fs.readFile(options.reference, 'utf8'));
    const normalized = options.referenceFormat === 'teacher-filter'
      ? normalizeTeacherFilterPayload(reference, snapshot.rows)
      : reference;
    snapshot.reconciliation = reconcileRows(
      snapshot.rows.filter((row) => row.supported && row.result),
      normalized,
    );
    if (normalized.identity) snapshot.reconciliation.identity = normalized.identity;
  }
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const outputSnapshot = options.outputFormat === 'compact' ? compactSnapshot(snapshot) : snapshot;
    await fs.writeFile(outputPath, `${JSON.stringify(outputSnapshot, null, 2)}\n`, { mode: 0o600 });
  }

  const terminalOutput = {
    mode: snapshot.mode,
    generatedAt: snapshot.generatedAt,
    filters: snapshot.filters,
    timings: snapshot.timings,
    delivery: snapshot.delivery,
    benchmark: snapshot.benchmark,
    summary: snapshot.summary,
    sources: config.diagnostics,
    ...(snapshot.reconciliation ? {
      reconciliation: {
        ...snapshot.reconciliation,
        differences: options.printRows ? snapshot.reconciliation.differences : undefined,
      },
    } : {}),
    ...(options.output ? { output: path.resolve(options.output) } : {}),
    ...(options.printRows ? { rows: snapshot.rows, attendance: snapshot.attendance } : {}),
  };
  process.stdout.write(`${JSON.stringify(terminalOutput, null, 2)}\n`);
  if (snapshot.reconciliation && !snapshot.reconciliation.passed) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`影子读取失败：${error.message}\n`);
  process.exitCode = 1;
});
