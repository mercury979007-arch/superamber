const express = require('express');

function toPublicSnapshot(snapshot) {
  if (!snapshot) return null;
  const {
    speakingChallengeMeta,
    dailyReportPublicities: _dailyReportPublicities,
    dailyReportPublicityFailures: _dailyReportPublicityFailures,
    ...publicSnapshot
  } = snapshot;
  return {
    ...publicSnapshot,
    dailyReportTasks: Object.values(snapshot.dailyReportTasks || {}).map((task) => ({
      classId: task.classId,
      preferredSemester: task.preferredSemester || '',
      weekTasks: task.weekTasks || [],
      defaultSelectedWeekIds: task.defaultSelectedWeekIds || [],
      defaultCheckinRange: task.defaultCheckinRange || {},
      updatedAt: task.updatedAt || '',
    })),
    speakingChallenges: Object.values(speakingChallengeMeta || {}),
  };
}

function createRosterSnapshotRoutes({ requireLoggedInSession, service, buildContext = () => ({}) }) {
  const router = express.Router();

  router.get('/data/roster-snapshot', async (req, res) => {
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;
      res.setHeader('Cache-Control', 'no-store');
      const result = await service.get(session.username);
      res.json({ status: 'success', ...result, snapshot: toPublicSnapshot(result.snapshot) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/data/roster-snapshot/refresh', async (req, res) => {
    let session = null;
    try {
      session = requireLoggedInSession(req, res);
      if (!session) return;
      res.setHeader('Cache-Control', 'no-store');
      const result = await service.refresh({
        username: session.username,
        scraper: session.scraper,
        reason: req.body?.reason || 'manual',
        context: buildContext(),
      });
      res.json({
        status: result.snapshot.failures.length > 0
          || result.snapshot.taskFailures?.length > 0
          || result.snapshot.speakingFailures?.length > 0
          || result.snapshot.dailyReportPublicityFailures?.length > 0
          ? 'partial'
          : 'success',
        ...result,
        snapshot: toPublicSnapshot(result.snapshot),
      });
    } catch (error) {
      const fallback = res.headersSent || !session
        ? null
        : await service.get(session.username).catch(() => null);
      if (!res.headersSent) {
        res.status(502).json({ error: error.message, snapshot: toPublicSnapshot(fallback?.snapshot || null) });
      }
    }
  });

  return router;
}

module.exports = { createRosterSnapshotRoutes, toPublicSnapshot };
