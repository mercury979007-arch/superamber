class CnfHttpSession {
  constructor(baseUrl, { timeoutMs = 60_000 } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 60_000);
    this.cookies = [];
    this.cookieJar = new Map();
  }

  clear() {
    this.cookies = [];
    this.cookieJar.clear();
  }

  getCookieHeader() {
    return Array.from(this.cookieJar.values())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  splitSetCookieHeader(value = '') {
    return String(value)
      .split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  parseSetCookie(header = '') {
    const parts = String(header).split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const firstEquals = parts[0].indexOf('=');
    if (firstEquals <= 0) return null;

    const hostname = new URL(this.baseUrl).hostname;
    const cookie = {
      name: parts[0].slice(0, firstEquals),
      value: parts[0].slice(firstEquals + 1),
      domain: hostname,
      path: '/',
      secure: this.baseUrl.startsWith('https://'),
      httpOnly: false,
    };

    for (const attr of parts.slice(1)) {
      const eqIndex = attr.indexOf('=');
      const rawKey = (eqIndex === -1 ? attr : attr.slice(0, eqIndex)).trim().toLowerCase();
      const rawValue = eqIndex === -1 ? '' : attr.slice(eqIndex + 1).trim();

      if (rawKey === 'path' && rawValue) {
        cookie.path = rawValue;
      } else if (rawKey === 'domain' && rawValue) {
        cookie.domain = rawValue.replace(/^\./, '');
      } else if (rawKey === 'expires' && rawValue) {
        const expiresAt = Date.parse(rawValue);
        if (!Number.isNaN(expiresAt)) {
          cookie.expires = expiresAt;
        }
      } else if (rawKey === 'max-age' && rawValue) {
        const seconds = Number(rawValue);
        if (Number.isFinite(seconds)) {
          cookie.expires = Date.now() + seconds * 1000;
        }
      } else if (rawKey === 'secure') {
        cookie.secure = true;
      } else if (rawKey === 'httponly') {
        cookie.httpOnly = true;
      } else if (rawKey === 'samesite' && rawValue) {
        cookie.sameSite = rawValue[0].toUpperCase() + rawValue.slice(1).toLowerCase();
      }
    }

    return cookie;
  }

  updateCookiesFromHeaders(headers) {
    const rawSetCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : this.splitSetCookieHeader(headers.get('set-cookie') || '');

    for (const rawCookie of rawSetCookies) {
      const parsed = this.parseSetCookie(rawCookie);
      if (!parsed) continue;

      if (parsed.expires && parsed.expires <= Date.now()) {
        this.cookieJar.delete(parsed.name);
        continue;
      }

      this.cookieJar.set(parsed.name, parsed);
    }

    this.cookies = Array.from(this.cookieJar.values()).map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(cookie.expires ? { expires: Math.floor(cookie.expires / 1000) } : {}),
    }));
  }

  getDecodedCookieValue(name) {
    const value = this.cookieJar.get(name)?.value || '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  async request(path, options = {}) {
    const url = /^https?:\/\//i.test(path) ? path : new URL(path, this.baseUrl).toString();
    const headers = { ...(options.headers || {}) };
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    // Bound both response headers and body reads; a stalled upstream must
    // release refresh/deduplication jobs. Preserve caller cancellation as well.
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await fetch(url, {
      ...options,
      headers,
      signal,
      redirect: options.redirect || 'follow',
    });

    this.updateCookiesFromHeaders(response.headers);
    return response;
  }

  async requestText(path, options = {}) {
    const response = await this.request(path, options);
    const text = await response.text();
    return { response, text };
  }

  extractLoginToken(html = '') {
    const hiddenInputMatch = html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
    if (hiddenInputMatch?.[1]) {
      return hiddenInputMatch[1];
    }

    const inlineTokenMatch = html.match(/_token:\s*"([^"]+)"/);
    if (inlineTokenMatch?.[1]) {
      return inlineTokenMatch[1];
    }

    return '';
  }

  isLoginPage(html = '', url = '') {
    const text = String(html);
    return (
      String(url).includes('/admin/auth/login')
      || text.includes('submitLoginForm')
      || text.includes('C&F School教务管理系统 | 登录')
    );
  }

  getPuppeteerCookies() {
    const hostname = new URL(this.baseUrl).hostname;
    return Array.from(this.cookieJar.values()).map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: (cookie.domain || hostname).replace(/^\./, ''),
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(cookie.expires ? { expires: Math.floor(cookie.expires / 1000) } : {}),
    }));
  }
}

module.exports = {
  CnfHttpSession,
};
