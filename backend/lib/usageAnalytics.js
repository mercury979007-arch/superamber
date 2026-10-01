const fs = require('fs/promises');
const path = require('path');

const TOOL_LABEL_BY_MODULE = {
  'mp-distribution': 'MiniPin发放',
  seating: '座位表',
  overview: '班级概览',
  makeup: '补课助手',
  'daily-report': '班级日报',
  roster: '班级名单',
  'class-hub': '班级Hub',
  welcome: '欢迎页',
  auth: '登录',
  'usage-insights': '使用情况',
  'speaking-challenge': '每日开口挑战',
  'camp-report': '夏令营日报',
  'summer-camp': '夏令营',
  'test-score-entry': '测试成绩录入',
};

const ACTION_LABEL_BY_EVENT = {
  screen_view: '打开功能',
  select_class: '选择班级',
  login_success: '登录成功',
  minipin_issued: '发放 MiniPin',
  minipin_recovered: '回收 MiniPin',
  report_exported: '导出日报',
};

function toMpTenths(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 10);
}

function sanitizeText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

async function appendUsageEvent(logPath, event) {
  const line = `${JSON.stringify(event)}\n`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, 'utf8');
}

async function readUsageEvents(logPath, days = 30) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    const minTime = Date.now() - (Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((item) => {
        const ts = Date.parse(String(item.ts || ''));
        return Number.isFinite(ts) && ts >= minTime;
      });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function toSortedEntries(record, keyName, valueName = 'count') {
  return Object.entries(record)
    .map(([key, count]) => ({ [keyName]: key, [valueName]: count }))
    .sort((a, b) => (
      Number(b[valueName]) - Number(a[valueName])
      || String(a[keyName]).localeCompare(String(b[keyName]), 'zh-Hans-CN')
    ));
}

function getUsageToolLabel(moduleName) {
  const normalized = sanitizeText(moduleName || 'unknown');
  return TOOL_LABEL_BY_MODULE[normalized] || normalized || '未命名';
}

function getUsageActionLabel(eventName) {
  const normalized = sanitizeText(eventName || 'unknown');
  return ACTION_LABEL_BY_EVENT[normalized] || normalized || '未命名操作';
}

function isIdentifiedTeacher(teacherName) {
  const normalized = sanitizeText(teacherName).toLowerCase();
  return Boolean(normalized && !['匿名老师', 'anonymous', 'unknown', '未命名'].includes(normalized));
}

function normalizeTeacherKey(teacherName) {
  return sanitizeText(teacherName)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US');
}

function formatCanonicalTeacherName(teacherKey) {
  return String(teacherKey || '').replace(/(^|[._\-\s])([a-z])/g, (_, separator, letter) => (
    `${separator}${letter.toUpperCase()}`
  ));
}

function selectCanonicalTeacherName(profile) {
  return [...profile.variants]
    .sort((a, b) => {
      const uppercaseA = (a.match(/[A-Z]/g) || []).length;
      const uppercaseB = (b.match(/[A-Z]/g) || []).length;
      return uppercaseB - uppercaseA || a.localeCompare(b, 'en', { sensitivity: 'case' });
    })[0] || formatCanonicalTeacherName(profile.teacherKey);
}

function isProductionLikeUsageEvent(event) {
  const userAgent = String(event?.userAgent || '').toLowerCase();
  const ip = String(event?.ip || '').trim();
  return !userAgent.includes('node') && ip !== '127.0.0.1' && ip !== '::1';
}

function getShanghaiDay(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function summarizeUsageEvents(events) {
  const productionEvents = events.filter(isProductionLikeUsageEvent);
  const teacherProfiles = new Map();
  let unidentifiedEventCount = 0;

  for (const event of productionEvents) {
    const rawTeacherName = sanitizeText(event.teacherName || '匿名老师');
    if (!isIdentifiedTeacher(rawTeacherName)) {
      unidentifiedEventCount += 1;
      continue;
    }
    const teacherKey = normalizeTeacherKey(rawTeacherName);
    const profile = teacherProfiles.get(teacherKey) || {
      teacherKey,
      variants: new Set(),
      events: [],
      verified: false,
    };
    profile.variants.add(rawTeacherName);
    profile.events.push(event);
    if (event.event === 'login_success' || event.authenticated === true) {
      profile.verified = true;
    }
    teacherProfiles.set(teacherKey, profile);
  }

  const verifiedProfiles = [...teacherProfiles.values()].filter((profile) => profile.verified);
  const verifiedTeacherKeys = new Set(verifiedProfiles.map((profile) => profile.teacherKey));
  const teacherDisplayNames = new Map(
    [...teacherProfiles.values()].map((profile) => [profile.teacherKey, selectCanonicalTeacherName(profile)])
  );
  const unverifiedProfiles = [...teacherProfiles.values()].filter((profile) => !profile.verified);
  const caseVariantMergeCount = [...teacherProfiles.values()]
    .reduce((sum, profile) => sum + Math.max(0, profile.variants.size - 1), 0);

  const totalByEvent = {};
  const totalByUser = {};
  const totalByModule = {};
  const totalByTool = {};
  const totalByDay = {};
  const activeUsersByDay = {};
  const minipinByTeacher = {};
  const teacherToolCounts = {};
  const speakingMinipinRecent = [];
  let minipinTotalTenths = 0;
  let minipinActions = 0;
  let minipinStudents = 0;
  let speakingMinipinTenths = 0;
  let speakingMinipinActions = 0;
  let speakingMinipinStudents = 0;
  const identifiedEvents = [];

  for (const event of productionEvents) {
    const eventName = sanitizeText(event.event || 'unknown');
    const teacherKey = normalizeTeacherKey(event.teacherName || '匿名老师');
    if (!verifiedTeacherKeys.has(teacherKey)) continue;
    const teacherName = teacherDisplayNames.get(teacherKey) || formatCanonicalTeacherName(teacherKey);
    const moduleName = sanitizeText(event.module || 'unknown');
    const toolLabel = getUsageToolLabel(moduleName);
    const day = getShanghaiDay(event.ts);
    identifiedEvents.push(event);

    totalByEvent[eventName] = (totalByEvent[eventName] || 0) + 1;
    totalByUser[teacherName] = (totalByUser[teacherName] || 0) + 1;
    totalByModule[moduleName] = (totalByModule[moduleName] || 0) + 1;
    if (eventName === 'screen_view' && !['auth', 'welcome', 'class-hub', 'usage-insights'].includes(moduleName)) {
      totalByTool[toolLabel] = (totalByTool[toolLabel] || 0) + 1;
    }
    if (!['auth', 'welcome', 'class-hub', 'usage-insights'].includes(moduleName)) {
      const teacherToolKey = `${teacherName}\u0000${toolLabel}`;
      teacherToolCounts[teacherToolKey] = (teacherToolCounts[teacherToolKey] || 0) + 1;
    }
    if (day) {
      totalByDay[day] = (totalByDay[day] || 0) + 1;
      activeUsersByDay[day] = activeUsersByDay[day] || new Set();
      activeUsersByDay[day].add(teacherName);
    }
    if (eventName === 'minipin_issued') {
      const mpTenths = toMpTenths(event.mpTotal);
      const studentCount = Number(event.studentCount) || 0;
      minipinTotalTenths += mpTenths;
      minipinActions += 1;
      minipinStudents += studentCount;
      const current = minipinByTeacher[teacherName] || { totalMPTenths: 0, actions: 0, students: 0 };
      current.totalMPTenths += mpTenths;
      current.actions += 1;
      current.students += studentCount;
      minipinByTeacher[teacherName] = current;
      if (moduleName === 'speaking-challenge') {
        speakingMinipinTenths += mpTenths;
        speakingMinipinActions += 1;
        speakingMinipinStudents += Number(event.successCount) || studentCount;
        speakingMinipinRecent.push({
          ts: String(event.ts || ''),
          teacherName,
          className: sanitizeText(event.className || ''),
          totalMP: mpTenths / 10,
          studentCount,
          successCount: Number(event.successCount) || 0,
          failedCount: Number(event.failedCount) || 0,
        });
      }
    }
  }

  const daily = Object.keys(totalByDay)
    .sort()
    .map((day) => ({
      day,
      events: totalByDay[day],
      activeUsers: activeUsersByDay[day]?.size || 0,
    }));

  return {
    totalEvents: Object.values(totalByEvent).reduce((sum, count) => sum + count, 0),
    uniqueUsers: Object.keys(totalByUser).length,
    byEvent: toSortedEntries(totalByEvent, 'event'),
    byUser: toSortedEntries(totalByUser, 'teacherName'),
    byModule: toSortedEntries(totalByModule, 'module'),
    byTool: toSortedEntries(totalByTool, 'tool'),
    byTeacherTool: Object.entries(teacherToolCounts)
      .map(([key, count]) => {
        const [teacherName, tool] = key.split('\u0000');
        return { teacherName, tool, count };
      })
      .sort((a, b) => (
        Number(b.count) - Number(a.count)
        || String(a.teacherName).localeCompare(String(b.teacherName), 'zh-Hans-CN')
        || String(a.tool).localeCompare(String(b.tool), 'zh-Hans-CN')
      )),
    minipin: {
      totalMP: minipinTotalTenths / 10,
      totalActions: minipinActions,
      totalStudents: minipinStudents,
      byTeacher: Object.entries(minipinByTeacher)
        .map(([teacherName, stats]) => ({
          teacherName,
          totalMP: stats.totalMPTenths / 10,
          actions: stats.actions,
          students: stats.students,
        }))
        .sort((a, b) => (
          b.totalMP - a.totalMP
          || b.actions - a.actions
          || String(a.teacherName).localeCompare(String(b.teacherName), 'zh-Hans-CN')
        )),
    },
    speakingMinipin: {
      totalMP: speakingMinipinTenths / 10,
      totalActions: speakingMinipinActions,
      totalStudents: speakingMinipinStudents,
      recent: speakingMinipinRecent.slice(-20).reverse(),
    },
    daily,
    recentActivity: identifiedEvents
      .filter((event) => !['auth', 'welcome', 'class-hub', 'usage-insights'].includes(String(event.module || '')))
      .slice(-40)
      .reverse()
      .map((event) => ({
        ts: String(event.ts || ''),
        teacherName: teacherDisplayNames.get(normalizeTeacherKey(event.teacherName || ''))
          || formatCanonicalTeacherName(normalizeTeacherKey(event.teacherName || '')),
        tool: getUsageToolLabel(event.module),
        action: getUsageActionLabel(event.event),
        className: sanitizeText(event.className || ''),
        mpTotal: toMpTenths(event.mpTotal) / 10,
        studentCount: Number(event.studentCount) || 0,
        successCount: Number(event.successCount) || 0,
        failedCount: Number(event.failedCount) || 0,
      })),
    dataQuality: {
      unidentifiedEventCount,
      unverifiedEventCount: unverifiedProfiles.reduce((sum, profile) => sum + profile.events.length, 0),
      unverifiedUserCount: unverifiedProfiles.length,
      caseVariantMergeCount,
      unverifiedUsers: unverifiedProfiles
        .map((profile) => ({
          teacherName: teacherDisplayNames.get(profile.teacherKey) || formatCanonicalTeacherName(profile.teacherKey),
          count: profile.events.length,
        }))
        .sort((a, b) => b.count - a.count || a.teacherName.localeCompare(b.teacherName, 'zh-Hans-CN')),
    },
    identity: {
      verifiedUsers: verifiedProfiles.length,
      observedUsers: teacherProfiles.size,
      unverifiedUsers: unverifiedProfiles.length,
      mergedCaseVariants: caseVariantMergeCount,
    },
  };
}

module.exports = {
  appendUsageEvent,
  readUsageEvents,
  summarizeUsageEvents,
};
