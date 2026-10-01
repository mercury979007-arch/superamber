const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_ADMIN_PASSWORD = process.env.CAMP_REPORT_ADMIN_PASSWORD || '';

function getTemplateKey(majorCamp, minorCamp, dayIndex) {
  return `${String(majorCamp).trim()}__${String(minorCamp).trim()}__${Number(dayIndex) || 0}`;
}

function sanitizeText(value, maxLength = 10000) {
  return String(value ?? '').slice(0, maxLength);
}

function normalizeTemplate(input) {
  const majorCamp = sanitizeText(input?.majorCamp, 40).trim();
  const minorCamp = sanitizeText(input?.minorCamp, 80).trim();
  const dayIndex = Number(input?.dayIndex) || 0;
  if (!majorCamp || !minorCamp || dayIndex < 1 || dayIndex > 31) {
    return null;
  }

  return {
    id: sanitizeText(input?.id, 120).trim() || `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    majorCamp,
    minorCamp,
    dayIndex,
    defaultDisplayCampName: sanitizeText(input?.defaultDisplayCampName, 200),
    goalText: sanitizeText(input?.goalText, 20000),
    prepText: sanitizeText(input?.prepText, 20000),
    backgroundImage: sanitizeText(input?.backgroundImage, 800000),
    updatedAt: Number(input?.updatedAt) || Date.now(),
  };
}

function createCampReportTemplateRoutes({ templateStorePath, adminPassword } = {}) {
  const router = express.Router();
  const resolvedTemplateStorePath = templateStorePath || path.resolve(process.cwd(), 'data/camp-report-templates.json');
  const resolvedAdminPassword = String(adminPassword || process.env.CAMP_REPORT_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);

  async function readTemplates() {
    try {
      const raw = await fs.readFile(resolvedTemplateStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async function writeTemplates(templates) {
    await fs.mkdir(path.dirname(resolvedTemplateStorePath), { recursive: true });
    await fs.writeFile(resolvedTemplateStorePath, JSON.stringify(templates, null, 2), 'utf8');
  }

  function requireAdminPassword(req, res) {
    const password = String(req.body?.password || req.headers['x-camp-report-admin-password'] || '');
    if (password !== resolvedAdminPassword) {
      res.status(401).json({ error: '管理密码不正确' });
      return false;
    }
    return true;
  }

  router.get('/camp-report/templates', async (_req, res) => {
    try {
      res.json({
        status: 'success',
        templates: await readTemplates(),
      });
    } catch (error) {
      console.error('❌ 读取夏令营日报模板失败:', error.message);
      res.status(500).json({ error: '读取夏令营日报模板失败' });
    }
  });

  router.post('/camp-report/admin/unlock', (req, res) => {
    if (!requireAdminPassword(req, res)) return;
    res.json({ status: 'success' });
  });

  router.post('/camp-report/templates', async (req, res) => {
    try {
      if (!requireAdminPassword(req, res)) return;
      const template = normalizeTemplate(req.body?.template);
      if (!template) {
        return res.status(400).json({ error: '模板缺少大营、小营或 Day' });
      }
      const templates = await readTemplates();
      templates[getTemplateKey(template.majorCamp, template.minorCamp, template.dayIndex)] = {
        ...template,
        updatedAt: Date.now(),
      };
      await writeTemplates(templates);
      res.json({ status: 'success', template, templates });
    } catch (error) {
      console.error('❌ 保存夏令营日报模板失败:', error.message);
      res.status(500).json({ error: '保存夏令营日报模板失败' });
    }
  });

  router.post('/camp-report/templates/bulk', async (req, res) => {
    try {
      if (!requireAdminPassword(req, res)) return;
      const inputTemplates = Array.isArray(req.body?.templates) ? req.body.templates : [];
      const normalizedTemplates = inputTemplates.map(normalizeTemplate).filter(Boolean);
      if (normalizedTemplates.length === 0) {
        return res.status(400).json({ error: '没有可保存的模板' });
      }
      const templates = await readTemplates();
      normalizedTemplates.forEach((template) => {
        templates[getTemplateKey(template.majorCamp, template.minorCamp, template.dayIndex)] = {
          ...template,
          updatedAt: Date.now(),
        };
      });
      await writeTemplates(templates);
      res.json({ status: 'success', savedCount: normalizedTemplates.length, templates });
    } catch (error) {
      console.error('❌ 批量保存夏令营日报模板失败:', error.message);
      res.status(500).json({ error: '批量保存夏令营日报模板失败' });
    }
  });

  return router;
}

module.exports = {
  createCampReportTemplateRoutes,
  getTemplateKey,
  normalizeTemplate,
};
