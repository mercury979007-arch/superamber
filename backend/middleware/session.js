const crypto = require('crypto');
const fs = require('fs/promises');

function createSessionMiddleware({ sessions, SESSION_COOKIE, SESSION_TTL_MS, CNF_BASE_URL, SESSION_STORE_DIR, SESSION_STORE_PATH, EducationSystemScraper }) {

  function parseCookies(header = '') {
    return Object.fromEntries(
      header
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf('=');
          if (index === -1) return [part, ''];
          return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
        })
    );
  }

  async function saveSessionStore() {
    try {
      const entries = [];
      for (const [sid, session] of sessions.entries()) {
        if (!session.scraper) continue;
        entries.push({
          sid,
          username: session.username,
          lastSeenAt: session.lastSeenAt,
          cookies: Array.from(session.scraper.session.cookieJar.values()),
        });
      }
      await fs.mkdir(SESSION_STORE_DIR, { recursive: true });
      await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(entries, null, 2));
    } catch (err) {
      console.error('⚠️ session 持久化写入失败:', err.message);
    }
  }

  async function loadSessionStore() {
    try {
      const raw = await fs.readFile(SESSION_STORE_PATH, 'utf-8');
      const entries = JSON.parse(raw);
      const now = Date.now();
      let restored = 0;
      for (const entry of entries) {
        if (now - entry.lastSeenAt >= SESSION_TTL_MS) continue;
        const scraper = new EducationSystemScraper({ baseUrl: CNF_BASE_URL });
        for (const cookie of entry.cookies || []) {
          scraper.session.cookieJar.set(cookie.name, cookie);
        }
        sessions.set(entry.sid, {
          scraper,
          username: entry.username || '',
          loginInProgress: false,
          lastSeenAt: entry.lastSeenAt,
          autoDailyReport: null,
        });
        restored++;
      }
      if (restored > 0) console.log(`✅ 从磁盘恢复了 ${restored} 个 session`);
    } catch {
      // 无持久化文件或格式异常，静默忽略
    }
  }

  function cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = false;
    for (const [sid, session] of sessions.entries()) {
      if (now - session.lastSeenAt < SESSION_TTL_MS) continue;
      session.scraper?.close?.().catch(() => {});
      sessions.delete(sid);
      cleaned = true;
    }
    if (cleaned) saveSessionStore().catch(() => {});
  }

  function ensureSession(req, res) {
    cleanupExpiredSessions();
    const cookies = parseCookies(req.headers.cookie);
    const currentSid = cookies[SESSION_COOKIE];
    if (currentSid && sessions.has(currentSid)) {
      const existing = sessions.get(currentSid);
      existing.lastSeenAt = Date.now();
      return { sid: currentSid, session: existing };
    }

    const sid = crypto.randomUUID();
    const session = { scraper: null, username: '', loginInProgress: false, lastSeenAt: Date.now(), autoDailyReport: null };
    sessions.set(sid, session);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    return { sid, session };
  }

  function requireLoggedInSession(req, res) {
    const { session } = ensureSession(req, res);
    if (!session.scraper) {
      res.status(401).json({ error: '未登录，请先登录' });
      return null;
    }
    return session;
  }

  return {
    parseCookies,
    saveSessionStore,
    loadSessionStore,
    cleanupExpiredSessions,
    ensureSession,
    requireLoggedInSession,
  };
}

module.exports = { createSessionMiddleware };
