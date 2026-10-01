const express = require('express');
const { appendUsageEvent, readUsageEvents, summarizeUsageEvents } = require('../lib/usageAnalytics');
const { rejectIfTestOnlyRouteBlocked } = require('../lib/testOnlyAccess');

function createUsageRouter({ ensureSession, buildUsageEvent, usageLogPath, usageSummaryLogPath }) {
  const router = express.Router();

  router.post('/usage-events', async (req, res) => {
    try {
      const { session } = ensureSession(req, res);
      const event = buildUsageEvent(req, session, req.body || {});
      if (!event.event || event.event === 'unknown') {
        return res.status(400).json({ error: '缺少 event' });
      }
      await appendUsageEvent(usageLogPath, event);
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('❌ 使用统计写入失败:', error.message);
      res.status(500).json({ error: '使用统计写入失败' });
    }
  });

  router.get('/admin/usage-summary', async (req, res) => {
    try {
      if (rejectIfTestOnlyRouteBlocked(req, res, '该页面仅在测试站开放')) {
        return;
      }
      const { session } = ensureSession(req, res);
      const hostname = String(req.hostname || '').toLowerCase();
      const isLocalRequest = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (!isLocalRequest && !session?.username) {
        return res.status(401).json({ error: '请先登录后查看使用统计' });
      }
      const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
      const events = await readUsageEvents(usageSummaryLogPath, days);
      const sourceEnvironment = usageSummaryLogPath === usageLogPath
        ? 'current'
        : (String(usageSummaryLogPath).includes('/production/') ? 'production' : 'external');
      res.json({
        status: 'success',
        days,
        sourceEnvironment,
        summary: summarizeUsageEvents(events),
      });
    } catch (error) {
      console.error('❌ 使用统计汇总失败:', error.message);
      res.status(500).json({ error: '使用统计汇总失败' });
    }
  });

  return router;
}

module.exports = {
  createUsageRouter,
};
