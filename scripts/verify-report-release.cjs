const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = 'fc4f2da00dcc';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const protectedPaths = [
  'frontend/src/seating', 'frontend/public/amber',
  'frontend/src/components/MakeupTool.tsx', 'frontend/src/utils/makeupData.ts',
  'frontend/src/utils/makeupMessages.ts', 'frontend/src/utils/makeupStorage.ts',
  'frontend/src/services/seatingStorage.ts', 'frontend/src/services/seatingBackupApi.ts',
  'frontend/src/utils/appPersistence.ts', 'frontend/src/components/NewestSeatingFrame.tsx',
  'backend/routes/seatingBackupRoutes.js', 'backend/lib/seatingBackupStore.js',
  'frontend/src/components/ClassroomAgentApp.tsx', 'backend/routes/classroomAgentRoutes.js',
  'frontend/src/components/UsageInsightsApp.tsx', 'backend/lib/usageAnalytics.js',
  'frontend/src/components/TestScoreEntryApp.tsx',
];
assert.equal(git('diff', base, '--', ...protectedPaths), '', 'Protected production functionality changed');
const startup = fs.readFileSync(path.join(root, 'frontend/src/main.tsx'), 'utf8');
const oldStartup = git('show', base + ':frontend/src/main.tsx');
const migration = s => s.slice(s.indexOf('function migrateSeatingStorage'), s.indexOf('\nfunction ', s.indexOf('function migrateSeatingStorage') + 9) === -1 ? s.indexOf('\nasync function startApp') : s.indexOf('\nfunction ', s.indexOf('function migrateSeatingStorage') + 9)).trim();
assert.equal(migration(startup), migration(oldStartup), 'Startup storage migration changed');
const registry = fs.readFileSync(path.join(root, 'frontend/src/services/featureRegistry.ts'), 'utf8');
for (const feature of ['classroom-agent', 'test-score-entry', 'data-review', 'usage-insights', 'camp-report', 'camp-schedule']) {
  assert(registry.includes("'" + feature + "': { screen: '" + feature + "', audience: 'test-only'"));
}
console.log('PASS: production seating, makeup, storage migration and private feature boundaries preserved');
