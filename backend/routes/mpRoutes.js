const { Router } = require('express');
const { rejectIfTestOnlyRouteBlocked } = require('../lib/testOnlyAccess');

function createMpRoutes({
  requireLoggedInSession,
  buildUsageEvent,
  appendUsageEvent,
  USAGE_LOG_PATH,
  sanitizeText,
  collectFailedRewardIds,
}) {
  const router = Router();

  // ── 探测 cop_mip 发放接口（临时调试用）────────────────────────────────────────
  router.post('/debug/probe-copmip', async (req, res) => {
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
  router.post('/mp/balance', async (req, res) => {
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

  // ── MP 直接发放 ──────────────────────────────────────────────────────────────
  router.post('/scraper/submit-minipin', async (req, res) => {
    let normalizedRewards = [];
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const { classId, rewards, className = '' } = req.body || {};
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
        }))
        .filter((reward) => reward.studentName && reward.amount > 0);

      if (normalizedRewards.length === 0) {
        return res.status(400).json({ error: '没有可发放的奖励' });
      }

      const result = await session.scraper.submitMinipinDirect(String(classId), normalizedRewards);
      const failedStudentIds = collectFailedRewardIds(normalizedRewards, result?.failedList);
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
        });
      }
      res.json({ status: 'success', ...result, failedStudentIds });
    } catch (error) {
      console.error('❌ 发放奖励失败:', error.message);
      res.status(500).json({
        error: error.message,
        failedStudentIds: normalizedRewards.map((reward) => reward.studentId).filter(Boolean),
      });
    }
  });

  return router;
}

module.exports = { createMpRoutes };
