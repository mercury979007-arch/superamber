const crypto = require('crypto');
const http = require('http');
const { Router } = require('express');
const {freshAgentPermissions}=require('../lib/agentPermissionRead');

const DEFAULT_TOKEN_TTL_MS = 45 * 1000;
const DEFAULT_READ_GRANT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_READ_GRANTS_PER_SESSION = 5;
const DEFAULT_AGENT_ORIGIN = 'http://127.0.0.1:43217';
const AGENT_BASE_PATH = '/superamber-classroom-agent';

function agentIdentity(username, secret = process.env.SUPERAMBER_AGENT_SUBJECT_SECRET || '') {
  const normalized = String(username || '').trim().normalize('NFKC').toLowerCase();
  if (!normalized || String(secret).length < 32) {
    return { subjectId: '', roleId: 'classroom_teacher', roleVersion: '2026-09-v1' };
  }
  return {
    subjectId: `teacher_${crypto.createHmac('sha256', secret).update(normalized).digest('hex')}`,
    roleId: 'classroom_teacher',
    roleVersion: '2026-09-v1',
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function readGrantMap(session) {
  if (!(session.agentReadGrants instanceof Map)) session.agentReadGrants = new Map();
  return session.agentReadGrants;
}

function cleanupReadGrants(session, now = Date.now()) {
  const grants = readGrantMap(session);
  for (const [hash, grant] of grants.entries()) {
    if (Number(grant?.expiresAt || 0) <= now) grants.delete(hash);
  }
  return grants;
}

function issueReadGrant(session, {
  ttlMs = DEFAULT_READ_GRANT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const timestamp = now();
  const grants = cleanupReadGrants(session, timestamp);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const grant = {
    tokenHash: hash,
    createdAt: timestamp,
    lastUsedAt: timestamp,
    expiresAt: timestamp + ttlMs,
  };
  grants.set(hash, grant);
  const ordered = [...grants.values()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  for (const stale of ordered.slice(MAX_READ_GRANTS_PER_SESSION)) grants.delete(stale.tokenHash);
  return { token, expiresAt: grant.expiresAt };
}

function exchangeReadGrant(sessions, token, {
  ttlMs = DEFAULT_READ_GRANT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const hash = tokenHash(token);
  const timestamp = now();
  for (const [sid, session] of sessions.entries()) {
    const grants = cleanupReadGrants(session, timestamp);
    const grant = grants.get(hash);
    if (!grant || !session?.scraper) continue;
    grant.lastUsedAt = timestamp;
    grant.expiresAt = timestamp + ttlMs;
    return { sid, session, grant };
  }
  return null;
}

function revokeReadGrant(sessions, token) {
  const hash = tokenHash(token);
  for (const session of sessions.values()) {
    if (readGrantMap(session).delete(hash)) return true;
  }
  return false;
}

function normalizeClasses(classMap) {
  if (!Array.isArray(classMap)) return [];
  return classMap.flatMap((item) => {
    const classCode = String(item?.classCode || item?.id || item?.name || '').trim().toUpperCase();
    const squadId = String(item?.squadId || '').trim();
    return classCode && squadId
      ? [{ id: classCode, name: classCode, squadId }]
      : [];
  });
}

function createDelegationStore({ sessions, tokenTtlMs = DEFAULT_TOKEN_TTL_MS, now = () => Date.now() }) {
  const pending = new Map();

  function cleanup() {
    const timestamp = now();
    for (const [key, entry] of pending.entries()) {
      if (entry.expiresAt <= timestamp) pending.delete(key);
    }
  }

  function issue({ sid, username, classes }) {
    cleanup();
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = now() + tokenTtlMs;
    pending.set(tokenHash(token), {
      sid,
      username: String(username || '').trim(),
      classes: normalizeClasses(classes),
      expiresAt,
    });
    return { token, expiresAt };
  }

  function exchange(token) {
    cleanup();
    const key = tokenHash(token);
    const entry = pending.get(key);
    pending.delete(key);
    if (!entry || entry.expiresAt <= now()) return null;
    const session = sessions.get(entry.sid);
    if (!session?.scraper) return null;
    return { ...entry, session };
  }

  return { issue, exchange, size: () => pending.size };
}

function createClassroomAgentApiRouter({
  sessions,
  ensureSession,
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
  readGrantTtlMs = DEFAULT_READ_GRANT_TTL_MS,
  readGrantEnabled = true,
  persistSessions = async () => {},
}) {
  const router = Router();
  const store = createDelegationStore({ sessions, tokenTtlMs });

  router.post('/classroom-agent/delegation', async (req, res) => {
    try {
      const { sid, session } = ensureSession(req, res);
      if (!session.scraper) {
        return res.status(401).json({ error: '测试站登录已失效，请先重新登录。' });
      }
      const classes = normalizeClasses(await session.scraper.getClassMap(true));
      if (classes.length === 0) {
        return res.status(403).json({ error: '当前账号没有可验证的班级权限。' });
      }
      const delegation = store.issue({ sid, username: session.username, classes });
      const identity = agentIdentity(session.username);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        status: 'success',
        token: delegation.token,
        expiresAt: new Date(delegation.expiresAt).toISOString(),
        username: session.username || '',
        classCount: classes.length,
        classes,
        ...identity,
      });
    } catch (error) {
      return res.status(502).json({ error: error.message || '无法核验当前班级权限。' });
    }
  });

  router.post('/classroom-agent/delegation/exchange', async (req, res) => {
    const delegated = store.exchange(req.body?.token);
    if (!delegated) {
      return res.status(401).json({ error: '会话委托票据无效、已使用或已过期。' });
    }
    try {
      const classes = normalizeClasses(await delegated.session.scraper.getClassMap(true));
      if (classes.length === 0) {
        return res.status(403).json({ error: '当前账号已没有可验证的班级权限。' });
      }
      delegated.session.lastSeenAt = Date.now();
      const readGrant = readGrantEnabled
        ? issueReadGrant(delegated.session, { ttlMs: readGrantTtlMs })
        : null;
      await persistSessions();
      res.setHeader('Cache-Control', 'no-store');
      const identity = agentIdentity(delegated.session.username || delegated.username);
      return res.json({
        status: 'success',
        username: delegated.session.username || delegated.username,
        classCount: classes.length,
        classes,
        upstreamCookie: `amber_sid=${encodeURIComponent(delegated.sid)}`,
        ...identity,
        ...(readGrant ? {
          readGrantToken: readGrant.token,
          readGrantExpiresAt: new Date(readGrant.expiresAt).toISOString(),
        } : {}),
      });
    } catch (error) {
      return res.status(502).json({ error: error.message || '会话权限刷新失败。' });
    }
  });

  router.post('/classroom-agent/read-grant', async (req, res) => {
    if (!readGrantEnabled) return res.status(404).json({ error: '长期只读授权未在此环境开放。' });
    try {
      const { session } = ensureSession(req, res);
      if (!session.scraper) return res.status(401).json({ error: '登录已失效，无法建立长期只读授权。' });
      const classes = normalizeClasses(await session.scraper.getClassMap(true));
      if (classes.length === 0) return res.status(403).json({ error: '当前账号没有可验证的班级权限。' });
      const grant = issueReadGrant(session, { ttlMs: readGrantTtlMs });
      const identity = agentIdentity(session.username);
      await persistSessions();
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        status: 'success', token: grant.token,
        expiresAt: new Date(grant.expiresAt).toISOString(),
        username: session.username || '', classCount: classes.length,
        ...identity,
      });
    } catch (error) {
      return res.status(502).json({ error: error.message || '长期只读授权建立失败。' });
    }
  });

  router.post('/classroom-agent/read-grant/exchange', async (req, res) => {
    if (!readGrantEnabled) return res.status(404).json({ error: '长期只读授权未在此环境开放。' });
    const granted = exchangeReadGrant(sessions, req.body?.token, { ttlMs: readGrantTtlMs });
    if (!granted) return res.status(401).json({ error: '长期只读授权已失效或已撤销。' });
    const startedAt=Date.now();let permissionMs=0;
    try {
      const classes = normalizeClasses(await freshAgentPermissions(granted.session.scraper));
      permissionMs=Date.now()-startedAt;
      if (classes.length === 0) return res.status(403).json({ error: '当前账号已没有可验证的班级权限。' });
      // A revoke/logout while the fresh check was in flight must win.
      if(sessions.get(granted.sid)!==granted.session||!readGrantMap(granted.session).has(tokenHash(req.body?.token)))return res.status(401).json({error:'长期只读授权已失效或已撤销。'});
      granted.session.lastSeenAt = Date.now();
      await persistSessions();
      if(sessions.get(granted.sid)!==granted.session||!readGrantMap(granted.session).has(tokenHash(req.body?.token)))return res.status(401).json({error:'长期只读授权已失效或已撤销。'});
      res.setHeader('Server-Timing',`permission;dur=${permissionMs},persist;dur=${Date.now()-startedAt-permissionMs}`);
      console.info(JSON.stringify({event:'agent_grant_exchange_timing',permissionMs,totalMs:Date.now()-startedAt,status:200}));
      res.setHeader('Cache-Control', 'no-store');
      const identity = agentIdentity(granted.session.username);
      return res.json({
        status: 'success', username: granted.session.username || '',
        classCount: classes.length, classes,
        upstreamCookie: `amber_sid=${encodeURIComponent(granted.sid)}`,
        expiresAt: new Date(granted.grant.expiresAt).toISOString(),
        ...identity,
      });
    } catch (error) {
      const status=error.code==='SOURCE_LOGIN_EXPIRED'?401:error.code==='SOURCE_PERMISSION_TIMEOUT'?504:502;
      console.warn(JSON.stringify({event:'agent_grant_exchange_timing',permissionMs,totalMs:Date.now()-startedAt,status,code:error.code||'PERMISSION_OR_PERSIST_FAILED'}));
      return res.status(status).json({ error: error.message || '长期只读授权核验失败。',code:error.code||'PERMISSION_OR_PERSIST_FAILED' });
    }
  });

  router.post('/classroom-agent/read-grant/revoke', async (req, res) => {
    const revoked = revokeReadGrant(sessions, req.body?.token);
    if (revoked) await persistSessions();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ status: 'success', revoked });
  });

  return router;
}

function createClassroomAgentProxy({
  ensureSession,
  agentOrigin = DEFAULT_AGENT_ORIGIN,
}) {
  const origin = new URL(agentOrigin);

  return function classroomAgentProxy(req, res) {
    const { session } = ensureSession(req, res);
    if (!session.scraper) {
      if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
        return res.redirect(302, '/');
      }
      return res.status(401).json({ error: '测试站登录已失效，请重新登录。' });
    }

    const suffix = req.url === '/' ? '/' : req.url;
    const targetPath = `${AGENT_BASE_PATH}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    const body = req.method === 'GET' || req.method === 'HEAD'
      ? null
      : Buffer.from(JSON.stringify(req.body || {}));
    const headers = {
      ...req.headers,
      host: origin.host,
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': 'https',
      'x-superamber-embedded': '1',
    };
    if (body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(body.length);
    } else {
      delete headers['content-length'];
    }

    const upstream = http.request({
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      method: req.method,
      path: targetPath,
      headers,
    }, (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value == null || name.toLowerCase() === 'transfer-encoding') continue;
        res.setHeader(name, value);
      }
      upstreamRes.pipe(res);
    });

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json({ error: '班级助理暂时不可用，请稍后重试。' });
      } else {
        res.end();
      }
    });
    if (body) upstream.end(body);
    else upstream.end();
    return undefined;
  };
}

module.exports = {
  createClassroomAgentApiRouter,
  createClassroomAgentProxy,
  createDelegationStore,
  exchangeReadGrant,
  issueReadGrant,
  normalizeClasses,
  revokeReadGrant,
};
