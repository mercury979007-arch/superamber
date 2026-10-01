
function normalizeWeekdayToken(value) {
  return String(value || '')
    .replace(/星期/g, '周')
    .replace(/周天/g, '周日')
    .trim();
}

function joinUniqueParts(parts) {
  const kept = [];
  for (const raw of parts) {
    const part = String(raw || '').trim();
    if (!part) continue;
    const normalized = normalizeWeekdayToken(part);
    if (!kept.some((existing) => normalizeWeekdayToken(existing) === normalized || existing === part)) {
      kept.push(part);
    }
  }
  return kept.join('');
}

function buildMessageTime(target) {
  return joinUniqueParts([target.day, target.time]) || '待确认';
}

function buildMessageLocation(target) {
  const campus = String(target.campus || '').trim();
  const room = String(target.room || '').trim();
  if (!campus && !room) return '待确认';
  if (!campus) return room;
  if (!room) return campus;
  if (room.startsWith(campus)) return room;
  return `${campus}${room}`;
}

export function generateParentMessage(
  _origin,
  target,
  _studentName,
  options,
) {
  const weekMatch = String(target.week_label || '').match(/^(W\d+)/);
  const weekNum = weekMatch ? weekMatch[1] : 'WX';
  const modeStr = target.mode === '周末' ? '周末' : '周中';
  const location = buildMessageLocation(target);
  const timeText = buildMessageTime(target);
  const specialTail = options?.specialMode ? '\n\n本次为特殊调整补课，请以老师最终确认为准。' : '';
  return `亲爱的家长，请查收${weekNum}周${modeStr}临时补课
班级：${target.class_code}
班主任：${target.head_teacher || '待确认'}
⏰时间：${timeText}
🏫地点：${location || '待确认'}

调课请务必携带姓名牌哦~${specialTail}`;
}

export function generateTeacherMessage(
  origin,
  target,
  studentName,
  options,
) {
  const name = studentName.trim() || 'XXX【需手动填写】';
  const location = buildMessageLocation(target);
  const timeText = buildMessageTime(target);
  const specialIntro = options?.specialMode ? '这次是特殊调整补课，需您二次确认进度和可接收性。\n\n' : '';
  return `👩‍🎨亲爱的${target.head_teacher || 'XXX'}

${specialIntro}
本${target.day}您的${target.class_code}班会有个我们班${origin.class_code}去补课的孩子

我和你确认一下上课进度是${target.lesson}
⏰时间：${timeText}
🏫地点：${location || '待确认'}

孩子叫${name}`;
}
