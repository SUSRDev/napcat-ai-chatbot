/**
 * Bilibili 扫码登录 + 按 QQ 用户存储 Cookie
 * Web 端官方流程：getLoginUrl → getLoginInfo（oauthKey 轮询，Set-Cookie 写登录态）
 * 备用：x/passport-login/web/qrcode（新版接口）
 */
import { openDatabase } from '../storage/sqlite-db.mjs';
import { normalizeCookieEntries, pickCookiesForUrl } from '../agent/agent-cookies.mjs';

/** 官方 Web 端扫码（文档：passport.bilibili.com/qrcode/getLoginUrl） */
const BILI_QR_GET_URL = 'https://passport.bilibili.com/qrcode/getLoginUrl';
const BILI_QR_LOGIN_INFO = 'https://passport.bilibili.com/qrcode/getLoginInfo';
/** 新版 Web 扫码（备用） */
const BILI_QR_GENERATE_V2 = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const BILI_QR_POLL_V2 = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const BILI_REFERER = 'https://passport.bilibili.com/login';

function parseSetCookies(res) {
  const out = [];
  if (typeof res.headers.getSetCookie === 'function') {
    for (const line of res.headers.getSetCookie()) {
      const part = String(line).split(';')[0];
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      out.push({ name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim(), domain: 'bilibili.com', path: '/' });
    }
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) {
      for (const line of String(raw).split(/,(?=\s*\w+=)/)) {
        const part = line.split(';')[0];
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        out.push({ name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim(), domain: 'bilibili.com', path: '/' });
      }
    }
  }
  return out;
}

function mergeCookies(existing, incoming) {
  const map = new Map((existing || []).map((c) => [c.name, c]));
  for (const c of incoming || []) {
    if (c.name) map.set(c.name, { ...map.get(c.name), ...c, domain: c.domain || 'bilibili.com', path: c.path || '/' });
  }
  return [...map.values()];
}

function cookiesToHeader(cookies) {
  return (cookies || []).filter((c) => c.name && c.value).map((c) => `${c.name}=${c.value}`).join('; ');
}

function cookiesToFlatList(cookiesJson) {
  try {
    const arr = typeof cookiesJson === 'string' ? JSON.parse(cookiesJson) : cookiesJson;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function readPollCookies(row) {
  return cookiesToFlatList(row?.poll_cookies_json);
}

function savePollCookies(db, sessionKey, cookies) {
  db.prepare('UPDATE bili_qr_pending SET poll_cookies_json = ? WHERE session_key = ?')
    .run(JSON.stringify(cookies || []), sessionKey);
}

function hasLoginCookies(cookies) {
  return (cookies || []).some((c) => c.name === 'SESSDATA' && c.value)
    || (cookies || []).some((c) => c.name === 'DedeUserID' && c.value);
}

/** @param {object[]} cookies */
async function resolveBiliUserFromCookies(cookies) {
  let biliMid = cookies.find((c) => c.name === 'DedeUserID')?.value || '';
  let biliUname = '';
  try {
    const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent': BILI_UA,
        Referer: 'https://www.bilibili.com/',
        Cookie: cookiesToHeader(cookies)
      },
      signal: AbortSignal.timeout(15000)
    });
    const nav = await navRes.json();
    if (nav.code === 0 && nav.data?.isLogin) {
      biliMid = String(nav.data.mid || biliMid || '');
      biliUname = String(nav.data.uname || '');
    }
  } catch { /* ignore */ }
  return { biliMid, biliUname };
}

/** @param {object} db @param {string} qqUserId */
export function getBiliSession(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid || !db) return null;
  const row = db.prepare('SELECT * FROM bili_sessions WHERE qq_user_id = ?').get(uid);
  if (!row) return null;
  return {
    qqUserId: row.qq_user_id,
    biliMid: row.bili_mid,
    biliUname: row.bili_uname,
    cookies: cookiesToFlatList(row.cookies_json),
    expiresAt: row.expires_at,
    loginMethod: row.login_method,
    updatedAt: row.updated_at
  };
}

/** @param {object} db */
export function listBiliSessions(db) {
  if (!db) return [];
  return db.prepare('SELECT qq_user_id, bili_mid, bili_uname, expires_at, login_method, updated_at FROM bili_sessions ORDER BY updated_at DESC').all()
    .map((r) => ({
      qqUserId: r.qq_user_id,
      biliMid: r.bili_mid,
      biliUname: r.bili_uname,
      expiresAt: r.expires_at,
      loginMethod: r.login_method,
      updatedAt: r.updated_at
    }));
}

/** @param {object} db @param {string} qqUserId @param {object} data */
export function saveBiliSession(db, qqUserId, data) {
  const uid = String(qqUserId || '').trim();
  if (!uid || !db) return null;
  const cookies = mergeCookies([], data.cookies || []);
  db.prepare(`INSERT INTO bili_sessions(qq_user_id, bili_mid, bili_uname, cookies_json, expires_at, login_method, updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(qq_user_id) DO UPDATE SET
      bili_mid=excluded.bili_mid, bili_uname=excluded.bili_uname, cookies_json=excluded.cookies_json,
      expires_at=excluded.expires_at, login_method=excluded.login_method, updated_at=excluded.updated_at`)
    .run(uid, data.biliMid || '', data.biliUname || '', JSON.stringify(cookies), data.expiresAt || 0, data.loginMethod || 'qr', Date.now());

  if (data.biliMid || data.biliUname) {
    db.prepare(`UPDATE user_profiles SET bili_mid = COALESCE(NULLIF(?, ''), bili_mid), bili_uname = COALESCE(NULLIF(?, ''), bili_uname), updated_at = ? WHERE qq_user_id = ?`)
      .run(data.biliMid || '', data.biliUname || '', Date.now(), uid);
  }
  return getBiliSession(db, uid);
}

/** @param {object} db @param {string} qqUserId */
export function deleteBiliSession(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid || !db) return false;
  const r = db.prepare('DELETE FROM bili_sessions WHERE qq_user_id = ?').run(uid);
  return r.changes > 0;
}

export function resolveCookiesForUser(cfg, targetUrl, qqUserId, db = null) {
  const uid = String(qqUserId || '').trim();
  if (uid && db) {
    const session = getBiliSession(db, uid);
    if (session?.cookies?.length) {
      const picked = pickCookiesForUrl(session.cookies, targetUrl);
      if (picked.length) return { cookies: picked, source: 'user', qqUserId: uid, biliUname: session.biliUname };
    }
  }
  const global = pickCookiesForUrl(normalizeCookieEntries(cfg), targetUrl);
  return { cookies: global, source: global.length ? 'global' : 'none', qqUserId: uid || '' };
}

export function buildCookieHeaderForUser(cfg, targetUrl, qqUserId, db = null) {
  const { cookies } = resolveCookiesForUser(cfg, targetUrl, qqUserId, db);
  if (!cookies.length) return '';
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function describeCookieSource(cfg, targetUrl, qqUserId, db = null) {
  const r = resolveCookiesForUser(cfg, targetUrl, qqUserId, db);
  if (r.source === 'user') return `已使用 QQ ${r.qqUserId} 绑定的 B站账号（${r.biliUname || '已登录'}）Cookie`;
  if (r.source === 'global') return '已使用主站全局 Cookie（用户未单独绑定 B站）';
  return '未配置 Cookie（请在「自定义域名 Cookies」配置 bilibili.com 或扫码绑定）';
}

async function fetchBiliQrLegacy() {
  const res = await fetch(BILI_QR_GET_URL, {
    headers: { 'User-Agent': BILI_UA, Referer: BILI_REFERER },
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (data.code !== 0 || !data.data?.oauthKey || !data.data?.url) {
    throw new Error(data.message || '官方 Web 二维码获取失败');
  }
  return {
    loginApi: 'web_legacy',
    qrcodeUrl: data.data.url,
    qrcodeKey: data.data.oauthKey,
    pollCookies: parseSetCookies(res)
  };
}

async function fetchBiliQrV2() {
  const res = await fetch(BILI_QR_GENERATE_V2, {
    headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (data.code !== 0 || !data.data?.qrcode_key) {
    throw new Error(data.message || '新版二维码获取失败');
  }
  return {
    loginApi: 'web_v2',
    qrcodeUrl: data.data.url,
    qrcodeKey: data.data.qrcode_key,
    pollCookies: parseSetCookies(res)
  };
}

/**
 * 发起 QR 登录（优先官方 Web getLoginUrl）
 * @param {object} db
 * @param {string} qqUserId
 */
export async function startBiliQrLogin(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid) throw new Error('qqUserId 不能为空');
  if (!db) throw new Error('SQLite 未就绪，请先一键部署 SQLite');

  let qr;
  try {
    qr = await fetchBiliQrLegacy();
  } catch {
    qr = await fetchBiliQrV2();
  }

  const sessionKey = `qr_${uid}_${Date.now()}`;
  const expiresAt = Date.now() + 180000;
  db.prepare(`INSERT OR REPLACE INTO bili_qr_pending(session_key, qq_user_id, qrcode_key, qrcode_url, status, created_at, expires_at, login_api, poll_cookies_json)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(sessionKey, uid, qr.qrcodeKey, qr.qrcodeUrl, 'pending', Date.now(), expiresAt, qr.loginApi, JSON.stringify(qr.pollCookies || []));

  return {
    sessionKey,
    qqUserId: uid,
    qrcodeUrl: qr.qrcodeUrl,
    qrcodeKey: qr.qrcodeKey,
    loginApi: qr.loginApi,
    expiresAt
  };
}

async function finalizeBiliLogin(db, row, sessionKey, cookies) {
  if (!hasLoginCookies(cookies)) {
    return {
      status: 'error',
      message: '登录未完成：未获取 SESSDATA，请在 B 站 App 上确认登录',
      qrcodeUrl: row.qrcode_url
    };
  }
  const { biliMid, biliUname } = await resolveBiliUserFromCookies(cookies);
  if (!biliMid) {
    return {
      status: 'error',
      message: '登录未完成：无法解析账号 mid，请重新扫码',
      qrcodeUrl: row.qrcode_url
    };
  }
  const session = saveBiliSession(db, row.qq_user_id, {
    cookies,
    biliMid,
    biliUname,
    loginMethod: row.login_api === 'web_legacy' ? 'qr_web' : 'qr',
    expiresAt: Date.now() + 30 * 86400000
  });
  db.prepare('UPDATE bili_qr_pending SET status = ?, poll_cookies_json = ? WHERE session_key = ?')
    .run('confirmed', JSON.stringify(cookies), sessionKey);
  return {
    status: 'confirmed',
    message: '登录成功',
    qqUserId: row.qq_user_id,
    biliMid,
    biliUname,
    session
  };
}

/** 官方 Web 端轮询 getLoginInfo */
async function pollBiliQrLoginLegacy(db, row, sessionKey) {
  let pollCookies = readPollCookies(row);
  const res = await fetch(BILI_QR_LOGIN_INFO, {
    method: 'POST',
    headers: {
      'User-Agent': BILI_UA,
      Referer: BILI_REFERER,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(pollCookies.length ? { Cookie: cookiesToHeader(pollCookies) } : {})
    },
    body: new URLSearchParams({
      oauthKey: row.qrcode_key,
      gourl: 'https://www.bilibili.com'
    }),
    signal: AbortSignal.timeout(20000)
  });
  pollCookies = mergeCookies(pollCookies, parseSetCookies(res));
  savePollCookies(db, sessionKey, pollCookies);

  let data;
  try {
    data = await res.json();
  } catch {
    return { status: 'pending', message: '轮询响应异常', qrcodeUrl: row.qrcode_url };
  }

  // status=true 且 data 为对象：登录成功，Cookie 已在 Set-Cookie / pollCookies 中
  if (data.status === true && data.data && typeof data.data === 'object') {
    return finalizeBiliLogin(db, row, sessionKey, pollCookies);
  }

  const errCode = typeof data.data === 'number' ? data.data : Number(data.data);
  if (errCode === -4) {
    return { status: 'pending', message: '等待扫码', qrcodeUrl: row.qrcode_url };
  }
  if (errCode === -5) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('scanned', sessionKey);
    return { status: 'scanned', message: '已扫码，请在手机上确认登录', qrcodeUrl: row.qrcode_url };
  }
  if (errCode === -2 || errCode === -1) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('expired', sessionKey);
    return { status: 'expired', message: errCode === -2 ? '二维码已过期' : '扫码密钥无效，请重新获取' };
  }

  return { status: 'pending', message: data.message || `等待确认 (data=${data.data})`, qrcodeUrl: row.qrcode_url };
}

/** 新版 x/passport-login/web 轮询 */
async function pollBiliQrLoginV2(db, row, sessionKey) {
  const pollUrl = `${BILI_QR_POLL_V2}?qrcode_key=${encodeURIComponent(row.qrcode_key)}`;
  const res = await fetch(pollUrl, {
    headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(20000)
  });
  let cookies = mergeCookies(readPollCookies(row), parseSetCookies(res));
  savePollCookies(db, sessionKey, cookies);
  const data = await res.json();

  if (data.code === 86101) {
    return { status: 'pending', message: '等待扫码', qrcodeUrl: row.qrcode_url };
  }
  if (data.code === 86090) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('scanned', sessionKey);
    return { status: 'scanned', message: '已扫码，请在手机上确认', qrcodeUrl: row.qrcode_url };
  }
  if (data.code === 86038) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('expired', sessionKey);
    return { status: 'expired', message: '二维码已过期' };
  }
  if (data.code !== 0) {
    return { status: 'pending', message: data.message || `code=${data.code}`, qrcodeUrl: row.qrcode_url };
  }

  if (data.data?.refresh_token) {
    try {
      const refreshRes = await fetch('https://passport.bilibili.com/x/passport-login/web/cookie/refresh', {
        method: 'POST',
        headers: {
          'User-Agent': BILI_UA,
          Referer: 'https://www.bilibili.com/',
          'Content-Type': 'application/json',
          Cookie: cookiesToHeader(cookies)
        },
        body: JSON.stringify({ refresh_token: data.data.refresh_token }),
        signal: AbortSignal.timeout(20000)
      });
      cookies = mergeCookies(cookies, parseSetCookies(refreshRes));
      savePollCookies(db, sessionKey, cookies);
    } catch { /* use poll cookies */ }
  }

  if (!hasLoginCookies(cookies)) {
    return { status: 'pending', message: '等待手机端确认登录', qrcodeUrl: row.qrcode_url };
  }
  return finalizeBiliLogin(db, row, sessionKey, cookies);
}

/**
 * 轮询 QR 状态
 * @param {object} db
 * @param {string} sessionKey
 */
export async function pollBiliQrLogin(db, sessionKey) {
  const key = String(sessionKey || '').trim();
  if (!key || !db) return { status: 'error', message: '无效 session' };

  const row = db.prepare('SELECT * FROM bili_qr_pending WHERE session_key = ?').get(key);
  if (!row) return { status: 'error', message: '会话不存在或已过期' };
  if (Date.now() > row.expires_at) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('expired', key);
    return { status: 'expired', message: '二维码已过期，请重新生成' };
  }
  if (row.status === 'confirmed') {
    const session = getBiliSession(db, row.qq_user_id);
    if (hasLoginCookies(session?.cookies)) {
      return {
        status: 'confirmed',
        qqUserId: row.qq_user_id,
        biliMid: session.biliMid,
        biliUname: session.biliUname,
        session
      };
    }
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('pending', key);
  }

  const loginApi = row.login_api || 'web_v2';
  if (loginApi === 'web_legacy') {
    return pollBiliQrLoginLegacy(db, row, key);
  }
  return pollBiliQrLoginV2(db, row, key);
}

/** @param {string} configDir @param {string} pluginRoot */
export async function getBiliAuthDb(configDir, pluginRoot) {
  const { db, error } = await openDatabase(configDir, pluginRoot);
  if (!db) throw new Error(error || 'SQLite 未就绪');
  return db;
}
