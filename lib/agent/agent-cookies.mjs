/**
 * Agent 自定义域名 Cookies 解析（与浏览器工具、B站 Agent 共用）
 */

/** @param {object} cfg */
export function normalizeCookieEntries(cfg) {
  let list = Array.isArray(cfg?.agentBrowserCookies) ? cfg.agentBrowserCookies : [];
  if ((!list || !list.length) && Array.isArray(cfg?.agentBrowserCookieSites)) {
    const flat = [];
    cfg.agentBrowserCookieSites.forEach((site) => {
      const domains = String(site?.domains || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const cookies = Array.isArray(site?.cookies) ? site.cookies : [];
      cookies.forEach((c) => {
        domains.forEach((d) => {
          flat.push({
            name: c?.name,
            value: c?.value,
            domain: d,
            path: c?.path,
            secure: c?.secure,
            httpOnly: c?.httpOnly,
            sameSite: c?.sameSite,
            expires: c?.expires
          });
        });
      });
    });
    list = flat;
  }
  return list.map((item) => {
    const name = String(item?.name || '').trim();
    const value = String(item?.value || '');
    const domain = String(item?.domain || '').trim().toLowerCase();
    const pathValue = String(item?.path || '/').trim() || '/';
    if (!name || !domain) return null;
    return {
      name,
      value,
      domain,
      path: pathValue.startsWith('/') ? pathValue : `/${pathValue}`,
      secure: item?.secure !== false,
      httpOnly: item?.httpOnly === true,
      sameSite: String(item?.sameSite || 'Lax'),
      expires: Number(item?.expires) || undefined
    };
  }).filter(Boolean);
}

/** @param {object[]} cookieList @param {string} targetUrl */
export function pickCookiesForUrl(cookieList, targetUrl) {
  let host = '';
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  return cookieList.filter((c) => {
    const d = String(c.domain || '').replace(/^\./, '').toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

/** @param {object} cfg @param {string} targetUrl */
export function buildCookieHeaderForUrl(cfg, targetUrl) {
  const cookies = pickCookiesForUrl(normalizeCookieEntries(cfg), targetUrl);
  if (!cookies.length) return '';
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** @param {object} cfg @param {string} targetUrl */
export function hasCookiesForUrl(cfg, targetUrl) {
  return pickCookiesForUrl(normalizeCookieEntries(cfg), targetUrl).length > 0;
}
