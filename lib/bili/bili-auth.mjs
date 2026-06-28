/**
 * Bilibili 扫码登录 + 按 QQ 用户存储 Cookie
 */
import { openDatabase } from '../storage/sqlite-db.mjs';
import { normalizeCookieEntries, pickCookiesForUrl } from '../agent/agent-cookies.mjs';

const BILI_QR_GENERATE = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const BILI_QR_POLL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

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

function cookiesToFlatList(cookiesJson) {
  try {
    const arr = typeof cookiesJson === 'string' ? JSON.parse(cookiesJson) : cookiesJson;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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

/**
 * 解析 Cookie：用户已绑定 → 用户 Cookie；否则 → 主站全局 Cookie
 * @param {object} cfg
 * @param {string} targetUrl
 * @param {string} [qqUserId]
 * @param {object} [db]
 */
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

/** @param {object} cfg @param {string} targetUrl @param {string} [qqUserId] @param {object} [db] */
export function buildCookieHeaderForUser(cfg, targetUrl, qqUserId, db = null) {
  const { cookies } = resolveCookiesForUser(cfg, targetUrl, qqUserId, db);
  if (!cookies.length) return '';
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** @param {object} cfg @param {string} targetUrl @param {string} [qqUserId] @param {object} [db] */
export function describeCookieSource(cfg, targetUrl, qqUserId, db = null) {
  const r = resolveCookiesForUser(cfg, targetUrl, qqUserId, db);
  if (r.source === 'user') return `已使用 QQ ${r.qqUserId} 绑定的 B站账号（${r.biliUname || '已登录'}）Cookie`;
  if (r.source === 'global') return '已使用主站全局 Cookie（用户未单独绑定 B站）';
  return '未配置 Cookie（请在「自定义域名 Cookies」配置 bilibili.com 或扫码绑定）';
}

/**
 * 发起 QR 登录
 * @param {object} db
 * @param {string} qqUserId
 */
export async function startBiliQrLogin(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid) throw new Error('qqUserId 不能为空');
  if (!db) throw new Error('SQLite 未就绪，请先一键部署 SQLite');

  const res = await fetch(BILI_QR_GENERATE, {
    headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (data.code !== 0 || !data.data?.qrcode_key) {
    throw new Error(data.message || '获取二维码失败');
  }

  const sessionKey = `qr_${uid}_${Date.now()}`;
  const expiresAt = Date.now() + 180000;
  db.prepare(`INSERT OR REPLACE INTO bili_qr_pending(session_key, qq_user_id, qrcode_key, qrcode_url, status, created_at, expires_at)
    VALUES(?,?,?,?,?,?,?)`)
    .run(sessionKey, uid, data.data.qrcode_key, data.data.url, 'pending', Date.now(), expiresAt);

  return {
    sessionKey,
    qqUserId: uid,
    qrcodeUrl: data.data.url,
    qrcodeKey: data.data.qrcode_key,
    expiresAt
  };
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
    return { status: 'confirmed', qqUserId: row.qq_user_id, session };
  }

  const pollUrl = `${BILI_QR_POLL}?qrcode_key=${encodeURIComponent(row.qrcode_key)}`;
  const res = await fetch(pollUrl, {
    headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(20000)
  });
  const setCookies = parseSetCookies(res);
  const data = await res.json();

  if (data.code === 86101) {
    return { status: 'pending', message: '等待扫码', qrcodeUrl: row.qrcode_url };
  }
  if (data.code === 86090) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('scanned', key);
    return { status: 'scanned', message: '已扫码，请在手机上确认', qrcodeUrl: row.qrcode_url };
  }
  if (data.code === 86038) {
    db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('expired', key);
    return { status: 'expired', message: '二维码已过期' };
  }
  if (data.code !== 0) {
    return { status: 'pending', message: data.message || `code=${data.code}`, qrcodeUrl: row.qrcode_url };
  }

  let cookies = setCookies;
  if (data.data?.refresh_token) {
    try {
      const refreshRes = await fetch('https://passport.bilibili.com/x/passport-login/web/cookie/refresh', {
        method: 'POST',
        headers: {
          'User-Agent': BILI_UA,
          Referer: 'https://www.bilibili.com/',
          'Content-Type': 'application/json',
          Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ')
        },
        body: JSON.stringify({ refresh_token: data.data.refresh_token }),
        signal: AbortSignal.timeout(20000)
      });
      cookies = mergeCookies(cookies, parseSetCookies(refreshRes));
    } catch { /* use poll cookies */ }
  }

  let biliMid = '';
  let biliUname = '';
  try {
    const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent': BILI_UA,
        Referer: 'https://www.bilibili.com/',
        Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      },
      signal: AbortSignal.timeout(15000)
    });
    const nav = await navRes.json();
    if (nav.code === 0 && nav.data?.isLogin) {
      biliMid = String(nav.data.mid || '');
      biliUname = String(nav.data.uname || '');
    }
  } catch { /* ignore */ }

  const session = saveBiliSession(db, row.qq_user_id, {
    cookies,
    biliMid,
    biliUname,
    loginMethod: 'qr',
    expiresAt: Date.now() + 30 * 86400000
  });

  db.prepare('UPDATE bili_qr_pending SET status = ? WHERE session_key = ?').run('confirmed', key);

  return {
    status: 'confirmed',
    message: '登录成功',
    qqUserId: row.qq_user_id,
    biliMid,
    biliUname,
    session
  };
}

/** @param {string} configDir @param {string} pluginRoot */
export async function getBiliAuthDb(configDir, pluginRoot) {
  const { db, error } = await openDatabase(configDir, pluginRoot);
  if (!db) throw new Error(error || 'SQLite 未就绪');
  return db;
}
