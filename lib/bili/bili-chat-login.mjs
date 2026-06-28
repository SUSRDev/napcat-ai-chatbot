/**
 * 对话中 B 站扫码登录：意图识别 + QR 下发 + 后台轮询
 */
import { startBiliQrLogin, pollBiliQrLogin } from './bili-auth.mjs';

const BILI_LOGIN_PATTERNS = [
  /(?:我要|帮我|想要|需要)?\s*(?:登录|登陆|绑定|扫码)\s*(?:一下\s*)?(?:b站|bilibili|哔哩哔哩|哔站|B站|Bili)/i,
  /(?:b站|bilibili|哔哩哔哩|哔站|B站|Bili)\s*(?:登录|登陆|绑定|扫码)/i,
  /扫码\s*(?:登录|登陆)\s*(?:b站|bilibili)?/i
];

/** @param {string} text */
export function detectBiliLoginIntent(text) {
  const s = String(text || '').trim();
  return BILI_LOGIN_PATTERNS.some((re) => re.test(s));
}

/** @param {string} qrcodeUrl */
export function buildBiliQrImageUrl(qrcodeUrl) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(String(qrcodeUrl || ''));
}

/** @type {Map<string, { timer: ReturnType<typeof setInterval>, sessionKey: string }>} */
const chatPollers = new Map();

/**
 * @param {object} db
 * @param {string} qqUserId
 */
export async function initiateBiliChatLogin(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid) throw new Error('无法识别 QQ 用户');
  if (!db) throw new Error('SQLite 未就绪，请先在 Dashboard 部署 SQLite');
  const session = await startBiliQrLogin(db, uid);
  return {
    sessionKey: session.sessionKey,
    qrcodeUrl: session.qrcodeUrl,
    qrImageUrl: buildBiliQrImageUrl(session.qrcodeUrl),
    qqUserId: uid,
    expiresAt: session.expiresAt,
    message: `已为你生成 B 站登录二维码（绑定 QQ ${uid}）。\n请用 B 站 App 扫码并在手机上确认。\n二维码约 3 分钟内有效，登录成功后会通知你。`
  };
}

/**
 * 后台轮询并在登录成功后回调
 * @param {object} opts
 */
export function scheduleBiliChatQrPoll(opts) {
  const {
    sessionKey,
    qqUserId,
    db,
    onStatus,
    onConfirmed,
    onExpired,
    intervalMs = 2500,
    maxMs = 180000
  } = opts;

  const uid = String(qqUserId || '').trim();
  const key = String(sessionKey || '').trim();
  if (!key || !uid || !db) return;

  stopBiliChatQrPoll(uid);

  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > maxMs) {
      stopBiliChatQrPoll(uid);
      onExpired?.({ message: '二维码已过期，请重新说「登录 B 站」获取新二维码。' });
      return;
    }
    try {
      const st = await pollBiliQrLogin(db, key);
      onStatus?.(st);
      if (st.status === 'confirmed') {
        stopBiliChatQrPoll(uid);
        onConfirmed?.(st);
      } else if (st.status === 'expired' || st.status === 'error') {
        stopBiliChatQrPoll(uid);
        onExpired?.(st);
      }
    } catch (e) {
      onStatus?.({ status: 'error', message: e.message });
    }
  };

  tick();
  const timer = setInterval(tick, Math.max(1500, Number(intervalMs) || 2500));
  chatPollers.set(uid, { timer, sessionKey: key });
}

/** @param {string} qqUserId */
export function stopBiliChatQrPoll(qqUserId) {
  const uid = String(qqUserId || '').trim();
  const st = chatPollers.get(uid);
  if (st?.timer) clearInterval(st.timer);
  chatPollers.delete(uid);
}

export function stopAllBiliChatQrPolls() {
  for (const uid of [...chatPollers.keys()]) stopBiliChatQrPoll(uid);
}
