import fs from 'node:fs';
import path from 'node:path';

const excluded = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache']);
const forbiddenExtensions = new Set(['.numbers', '.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.jsonl', '.pem', '.p12', '.pfx', '.key']);
const forbiddenDomains = /(?:cnfadmin\.cnfschool\.net|superamber(?:-test)?\.jiujianian\.dev|jiujianian-dev-world\.win)/i;
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    const rel = path.relative(process.cwd(), file);
    const ext = path.extname(file).toLowerCase();
    if (forbiddenExtensions.has(ext)) failures.push(`${rel}: private file type`);
    if (/^\.env(?:\.|$)/.test(entry.name)) failures.push(`${rel}: environment file`);
    if (/^frontend\/public\/[a-f0-9]{32}\.txt$/i.test(rel)) failures.push(`${rel}: verification file`);
    if (!/\.(?:js|mjs|cjs|ts|tsx|json|md|sh|py|html|css|example)$/i.test(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (forbiddenDomains.test(text)) failures.push(`${rel}: live service host`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push(`${rel}: private key`);
    if (/gh[psuor]_[A-Za-z0-9]{20,}/.test(text)) failures.push(`${rel}: GitHub token`);
    if (/\b1[3-9]\d{9}\b/.test(text)) failures.push(`${rel}: possible phone number`);
  }
}

walk(process.cwd());
const metadata = JSON.parse(fs.readFileSync('frontend/src/data/defaultClassScheduleMeta.json', 'utf8'));
if (Object.keys(metadata).length) failures.push('defaultClassScheduleMeta.json must be empty');
const manifest = JSON.parse(fs.readFileSync('frontend/public/amber/4.13/manifest.json', 'utf8'));
if (Object.keys(manifest.stages || {}).length) failures.push('bundled schedule manifest must be empty');
if (failures.length) {
  console.error(`Public release check failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Public release check passed. Run a full Git history secret scan before publishing.');
}
