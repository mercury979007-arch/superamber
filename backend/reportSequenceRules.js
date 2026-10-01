const STEP_RE = /步骤\s*(\d+)/;
const LESSON_RE = /Lesson\s*(\d+)/i;
const SHORT_LESSON_RE = /(?<![A-Za-z0-9])L\s*(\d+)(?![A-Za-z0-9])/i;

function extractStepNumber(text) {
  const match = STEP_RE.exec(String(text || ''));
  return match ? Number(match[1]) : null;
}

function hasExplicitStep(text) {
  return extractStepNumber(text) !== null;
}

function extractLessonNumber(text) {
  const safe = String(text || '').trim();
  const lessonMatch = LESSON_RE.exec(safe);
  if (lessonMatch) return Number(lessonMatch[1]);
  const shortMatch = SHORT_LESSON_RE.exec(safe);
  if (shortMatch) return Number(shortMatch[1]);
  return null;
}

function hasLessonMarker(text) {
  return extractLessonNumber(text) !== null;
}

function isTestTitle(text) {
  return String(text || '').includes('测试');
}

function detectGroupMode(items) {
  return items.some((item) => hasExplicitStep(item.title)) ? 'step' : 'semantic';
}

function semanticPhasePriority(text) {
  const safe = String(text || '').trim();
  if (safe.includes('小挑战')) return 30;
  if (safe.includes('课前') || safe.includes('预习') || safe.includes('新知')) return 10;
  if (safe.includes('Lesson') || SHORT_LESSON_RE.test(safe)) return 15;
  if (
    safe.includes('课后')
    || safe.includes('温故')
    || safe.includes('回顾')
    || safe.includes('句型表达')
  ) {
    return 20;
  }
  return 25;
}

function semanticSubtypePriority(text) {
  const safe = String(text || '').trim();
  if ((safe.includes('课前') || safe.includes('预习') || safe.includes('新知')) && safe.includes('AI语音')) {
    return 1;
  }
  return 0;
}

function semanticTimeBucketPriority(text) {
  const safe = String(text || '').trim();
  if (safe.includes('下周周中')) return 2;
  if (safe.includes('周中')) return 0;
  if (safe.includes('周末')) return 1;
  return 9;
}

function buildLessonOrderMap(items) {
  const orderMap = new Map();
  items
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .forEach((item) => {
      const lessonNo = extractLessonNumber(item.title) ?? extractLessonNumber(item.groupTitle);
      if (lessonNo === null || orderMap.has(lessonNo)) return;
      orderMap.set(lessonNo, orderMap.size);
    });
  return orderMap;
}

function sortStepGroup(items) {
  return items.slice().sort((a, b) => {
    const stepDiff = (extractStepNumber(a.title) ?? 999) - (extractStepNumber(b.title) ?? 999);
    if (stepDiff !== 0) return stepDiff;
    return (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0);
  });
}

function sortSemanticGroup(items) {
  const hasLessons = items.some((item) => hasLessonMarker(item.title) || hasLessonMarker(item.groupTitle));
  if (hasLessons) {
    const lessonOrderMap = buildLessonOrderMap(items);
    return items.slice().sort((a, b) => {
      const testDiff = Number(isTestTitle(a.title)) - Number(isTestTitle(b.title));
      if (testDiff !== 0) return testDiff;

      const lessonRankA = lessonOrderMap.get(extractLessonNumber(a.title) ?? extractLessonNumber(a.groupTitle)) ?? 999;
      const lessonRankB = lessonOrderMap.get(extractLessonNumber(b.title) ?? extractLessonNumber(b.groupTitle)) ?? 999;
      if (lessonRankA !== lessonRankB) return lessonRankA - lessonRankB;

      const phaseDiff = semanticPhasePriority(a.title) - semanticPhasePriority(b.title);
      if (phaseDiff !== 0) return phaseDiff;

      const subtypeDiff = semanticSubtypePriority(a.title) - semanticSubtypePriority(b.title);
      if (subtypeDiff !== 0) return subtypeDiff;

      return (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0);
    });
  }

  return items.slice().sort((a, b) => {
    const testDiff = Number(isTestTitle(a.title)) - Number(isTestTitle(b.title));
    if (testDiff !== 0) return testDiff;

    const bucketDiff = semanticTimeBucketPriority(a.title) - semanticTimeBucketPriority(b.title);
    if (bucketDiff !== 0) return bucketDiff;

    return (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0);
  });
}

function sortGroupItems(items) {
  return detectGroupMode(items) === 'step' ? sortStepGroup(items) : sortSemanticGroup(items);
}

function sortModulesByGroup(modules) {
  const groups = new Map();
  for (const module of modules) {
    const key = module.groupOrder ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(module);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, items]) => sortGroupItems(items));
}

module.exports = {
  detectGroupMode,
  extractLessonNumber,
  extractStepNumber,
  hasExplicitStep,
  semanticPhasePriority,
  semanticSubtypePriority,
  semanticTimeBucketPriority,
  sortGroupItems,
  sortModulesByGroup,
};
