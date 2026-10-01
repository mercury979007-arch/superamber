const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// This inventory supplements business tests: it prevents a production-based
// partial release from silently removing already accepted staging capabilities.
function verifyCandidate(root, previousManifest = null) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config/staging-release-capabilities.json'), 'utf8'));
  const current = new Map(manifest.capabilities.map(item => [item.id, item]));
  for (const previous of previousManifest?.capabilities || []) {
    if (!current.has(previous.id)) throw new Error(`Staging capability removed: ${previous.id}`);
  }
  for (const item of manifest.capabilities) {
    const source = fs.readFileSync(path.join(root, item.file), 'utf8');
    for (const text of item.contains || []) {
      if (!source.includes(text)) throw new Error(`${item.id}: missing ${text}`);
    }
    for (const text of item.excludes || []) {
      if (source.includes(text)) throw new Error(`${item.id}: forbidden regression ${text}`);
    }
  }
  return manifest.capabilities.length;
}

function verifyProductionAncestor(root, commit, productionRoot) {
  const production = JSON.parse(fs.readFileSync(path.join(productionRoot, 'deploy-meta.json'), 'utf8'));
  execFileSync('git', ['merge-base', '--is-ancestor', production.commit, commit], { cwd: root, stdio: 'pipe' });
  return production.commit;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const commit = process.argv[2] || 'HEAD';
    const staging = process.env.SUPERAMBER_STAGING_DIR || '/srv/superamber/staging';
    const previousPath = path.join(staging, 'config/staging-release-capabilities.json');
    const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : null;
    const count = verifyCandidate(root, previous);
    const production = verifyProductionAncestor(root, commit, process.env.SUPERAMBER_PRODUCTION_DIR || '/srv/superamber/production');
    console.log(`PASS staging retention: ${count} capabilities; includes production ${production.slice(0, 12)}`);
  } catch (error) {
    console.error(`Staging release blocked: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyCandidate, verifyProductionAncestor };
