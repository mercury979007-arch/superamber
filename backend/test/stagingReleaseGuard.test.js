const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyCandidate } = require('../../scripts/verify-staging-release.cjs');

const source = path.resolve(__dirname, '../..');
const manifest = require('../../config/staging-release-capabilities.json');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of new Set(['config/staging-release-capabilities.json', ...manifest.capabilities.map(item => item.file)])) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(root, file));
  }
  return root;
}

test('accepted staging inventory survives a candidate release', t => {
  assert.equal(verifyCandidate(fixture(t), manifest), manifest.capabilities.length);
});

test('a production-based release cannot silently restore the old seat capacity', t => {
  const root = fixture(t);
  const file = path.join(root, 'frontend/src/seating/state.ts');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('MAX_STUDENT_LIMIT = 45', 'MAX_STUDENT_LIMIT = 40'));
  assert.throws(() => verifyCandidate(root, manifest), /seating-45/);
});

test('a release cannot omit the previously deployed weekly display', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'config/staging-release-capabilities.json'), JSON.stringify({
    ...manifest, capabilities: manifest.capabilities.filter(item => item.id !== 'speaking-week-words'),
  }));
  assert.throws(() => verifyCandidate(root, manifest), /capability removed: speaking-week-words/);
});

test('restoring an automatic MP resend fallback blocks release', t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, 'backend/scraper/scraper.js'), '\nconst sendAttempts = [];\n');
  assert.throws(() => verifyCandidate(root, manifest), /forbidden regression/);
});

test('a later release cannot drop bounded authorization or disconnect its route',t=>{
  const root=fixture(t);
  const file=path.join(root,'config/staging-release-capabilities.json');
  fs.writeFileSync(file,JSON.stringify({...manifest,capabilities:manifest.capabilities.filter(item=>item.id!=='agent-bounded-permission-reads')}));
  assert.throws(()=>verifyCandidate(root,manifest),/capability removed: agent-bounded-permission-reads/);
  fs.writeFileSync(file,JSON.stringify(manifest));
  const router=path.join(root,'backend/routes/classroomAgentRoutes.js');
  fs.writeFileSync(router,fs.readFileSync(router,'utf8').replace('await freshAgentPermissions(granted.session.scraper)','await granted.session.scraper.getClassMap(true)'));
  assert.throws(()=>verifyCandidate(root,manifest),/agent-fresh-permission-exchange/);
});
