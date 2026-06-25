/**
 * Agent 浏览器工具 — AI 的「眼睛」（截图/页面快照）与「脚」（点击/输入）
 * 优先 Playwright（环境配置时安装到 .agent-runtime）；回退 HTTP 抓取。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getAgentRuntimeDir, getPlaywrightBrowsersDir } from './skillhub-cli.mjs';

const MAX_TEXT = 24000;
const DEFAULT_UA = 'napcat-plugin-chat-bot/2.6 AgentBrowser';

/**
 * @param {string} pluginRoot
 */
async function loadPlaywright(pluginRoot) {
  const runtimeDir = getAgentRuntimeDir(pluginRoot);
  const pkgJson = path.join(runtimeDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return null;
  const browsersDir = getPlaywrightBrowsersDir(pluginRoot);
  if (fs.existsSync(browsersDir)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  }
  try {
    const req = createRequire(pathToFileURL(pkgJson).href);
    return req('playwright');
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * @param {string} url
 */
async function fetchPageText(url) {
  return fetchPageTextWithConfig(url, {});
}

function normalizeCookieEntries(cfg) {
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

function pickCookiesForUrl(cookieList, targetUrl) {
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

function normalizeExtraHeaders(cfg) {
  if (cfg?.agentBrowserAdvancedEnabled === false) return {};
  const raw = cfg?.agentBrowserExtraHeaders;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim();
    const val = String(v ?? '').trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return out;
}

async function fetchPageTextWithConfig(url, cfg) {
  const cookies = pickCookiesForUrl(normalizeCookieEntries(cfg), url);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const userAgent = cfg?.agentBrowserAdvancedEnabled === false
    ? DEFAULT_UA
    : (String(cfg?.agentBrowserUserAgent || '').trim() || DEFAULT_UA);
  const extraHeaders = normalizeExtraHeaders(cfg);
  const headers = { 'User-Agent': userAgent, ...extraHeaders };
  if (cookieHeader) headers.Cookie = cookieHeader;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30000)
  });
  const html = await res.text();
  return {
    url,
    status: res.status,
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '',
    text: stripHtml(html)
  };
}

/**
 * @param {string} pluginRoot
 * @param {string} url
 */
async function playwrightSnapshot(pluginRoot, url, cfg = {}) {
  const pw = await loadPlaywright(pluginRoot);
  if (!pw) return null;
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: cfg?.agentBrowserAdvancedEnabled === false
        ? DEFAULT_UA
        : (String(cfg.agentBrowserUserAgent || '').trim() || DEFAULT_UA),
      extraHTTPHeaders: normalizeExtraHeaders(cfg)
    });
    const toInject = pickCookiesForUrl(normalizeCookieEntries(cfg), url);
    if (toInject.length) {
      const mapped = toInject.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: c.httpOnly === true,
        sameSite: ['Strict', 'None', 'Lax'].includes(c.sameSite) ? c.sameSite : 'Lax',
        expires: c.expires
      }));
      await context.addCookies(mapped);
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 20000) || '');
    const shotDir = path.join(getAgentRuntimeDir(pluginRoot), 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, `snap-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    const cookies = await context.cookies(url);
    await context.close();
    return { url, title, text, screenshot: shotPath, cookies };
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} pluginRoot
 * @param {{ url: string, selector?: string, text?: string, action?: string }} params
 */
async function playwrightAction(pluginRoot, params, cfg = {}) {
  const pw = await loadPlaywright(pluginRoot);
  if (!pw) return '错误：Playwright 未安装，请先在 Skills 商店完成「一键配置环境」';
  const url = String(params.url || '').trim();
  const action = String(params.action || 'click').toLowerCase();
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: cfg?.agentBrowserAdvancedEnabled === false
        ? DEFAULT_UA
        : (String(cfg.agentBrowserUserAgent || '').trim() || DEFAULT_UA),
      extraHTTPHeaders: normalizeExtraHeaders(cfg)
    });
    if (url) {
      const toInject = pickCookiesForUrl(normalizeCookieEntries(cfg), url);
      if (toInject.length) {
        await context.addCookies(toInject.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== false,
          httpOnly: c.httpOnly === true,
          sameSite: ['Strict', 'None', 'Lax'].includes(c.sameSite) ? c.sameSite : 'Lax',
          expires: c.expires
        })));
      }
    }
    const page = await context.newPage();
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const selector = String(params.selector || '').trim();
    if (!selector) return '错误：需要 selector';
    if (action === 'click') {
      await page.click(selector, { timeout: 15000 });
    } else if (action === 'fill' || action === 'type') {
      await page.fill(selector, String(params.text || ''), { timeout: 15000 });
    } else if (action === 'press') {
      await page.press(selector, String(params.text || 'Enter'), { timeout: 15000 });
    } else {
      return `错误：未知 action ${action}`;
    }
    const afterText = await page.evaluate(() => document.body?.innerText?.slice(0, 8000) || '');
    const cookies = url ? await context.cookies(url) : [];
    await context.close();
    return `操作完成: ${action} ${selector}\n\n页面文本摘要:\n${afterText}\n\nCookies:\n${JSON.stringify(cookies, null, 2).slice(0, 6000)}`;
  } finally {
    await browser.close();
  }
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} pluginRoot
 * @param {Record<string, unknown>} params
 */
export async function executeBrowserTool(cfg, pluginRoot, toolKind, params) {
  const url = String(params.url || '').trim();
  if (toolKind === 'browser_snapshot') {
    if (!url) return '错误：需要 url';
    if (cfg.agentBrowserUsePlaywright !== false) {
      const pw = await playwrightSnapshot(pluginRoot, url, cfg);
      if (pw) {
        return `标题: ${pw.title}\n截图: ${pw.screenshot}\n\n正文:\n${pw.text}\n\nCookies:\n${JSON.stringify(pw.cookies || [], null, 2).slice(0, 6000)}`;
      }
    }
    try {
      const f = await fetchPageTextWithConfig(url, cfg);
      const usedCookies = pickCookiesForUrl(normalizeCookieEntries(cfg), url);
      return `标题: ${f.title} (HTTP ${f.status})\n\n正文:\n${f.text}\n\n请求携带 Cookies:\n${JSON.stringify(usedCookies, null, 2).slice(0, 3000)}`;
    } catch (e) {
      return `页面抓取失败: ${e.message}`;
    }
  }
  if (toolKind === 'browser_act') {
    return playwrightAction(pluginRoot, params, cfg);
  }
  return `错误：未知浏览器工具 ${toolKind}`;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildBrowserTools(cfg) {
  if (!cfg.agentBrowserEnabled) return [];
  const tools = [];
  if (cfg.agentToolBrowserSnapshotEnabled !== false) tools.push({
      type: 'function',
      function: {
        name: 'builtin_browser_snapshot',
        description: '打开网页并获取可见文本快照（AI 的「眼睛」）。用于阅读页面内容、新闻、文档。有 Playwright 时会截图。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '完整 URL，含 https://' }
          },
          required: ['url']
        }
      },
      _builtin: 'browser_snapshot'
    });
  if (cfg.agentToolBrowserActEnabled !== false) tools.push({
      type: 'function',
      function: {
        name: 'builtin_browser_act',
        description: '在网页上执行操作（AI 的「脚」）：click 点击、fill 填写输入框、press 按键。需要 Playwright。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '先打开的页面 URL' },
            action: { type: 'string', enum: ['click', 'fill', 'press'], description: '操作类型' },
            selector: { type: 'string', description: 'CSS 选择器' },
            text: { type: 'string', description: 'fill/press 的文本或按键名' }
          },
          required: ['url', 'action', 'selector']
        }
      },
      _builtin: 'browser_act'
    });
  return tools;
}
