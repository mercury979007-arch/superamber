const { Router } = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { createCheckinWorkbookFromPunchRows, createStudentWorkbookFromTableRows } = require('../dailyReportWorkbook');
const { fetchCheckinRowsForRange, formatDateOnly } = require('../lib/checkinApi');
const { createDailyReportExportService } = require('../services/dailyReportExportService');
const { createAutoDailyReportService } = require('../services/autoDailyReportService');
const {
  buildDailyReportPrompt,
  buildFastDailyReport,
  generateDailyReport,
  translateWordToChinese,
} = require('../services/dailyReportTextService');

function createReportRoutes({
  ensureSession,
  requireLoggedInSession,
  buildUsageEvent,
  appendUsageEvent,
  USAGE_LOG_PATH,
  REPORT_SCRIPT_DIR,
  DEFAULT_WEEK1_START,
}) {
  const router = Router();
  const {
    decodeBase64File,
    inferClassNameFromFilename,
    buildAndSendDailyReport,
  } = createDailyReportExportService({
    buildUsageEvent,
    appendUsageEvent,
    usageLogPath: USAGE_LOG_PATH,
    reportScriptDir: REPORT_SCRIPT_DIR,
  });
  const autoDailyReportService = createAutoDailyReportService({
    defaultWeek1Start: DEFAULT_WEEK1_START,
    formatDateOnly,
  });

  // ── Routes ──────────────────────────────────────────────────────────────────

  router.post('/ai/daily-report', async (req, res) => {
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

  router.post('/reports/class-daily-report', async (req, res) => {
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
        usageDetail: reportMode === 'detail' ? 'detail' : 'standard',
        studentWorkbookBuilder: async (studentPath) => {
          await fs.writeFile(studentPath, student.buffer);
        },
      });
    } catch (error) {
      console.error('❌ 班级日报文件生成失败:', error.message);
      res.status(500).json({ error: error.message || '班级日报生成失败' });
    }
  });

  router.post('/reports/class-daily-report-from-publicity', async (req, res) => {
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

      const publicity = await session.scraper.scrapePublicityExportData(classId, {
        selectedTasks,
        preferredYear,
        preferredSemester,
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

  router.post('/reports/auto-daily-report/tasks', async (req, res) => {
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const { classId } = req.body || {};
      if (!classId) {
        return res.status(400).json({ error: '缺少 classId' });
      }

      const defaults = autoDailyReportService.getPreferredAcademicWindow();
      const taskInfo = await session.scraper.scrapePublicityTaskList(classId, defaults);
      session.autoDailyReport = autoDailyReportService.buildAutoDailyReportState({
        classId,
        taskInfo,
        preferredYear: defaults.preferredYear,
        preferredSemester: defaults.preferredSemester,
      });
      const taskPayload = autoDailyReportService.buildWeekTasksPayload(session.autoDailyReport);

      console.log('[DEBUG-TASKS] taskGroups raw:', JSON.stringify(taskInfo.taskGroups?.map((group) => ({
        name: group.name,
        id: group.id,
        sourceLabel: group.sourceLabel,
        tasks: group.tasks?.slice(0, 2),
      })) || [], null, 2));
      console.log('[DEBUG-TASKS] groupedWeeks:', JSON.stringify((session.autoDailyReport.weekGroups || []).map((week) => ({
        id: week.id,
        name: week.name,
        sourceLabels: week.sourceLabels,
        resourceCount: week.resourceCount,
      })), null, 2));
      console.log('[DEBUG-TASKS] defaultSelectedWeekIds:', taskPayload.defaultSelectedWeekIds);
      console.log('[DEBUG-TASKS] previousWeekRange:', taskPayload.defaultCheckinRange.start, '-', taskPayload.defaultCheckinRange.end);

      res.json(taskPayload);
    } catch (error) {
      console.error('❌ 获取自动日报任务失败:', error.message);
      res.status(500).json({ error: error.message || '获取自动日报任务失败' });
    }
  });

  router.post('/reports/auto-daily-report', async (req, res) => {
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

      const defaults = autoDailyReportService.getPreferredAcademicWindow();
      if (!session.autoDailyReport || session.autoDailyReport.classId !== String(classId)) {
        const taskInfo = await session.scraper.scrapePublicityTaskList(classId, defaults);
        session.autoDailyReport = autoDailyReportService.buildAutoDailyReportState({
          classId,
          taskInfo,
          preferredYear: defaults.preferredYear,
          preferredSemester: defaults.preferredSemester,
        });
      }

      const publicitySelection = autoDailyReportService.buildPublicitySelection(
        session.autoDailyReport,
        selectedWeekIds
      );
      if (publicitySelection.selectedTasks.length === 0) {
        return res.status(400).json({ error: '未匹配到所选周任务' });
      }

      const publicity = await session.scraper.scrapePublicityExportData(classId, publicitySelection);

      let checkinWorkbookBuilder = null;
      if (includeCheckin) {
        const previousWeekRange = autoDailyReportService.getPreviousWeekDateRange();
        const resolvedRangeStart = String(checkinRangeStart || formatDateOnly(previousWeekRange.start)).trim();
        const resolvedRangeEnd = String(checkinRangeEnd || formatDateOnly(previousWeekRange.end)).trim();
        try {
          const apiCheckin = await fetchCheckinRowsForRange(session.scraper, {
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
          throw new Error(`自动打卡暂不可用：${httpError.message}。为避免导出不可信的打卡结果，请先关闭"每日打卡"后导出；如需带打卡，请改用人工上传打卡文件。`);
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

  router.post('/reports/distribution-import/basic-file', async (req, res) => {
    let tempDir = '';
    try {
      const session = requireLoggedInSession(req, res);
      if (!session) return;

      const {
        classId,
        className = '',
        selectedWeekIds = [],
      } = req.body || {};
      if (!classId) {
        return res.status(400).json({ error: '缺少 classId' });
      }

      const defaults = autoDailyReportService.getPreferredAcademicWindow();
      const taskInfo = await session.scraper.scrapePublicityTaskList(classId, defaults);
      const autoDailyReport = autoDailyReportService.buildAutoDailyReportState({
        classId,
        taskInfo,
        preferredYear: defaults.preferredYear,
        preferredSemester: defaults.preferredSemester,
      });
      const effectiveWeekIds = autoDailyReportService.resolveEffectiveWeekIds(autoDailyReport, selectedWeekIds);
      const publicitySelection = autoDailyReportService.buildPublicitySelection(autoDailyReport, effectiveWeekIds);
      if (publicitySelection.selectedTasks.length === 0) {
        return res.status(400).json({ error: '当前班级没有可导出的周任务' });
      }

      const publicity = await session.scraper.scrapePublicityExportData(classId, publicitySelection);

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

  router.post('/reports/distribution-import/daily-checkin-file', async (req, res) => {
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

      const defaults = autoDailyReportService.getPreferredAcademicWindow();
      let preferredSemester = defaults.preferredSemester;
      if (!session.autoDailyReport || session.autoDailyReport.classId !== String(classId)) {
        const taskInfo = await session.scraper.scrapePublicityTaskList(classId, defaults);
        session.autoDailyReport = autoDailyReportService.buildAutoDailyReportState({
          classId,
          taskInfo,
          preferredYear: defaults.preferredYear,
          preferredSemester: defaults.preferredSemester,
        });
      }
      preferredSemester = session.autoDailyReport.preferredSemester;

      const previousWeekRange = autoDailyReportService.getPreviousWeekDateRange();
      const resolvedRangeStart = String(checkinRangeStart || formatDateOnly(previousWeekRange.start)).trim();
      const resolvedRangeEnd = String(checkinRangeEnd || formatDateOnly(previousWeekRange.end)).trim();
      const apiCheckin = await fetchCheckinRowsForRange(session.scraper, {
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

  // Expose translateWordToChinese for ocrRoutes
  router._translateWordToChinese = translateWordToChinese;

  return router;
}

module.exports = { createReportRoutes };
