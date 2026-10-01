/**
 * 爬虫主模块
 * 用于爬取教务系统数据
 */

const fs = require('fs');
const cheerio = require('cheerio');
const { performance } = require('node:perf_hooks');
const { ScraperBrowserRuntime } = require('../lib/scraperBrowserRuntime');
const { CnfHttpSession } = require('../lib/cnfHttpSession');
const {readAgentPermissionMap}=require('../lib/agentPermissionRead');
const {
  dedupeClassMap,
  extractClassMapFromHtml: parseClassMapFromHtml,
  extractDashboardClassMap,
  extractDashboardTutorId,
  extractMySquadClassMap,
} = require('../lib/classMapParser');
const { applyCoHeadTeacherClasses } = require('../lib/coHeadTeacherClasses');
const {
  extractComponentStats,
  extractJsonStats,
  extractStats,
  mergeMetrics,
} = require('../lib/minipinMetrics');
const {
  extractPublicityExportDataFromHtml,
  extractPublicityTaskListFromHtml,
} = require('../lib/publicityHttp');
const { parseOfficialDateTime, mergeTaskSelections } = require('../lib/taskCatalog');
const { sortModulesByGroup } = require('../reportSequenceRules');

let puppeteerModule = null;

function normalizeTaskTotalTitle(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/类型[:：]?.*$/u, '')
    .replace(/[·.]/g, '')
    .trim()
    .toLowerCase();
}

function getKnownTestScoreTotal(title) {
  const normalized = normalizeTaskTotalTitle(title);
  const knownTotals = new Map([
    ['l4readingu4l2温故', 11],
  ]);
  return knownTotals.get(normalized) || null;
}

function getPuppeteer() {
  if (!puppeteerModule) {
    puppeteerModule = require('puppeteer');
  }
  return puppeteerModule;
}

function formatDateInTimeZone(value, timeZone = 'Asia/Shanghai') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseCnfLocalDateTime(value) {
  const normalized = String(value || '').trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return '';
  const parsed = new Date(`${normalized}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function minipinRecordAmount(row) {
  const raw = Number(row?.number);
  if (!Number.isFinite(raw)) return null;
  const grantName = String(row?.grant_name || '').trim().toUpperCase();
  const amount = /^(CP|COUPON)$/.test(grantName) ? raw / 10 : raw;
  return Math.round(amount * 10) / 10;
}

class EducationSystemScraper {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://school.example.invalid';
    this.username = options.username;
    this.password = options.password;
    this.browser = null;
    this.page = null;
    this.session = new CnfHttpSession(this.baseUrl);
    this.browserSessionReady = false;
    this.lastLoginTiming = null;
    this.lastClassMapTiming = null;
    this.classMapCache = [];
    this.classMapCacheAt = 0;
    this.semesterDataCache = [];
    this.semesterDataPromise = null;
    this._lastFilterContext = null;
  }

  selectSemester(semesters, options = {}) {
    const list = Array.isArray(semesters) ? semesters.filter(Boolean) : [];
    const preferredYear = String(options.preferredYear || '').trim();
    const preferredSemester = String(options.preferredSemester || '').trim();
    const semesterMode = String(options.semesterMode || '').trim().toLowerCase();
    const parseRank = (name) => {
      const match = String(name || '').match(/(20\d{2})学年(春季|秋季)学期/);
      if (!match) return null;
      return Number(match[1]) * 2 + (match[2] === '秋季' ? 1 : 0);
    };

    if (semesterMode === 'previous') {
      const targetRank = parseRank(preferredSemester);
      const ranked = list
        .map((item) => ({ item, rank: parseRank(item?.name) }))
        .filter((entry) => entry.rank != null && (targetRank == null || entry.rank < targetRank))
        .sort((a, b) => b.rank - a.rank);
      if (ranked.length > 0) return ranked[0].item;
    }

    return list.find((item) => String(item?.name || '').includes(preferredSemester))
      || list.find((item) => String(item?.name || '').includes(`${preferredYear}学年春季学期`))
      || list.find((item) => String(item?.name || '').includes(`${preferredYear}学年`))
      || list[0]
      || null;
  }

  getBrowserRuntime() {
    if (!this.browserRuntime) {
      this.browserRuntime = new ScraperBrowserRuntime(this, () => {
        const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        return getPuppeteer().launch({
          headless: 'new',
          protocolTimeout: 30_000,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
            || (fs.existsSync(macChromePath) ? macChromePath : undefined),
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      });
    }
    return this.browserRuntime;
  }

  runBrowserTask(label, task) {
    return this.getBrowserRuntime().run(label, task);
  }

  async fetchSquadConsoleHtml(squadId) {
    const { response, text } = await this.session.requestText(
      `/admin/squad_console?id=${encodeURIComponent(squadId)}&type=offline`,
      { headers: { accept: 'text/html' } }
    );
    if (!response.ok) {
      throw new Error(`班级页获取失败 (HTTP ${response.status})`);
    }
    if (this.session.isLoginPage(text, response.url)) {
      throw new Error('登录状态已失效，请重新登录');
    }
    return text;
  }

  /**
   * 初始化浏览器
   */
  initBrowser() {
    return this.getBrowserRuntime().ensureBrowser();
  }

  replaceBrowserPage() {
    return this.getBrowserRuntime().replacePage();
  }

  /**
   * 确保 page 可用（处理 detached frame / page closed）
   */
  async ensurePageReady({ skipHydrationNavigation = false } = {}) {
    if (!this.browser || this.browser.isConnected?.() === false) {
      await this.initBrowser();
    }

    let needsHydration = false;

    if (!this.page || this.page.isClosed()) {
      await this.replaceBrowserPage();
      needsHydration = true;
    } else {
      try {
        await this.page.evaluate(() => 1);
      } catch (error) {
        await this.replaceBrowserPage();
        needsHydration = true;
      }
    }

    if (needsHydration) {
      this.browserSessionReady = false;
    }

    if (!this.browserSessionReady) {
      if (skipHydrationNavigation) {
        await this.hydrateBrowserCookies();
        this.browserSessionReady = true;
      } else {
        await this.hydrateBrowserSession();
      }
    }
  }

  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  get cookies() {
    return this.session.cookies;
  }

  async request(...args) {
    return this.session.request(...args);
  }

  async requestText(...args) {
    return this.session.requestText(...args);
  }

  async requestJson(path, options = {}) {
    const response = await this.session.request(path, {
      ...options,
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        ...(options.headers || {}),
      },
    });
    if (response.status === 401 || response.status === 403 || this.session.isLoginPage('', response.url)) {
      throw Object.assign(new Error('教务登录状态已失效，请重新登录'), { statusCode: 401 });
    }
    if (response.ok === false) throw new Error(`教务数据读取失败 (HTTP ${response.status})`);
    const data = await response.json().catch((error) => {
      // A cancelled, malformed or login response is never an empty catalog.
      if (error instanceof SyntaxError) throw new Error('教务数据返回格式异常，请稍后重试');
      throw error;
    });
    return { response, data };
  }

  // --- HTTP API: 学期列表 ---
  async fetchSemesterData(forceRefresh = false) {
    if (!forceRefresh && this.semesterDataCache.length > 0) {
      return this.semesterDataCache;
    }
    if (!forceRefresh && this.semesterDataPromise) {
      return this.semesterDataPromise;
    }

    const request = (async () => {
      const { data } = await this.requestJson('/admin/squad_console/get_semester_data');
      const semesters = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      if (semesters.length > 0) this.semesterDataCache = semesters;
      return semesters;
    })();
    this.semesterDataPromise = request;
    try {
      return await request;
    } finally {
      if (this.semesterDataPromise === request) this.semesterDataPromise = null;
    }
  }

  // --- HTTP API: 任务树（替代浏览器打开对话框） ---
  async fetchFilterData(squadId, termId) {
    const params = new URLSearchParams({ term_id: String(termId), squad_id: String(squadId) });
    const { data } = await this.requestJson(`/admin/squad_console/getFilterData?${params}`);
    return data;
  }

  // Full task catalog including opening and closing timestamps. This is
  // lightweight metadata and is reused by the class dashboard.
  async fetchSquadTaskCatalog(squadId, termId) {
    const params = new URLSearchParams({
      term_id: String(termId),
      squad_id: String(squadId),
      sku_id: '0',
      lesson_name: '全部',
    });
    const { data } = await this.requestJson(`/admin/squad_task/getTableData?${params}`);
    if (Number(data?.code) !== 1 || !Array.isArray(data?.data)) {
      throw new Error('教务任务目录读取失败，请稍后重试');
    }
    return data.data.flatMap((section) => (
      Array.isArray(section?.task)
        ? section.task.map((task) => ({ ...task, catalogGroup: String(section?.name || '').trim() }))
        : []
    ));
  }

  async fetchTeacherScheduleEvents({ startDate, endDate } = {}) {
    const params = new URLSearchParams();
    if (startDate) params.set('start', String(startDate));
    if (endDate) params.set('end', String(endDate));
    const { response, data } = await this.requestJson(
      `/admin/crousesheet/teacher/getSchedul?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`老师课表读取失败 (HTTP ${response.status})`);
    }
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    if (Number(data?.code) === 0 && !Array.isArray(data?.data)) {
      throw new Error(String(data?.msg || '老师课表读取失败'));
    }
    return rows;
  }

  async fetchAdjacentTaskCycles({
    semesters,
    squadId,
    preferredYear,
    preferredSemester,
    currentTermId,
    now = new Date(),
  }) {
    const adjacent = this.selectSemester(semesters, {
      preferredYear,
      preferredSemester,
      semesterMode: 'previous',
    });
    const adjacentTermId = adjacent?.id || adjacent?.term_id;
    if (!adjacentTermId || String(adjacentTermId) === String(currentTermId)) return [];

    const catalog = await this.fetchSquadTaskCatalog(squadId, adjacentTermId);
    const nowMs = new Date(now).getTime();
    const lookAheadMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    const candidateRows = catalog.filter((row) => {
      const start = parseOfficialDateTime(row?.start_at);
      const end = parseOfficialDateTime(row?.end_at);
      return start && end && end.getTime() > nowMs && start.getTime() <= lookAheadMs;
    });
    if (candidateRows.length === 0) return [];

    const candidateIds = new Set(candidateRows.map((row) => String(row?.id || '').trim()).filter(Boolean));
    const filterData = await this.fetchFilterData(squadId, adjacentTermId);
    return this.parseFilterDataToTaskGroups(
      filterData,
      String(adjacent?.name || ''),
      candidateRows,
    ).filter((group) => candidateIds.has(String(group?.officialTaskId || '').trim()));
  }

  // --- HTTP API: 学生完成数据（替代浏览器读表格） ---
  async fetchStudentPersonFilter(squadId, checkedTaskIds, isExport = 0) {
    const params = new URLSearchParams({ squad_id: String(squadId), isExport: String(isExport) });
    for (const taskId of checkedTaskIds) {
      params.append('checkedTask[]', String(taskId));
    }
    const { data } = await this.requestJson(`/admin/squad_console/getStudentPersonFilter?${params}`);
    return data;
  }

  // --- HTTP API: 每日打卡导出（Excel with per-day columns） ---
  // dateRange must be array of ['YYYY.MM.DD', 'YYYY.MM.DD'] (dot-separated, not dash)
  async fetchCheckinExport(squadId, { exportType = 2, dateRangeStart = '', dateRangeEnd = '', termId = '' } = {}) {
    const formatDotDate = (d) => String(d || '').replace(/-/g, '.');
    const params = new URLSearchParams({
      squad_id: String(squadId),
      squad_type: 'offline',
      exportType: String(exportType),
      student_id: '',
    });
    if (termId) params.set('term_id', String(termId));
    if (dateRangeStart && dateRangeEnd) {
      params.append('dateRange[]', formatDotDate(dateRangeStart));
      params.append('dateRange[]', formatDotDate(dateRangeEnd));
    }
    const response = await this.session.request(`/admin/check_every_day/exportCheckRecords?${params}`, {
      headers: { accept: 'application/json, */*', 'x-requested-with': 'XMLHttpRequest' },
    });
    return response;
  }

  extractLoginToken(...args) {
    return this.session.extractLoginToken(...args);
  }

  isLoginPage(...args) {
    return this.session.isLoginPage(...args);
  }

  getDecodedCookieValue(...args) {
    return this.session.getDecodedCookieValue(...args);
  }

  extractClassMapFromHtml(html = '') {
    return parseClassMapFromHtml(html);
  }

  async extractClassMapViaBrowser() {
    return this.runBrowserTask('class-map-fallback', async () => {
      await this.ensurePageReady();
      await this.page.goto(`${this.baseUrl}/admin`, { waitUntil: 'networkidle2', timeout: 15000 });
      try {
        await this.page.waitForSelector('a[href*="squad_console"]', { timeout: 3000 });
      } catch {
        // Links didn't appear in time, proceed anyway
      }

      const entries = await this.page.evaluate(() => {
        const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const codePattern = /\b([A-Z]{1,2}\d{1,3})\b/i;
        const rows = [];

        const collectCandidate = (href = '', text = '') => {
          if (!href) return null;
          const full = href.startsWith('http') ? href : new URL(href, window.location.origin).toString();
          const url = new URL(full);
          const squadId = url.searchParams.get('id') || url.searchParams.get('squad_id');
          if (!squadId) return null;

          const hit = normalize(text).match(codePattern);
          if (!hit?.[1]) return null;
          return { classCode: hit[1].toUpperCase(), squadId: String(squadId) };
        };

        const links = Array.from(document.querySelectorAll('a[href]'));
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const texts = [
            normalize(link.textContent),
            normalize(link.parentElement?.textContent),
            normalize(link.closest('.small-box, .box, .panel, .col-md-3, .col-sm-3, .col-xs-6, li, tr')?.textContent),
          ].filter(Boolean);

          for (const text of texts) {
            const entry = collectCandidate(href, text);
            if (entry) {
              rows.push(entry);
              break;
            }
          }
        }

        const dedup = new Map();
        for (const row of rows) {
          dedup.set(`${row.classCode}_${row.squadId}`, row);
        }

        return Array.from(dedup.values());
      });

      return Array.isArray(entries) ? entries : [];
    });
  }

  getPuppeteerCookies() {
    return this.session.getPuppeteerCookies();
  }

  async hydrateBrowserCookies() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('浏览器页面不可用，无法恢复登录态');
    }

    const cookies = this.getPuppeteerCookies();
    if (cookies.length === 0) {
      throw new Error('当前没有可用的登录会话，请先调用login()');
    }
    await this.page.setCookie(...cookies);
  }

  async hydrateBrowserSession() {
    await this.hydrateBrowserCookies();
    await this.page.goto(`${this.baseUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await this.page.content();
    if (this.isLoginPage(html, this.page.url())) {
      throw new Error('登录状态已失效，请重新登录');
    }

    this.browserSessionReady = true;
  }

  async getClassMap(forceRefresh = false, options = {}) {
    if(options.authorization)return readAgentPermissionMap(this,options.signal);
    if (!forceRefresh && this.classMapCache.length > 0) {
      this.classMapCache = applyCoHeadTeacherClasses(this.classMapCache, this.username);
      this.lastClassMapTiming = {
        cacheHit: true,
        fetchMs: 0,
        parseMs: 0,
        totalMs: 0,
      };
      return this.classMapCache;
    }

    const startedAt = performance.now();

    // /admin/my_squad 只覆盖当前班主任；首页 dashboard 还会列出换班主任后
    // 仍可管理的线下班。两者必须合并，课表不能作为归属来源。
    let map = [];
    try {
      const { response: mySquadResp, text: mySquadHtml } = await this.requestText('/admin/my_squad', {
        headers: { accept: 'text/html' },
      });
      if (mySquadResp.ok && !this.isLoginPage(mySquadHtml, mySquadResp.url)) {
        map = extractMySquadClassMap(mySquadHtml);
      }
      if (map.length > 0) {
        console.log(`✅ /admin/my_squad 快速解析: ${map.length} 个班级 (${Number((performance.now() - startedAt).toFixed(0))}ms)`);
      }
    } catch (e) {
      console.warn('⚠️ /admin/my_squad 请求失败:', e.message);
    }
    const mySquadAt = performance.now();

    // 始终读取首页：补齐非当前班主任、但教务仍授权管理的线下班。
    try {
      const { response, text } = await this.requestText('/admin', {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`获取班级页失败 (HTTP ${response.status})`);
      }

      if (this.isLoginPage(text, response.url)) {
        throw new Error('登录状态已失效，请重新登录');
      }

      const tutorId = extractDashboardTutorId(text);
      if (tutorId) {
        const { response: dashboardResponse, data } = await this.requestJson(
          `/admin/dashboard/getSquadData?id=${encodeURIComponent(tutorId)}`,
        );
        if (dashboardResponse.ok) {
          map = dedupeClassMap([...map, ...extractDashboardClassMap(data)]);
        }
      } else if (map.length === 0) {
        map = this.extractClassMapFromHtml(text);
      }
    } catch (error) {
      if (map.length === 0) throw error;
      console.warn('⚠️ 首页可管理班级补充失败，保留当前班主任列表:', error.message);
    }
    const parsedAt = performance.now();

    // 最后兜底：Puppeteer（尽量避免）
    if (map.length === 0) {
      try {
        const browserStartedAt = performance.now();
        const browserMap = await this.extractClassMapViaBrowser();
        const browserFinishedAt = performance.now();
        if (browserMap.length > 0) {
          map = browserMap;
          this.lastClassMapTiming = {
            cacheHit: false,
            fetchMs: Number((mySquadAt - startedAt).toFixed(1)),
            parseMs: Number((parsedAt - mySquadAt).toFixed(1)),
            totalMs: Number((browserFinishedAt - startedAt).toFixed(1)),
            browserFallbackMs: Number((browserFinishedAt - browserStartedAt).toFixed(1)),
            classCount: map.length,
          };
        }
      } catch (error) {
        console.warn('⚠️ 班级静态解析为空，浏览器兜底也失败:', error.message);
      }
    }

    map = applyCoHeadTeacherClasses(map, this.username);
    this.classMapCache = map;
    this.classMapCacheAt = Date.now();
    if (!this.lastClassMapTiming || this.lastClassMapTiming.classCount !== map.length) {
      this.lastClassMapTiming = {
        cacheHit: false,
        fetchMs: Number((mySquadAt - startedAt).toFixed(1)),
        parseMs: Number((parsedAt - mySquadAt).toFixed(1)),
        totalMs: Number((parsedAt - startedAt).toFixed(1)),
        classCount: map.length,
      };
    }
    return map;
  }

  async resolveSquadId(classId) {
    const raw = String(classId || '').trim();
    if (!raw) {
      throw new Error('班级ID为空');
    }

    if (/^\d+$/.test(raw)) {
      return { classCode: '', squadId: raw };
    }

    const targetCode = raw.toUpperCase();
    let map = await this.getClassMap(false);
    let hit = map.find((item) => item.classCode === targetCode);

    if (!hit) {
      map = await this.getClassMap(true);
      hit = map.find((item) => item.classCode === targetCode);
    }

    if (!hit) {
      throw new Error(`未找到班级 ${targetCode} 对应的系统ID`);
    }

    return { classCode: hit.classCode, squadId: hit.squadId };
  }

  async gotoSquadConsole(classId) {
    await this.ensurePageReady();
    const { classCode, squadId } = await this.resolveSquadId(classId);
    const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await this.sleep(1200);
    return { classCode, squadId, url };
  }

  async openTaskDropdown() {
    const opened = await this.page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0);
      };

      const input = Array.from(document.querySelectorAll('input')).find(
        (el) => isVisible(el) && (el.placeholder || '').includes('请选择任务')
      );
      if (!input) return false;

      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      input.click();
      return true;
    });

    if (opened) {
      await this.sleep(700);
    }
    return opened;
  }

  async readTaskDropdownOptions() {
    return this.page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

      const rawItems = Array.from(
        document.querySelectorAll('.el-select-dropdown__item, .el-option, .el-tree-node__label, li')
      )
        .map((el) => normalize(el.textContent))
        .filter(Boolean);

      const currentTask =
        Array.from(document.querySelectorAll('input'))
          .find((el) => (el.placeholder || '').includes('请选择任务'))
          ?.value || '';

      const dedup = [];
      const seen = new Set();
      for (const item of rawItems) {
        if (seen.has(item)) continue;
        seen.add(item);
        dedup.push(item);
      }

      return { currentTask: normalize(currentTask), options: dedup };
    });
  }

  async selectTaskOption(taskText) {
    const target = String(taskText || '').trim();
    if (!target) return false;

    const opened = await this.openTaskDropdown();
    if (!opened) return false;

    const clicked = await this.page.evaluate((wanted) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const wantedNorm = normalize(wanted);
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0);
      };

      const items = Array.from(document.querySelectorAll('.el-select-dropdown__item, .el-option')).filter((el) =>
        isVisible(el)
      );
      const exact =
        items.find((el) => normalize(el.textContent) === wantedNorm) ||
        items.find((el) => normalize(el.textContent).includes(wantedNorm)) ||
        items.find((el) => wantedNorm.includes(normalize(el.textContent)));

      if (!exact) return false;
      exact.click();
      return true;
    }, target);

    if (clicked) {
      await this.sleep(1500);
    }
    return clicked;
  }

  async openStudentPersonDialog(preferredYear = '2025', preferredSemester = '') {
    const selectedSemester = preferredSemester || `${preferredYear}学年秋季学期`;

    const activated = await this.page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, '').trim();
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const menu = Array.from(document.querySelectorAll('.menu-item-btn')).find(
        (el) => isVisible(el) && normalize(el.textContent || '').includes('学生个人数据')
      );
      if (menu) {
        menu.click();
        return 'menu-clicked';
      }

      // A slow squad-console navigation may restore the last active panel.
      // When its query button is already visible there is no menu entry left
      // to click, but the panel is ready for the next step.
      const queryButton = Array.from(document.querySelectorAll('button.screen-query')).find((el) => isVisible(el));
      return queryButton ? 'already-active' : '';
    });
    if (!activated) {
      throw new Error('未找到“学生个人数据”入口');
    }

    if (activated === 'menu-clicked') {
      await this.sleep(900);
    }

    const openedDialog = await this.page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const btn = Array.from(document.querySelectorAll('button.screen-query')).find((el) => isVisible(el));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!openedDialog) {
      throw new Error('未找到“选择指标”按钮');
    }

    await this.sleep(1000);

    await this.page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const input = Array.from(document.querySelectorAll('.el-dialog input')).find(
        (el) => isVisible(el) && (((el.value || '').includes('学期')) || ((el.placeholder || '').includes('请选择')))
      );
      if (input) input.click();
    });
    await this.sleep(500);

    const semesterHit = await this.page.evaluate((semesterText, yearText) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const options = Array.from(document.querySelectorAll('.el-select-dropdown__item, .el-option')).filter((el) =>
        isVisible(el)
      );
      const target =
        options.find((el) => normalize(el.textContent).includes(semesterText)) ||
        options.find((el) => normalize(el.textContent).includes(`${yearText}学年秋季学期`)) ||
        options.find((el) => normalize(el.textContent).includes(`${yearText}学年春季学期`));
      if (!target) return '';
      const text = normalize(target.textContent);
      target.click();
      return text;
    }, selectedSemester, preferredYear);

    await this.sleep(1000);

    await this.page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const sw = Array.from(document.querySelectorAll('.el-dialog .el-switch')).find((el) => isVisible(el));
      if (sw && !sw.className.includes('is-checked')) {
        sw.click();
      }
    });

    await this.sleep(1000);

    for (let i = 0; i < 6; i += 1) {
      const collapsedCount = await this.page.evaluate(() => {
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const icons = Array.from(document.querySelectorAll('.el-dialog .el-tree-node__expand-icon')).filter(
          (el) => isVisible(el) && !el.className.includes('is-leaf') && !el.className.includes('expanded')
        );
        icons.slice(0, 100).forEach((icon) => icon.click());
        return icons.length;
      });
      await this.sleep(450);
      if (collapsedCount === 0) break;
    }

    return semesterHit || selectedSemester;
  }

  async openStudentPersonDialogWithRecovery(url, preferredYear = '2025', preferredSemester = '') {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.ensurePageReady();
        return await this.openStudentPersonDialog(preferredYear, preferredSemester);
      } catch (error) {
        const message = error?.message || '';
        lastError = error;
        if (!message.includes('detached Frame') && !message.includes('Navigation timeout')) {
          throw error;
        }
        if (attempt === 3) {
          throw error;
        }
        await this.replaceBrowserPage();
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.sleep(1500);
      }
    }
    throw lastError || new Error('打开学生个人数据弹窗失败');
  }

  async readStudentPersonDialogTasks() {
    return this.page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const cleanLabel = (text) => normalize(text).replace(/\s*添加人:.*/, '').trim();
      const extractWeekName = (text) => {
        const cleaned = cleanLabel(text);
        const weekMatch = cleaned.match(/Week\s*\d+/i);
        if (weekMatch?.[0]) return weekMatch[0].replace(/\s+/g, '');
        const chineseWeekMatch = cleaned.match(/第\s*\d+\s*周/);
        if (chineseWeekMatch?.[0]) return chineseWeekMatch[0].replace(/\s+/g, '');
        return cleaned;
      };
      const isWeekNode = (text) => {
        const cleaned = cleanLabel(text);
        return /Week\s*\d+/i.test(cleaned) || /第\s*\d+\s*周/.test(cleaned) || cleaned.includes('任务时间:');
      };
      const getDirectLabel = (node) => cleanLabel(
        node.querySelector(':scope > .el-tree-node__content .el-tree-node__label')?.textContent || ''
      );
      const getDirectChildren = (node) => (
        Array.from(node.querySelectorAll(':scope > .el-tree-node__children > .el-tree-node')).filter((child) => isVisible(child))
      );

      function collectLeafTasks(node) {
        const children = getDirectChildren(node);
        const tasks = [];

        for (const child of children) {
          const label = getDirectLabel(child);
          const grandChildren = getDirectChildren(child);
          if (!label) continue;
          if (isWeekNode(label)) continue;
          if (grandChildren.length === 0) {
            tasks.push(label);
            continue;
          }

          const nested = collectLeafTasks(child);
          if (nested.length > 0) {
            tasks.push(...nested);
          } else {
            tasks.push(label);
          }
        }

        return [...new Set(tasks.map((item) => cleanLabel(item)).filter(Boolean))];
      }

      const groups = [];
      const seen = new Set();

      function walk(nodes) {
        for (const node of nodes) {
          const label = getDirectLabel(node);
          const children = getDirectChildren(node);
          if (!label) {
            if (children.length > 0) walk(children);
            continue;
          }

          if (isWeekNode(label)) {
            const weekName = extractWeekName(label);
            const tasks = collectLeafTasks(node);
            const key = `${weekName}__${tasks.join('|')}`;
            if (!seen.has(key)) {
              groups.push({
                id: weekName,
                name: weekName,
                sourceLabel: label,
                resourceCount: tasks.length || 1,
                tasks: tasks.length > 0 ? tasks : [label],
              });
              seen.add(key);
            }
            continue;
          }

          if (children.length > 0) {
            walk(children);
          }
        }
      }

      const roots = Array.from(document.querySelectorAll('.el-dialog .el-tree > .el-tree-node')).filter((node) => isVisible(node));
      walk(roots);
      return groups;
    });
  }

  async applySelectedTasksFromDialog(selectedTasks) {
    const wanted = Array.isArray(selectedTasks)
      ? [...new Set(selectedTasks.map((task) => String(task || '').trim()).filter(Boolean))]
      : [];

    if (wanted.length === 0) {
      return { matched: [], missing: [] };
    }

    const result = await this.page.evaluate((targets) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const nodes = Array.from(document.querySelectorAll('.el-dialog .el-tree-node')).filter((node) => isVisible(node));

      // Clear all current checked nodes first to make the selection deterministic.
      nodes.forEach((node) => {
        const checkbox = node.querySelector('.el-checkbox');
        if (checkbox?.className.includes('is-checked')) {
          checkbox.click();
        }
      });

      const matched = [];
      const missing = [];
      const normalizedNodes = nodes.map((node) => ({
        node,
        text: normalize(node.querySelector('.el-tree-node__label')?.textContent || ''),
      }));

      targets.forEach((target) => {
        const hit = normalizedNodes.find((item) => item.text === target)
          || normalizedNodes.find((item) => item.text.includes(target))
          || normalizedNodes.find((item) => target.includes(item.text));

        if (!hit) {
          missing.push(target);
          return;
        }

        const checkbox = hit.node.querySelector('.el-checkbox');
        if (!checkbox) {
          missing.push(target);
          return;
        }

        if (!checkbox.className.includes('is-checked')) {
          checkbox.click();
        }
        matched.push(hit.text);
      });

      return { matched, missing };
    }, wanted);

    await this.sleep(500);
    return result;
  }

  async applyPreparedTaskSelectionFromDialog(selectedWeekLabels, selectedTasks) {
    const parentTargets = Array.isArray(selectedWeekLabels)
      ? [...new Set(selectedWeekLabels.map((item) => String(item || '').trim()).filter(Boolean))]
      : [];
    const leafTargets = Array.isArray(selectedTasks)
      ? [...new Set(selectedTasks.map((item) => String(item || '').trim()).filter(Boolean))]
      : [];

    // The HTTP task catalog can expose resource names while the browser dialog
    // only exposes the parent assignment row. Selecting that parent is also the
    // most faithful way to include every resource in the chosen task package.
    if (parentTargets.length > 0) {
      const parentResult = await this.applySelectedTasksFromDialog(parentTargets);
      if (parentResult.matched.length > 0) {
        return { ...parentResult, strategy: 'parent-task' };
      }
    }

    const leafResult = await this.applySelectedTasksFromDialog(leafTargets);
    return { ...leafResult, strategy: 'resource-task' };
  }

  async navigateToSquadConsole(url, { timeout = 30000 } = {}) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return { recoveredFromTimeout: false };
    } catch (error) {
      if (!String(error?.message || '').includes('Navigation timeout')) {
        throw error;
      }

      // CNF's squad console can render the Vue controls while a slow secondary
      // resource keeps DOMContentLoaded pending. In that case Puppeteer reports
      // a timeout even though the page is already safe to use.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const state = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return {
            href: window.location.href,
            ready: Boolean(document.querySelector('.menu-item-btn, button.screen-query'))
              || bodyText.includes('学生个人数据'),
            login: document.title.includes('登录') || bodyText.includes('账号登录'),
          };
        }).catch(() => ({ href: '', ready: false, login: false }));
        if (state.login) {
          throw new Error('登录已失效，请重新登录');
        }
        if (state.ready && String(state.href).includes('/admin/squad_console')) {
          console.warn('⚠️ 班级页导航事件超时，但页面控件已就绪，继续读取');
          return { recoveredFromTimeout: true };
        }
        await this.sleep(500);
      }
      throw error;
    }
  }

  async confirmStudentPersonDialog() {
    const confirmed = await this.page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, '').trim();
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const btn = Array.from(document.querySelectorAll('.el-dialog button')).find(
        (el) => isVisible(el) && normalize(el.textContent || '').includes('确定')
      );
      if (!btn) return false;
      btn.click();
      return true;
    });

    if (!confirmed) {
      throw new Error('未找到指标弹窗的“确定”按钮');
    }

    await this.sleep(2000);
    return true;
  }

  /**
   * 登录到教务系统
   */
  async login() {
    try {
      if (!this.username || !this.password) {
        throw new Error('缺少用户名或密码');
      }

      this.session.clear();
      this.classMapCache = [];
      this.classMapCacheAt = 0;
      this.browserSessionReady = false;

      console.log('🔄 正在通过HTTP登录教务系统...');
      const startedAt = performance.now();

      const { response: loginPageResponse, text: loginPageHtml } = await this.requestText('/admin/auth/login', {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const loginPageAt = performance.now();

      if (!loginPageResponse.ok) {
        throw new Error(`加载登录页失败 (HTTP ${loginPageResponse.status})`);
      }

      const csrfToken = this.extractLoginToken(loginPageHtml);
      if (!csrfToken) {
        throw new Error('无法从登录页提取 CSRF Token');
      }

      const xsrfToken = this.getDecodedCookieValue('XSRF-TOKEN');
      const loginResponse = await this.request('/admin/auth/login', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          origin: this.baseUrl,
          referer: `${this.baseUrl}/admin/auth/login`,
          'x-requested-with': 'XMLHttpRequest',
          ...(xsrfToken ? { 'x-xsrf-token': xsrfToken } : {}),
        },
        body: new URLSearchParams({
          username: this.username,
          password: this.password,
          remember: 'false',
          _token: csrfToken,
        }).toString(),
      });

      const raw = await loginResponse.text();
      const loginPostedAt = performance.now();
      let result;
      try {
        result = JSON.parse(raw);
      } catch (parseError) {
        throw new Error(`登录接口返回异常: ${raw.slice(0, 200)}`);
      }

      if (!loginResponse.ok) {
        throw new Error(result.msg || `登录请求失败 (HTTP ${loginResponse.status})`);
      }

      if (String(result.code) === '0') {
        throw new Error(result.msg || '登录失败');
      }

      this.lastLoginTiming = {
        loginPageMs: Number((loginPageAt - startedAt).toFixed(1)),
        postLoginMs: Number((loginPostedAt - loginPageAt).toFixed(1)),
        totalMs: Number((loginPostedAt - startedAt).toFixed(1)),
      };
      console.log('✅ HTTP登录成功，已保存会话cookies');

      return this.cookies;
    } catch (error) {
      console.error('❌ 登录失败:', error);
      throw error;
    }
  }

  /**
   * 爬取班级学生名单
   */
  async scrapeStudentList(classId) {
    return this.runBrowserTask(`student-list:${classId}`, async () => {
      try {
        await this.ensurePageReady();

        const url = `${this.baseUrl}/admin/st_manage/index?squad_id=${classId}&squad_name=temp`;
        console.log(`🔄 正在爬取班级${classId}的学生名单...`);

        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });

        const students = await this.page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          return rows.map((row) => {
            const cells = row.querySelectorAll('td');
            return {
              studentId: cells[0]?.textContent?.trim(),
              name: cells[1]?.textContent?.trim(),
              status: cells[2]?.textContent?.trim() || 'active',
              enrollmentDate: cells[3]?.textContent?.trim(),
            };
          }).filter((student) => student.name);
        });

        console.log(`✅ 成功爬取${students.length}名学生`);
        return students;
      } catch (error) {
        console.error('❌ 爬取学生名单失败:', error);
        throw error;
      }
    });
  }

  /**
   * 爬取班级考勤数据
   */
  async scrapeAttendanceData(classId) {
    return this.runBrowserTask(`attendance:${classId}`, async () => {
      try {
        await this.ensurePageReady();

        const { classCode, squadId } = await this.resolveSquadId(classId);
        const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
        console.log(`🔄 正在爬取班级${classCode || classId}(id=${squadId})的考勤数据...`);

        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await this.page.click('a[href*="考勤"]');
        await this.page.waitForTimeout(1000);

        const attendanceData = await this.page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          return rows.map((row) => {
            const cells = row.querySelectorAll('td');
            return {
              name: cells[0]?.textContent?.trim(),
              absenceCount: parseInt(cells[1]?.textContent || 0, 10),
              lateCount: parseInt(cells[2]?.textContent || 0, 10),
              attendanceRate: parseFloat(cells[3]?.textContent || 1),
            };
          }).filter((item) => item.name);
        });

        console.log(`✅ 成功爬取${attendanceData.length}条考勤记录`);
        return attendanceData;
      } catch (error) {
        console.error('❌ 爬取考勤数据失败:', error);
        throw error;
      }
    });
  }

  /**
   * 爬取班级作业完成情况
   */
  async scrapeHomeworkData(classId) {
    return this.runBrowserTask(`homework:${classId}`, async () => {
      try {
        await this.ensurePageReady();

        const { classCode, squadId } = await this.resolveSquadId(classId);
        const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
        console.log(`🔄 正在爬取班级${classCode || classId}(id=${squadId})的作业数据...`);

        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await this.page.click('a[href*="作业"]');
        await this.page.waitForTimeout(1000);

        const homeworkData = await this.page.evaluate(() => {
          const assignments = Array.from(document.querySelectorAll('.assignment-item'));
          return assignments.map((item) => ({
            homeworkName: item.querySelector('.title')?.textContent?.trim(),
            completionRate: parseFloat(item.querySelector('.completion')?.textContent || 0),
            dueDate: item.querySelector('.due-date')?.textContent?.trim(),
          })).filter((item) => item.homeworkName);
        });

        console.log(`✅ 成功爬取${homeworkData.length}条作业数据`);
        return homeworkData;
      } catch (error) {
        console.error('❌ 爬取作业数据失败:', error);
        throw error;
      }
    });
  }

  async scrapeCheckinSummaryFromSquadConsole(classId) {
    return this.runBrowserTask(`checkin-summary:${classId}`, async () => {
      try {
        await this.ensurePageReady();

      const { classCode, squadId } = await this.resolveSquadId(classId);
      const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
      console.log(`🔄 正在抓取班级${classCode || classId}(id=${squadId})打卡汇总表...`);

      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(1200);

      const clickTabIfExists = async (keyword) => {
        const clicked = await this.page.evaluate((kw) => {
          const norm = (s) => (s || '').replace(/\s+/g, '').trim();
          const target = norm(kw);
          const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, .tab, li, span, div'));
          const hit = nodes.find((node) => {
            const text = norm(node.textContent || '');
            if (!text || !text.includes(target)) return false;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
          if (!hit) return false;
          hit.click();
          return true;
        }, keyword);
        if (clicked) await this.sleep(900);
        return clicked;
      };

      const parseBestCheckinTable = async () => this.page.evaluate(() => {
        const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const isStudentNo = (value) => /^\d{4,}$/.test(String(value || '').trim());

        const tables = Array.from(document.querySelectorAll('table')).filter((table) => isVisible(table));
        const parsedTables = tables.map((table, index) => {
          const rows = Array.from(table.querySelectorAll('tr'))
            .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalize(cell.innerText)))
            .filter((row) => row.some(Boolean));
          if (rows.length < 2) return null;

          const width = Math.max(...rows.map((row) => row.length), 0);
          const paddedRows = rows.map((row) => {
            const copy = [...row];
            while (copy.length < width) copy.push('');
            return copy;
          });

          let headerRowIndex = paddedRows.findIndex((row) => row.some((cell) => cell.includes('学号')) && row.some((cell) => cell.includes('总计')));
          if (headerRowIndex < 0) {
            headerRowIndex = paddedRows.findIndex((row) => row.some((cell) => cell.includes('总打卡') || cell.includes('打卡总数')));
          }
          if (headerRowIndex < 0) headerRowIndex = 0;

          const header = paddedRows[headerRowIndex].join('|');
          const dataRows = paddedRows.slice(headerRowIndex + 1);
          const studentLikeRowCount = dataRows.filter((row) => row.some((cell) => isStudentNo(cell))).length;

          let score = 0;
          if (header.includes('学号')) score += 6;
          if (header.includes('总计') || header.includes('总打卡') || header.includes('打卡总数')) score += 7;
          if (header.includes('中文') || header.includes('姓名')) score += 4;
          if (header.includes('补卡')) score += 2;
          if (header.includes('正常')) score += 2;
          if (studentLikeRowCount > 0) score += 6;
          score += Math.min(dataRows.length, 40) / 10;

          return {
            index,
            rows: paddedRows,
            headerRowIndex,
            rowCount: paddedRows.length,
            colCount: width,
            header,
            studentLikeRowCount,
            score,
          };
        }).filter(Boolean);

        parsedTables.sort((a, b) => b.score - a.score);
        return { best: parsedTables[0] || null, candidateCount: parsedTables.length };
      });

      let parsed = await parseBestCheckinTable();
      for (const keyword of ['每日打卡', '打卡汇总', '打卡', '汇总', '考勤']) {
        if (parsed.best && parsed.best.score >= 14 && parsed.best.studentLikeRowCount > 0) break;
        await clickTabIfExists(keyword);
        parsed = await parseBestCheckinTable();
      }

      if (!parsed.best || parsed.best.score < 14 || parsed.best.studentLikeRowCount <= 0) {
        throw new Error('未在 squad_console 页面识别到可用的打卡汇总表');
      }

      const bestRows = parsed.best.rows;
      const headerRowIndex = parsed.best.headerRowIndex || 0;
      const headerRow = bestRows[headerRowIndex] || [];
      const findColumn = (matcher) => headerRow.findIndex((cell) => matcher(String(cell || '').trim()));

      const colNo = findColumn((cell) => cell.includes('学号') || cell.toLowerCase() === 'no');
      const colName = findColumn((cell) => cell.includes('中文') || cell.includes('姓名') || cell.includes('学生'));
      const colTotal = findColumn((cell) => cell === '总计' || cell.includes('总打卡') || cell.includes('打卡总数'));
      const colNormal = findColumn((cell) => cell.includes('正常'));
      const colSupplement = findColumn((cell) => cell.includes('补卡'));

      if (colNo < 0 || colTotal < 0) {
        throw new Error('打卡汇总表缺少“学号”或“总计”列');
      }

      const toInt = (value) => {
        const matched = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return matched ? Math.round(Number(matched[0])) : 0;
      };

      const rows = bestRows
        .slice(headerRowIndex + 1)
        .map((row) => {
          const no = String(row[colNo] || '').trim();
          if (!/^\d{4,}$/.test(no)) return null;
          const total = toInt(row[colTotal]);
          const supplement = colSupplement >= 0 ? toInt(row[colSupplement]) : 0;
          const normal = colNormal >= 0 ? toInt(row[colNormal]) : Math.max(0, total - supplement);
          return {
            no,
            ch_name: colName >= 0 ? String(row[colName] || '').trim() : '',
            all_check_days: total,
            normal_record_total: normal,
            supplement_times: supplement,
          };
        })
        .filter(Boolean);

      if (rows.length === 0) {
        throw new Error('打卡汇总表里没有识别到学生数据行');
      }

        console.log(`✅ 打卡汇总表抓取成功: table#${parsed.best.index}, ${rows.length}名学生`);
        return {
          classId: classCode || classId,
          squadId,
          rows,
          meta: {
            tableIndex: parsed.best.index,
            rowCount: parsed.best.rowCount,
            colCount: parsed.best.colCount,
            candidateCount: parsed.candidateCount,
            transport: 'browser',
          },
        };
      } catch (error) {
        console.error('❌ 抓取打卡汇总表失败:', error);
        throw error;
      }
    });
  }

  /**
   * 爬取作业公示导出表（用于自动生成榜单）
   */
  async scrapePublicityExportDataViaBrowser(classId, options = {}) {
    return this.runBrowserTask(`publicity-export:${classId}`, async () => {
      let captureHandler = null;
      try {
        const { classCode, squadId } = await this.resolveSquadId(classId);
        const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
        // This task always navigates directly to the squad console below. On a
        // freshly restored process, installing the saved cookies is enough;
        // visiting the heavy /admin dashboard first can hang for 30 seconds.
        await this.ensurePageReady({ skipHydrationNavigation: true });

      // --- API Discovery: capture XHR/fetch responses ---
      const apiCalls = [];
      captureHandler = async (response) => {
        const url = response.url();
        if (!url.includes('/admin/') && !url.includes('/api/')) return;
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json') && !contentType.includes('html')) return;
        try {
          const body = await response.text().catch(() => '');
          apiCalls.push({
            url: url.replace(/https?:\/\/[^/]+/, ''),
            method: response.request().method(),
            status: response.status(),
            contentType,
            bodyPreview: body.substring(0, 500),
          });
        } catch {}
      };
      this.page.on('response', captureHandler);
      // --- end API Discovery setup ---

      console.log(`🔄 正在抓取班级${classCode || classId}(id=${squadId})公示导出表...`);
      const selectedTasks = Array.isArray(options.selectedTasks)
        ? options.selectedTasks.filter(Boolean)
        : [];
      const selectedWeekLabels = Array.isArray(options.selectedWeekLabels)
        ? options.selectedWeekLabels.filter(Boolean)
        : [];

      const getTargetTabs = () => {
        if (selectedTasks.length === 0) {
          return ['学生个人数据', '学生中心任务统计', '小挑战'];
        }

        const tabs = ['学生个人数据'];
        const joined = selectedTasks.join('|');
        if (joined.includes('My Week') || joined.includes('词王')) tabs.push('学生中心任务统计');
        if (joined.includes('挑战')) tabs.push('小挑战');
        if (joined.includes('周一') || joined.includes('周三') || joined.includes('周四') || joined.includes('周五')) {
          tabs.push('作业');
        }
        return [...new Set(tabs)];
      };

      const isReadyPublicityTable = (best) => {
        if (!best || best.studentLikeRowCount <= 0 || best.rowCount < 4) {
          return false;
        }
        const header = String(best.header || '');
        const hasBaseHeader =
          header.includes('学号') &&
          (header.includes('中文') || header.includes('中文名')) &&
          (header.includes('英文') || header.includes('英文名'));
        return hasBaseHeader || String(best.index).includes('+');
      };

      const parseBestTable = async () => {
        return this.page.evaluate(() => {
          const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const bodyText = document.body.innerText || '';
          const weekMatch = bodyText.match(/第\s*(\d{1,2})\s*周/);
          const title = document.title || '';
          const hasErrorPage =
            title.includes('Whoops') ||
            bodyText.includes('UnexpectedValueException') ||
            bodyText.includes('Permission denied');

          const tables = Array.from(document.querySelectorAll('table'));
          const parsedTables = tables
            .map((table, index) => {
              const rowEls = Array.from(table.querySelectorAll('tr'));
              const rows = rowEls
                .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalize(cell.innerText)))
                .filter((row) => row.some(Boolean));

              if (rows.length < 2) return null;

              const width = Math.max(...rows.map((r) => r.length), 0);
              const paddedRows = rows.map((r) => {
                const copy = [...r];
                while (copy.length < width) copy.push('');
                return copy;
              });

              const header = paddedRows[0].join('|');
              const studentLikeRowCount = paddedRows.filter((row) => /^\d{4,}$/.test(row[0] || '') && /^\d{6,}$/.test(row[1] || '')).length;
              let score = 0;
              if (header.includes('中文')) score += 4;
              if (header.includes('英文')) score += 3;
              if (header.includes('My Week') || header.includes('词王')) score += 4;
              if (header.includes('周一') || header.includes('周末')) score += 2;
              if (header.includes('Key|Value')) score -= 100;
              if (studentLikeRowCount > 0) score += 8;
              if (paddedRows.length <= 3 && studentLikeRowCount === 0) score -= 6;
              score += Math.min(paddedRows.length, 40) / 10;

              return {
                index,
                rows: paddedRows,
                rowCount: paddedRows.length,
                colCount: width,
                header,
                studentLikeRowCount,
              };
            })
            .filter(Boolean);

          const candidates = parsedTables
            .map((table) => {
              let score = 0;
              if (table.header.includes('中文')) score += 4;
              if (table.header.includes('英文')) score += 3;
              if (table.header.includes('My Week') || table.header.includes('词王')) score += 4;
              if (table.header.includes('周一') || table.header.includes('周末')) score += 2;
              if (table.header.includes('Key|Value')) score -= 100;
              if (table.studentLikeRowCount > 0) score += 8;
              if (table.rowCount <= 3 && table.studentLikeRowCount === 0) score -= 6;
              score += Math.min(table.rowCount, 40) / 10;
              return {
                ...table,
                score,
              };
            });

          // 有些任务会把表头和学生明细拆成两张连续的 table，这里自动拼接。
          for (let i = 0; i < parsedTables.length - 1; i += 1) {
            const head = parsedTables[i];
            const body = parsedTables[i + 1];
            const headRow0 = head.rows[0] || [];
            const splitHeaderLike =
              head.rowCount >= 3 &&
              headRow0.includes('学号') &&
              (headRow0.includes('中文') || headRow0.includes('中文名')) &&
              (headRow0.includes('英文') || headRow0.includes('英文名'));
            const bodyLooksLikeStudentRows =
              body.rowCount >= 8 &&
              /^\d{4,}$/.test(body.rows[0]?.[0] || '') &&
              /^\d{6,}$/.test(body.rows[0]?.[1] || '');

            if (!splitHeaderLike || !bodyLooksLikeStudentRows) continue;

            const mergedWidth = Math.max(head.colCount, body.colCount);
            const pad = (row) => {
              const copy = [...row];
              while (copy.length < mergedWidth) copy.push('');
              return copy;
            };

            const mergedRows = [...head.rows.map(pad), ...body.rows.map(pad)];
            const mergedHeader = mergedRows[0].join('|');

            candidates.push({
              index: `${head.index}+${body.index}`,
              score: 30 + Math.min(body.rowCount, 40) / 5,
              rows: mergedRows,
              rowCount: mergedRows.length,
              colCount: mergedWidth,
              header: mergedHeader,
              studentLikeRowCount: body.rowCount,
            });
          }

          candidates.sort((a, b) => b.score - a.score);

          return {
            title,
            hasErrorPage,
            week: weekMatch ? Number(weekMatch[1]) : null,
            best: candidates[0] || null,
            candidateCount: candidates.length,
          };
        });
      };

      const clickTabIfExists = async (keyword) => {
        const clicked = await this.page.evaluate((kw) => {
          const norm = (s) => (s || '').replace(/\s+/g, '').trim();
          const target = norm(kw);
          const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, .tab, li, span'));
          const hit = nodes.find((node) => {
            const text = norm(node.textContent || '');
            if (!text || !text.includes(target)) return false;
            const tag = node.tagName.toLowerCase();
            return tag === 'button' || tag === 'a' || node.hasAttribute('role') || node.className?.toString();
          });
          if (hit) {
            hit.click();
            return true;
          }
          return false;
        }, keyword);

        if (clicked) {
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        return clicked;
      };

      let gotoOk = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await this.ensurePageReady();
          await this.navigateToSquadConsole(url);
          gotoOk = true;
          break;
        } catch (error) {
          const message = error?.message || '';
          if ((!message.includes('detached Frame') && !message.includes('Navigation timeout')) || attempt === 2) {
            throw error;
          }
          await this.replaceBrowserPage();
          await this.sleep(1200);
        }
      }
      if (!gotoOk) {
        throw new Error('页面打开失败');
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));

      let selectedTaskResult = { matched: [], missing: [] };
      if (selectedTasks.length > 0) {
        await this.openStudentPersonDialogWithRecovery(url, String(options.preferredYear || '2025'));
        selectedTaskResult = await this.applyPreparedTaskSelectionFromDialog(selectedWeekLabels, selectedTasks);
        console.log(`ℹ️ 定向任务匹配: ${selectedTaskResult.matched.length} 命中, ${selectedTaskResult.missing.length} 未命中 (${selectedTaskResult.strategy})`);
        if (selectedTaskResult.matched.length === 0) {
          throw new Error('未匹配到你勾选的任务，未执行定向抓取');
        }
        await this.confirmStudentPersonDialog();
      } else if (options.preferredYear) {
        const preferredYear = String(options.preferredYear);
        const opened = await this.openTaskDropdown();
        if (opened) {
          const dropdown = await this.readTaskDropdownOptions();
          const candidate = dropdown.options.find((task) => task.includes(preferredYear));
          if (candidate) {
            await this.selectTaskOption(candidate);
          }
        }
      }

      let parsed = await parseBestTable();
      const targetTabs = getTargetTabs();
      if (selectedTasks.length > 0) {
        for (const keyword of targetTabs) {
          await clickTabIfExists(keyword);
          for (let attempt = 0; attempt < 6; attempt += 1) {
            parsed = await parseBestTable();
            const best = parsed.best;
            if (isReadyPublicityTable(best)) {
              console.log(`ℹ️ 公示抓取优先命中标签页: ${keyword}; table=${best?.index}; rows=${best?.rowCount}; cols=${best?.colCount}`);
              break;
            }
            await this.sleep(1000);
          }
          if (isReadyPublicityTable(parsed.best)) {
            break;
          }
        }
      }

      if (!parsed.best || parsed.best.score < 3 || !isReadyPublicityTable(parsed.best)) {
        for (const keyword of targetTabs) {
          await clickTabIfExists(keyword);
          parsed = await parseBestTable();
          if (selectedTasks.length > 0) {
            for (let attempt = 0; attempt < 5; attempt += 1) {
              const best = parsed.best;
              if (isReadyPublicityTable(best)) break;
              await this.sleep(1000);
              parsed = await parseBestTable();
            }
          }
          if (parsed.best && parsed.best.score >= 3 && isReadyPublicityTable(parsed.best)) {
            break;
          }
        }
      }

      if (parsed.hasErrorPage) {
        throw new Error('系统页面异常（错误页），请稍后重试');
      }

      if (!parsed.best || !parsed.best.rows || parsed.best.rows.length < 2) {
        throw new Error('未在页面上识别到可用的导出表格');
      }

      const headerText = (parsed.best.rows[0] || []).join('|');
      const looksLikePublicityTable = ['中文', '英文', 'My Week', '词王', '周一', '周末'].some((k) =>
        headerText.includes(k)
      );
      if (!looksLikePublicityTable) {
        throw new Error('未识别到公示导出表，请确认系统页面可正常打开');
      }

        console.log(
          `✅ 公示表抓取成功: table#${parsed.best.index}, ${parsed.best.rowCount}行 x ${parsed.best.colCount}列`
        );

        // --- API Discovery: log summary ---
        if (captureHandler) this.page.off('response', captureHandler);
        if (apiCalls.length > 0) {
          console.log('[API-DISCOVERY] Captured API calls during export data scraping:');
          for (const call of apiCalls) {
            console.log(`  ${call.method} ${call.url} (${call.status}) ${call.contentType}`);
            if (call.bodyPreview) console.log(`    preview: ${call.bodyPreview.substring(0, 200)}`);
          }
        }
        // --- end API Discovery summary ---

        return {
          classId: classCode || classId,
          squadId,
          week: parsed.week,
          tableRows: parsed.best.rows,
          selectedTaskResult,
          meta: {
            tableIndex: parsed.best.index,
            rowCount: parsed.best.rowCount,
            colCount: parsed.best.colCount,
            candidateCount: parsed.candidateCount,
            transport: 'browser',
          },
        };
      } catch (error) {
        if (captureHandler) this.page?.off('response', captureHandler);
        console.error('❌ 抓取公示导出表失败:', error);
        throw error;
      }
    });
  }

  /**
   * 从 getFilterData 任务树中收集叶子节点 ID 和 ID→名称映射
   * selectedTaskNames: 选中周内的任务名称列表
   * selectedWeekLabel: 选中周的完整标签（如 "Party Time2/3 任务时间:2026-04-06 21:29:12"）
   *                    用于精确定位该周的子树，避免同名任务跨周误匹配
   */
  collectTaskIdsFromFilterData(filterData, selectedTaskNames = [], selectedWeekLabels = [], options = {}) {
    const taskRoot = Array.isArray(filterData?.data?.task) ? filterData.data.task : [];
    const allIds = [];
    const idToName = {};
    const orderedTaskKeys = [];
    const taskMetaByKey = {};
    const cleanLabel = (text) => String(text || '').replace(/\s+/g, ' ').trim().replace(/\s*添加人:.*/, '').trim();
    const stripTypeSuffix = (text) => cleanLabel(text).replace(/\s*类型:.*$/, '').trim();
    const normalizedWeekLabels = Array.isArray(selectedWeekLabels)
      ? [...new Set(selectedWeekLabels.map((item) => cleanLabel(item)).filter(Boolean))]
      : [cleanLabel(selectedWeekLabels)].filter(Boolean);
    const groupOrderMap = new Map();
    let nextSourceOrder = 0;

    function parsePositiveNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const match = String(value).match(/(\d+(?:\.\d+)?)/);
      if (!match) return null;
      const parsed = Number.parseFloat(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function extractTaskScoreTotal(node, label = '') {
      const directKeys = [
        'scoreTotal',
        'totalScore',
        'total_score',
        'allScore',
        'allscore',
        'all_score',
        'total',
        'fullScore',
        'full_score',
        'maxScore',
        'max_score',
        'scoreLimit',
        'score_limit',
        'questionCount',
        'question_count',
        'questionTotal',
        'question_total',
        'limit',
      ];
      for (const key of directKeys) {
        const parsed = parsePositiveNumber(node?.[key]);
        if (parsed) return parsed;
      }

      const looksLikeScoreTotalKey = (key) => {
        const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalized) return false;
        if (
          /^(id|time|date|order|sort|status|finish|complete|student|user|person)$/.test(normalized)
          || /(finished|completed|studentid|userid|personid|created|updated)/.test(normalized)
        ) {
          return false;
        }
        if (/(score|point|mark)/.test(normalized) && /(total|all|full|max|limit|sum)/.test(normalized)) {
          return true;
        }
        if (/question/.test(normalized) && /(total|all|count|num|limit|max)/.test(normalized)) {
          return true;
        }
        return /^(total|all|full|max|limit|questioncount|questionnum)$/.test(normalized);
      };

      const findNestedScoreTotal = (value, depth = 0, seen = new WeakSet()) => {
        if (!value || typeof value !== 'object' || depth > 4) return null;
        if (seen.has(value)) return null;
        seen.add(value);

        for (const [key, nestedValue] of Object.entries(value)) {
          if (looksLikeScoreTotalKey(key)) {
            const parsed = parsePositiveNumber(nestedValue);
            if (parsed) return parsed;
          }
          const nestedParsed = findNestedScoreTotal(nestedValue, depth + 1, seen);
          if (nestedParsed) return nestedParsed;
        }
        return null;
      };

      const nestedScoreTotal = findNestedScoreTotal(node);
      if (nestedScoreTotal) return nestedScoreTotal;

      const labelMatch = String(label || '').match(/(?:总分|满分)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
      if (labelMatch) {
        const parsed = parsePositiveNumber(labelMatch[1]);
        if (parsed) return parsed;
      }
      const knownTotal = getKnownTestScoreTotal(label);
      if (knownTotal) return knownTotal;
      return null;
    }

    const getGroupOrder = (weekLabel, groupTitle) => {
      const key = `${stripTypeSuffix(weekLabel) || '__root__'}::${stripTypeSuffix(groupTitle) || '__leaf__'}`;
      if (!groupOrderMap.has(key)) {
        groupOrderMap.set(key, groupOrderMap.size);
      }
      return groupOrderMap.get(key);
    };

    const recordTaskNode = (nodeId, label, { weekLabel = '', ancestry = [], node = null } = {}) => {
      const parts = String(nodeId).split('_');
      if (parts.length < 3) return;
      const taskKey = parts.slice(1, 3).join('_');
      idToName[taskKey] = label;
      if (!orderedTaskKeys.includes(taskKey)) {
        orderedTaskKeys.push(taskKey);
      }
      if (taskMetaByKey[taskKey]) return;

      const normalizedAncestry = ancestry
        .map((item) => stripTypeSuffix(item))
        .filter(Boolean)
        .filter((item) => item !== stripTypeSuffix(label));
      const groupTitle = normalizedAncestry[0] || stripTypeSuffix(weekLabel) || stripTypeSuffix(label);

      const nextMeta = {
        title: stripTypeSuffix(label),
        groupTitle,
        groupOrder: getGroupOrder(weekLabel, groupTitle),
        sourceOrder: nextSourceOrder,
        weekLabel: stripTypeSuffix(weekLabel),
      };
      const scoreTotal = extractTaskScoreTotal(node, label);
      if (scoreTotal) {
        nextMeta.scoreTotal = scoreTotal;
      }
      taskMetaByKey[taskKey] = nextMeta;
      nextSourceOrder += 1;
    };

    // Strategy: walk the tree, find week nodes matching selectedWeekLabel, collect ONLY their descendants
    const isWeekNode = (label) => /Week\s*\d+/i.test(label) || /第\s*\d+\s*周/.test(label) || label.includes('任务时间:');

    function collectLeaves(nodes, weekLabel = '', ancestry = []) {
      const leaves = [];
      for (const node of nodes) {
        const label = cleanLabel(node?.label || node?.name || '');
        const children = Array.isArray(node?.children) ? node.children : [];
        const nodeId = node?.id || node?.value;
        if (children.length === 0 && nodeId) {
          leaves.push({ id: String(nodeId), label });
          recordTaskNode(nodeId, label, { weekLabel, ancestry, node });
        } else {
          const nextAncestry = label ? [...ancestry, label] : ancestry;
          leaves.push(...collectLeaves(children, weekLabel, nextAncestry));
        }
      }
      return leaves;
    }

    function findWeeksAndCollect(nodes, targetWeekLabel) {
      let matchedCount = 0;
      for (const node of nodes) {
        const label = cleanLabel(node?.label || node?.name || '');
        const children = Array.isArray(node?.children) ? node.children : [];

        if (isWeekNode(label) && targetWeekLabel) {
          const matched = label === targetWeekLabel || label.includes(targetWeekLabel) || targetWeekLabel.includes(label);
          if (matched) {
            const leaves = collectLeaves(children, label, []);
            for (const leaf of leaves) {
              allIds.push(leaf.id);
            }
            matchedCount += 1;
            continue;
          }
        }

        if (children.length > 0) {
          matchedCount += findWeeksAndCollect(children, targetWeekLabel);
        }
      }
      return matchedCount;
    }

    if (normalizedWeekLabels.length > 0) {
      let matchedWeeks = 0;
      for (const weekLabel of normalizedWeekLabels) {
        matchedWeeks += findWeeksAndCollect(taskRoot, weekLabel);
      }
      if (allIds.length > 0) {
        if (!options.quiet) {
          console.log(`ℹ️ 精确匹配周 ${normalizedWeekLabels.join(' | ')}: ${allIds.length} 个任务`);
        }
        return { taskIds: [...new Set(allIds)], idToName, orderedTaskKeys, taskMetaByKey };
      }
      if (!options.quiet) {
        console.warn(`⚠️ 精确匹配未命中 ${normalizedWeekLabels.join(' | ')}（命中 ${matchedWeeks} 个周节点），回退名称匹配`);
      }
      if (options.strictWeekMatch) return { taskIds: [], idToName: {}, orderedTaskKeys: [], taskMetaByKey: {} };
    }

    // Fallback: fuzzy name matching (original behavior)
    function collectByName(nodes, currentWeekLabel = '', ancestry = []) {
      for (const node of nodes) {
        const label = cleanLabel(node?.label || node?.name || '');
        const children = Array.isArray(node?.children) ? node.children : [];
        const nodeId = node?.id || node?.value;
        if (children.length === 0 && nodeId) {
          if (selectedTaskNames.length === 0 || selectedTaskNames.some(t => label.includes(t) || t.includes(label))) {
            allIds.push(String(nodeId));
          }
          recordTaskNode(nodeId, label, { weekLabel: currentWeekLabel, ancestry, node });
        } else {
          const nextWeekLabel = isWeekNode(label) ? label : currentWeekLabel;
          const nextAncestry = isWeekNode(label)
            ? []
            : (label ? [...ancestry, label] : ancestry);
          collectByName(children, nextWeekLabel, nextAncestry);
        }
      }
    }
    collectByName(taskRoot);
    return { taskIds: allIds, idToName, orderedTaskKeys, taskMetaByKey };
  }

  /**
   * 将 getStudentPersonFilter API 返回的 JSON 转为与浏览器抓取一致的 tableRows 格式
   *
   * Python 报表脚本期望的格式:
   * - Row 1: 顶层空行（或占位）
   * - Row 2: 任务标题（如 "Party Time2/3 词王荣耀"），相同标题跨多列
   * - Row 3: 子列名（"是否完成"、"PK次数"、"词王平均正确率"、"是否达到词王" 等）
   * - Row 4+: 学生数据（序号、学号、中文名、英文名、各列值）
   */
  convertStudentFilterToTableRows(apiData, idToName = {}, orderedTaskKeys = [], taskMetaByKey = {}) {
    const students = Array.isArray(apiData?.data) ? apiData.data : (Array.isArray(apiData) ? apiData : []);
    if (students.length === 0) return null;

    const standardKeys = new Set(['id', 'no', 'ch_name', 'en_name', 'apply', 'student_no']);

    // A student may omit an unstarted resource; discover columns across all rows.
    // Keys look like: "18322_4489_packAttr", "18322_4489_packAttr_rank", "18322_4489_packAttr_pk_count" etc.
    const sampleKeys = [...new Set(students.flatMap(student => Object.keys(student || {})))]
      .filter(k => !standardKeys.has(k));

    // Group keys by task resource (midKey = "18322_4489")
    // Each task resource has a base type (packAttr, voice, audio, test, studyMark) and sub-fields
    const taskGroups = new Map();
    for (const key of sampleKeys) {
      // Parse: "18322_4489_packAttr_rank" → midKey="18322_4489", rest="packAttr_rank"
      const parts = key.split('_');
      if (parts.length < 3) continue;
      const midKey = `${parts[0]}_${parts[1]}`;

      if (!taskGroups.has(midKey)) {
        taskGroups.set(midKey, { midKey, keys: [], baseType: '' });
      }
      taskGroups.get(midKey).keys.push(key);

      // Detect the base type from the key
      const rest = parts.slice(2).join('_');
      if (/^(packAttr|voice|audio|test|studyMark|composite|interactive_video)(score|count|ratio|rank|user|first|status|option)?/.test(rest)) {
        const baseType = rest.match(/^(packAttr|voice|audio|test|studyMark|composite|interactive_video)/)[1];
        taskGroups.get(midKey).baseType = baseType;
      }
    }

    function parseScoreTotal(value) {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const match = String(value).match(/(\d+(?:\.\d+)?)/);
      if (!match) return null;
      const parsed = Number.parseFloat(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function formatScoreTotal(value) {
      const parsed = parseScoreTotal(value);
      if (!parsed) return '15';
      return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/\.0+$/, '');
    }

    function isExplicitTestTotalSuffix(suffix) {
      const normalized = String(suffix || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normalized.includes('test')) return false;
      if (normalized === 'testscore' || normalized === 'teststatus') return false;
      return [
        'testtotalscore',
        'testscoretotal',
        'testallscore',
        'testall',
        'testtotal',
        'testfullscore',
        'testmaxscore',
        'testscorelimit',
        'testlimit',
        'testallquestion',
        'testtotalquestion',
        'testquestiontotal',
        'testquestioncount',
        'testquestionnum',
        'testtotalnum',
        'testnum',
      ].some((token) => normalized.includes(token));
    }

    function resolveTestScoreTotal(group, meta) {
      const metaTotal = parseScoreTotal(meta?.scoreTotal);
      if (metaTotal) return metaTotal;
      const knownTotal = getKnownTestScoreTotal(meta?.title || idToName?.[group.midKey] || '');
      if (knownTotal) return knownTotal;

      const prefix = `${group.midKey}_`;
      const totalKeys = (group.keys || []).filter((key) => (
        String(key).startsWith(prefix)
        && isExplicitTestTotalSuffix(String(key).slice(prefix.length))
      ));
      for (const key of totalKeys) {
        for (const student of students) {
          const parsed = parseScoreTotal(student?.[key]);
          if (parsed) return parsed;
        }
      }
      return null;
    }

    // Build column definitions for each task group
    // Sub-field mapping depends on type:
    const subFieldDefs = {
      packAttr: [
        { suffix: 'packAttr', subHeader: '是否完成' },
        { suffix: 'packAttr_rank', subHeader: '是否达到词王' },
        { suffix: 'packAttr_pk_count', subHeader: 'PK次数' },
        { suffix: 'packAttr_pk_ratio', subHeader: '词王平均正确率' },
      ],
      voice: [
        { suffix: 'voice', subHeader: '是否完成' },
        { suffix: 'voicescore', subHeader: '平均分' },
      ],
      audio: [
        { suffix: 'audio', subHeader: '是否完成' },
        { suffix: 'audioscore', subHeader: '平均分' },
      ],
      test: [
        { suffix: 'test', subHeader: '是否完成' },
      ],
      studyMark: [
        { suffix: 'studyMark', subHeader: '是否完成' },
        { suffix: 'studyMarkscore', subHeader: '分数' },
      ],
      composite: [
        { suffix: 'composite', subHeader: '是否完成' },
      ],
      interactive_video: [
        { suffix: 'interactive_video', subHeader: '是否完成' },
      ],
    };

    function buildPackAttrDefs(group) {
      const baseDefs = [...(subFieldDefs.packAttr || [])];
      const knownSuffixes = new Set(baseDefs.map((item) => item.suffix));
      const dynamicDefs = [];

      for (const key of group.keys || []) {
        const prefix = `${group.midKey}_`;
        if (!String(key).startsWith(prefix)) continue;
        const suffix = String(key).slice(prefix.length);
        if (!suffix.startsWith('packAttr_') || knownSuffixes.has(suffix)) continue;

        const lower = suffix.toLowerCase();
        if (!lower.includes('ratio')) continue;

        if (lower.includes('first')) {
          dynamicDefs.push({
            suffix,
            subHeader: '【不是词王pk数据！！！重复环节首次完成正确率】',
          });
          knownSuffixes.add(suffix);
          continue;
        }

        if (!lower.includes('pk_ratio')) {
          dynamicDefs.push({
            suffix,
            subHeader: '【不是词王pk数据！！！重复环节平均正确率】',
          });
          knownSuffixes.add(suffix);
        }
      }

      return [...baseDefs, ...dynamicDefs];
    }

    function buildTestDefs(group, meta) {
      const scoreTotal = resolveTestScoreTotal(group, meta);
      if (!scoreTotal) {
        console.warn(`⚠️ 测试总分未识别，使用15兜底: ${meta?.title || group.midKey}; keys=${(group.keys || []).join(',')}`);
      }
      return [
        { suffix: 'test', subHeader: '是否完成' },
        { suffix: 'testscore', subHeader: `分数(${formatScoreTotal(scoreTotal)})` },
      ];
    }

    // Map cnfadmin internal type labels to display bracket tags
    const typeTagMap = {
      '主题表达积累': '词王', '语音': 'AI语音', '音频': 'AI语音',
      '测试': '测试', '小挑战': '小挑战', '复合资源': '复合资源', '互动视频': '互动视频',
    };

    const orderedMidKeys = [
      ...orderedTaskKeys.filter((midKey) => taskGroups.has(midKey)),
      ...Array.from(taskGroups.keys()).filter((midKey) => !orderedTaskKeys.includes(midKey)),
    ];

    const moduleDefs = [];
    for (let index = 0; index < orderedMidKeys.length; index += 1) {
      const midKey = orderedMidKeys[index];
      const group = taskGroups.get(midKey);
      if (!group) continue;
      const taskName = idToName[midKey] || midKey;
      // Extract type from "类型:xxx" suffix and convert to bracket tag for sorting
      const typeMatch = taskName.match(/\s*类型:(.+)$/);
      const rawType = typeMatch ? typeMatch[1].trim() : '';
      const typeTag = typeTagMap[rawType] || rawType;
      const baseName = taskName.replace(/\s*类型:.*$/, '').trim();
      const meta = taskMetaByKey[midKey] || {};

      moduleDefs.push({
        midKey,
        group,
        title: String(meta.title || baseName || midKey).trim(),
        groupTitle: String(meta.groupTitle || '').trim(),
        groupOrder: Number.isFinite(meta.groupOrder) ? meta.groupOrder : index,
        sourceOrder: Number.isFinite(meta.sourceOrder) ? meta.sourceOrder : index,
        outputTitle: typeTag ? `${baseName}[${typeTag}]` : baseName,
        meta,
      });
    }

    const sortedModuleDefs = sortModulesByGroup(moduleDefs);
    const columns = []; // { title, subHeader, studentKey }
    for (const moduleDef of sortedModuleDefs) {
      const defs = moduleDef.group.baseType === 'packAttr'
        ? buildPackAttrDefs(moduleDef.group)
        : moduleDef.group.baseType === 'test'
          ? buildTestDefs(moduleDef.group, moduleDef.meta)
        : (subFieldDefs[moduleDef.group.baseType] || [{ suffix: moduleDef.group.baseType, subHeader: '是否完成' }]);

      for (const def of defs) {
        const studentKey = `${moduleDef.midKey}_${def.suffix}`;
        // Only include columns that actually exist in the data
        if (moduleDef.group.keys.includes(studentKey)) {
          columns.push({ title: moduleDef.outputTitle, subHeader: def.subHeader, studentKey });
        }
      }
    }

    if (columns.length === 0) return null;

    // Build the 3-row header + data rows
    const row1 = ['', '', '', '', ...columns.map(() => '')]; // Top row (empty/spacer)
    const row2 = ['序号', '学号', '中文名', '英文名', ...columns.map(c => c.title)]; // Task titles
    const row3 = ['序号', '学号', '中文名', '英文名', ...columns.map(c => c.subHeader)]; // Sub-headers

    const rows = [row1, row2, row3];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      const row = [
        String(i + 1),
        String(s.no || s.student_no || ''),
        String(s.ch_name || ''),
        String(s.en_name || ''),
        ...columns.map(c => {
          const v = s[c.studentKey];
          return v === null || v === undefined ? '' : String(v);
        }),
      ];
      rows.push(row);
    }

    console.log(`ℹ️ API→表格转换: ${students.length}名学生, ${columns.length}列 (${[...new Set(columns.map(c => c.title))].length}个任务)`);
    return rows;
  }

  /**
   * 抓取作业公示导出表（HTTP API 优先，浏览器兜底）
   */
  async scrapePublicityExportData(classId, options = {}) {
    const { classCode, squadId } = await this.resolveSquadId(classId);
    console.log(`🔄 正在抓取班级${classCode || classId}(id=${squadId})公示导出表...`);

    const selectedTasks = Array.isArray(options.selectedTasks) ? options.selectedTasks : [];
    const selectedWeekIds = Array.isArray(options.selectedWeekIds) ? options.selectedWeekIds : [];
    const selectedWeekLabels = Array.isArray(options.selectedWeekLabels) ? options.selectedWeekLabels : [];
    const preparedSelection = options.preparedSelection && typeof options.preparedSelection === 'object'
      ? options.preparedSelection
      : null;
    const preciseWeekLabels = selectedWeekLabels.length > 0
      ? selectedWeekLabels
      : selectedWeekIds.map((item) => String(item || '')).filter(Boolean);

    const buildFromFilterData = async (filterData, transport) => {
      if (!filterData) return null;
      const { taskIds, idToName, orderedTaskKeys, taskMetaByKey } = this.collectTaskIdsFromFilterData(
        filterData,
        selectedTasks,
        preciseWeekLabels,
      );
      if (taskIds.length === 0) return null;
      console.log(`ℹ️ HTTP API: 匹配到 ${taskIds.length} 个任务节点 ID, ${Object.keys(idToName).length} 个名称映射`);
      const studentData = await this.fetchStudentPersonFilter(squadId, taskIds);
      const tableRows = this.convertStudentFilterToTableRows(studentData, idToName, orderedTaskKeys, taskMetaByKey);
      if (!tableRows || tableRows.length <= 3) return null;
      console.log(`✅ 公示表 HTTP API 直取成功: ${tableRows.length - 3}名学生, ${tableRows[0].length}列`);
      return {
        classId: classCode || classId,
        squadId,
        week: null,
        tableRows,
        selectedTaskResult: { matched: selectedTasks, missing: [] },
        meta: { transport, rowCount: tableRows.length, colCount: tableRows[0]?.length || 0 },
        ...(options.includeSourcePayload ? {
          sourcePayload: { studentData, idToName, orderedTaskKeys, taskMetaByKey },
        } : {}),
      };
    };

    // Strategy 1: Direct HTTP API (getStudentPersonFilter)
    try {
      if (Array.isArray(preparedSelection?.taskIds) && preparedSelection.taskIds.length > 0) {
        console.log(`ℹ️ HTTP API: 复用缓存目录中的 ${preparedSelection.taskIds.length} 个任务节点`);
        const studentData = await this.fetchStudentPersonFilter(squadId, preparedSelection.taskIds);
        const tableRows = this.convertStudentFilterToTableRows(
          studentData,
          preparedSelection.idToName || {},
          preparedSelection.orderedTaskKeys || [],
          preparedSelection.taskMetaByKey || {},
        );
        if (tableRows && tableRows.length > 3) {
          console.log(`✅ 公示表 HTTP API 直取成功: ${tableRows.length - 3}名学生, ${tableRows[0].length}列`);
          return {
            classId: classCode || classId,
            squadId,
            week: null,
            tableRows,
            selectedTaskResult: { matched: selectedTasks, missing: [] },
            meta: { transport: 'http-api-prepared', rowCount: tableRows.length, colCount: tableRows[0]?.length || 0 },
            ...(options.includeSourcePayload ? {
              sourcePayload: {
                studentData,
                idToName: preparedSelection.idToName || {},
                orderedTaskKeys: preparedSelection.orderedTaskKeys || [],
                taskMetaByKey: preparedSelection.taskMetaByKey || {},
              },
            } : {}),
          };
        }
      }

      const preferredYear = String(options.preferredYear || '2025');
      const preferredSemester = options.preferredSemester || `${preferredYear}学年春季学期`;
      const cachedContext = this._lastFilterContext;
      let filterData = cachedContext
        && String(cachedContext.squadId) === String(squadId)
        && (!preferredSemester || String(cachedContext.preferredSemester || '').includes(preferredSemester))
        ? cachedContext.filterData
        : null;
      let termId = filterData ? cachedContext.termId : null;

      if (!filterData) {
        const semesters = await this.fetchSemesterData();
        const match = this.selectSemester(semesters, {
          preferredYear,
          preferredSemester,
          semesterMode: options.semesterMode,
        });
        termId = match?.id || match?.term_id;
        if (termId) {
          filterData = await this.fetchFilterData(squadId, termId);
          this._lastFilterContext = {
            squadId: String(squadId),
            termId,
            preferredSemester: String(match?.name || preferredSemester),
            filterData,
          };
        }
      }

      // Resolve EVERY selected group before fetching students. Returning the
      // first nonempty semester silently discarded groups across term boundaries.
      if (preciseWeekLabels.length > 1) {
        const selections = preciseWeekLabels.map((label) => this.collectTaskIdsFromFilterData(
          filterData, [], [label], { strictWeekMatch: true, quiet: true },
        ));
        if (selections.some((selection) => !selection.taskIds.length)) {
          const semesters = await this.fetchSemesterData();
          const previous = this.selectSemester(semesters, { preferredYear, preferredSemester, semesterMode: 'previous' });
          const previousId = previous?.id || previous?.term_id;
          if (previousId && String(previousId) !== String(termId || '')) {
            const previousData = await this.fetchFilterData(squadId, previousId);
            selections.forEach((selection, index) => {
              if (!selection.taskIds.length) selections[index] = this.collectTaskIdsFromFilterData(
                previousData, [], [preciseWeekLabels[index]], { strictWeekMatch: true, quiet: true },
              );
            });
          }
        }
        const missing = preciseWeekLabels.filter((_, index) => !selections[index].taskIds.length);
        if (missing.length) {
          const error = new Error(`所选挑战尚未完整读取：${missing.join('；')}。请稍后重试或调整选择。`);
          error.incompleteSelection = true;
          throw error;
        }
        const merged = mergeTaskSelections(selections);
        const studentData = await this.fetchStudentPersonFilter(squadId, merged.taskIds);
        const tableRows = this.convertStudentFilterToTableRows(studentData, merged.idToName, merged.orderedTaskKeys, merged.taskMetaByKey);
        if (!tableRows || tableRows.length <= 3) throw new Error('所选挑战没有返回学生明细');
        return { classId: classCode || classId, squadId, week: null, tableRows,
          selectedTaskResult: { matched: selectedTasks, missing: [] },
          meta: { transport: 'http-api-merged', rowCount: tableRows.length, colCount: tableRows[0]?.length || 0 } };
      }
      const currentTermResult = await buildFromFilterData(filterData, 'http-api');
      if (currentTermResult) return currentTermResult;

      // A task assigned on the term boundary can remain filed under the prior
      // official semester even though its startAt belongs to the new week. The
      // task catalog deliberately keeps that real assignment, so report data
      // must follow the task into the adjacent term instead of dropping it.
      if (preciseWeekLabels.length > 0 || selectedTasks.length > 0) {
        const semesters = await this.fetchSemesterData();
        const previousMatch = this.selectSemester(semesters, {
          preferredYear,
          preferredSemester,
          semesterMode: 'previous',
        });
        const previousTermId = previousMatch?.id || previousMatch?.term_id;
        if (previousTermId && String(previousTermId) !== String(termId || '')) {
          const previousFilterData = await this.fetchFilterData(squadId, previousTermId);
          const adjacentTermResult = await buildFromFilterData(previousFilterData, 'http-api-adjacent');
          if (adjacentTermResult) {
            console.log(`ℹ️ 公示任务来自相邻学期目录: ${previousMatch?.name || previousTermId}`);
            return adjacentTermResult;
          }
        }
      }
      console.warn(`⚠️ 公示表 HTTP API 未命中，回退: ${classCode || classId}`);
    } catch (error) {
      if (error.incompleteSelection || preciseWeekLabels.length > 1) throw error;
      console.warn(`⚠️ 公示表 HTTP API 失败，回退: ${error.message}`);
    }

    // Strategy 2: Old HTML parse
    try {
      const html = await this.fetchSquadConsoleHtml(squadId);
      const parsed = extractPublicityExportDataFromHtml(html, options);
      if (parsed?.tableRows?.length) {
        console.log(`✅ 公示表 HTTP/HTML 直取成功: ${parsed.tableRows.length}行`);
        return {
          classId: classCode || classId,
          squadId,
          week: parsed.week,
          tableRows: parsed.tableRows,
          selectedTaskResult: { matched: [], missing: [] },
          meta: parsed.meta,
        };
      }
    } catch {}

    // Strategy 3: Browser fallback
    return this.scrapePublicityExportDataViaBrowser(classId, options);
  }

  /**
   * 抓取班级任务列表（先让老师勾选任务）
   */
  async scrapePublicityTaskListViaBrowser(classId, options = {}) {
    return this.runBrowserTask(`publicity-task-list:${classId}`, async () => {
      let captureHandler = null;
      try {
        await this.ensurePageReady();

      // --- API Discovery: capture XHR/fetch responses ---
      const apiCalls = [];
      captureHandler = async (response) => {
        const url = response.url();
        if (!url.includes('/admin/') && !url.includes('/api/')) return;
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json') && !contentType.includes('html')) return;
        try {
          const body = await response.text().catch(() => '');
          apiCalls.push({
            url: url.replace(/https?:\/\/[^/]+/, ''),
            method: response.request().method(),
            status: response.status(),
            contentType,
            bodyPreview: body.substring(0, 500),
          });
        } catch {}
      };
      this.page.on('response', captureHandler);
      // --- end API Discovery setup ---

      const { classCode, squadId } = await this.resolveSquadId(classId);
      const url = `${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`;
      console.log(`🔄 正在抓取班级${classCode || classId}(id=${squadId})任务列表...`);
      let gotoOk = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await this.ensurePageReady();
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          gotoOk = true;
          break;
        } catch (error) {
          const message = error?.message || '';
          if ((!message.includes('detached Frame') && !message.includes('Navigation timeout')) || attempt === 2) {
            throw error;
          }
          await this.replaceBrowserPage();
          await this.sleep(1200);
        }
      }
      if (!gotoOk) {
        throw new Error('页面打开失败');
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const pageState = await this.page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const hasErrorPage =
          document.title.includes('Whoops') ||
          bodyText.includes('UnexpectedValueException') ||
          bodyText.includes('Permission denied');
        return { hasErrorPage };
      });

      if (pageState.hasErrorPage) {
        throw new Error('系统页面异常（错误页），请稍后重试');
      }

      const preferredYear = String(options.preferredYear || '2025');
      const preferredSemester = options.preferredSemester || `${preferredYear}学年秋季学期`;
      let selectedSemester = preferredSemester;
      let allTasks = [];

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (attempt > 1) {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.sleep(1800);
        }

        selectedSemester = await this.openStudentPersonDialogWithRecovery(url, preferredYear, preferredSemester);
        allTasks = await this.readStudentPersonDialogTasks();
        if (allTasks.length > 0) {
          break;
        }

        await this.sleep(1200);
        allTasks = await this.readStudentPersonDialogTasks();
        if (allTasks.length > 0) {
          break;
        }
      }

      if (allTasks.length === 0) {
        throw new Error('未从任务树读取到准确任务列表，已停止返回兜底列表，请重试');
      }

        const unique = [...new Set(allTasks.flatMap((group) => Array.isArray(group?.tasks) ? group.tasks : []))];
        console.log(`✅ 任务列表抓取完成: ${allTasks.length}组 / ${unique.length}项（优先${selectedSemester || preferredSemester}）`);

        // --- API Discovery: log summary ---
        if (captureHandler) this.page.off('response', captureHandler);
        if (apiCalls.length > 0) {
          console.log('[API-DISCOVERY] Captured API calls during task list scraping:');
          for (const call of apiCalls) {
            console.log(`  ${call.method} ${call.url} (${call.status}) ${call.contentType}`);
            if (call.bodyPreview) console.log(`    preview: ${call.bodyPreview.substring(0, 200)}`);
          }
        }
        // --- end API Discovery summary ---

        return {
          classId: classCode || classId,
          squadId,
          preferredYear,
          preferredSemester: selectedSemester || preferredSemester,
          currentTask: '',
          taskGroups: allTasks,
          tasks: unique,
          transport: 'browser',
        };
      } catch (error) {
        if (captureHandler) this.page?.off('response', captureHandler);
        console.error('❌ 抓取任务列表失败:', error);
        throw error;
      }
    });
  }

  /**
   * 从 getFilterData API 返回的任务树中提取周任务组
   */
  parseFilterDataToTaskGroups(filterData, preferredSemester = '', taskCatalog = []) {
    const taskRoot = Array.isArray(filterData?.data?.task) ? filterData.data.task : [];

    const cleanLabel = (text) => String(text || '').replace(/\s+/g, ' ').trim().replace(/\s*添加人:.*/, '').trim();
    const isWeekNode = (text) => {
      const cleaned = cleanLabel(text);
      return /Week\s*\d+/i.test(cleaned) || /第\s*\d+\s*周/.test(cleaned) || cleaned.includes('任务时间:');
    };
    const extractWeekName = (text) => {
      const cleaned = cleanLabel(text);
      const weekMatch = cleaned.match(/Week\s*\d+/i);
      if (weekMatch?.[0]) return weekMatch[0].replace(/\s+/g, '');
      const chineseWeekMatch = cleaned.match(/第\s*\d+\s*周/);
      if (chineseWeekMatch?.[0]) return chineseWeekMatch[0].replace(/\s+/g, '');
      return cleaned.replace(/\s*任务时间[:：].*$/, '').trim() || cleaned;
    };
    const extractOfficialTaskId = (node) => {
      const direct = String(node?.task_id || '').trim();
      if (direct) return direct;
      return String(node?.id || node?.value || '').match(/^(\d+)_task$/)?.[1] || '';
    };
    const catalogRows = Array.isArray(taskCatalog) ? taskCatalog.filter(Boolean) : [];
    const catalogById = new Map(catalogRows.map((row) => [String(row?.id || '').trim(), row]));
    const buildTaskSelection = (node, label) => this.collectTaskIdsFromFilterData(
      { data: { task: [node] } },
      [],
      [label],
      { quiet: true },
    );
    const metadataFor = (row = {}) => ({
      addAt: String(row?.add_at || '').trim(),
      startAt: String(row?.start_at || '').trim(),
      endAt: String(row?.end_at || '').trim(),
      skuId: String(row?.sku_id || '').trim(),
      collectionName: String(row?.catalogGroup || '').trim(),
      declaredTerm: String(preferredSemester || '').trim(),
      status: row?.status ?? null,
      statusText: String(row?.status_str || '').trim(),
      weekNumber: Number.isFinite(Number(row?.week)) ? Number(row.week) : null,
    });

    const groups = [];
    const seen = new Set();

    function collectLeafLabels(node) {
      const children = Array.isArray(node?.children) ? node.children : [];
      if (children.length === 0) {
        const label = cleanLabel(node?.label || node?.name || '');
        return label ? [label] : [];
      }
      const tasks = [];
      for (const child of children) {
        const childLabel = cleanLabel(child?.label || child?.name || '');
        // "Week1" can also be a resource title. Only nested containers
        // represent another task group; leaves must remain selectable by name.
        if (isWeekNode(childLabel) && child?.children?.length) continue;
        const nested = collectLeafLabels(child);
        if (nested.length > 0) {
          tasks.push(...nested);
        } else if (childLabel) {
          tasks.push(childLabel);
        }
      }
      return [...new Set(tasks)];
    }

    function walk(nodes) {
      for (const node of nodes) {
        const label = cleanLabel(node?.label || node?.name || '');
        const children = Array.isArray(node?.children) ? node.children : [];
        if (!label) {
          if (children.length > 0) walk(children);
          continue;
        }
        if (isWeekNode(label)) {
          const weekName = extractWeekName(label);
          const tasks = collectLeafLabels(node);
          const officialTaskId = extractOfficialTaskId(node);
          const catalogRow = catalogById.get(officialTaskId) || {};
          const key = officialTaskId ? `official:${officialTaskId}` : `${weekName}__${label}__${tasks.join('|')}`;
          if (!seen.has(key)) {
            const taskSelection = buildTaskSelection(node, label);
            groups.push({
              id: weekName,
              name: weekName,
              officialTaskId,
              sourceLabel: label,
              // Names are presentation labels; distinct resources can share one.
              resourceCount: taskSelection.taskIds.length || tasks.length || 1,
              tasks: tasks.length > 0 ? tasks : [label],
              studentVisible: true,
              taskSelection,
              ...metadataFor(catalogRow),
            });
            seen.add(key);
          }
          continue;
        }
        if (children.length > 0) {
          walk(children);
        }
      }
    }

    walk(taskRoot);

    for (const row of catalogRows) {
      const officialTaskId = String(row?.id || '').trim();
      if (!officialTaskId || seen.has(`official:${officialTaskId}`)) continue;
      const name = String(row?.lesson_name || row?.show_name || row?.name || `任务 ${officialTaskId}`).trim();
      const sourceLabel = `${name}${row?.add_at ? ` 任务时间:${row.add_at}` : ''}`;
      const tasks = (Array.isArray(row?.resource_arr) ? row.resource_arr : [])
        .map((resource) => String(resource?.name || '').trim())
        .filter(Boolean);
      groups.push({
        id: name,
        name,
        officialTaskId,
        sourceLabel,
        resourceCount: Number(row?.resource_count) || tasks.length || 1,
        tasks,
        studentVisible: false,
        taskSelection: null,
        ...metadataFor(row),
      });
      seen.add(`official:${officialTaskId}`);
    }
    return groups;
  }

  /**
   * 抓取班级任务列表（HTTP API 优先，浏览器兜底）
   */
  async scrapePublicityTaskList(classId, options = {}) {
    const { classCode, squadId } = await this.resolveSquadId(classId);
    console.log(`🔄 正在抓取班级${classCode || classId}(id=${squadId})任务列表...`);

    let preferredYear = String(options.preferredYear || '2025');
    let preferredSemester = options.preferredSemester || `${preferredYear}学年秋季学期`;

    // Strategy 1: Direct HTTP API (getFilterData)
    try {
      const semesters = await this.fetchSemesterData();
      if (semesters.length > 0) {
        // Pick best matching semester
        const match = this.selectSemester(semesters, {
          preferredYear,
          preferredSemester,
          semesterMode: options.semesterMode,
        });
        const termId = match?.id || match?.term_id;
        if (termId) {
          preferredSemester = String(match?.name || preferredSemester);
          const matchedYear = preferredSemester.match(/(20\d{2})学年/)?.[1];
          if (matchedYear) preferredYear = matchedYear;
          const [filterData, taskCatalog] = await Promise.all([
            this.fetchFilterData(squadId, termId),
            this.fetchSquadTaskCatalog(squadId, termId).catch((error) => {
              console.warn(`⚠️ 完整任务目录读取失败，继续使用学生中心目录: ${error.message}`);
              return [];
            }),
          ]);
          const taskGroups = this.parseFilterDataToTaskGroups(filterData, preferredSemester, taskCatalog);
          if (options.includeAdjacentActive && String(options.semesterMode || '').toLowerCase() !== 'previous') {
            try {
              const adjacentGroups = await this.fetchAdjacentTaskCycles({
                semesters,
                squadId,
                preferredYear,
                preferredSemester,
                currentTermId: termId,
              });
              const knownIds = new Set(taskGroups.map((group) => String(group?.officialTaskId || '')).filter(Boolean));
              for (const group of adjacentGroups) {
                if (!knownIds.has(String(group?.officialTaskId || ''))) taskGroups.push(group);
              }
              if (adjacentGroups.length > 0) {
                console.log(`ℹ️ 合并相邻学期的 ${adjacentGroups.length} 个当前开放周期 (按 start_at/end_at)`);
              }
            } catch (error) {
              console.warn(`⚠️ 相邻学期开放周期读取失败，继续使用当前学期目录: ${error.message}`);
            }
          }
          if (taskGroups.length > 0) {
            const unique = [...new Set(taskGroups.flatMap(g => g.tasks))];
            console.log(`✅ 任务列表 HTTP API 直取成功: ${taskGroups.length}组 / ${unique.length}项 (term=${match.name || termId})`);
            // Also store the raw filter data for later use in student data fetch
            this._lastFilterContext = {
              squadId: String(squadId),
              termId,
              preferredSemester,
              filterData,
            };
            return {
              classId: classCode || classId,
              squadId,
              preferredYear,
              preferredSemester: String(match.name || preferredSemester),
              currentTask: '',
              taskGroups,
              tasks: unique,
              transport: taskGroups.some((group) => !group.studentVisible) ? 'http-api-catalog' : 'http-api',
            };
          }
          const isAuthoritativeEmptyResult = Number(filterData?.code) === 200
            && filterData?.data
            && Array.isArray(filterData.data.task)
            && filterData.data.week != null
            && Array.isArray(filterData.data.plan);
          if (isAuthoritativeEmptyResult) {
            console.log(`ℹ️ 官网当前学期暂无周任务: ${classCode || classId} (term=${match.name || termId})`);
            this._lastFilterContext = {
              squadId: String(squadId),
              termId,
              preferredSemester,
              filterData,
            };
            return {
              classId: classCode || classId,
              squadId,
              preferredYear,
              preferredSemester: String(match.name || preferredSemester),
              currentTask: '',
              taskGroups: [],
              tasks: [],
              transport: 'http-api-empty',
            };
          }
        }
      }
      console.warn(`⚠️ 任务列表 HTTP API 未命中有效数据，回退浏览器: ${classCode || classId}`);
    } catch (error) {
      console.warn(`⚠️ 任务列表 HTTP API 失败，回退浏览器: ${error.message}`);
    }

    // Strategy 2: Old HTML parse (rarely works, kept for compatibility)
    try {
      const html = await this.fetchSquadConsoleHtml(squadId);
      const parsed = extractPublicityTaskListFromHtml(html);
      if (parsed.taskGroups.length > 0) {
        console.log(`✅ 任务列表 HTTP/HTML 直取成功: ${parsed.taskGroups.length}组 / ${parsed.tasks.length}项`);
        return {
          classId: classCode || classId,
          squadId,
          preferredYear,
          preferredSemester,
          currentTask: '',
          taskGroups: parsed.taskGroups,
          tasks: parsed.tasks,
          transport: 'http-html',
        };
      }
    } catch {}

    // Strategy 3: Browser fallback
    return this.scrapePublicityTaskListViaBrowser(classId, {
      ...options,
      preferredYear,
      preferredSemester,
    });
  }

  /**
   * 关闭浏览器
   */
  /**
   * 爬取班级列表（教务系统中该用户管理的所有班级）
   */
  async scrapeClassList() {
    return this.runBrowserTask('class-list-legacy', async () => {
      try {
        const mapped = await this.getClassMap(false);
        if (mapped.length > 0) {
          const normalized = mapped.map((item) => ({
            id: item.classCode,
            name: item.classCode,
            squadId: item.squadId,
          }));
          console.log(`✅ 成功提取${normalized.length}个班级: ${normalized.map((c) => c.name).join(', ')}`);
          return normalized;
        }

        await this.ensurePageReady();
        const adminUrl = `${this.baseUrl}/admin`;
        console.log(`🔄 访问首页: ${adminUrl}`);

        await this.page.goto(adminUrl, { waitUntil: 'networkidle2', timeout: 8000 });

        const title = await this.page.title();
        console.log(`   页面标题: ${title}`);

        const classes = await this.page.evaluate(() => {
          const results = [];
          const allText = document.body.innerText;
          const classListMatch = allText.indexOf('我的班级列表');

          if (classListMatch !== -1) {
            const afterClassList = allText.substring(classListMatch);
            const classPattern = /([A-Za-z]{1,3}\d{2,4})/g;
            const matches = afterClassList.match(classPattern);

            if (matches) {
              const uniqueMatches = [...new Set(matches)];
              for (const className of uniqueMatches) {
                results.push({
                  id: className.toUpperCase(),
                  name: className.toUpperCase(),
                });
              }
            }
          }

          if (results.length === 0) {
            const allClassPattern = /([A-Za-z]{1,2}\d{1,3})/g;
            const allMatches = allText.match(allClassPattern);

            if (allMatches) {
              const uniqueMatches = [...new Set(allMatches)];
              for (const className of uniqueMatches.slice(0, 20)) {
                results.push({
                  id: className.toUpperCase(),
                  name: className.toUpperCase(),
                });
              }
            }
          }

          const links = document.querySelectorAll('a[href*="squad_id"]');
          const classMap = new Map();

          for (const link of links) {
            const href = link.href;
            const urlParams = new URLSearchParams(new URL(href).search);
            const squadId = urlParams.get('squad_id');
            const text = link.textContent?.trim();

            if (squadId && text && text.match(/^[A-Za-z]{1,2}\d{1,3}$/)) {
              classMap.set(text.toUpperCase(), squadId);
            }
          }

          if (classMap.size > 0) {
            return Array.from(classMap.entries()).map(([name, id]) => ({ id, name }));
          }

          return results;
        });

        if (classes && classes.length > 0) {
          const uniqueClasses = Array.from(new Map(classes.map((item) => [item.name, item])).values());
          console.log(`✅ 成功提取${uniqueClasses.length}个班级: ${uniqueClasses.map((c) => c.name).join(', ')}`);
          return uniqueClasses;
        }

        console.warn('⚠️ 无法提取班级列表，保存页面用于调试...');
        const pageHTML = await this.page.content();
        const nativeFs = require('fs');
        nativeFs.writeFileSync('/tmp/class_debug.html', pageHTML);

        const pageText = await this.page.evaluate(() => document.body.innerText);
        nativeFs.writeFileSync('/tmp/class_debug.txt', pageText);

        await this.page.screenshot({ path: '/tmp/class_debug.png' });

        console.log('💾 已保存调试信息到 /tmp/class_debug.*');
        console.log('📄 页面内容前2000字符:');
        console.log(pageText.substring(0, 2000));

        return [];
      } catch (error) {
        console.error('❌ 爬取班级列表失败:', error.message);
        throw error;
      }
    });
  }

  /**
   * 抓取周度资料上传页面的表单内容
   */
  async scrapeMaterialsPages(classId) {
    return this.runBrowserTask(`materials-read:${classId}`, async () => {
      await this.gotoSquadConsole(classId);
      await this.sleep(1000);

      try {
        const pages = await this.page.evaluate(() => {
          const result = [];
          const allLinks = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
          const materialLinks = allLinks.filter((el) =>
            el.textContent && (
              el.textContent.includes('资料') ||
              el.textContent.includes('上传') ||
              el.textContent.includes('材料')
            )
          );

          for (const link of materialLinks.slice(0, 2)) {
            const title = link.textContent.trim();
            const fields = [];
            const container = link.closest('form') || link.closest('.panel') || link.closest('.card') || link.parentElement;
            if (container) {
              const inputs = Array.from(container.querySelectorAll('input, textarea, select'));
              inputs.forEach((el, idx) => {
                const label = container.querySelector(`label[for="${el.id}"]`)?.textContent ||
                  el.placeholder || el.name || `字段${idx + 1}`;
                fields.push({
                  fieldId: el.id || el.name || `field_${idx}`,
                  label: label.trim(),
                  type: el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text',
                  value: el.value || '',
                  options: el.tagName === 'SELECT' ? Array.from(el.options).map((option) => option.value) : [],
                });
              });
            }
            result.push({ pageTitle: title, fields });
          }
          return result;
        });

        return {
          pages: pages.length > 0 ? pages : [
            {
              pageTitle: '本周资料上传',
              fields: [
                { fieldId: 'content', label: '上传内容说明', type: 'textarea', value: '', options: [] },
                { fieldId: 'link', label: '资料链接', type: 'text', value: '', options: [] },
              ],
            },
          ],
        };
      } catch (error) {
        console.error('抓取资料页面失败:', error.message);
        return { pages: [], error: error.message };
      }
    });
  }

  /**
   * 提交资料上传表单
   */
  async submitMaterialsPages(classId, formData) {
    return this.runBrowserTask(`materials-submit:${classId}`, async () => {
      await this.gotoSquadConsole(classId);
      await this.sleep(1000);

      const results = [];
      for (const page of formData) {
        try {
          for (const field of page.fields) {
            const selector = `#${field.fieldId}, [name="${field.fieldId}"]`;
            const el = await this.page.$(selector);
            if (el) {
              const tag = await el.evaluate((node) => node.tagName);
              if (tag === 'SELECT') {
                await this.page.select(selector, field.value);
              } else {
                await el.click({ clickCount: 3 });
                await el.type(field.value);
              }
            }
          }
          const submitBtn = await this.page.$('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            await submitBtn.click();
            await this.sleep(1200);
          }
          results.push({ page: page.pageTitle, status: 'success' });
        } catch (error) {
          results.push({ page: page.pageTitle, status: 'failed', error: error.message });
        }
      }
      return { results, success: results.filter((item) => item.status === 'success').length };
    });
  }

  /**
   * 获取班级 MP 库存信息（纯 HTTP，不启动浏览器）
   */
  async getMinipinBalance(classId) {
    const { classCode, squadId } = await this.resolveSquadId(classId);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const squadDataResp = await this.request(
          `/admin/squad/cop_mip/getSquadData?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
          { headers: { accept: 'application/json,text/plain,*/*' } }
        );
        const squadDataText = await squadDataResp.text().catch(() => '');
        const squadDataJson = (() => {
          try {
            return squadDataText ? JSON.parse(squadDataText) : null;
          } catch {
            return null;
          }
        })();

        const apiMetrics = squadDataJson ? extractJsonStats(squadDataJson) : extractJsonStats({});
        mergeMetrics(apiMetrics, extractStats(squadDataText));
        if (apiMetrics.minipin != null || apiMetrics.coupon != null) {
          console.log(`✅ MP余额来自 getSquadData: squad=${squadId}; mp=${apiMetrics.minipin ?? 'null'}; coupon=${apiMetrics.coupon ?? 'null'}; attempt=${attempt}`);
          return {
            classCode: classCode || classId,
            squadId,
            ...apiMetrics,
          };
        }

        if (squadDataJson) {
          console.warn(`⚠️ getSquadData已返回但未识别到余额字段: squad=${squadId}; attempt=${attempt}; keys=${Object.keys(squadDataJson).join(',')}`);
        } else if (squadDataText) {
          console.warn(`⚠️ getSquadData返回非JSON或空字段: squad=${squadId}; attempt=${attempt}; preview=${squadDataText.slice(0, 240).replace(/\\s+/g, ' ')}`);
        }
      } catch (error) {
        console.warn(`⚠️ getSquadData查询失败，准备重试/回退: squad=${squadId}; attempt=${attempt}; error=${error.message}`);
      }

      if (attempt < 2) {
        await this.sleep(350);
      }
    }

    const { text: html } = await this.requestText(
      `/admin/squad_console?id=${squadId}&type=offline`,
      { headers: { accept: 'text/html' } }
    );
    if (this.isLoginPage(html)) throw new Error('登录状态已失效，请重新登录');
    const $ = cheerio.load(html);
    let metrics = extractStats($('body').text());
    const componentProbe = extractComponentStats(html);
    mergeMetrics(metrics, componentProbe.metrics);

    if (metrics.minipin == null && metrics.coupon == null) {
      await this.runBrowserTask(`mp-balance-fallback:${classId}`, async () => {
        await this.ensurePageReady();
        const interceptedUrls = [];
        const responseHandler = async (response) => {
          try {
            const url = response.url();
            if (!/(coupon|minipin|cop_mip|getTypeArr|getTableDataTag|squad_console)/i.test(url)) {
              return;
            }
            if (interceptedUrls.length < 12 && !interceptedUrls.includes(url)) {
              interceptedUrls.push(url);
            }
            const headers = response.headers();
            const contentType = String(headers['content-type'] || '');
            if (!/json|text|html/i.test(contentType)) {
              return;
            }
            const body = await response.text().catch(() => '');
            mergeMetrics(metrics, extractStats(body));
            mergeMetrics(metrics, extractComponentStats(body).metrics);
            if (/getSquadData/i.test(url)) {
              try {
                const json = JSON.parse(body);
                mergeMetrics(metrics, extractJsonStats(json));
              } catch {
                // ignore malformed json
              }
            }
          } catch {
            // ignore interceptor parse errors
          }
        };

        this.page.on('response', responseHandler);
        try {
          try {
            await this.page.goto(`${this.baseUrl}/admin/squad_console?id=${squadId}&type=offline`, {
              waitUntil: 'domcontentloaded',
              timeout: 12000,
            });
          } catch (error) {
            console.warn(`⚠️ MP余额页打开超时，改用已拦截响应继续解析: squad=${squadId}; error=${error.message}`);
          }
          await this.sleep(1200);
          const browserText = await this.page.evaluate(() => {
            const scriptText = Array.from(document.scripts)
              .map((script) => script.textContent || '')
              .join(' ');
            return `${document.body.innerText || ''} ${scriptText}`;
          }).catch(() => '');
          mergeMetrics(metrics, extractStats(browserText));
          mergeMetrics(metrics, extractComponentStats(browserText).metrics);
        } finally {
          this.page.off('response', responseHandler);
        }

        if ((metrics.minipin == null && metrics.coupon == null) && interceptedUrls.length > 0) {
          console.warn(`⚠️ MP余额未解析成功，但已拦截相关接口: squad=${squadId}; urls=${interceptedUrls.join(' | ')}`);
        }
      });
    }

    if (metrics.minipin == null && metrics.coupon == null) {
      const preview = componentProbe.snippets.length
        ? componentProbe.snippets.join(' || ')
        : String(html || '').replace(/\s+/g, ' ').slice(0, 800);
      console.warn(`⚠️ 未识别到 MP 余额数据: squad=${squadId}; preview=${preview}`);
    }

    return {
      classCode: classCode || classId,
      squadId,
      ...metrics,
    };
  }

  /**
   * 读取教务端逐学生 MP/CP 流水，用于核对“请求已提交但回包未知”的批次。
   * 只读，不会触发任何发放或回收操作。
   */
  async getMinipinGrantRecords(classId, { startedAt, endedAt } = {}) {
    const { classCode, squadId } = await this.resolveSquadId(classId);
    const start = new Date(startedAt || Date.now());
    const end = new Date(endedAt || startedAt || Date.now());
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new Error('MiniPin 流水核对时间无效');
    }
    if (end.getTime() < start.getTime()) {
      throw new Error('MiniPin 流水核对结束时间早于开始时间');
    }

    const [{ text: consolePage }, studentListResp] = await Promise.all([
      this.requestText(
        `/admin/squad_console?id=${encodeURIComponent(squadId)}&type=offline`,
        { headers: { accept: 'text/html' } },
      ),
      this.request(
        `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
        { headers: { accept: 'application/json' } },
      ),
    ]);
    const studentListData = await studentListResp.json().catch(() => ({}));
    if (!Array.isArray(studentListData?.data)) {
      throw new Error(String(studentListData?.msg || 'MiniPin 流水学生名单读取失败'));
    }
    const studentNoById = new Map(studentListData.data.map((student) => [
      String(student?.id || ''),
      String(student?.no || '').trim(),
    ]));
    const csrfToken = this.extractLoginToken(consolePage) || '';
    const rows = [];
    const pageSize = 200;

    for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
      const query = new URLSearchParams({
        squad_id: String(squadId),
        squad_type: 'offline',
        type: '',
        get_way: '',
        student_id: '',
        // The production CNF endpoint currently returns an empty result when
        // these date filters are populated. Keep the required fields empty
        // and apply the precise timestamp window locally below.
        start_at: '',
        end_at: '',
        _token: csrfToken,
        'sort[sortBy]': 'id',
        'sort[orderBy]': 'desc',
        'page[pageSize]': String(pageSize),
        'page[pageNumber]': String(pageNumber),
      });
      const response = await this.request(
        `/admin/squad/cop_mip/getSquadStudent?${query.toString()}`,
        { headers: { accept: 'application/json' } },
      );
      const payload = await response.json().catch(() => ({}));
      if (Number(payload?.code) !== 1 || !Array.isArray(payload?.data?.rows)) {
        throw new Error(String(payload?.msg || `MiniPin 流水读取失败: HTTP ${response.status}`));
      }
      rows.push(...payload.data.rows);
      const total = Math.max(0, Number(payload?.data?.total) || 0);
      if (rows.length >= total || payload.data.rows.length < pageSize) break;
      const pageTimes = payload.data.rows
        .map((row) => Date.parse(parseCnfLocalDateTime(row?.add_at)))
        .filter(Number.isFinite);
      if (pageTimes.length > 0 && Math.min(...pageTimes) <= start.getTime()) break;
    }

    return rows.map((row) => ({
      id: String(row?.id || '').trim(),
      classCode: classCode || String(classId || ''),
      squadId: String(squadId),
      studentNo: studentNoById.get(String(row?.student_id || '')) || '',
      amount: minipinRecordAmount(row),
      occurredAt: parseCnfLocalDateTime(row?.add_at),
      type: String(row?.type_name || row?.type || '').trim(),
      grantName: String(row?.grant_name || '').trim(),
      tagName: String(row?.tag_name || '').trim(),
      addedBy: String(row?.add_user_name || '').trim(),
    })).filter((record) => {
      const occurredAt = Date.parse(record.occurredAt);
      return record.studentNo
        && record.amount !== null
        && Number.isFinite(occurredAt)
        && occurredAt >= start.getTime()
        && occurredAt <= end.getTime();
    });
  }

  /**
   * 读取学生持有的 MiniPin、Coupon 以及可用回收原因。
   * 回收前必须重新调用本方法，不能依赖页面缓存。
   */
  async getMinipinRecoveryContext(classId) {
    const { classCode, squadId } = await this.resolveSquadId(classId);
    const { text: consolePage } = await this.requestText(
      `/admin/squad_console?id=${encodeURIComponent(squadId)}&type=offline`,
      { headers: { accept: 'text/html' } },
    );
    const query = new URLSearchParams({
      name: '',
      _token: this.extractLoginToken(consolePage) || '',
      squad_id: String(squadId),
      squad_type: 'offline',
      'sort[sortBy]': 'id',
      'sort[orderBy]': 'desc',
      'page[total]': '0',
      'page[pageNumber]': '1',
      'page[pageSize]': '100',
    });
    const [studentResp, tagResp] = await Promise.all([
      this.request(`/admin/squad/cop_mip/getStudentData?${query.toString()}`, {
        headers: { accept: 'application/json' },
      }),
      this.request(`/admin/squad/cop_mip/getTableDataTag?${query.toString()}&type=2`, {
        headers: { accept: 'application/json' },
      }),
    ]);
    const [studentPayload, tagPayload] = await Promise.all([
      studentResp.json().catch(() => ({})),
      tagResp.json().catch(() => ({})),
    ]);
    const studentRows = Array.isArray(studentPayload?.data?.students) ? [...studentPayload.data.students] : Array.isArray(studentPayload?.data?.rows)
      ? studentPayload.data.rows
      : Array.isArray(studentPayload?.data) ? studentPayload.data : [];
    const tagRows = Array.isArray(tagPayload?.data?.rows)
      ? tagPayload.data.rows
      : Array.isArray(tagPayload?.data) ? tagPayload.data : [];
    if (!studentResp.ok || Number(studentPayload?.code) !== 1 || studentRows.length === 0) {
      throw new Error(String(studentPayload?.msg || `学生 MiniPin 余额读取失败: HTTP ${studentResp.status}`));
    }
    if (!tagResp.ok || Number(tagPayload?.code) !== 1 || tagRows.length === 0) {
      throw new Error(String(tagPayload?.msg || `MiniPin 回收原因读取失败: HTTP ${tagResp.status}`));
    }
    const expected = Number(studentPayload?.data?.count ?? studentPayload?.data?.total ?? studentRows.length);
    for (let page = 2; studentRows.length < expected && page <= 100; page += 1) {
      query.set('page[pageNumber]', String(page));
      const response = await this.request(`/admin/squad/cop_mip/getStudentData?${query}`, { headers: { accept: 'application/json' } });
      const payload = await response.json();
      const rows = payload?.data?.students || payload?.data?.rows;
      if (!response.ok || Number(payload?.code) !== 1 || !Array.isArray(rows) || !rows.length) throw new Error('学生余额分页读取不完整，本次已停止。');
      studentRows.push(...rows);
    }
    if (studentRows.length < expected) throw new Error('学生余额名单不完整，本次已停止。');
    const students = studentRows.map((item) => {
      const mp = Number(item?.mp_number);
      const cp = Number(item?.cp_number);
      if (item?.mp_number == null || item?.cp_number == null || !Number.isFinite(mp) || !Number.isFinite(cp) || mp < 0 || cp < 0) throw new Error('学生余额格式无法核验，本次已停止。');
      return {
        id: String(item?.id || '').trim(),
        no: String(item?.no || '').trim(),
        enName: String(item?.en_name || '').trim(),
        chName: String(item?.ch_name || '').trim(),
        mp,
        cp,
        availableMp: Number((mp + cp / 10).toFixed(1)),
      };
    }).filter((item) => item.id && item.no);
    if (students.length !== studentRows.length || new Set(students.map((item) => item.no)).size !== students.length) throw new Error('学生名单缺少学号或存在重复，本次已停止。');
    const tags = tagRows.map((item) => ({
      ...Object.fromEntries(Object.entries(item || {}).filter(([, value]) => (
        ['string', 'number', 'boolean'].includes(typeof value)
      ))),
      id: String(item?.id || '').trim(),
      name: String(item?.name || '').trim(),
    })).filter((item) => item.id && item.name);
    const defaultReason = tags.find((item) => item.name === '行为习惯')?.name || '';
    if (!defaultReason) throw new Error('教务系统当前没有“行为习惯”回收原因，本次已停止。');
    return {
      classCode: classCode || String(classId || ''),
      squadId: String(squadId),
      students,
      tags,
      defaultReason,
      readAt: new Date().toISOString(),
    };
  }

  /**
   * 批量回收 MiniPin。一次调用只发送一个批量请求，结果不确定时绝不重试。
   */
  async recoverMinipinDirect(classId, recoveries, reasonName = '行为习惯') {
    const startedAt = performance.now();
    const context = await this.getMinipinRecoveryContext(classId);
    const reason = context.tags.find((item) => item.name === String(reasonName || '').trim());
    if (!reason) throw new Error(`教务系统当前没有“${String(reasonName || '').trim()}”回收原因，本次已停止。`);

    const byNo = new Map(context.students.map((student) => [student.no, student]));
    const seen = new Set();
    const rows = [];
    for (const item of Array.isArray(recoveries) ? recoveries : []) {
      const studentNo = String(item?.studentId || '').trim();
      const amount = Number(item?.amount);
      if (!studentNo || seen.has(studentNo)) throw new Error('回收名单中存在空学号或重复学生，本次已停止。');
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 10 - Math.round(amount * 10)) > 1e-8) {
        throw new Error(`学号 ${studentNo} 的回收数量必须是大于 0 的 0.1 MP 倍数。`);
      }
      const student = byNo.get(studentNo);
      if (!student) throw new Error(`实时名单中没有学号 ${studentNo}，本次已停止。`);
      const normalizedAmount = Math.round(amount * 10) / 10;
      if (student.availableMp + 1e-8 < normalizedAmount) {
        throw new Error(`${student.enName || student.chName || studentNo} 当前仅有 ${student.availableMp} MP，不足以回收 ${normalizedAmount} MP；整批未提交。`);
      }
      seen.add(studentNo);
      rows.push({ student, amount: normalizedAmount });
    }
    if (rows.length === 0) throw new Error('没有可回收的学生数据。');

    const { text: consolePage } = await this.requestText(
      `/admin/squad_console?id=${encodeURIComponent(context.squadId)}&type=offline`,
      { headers: { accept: 'text/html' } },
    );
    const csrfToken = this.extractLoginToken(consolePage);
    const xsrfCookie = this.getDecodedCookieValue('XSRF-TOKEN');
    const totalMP = Number(rows.reduce((sum, item) => sum + item.amount, 0).toFixed(1));
    const form = new URLSearchParams({
      squad_type: 'offline',
      squad_id: context.squadId,
      type: '2',
      number: String(totalMP),
      _token: csrfToken || '',
    });
    rows.forEach(({ student, amount }, index) => {
      form.append(`student_arr[${index}][id]`, student.id);
      for (const [key, value] of Object.entries(reason)) {
        if (key === 'number' || value === null || value === undefined) continue;
        form.append(`student_arr[${index}][tag][0][${key}]`, String(value));
      }
      form.append(`student_arr[${index}][tag][0][number]`, String(amount));
      form.append(`student_arr[${index}][number]`, String(amount));
    });

    let response;
    let body = '';
    try {
      response = await this.request('/admin/squad/cop_mip/recoverBatch', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          accept: 'application/json, text/html, */*',
          'content-type': 'application/x-www-form-urlencoded',
          ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
        },
        body: form.toString(),
      });
      body = await response.text();
    } catch (error) {
      throw new Error(`MiniPin 回收结果无法确认：${error instanceof Error ? error.message : String(error)}。请先到教务系统核对，禁止自动重试。`);
    }
    let payload = null;
    try { payload = JSON.parse(body); } catch { payload = null; }
    if (response.ok && Number(payload?.code) === 1) {
      console.log(`✅ 批量回收成功: ${rows.length} 人, 共 ${totalMP} MP (${Math.round(performance.now() - startedAt)}ms)`);
      return {
        success: rows.length,
        failed: 0,
        successList: rows.map(({ student }) => student.enName || student.chName),
        failedList: [],
        totalMP,
        reason: reason.name,
        method: 'cop_mip_recoverBatch',
      };
    }
    if (Number(payload?.code) === 0 || (response.status >= 400 && response.status < 500)) {
      throw new Error(String(payload?.msg || `MiniPin 回收被教务系统拒绝: HTTP ${response.status}`));
    }
    throw new Error(`MiniPin 回收结果无法确认：HTTP ${response.status}。请先到教务系统核对，禁止自动重试。`);
  }

  /**
   * 发放 Minipin 奖励 — HTTP 直调版本（不依赖 Puppeteer）
   */
  async submitMinipinDirect(classId, rewards) {
    const startedAt = performance.now();
    const { classCode, squadId } = await this.resolveSquadId(classId);
    console.log(`🔄 开始直接发放 MP: 班级=${classCode || classId} (squad=${squadId}), ${rewards.length} 条奖励`);

    // 1. 获取学生名单用于匹配
    const listResp = await this.request(
      `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
      { headers: { accept: 'application/json' } }
    );
    const listData = await listResp.json().catch(() => ({}));
    if (!Array.isArray(listData?.data)) throw new Error(String(listData?.msg || `学生名单获取失败: ${listResp.status}`));

    const cnfStudents = listData.data.map((item) => ({
      id: Number(item?.id) || 0, no: String(item?.no || '').trim(),
      enName: String(item?.en_name || '').trim(), chName: String(item?.ch_name || '').trim(),
    }));

    // 2. 匹配学生
    const successList = [], failedList = [], matchedRows = [];
    for (const reward of rewards) {
      if (!reward.amount || reward.amount <= 0) continue;
      const aliases = [reward.studentName, reward.chineseName, ...(reward.aliases || [])].filter(Boolean).map(n => n.trim().toLowerCase());
      const studentId = String(reward.studentId || '').trim();
      let matched = studentId ? cnfStudents.find(s => s.no === studentId) : null;
      if (!matched) matched = cnfStudents.find(s => aliases.some(a => a === s.enName.toLowerCase() || a === s.chName.toLowerCase()));
      if (!matched) matched = cnfStudents.find(s => aliases.some(a => s.enName.toLowerCase().includes(a) || a.includes(s.enName.toLowerCase())));
      if (!matched) { failedList.push({ studentId: reward.studentId, name: reward.studentName, chineseName: reward.chineseName, error: '未匹配到学生' }); continue; }
      matchedRows.push({ enName: matched.enName, chName: matched.chName, no: matched.no, amount: Math.round(reward.amount * 10) / 10 });
      successList.push(reward.studentName);
    }

    if (matchedRows.length === 0) return { success: 0, failed: failedList.length, successList: [], failedList, totalMP: 0 };

    const totalMP = Number(matchedRows.reduce((sum, r) => sum + r.amount, 0).toFixed(1));
    console.log(`   准备提交: ${matchedRows.length} 人, 共 ${totalMP} MP`);

    // 3. 获取 CSRF token
    const { text: consolePage } = await this.requestText(`/admin/squad_console?id=${squadId}&type=offline`, { headers: { accept: 'text/html' } });
    const csrfToken = this.extractLoginToken(consolePage);
    const xsrfCookie = this.getDecodedCookieValue('XSRF-TOKEN');
    const headers = {
      accept: 'application/json, text/html, */*',
      ...(xsrfCookie ? { 'x-xsrf-token': xsrfCookie } : {}),
    };

    // 4. 优先走已验证通过的 uploadGrant 接口
    let tagId = '10';
    let tagName = 'MP奖励';
    try {
      const tagResp = await this.request(
        `/admin/squad/cop_mip/getTableDataTag?squad_id=${encodeURIComponent(squadId)}&squad_type=offline&type=1&page[current]=1&page[size]=100`,
        { headers: { accept: 'application/json' } }
      );
      const tagData = await tagResp.json().catch(() => ({}));
      const rows = Array.isArray(tagData?.data?.rows) ? tagData.data.rows : [];
      const preferred = rows.find((item) => String(item?.name || '').includes('MP')) || rows[0];
      if (preferred?.id) {
        tagId = String(preferred.id);
        tagName = String(preferred.name || tagName);
      }
    } catch (error) {
      console.warn(`   获取 tag 失败，回退默认 tag: ${error.message}`);
    }

    const uploadGrantParams = new URLSearchParams();
    uploadGrantParams.append('squad_id', String(squadId));
    uploadGrantParams.append('squad_type', 'offline');
    uploadGrantParams.append('_token', csrfToken || '');
    uploadGrantParams.append('number', String(Math.round(totalMP * 10)));
    uploadGrantParams.append('tag_id', String(tagId));
    uploadGrantParams.append('tag_name', tagName);

    matchedRows.forEach((row, index) => {
      uploadGrantParams.append(`student_arr[${index}][no]`, row.no);
      uploadGrantParams.append(`student_arr[${index}][en_name]`, row.enName);
      uploadGrantParams.append(`student_arr[${index}][ch_name]`, row.chName);
      uploadGrantParams.append(`student_arr[${index}][number]`, String(row.amount));
    });

    const uploadGrantResp = await this.request('/admin/squad/cop_mip/uploadGrant', {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: uploadGrantParams.toString(),
    });
    const uploadGrantBody = await uploadGrantResp.text().catch(() => '');
    console.log(`   uploadGrant: ${uploadGrantResp.status} ${uploadGrantBody.slice(0, 200)}`);
    let uploadGrantData = null;
    if (uploadGrantResp.status >= 200 && uploadGrantResp.status < 300) {
      uploadGrantData = (() => {
        try {
          return JSON.parse(uploadGrantBody);
        } catch {
          return null;
        }
      })();
      const isSuccess = Number(uploadGrantData?.code) === 1;
      if (isSuccess) {
        const elapsed = Number((performance.now() - startedAt).toFixed(0));
        console.log(`✅ 直接发放成功: ${matchedRows.length} 人, 共 ${totalMP} MP (${elapsed}ms)`);
        return { success: matchedRows.length, failed: failedList.length, successList, failedList, totalMP, method: 'cop_mip_uploadGrant' };
      }
      console.warn(`   uploadGrant 未成功确认: ${uploadGrantData?.msg || uploadGrantBody.slice(0, 120)}`);
    }
    const uploadGrantDefinitelyRejected = ([400, 401, 403, 404, 405, 422].includes(uploadGrantResp.status))
      || (uploadGrantData && Number(uploadGrantData.code) === 0);
    if (!uploadGrantDefinitelyRejected) {
      throw new Error(`uploadGrant 发放结果未确认: HTTP ${uploadGrantResp.status}`);
    }

    // Stop after the confirmed attempt. Historical fallback write endpoints
    // cannot establish idempotency and must not be tried automatically.
    const failure = String(uploadGrantData?.msg || `教务系统拒绝发放：HTTP ${uploadGrantResp.status}`).slice(0, 300);
    return {
      success: 0, failed: rewards.length, successList: [],
      failedList: [...failedList, ...matchedRows.map((row) => ({
        studentId: row.no, name: row.enName, chineseName: row.chName, error: failure,
      }))],
      totalMP: 0, method: 'cop_mip_uploadGrant', retryable: false,
    };
  }

  /**
   * 发放 Minipin 奖励 — Puppeteer 版本（已废弃，仅保留兜底）
   * @deprecated 优先使用 submitMinipinDirect
   */
  async submitMinipinRewards(classId, rewards) {
    return this.runBrowserTask(`minipin-fallback:${classId}`, async () => {
      await this.gotoSquadConsole(classId);
      await this.sleep(1200);

    // 找到 coupon-minipin 管理入口
    const minipinLink = await this.page.$('a[href*="minipin"], a[href*="coupon"]');
    if (!minipinLink) {
      // 尝试通过文字找
      const links = await this.page.$$('a');
      let found = null;
      for (const link of links) {
        const text = await link.evaluate(el => el.textContent);
        if (text && (text.includes('minipin') || text.includes('Minipin') || text.includes('coupon') || text.includes('货币'))) {
          found = link;
          break;
        }
      }
      if (!found) {
        throw new Error('未找到 Minipin 管理入口，请检查页面结构');
      }
      await found.click();
    } else {
      await minipinLink.click();
    }
    await this.sleep(1500);

    const successList = [];
    const failedList = [];

    for (const reward of rewards) {
      try {
        // 在页面中查找学生行
        const rows = await this.page.$$('tr, .student-row, .list-item');
        let targetRow = null;
        const aliases = [reward.studentName, ...(reward.aliases || [])].filter(Boolean);
        for (const row of rows) {
          const text = await row.evaluate(el => el.textContent);
          if (text && aliases.some((name) => text.includes(name))) {
            targetRow = row;
            break;
          }
        }

        if (!targetRow) {
          failedList.push({ name: reward.studentName, error: '未找到学生' });
          continue;
        }

        // 找金额输入框
        const amountInput = await targetRow.$('input[type="number"], input[type="text"]');
        if (amountInput) {
          await amountInput.click({ clickCount: 3 });
          await amountInput.type(String(reward.amount));
        }

        // 找发放按钮
        const grantBtn = await targetRow.$('button');
        if (grantBtn) {
          await grantBtn.click();
          await this.sleep(600);
        }

        successList.push(reward.studentName);
      } catch (e) {
        failedList.push({ studentId: reward.studentId, name: reward.studentName, error: e.message });
      }
    }

      return {
        success: successList.length,
        failed: failedList.length,
        successList,
        failedList,
      };
    });
  }

  close() {
    return this.getBrowserRuntime().close();
  }

}

module.exports = EducationSystemScraper;
