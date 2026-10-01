const { Router } = require('express');
const { rejectIfTestOnlyRouteBlocked } = require('../lib/testOnlyAccess');

function createScraperRoutes({
  ensureSession,
  requireLoggedInSession,
  buildUsageEvent,
  appendUsageEvent,
  USAGE_LOG_PATH,
  CNF_BASE_URL,
  loginCNF,
  fetchWithJar,
  parseMySquadHtml,
  getTraceId,
  logTrace,
  saveSessionStore,
  EducationSystemScraper,
}) {
  const router = Router();

  router.post('/scraper/login', async (req, res) => {
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
      const classesFinishedAt = performance.now();
      const classes = classMap.map((item) => ({
        id: item.classCode,
        name: item.classCode,
        squadId: item.squadId,
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
      });

      res.json({
        status: 'success',
        message: '登录成功',
        traceId,
        classes,
        classCount: classes.length,
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

  router.post('/traces/login-client', (req, res) => {
    const traceId = String(req.body?.traceId || '').trim() || require('crypto').randomUUID();
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

  router.post('/scraper/get-classes', async (req, res) => {
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const classMap = await session.scraper.getClassMap(true);
      const classes = classMap.map((item) => ({
        id: item.classCode,
        name: item.classCode,
        squadId: item.squadId,
      }));
      console.log(`✅ 刷新班级: ${classes.length} 个`);
      res.json({ status: 'success', data: classes, count: classes.length });
    } catch (error) {
      console.error('❌ 获取班级失败:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/scraper/get-student-list', async (req, res) => {
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const { classId } = req.body || {};
      if (!classId) {
        return res.status(400).json({ error: '缺少班级ID' });
      }

      const { squadId } = await session.scraper.resolveSquadId(classId);
      const response = await session.scraper.request(
        `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
        { headers: { accept: 'application/json' } }
      );
      const data = await response.json().catch(() => ({}));
      if (!Array.isArray(data?.data)) {
        throw new Error(String(data?.msg || `学生名单获取失败: ${response.status}`));
      }

      const students = data.data.map((item) => ({
        no: String(item?.no || '').trim(),
        chName: String(item?.ch_name || '').trim(),
        enName: String(item?.en_name || '').trim(),
      }));

      console.log(`✅ 获取班级 ${classId} (squad=${squadId}) 学生名单: ${students.length} 人`);
      res.json({ status: 'success', data: students, count: students.length, squadId });
    } catch (error) {
      console.error('❌ 获取学生名单失败:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/scraper/batch-student-list', async (req, res) => {
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
            const response = await session.scraper.request(
              `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
              { headers: { accept: 'application/json' } }
            );
            const data = await response.json().catch(() => ({}));
            if (!Array.isArray(data?.data)) {
              throw new Error(String(data?.msg || `HTTP ${response.status}`));
            }
            return {
              classId,
              squadId,
              students: data.data.map((item) => ({
                no: String(item?.no || '').trim(),
                chName: String(item?.ch_name || '').trim(),
                enName: String(item?.en_name || '').trim(),
              })),
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

  router.post('/cnf-roster', async (req, res) => {
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
      const jar = useSharedSession ? null : await loginCNF(CNF_BASE_URL, username, password);

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

        const listResp = useSharedSession
          ? await sharedSession.scraper.request(
            `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=${encodeURIComponent(squadType)}`,
            { method: 'GET', headers: { Accept: 'application/json' } },
          )
          : await fetchWithJar(
            `${CNF_BASE_URL}/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=${encodeURIComponent(squadType)}`,
            { method: 'GET', headers: { Accept: 'application/json' } },
            jar,
          );
        const listData = await listResp.json().catch(() => ({}));
        if (!Array.isArray(listData?.data)) {
          throw new Error(String(listData?.msg || `学生名单获取失败: ${listResp.status}`));
        }

        const students = listData.data.map((item) => {
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

  return router;
}

module.exports = { createScraperRoutes };
