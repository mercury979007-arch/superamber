#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');

function readOption(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
  return parsed;
}

function main() {
  const snapshotPath = path.resolve(readOption('--snapshot', ''));
  const accounts = positiveInteger(readOption('--accounts', 170), '--accounts');
  const classesPerAccount = positiveInteger(readOption('--classes-per-account', 7), '--classes-per-account');
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    throw new Error('请使用 --snapshot 指定现有 compact 快照');
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  if (snapshot.storageFormat !== 'normalized-v1') {
    throw new Error('容量测试只接受 normalized-v1 快照');
  }
  const sampleClasses = new Set(snapshot.catalog.students.map((row) => row.squadId)).size;
  if (sampleClasses !== classesPerAccount) {
    throw new Error(`快照包含 ${sampleClasses} 个班，与 --classes-per-account=${classesPerAccount} 不一致`);
  }

  global.gc?.();
  const before = process.memoryUsage();
  const startedAt = performance.now();
  const payloads = Array.from({ length: accounts }, () => JSON.stringify(snapshot));
  const serializeMs = performance.now() - startedAt;
  global.gc?.();
  const after = process.memoryUsage();
  const onePayload = Buffer.byteLength(payloads[0]);
  const oneGzip = zlib.gzipSync(payloads[0], { level: 6 }).byteLength;

  process.stdout.write(`${JSON.stringify({
    mode: 'synthetic-response-capacity',
    accounts,
    classesPerAccount,
    totalClassViews: accounts * classesPerAccount,
    sample: {
      students: snapshot.catalog.students.length,
      expandedRows: snapshot.summary.assignmentRows,
      compactBytes: onePayload,
      gzipBytes: oneGzip,
    },
    projected: {
      expandedRows: snapshot.summary.assignmentRows * accounts,
      compactBytes: onePayload * accounts,
      gzipBytes: oneGzip * accounts,
    },
    simultaneousSerialization: {
      serializeMs: Math.round(serializeMs * 10) / 10,
      rssDeltaBytes: after.rss - before.rss,
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssBytes: after.rss,
      heapUsedBytes: after.heapUsed,
    },
    note: '本测试模拟 170 份响应同时序列化并驻留；不发起数据库查询或真实账号登录。',
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`容量测试失败：${error.message}\n`);
  process.exitCode = 1;
}
