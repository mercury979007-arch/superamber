const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TASK_PROFILE = 'superamber-candfedu-readonly.cnf';
const DEFAULT_RESULT_PROFILE = 'superamber-stu-center-readonly.cnf';

function resolvePrivateRoot(env = process.env) {
  const instanceRoot = String(env.REMOTELAB_INSTANCE_ROOT || '').trim();
  if (!instanceRoot) {
    throw new Error('缺少 REMOTELAB_INSTANCE_ROOT；请显式提供两个只读数据库配置路径');
  }
  return path.join(instanceRoot, 'config', 'private');
}

function resolveProfilePaths(env = process.env) {
  if (env.SUPERAMBER_TASK_DB_PROFILE && env.SUPERAMBER_RESULT_DB_PROFILE) {
    return { task: env.SUPERAMBER_TASK_DB_PROFILE, result: env.SUPERAMBER_RESULT_DB_PROFILE };
  }
  const privateRoot = resolvePrivateRoot(env);
  return {
    task: String(env.SUPERAMBER_TASK_DB_PROFILE || '').trim()
      || path.join(privateRoot, DEFAULT_TASK_PROFILE),
    result: String(env.SUPERAMBER_RESULT_DB_PROFILE || '').trim()
      || path.join(privateRoot, DEFAULT_RESULT_PROFILE),
  };
}

function parseCnfValue(rawValue) {
  const value = String(rawValue || '').trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1);
  }
  return value;
}

function parseCnf(raw) {
  const values = {};
  let inClientSection = false;
  for (const sourceLine of String(raw || '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inClientSection = line.toLowerCase() === '[client]';
      continue;
    }
    if (!inClientSection) continue;
    const equalsAt = line.indexOf('=');
    if (equalsAt < 0) {
      values[line] = true;
      continue;
    }
    values[line.slice(0, equalsAt).trim()] = parseCnfValue(line.slice(equalsAt + 1));
  }
  return values;
}

async function readProfile(profilePath) {
  const raw = await fs.readFile(profilePath, 'utf8');
  let profile;
  if (path.extname(profilePath).toLowerCase() === '.cnf') {
    const cnf = parseCnf(raw);
    let metadata = {};
    try {
      metadata = JSON.parse(await fs.readFile(profilePath.replace(/\.cnf$/i, '.json'), 'utf8'));
    } catch {
      // Optional metadata only; credentials remain in the 0600 MySQL option file.
    }
    profile = {
      ...metadata,
      host: cnf.host,
      port: cnf.port,
      username: cnf.user,
      password: cnf.password,
      profile: metadata.profile || path.basename(profilePath, '.cnf'),
    };
  } else {
    profile = JSON.parse(raw);
  }
  for (const field of ['host', 'username', 'password']) {
    if (!String(profile[field] || '').trim()) {
      throw new Error(`数据库配置 ${profilePath} 缺少 ${field}`);
    }
  }
  return profile;
}

function toPoolOptions(profile, { allowInsecure = false } = {}) {
  const tlsObserved = profile.tlsObserved === true;
  if (!tlsObserved && !allowInsecure) {
    throw new Error(
      `数据库 ${profile.profile || profile.host} 未检测到 TLS；影子链路默认拒绝明文连接。`
      + '仅限当前只读验收可显式传入 --allow-insecure-db。',
    );
  }

  return {
    host: String(profile.host).trim(),
    port: Number(profile.port) || 3306,
    user: String(profile.username).trim(),
    password: String(profile.password),
    waitForConnections: true,
    connectionLimit: 2,
    maxIdle: 1,
    idleTimeout: 60_000,
    queueLimit: 32,
    connectTimeout: 10_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    dateStrings: true,
    ...(tlsObserved ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}

async function loadShadowDbConfig({ env = process.env, allowInsecure = false } = {}) {
  const paths = resolveProfilePaths(env);
  const [taskProfile, resultProfile] = await Promise.all([
    readProfile(paths.task),
    readProfile(paths.result),
  ]);

  return {
    task: toPoolOptions(taskProfile, { allowInsecure }),
    result: toPoolOptions(resultProfile, { allowInsecure }),
    diagnostics: {
      task: {
        profile: taskProfile.profile || DEFAULT_TASK_PROFILE,
        host: taskProfile.host,
        tlsObserved: taskProfile.tlsObserved === true,
      },
      result: {
        profile: resultProfile.profile || DEFAULT_RESULT_PROFILE,
        host: resultProfile.host,
        tlsObserved: resultProfile.tlsObserved === true,
      },
    },
  };
}

module.exports = {
  loadShadowDbConfig,
  parseCnf,
  parseCnfValue,
  readProfile,
  resolveProfilePaths,
  toPoolOptions,
};
