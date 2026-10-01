#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { evaluateAcceptance } = require('../../lib/dbShadow/acceptance');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function formatMarkdown(report) {
  const status = { pass: 'PASS', fail: 'FAIL', pending: 'PENDING' };
  const lines = [
    '# Super Amber 数据库替换验收状态',
    '',
    `- Technical ready: ${report.technicalReady ? 'yes' : 'no'}`,
    `- User approved: ${report.userApproved ? 'yes' : 'no'}`,
    `- Promotion allowed: ${report.promotionAllowed ? 'yes' : 'no'}`,
    `- Gates: ${report.counts.pass} pass / ${report.counts.fail} fail / ${report.counts.pending} pending`,
    '',
    '| 状态 | 分组 | 验收项 | 当前证据 | 目标 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const gate of report.gates) {
    lines.push(`| ${status[gate.status]} | ${gate.group} | ${gate.label} | ${gate.observed ?? '—'} | ${gate.target} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const evidencePath = option('--evidence');
  if (!evidencePath) throw new Error('请使用 --evidence <path> 提供验收证据 JSON');
  const evidence = JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'));
  const report = evaluateAcceptance(evidence);
  process.stdout.write(process.argv.includes('--json')
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatMarkdown(report));
  if (!report.promotionAllowed) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`验收失败：${error.message}\n`);
  process.exitCode = 1;
});
