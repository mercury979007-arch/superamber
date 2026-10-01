function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie();
    if (Array.isArray(lines) && lines.length > 0) return lines;
  }
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((line) => line.trim()).filter(Boolean);
}

function mergeCookies(jar, headers) {
  for (const line of getSetCookieLines(headers)) {
    const pair = line.split(';', 1)[0] || '';
    const sep = pair.indexOf('=');
    if (sep <= 0) continue;
    const name = pair.slice(0, sep).trim();
    const value = pair.slice(sep + 1).trim();
    if (name) jar[name] = value;
  }
}

function buildCookieHeader(jar) {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchWithJar(url, options = {}, jar = {}) {
  const headers = new Headers(options.headers || {});
  const cookieHeader = buildCookieHeader(jar);
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  mergeCookies(jar, response.headers);
  return response;
}

async function loginCNF(CNF_BASE_URL, username, password) {
  const jar = {};
  const pageResp = await fetchWithJar(`${CNF_BASE_URL}/admin/auth/login`, { method: 'GET' }, jar);
  const pageHtml = await pageResp.text();
  const token = pageHtml.match(/_token:\s*"([^"]+)"/)?.[1]?.trim();
  if (!token) throw new Error('未能解析教务系统登录 token');

  const body = new URLSearchParams({ username, password, _token: token, remember: 'false' });
  const loginResp = await fetchWithJar(`${CNF_BASE_URL}/admin/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
    },
    body: body.toString(),
  }, jar);

  if (loginResp.status >= 300 && loginResp.status < 400) {
    return jar;
  }

  const data = await loginResp.json().catch(() => ({}));
  if (String(data?.code) !== '1') {
    throw new Error(String(data?.msg || '账号或密码错误'));
  }
  return jar;
}

function parseMySquadHtml(html) {
  const classes = [];
  const rowPattern = /<tr\s*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const content = match[1];
    const idMatch = content.match(/data-id="(\d+)"/);
    const linkMatch = content.match(/squad_console\?type=(\w+)&id=(\d+)/);
    const nameMatch = content.match(/column-name[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)/);
    const sectionMatch = content.match(/column-section[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    const groupMatch = content.match(/column-group[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    const teacherMatch = content.match(/column-class_teacher[^>]*>\s*([\s\S]*?)\s*<\/td>/);
    if (idMatch && nameMatch) {
      classes.push({
        id: Number(idMatch[1]),
        type: linkMatch?.[1] || 'offline',
        name: nameMatch[1].trim(),
        section: (sectionMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
        group: (groupMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
        tutor: (teacherMatch?.[1] || '').replace(/<[^>]+>/g, '').trim(),
      });
    }
  }
  return classes;
}

module.exports = {
  getSetCookieLines,
  mergeCookies,
  buildCookieHeader,
  fetchWithJar,
  loginCNF,
  parseMySquadHtml,
};
