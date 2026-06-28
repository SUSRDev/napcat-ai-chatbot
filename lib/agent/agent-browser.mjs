/**
 * Agent 浏览器工具 — AI 的「眼睛」（截图/页面快照）与「脚」（点击/输入）
 * 优先 Playwright（环境配置时安装到 .agent-runtime）；回退 HTTP 抓取。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getAgentRuntimeDir, getPlaywrightBrowsersDir } from '../skillhub/skillhub-cli.mjs';
import { runBrowserUseTask } from './agent-browser-use.mjs';
import { normalizeCookieEntries, pickCookiesForUrl } from './agent-cookies.mjs';

const MAX_TEXT = 24000;
const DEFAULT_UA = 'napcat-plugin-chat-bot/2.6 AgentBrowser';

function getBrowserEngine(cfg) {
  return String(cfg?.agentBrowserEngine || 'playwright').toLowerCase();
}

function useBrowserUseEngine(cfg) {
  return getBrowserEngine(cfg) === 'browser-use';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBrowserHeadless(cfg) {
  return cfg?.agentBrowserHeadless === true;
}

function browserVisibleCloseDelayMs(cfg) {
  return Math.max(1000, Math.min(120000, Number(cfg?.agentBrowserVisibleCloseDelayMs) || 8000));
}

async function closeBrowserWithVisibleDelay(browser, cfg) {
  if (!isBrowserHeadless(cfg)) {
    await sleep(browserVisibleCloseDelayMs(cfg));
  }
  await browser.close();
}

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

/**
 * @param {string} url
 */
async function fetchPageText(url) {
  return fetchPageTextWithConfig(url, {});
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
  const headless = isBrowserHeadless(cfg);
  const browser = await pw.chromium.launch({ headless });
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
    return { url, title, text, screenshot: shotPath, cookies, headless };
  } finally {
    await closeBrowserWithVisibleDelay(browser, cfg);
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
  const headless = isBrowserHeadless(cfg);
  const browser = await pw.chromium.launch({ headless });
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
    const visibleNote = headless ? '' : `\n\n（可见浏览器窗口将在约 ${Math.round(browserVisibleCloseDelayMs(cfg) / 1000)} 秒后自动关闭，便于查看操作结果）`;
    return `操作完成: ${action} ${selector}${visibleNote}\n\n页面文本摘要:\n${afterText}\n\nCookies:\n${JSON.stringify(cookies, null, 2).slice(0, 6000)}`;
  } finally {
    await closeBrowserWithVisibleDelay(browser, cfg);
  }
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} pluginRoot
 * @param {Record<string, unknown>} params
 */
export async function executeBrowserTool(cfg, pluginRoot, toolKind, params) {
  const url = String(params.url || '').trim();
  if (toolKind === 'browser_use_task') {
    const task = String(params.task || '').trim();
    if (!task) return '错误：需要 task（自然语言浏览器任务描述）';
    return runBrowserUseTask(pluginRoot, cfg, { mode: 'task', url, task });
  }
  if (useBrowserUseEngine(cfg)) {
    if (toolKind === 'browser_snapshot') {
      if (!url) return '错误：需要 url';
      return runBrowserUseTask(pluginRoot, cfg, { mode: 'snapshot', url });
    }
    if (toolKind === 'browser_act') {
      if (!url) return '错误：需要 url';
      return runBrowserUseTask(pluginRoot, cfg, {
        mode: 'act',
        url,
        action: params.action,
        selector: params.selector,
        text: params.text
      });
    }
  }
  if (toolKind === 'browser_snapshot') {
    if (!url) return '错误：需要 url';
    if (cfg.agentBrowserUsePlaywright !== false) {
      const pw = await playwrightSnapshot(pluginRoot, url, cfg);
      if (pw) {
        const modeNote = pw.headless === false ? '（可见浏览器窗口）' : '';
        return `标题: ${pw.title}${modeNote}\n截图: ${pw.screenshot}\n\n正文:\n${pw.text}\n\nCookies:\n${JSON.stringify(pw.cookies || [], null, 2).slice(0, 6000)}`;
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
  const engine = getBrowserEngine(cfg);
  const engineHint = engine === 'browser-use'
    ? '当前引擎: browser-use（自然语言驱动，自动规划步骤）'
    : '当前引擎: Playwright（精确选择器操作）';
  if (cfg.agentToolBrowserSnapshotEnabled !== false) tools.push({
      type: 'function',
      function: {
        name: 'builtin_browser_snapshot',
        description: `打开网页并获取可见文本快照（AI 的「眼睛」）。${engineHint}`,
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
        description: `在网页上执行操作（AI 的「脚」）：click / fill / press。${engineHint}`,
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
  if (engine === 'browser-use' && cfg.agentToolBrowserUseTaskEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_browser_use_task',
      description: '使用 browser-use 执行自然语言浏览器任务（自动打开页面、滚动、点击、提取数据）。适合复杂多步网页操作。',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '自然语言任务，如「去 GitHub Trending 拿今天最火的 10 个项目」' },
          url: { type: 'string', description: '可选起始 URL' }
        },
        required: ['task']
      }
    },
    _builtin: 'browser_use_task'
  });
  return tools;
}
