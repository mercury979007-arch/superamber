const { createUserFeedbackRoutes } = require('./routes/userFeedbackRoutes');
const { filterVideoTaskSnapshot } = require('./lib/videoTaskPolicy');
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const compression = require('compression');
const EducationSystemScraper = require('./scraper/scraper');
const { getBrowserTaskQueueStats } = require('./lib/browserTaskQueue');
const { createCheckinWorkbookFromPunchRows, createStudentWorkbookFromTableRows } = require('./dailyReportWorkbook');
const { fetchCheckinRowsForRange, formatDateOnly } = require('./lib/checkinApi');
const {
  buildCompleteTaskCatalog,
  mergeTaskSelections,
  selectCurrentTaskCycle,
  selectLatestCatalogWeekIds,
  selectRecentTaskDetails,
  taskLifecycle,
} = require('./lib/taskCatalog');
const { appendUsageEvent } = require('./lib/usageAnalytics');
const { rejectIfTestOnlyRouteBlocked, TEST_ONLY_ROUTES, createTestOnlyMiddleware } = require('./lib/testOnlyAccess');
const { createSeatingImageRenderer } = require('./services/seatingImageRenderer');
const { createUsageRouter } = require('./routes/usageRoutes');
const { createScoreBookRoutes } = require('./routes/scoreBookRoutes');
const { createCampReportTemplateRoutes } = require('./routes/campReportTemplateRoutes');
const { createSeatingBackupRoutes } = require('./routes/seatingBackupRoutes');
const { createClassroomObservationAsrRouter } = require('./routes/classroomObservationAsrRoutes');
const { createRosterSnapshotRoutes } = require('./routes/rosterSnapshotRoutes');
const { createClassControlRoutes } = require('./routes/classControlRoutes');
const {
  createSpeakingChallengeRoutes,
  loadChallengeClassFromAcademicSystem,
} = require('./routes/speakingChallengeRoutes');
const { createClassroomAgentApiRouter, createClassroomAgentProxy } = require('./routes/classroomAgentRoutes');
const { createRosterSnapshotService, startDailyRosterPrefetch } = require('./services/rosterSnapshotService');
const { createTaskRewardLedger } = require('./lib/taskRewardLedger');
const { submitRecoveryOnce } = require('./lib/minipinRecoverySubmission');
const { createDailyReportRewardPolicyStore } = require('./lib/dailyReportRewardPolicyStore');
const { loadShadowDbConfig } = require('./lib/dbShadow/config');
const { createShadowRuntime } = require('./lib/dbShadow/pipeline');
const { createPublicitySourceService } = require('./lib/dbShadow/publicitySourceService');
const { createSourceSwitch, loadSourceSwitchConfig } = require('./lib/dbShadow/sourceSwitch');
const { resolveChallengeWindow } = require('./lib/speakingChallenge');
const { buildPreparedCycleSelection } = require('./lib/classControl');
const {
  calendarConfig,
  formatDateKeyInTimezone,
  getAcademicWeekNumber,
  getPreviousAcademicWeekRange,
  getPreferredAcademicWindow: getConfiguredPreferredAcademicWindow,
  resolveAcademicTimezone,
  resolveWeek1Start,
} = require('./lib/academicCalendar');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const SESSION_COOKIE = 'amber_sid';
const DEFAULT_SESSION_TTL_DAYS = 180;
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SUPERAMBER_SESSION_TTL_DAYS) || DEFAULT_SESSION_TTL_DAYS);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const CNF_BASE_URL = process.env.CNFADMIN_BASE_URL || 'https://school.example.invalid';
function resolveReportScriptDir() {
  if (process.env.CLASS_DAILY_REPORT_SCRIPT_DIR) {
    return process.env.CLASS_DAILY_REPORT_SCRIPT_DIR;
  }

  const directCandidate = path.resolve(__dirname, '..', 'scripts');
  if (fsSync.existsSync(path.resolve(directCandidate, 'class_daily_report.py'))) {
    return directCandidate;
  }

  const legacyCandidate = path.resolve(os.homedir(), '.remotelab/instances/trial23/scripts');
  if (fsSync.existsSync(path.resolve(legacyCandidate, 'class_daily_report.py'))) {
    return legacyCandidate;
  }

  const guestRuntimeCandidate = '/var/lib/remotelab-guests/trial23/scripts';
  if (fsSync.existsSync(path.resolve(guestRuntimeCandidate, 'class_daily_report.py'))) {
    return guestRuntimeCandidate;
  }

  return legacyCandidate;
}

const REPORT_SCRIPT_DIR = resolveReportScriptDir();
const DEFAULT_USAGE_LOG_PATH = path.resolve(os.homedir(), '.remotelab/instances/trial23/data/classsitdown-usage-events.jsonl');
const USAGE_LOG_PATH = process.env.CLASSSITDOWN_USAGE_LOG_PATH || DEFAULT_USAGE_LOG_PATH;
const USAGE_SUMMARY_LOG_PATH = process.env.CLASSSITDOWN_USAGE_SUMMARY_LOG_PATH || USAGE_LOG_PATH;
const DEFAULT_WEEK1_START = resolveWeek1Start(process.env.WEEK1_START);
const ACADEMIC_TIMEZONE = resolveAcademicTimezone(process.env.ACADEMIC_TIMEZONE);
const sessions = new Map();
let sessionStoreSaveTimer = null;
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'production';
const CLASSROOM_AGENT_API_ENABLED = APP_ENV !== 'production'
  || process.env.SUPERAMBER_CLASSROOM_AGENT_API_ENABLED === '1';
const DAILY_REPORT_TERM_MODE = String(process.env.DAILY_REPORT_TERM_MODE || 'current').trim().toLowerCase();
const TASK_CATALOG_VERSION = 6;
const SESSION_STORE_DIR = process.env.SESSION_STORE_DIR || path.resolve(os.homedir(), '.remotelab/instances/trial23/data');
const SESSION_STORE_PATH = path.join(SESSION_STORE_DIR, 'classsitdown-sessions.json');
const CAMP_REPORT_TEMPLATE_STORE_PATH = process.env.CAMP_REPORT_TEMPLATE_STORE_PATH || path.join(SESSION_STORE_DIR, 'camp-report-templates.json');
const SEATING_BACKUP_STORE_PATH = process.env.SEATING_BACKUP_STORE_PATH || path.join(SESSION_STORE_DIR, `seating-backup-${APP_ENV}.json`);
const ROSTER_SNAPSHOT_STORE_PATH = process.env.ROSTER_SNAPSHOT_STORE_PATH || path.join(SESSION_STORE_DIR, `roster-snapshots-${APP_ENV}.json`);
const SPEAKING_CHALLENGE_STORE_PATH = process.env.SPEAKING_CHALLENGE_STORE_PATH || path.join(SESSION_STORE_DIR, `speaking-challenge-${APP_ENV}.json`);
const TASK_REWARD_LEDGER_STORE_PATH = process.env.TASK_REWARD_LEDGER_STORE_PATH || path.join(SESSION_STORE_DIR, `task-reward-ledger-${APP_ENV}.json`);
const DAILY_REPORT_REWARD_POLICY_STORE_PATH = process.env.DAILY_REPORT_REWARD_POLICY_STORE_PATH || path.join(SESSION_STORE_DIR, `daily-report-reward-policies-${APP_ENV}.json`);
const taskRewardLedger = createTaskRewardLedger({ storePath: TASK_REWARD_LEDGER_STORE_PATH });
const dailyReportRewardPolicyStore = createDailyReportRewardPolicyStore({ storePath: DAILY_REPORT_REWARD_POLICY_STORE_PATH });
let databaseRuntimePromise = null;
function getDatabaseRuntime() {
  if (!databaseRuntimePromise) databaseRuntimePromise = loadShadowDbConfig({
    allowInsecure: process.env.SUPERAMBER_DB_ALLOW_INSECURE === '1',
  }).then(createShadowRuntime).catch(error => { databaseRuntimePromise = null; throw error; });
  return databaseRuntimePromise;
}
const dbSourceSwitchConfig = loadSourceSwitchConfig();
const publicitySourceService = createPublicitySourceService({
  sourceSwitch: createSourceSwitch({ config: dbSourceSwitchConfig }),
  enabledDomains: process.env.SUPERAMBER_DB_SOURCE_DOMAINS || 'publicity',
  supplementMode: process.env.SUPERAMBER_DB_SUPPLEMENT_MODE === 'database'
    ? 'database'
    : 'legacy-compatible',
  runtimeFactory: getDatabaseRuntime,
});
const rosterSnapshotService = createRosterSnapshotService({
  storePath: ROSTER_SNAPSHOT_STORE_PATH,
  fetchDailyReportTasks: fetchDailyReportTaskSnapshot,
  fetchDailyReportPublicity: fetchDailyReportPublicitySnapshot,
  fetchSpeakingChallenge: ({ scraper, classId, window }) => fetchSpeakingChallengeWithSource(
    scraper,
    classId,
    window || resolveChallengeWindow(new Date()),
  ),
  persistRosters: false,
  fetchRosters: false,
});
const SERVER_STARTED_AT = new Date().toISOString();

async function fetchLegacyRoster(scraper, classId, authorized = null, squadType = 'offline') {
  const resolved = authorized || await scraper.resolveSquadId(classId);
  const response = await scraper.request(
    `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(resolved.squadId)}&squad_type=${encodeURIComponent(squadType)}`,
    { headers: { accept: 'application/json' } },
  );
  const data = await response.json().catch(() => ({}));
  if (!Array.isArray(data?.data)) {
    throw new Error(String(data?.msg || `学生名单获取失败: ${response.status}`));
  }
  return {
    classCode: String(resolved.classCode || classId || '').trim().toUpperCase(),
    squadId: Number(resolved.squadId) || 0,
    students: data.data.map((item) => ({
      id: Number(item?.id) || 0,
      no: String(item?.no || '').trim(),
      chName: String(item?.ch_name || '').trim(),
      enName: String(item?.en_name || '').trim(),
    })),
  };
}

function fetchRosterWithSource(session, classId, { squadType = 'offline' } = {}) {
  if (String(squadType).trim().toLowerCase() !== 'offline') {
    return fetchLegacyRoster(session.scraper, classId, null, squadType);
  }
  return publicitySourceService.fetchRoster({
    teacherIdentity: session.username,
    scraper: session.scraper,
    classId,
    legacy: (authorized) => fetchLegacyRoster(session.scraper, classId, authorized, squadType),
  });
}

function fetchCheckinRowsWithSource(scraper, options) {
  return publicitySourceService.fetchCheckinRows({
    teacherIdentity: scraper.username,
    scraper,
    classId: options.classId,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    legacy: () => fetchCheckinRowsForRange(scraper, options),
  });
}

function fetchSpeakingChallengeWithSource(scraper, classId, window) {
  return publicitySourceService.fetchSpeakingChallenge({
    teacherIdentity: scraper.username,
    scraper,
    classId,
    window,
    legacy: () => loadChallengeClassFromAcademicSystem({ scraper }, classId, window),
  });
}

function buildRosterSnapshotContext() {
  const speakingWindow = resolveChallengeWindow(new Date());
  return {
    dataDate: formatDateKeyInTimezone(new Date(), ACADEMIC_TIMEZONE),
    academicWeek: getAcademicWeekNumber(new Date(), {
      week1Start: DEFAULT_WEEK1_START,
      timezone: ACADEMIC_TIMEZONE,
    }),
    week1Start: DEFAULT_WEEK1_START,
    timezone: ACADEMIC_TIMEZONE,
    speakingWindow,
  };
}

function collectFailedRewardIds(rewards, failedList) {
  const normalizedFailedList = Array.isArray(failedList) ? failedList : [];
  const rewardEntries = Array.isArray(rewards) ? rewards : [];
  const ids = new Set();

  for (const item of normalizedFailedList) {
    const studentId = String(item?.studentId || '').trim();
    if (studentId) {
      ids.add(studentId);
      continue;
    }
    const names = [
      String(item?.name || '').trim().toLowerCase(),
      String(item?.studentName || '').trim().toLowerCase(),
      String(item?.chineseName || '').trim().toLowerCase(),
    ].filter(Boolean);
    for (const reward of rewardEntries) {
      const aliases = [
        String(reward.studentName || '').trim().toLowerCase(),
        String(reward.chineseName || '').trim().toLowerCase(),
        ...(Array.isArray(reward.aliases) ? reward.aliases : []).map((alias) => String(alias || '').trim().toLowerCase()),
      ].filter(Boolean);
      if (names.some((name) => aliases.includes(name))) {
        ids.add(String(reward.studentId || '').trim());
      }
    }
  }

  return Array.from(ids).filter(Boolean);
}

function getTraceId(req) {
  const raw = String(req.headers['x-login-trace-id'] || '').trim();
  return raw || crypto.randomUUID();
}

function logTrace(traceId, stage, payload = {}) {
  console.log('[login-trace]', JSON.stringify({ traceId, stage, ...payload }));
}

function sanitizeText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return sanitizeText(req.socket?.remoteAddress || '', 64);
}

const renderSeatingExportToPng = createSeatingImageRenderer();

function buildUsageEvent(req, session, payload = {}) {
  return {
    ts: new Date().toISOString(),
    event: sanitizeText(payload.event || 'unknown'),
    module: sanitizeText(payload.module || 'unknown'),
    teacherName: sanitizeText(session?.username || payload.teacherName || '匿名老师'),
    authenticated: Boolean(session?.username),
    className: sanitizeText(payload.className || ''),
    screen: sanitizeText(payload.screen || ''),
    detail: sanitizeText(payload.detail || '', 240),
    sid: sanitizeText(payload.sid || '', 80),
    sessionId: sanitizeText(parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || '', 80),
    ip: getClientIp(req),
    userAgent: sanitizeText(req.headers['user-agent'] || '', 240),
    env: sanitizeText(process.env.APP_ENV || process.env.NODE_ENV || 'production', 40),
    mpTotal: Number(payload.mpTotal) || 0,
    studentCount: Number(payload.studentCount) || 0,
    successCount: Number(payload.successCount) || 0,
    failedCount: Number(payload.failedCount) || 0,
  };
}

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err);
});

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

async function saveSessionStore({ strict = false } = {}) {
  try {
    const entries = [];
    for (const [sid, session] of sessions.entries()) {
      if (!session.scraper) continue;
      entries.push({
        sid,
        username: session.username,
        lastSeenAt: session.lastSeenAt,
        cookies: Array.from(session.scraper.session.cookieJar.values()),
        classMap: Array.isArray(session.scraper.classMapCache) ? session.scraper.classMapCache : [],
        semesters: Array.isArray(session.scraper.semesterDataCache) ? session.scraper.semesterDataCache : [],
        readGrants: session.agentReadGrants instanceof Map ? [...session.agentReadGrants.values()] : [],
      });
    }
    await fs.mkdir(SESSION_STORE_DIR, { recursive: true });
    await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(entries, null, 2), { mode: 0o600 });
    await fs.chmod(SESSION_STORE_PATH, 0o600);
  } catch (err) {
    console.error('⚠️ session 持久化写入失败:', err.message);
    if (strict) throw new Error('授权保存失败，请稍后重试。');
  }
}

function scheduleSessionStoreSave() {
  if (sessionStoreSaveTimer) return;
  sessionStoreSaveTimer = setTimeout(() => {
    sessionStoreSaveTimer = null;
    saveSessionStore().catch(() => {});
  }, 1000);
  sessionStoreSaveTimer.unref?.();
}

function setSessionCookie(res, sid) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

async function loadSessionStore() {
  try {
    const raw = await fs.readFile(SESSION_STORE_PATH, 'utf-8');
    const entries = JSON.parse(raw);
    const now = Date.now();
    let restored = 0;
    for (const entry of entries) {
      if (now - entry.lastSeenAt >= SESSION_TTL_MS) continue;
      const scraper = new EducationSystemScraper({ baseUrl: CNF_BASE_URL, username: entry.username || '' });
      for (const cookie of entry.cookies || []) {
        scraper.session.cookieJar.set(cookie.name, cookie);
      }
      scraper.classMapCache = Array.isArray(entry.classMap) ? entry.classMap : [];
      scraper.classMapCacheAt = Number(entry.lastSeenAt) || Date.now();
      scraper.semesterDataCache = Array.isArray(entry.semesters) ? entry.semesters : [];
      sessions.set(entry.sid, {
        scraper,
        username: entry.username || '',
        loginInProgress: false,
        lastSeenAt: entry.lastSeenAt,
        autoDailyReport: null,
        agentReadGrants: new Map((Array.isArray(entry.readGrants) ? entry.readGrants : [])
          .filter((grant) => grant?.tokenHash).map((grant) => [grant.tokenHash, grant])),
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
    setSessionCookie(res, currentSid);
    scheduleSessionStoreSave();
    return { sid: currentSid, session: existing };
  }

  const sid = crypto.randomUUID();
  const session = { scraper: null, username: '', loginInProgress: false, lastSeenAt: Date.now(), autoDailyReport: null };
  sessions.set(sid, session);
  setSessionCookie(res, sid);
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

function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie();
    if (Array.isArray(lines) && lines.length > 0) return lines;
  }
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((line) => line.trim()).filter(Boolean);
}

function mergeCookies(jar, headers) {
  for (const line of getSetCookieLines(headers)) {
    const pair = line.split(';', 1)[0] || '';
    const sep = pair.indexOf('=');
    if (sep <= 0) continue;
    const name = pair.slice(0, sep).trim();
    const value = pair.slice(sep + 1).trim();
    if (name) jar[name] = value;
  }
}

function buildCookieHeader(jar) {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchWithJar(url, options = {}, jar = {}) {
  const headers = new Headers(options.headers || {});
  const cookieHeader = buildCookieHeader(jar);
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  mergeCookies(jar, response.headers);
  return response;
}

async function loginCNF(username, password) {
  const jar = {};
  const pageResp = await fetchWithJar(`${CNF_BASE_URL}/admin/auth/login`, { method: 'GET' }, jar);
  const pageHtml = await pageResp.text();
  const token = pageHtml.match(/_token:\s*"([^"]+)"/)?.[1]?.trim();
  if (!token) throw new Error('未能解析教务系统登录 token');

  const body = new URLSearchParams({ username, password, _token: token, remember: 'false' });
  const loginResp = await fetchWithJar(`${CNF_BASE_URL}/admin/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
    },
    body: body.toString(),
  }, jar);

  if (loginResp.status >= 300 && loginResp.status < 400) {
    return jar;
  }

  const data = await loginResp.json().catch(() => ({}));
  if (String(data?.code) !== '1') {
    throw new Error(String(data?.msg || '账号或密码错误'));
  }
  return jar;
}

function parseMySquadHtml(html) {
  const classes = [];
  const rowPattern = /<tr\s*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const content = match[1];
    const idMatch = content.match(/data-id="(\d+)"/);
    const linkMatch = content.match(/squad_console\?type=(\w+)&id=(\d+)/);
    const nameMatch = content.match(/column-name[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)/);
    const sectionMatch = content.match(/column-section[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    const groupMatch = content.match(/column-group[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    const teacherMatch = content.match(/column-class_teacher[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    if (idMatch && nameMatch) {
      classes.push({
        id: Number(idMatch[1]),
        type: linkMatch?.[1] || 'offline',
        name: nameMatch[1].trim(),
        section: (sectionMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
        group: (groupMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
        tutor: (teacherMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
      });
    }
  }
  return classes;
}

app.post('/api/scraper/login', async (req, res) => {
  const { session } = ensureSession(req, res);
  const traceId = getTraceId(req);
  res.setHeader('X-Login-Trace-Id', traceId);

  if (session.loginInProgress) {
    return res.status(429).json({ error: '正在登录中，请稍等...', traceId });
  }

  try {
    const startedAt = performance.now();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '缺少用户名或密码' });
    }

    session.loginInProgress = true;
    logTrace(traceId, 'login_request_started', {
      username,
      hadExistingSession: Boolean(session.scraper),
    });

    if (session.scraper) {
      try { await session.scraper.close(); } catch {}
      session.scraper = null;
    }

    const scraper = new EducationSystemScraper({
      baseUrl: CNF_BASE_URL,
      username,
      password,
    });

    await scraper.login();
    const loginFinishedAt = performance.now();
    logTrace(traceId, 'scraper_login_completed', {
      timings: scraper.lastLoginTiming,
    });
    console.log(`✅ 登录成功: ${username}`);

    const classMap = await scraper.getClassMap();
    let academicTerm = null;
    try {
      const preferred = getPreferredAcademicWindow();
      const semesters = await scraper.fetchSemesterData();
      const selected = scraper.selectSemester(semesters, preferred);
      if (selected) {
        academicTerm = {
          id: String(selected.id || selected.term_id || ''),
          name: String(selected.name || preferred.preferredSemester),
        };
      }
    } catch (termError) {
      console.warn(`⚠️ 首次登录学期初始化失败，后续按需重试: ${termError.message}`);
    }
    const classesFinishedAt = performance.now();
    const classes = classMap.map((item) => ({
      id: item.classCode,
      name: item.classCode,
      squadId: item.squadId,
      relationship: item.relationship,
      sources: item.sources,
      type: item.type,
    }));
    console.log(`✅ 获取到 ${classes.length} 个班级: ${classes.map(c => c.name).join(', ')}`);

    session.scraper = scraper;
    session.username = username;
    session.lastSeenAt = Date.now();
    saveSessionStore().catch(() => {});

    await appendUsageEvent(USAGE_LOG_PATH, buildUsageEvent(req, session, {
      event: 'login_success',
      module: 'auth',
      detail: `classes=${classes.length}`,
    }));

    const responseTimings = {
      routeMs: Number((classesFinishedAt - startedAt).toFixed(1)),
      scraperLogin: scraper.lastLoginTiming,
      classMap: scraper.lastClassMapTiming,
      routePhases: {
        loginMs: Number((loginFinishedAt - startedAt).toFixed(1)),
        classMapMs: Number((classesFinishedAt - loginFinishedAt).toFixed(1)),
      },
    };
    logTrace(traceId, 'login_request_completed', {
      classCount: classes.length,
      timings: responseTimings,
      academicTerm,
    });

    res.json({
      status: 'success',
      message: '登录成功',
      traceId,
      classes,
      classCount: classes.length,
      academicTerm,
      timings: responseTimings,
    });
  } catch (error) {
    logTrace(traceId, 'login_request_failed', {
      error: error.message,
    });
    console.error('❌ 登录失败:', error.message);
    res.status(500).json({ error: error.message, traceId });
  } finally {
    session.loginInProgress = false;
  }
});

app.post('/api/scraper/logout', async (req, res) => {
  const sid = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  const session = sid ? sessions.get(sid) : null;
  try {
    await session?.scraper?.close?.();
  } catch {
    // Revocation must continue even if the upstream browser/session cleanup fails.
  }
  if (sid) sessions.delete(sid);
  clearSessionCookie(res);
  await saveSessionStore();
  res.json({ status: 'success', message: '登录权限已撤销。' });
});

app.post('/api/traces/login-client', (req, res) => {
  const traceId = String(req.body?.traceId || '').trim() || crypto.randomUUID();
  console.log('[login-client-trace]', JSON.stringify({
    traceId,
    totalMs: req.body?.totalMs,
    requestMs: req.body?.requestMs,
    responseParseMs: req.body?.responseParseMs,
    handoffMs: req.body?.handoffMs,
    renderMs: req.body?.renderMs,
    location: req.body?.location,
    userAgent: req.body?.userAgent,
  }));
  res.json({ status: 'ok', traceId });
});

app.use(TEST_ONLY_ROUTES, createTestOnlyMiddleware(APP_ENV, {
  allowProductionClassroomAgentApi: CLASSROOM_AGENT_API_ENABLED,
}));

app.use('/api', createUserFeedbackRoutes({ requireLoggedInSession, storePath: path.join(SESSION_STORE_DIR, `user-feedback-${APP_ENV}`) }));

app.use('/api', createUsageRouter({
  ensureSession,
  buildUsageEvent,
  usageLogPath: USAGE_LOG_PATH,
  usageSummaryLogPath: USAGE_SUMMARY_LOG_PATH,
}));

app.use('/api', createCampReportTemplateRoutes({
  templateStorePath: CAMP_REPORT_TEMPLATE_STORE_PATH,
  adminPassword: process.env.CAMP_REPORT_ADMIN_PASSWORD,
}));

app.use('/api', createSeatingBackupRoutes({
  backupStorePath: SEATING_BACKUP_STORE_PATH,
}));

app.use('/api', createRosterSnapshotRoutes({
  requireLoggedInSession,
  service: rosterSnapshotService,
  buildContext: buildRosterSnapshotContext,
}));

app.use('/api', createClassControlRoutes({
  requireLoggedInSession,
  rosterSnapshotService,
  taskCatalogVersion: TASK_CATALOG_VERSION,
  currentTermName: String(calendarConfig?.currentTerm?.semesterName || ''),
  week1Start: DEFAULT_WEEK1_START,
  timezone: ACADEMIC_TIMEZONE,
  readConcurrency: 1,
  fetchCheckinRowsForRange: fetchCheckinRowsWithSource,
  fetchPublicity: ({ session, classId, selection }) => publicitySourceService.fetch({
    teacherIdentity: session.username,
    scraper: session.scraper,
    classId,
    selection,
  }),
  rewardPolicyStore: dailyReportRewardPolicyStore,
}));

const { createReadingWordsService } = require('./lib/readingWords/service');
const readingWordsService = createReadingWordsService({ poolProvider: async () => (await getDatabaseRuntime()).getPools() });
app.use('/api', createSpeakingChallengeRoutes({
  readingWordsService,
  loadChallengeClass: (session, classId, window) => fetchSpeakingChallengeWithSource(session.scraper, classId, window),
  requireLoggedInSession,
  storePath: SPEAKING_CHALLENGE_STORE_PATH,
  speakingSnapshotService: rosterSnapshotService,
  appendUsageEvent,
  buildUsageEvent,
  usageLogPath: USAGE_LOG_PATH,
  sanitizeText,
}));
app.use('/api', createClassroomAgentApiRouter({
  sessions,
  ensureSession,
  readGrantEnabled: CLASSROOM_AGENT_API_ENABLED,
  persistSessions: () => saveSessionStore({ strict: true }),
}));
app.use('/api', createScoreBookRoutes({
  requireLoggedInSession,
  buildUsageEvent,
  appendUsageEvent,
  USAGE_LOG_PATH,
  sanitizeText,
}));

app.use('/classroom-observation-api', createClassroomObservationAsrRouter());

app.post('/api/seating/export-image', async (req, res) => {
  try {
    if (!requireLoggedInSession(req, res)) return;
    const html = String(req.body?.html || '').trim();
    const cssText = String(req.body?.cssText || '');
    const stylesheetHrefs = Array.isArray(req.body?.stylesheetHrefs) ? req.body.stylesheetHrefs : [];
    const width = Number(req.body?.width) || 0;
    const height = Number(req.body?.height) || 0;
    if (!html || !width || !height) {
      return res.status(400).json({ error: '缺少导出参数' });
    }

    const png = await renderSeatingExportToPng({ html, cssText, stylesheetHrefs, width, height });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (error) {
    console.error('❌ 座位表导出失败:', error.message);
    res.status(500).json({ error: '座位表导出失败' });
  }
});

app.post('/api/scraper/get-classes', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const classMap = await session.scraper.getClassMap(req.body?.force === true);
    const classes = classMap.map((item) => ({
      id: item.classCode,
      name: item.classCode,
      squadId: item.squadId,
      relationship: item.relationship,
      sources: item.sources,
      type: item.type,
    }));
    console.log(`✅ 刷新班级: ${classes.length} 个`);
    res.json({ status: 'success', data: classes, count: classes.length });
  } catch (error) {
    console.error('❌ 获取班级失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scraper/get-student-list', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const { classId } = req.body || {};
    if (!classId) {
      return res.status(400).json({ error: '缺少班级ID' });
    }

    const roster = await fetchRosterWithSource(session, classId);
    const { squadId } = roster;
    const students = roster.students.map(({ no, chName, enName }) => ({ no, chName, enName }));

    console.log(`✅ 获取班级 ${classId} (squad=${squadId}) 学生名单: ${students.length} 人`);
    res.json({ status: 'success', data: students, count: students.length, squadId });
  } catch (error) {
    console.error('❌ 获取学生名单失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scraper/batch-student-list', async (req, res) => {
  try {
    if (rejectIfTestOnlyRouteBlocked(req, res)) return;
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const { classIds } = req.body || {};
    if (!Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ error: '缺少班级列表' });
    }

    const startedAt = performance.now();

    // Resolve all squad IDs first (uses cached class map)
    const resolved = [];
    for (const classId of classIds) {
      try {
        const { squadId } = await session.scraper.resolveSquadId(classId);
        resolved.push({ classId, squadId });
      } catch (err) {
        console.warn(`⚠️ 无法解析班级 ${classId}: ${err.message}`);
      }
    }

    // Fetch student lists with concurrency limit to avoid hammering upstream
    const BATCH_CONCURRENCY = 4;
    const results = [];
    for (let i = 0; i < resolved.length; i += BATCH_CONCURRENCY) {
      const chunk = resolved.slice(i, i + BATCH_CONCURRENCY);
      const chunkResults = await Promise.allSettled(
          chunk.map(async ({ classId, squadId }) => {
            const roster = await fetchRosterWithSource(session, classId);
            return {
              classId,
              squadId: roster.squadId || squadId,
              students: roster.students.map(({ no, chName, enName }) => ({ no, chName, enName })),
            };
          })
      );
      results.push(...chunkResults);
    }

    const classes = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        classes.push(result.value);
      }
    }

    const totalStudents = classes.reduce((sum, c) => sum + c.students.length, 0);
    const totalMs = Number((performance.now() - startedAt).toFixed(1));
    console.log(`✅ 批量抓取 ${classes.length}/${classIds.length} 个班级，共 ${totalStudents} 人，耗时 ${totalMs}ms`);
    res.json({ status: 'success', classes, totalMs });
  } catch (error) {
    console.error('❌ 批量抓取失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cnf-roster', async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const squadId = String(req.body?.squadId || '').trim();
    const squadType = String(req.body?.squadType || 'offline').trim() || 'offline';
    const useSharedSession = !username && !password;
    const sharedSession = useSharedSession ? ensureSession(req, res).session : null;
    const activeUsername = useSharedSession
      ? String(sharedSession?.username || '').trim()
      : username;

    if (!useSharedSession && (!username || !password)) {
      return res.status(400).json({ ok: false, error: '缺少教务账号或密码' });
    }
    if (useSharedSession && !sharedSession?.scraper) {
      return res.status(401).json({ ok: false, error: '未登录，请先连接教务系统' });
    }

    // 统一登录一次，避免各分支重复调用 loginCNF
    const jar = useSharedSession ? null : await loginCNF(username, password);

    if (action === 'listSquads') {
      if (useSharedSession) {
        const classMap = await sharedSession.scraper.getClassMap(true);
        const squads = classMap.map((item) => ({
          id: Number(item.squadId) || 0,
          name: item.classCode,
          type: 'offline',
          section: '',
          group: '',
          tutor: '',
        }));
        return res.json({ ok: true, squads, total: squads.length, loginUsername: activeUsername });
      }

      const myResp = await fetchWithJar(`${CNF_BASE_URL}/admin/my_squad`, {
        method: 'GET',
        headers: { Accept: 'text/html' },
      }, jar);
      if (myResp.status >= 300 && myResp.status < 400) {
        throw new Error('登录态失效，请重新登录');
      }
      const myHtml = await myResp.text();
      const squads = parseMySquadHtml(myHtml);
      return res.json({ ok: true, squads, total: squads.length, loginUsername: activeUsername });
    }

    if (action === 'fetchRoster') {
      if (!/^\d+$/.test(squadId)) {
        return res.status(400).json({ ok: false, error: '缺少有效的班级 ID' });
      }

      const infoResp = useSharedSession
        ? await sharedSession.scraper.request(
          `/admin/squad_console/getSquadInfo?squad_id=${encodeURIComponent(squadId)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
        )
        : await fetchWithJar(
          `${CNF_BASE_URL}/admin/squad_console/getSquadInfo?squad_id=${encodeURIComponent(squadId)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          jar,
        );
      const infoData = await infoResp.json().catch(() => ({}));

      let students = [];
      if (useSharedSession) {
        const roster = await fetchRosterWithSource(sharedSession, squadId, { squadType });
        students = roster.students.map((item) => ({
          id: Number(item?.id) || 0,
          no: String(item?.no || '').trim(),
          enName: String(item?.enName || '').trim(),
          chName: String(item?.chName || '').trim(),
          displayName: String(item?.enName || item?.chName || item?.no || '').trim(),
        }));
      } else {
        const listResp = await fetchWithJar(
          `${CNF_BASE_URL}/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=${encodeURIComponent(squadType)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          jar,
        );
        const listData = await listResp.json().catch(() => ({}));
        if (!Array.isArray(listData?.data)) {
          throw new Error(String(listData?.msg || `学生名单获取失败: ${listResp.status}`));
        }
        students = listData.data.map((item) => {
          const enName = String(item?.en_name || '').trim();
          const chName = String(item?.ch_name || '').trim();
          return {
            id: Number(item?.id) || 0,
            no: String(item?.no || '').trim(),
            enName,
            chName,
            displayName: enName || chName || String(item?.no || '').trim(),
          };
        });
      }

      const squad = infoData?.data || {};
      return res.json({
        ok: true,
        squad: {
          id: Number(squad?.id) || Number(squadId),
          name: String(squad?.name || '').trim(),
          fullName: String(squad?.full_name || '').trim(),
          type: squadType,
        },
        students,
        total: students.length,
        loginUsername: activeUsername,
      });
    }

    return res.status(400).json({ ok: false, error: 'action 必须为 listSquads 或 fetchRoster' });
  } catch (error) {
    console.error('❌ CNF名单同步失败:', error.message);
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : '教务名单同步失败' });
  }
});

// ── 探测 cop_mip 发放接口（临时调试用）────────────────────────────────────────
app.post('/api/debug/probe-copmip', async (req, res) => {
  try {
    if (rejectIfTestOnlyRouteBlocked(req, res, '该调试接口仅在测试站开放')) return;
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const { classId } = req.body || {};
    const { squadId } = await session.scraper.resolveSquadId(String(classId || 'J342'));
    const results = {};

    // 1. 抓取 squad_console 页面找 cop_mip 相关链接和表单
    const { text: consoleHtml } = await session.scraper.requestText(
      `/admin/squad_console?id=${squadId}&type=offline`,
      { headers: { accept: 'text/html' } }
    );
    const copMipUrls = [...new Set((consoleHtml.match(/cop_mip[^"'\s)}<]*/g) || []))];
    const formActions = [...new Set((consoleHtml.match(/action="([^"]+)"/g) || []))];
    const ajaxUrls = [...new Set((consoleHtml.match(/['"]\/admin\/[^'"]*cop_mip[^'"]*['"]/g) || []))];
    results.consolePageUrls = { copMipUrls, formActions, ajaxUrls };

    // 2. 找 JS 文件中的 cop_mip 接口
    const scriptSrcs = consoleHtml.match(/src="([^"]*\.js[^"]*)"/g) || [];
    results.scriptCount = scriptSrcs.length;

    // 3. 尝试获取 cop_mip 页面（如果有独立页面）
    const copMipPages = [
      `/admin/squad/cop_mip?squad_id=${squadId}`,
      `/admin/squad/cop_mip/index?squad_id=${squadId}`,
      `/admin/squad/cop_mip/manage?squad_id=${squadId}&squad_type=offline`,
      `/admin/squad/cop_mip/create?squad_id=${squadId}`,
      `/admin/squad/cop_mip/sendMip`,
    ];
    results.pageProbes = {};
    for (const page of copMipPages) {
      try {
        const resp = await session.scraper.request(page, {
          headers: { accept: 'text/html,application/json' },
          redirect: 'manual',
        });
        const status = resp.status;
        const body = await resp.text().catch(() => '');
        const hasForm = body.includes('<form') || body.includes('store');
        const inputs = (body.match(/<input[^>]*name="([^"]+)"/g) || []).slice(0, 10);
        const storeUrls = [...new Set((body.match(/store[^"'\s)}<]*/g) || []).slice(0, 5))];
        results.pageProbes[page] = { status, hasForm, inputs, storeUrls, bodyLen: body.length, preview: body.slice(0, 300) };
      } catch (e) {
        results.pageProbes[page] = { error: e.message };
      }
    }

    // 4. 尝试 cop_mip POST 接口
    const xsrfCookie = session.scraper.getDecodedCookieValue('XSRF-TOKEN');
    const csrfToken = session.scraper.extractLoginToken(consoleHtml);
    const postEndpoints = [
      { url: '/admin/squad/cop_mip/sendMip', data: { squad_id: squadId, student_no: '20240001', amount: 0, _token: csrfToken } },
      { url: '/admin/squad/cop_mip/store', data: { squad_id: squadId, _token: csrfToken } },
      { url: '/admin/squad/cop_mip/send', data: { squad_id: squadId, _token: csrfToken } },
    ];
    results.postProbes = {};
    for (const { url, data } of postEndpoints) {
      try {
        const resp = await session.scraper.request(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json, text/html',
            ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
          },
          body: new URLSearchParams(data).toString(),
          redirect: 'manual',
        });
        const status = resp.status;
        const body = await resp.text().catch(() => '');
        if (status !== 404) {
          results.postProbes[url] = { status, preview: body.slice(0, 500) };
        }
      } catch (e) {
        results.postProbes[url] = { error: e.message };
      }
    }

    res.json({ ok: true, squadId, ...results });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ── MP 余额查询 ─────────────────────────────────────────────────────────────
app.post('/api/mp/balance', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const { classId } = req.body || {};
    if (!classId) return res.status(400).json({ error: '缺少班级ID' });
    const balance = await session.scraper.getMinipinBalance(String(classId));
    res.json({ status: 'success', ...balance });
  } catch (error) {
    console.error('❌ 查询MP余额失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── MP 回收上下文（实时学生余额与原因） ─────────────────────────────────────
app.post('/api/mp/recovery-context', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const { classId } = req.body || {};
    if (!classId) return res.status(400).json({ error: '缺少班级ID' });
    const context = await session.scraper.getMinipinRecoveryContext(String(classId));
    res.json({ status: 'success', ...context });
  } catch (error) {
    console.error('❌ 查询MP回收上下文失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── MP 批量回收 ────────────────────────────────────────────────────────────
app.post('/api/scraper/recover-minipin', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const { classId, className = '', recoveries, reason = '行为习惯', requestId } = req.body || {};
    if (!classId || !Array.isArray(recoveries) || recoveries.length === 0) {
      return res.status(400).json({ error: '缺少班级ID或回收数据' });
    }
    const normalized = recoveries.map((item) => ({
      studentId: String(item?.studentId || '').trim(),
      amount: Number(item?.amount),
    }));
    if (normalized.some((item) => !item.studentId || !Number.isFinite(item.amount) || item.amount <= 0)) {
      return res.status(400).json({ error: '回收名单包含无效学号或数量' });
    }
    const result = await submitRecoveryOnce({
      directory: path.join(SESSION_STORE_DIR, `minipin-recovery-${APP_ENV}`),
      username: session.username, requestId,
      payload: { classId: String(classId), recoveries: normalized, reason: String(reason || '行为习惯') },
      submit: () => session.scraper.recoverMinipinDirect(String(classId), normalized, String(reason || '行为习惯')),
    });
    if (!result.duplicate) await appendUsageEvent(USAGE_LOG_PATH, buildUsageEvent(req, session, {
      event: 'minipin_recovered',
      module: 'mp-distribution',
      className: sanitizeText(className || String(classId || '').trim()),
      detail: `success=${Number(result?.success) || 0};failed=${Number(result?.failed) || 0};reason=${sanitizeText(result?.reason || reason)}`,
      mpTotal: Number(result?.totalMP) || 0,
      studentCount: normalized.length,
      successCount: Number(result?.success) || 0,
      failedCount: Number(result?.failed) || 0,
    })).catch((error) => console.error('回收已完成，使用记录写入失败:', error.message));
    res.json({ status: 'success', ...result });
  } catch (error) {
    console.error('❌ 回收MP失败:', error.message);
    res.status(/无法确认|禁止自动重试/.test(String(error?.message || '')) ? 502 : 400).json({
      status: 'error', error: error.message,
    });
  }
});

// ── MP 直接发放 ──────────────────────────────────────────────────────────────
app.post('/api/scraper/submit-minipin', async (req, res) => {
  let normalizedRewards = [];
  let taskLedgerEntryId = '';
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const { classId, rewards, className = '', taskSelection = null } = req.body || {};
    if (!classId || !Array.isArray(rewards) || rewards.length === 0) {
      return res.status(400).json({ error: '缺少班级ID或奖励数据' });
    }

    normalizedRewards = rewards
      .map((reward) => ({
        studentId: String(reward.studentId || '').trim(),
        studentName: String(reward.studentName || '').trim(),
        chineseName: String(reward.chineseName || '').trim(),
        aliases: Array.isArray(reward.aliases)
          ? reward.aliases.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        amount: Number(reward.amount) || 0,
        components: {
          basic: Math.max(0, Number(reward?.components?.basic) || 0),
          speaking: Math.max(0, Number(reward?.components?.speaking) || 0),
        },
        hasDeclaredComponents: Boolean(reward?.components && typeof reward.components === 'object'),
      }))
      .filter((reward) => reward.studentName && reward.amount > 0);

    if (normalizedRewards.length === 0) {
      return res.status(400).json({ error: '没有可发放的奖励' });
    }

    if (taskSelection?.source === 'class-daily-report') {
      const selectedWeekIds = [...new Set((Array.isArray(taskSelection.selectedWeekIds) ? taskSelection.selectedWeekIds : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean))];
      const taskClassId = sanitizeText(className || '').toUpperCase();
      for (const reward of normalizedRewards) {
        if (!reward.hasDeclaredComponents) reward.components.basic = reward.amount;
      }
      const hasBasic = normalizedRewards.some((reward) => reward.components.basic > 0);
      const hasSpeaking = normalizedRewards.some((reward) => reward.components.speaking > 0);
      let taskSnapshot = null;
      if (hasBasic) {
        taskSnapshot = taskClassId ? await rosterSnapshotService.getDailyReportTask(session.username, taskClassId) : null;
        const availableWeekIds = new Set((taskSnapshot?.weekTasks || []).map((week) => String(week?.id || '')));
        if (!taskSnapshot || selectedWeekIds.length === 0 || selectedWeekIds.some((weekId) => !availableWeekIds.has(weekId))) {
          return res.status(400).json({ error: '日报任务选择已失效，请返回首页重新确认' });
        }
        if (taskSelection.snapshotUpdatedAt
          && String(taskSelection.snapshotUpdatedAt) !== String(taskSnapshot.updatedAt || '')) {
          return res.status(409).json({ code: 'TASK_SNAPSHOT_CHANGED', error: '首页任务快照已经更新，请返回班级日报重新确认后再发放。' });
        }
      }
      const speakingStart = String(taskSelection?.speakingRange?.start || '').trim();
      const speakingEnd = String(taskSelection?.speakingRange?.end || '').trim();
      const speakingDateKeys = [];
      if (hasSpeaking) {
        if (!/^20\d{2}-\d{2}-\d{2}$/.test(speakingStart) || !/^20\d{2}-\d{2}-\d{2}$/.test(speakingEnd)) {
          return res.status(400).json({ error: '每日开口结算日期范围无效，请刷新日报后重试' });
        }
        const cursor = new Date(`${speakingStart}T12:00:00Z`);
        const last = new Date(`${speakingEnd}T12:00:00Z`);
        while (cursor <= last && speakingDateKeys.length < 31) {
          speakingDateKeys.push(`speaking:${cursor.toISOString().slice(0, 10)}`);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        if (speakingDateKeys.length === 0 || cursor <= last) {
          return res.status(400).json({ error: '每日开口结算范围过长或日期顺序无效' });
        }
      }
      const componentMismatch = normalizedRewards.some((reward) => (
        Math.abs(reward.amount - reward.components.basic - reward.components.speaking) > 0.001
      ));
      if (componentMismatch || (!hasBasic && !hasSpeaking)) {
        return res.status(400).json({ error: '日报奖励分项与合计不一致，请刷新后重试' });
      }
      const ledgerRewards = normalizedRewards.map((reward) => ({
        studentId: reward.studentId,
        studentName: reward.studentName,
        chineseName: reward.chineseName,
        amount: reward.amount,
        sourceKeys: [
          ...(reward.components.basic > 0 ? selectedWeekIds : []),
          ...(reward.components.speaking > 0 ? speakingDateKeys : []),
        ],
      }));
      const ledgerStart = await taskRewardLedger.begin({
        username: session.username,
        classId: taskClassId,
        selectedWeekIds: [...selectedWeekIds, ...speakingDateKeys],
        rewards: ledgerRewards,
      });
      if (!ledgerStart.ok) {
        return res.status(409).json({
          code: 'TASK_REWARD_OVERLAP',
          error: `检测到 ${ledgerStart.conflictingStudentIds.length} 名学生在相同任务或每日开口日期中已经发放过，本次已拦截。`,
          conflictingStudentIds: ledgerStart.conflictingStudentIds,
        });
      }
      taskLedgerEntryId = ledgerStart.entryId;
    }

    const result = await session.scraper.submitMinipinDirect(String(classId), normalizedRewards);
    const failedStudentIds = collectFailedRewardIds(normalizedRewards, result?.failedList);
    if (taskLedgerEntryId) {
      const failedSet = new Set(failedStudentIds);
      await taskRewardLedger.complete(taskLedgerEntryId, {
        successfulStudentIds: normalizedRewards.map((reward) => reward.studentId).filter((id) => !failedSet.has(id)),
        failedStudentIds,
      });
    }
    await appendUsageEvent(USAGE_LOG_PATH, buildUsageEvent(req, session, {
      event: 'minipin_issued',
      module: 'mp-distribution',
      className: sanitizeText(className || String(classId || '').trim()),
      detail: `success=${Number(result?.success) || 0};failed=${Number(result?.failed) || 0}`,
      mpTotal: normalizedRewards.reduce((sum, reward) => sum + (Number(reward.amount) || 0), 0),
      studentCount: normalizedRewards.length,
      successCount: Number(result?.success) || 0,
      failedCount: Number(result?.failed) || 0,
    }));
    if ((Number(result?.success) || 0) === 0 && failedStudentIds.length > 0) {
      return res.status(502).json({
        error: '发放失败，请改用兜底 Excel 上传到官网',
        status: 'error',
        ...result,
        failedStudentIds,
        taskRewardEntryId: taskLedgerEntryId,
      });
    }
    res.json({ status: 'success', ...result, failedStudentIds, taskRewardEntryId: taskLedgerEntryId });
  } catch (error) {
    if (taskLedgerEntryId) {
      await taskRewardLedger.uncertain(taskLedgerEntryId, error?.message || error).catch(() => {});
    }
    console.error('❌ 发放奖励失败:', error.message);
    res.status(500).json({
      code: taskLedgerEntryId ? 'TASK_REWARD_UNCERTAIN' : 'MINIPIN_ISSUE_FAILED',
      error: error.message,
      failedStudentIds: normalizedRewards.map((reward) => reward.studentId).filter(Boolean),
      taskRewardEntryId: taskLedgerEntryId,
    });
  }
});

app.get('/api/data/class-control/reward-issue-status', async (req, res) => {
  const session = requireLoggedInSession(req, res);
  if (!session) return;
  const classId = sanitizeText(req.query?.classId || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) return res.status(400).json({ error: '班级参数无效' });
  const issue = await taskRewardLedger.recoverable({ username: session.username, classId });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'success', issue });
});

app.post('/api/data/class-control/reward-issue-reconcile', async (req, res) => {
  const session = requireLoggedInSession(req, res);
  if (!session) return;
  const classId = sanitizeText(req.body?.classId || '').toUpperCase();
  const entryId = String(req.body?.entryId || '').trim();
  const pending = await taskRewardLedger.recoverable({ username: session.username, classId });
  if (!pending || pending.id !== entryId) return res.status(404).json({ error: '没有找到该班级的待核对发放记录' });
  try {
    const startedAt = new Date(Date.parse(pending.createdAt) - 30_000).toISOString();
    const endedAt = new Date(Date.parse(pending.createdAt) + 5 * 60_000).toISOString();
    const records = await session.scraper.getMinipinGrantRecords(classId, { startedAt, endedAt });
    const issue = await taskRewardLedger.reconcile({ username: session.username, classId, entryId, records });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'success', issue });
  } catch (error) {
    res.status(502).json({ error: `官网流水核对失败：${String(error?.message || error)}`, issue: pending });
  }
});

app.post('/api/data/class-control/reward-issue-release', async (req, res) => {
  const session = requireLoggedInSession(req, res);
  if (!session) return;
  const classId = sanitizeText(req.body?.classId || '').toUpperCase();
  try {
    const issue = await taskRewardLedger.releaseUnconfirmed({
      username: session.username,
      classId,
      entryId: String(req.body?.entryId || '').trim(),
      acknowledgedNotReceived: req.body?.acknowledgedNotReceived === true,
    });
    if (!issue) return res.status(404).json({ error: '待核对发放记录已处理或不存在' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'success', issue });
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error) });
  }
});

// ── AI 日报生成 ──────────────────────────────────────────────────────────────
function callAnthropicAPI(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error('ANTHROPIC_API_KEY 未配置，请在后端环境中设置该变量'));
      return;
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            } else {
              resolve(parsed.content?.[0]?.text ?? '');
            }
          } catch (e) {
            reject(new Error('API 响应解析失败: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callCodexFallback(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const prompt = [
      systemPrompt,
      '',
      '请严格只输出最终日报正文，不要添加解释、前言、后记或代码块围栏。',
      '',
      ...messages.map((message) => {
        const role = message.role === 'user' ? '用户' : '助手';
        return `${role}：${message.content}`;
      }),
    ].join('\n');

    const child = spawn(
      'codex',
      [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '-m',
        'gpt-5.4-mini',
        prompt,
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: process.env,
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('日报生成超时，请稍后再试'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `日报生成失败（退出码 ${code}）`));
        return;
      }

      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
            const text = String(parsed.item.text || '').trim();
            if (text) {
              resolve(text);
              return;
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }

      reject(new Error('日报生成失败，未获取到可用内容'));
    });
  });
}

function generateDailyReport(messages, systemPrompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropicAPI(messages, systemPrompt);
  }
  return callCodexFallback(messages, systemPrompt);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'AmberClass/1.0',
          Accept: 'application/json, text/plain, */*',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`JSON 解析失败: ${data.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
  });
}

async function translateWordToChinese(text) {
  const safeText = String(text || '').trim();
  if (!safeText) return '';

  try {
    const googlePayload = await requestJson(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(safeText)}`
    );
    const rows = Array.isArray(googlePayload?.[0]) ? googlePayload[0] : [];
    const translated = rows
      .map((row) => (Array.isArray(row) ? String(row[0] || '') : ''))
      .join('')
      .trim();
    if (translated) return translated;
  } catch (error) {
    console.warn('translate google failed:', error.message);
  }

  try {
    const memoryPayload = await requestJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(safeText)}&langpair=en|zh-CN`
    );
    const translated = String(memoryPayload?.responseData?.translatedText || '').trim();
    if (translated) return translated;
  } catch (error) {
    console.warn('translate mymemory failed:', error.message);
  }

  return '';
}

function buildDailyReportPrompt(mode, customPrompt) {
  const basePrompt = `你是一位英语培训机构的班主任助手，负责根据课程数据生成班级日报。
输出格式为 Markdown，使用中文。
语气积极、专业，避免批评性语言。`;

  if (mode === 'detailed') {
    return `${basePrompt}

请生成详细版班级日报，内容尽量完整、信息密度更高。
优先包含以下内容（根据数据实际情况灵活调整）：
1. 本次课程整体情况与课堂状态
2. 出勤、完成度、积分或表现亮点
3. 每个重点学生的具体表现或进步点
4. 需要后续关注的情况
5. 本课重点与老师建议`;
  }

  if (mode === 'custom') {
    return `${basePrompt}

请按照用户给出的自定义要求生成日报。
如果用户要求与原始数据冲突，以原始数据为准。
用户的自定义要求如下：
${String(customPrompt || '').trim()}`;
  }

  return `${basePrompt}

请生成常规版班级日报，简洁清晰，适合直接发送。
优先包含以下内容（根据数据实际情况灵活调整）：
1. 本次课程总体情况
2. 积分或表现亮点
3. 需要关注的情况
  4. 老师寄语或本课重点`;
}

function parseMarkdownTableRows(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('|') && line.endsWith('|'));

  return lines
    .filter((line) => !/^\|\s*(---\s*\|)+\s*$/.test(line))
    .map((line) => line
      .slice(1, -1)
      .split('|')
      .map((cell) => String(cell || '').trim()));
}

function parseCompletedValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (['进行中', '未完成', '否', '0', '×'].includes(text)) return false;
  if (['已完成', '完成', '是', '1', '√'].includes(text)) return true;
  return null;
}

function parseScoreValue(value) {
  const text = String(value || '').trim().replace('%', '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeTablesForReport(tables, fallbackClassCode) {
  const studentMap = new Map();

  for (const table of tables) {
    const name = String(table?.name || '');
    const rows = parseMarkdownTableRows(table?.text);
    if (rows.length < 4) continue;

    const row1 = rows[1] || [];
    const row2 = rows[2] || [];
    const resourceBlocks = [];
    let currentBlock = null;

    for (let ci = 0; ci < row1.length; ci += 1) {
      const cell = String(row1[ci] || '').trim();
      if (cell.includes('[')) {
        if (currentBlock) {
          currentBlock.endCol = ci - 1;
          resourceBlocks.push(currentBlock);
        }
        currentBlock = { startCol: ci, endCol: ci, subCols: [] };
      }
      if (currentBlock && row2[ci] !== undefined) {
        currentBlock.subCols.push(String(row2[ci] || '').trim());
      }
    }
    if (currentBlock) {
      currentBlock.endCol = row1.length - 1;
      resourceBlocks.push(currentBlock);
    }

    for (let ri = 3; ri < rows.length; ri += 1) {
      const row = rows[ri] || [];
      const studentId = String(row[1] || '').trim();
      if (!studentId || studentId === '学号') continue;

      const chineseName = String(row[2] || '').trim();
      const englishName = String(row[3] || '').trim();
      const studentName = englishName || chineseName || studentId;
      const existing = studentMap.get(studentName) || {
        name: studentName,
        completedTasks: 0,
        totalTrackedTasks: 0,
        scoreSum: 0,
        scoreCount: 0,
      };

      for (const block of resourceBlocks) {
        let colIdx = block.startCol;
        for (const subCol of block.subCols) {
          const rawVal = row[colIdx] ?? '';
          if (subCol.includes('是否完成')) {
            const completed = parseCompletedValue(rawVal);
            if (completed !== null) {
              existing.totalTrackedTasks += 1;
              if (completed) existing.completedTasks += 1;
            }
          }
          if (
            subCol.includes('分数') ||
            subCol.includes('平均分') ||
            subCol.includes('正确率')
          ) {
            const score = parseScoreValue(rawVal);
            if (score !== null) {
              existing.scoreSum += score;
              existing.scoreCount += 1;
            }
          }
          colIdx += 1;
        }
      }

      studentMap.set(studentName, existing);
    }

    if (rows.length > 1 && studentMap.size === 0) {
      for (let ri = 1; ri < rows.length; ri += 1) {
        const row = rows[ri] || [];
        const studentName = String(row[3] || row[2] || row[1] || row[0] || '').trim();
        if (!studentName) continue;
        if (!studentMap.has(studentName)) {
          studentMap.set(studentName, {
            name: studentName,
            completedTasks: 0,
            totalTrackedTasks: 0,
            scoreSum: 0,
            scoreCount: 0,
          });
        }
      }
    }

    const classMatch = name.match(/([A-Z]\d{2,4})/i);
    if (!fallbackClassCode && classMatch) fallbackClassCode = classMatch[1].toUpperCase();
  }

  return {
    classCode: fallbackClassCode,
    students: Array.from(studentMap.values()),
  };
}

function averageScore(student) {
  return student.scoreCount > 0 ? student.scoreSum / student.scoreCount : null;
}

function buildFastDailyReport({ classCode, tables, note, mode, customPrompt }) {
  const summary = summarizeTablesForReport(tables, classCode);
  const studentCount = summary.students.length;
  const trackedStudents = summary.students.filter((student) => student.totalTrackedTasks > 0);
  const overallCompletion = trackedStudents.length > 0
    ? trackedStudents.reduce((sum, student) => sum + (student.completedTasks / Math.max(student.totalTrackedTasks, 1)), 0) / trackedStudents.length * 100
    : null;
  const scoredStudents = summary.students.filter((student) => student.scoreCount > 0);
  const overallScore = scoredStudents.length > 0
    ? scoredStudents.reduce((sum, student) => sum + (averageScore(student) || 0), 0) / scoredStudents.length
    : null;

  const ranked = [...summary.students].sort((a, b) => {
    const aCompletion = a.totalTrackedTasks > 0 ? a.completedTasks / a.totalTrackedTasks : 0;
    const bCompletion = b.totalTrackedTasks > 0 ? b.completedTasks / b.totalTrackedTasks : 0;
    const aScore = averageScore(a) || 0;
    const bScore = averageScore(b) || 0;
    return (bCompletion * 100 + bScore) - (aCompletion * 100 + aScore);
  });

  const topStudents = ranked.slice(0, Math.min(3, ranked.length));
  const attentionStudents = ranked
    .filter((student) => student.totalTrackedTasks > 0 && student.completedTasks / Math.max(student.totalTrackedTasks, 1) < 0.7)
    .slice(0, 2);

  const focusLine = mode === 'custom' && String(customPrompt || '').trim()
    ? `本次重点：${String(customPrompt).trim()}`
    : '';
  const noteBlock = String(note || '').trim()
    ? `\n## 补充说明\n${String(note).trim()}`
    : '';
  const highlightLines = topStudents.length > 0
    ? topStudents.map((student) => {
        const completion = student.totalTrackedTasks > 0
          ? `${student.completedTasks}/${student.totalTrackedTasks}`
          : '已导入学习数据';
        const score = averageScore(student);
        return `- ${student.name}：完成情况 ${completion}${score !== null ? `，表现分约 ${Math.round(score)}` : ''}`;
      }).join('\n')
    : '- 本次已成功导入学生数据。';
  const attentionLines = attentionStudents.length > 0
    ? attentionStudents.map((student) => `- ${student.name}：后续可重点关注完成进度和课堂跟进。`).join('\n')
    : '- 暂无明显异常，整体状态稳定。';

  if (mode === 'detailed' || /详细|展开|具体/.test(String(customPrompt || ''))) {
    const studentBlocks = topStudents.map((student) => {
      const completionRate = student.totalTrackedTasks > 0
        ? Math.round((student.completedTasks / student.totalTrackedTasks) * 100)
        : null;
      const score = averageScore(student);
      return `### ${student.name}
- 完成度：${student.totalTrackedTasks > 0 ? `${student.completedTasks}/${student.totalTrackedTasks}（${completionRate}%）` : '已导入数据'}
${score !== null ? `- 表现分：约 ${Math.round(score)}` : '- 表现分：暂无可直接量化分数'}
- 整体表现：本次课堂状态稳定，建议继续保持当前节奏。`;
    }).join('\n\n');

    return `# ${summary.classCode || classCode} 班级日报详细版

${focusLine ? `${focusLine}\n\n` : ''}## 整体情况
- 学生人数：${studentCount}
${overallCompletion !== null ? `- 整体完成度：${Math.round(overallCompletion)}%` : '- 整体完成度：暂无可直接量化数据'}
${overallScore !== null ? `- 整体表现分：约 ${Math.round(overallScore)}` : '- 整体表现分：暂无可直接量化分数'}
- 整体判断：课堂状态总体稳定，数据已成功汇总。

## 亮点学生
${highlightLines}

## 重点学生情况
${studentBlocks || '- 本次暂无可展开的重点学生明细。'}

## 需要关注
${attentionLines}${noteBlock}`;
  }

  return `# ${summary.classCode || classCode} 班级日报

${focusLine ? `${focusLine}\n\n` : ''}## 本次课程总体情况
- 学生人数：${studentCount}
${overallCompletion !== null ? `- 整体完成度：${Math.round(overallCompletion)}%` : '- 已成功读取本次学习数据'}
${overallScore !== null ? `- 整体表现分：约 ${Math.round(overallScore)}` : '- 整体课堂状态稳定，可直接用于日报整理'}

## 表现亮点
${highlightLines}

## 需要关注
${attentionLines}${noteBlock}`;
}

app.post('/api/ai/daily-report', async (req, res) => {
  try {
    const { classCode, tables, note, mode = 'standard', customPrompt = '' } = req.body || {};
    if (!classCode) return res.status(400).json({ error: '缺少班级代码' });
    if (!Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({ error: '请至少上传一个数据表格' });
    }
    if (mode === 'custom' && !String(customPrompt).trim()) {
      return res.status(400).json({ error: '缺少自定义提示' });
    }

    const fastReport = buildFastDailyReport({
      classCode,
      tables,
      note,
      mode,
      customPrompt,
    });
    if (fastReport) {
      return res.json({ status: 'success', report: fastReport, source: 'local-fast' });
    }

    const tableText = tables
      .map((t) => `【${t.name}】\n${t.text}`)
      .join('\n\n');

    const modeLabel = mode === 'detailed' ? '详细版' : mode === 'custom' ? '自定义' : '常规版';
    const systemPrompt = buildDailyReportPrompt(mode, customPrompt);

    const userContent = `班级：${classCode}
模式：${modeLabel}

课程数据如下：

${tableText}${note ? `\n\n老师补充说明：${note}` : ''}${mode === 'custom' ? `\n\n自定义要求：${String(customPrompt).trim()}` : ''}`;

    const report = await generateDailyReport(
      [{ role: 'user', content: userContent }],
      systemPrompt
    );

    res.json({ status: 'success', report });
  } catch (error) {
    console.error('❌ 日报生成失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function decodeBase64File(payload, label) {
  const name = String(payload?.name || '').trim();
  const content = String(payload?.content || '').trim();
  if (!name || !content) {
    throw new Error(`${label}文件缺失`);
  }
  return {
    name,
    buffer: Buffer.from(content, 'base64'),
  };
}

function inferClassNameFromFilename(filename) {
  const match = String(filename || '').match(/([A-Za-z]\d{3,})/);
  return match ? `${match[1].toUpperCase()}班` : '';
}

function createEmptyCheckinWorkbook(filePath) {
  return new Promise((resolve, reject) => {
    const script = `
import sys
from openpyxl import Workbook

target = sys.argv[1]
wb = Workbook()
ws = wb.active
ws.title = "data"
headers = ["学号", "姓名", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "备注", "总打卡", "正常打卡", "补卡"]
ws.append(headers)
wb.save(target)
`;

    const child = spawn('python3', ['-c', script, filePath], { env: process.env });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || '空白打卡表创建失败'));
        return;
      }
      resolve();
    });
  });
}

function cleanupNoCheckinWorkbook(workbookPath, reportMode) {
  return new Promise((resolve, reject) => {
    const script = `
import sys
from openpyxl import load_workbook

path = sys.argv[1]
mode = sys.argv[2]
wb = load_workbook(path)

if mode == "detail" or mode == "senior":
    ws = wb[wb.sheetnames[0]]
    target_col = None
    for col in range(1, ws.max_column + 1):
        value = ws.cell(3, col).value
        if str(value).strip() == "打卡":
            target_col = col
            break
    if target_col:
        ws.delete_cols(target_col, 1)
else:
    ws_analysis = wb["质量分析"]
    header_row = 1
    target_col = None
    for col in range(1, ws_analysis.max_column + 1):
        value = ws_analysis.cell(header_row, col).value
        if str(value).strip() == "打卡":
            target_col = col
            break
    if target_col:
        ws_analysis.delete_cols(target_col, 1)

for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "打卡" in cell.value:
                cell.value = cell.value.replace("质量/打卡", "质量")

wb.save(path)
`;

    const child = spawn('python3', ['-c', script, workbookPath, reportMode], { env: process.env });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || '清理打卡列失败'));
        return;
      }
      resolve();
    });
  });
}

function runPythonReport(scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath, ...args], { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('日报生成超时，请稍后再试'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `日报生成失败（退出码 ${code}）`));
        return;
      }

      const outputPath = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);

      if (!outputPath) {
        reject(new Error('日报生成失败，未拿到输出文件'));
        return;
      }

      resolve(outputPath);
    });
  });
}

function getCurrentAcademicWeek(now = new Date()) {
  return getAcademicWeekNumber(now, {
    week1Start: DEFAULT_WEEK1_START,
    timezone: ACADEMIC_TIMEZONE,
  });
}

function getPreferredAcademicWindow(now = new Date()) {
  return getConfiguredPreferredAcademicWindow(now, { timezone: ACADEMIC_TIMEZONE });
}

function getPreviousWeekDateRange(now = new Date()) {
  return getPreviousAcademicWeekRange(now, {
    week1Start: DEFAULT_WEEK1_START,
    timezone: ACADEMIC_TIMEZONE,
  });
}

function extractWeekKey(taskName = '') {
  const text = String(taskName || '').trim();
  const weekMatch = text.match(/Week\s*\d+/i);
  if (weekMatch?.[0]) return weekMatch[0].replace(/\s+/g, '');
  const chineseWeekMatch = text.match(/第\s*\d+\s*周/);
  if (chineseWeekMatch?.[0]) return chineseWeekMatch[0].replace(/\s+/g, '');
  return text;
}

function groupTasksByWeek(tasks = []) {
  const grouped = new Map();
  for (const task of tasks) {
    const name = String(task?.name || task || '').trim();
    const nestedTasks = Array.isArray(task?.tasks) ? task.tasks.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (!name && nestedTasks.length === 0) continue;
    const weekKey = extractWeekKey(name || nestedTasks[0] || '');
    const existing = grouped.get(weekKey) || { id: weekKey, name: weekKey, resourceCount: 0, tasks: [], sourceLabels: [] };
    const nextTasks = nestedTasks.length > 0 ? nestedTasks : [name];
    existing.tasks.push(...nextTasks);
    existing.tasks = [...new Set(existing.tasks.filter(Boolean))];
    existing.resourceCount = existing.tasks.length;
    const sourceLabel = String(task?.sourceLabel || name || '').trim();
    if (sourceLabel && !existing.sourceLabels.includes(sourceLabel)) {
      existing.sourceLabels.push(sourceLabel);
    }
    grouped.set(weekKey, existing);
  }
  return Array.from(grouped.values());
}

function extractWeekNumber(taskName = '') {
  const text = String(taskName || '').trim();
  const weekMatch = text.match(/Week\s*(\d+)/i);
  if (weekMatch?.[1]) return Number(weekMatch[1]);
  const chineseWeekMatch = text.match(/第\s*(\d+)\s*周/);
  if (chineseWeekMatch?.[1]) return Number(chineseWeekMatch[1]);
  return null;
}

function extractTaskAssignedAt(taskName = '') {
  const text = String(taskName || '').trim();
  const match = text.match(/任务时间[:：]\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})(?:[日\sT]+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
  if (!match) return null;

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const normalized = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDefaultWeekSelection(groupedWeeks = []) {
  const previousWeekRange = getPreviousWeekDateRange();
  const previousWeek = previousWeekRange.previousWeek;
  const previousStartMs = new Date(`${formatDateOnly(previousWeekRange.start)}T00:00:00`).getTime();
  const previousEndMs = new Date(`${formatDateOnly(previousWeekRange.end)}T23:59:59`).getTime();
  const withNumber = groupedWeeks.map((week) => {
    let assignedAt = extractTaskAssignedAt(week.name || week.id);
    if (!assignedAt && Array.isArray(week.sourceLabels)) {
      for (const label of week.sourceLabels) {
        assignedAt = extractTaskAssignedAt(label);
        if (assignedAt) break;
      }
    }
    return {
      ...week,
      weekNumber: extractWeekNumber(week.name || week.id),
      assignedAt,
    };
  });

  const withinPreviousWeek = withNumber
    .filter((week) => week.assignedAt && week.assignedAt.getTime() >= previousStartMs && week.assignedAt.getTime() <= previousEndMs)
    .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  if (withinPreviousWeek.length > 0) {
    const targetTime = withinPreviousWeek[0].assignedAt.getTime();
    return withinPreviousWeek.filter((week) => week.assignedAt.getTime() === targetTime).map((week) => week.id);
  }

  const exact = withNumber.filter((week) => week.weekNumber === previousWeek);
  if (exact.length > 0) {
    return exact.map((week) => week.id);
  }

  const earlier = withNumber
    .filter((week) => Number.isFinite(week.weekNumber) && week.weekNumber < previousWeekRange.currentWeek)
    .sort((a, b) => Number(b.weekNumber) - Number(a.weekNumber));
  if (earlier.length > 0) {
    const topWeek = earlier[0].weekNumber;
    return earlier.filter((week) => week.weekNumber === topWeek).map((week) => week.id);
  }

  const historicalByDate = withNumber
    .filter((week) => week.assignedAt && week.assignedAt.getTime() <= previousEndMs)
    .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  if (historicalByDate.length > 0) {
    return [historicalByDate[0].id];
  }

  return withNumber.slice(-1).map((week) => week.id);
}

async function fetchDailyReportTaskSnapshot({ scraper, classId }) {
  const { preferredYear, preferredSemester } = getPreferredAcademicWindow();
  const taskInfo = await scraper.scrapePublicityTaskList(classId, {
    preferredYear,
    preferredSemester,
    semesterMode: DAILY_REPORT_TERM_MODE,
    // A term snapshot must stay term-pure. Adjacent-term task packages can
    // otherwise make a current-semester dashboard look like historical data.
    includeAdjacentActive: false,
  });
  // The task catalog is intentionally complete. The three-week limit belongs
  // to hydrated student/task details, not to this small public task index.
  const groupedWeeks = buildCompleteTaskCatalog(taskInfo, groupTasksByWeek);
  const hydratedWeeks = buildCompleteTaskCatalog({
    ...taskInfo,
    taskGroups: selectRecentTaskDetails(taskInfo, 3),
  }, groupTasksByWeek).filter((week) => week.taskSelection?.taskIds?.length > 0);
  const resolvedSemester = taskInfo.preferredSemester || preferredSemester;
  const historicalSource = Boolean(resolvedSemester && resolvedSemester !== preferredSemester);
  const previousWeekRange = getPreviousWeekDateRange();
  const cycleSelection = selectCurrentTaskCycle(groupedWeeks, new Date(), { historical: historicalSource });
  const defaultSelectedWeekIds = cycleSelection.reason === 'missing-cycle-metadata'
    ? (historicalSource ? selectLatestCatalogWeekIds(groupedWeeks) : buildDefaultWeekSelection(groupedWeeks))
    : cycleSelection.ids;

  return filterVideoTaskSnapshot({
    taskCatalogVersion: TASK_CATALOG_VERSION,
    classId: String(classId).trim().toUpperCase(),
    preferredYear,
    preferredSemester: resolvedSemester,
    weekMap: Object.fromEntries(groupedWeeks.map((week) => [week.id, week.tasks])),
    weekSourceLabels: Object.fromEntries(groupedWeeks.map((week) => [week.id, week.sourceLabels || []])),
    weekSelectionMap: Object.fromEntries(groupedWeeks.map((week) => [week.id, week.taskSelection || {}])),
    hydratedWeekIds: hydratedWeeks.map((week) => week.id),
    hydratedWeekLabels: hydratedWeeks.map((week) => {
      const cycleStart = String(week.startAt || '').slice(0, 10);
      const date = cycleStart || (() => {
        const assigned = (week.sourceLabels || []).map(extractTaskAssignedAt).find(Boolean);
        return assigned ? formatDateOnly(assigned) : '';
      })();
      return `${week.name}${date ? `（${date}）` : ''}`;
    }),
    defaultSelectedWeekIds,
    selectionReason: cycleSelection.reason === 'missing-cycle-metadata'
      ? 'legacy-fallback'
      : cycleSelection.reason,
    defaultCheckinRange: {
      start: formatDateOnly(previousWeekRange.start),
      end: formatDateOnly(previousWeekRange.end),
    },
    weekTasks: groupedWeeks.map((week) => ({
      id: week.id,
      name: week.name,
      resourceCount: week.resourceCount,
      addedAt: week.addAt || (() => {
        if (Array.isArray(week.sourceLabels)) {
          for (const label of week.sourceLabels) {
            const date = extractTaskAssignedAt(label);
            if (date) return formatDateOnly(date);
          }
        }
        return '';
      })(),
      startAt: week.startAt || '',
      endAt: week.endAt || '',
      status: week.status,
      statusText: week.statusText || '',
      lifecycle: taskLifecycle(week, new Date()),
      studentVisible: Boolean(week.studentVisible),
      skuId: week.skuId || '',
      collectionName: week.collectionName || '',
      declaredTerm: week.declaredTerm || '',
      weekNumber: week.weekNumber ?? null,
    })),
    updatedAt: new Date().toISOString(),
  });
}

async function fetchDailyReportPublicitySnapshot({ scraper, classId, taskSnapshot, selectedWeekIds }) {
  const selection = buildPreparedCycleSelection(taskSnapshot, { weekIds: selectedWeekIds });
  if (!selection?.preparedSelection?.taskIds?.length && !selection?.selectedTasks?.length) {
    throw new Error('所选日报任务没有可读取的任务节点');
  }
  const preparedSelectionComplete = selectedWeekIds.every((weekId) => (
    Array.isArray(taskSnapshot?.weekSelectionMap?.[String(weekId)]?.taskIds)
    && taskSnapshot.weekSelectionMap[String(weekId)].taskIds.length > 0
  ));
  return publicitySourceService.fetch({
    teacherIdentity: scraper.username,
    scraper,
    classId,
    selection: preparedSelectionComplete
      ? selection
      : { ...selection, preparedSelection: null },
  });
}

function applyDailyReportTaskSnapshotToSession(session, taskSnapshot) {
  session.autoDailyReport = {
    classId: String(taskSnapshot.classId),
    preferredYear: taskSnapshot.preferredYear,
    preferredSemester: taskSnapshot.preferredSemester,
    weekMap: taskSnapshot.weekMap || {},
    weekSourceLabels: taskSnapshot.weekSourceLabels || {},
    weekSelectionMap: taskSnapshot.weekSelectionMap || {},
    taskCatalogVersion: taskSnapshot.taskCatalogVersion || 0,
  };
}

function buildDailyReportTaskResponse(taskSnapshot, source) {
  return {
    status: 'success',
    source,
    preferredSemester: taskSnapshot.preferredSemester || '',
    hydratedWeekIds: taskSnapshot.hydratedWeekIds || [],
    hydratedWeekLabels: taskSnapshot.hydratedWeekLabels || [],
    updatedAt: taskSnapshot.updatedAt,
    defaultSelectedWeekIds: taskSnapshot.defaultSelectedWeekIds || [],
    selectionReason: taskSnapshot.selectionReason || '',
    defaultCheckinRange: taskSnapshot.defaultCheckinRange || {},
    weekTasks: taskSnapshot.weekTasks || [],
  };
}

async function buildAndSendDailyReport({
  req,
  res,
  session,
  className = '',
  reportMode = 'standard',
  minCheckinDays,
  detailTestPassScore,
  studentWorkbookBuilder,
  checkinFile,
  checkinWorkbookBuilder,
  usageDetail = '',
}) {
  let tempDir = '';

  try {
    const normalizedMode = reportMode === 'detail' || reportMode === 'senior'
      ? reportMode
      : 'standard';
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'class-daily-report-'));

    const studentPath = path.join(tempDir, 'student-publicity.xlsx');
    const checkinPath = path.join(tempDir, String(checkinFile?.name || 'optional-checkin.xlsx'));

    const buildStart = Date.now();
    console.log(`🔄 日报生成开始: ${className} mode=${reportMode}`);
    await studentWorkbookBuilder(studentPath);
    console.log(`  ✅ 学生数据工作簿生成完成 (${Date.now() - buildStart}ms)`);

    const hasCheckinFile = !!(checkinFile?.name && checkinFile?.content);
    const hasCheckinBuilder = typeof checkinWorkbookBuilder === 'function';
    if (hasCheckinFile) {
      const checkin = decodeBase64File(checkinFile, '打卡情况');
      await fs.writeFile(checkinPath, checkin.buffer);
    } else if (hasCheckinBuilder) {
      await checkinWorkbookBuilder(checkinPath);
    } else {
      await createEmptyCheckinWorkbook(checkinPath);
    }

    const scriptPath = normalizedMode === 'detail' || normalizedMode === 'senior'
      ? path.resolve(REPORT_SCRIPT_DIR, 'class_daily_report_detail.py')
      : path.resolve(REPORT_SCRIPT_DIR, 'class_daily_report.py');

    const args = [checkinPath, studentPath];
    const trimmedClassName = String(className || '').trim();
    if (trimmedClassName) {
      args.push(trimmedClassName);
    }
    if (!hasCheckinFile && !hasCheckinBuilder) {
      args.push('--no-checkin');
    }
    const parsedMinCheckin = parseInt(minCheckinDays, 10);
    if (!Number.isNaN(parsedMinCheckin) && parsedMinCheckin >= 0) {
      args.push('--min-checkin', String(parsedMinCheckin));
    }
    const parsedDetailTestPassScore = Number.parseFloat(detailTestPassScore);
    if (Number.isFinite(parsedDetailTestPassScore) && parsedDetailTestPassScore >= 0) {
      args.push('--test-pass', String(parsedDetailTestPassScore));
    }
    if (normalizedMode === 'senior') {
      args.push('--word-acc', 'repeated');
    }

    console.log(`  🔄 开始运行 Python 日报脚本: ${path.basename(scriptPath)}`);
    const pyStart = Date.now();
    const outputPath = await runPythonReport(scriptPath, args, tempDir);
    console.log(`  ✅ Python 脚本完成 (${Date.now() - pyStart}ms), output: ${path.basename(outputPath)}`);
    if (!hasCheckinFile && !hasCheckinBuilder) {
      await cleanupNoCheckinWorkbook(outputPath, normalizedMode);
    }
    const fileBuffer = await fs.readFile(outputPath);
    const downloadName = path.basename(outputPath);

    await appendUsageEvent(USAGE_LOG_PATH, buildUsageEvent(req, session, {
      event: 'report_exported',
      module: 'daily-report',
      className: trimmedClassName,
      detail: usageDetail || normalizedMode,
    }));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    res.send(fileBuffer);
  } finally {
    if (tempDir) {
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

app.post('/api/reports/class-daily-report', async (req, res) => {
  try {
    const { session } = ensureSession(req, res);
    const {
      className = '',
      reportMode = 'standard',
      studentFile,
      checkinFile,
      minCheckinDays,
      detailTestPassScore,
    } = req.body || {};

    const student = decodeBase64File(studentFile, '学生个人数据');
    const inferredClassName = inferClassNameFromFilename(student.name);

    await buildAndSendDailyReport({
      req,
      res,
      session,
      className: inferredClassName || String(className || '').trim(),
      reportMode,
      minCheckinDays,
      detailTestPassScore,
      checkinFile,
      usageDetail: reportMode === 'detail' ? 'detail' : reportMode === 'senior' ? 'senior' : 'standard',
      studentWorkbookBuilder: async (studentPath) => {
        await fs.writeFile(studentPath, student.buffer);
      },
    });
  } catch (error) {
    console.error('❌ 班级日报文件生成失败:', error.message);
    res.status(500).json({ error: error.message || '班级日报生成失败' });
  }
});

app.post('/api/reports/class-daily-report-from-publicity', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const {
      classId,
      className = '',
      reportMode = 'standard',
      selectedTasks = [],
      preferredYear,
      preferredSemester = '',
      checkinFile,
      minCheckinDays,
      detailTestPassScore,
    } = req.body || {};

    if (!classId) {
      return res.status(400).json({ error: '缺少 classId' });
    }

    const publicity = await publicitySourceService.fetch({
      teacherIdentity: session.username,
      scraper: session.scraper,
      classId,
      selection: {
        selectedTasks,
        preferredYear,
        preferredSemester,
      },
    });

    await buildAndSendDailyReport({
      req,
      res,
      session,
      className: String(className || publicity.classId || classId).trim(),
      reportMode,
      minCheckinDays,
      detailTestPassScore,
      checkinFile,
      usageDetail: 'auto-publicity',
      studentWorkbookBuilder: async (studentPath) => {
        await createStudentWorkbookFromTableRows(publicity.tableRows, studentPath);
      },
    });
  } catch (error) {
    console.error('❌ 公示数据自动生成日报失败:', error.message);
    res.status(500).json({ error: error.message || '公示数据自动生成日报失败' });
  }
});

app.post('/api/reports/auto-daily-report/tasks', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const { classId } = req.body || {};
    if (!classId) {
      return res.status(400).json({ error: '缺少 classId' });
    }

    let taskSnapshot = await rosterSnapshotService.getDailyReportTask(session.username, classId);
    let source = 'snapshot';
    if (!taskSnapshot || Number(taskSnapshot.taskCatalogVersion) !== TASK_CATALOG_VERSION) {
      const refreshed = await rosterSnapshotService.refreshDailyReportTask({
        username: session.username,
        scraper: session.scraper,
        classId,
      });
      taskSnapshot = refreshed.taskSnapshot;
      source = refreshed.deduplicated ? 'shared-refresh' : 'live';
    }
    applyDailyReportTaskSnapshotToSession(session, taskSnapshot);
    res.json(buildDailyReportTaskResponse(taskSnapshot, source));
  } catch (error) {
    console.error('❌ 获取自动日报任务失败:', error.message);
    res.status(500).json({ error: error.message || '获取自动日报任务失败' });
  }
});

app.post('/api/reports/auto-daily-report', async (req, res) => {
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const {
      classId,
      className = '',
      reportMode = 'standard',
      selectedWeekIds = [],
      minCheckinDays,
      detailTestPassScore,
      includeCheckin = true,
      checkinRangeStart = '',
      checkinRangeEnd = '',
    } = req.body || {};
    if (!classId) {
      return res.status(400).json({ error: '缺少 classId' });
    }
    if (!Array.isArray(selectedWeekIds) || selectedWeekIds.length === 0) {
      return res.status(400).json({ error: '请至少选择一个周任务' });
    }

    if (!session.autoDailyReport || session.autoDailyReport.classId !== String(classId)) {
      let taskSnapshot = await rosterSnapshotService.getDailyReportTask(session.username, classId);
      if (!taskSnapshot || Number(taskSnapshot.taskCatalogVersion) !== TASK_CATALOG_VERSION) {
        taskSnapshot = (await rosterSnapshotService.refreshDailyReportTask({
          username: session.username,
          scraper: session.scraper,
          classId,
        })).taskSnapshot;
      }
      applyDailyReportTaskSnapshotToSession(session, taskSnapshot);
    }

    let weekMap = session.autoDailyReport.weekMap || {};
    let weekSourceLabels = session.autoDailyReport.weekSourceLabels || {};
    let weekSelectionMap = session.autoDailyReport.weekSelectionMap || {};
    const selectedTasks = [...new Set(
      selectedWeekIds.flatMap((weekId) => weekMap[String(weekId)] || [])
    )];
    const selectedWeekLabels = [...new Set(
      selectedWeekIds.flatMap((weekId) => weekSourceLabels[String(weekId)] || [])
    )];
    const preparedSelection = mergeTaskSelections(
      selectedWeekIds.map((weekId) => weekSelectionMap[String(weekId)] || {}),
    );
    if (selectedTasks.length === 0) {
      return res.status(400).json({ error: '未匹配到所选周任务' });
    }

    const publicity = await publicitySourceService.fetch({
      teacherIdentity: session.username,
      scraper: session.scraper,
      classId,
      selection: {
        selectedTasks,
        selectedWeekIds: selectedWeekIds,
        selectedWeekLabels,
        preparedSelection,
        preferredYear: session.autoDailyReport.preferredYear,
        preferredSemester: session.autoDailyReport.preferredSemester,
      },
    });

    let checkinWorkbookBuilder = null;
    if (includeCheckin) {
      const previousWeekRange = getPreviousWeekDateRange();
      const resolvedRangeStart = String(checkinRangeStart || formatDateOnly(previousWeekRange.start)).trim();
      const resolvedRangeEnd = String(checkinRangeEnd || formatDateOnly(previousWeekRange.end)).trim();

      try {
        const apiCheckin = await fetchCheckinRowsWithSource(session.scraper, {
          classId,
          rangeStart: resolvedRangeStart,
          rangeEnd: resolvedRangeEnd,
          preferredYear: session.autoDailyReport.preferredYear,
          preferredSemester: session.autoDailyReport.preferredSemester,
        });
        const apiRows = Array.isArray(apiCheckin?.rows) ? apiCheckin.rows : [];
        if (apiRows.length === 0) {
          throw new Error('HTTP打卡接口未返回学生行');
        }
        const isSummaryOnly = Boolean(apiCheckin.summaryOnly);
        console.log(`✅ 自动日报打卡改走HTTP接口: ${apiRows.length}人, term=${apiCheckin.termName || apiCheckin.termId}${isSummaryOnly ? ' (汇总模式)' : ''}`);
        checkinWorkbookBuilder = async (checkinPath) => {
          await createCheckinWorkbookFromPunchRows(apiRows, checkinPath, {
            allowSummaryOnly: isSummaryOnly,
          });
        };
      } catch (httpError) {
        console.warn(`⚠️ 自动日报打卡HTTP接口失败，已拒绝回退未验收的汇总抓取: ${httpError.message}`);
        throw new Error(`自动打卡暂不可用：${httpError.message}。为避免导出不可信的打卡结果，请先关闭“每日打卡”后导出；如需带打卡，请改用人工上传打卡文件。`);
      }
    }

    await buildAndSendDailyReport({
      req,
      res,
      session,
      className: String(className || publicity.classId || classId).trim(),
      reportMode,
      minCheckinDays,
      detailTestPassScore,
      usageDetail: 'auto-publicity-checkin',
      studentWorkbookBuilder: async (studentPath) => {
        await createStudentWorkbookFromTableRows(publicity.tableRows, studentPath);
      },
      checkinWorkbookBuilder,
    });
  } catch (error) {
    console.error('❌ 自动日报生成失败:', error.message);
    res.status(500).json({ error: error.message || '自动日报生成失败' });
  }
});

app.post('/api/reports/distribution-import/basic-file', async (req, res) => {
  let tempDir = '';
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const {
      classId,
      className = '',
      selectedWeekIds = [],
      taskSnapshotUpdatedAt = '',
    } = req.body || {};
    if (!classId) {
      return res.status(400).json({ error: '缺少 classId' });
    }

    let taskSnapshot = await rosterSnapshotService.getDailyReportTask(session.username, classId);
    if (!taskSnapshot || Number(taskSnapshot.taskCatalogVersion) !== TASK_CATALOG_VERSION) {
      taskSnapshot = (await rosterSnapshotService.refreshDailyReportTask({
        username: session.username,
        scraper: session.scraper,
        classId,
      })).taskSnapshot;
    }
    if (taskSnapshotUpdatedAt && String(taskSnapshot.updatedAt || '') !== String(taskSnapshotUpdatedAt)) {
      return res.status(409).json({ error: '首页任务快照已更新，请返回班级日报重新确认任务后再发放' });
    }
    const availableWeekIds = new Set((taskSnapshot.weekTasks || []).map((week) => String(week.id)));
    const effectiveWeekIds = Array.isArray(selectedWeekIds) && selectedWeekIds.length > 0
      ? [...new Set(selectedWeekIds.map((item) => String(item || '').trim()).filter((item) => availableWeekIds.has(item)))]
      : taskSnapshot.defaultSelectedWeekIds || [];
    const weekMap = taskSnapshot.weekMap || {};
    const weekSourceLabels = taskSnapshot.weekSourceLabels || {};
    const weekSelectionMap = taskSnapshot.weekSelectionMap || {};
    const effectiveTasks = [...new Set(
      effectiveWeekIds.flatMap((weekId) => weekMap[String(weekId)] || [])
    )];
    const effectiveWeekLabels = [...new Set(
      effectiveWeekIds.flatMap((weekId) => weekSourceLabels[String(weekId)] || [])
    )];
    const preparedSelection = mergeTaskSelections(
      effectiveWeekIds.map((weekId) => weekSelectionMap[String(weekId)] || {}),
    );
    const preparedSelectionComplete = effectiveWeekIds.every((weekId) => (
      Array.isArray(weekSelectionMap[String(weekId)]?.taskIds)
      && weekSelectionMap[String(weekId)].taskIds.length > 0
    ));
    if (effectiveTasks.length === 0 && preparedSelection.taskIds.length === 0) {
      return res.status(400).json({ error: '当前班级没有可导出的周任务' });
    }

    const publicity = await publicitySourceService.fetch({
      teacherIdentity: session.username,
      scraper: session.scraper,
      classId,
      selection: {
        selectedTasks: effectiveTasks,
        selectedWeekIds: effectiveWeekIds,
        selectedWeekLabels: effectiveWeekLabels,
        preparedSelection: preparedSelectionComplete ? preparedSelection : null,
        preferredYear: taskSnapshot.preferredYear,
        preferredSemester: taskSnapshot.preferredSemester,
      },
    });

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'distribution-import-basic-'));
    const filename = `${String(className || publicity.classId || classId).trim() || String(classId)}_学生个人数据_教务系统导出.xlsx`;
    const workbookPath = path.join(tempDir, filename);
    await createStudentWorkbookFromTableRows(publicity.tableRows, workbookPath);
    res.download(workbookPath, filename);
  } catch (error) {
    console.error('❌ MP 基础落实教务导出失败:', error.message);
    res.status(500).json({ error: error.message || 'MP 基础落实教务导出失败' });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.post('/api/reports/distribution-import/daily-checkin-file', async (req, res) => {
  let tempDir = '';
  try {
    const session = requireLoggedInSession(req, res);
    if (!session) return;

    const {
      classId,
      className = '',
      checkinRangeStart = '',
      checkinRangeEnd = '',
    } = req.body || {};
    if (!classId) {
      return res.status(400).json({ error: '缺少 classId' });
    }

    const defaults = getPreferredAcademicWindow();
    let preferredSemester = defaults.preferredSemester;
    if (!session.autoDailyReport || session.autoDailyReport.classId !== String(classId)) {
      const taskInfo = await session.scraper.scrapePublicityTaskList(classId, defaults);
      const groupedWeeks = taskInfo.taskGroups?.length ? groupTasksByWeek(taskInfo.taskGroups) : groupTasksByWeek(taskInfo.tasks || []);
      session.autoDailyReport = {
        classId: String(classId),
        preferredYear: defaults.preferredYear,
        preferredSemester: taskInfo.preferredSemester || defaults.preferredSemester,
        weekMap: Object.fromEntries(groupedWeeks.map((week) => [week.id, week.tasks])),
      };
    }
    preferredSemester = session.autoDailyReport.preferredSemester;

    const previousWeekRange = getPreviousWeekDateRange();
    const resolvedRangeStart = String(checkinRangeStart || formatDateOnly(previousWeekRange.start)).trim();
    const resolvedRangeEnd = String(checkinRangeEnd || formatDateOnly(previousWeekRange.end)).trim();
    const apiCheckin = await fetchCheckinRowsWithSource(session.scraper, {
      classId,
      rangeStart: resolvedRangeStart,
      rangeEnd: resolvedRangeEnd,
      preferredYear: session.autoDailyReport.preferredYear,
      preferredSemester,
    });
    const apiRows = Array.isArray(apiCheckin?.rows) ? apiCheckin.rows : [];
    if (apiRows.length === 0) {
      throw new Error('未读取到打卡学生行');
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'distribution-import-checkin-'));
    const filename = `${String(className || classId).trim() || String(classId)}_打卡情况_教务系统导出.xlsx`;
    const workbookPath = path.join(tempDir, filename);
    await createCheckinWorkbookFromPunchRows(apiRows, workbookPath, {
      allowSummaryOnly: Boolean(apiCheckin.summaryOnly),
    });
    res.download(workbookPath, filename);
  } catch (error) {
    console.error('❌ MP 每日打卡教务导出失败:', error.message);
    res.status(500).json({ error: error.message || 'MP 每日打卡教务导出失败' });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.get('/api/translate/en-zh', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    if (!text) return res.status(400).json({ error: '缺少 text' });
    const translated = await translateWordToChinese(text);
    res.json({ status: 'success', translated });
  } catch (error) {
    console.error('❌ 翻译失败:', error.message);
    res.status(500).json({ error: error.message || '翻译失败' });
  }
});

// Tencent Cloud OCR proxy
const TENCENT_SECRET_ID = String(process.env.TENCENT_SECRET_ID || '').trim();
const TENCENT_SECRET_KEY = String(process.env.TENCENT_SECRET_KEY || '').trim();

function tencentSign(secretKey, date, service, stringToSign) {
  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  return crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
}

const TENCENT_OCR_ACTIONS = {
  Auto: 'GeneralAccurateOCR',
  GeneralAccurateOCR: 'GeneralAccurateOCR',
  GeneralBasicOCR: 'GeneralBasicOCR',
  ExtractDocMulti: 'RecognizeGeneralTextImageWarn',
};

app.post('/api/tencent-ocr', async (req, res) => {
  try {
    if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
      return res.status(503).json({ error: 'OCR service is not configured' });
    }
    const { imageBase64, action = 'Auto', region = 'ap-guangzhou' } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: '缺少图片数据' });
    }

    const ocrAction = TENCENT_OCR_ACTIONS[action] || 'GeneralAccurateOCR';
    console.log('🖼️ 腾讯OCR请求开始:', {
      action: ocrAction,
      region,
      imageLength: String(imageBase64).length,
    });
    const service = 'ocr';
    const host = 'ocr.tencentcloudapi.com';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const payload = JSON.stringify({ ImageBase64: imageBase64 });
    const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');

    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${ocrAction.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    const signature = tencentSign(TENCENT_SECRET_KEY, date, service, stringToSign);
    const authorization = `TC3-HMAC-SHA256 Credential=${TENCENT_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const ocrRes = await fetch(`https://${host}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-TC-Action': ocrAction,
        'X-TC-Version': '2018-11-19',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': region,
        'Authorization': authorization,
      },
      body: payload,
    });

    const ocrRawText = await ocrRes.text();
    let ocrData;
    try { ocrData = JSON.parse(ocrRawText); } catch { ocrData = {}; }
    console.log('🔍 腾讯OCR HTTP状态:', ocrRes.status, '响应长度:', ocrRawText.length);
    const response = ocrData.Response || {};

    if (response.Error) {
      console.error('❌ 腾讯OCR错误:', response.Error.Code, response.Error.Message);
      return res.status(502).json({ error: `OCR错误: ${response.Error.Message} (${response.Error.Code})` });
    }

    const textDetections = response.TextDetections || [];
    const rawText = textDetections.map(d => d.DetectedText || '').join('\n');
    const words = textDetections.map(d => {
      const coords = d.ItemPolygon || {};
      return {
        text: d.DetectedText || '',
        confidence: d.Confidence || 90,
        x0: coords.X || 0,
        y0: coords.Y || 0,
        x1: (coords.X || 0) + (coords.Width || 0),
        y1: (coords.Y || 0) + (coords.Height || 0),
      };
    });

    console.log('✅ 腾讯OCR请求完成:', {
      action: ocrAction,
      words: words.length,
      rawTextLength: rawText.length,
    });

    res.json({ rawText, words, action: ocrAction });
  } catch (error) {
    console.error('❌ OCR代理失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ocr-health', (_req, res) => {
  res.json({
    ok: true,
    service: 'tencent-ocr-proxy',
    secretConfigured: Boolean(TENCENT_SECRET_ID && TENCENT_SECRET_KEY),
    actionMap: Object.keys(TENCENT_OCR_ACTIONS),
  });
});

app.post('/api/ocr-self-test', (req, res) => {
  const { action = 'Auto', region = 'ap-guangzhou' } = req.body || {};
  res.json({
    ok: Boolean(TENCENT_SECRET_ID && TENCENT_SECRET_KEY),
    action: TENCENT_OCR_ACTIONS[action] || 'GeneralAccurateOCR',
    region,
    warning: '已读取腾讯 OCR 密钥；此处做的是通道/密钥自检，不上传测试图片。',
  });
});

app.get('/api/health', (req, res) => {
  const { session } = ensureSession(req, res);
  res.json({
    status: 'ok',
    loggedIn: !!session.scraper,
    loginInProgress: session.loginInProgress,
    username: session.username || '',
    databaseDataSource: publicitySourceService.health(),
    browserTasks: getBrowserTaskQueueStats(),
  });
});

// ── 前端版本检查 ────────────────────────────────────────────────────────────
const DIST_INDEX_PATH = path.join(__dirname, '../frontend/dist/index.html');
const DEPLOY_META_PATH = path.join(__dirname, '../deploy-meta.json');

function readGitValue(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8').trim();
  } catch {
    return '';
  }
}

function readDeployMeta() {
  try {
    const raw = fsSync.readFileSync(DEPLOY_META_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const DEPLOY_META = readDeployMeta();

const BUILD_VERSION = (() => {
  const deployedVersion = String(DEPLOY_META?.version || '').trim();
  if (deployedVersion) {
    return deployedVersion;
  }
  try {
    const content = fsSync.readFileSync(DIST_INDEX_PATH, 'utf8');
    const match = content.match(/(?:index|main)-([^.]+)\.js/);
    return match ? match[1] : Date.now().toString(36);
  } catch {
    return Date.now().toString(36);
  }
})();

const BUILD_COMMIT = String(DEPLOY_META?.commitShort || '').trim() || readGitValue('rev-parse --short=12 HEAD') || 'unknown';
const BUILD_BRANCH = readGitValue('rev-parse --abbrev-ref HEAD');
const BUILD_ENVIRONMENT = (() => {
  const deployedEnvironment = String(DEPLOY_META?.environment || '').trim();
  if (deployedEnvironment) {
    return deployedEnvironment;
  }
  const explicit = String(
    process.env.CLASSSITDOWN_ENV
    || process.env.APP_ENV
    || process.env.DEPLOY_ENV
    || '',
  ).trim();
  if (explicit) {
    return explicit;
  }

  const normalizedBranch = BUILD_BRANCH.toLowerCase();
  if (normalizedBranch === 'test' || normalizedBranch.includes('test')) {
    return 'test';
  }
  if (normalizedBranch === 'stable' || normalizedBranch === 'main' || normalizedBranch === 'master') {
    return 'stable';
  }
  if (process.env.NODE_ENV === 'development') {
    return 'dev';
  }
  return BUILD_BRANCH || 'unknown';
})();

const DEPLOYED_AT = (() => {
  const deployedAt = String(DEPLOY_META?.deployedAt || '').trim();
  if (deployedAt) {
    return deployedAt;
  }
  try {
    return fsSync.statSync(DIST_INDEX_PATH).mtime.toISOString();
  } catch {
    return SERVER_STARTED_AT;
  }
})();

const BUILD_FINGERPRINT = [
  BUILD_ENVIRONMENT || 'unknown',
  BUILD_VERSION || 'unknown',
  BUILD_COMMIT || 'unknown',
  DEPLOYED_AT || SERVER_STARTED_AT,
].join(':');

function buildVersionPayload() {
  return {
    environment: BUILD_ENVIRONMENT,
    version: BUILD_VERSION,
    commit: BUILD_COMMIT,
    deployedAt: DEPLOYED_AT,
    fingerprint: BUILD_FINGERPRINT,
  };
}

app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(buildVersionPayload());
});

// 托管前端静态文件
const distDir = path.join(__dirname, '../frontend/dist');
app.use('/classroom-agent', createClassroomAgentProxy({
  ensureSession,
  agentOrigin: process.env.CLASSROOM_AGENT_ORIGIN || 'http://127.0.0.1:43217',
}));
const pickUpRoot = process.env.SUPERAMBER_PICK_UP_ROOT
  || (process.env.APP_ENV === 'staging'
    ? '/srv/superamber/pick-up/staging'
    : '/srv/superamber/pick-up/production');
app.use('/pick-up', express.static(pickUpRoot, {
  index: 'index.html',
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.html') || filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.use('/pick-up', (_req, res) => {
  res.status(404).type('text/plain').send('Pick Up resource not found');
});
const l2PickUpRoot = process.env.SUPERAMBER_L2_PICK_UP_ROOT
  || (process.env.APP_ENV === 'staging'
    ? '/srv/superamber/l2-pick-up/staging'
    : '/srv/superamber/l2-pick-up/production');
app.use('/l2-pick-up', express.static(l2PickUpRoot, {
  index: 'index.html',
  fallthrough: true,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.html') || filePath.endsWith('version.json')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  },
}));
app.use('/l2-pick-up', (_req, res) => {
  res.status(404).type('text/plain').send('Pick Up resource not found');
});
app.get(['/seating', '/seating/', '/class-seating', '/class-seating/'], (_req, res) => {
  res.redirect(302, '/summer-camp/seating');
});
app.use('/assets', express.static(path.join(distDir, 'assets'), {
  index: false,
  maxAge: '1y',
  immutable: true,
}));
app.use('/assets', (_req, res) => {
  res.status(404).type('text/plain').send('Asset not found');
});
app.use(express.static(distDir, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.(?:woff2?|ttf|otf)$/i.test(filePath)) {
      // Font URLs are versioned in the frontend. Keep the decoded resource
      // local so returning teachers do not see another font-driven reflow.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
// --- Debug: API discovery probe for cnfadmin endpoints ---
app.post('/api/debug/probe-cnf-apis', async (req, res) => {
  try {
    if (rejectIfTestOnlyRouteBlocked(req, res, '该调试接口仅在测试站开放')) return;
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const { classId } = req.body || {};
    if (!classId) return res.status(400).json({ error: '缺少 classId' });

    const { classCode, squadId } = await session.scraper.resolveSquadId(classId);
    const httpSession = session.scraper.session;
    const results = {};

    const checkinProbes = [
      { label: 'getTerms', path: '/admin/check_every_day/getTerms' },
      { label: 'exportCheckRecords_type2', path: `/admin/check_every_day/exportCheckRecords?squad_id=${squadId}&exportType=2` },
      { label: 'get_semester_data', path: '/admin/squad_console/get_semester_data' },
      { label: 'getFilterData', path: `/admin/squad_console/getFilterData?term_id=1&squad_id=${squadId}` },
    ];

    for (const probe of checkinProbes) {
      try {
        const resp = await httpSession.request(probe.path, {
          headers: { accept: 'application/json, text/html, */*', 'x-requested-with': 'XMLHttpRequest' },
        });
        const ct = resp.headers.get('content-type') || '';
        let preview = '';
        if (ct.includes('json')) {
          preview = (await resp.text()).substring(0, 500);
        } else if (ct.includes('spreadsheet') || ct.includes('octet-stream') || ct.includes('excel')) {
          const buf = await resp.arrayBuffer();
          preview = `[binary ${buf.byteLength} bytes]`;
        } else {
          preview = (await resp.text()).substring(0, 200);
        }
        results[probe.label] = { status: resp.status, contentType: ct, preview };
      } catch (err) {
        results[probe.label] = { error: err.message };
      }
    }
    res.json({ classCode, squadId, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback — 兼容 Express 5
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(distDir, 'index.html'));
});

if (require.main === module) {
  loadSessionStore().then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Amber server running at http://localhost:${PORT}`);
    });
    const stopPrefetch = startDailyRosterPrefetch({
      sessions,
      service: rosterSnapshotService,
      buildContext: buildRosterSnapshotContext,
    });
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`ℹ️ 收到 ${signal}，正在关闭后台读取与数据库连接`);
      setTimeout(() => process.exit(1), 10_000).unref();
      stopPrefetch();
      await Promise.allSettled([...sessions.values()].map(session => session.scraper?.close()));
      await publicitySourceService.close().catch((error) => {
        console.error(`❌ 数据库读取运行时关闭失败: ${error.message}`);
      });
      await (await databaseRuntimePromise?.catch(() => null))?.close();
      server.close(() => process.exit(0));
    };
    process.once('SIGTERM', () => { shutdown('SIGTERM'); });
    process.once('SIGINT', () => { shutdown('SIGINT'); });
  });
}

module.exports = { app, sessions, rosterSnapshotService };
