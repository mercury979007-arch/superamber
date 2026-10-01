const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

function callAnthropicAPI(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error('ANTHROPIC_API_KEY 未配置，请在后端环境中设置该变量'));
      return;
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            } else {
              resolve(parsed.content?.[0]?.text ?? '');
            }
          } catch {
            reject(new Error(`API 响应解析失败: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callCodexFallback(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const prompt = [
      systemPrompt,
      '',
      '请严格只输出最终日报正文，不要添加解释、前言、后记或代码块围栏。',
      '',
      ...messages.map((message) => {
        const role = message.role === 'user' ? '用户' : '助手';
        return `${role}：${message.content}`;
      }),
    ].join('\n');

    const child = spawn(
      'codex',
      [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        '-m',
        'gpt-5.4-mini',
        prompt,
      ],
      {
        cwd: path.join(__dirname, '../..'),
        env: process.env,
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('日报生成超时，请稍后再试'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `日报生成失败（退出码 ${code}）`));
        return;
      }

      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
            const text = String(parsed.item.text || '').trim();
            if (text) {
              resolve(text);
              return;
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }

      reject(new Error('日报生成失败，未获取到可用内容'));
    });
  });
}

function generateDailyReport(messages, systemPrompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropicAPI(messages, systemPrompt);
  }
  return callCodexFallback(messages, systemPrompt);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'AmberClass/1.0',
          Accept: 'application/json, text/plain, */*',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`JSON 解析失败: ${data.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
  });
}

async function translateWordToChinese(text) {
  const safeText = String(text || '').trim();
  if (!safeText) return '';

  try {
    const googlePayload = await requestJson(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(safeText)}`
    );
    const rows = Array.isArray(googlePayload?.[0]) ? googlePayload[0] : [];
    const translated = rows
      .map((row) => (Array.isArray(row) ? String(row[0] || '') : ''))
      .join('')
      .trim();
    if (translated) return translated;
  } catch (error) {
    console.warn('translate google failed:', error.message);
  }

  try {
    const memoryPayload = await requestJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(safeText)}&langpair=en|zh-CN`
    );
    const translated = String(memoryPayload?.responseData?.translatedText || '').trim();
    if (translated) return translated;
  } catch (error) {
    console.warn('translate mymemory failed:', error.message);
  }

  return '';
}

function buildDailyReportPrompt(mode, customPrompt) {
  const basePrompt = `你是一位英语培训机构的班主任助手，负责根据课程数据生成班级日报。
输出格式为 Markdown，使用中文。
语气积极、专业，避免批评性语言。`;

  if (mode === 'detailed') {
    return `${basePrompt}

请生成详细版班级日报，内容尽量完整、信息密度更高。
优先包含以下内容（根据数据实际情况灵活调整）：
1. 本次课程整体情况与课堂状态
2. 出勤、完成度、积分或表现亮点
3. 每个重点学生的具体表现或进步点
4. 需要后续关注的情况
5. 本课重点与老师建议`;
  }

  if (mode === 'custom') {
    return `${basePrompt}

请按照用户给出的自定义要求生成日报。
如果用户要求与原始数据冲突，以原始数据为准。
用户的自定义要求如下：
${String(customPrompt || '').trim()}`;
  }

  return `${basePrompt}

请生成常规版班级日报，简洁清晰，适合直接发送。
优先包含以下内容（根据数据实际情况灵活调整）：
1. 本次课程总体情况
2. 积分或表现亮点
3. 需要关注的情况
  4. 老师寄语或本课重点`;
}

function parseMarkdownTableRows(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('|') && line.endsWith('|'));

  return lines
    .filter((line) => !/^\|\s*(---\s*\|)+\s*$/.test(line))
    .map((line) => line
      .slice(1, -1)
      .split('|')
      .map((cell) => String(cell || '').trim()));
}

function parseCompletedValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (['进行中', '未完成', '否', '0', '×'].includes(text)) return false;
  if (['已完成', '完成', '是', '1', '√'].includes(text)) return true;
  return null;
}

function parseScoreValue(value) {
  const text = String(value || '').trim().replace('%', '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeTablesForReport(tables, fallbackClassCode) {
  const studentMap = new Map();

  for (const table of tables) {
    const name = String(table?.name || '');
    const rows = parseMarkdownTableRows(table?.text);
    if (rows.length < 4) continue;

    const row1 = rows[1] || [];
    const row2 = rows[2] || [];
    const resourceBlocks = [];
    let currentBlock = null;

    for (let ci = 0; ci < row1.length; ci += 1) {
      const cell = String(row1[ci] || '').trim();
      if (cell.includes('[')) {
        if (currentBlock) {
          currentBlock.endCol = ci - 1;
          resourceBlocks.push(currentBlock);
        }
        currentBlock = { startCol: ci, endCol: ci, subCols: [] };
      }
      if (currentBlock && row2[ci] !== undefined) {
        currentBlock.subCols.push(String(row2[ci] || '').trim());
      }
    }
    if (currentBlock) {
      currentBlock.endCol = row1.length - 1;
      resourceBlocks.push(currentBlock);
    }

    for (let ri = 3; ri < rows.length; ri += 1) {
      const row = rows[ri] || [];
      const studentId = String(row[1] || '').trim();
      if (!studentId || studentId === '学号') continue;

      const chineseName = String(row[2] || '').trim();
      const englishName = String(row[3] || '').trim();
      const studentName = englishName || chineseName || studentId;
      const existing = studentMap.get(studentName) || {
        name: studentName,
        completedTasks: 0,
        totalTrackedTasks: 0,
        scoreSum: 0,
        scoreCount: 0,
      };

      for (const block of resourceBlocks) {
        let colIdx = block.startCol;
        for (const subCol of block.subCols) {
          const rawVal = row[colIdx] ?? '';
          if (subCol.includes('是否完成')) {
            const completed = parseCompletedValue(rawVal);
            if (completed !== null) {
              existing.totalTrackedTasks += 1;
              if (completed) existing.completedTasks += 1;
            }
          }
          if (
            subCol.includes('分数') ||
            subCol.includes('平均分') ||
            subCol.includes('正确率')
          ) {
            const score = parseScoreValue(rawVal);
            if (score !== null) {
              existing.scoreSum += score;
              existing.scoreCount += 1;
            }
          }
          colIdx += 1;
        }
      }

      studentMap.set(studentName, existing);
    }

    if (rows.length > 1 && studentMap.size === 0) {
      for (let ri = 1; ri < rows.length; ri += 1) {
        const row = rows[ri] || [];
        const studentName = String(row[3] || row[2] || row[1] || row[0] || '').trim();
        if (!studentName) continue;
        if (!studentMap.has(studentName)) {
          studentMap.set(studentName, {
            name: studentName,
            completedTasks: 0,
            totalTrackedTasks: 0,
            scoreSum: 0,
            scoreCount: 0,
          });
        }
      }
    }

    const classMatch = name.match(/([A-Z]\d{2,4})/i);
    if (!fallbackClassCode && classMatch) fallbackClassCode = classMatch[1].toUpperCase();
  }

  return {
    classCode: fallbackClassCode,
    students: Array.from(studentMap.values()),
  };
}

function averageScore(student) {
  return student.scoreCount > 0 ? student.scoreSum / student.scoreCount : null;
}

function buildFastDailyReport({ classCode, tables, note, mode, customPrompt }) {
  const summary = summarizeTablesForReport(tables, classCode);
  const studentCount = summary.students.length;
  const trackedStudents = summary.students.filter((student) => student.totalTrackedTasks > 0);
  const overallCompletion = trackedStudents.length > 0
    ? trackedStudents.reduce((sum, student) => sum + (student.completedTasks / Math.max(student.totalTrackedTasks, 1)), 0) / trackedStudents.length * 100
    : null;
  const scoredStudents = summary.students.filter((student) => student.scoreCount > 0);
  const overallScore = scoredStudents.length > 0
    ? scoredStudents.reduce((sum, student) => sum + (averageScore(student) || 0), 0) / scoredStudents.length
    : null;

  const ranked = [...summary.students].sort((a, b) => {
    const aCompletion = a.totalTrackedTasks > 0 ? a.completedTasks / a.totalTrackedTasks : 0;
    const bCompletion = b.totalTrackedTasks > 0 ? b.completedTasks / b.totalTrackedTasks : 0;
    const aScore = averageScore(a) || 0;
    const bScore = averageScore(b) || 0;
    return (bCompletion * 100 + bScore) - (aCompletion * 100 + aScore);
  });

  const topStudents = ranked.slice(0, Math.min(3, ranked.length));
  const attentionStudents = ranked
    .filter((student) => student.totalTrackedTasks > 0 && student.completedTasks / Math.max(student.totalTrackedTasks, 1) < 0.7)
    .slice(0, 2);

  const focusLine = mode === 'custom' && String(customPrompt || '').trim()
    ? `本次重点：${String(customPrompt).trim()}`
    : '';
  const noteBlock = String(note || '').trim()
    ? `\n## 补充说明\n${String(note).trim()}`
    : '';
  const highlightLines = topStudents.length > 0
    ? topStudents.map((student) => {
      const completion = student.totalTrackedTasks > 0
        ? `${student.completedTasks}/${student.totalTrackedTasks}`
        : '已导入学习数据';
      const score = averageScore(student);
      return `- ${student.name}：完成情况 ${completion}${score !== null ? `，表现分约 ${Math.round(score)}` : ''}`;
    }).join('\n')
    : '- 本次已成功导入学生数据。';
  const attentionLines = attentionStudents.length > 0
    ? attentionStudents.map((student) => `- ${student.name}：后续可重点关注完成进度和课堂跟进。`).join('\n')
    : '- 暂无明显异常，整体状态稳定。';

  if (mode === 'detailed' || /详细|展开|具体/.test(String(customPrompt || ''))) {
    const studentBlocks = topStudents.map((student) => {
      const completionRate = student.totalTrackedTasks > 0
        ? Math.round((student.completedTasks / student.totalTrackedTasks) * 100)
        : null;
      const score = averageScore(student);
      return `### ${student.name}
- 完成度：${student.totalTrackedTasks > 0 ? `${student.completedTasks}/${student.totalTrackedTasks}（${completionRate}%）` : '已导入数据'}
${score !== null ? `- 表现分：约 ${Math.round(score)}` : '- 表现分：暂无可直接量化分数'}
- 整体表现：本次课堂状态稳定，建议继续保持当前节奏。`;
    }).join('\n\n');

    return `# ${summary.classCode || classCode} 班级日报详细版

${focusLine ? `${focusLine}\n\n` : ''}## 整体情况
- 学生人数：${studentCount}
${overallCompletion !== null ? `- 整体完成度：${Math.round(overallCompletion)}%` : '- 整体完成度：暂无可直接量化数据'}
${overallScore !== null ? `- 整体表现分：约 ${Math.round(overallScore)}` : '- 整体表现分：暂无可直接量化分数'}
- 整体判断：课堂状态总体稳定，数据已成功汇总。

## 亮点学生
${highlightLines}

## 重点学生情况
${studentBlocks || '- 本次暂无可展开的重点学生明细。'}

## 需要关注
${attentionLines}${noteBlock}`;
  }

  return `# ${summary.classCode || classCode} 班级日报

${focusLine ? `${focusLine}\n\n` : ''}## 本次课程总体情况
- 学生人数：${studentCount}
${overallCompletion !== null ? `- 整体完成度：${Math.round(overallCompletion)}%` : '- 已成功读取本次学习数据'}
${overallScore !== null ? `- 整体表现分：约 ${Math.round(overallScore)}` : '- 整体课堂状态稳定，可直接用于日报整理'}

## 表现亮点
${highlightLines}

## 需要关注
${attentionLines}${noteBlock}`;
}

module.exports = {
  buildDailyReportPrompt,
  buildFastDailyReport,
  generateDailyReport,
  parseCompletedValue,
  parseScoreValue,
  summarizeTablesForReport,
  translateWordToChinese,
};
