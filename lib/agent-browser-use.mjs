/**
 * browser-use 集成 — Python 环境检测、一键安装、任务执行
 * 参考: https://github.com/browser-use/browser-use
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { runCommand, runCommandInDir } from './process-run.mjs';
import { getAgentRuntimeDir, getPlaywrightBrowsersDir, humanizeProcessError } from './skillhub-cli.mjs';

export const BROWSER_USE_REV = '1.0.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_SRC = path.join(__dirname, 'scripts', 'browser_use_runner.py');

const PIP_MIRRORS = [
  { id: 'tsinghua', name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { id: 'aliyun', name: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple/' },
  { id: 'ustc', name: '中科大', url: 'https://pypi.mirrors.ustc.edu.cn/simple/' },
  { id: 'douban', name: '豆瓣', url: 'https://pypi.doubanio.com/simple/' },
  { id: 'official', name: 'PyPI 官方', url: '' }
];

/** @type {{ running: boolean, ok: boolean, step: string, percent: number, message: string, mirror: string, logs: { ts: number, line: string }[], error: string, finishedAt: number }} */
let setupState = {
  running: false,
  ok: false,
  step: '',
  percent: 0,
  message: '',
  mirror: '',
  logs: [],
  error: '',
  finishedAt: 0
};

export function getBrowserUseSetupState(since = 0) {
  const idx = Math.max(0, Number(since) || 0);
  return {
    logs: setupState.logs.slice(idx),
    total: setupState.logs.length,
    running: setupState.running,
    ok: setupState.ok,
    step: setupState.step,
    percent: setupState.percent,
    message: setupState.message,
    mirror: setupState.mirror,
    error: setupState.error,
    finishedAt: setupState.finishedAt,
    rev: BROWSER_USE_REV
  };
}

function pushLog(line) {
  const text = String(line || '').trimEnd();
  if (!text) return;
  setupState.logs.push({ ts: Date.now(), line: text });
  if (setupState.logs.length > 2000) setupState.logs.shift();
}

function setProgress(percent, message, step = setupState.step) {
  setupState.percent = Math.max(0, Math.min(100, Number(percent) || 0));
  setupState.message = String(message || '');
  if (step) setupState.step = step;
}

function parsePythonVersion(stdout) {
  const m = String(stdout || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], text: m[0] };
}

/**
 * @returns {Promise<{ ok: boolean, command: string, argsPrefix: string[], version: string, error?: string }>}
 */
export async function detectPython() {
  const candidates = process.platform === 'win32'
    ? [
      ['py', ['-3.12', '-V']],
      ['py', ['-3.11', '-V']],
      ['py', ['-3', '-V']],
      ['python', ['-V']],
      ['python3', ['-V']]
    ]
    : [
      ['python3.12', ['-V']],
      ['python3.11', ['-V']],
      ['python3', ['-V']],
      ['python', ['-V']]
    ];

  for (const [cmd, args] of candidates) {
    const r = await runCommand(cmd, args, { timeoutMs: 15000, shell: process.platform === 'win32' });
    const ver = parsePythonVersion(r.stdout || r.stderr);
    if (r.ok && ver && (ver.major > 3 || (ver.major === 3 && ver.minor >= 11))) {
      const prefix = cmd === 'py' ? args.slice(0, -1) : [];
      return {
        ok: true,
        command: cmd,
        argsPrefix: prefix,
        version: ver.text
      };
    }
  }
  return {
    ok: false,
    command: '',
    argsPrefix: [],
    version: '',
    error: '未找到 Python 3.11+（请安装 https://www.python.org/downloads/ 并勾选 Add to PATH）'
  };
}

export function getBrowserUseVenvDir(pluginRoot) {
  return path.join(getAgentRuntimeDir(pluginRoot), 'browser-use-venv');
}

export function getBrowserUseRunnerPath(pluginRoot) {
  return path.join(getAgentRuntimeDir(pluginRoot), 'browser-use', 'runner.py');
}

function venvPython(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function venvPip(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');
}

export function isBrowserUseInstalled(pluginRoot) {
  const venvDir = getBrowserUseVenvDir(pluginRoot);
  const py = venvPython(venvDir);
  if (!fs.existsSync(py) || !fs.existsSync(path.join(venvDir, 'pyvenv.cfg'))) return false;
  const winSite = path.join(venvDir, 'Lib', 'site-packages', 'browser_use');
  if (fs.existsSync(winSite)) return true;
  try {
    const libDir = path.join(venvDir, 'lib');
    if (fs.existsSync(libDir)) {
      for (const name of fs.readdirSync(libDir)) {
        if (name.startsWith('python') && fs.existsSync(path.join(libDir, name, 'site-packages', 'browser_use'))) {
          return true;
        }
      }
    }
  } catch { /* ignore */ }
  return false;
}

export function hasBrowserUseChromium(pluginRoot) {
  try {
    const browsersDir = getPlaywrightBrowsersDir(pluginRoot);
    return fs.existsSync(browsersDir) && fs.readdirSync(browsersDir).some((n) => /chromium/i.test(n));
  } catch {
    return false;
  }
}

async function pipInstall(pyExe, packages, mirror, pipEnv, onLine, timeoutMs = 900000) {
  const pipArgs = ['install', ...packages, '--no-warn-script-location'];
  if (mirror?.url) pipArgs.push('-i', mirror.url);
  return runCommand(pyExe, ['-m', 'pip', ...pipArgs], {
    timeoutMs,
    env: pipEnv,
    onLine: (l) => onLine?.(`  ${l}`)
  });
}

async function verifyBrowserUseImport(pluginRoot) {
  const py = venvPython(getBrowserUseVenvDir(pluginRoot));
  if (!fs.existsSync(py)) return { ok: false, error: 'venv Python 不存在' };
  const r = await runCommand(py, ['-c', 'import browser_use; print("ok")'], {
    timeoutMs: 120000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const ok = r.ok && /ok/.test(r.stdout || '');
  return { ok, error: ok ? '' : (humanizeProcessError(out) || 'import browser_use 失败') };
}

export async function getBrowserUseEnvStatus(pluginRoot, cfg = {}) {
  const py = await detectPython();
  const venvDir = getBrowserUseVenvDir(pluginRoot);
  const packageInstalled = isBrowserUseInstalled(pluginRoot);
  const verify = packageInstalled ? await verifyBrowserUseImport(pluginRoot) : { ok: false, error: '' };
  const hasChromium = hasBrowserUseChromium(pluginRoot);
  const importOk = !!verify.ok;
  const ready = importOk && hasChromium;
  let statusText = '未安装';
  if (ready) statusText = 'ready';
  else if (importOk && !hasChromium) statusText = 'need_chromium';
  else if (packageInstalled) statusText = 'need_verify';
  else if (py.ok) statusText = 'need_install';
  else statusText = 'need_python';

  return {
    rev: BROWSER_USE_REV,
    pythonOk: py.ok,
    pythonVersion: py.version,
    pythonError: py.error || '',
    venvDir,
    packageInstalled,
    importOk,
    hasChromium,
    installed: ready,
    statusText,
    importError: verify.error || '',
    envReady: !!cfg.agentBrowserUseEnvReady && ready,
    setupRunning: setupState.running,
    runtimeDir: getAgentRuntimeDir(pluginRoot),
    runnerPath: getBrowserUseRunnerPath(pluginRoot)
  };
}

/**
 * @param {string} [preferred]
 */
export async function pickBestPipMirror(preferred) {
  if (preferred && preferred !== 'auto') {
    const hit = PIP_MIRRORS.find((m) => m.id === preferred);
    if (hit) return hit;
  }
  const testable = PIP_MIRRORS.filter((m) => m.url);
  const results = await Promise.all(testable.map(async (m) => {
    const start = Date.now();
    try {
      const res = await fetch(m.url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      return { mirror: m, ms: Date.now() - start, ok: res.ok };
    } catch {
      return { mirror: m, ms: 99999, ok: false };
    }
  }));
  const ok = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
  if (ok.length) return ok[0].mirror;
  return PIP_MIRRORS.find((m) => m.id === 'tsinghua') || PIP_MIRRORS[0];
}

function pythonArgs(py, extra = []) {
  return [...(py.argsPrefix || []), ...extra];
}

function ensureRunnerScript(pluginRoot) {
  const destDir = path.join(getAgentRuntimeDir(pluginRoot), 'browser-use');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'runner.py');
  if (fs.existsSync(RUNNER_SRC)) {
    fs.copyFileSync(RUNNER_SRC, dest);
  }
  return dest;
}

/**
 * @param {string} pluginRoot
 * @param {{ mirror?: string, onLine?: (line: string) => void, onProgress?: (p: { percent: number, message: string, step?: string }) => void }} [opts]
 */
export async function installAgentBrowserUse(pluginRoot, opts = {}) {
  if (setupState.running) {
    return { ok: false, error: '已有 browser-use 安装任务在运行' };
  }

  setupState = {
    running: true,
    ok: false,
    step: 'init',
    percent: 0,
    message: '准备安装 browser-use…',
    mirror: '',
    logs: [],
    error: '',
    finishedAt: 0
  };

  const onLine = (line) => {
    pushLog(line);
    opts.onLine?.(line);
  };
  const onProgress = (percent, message, step) => {
    setProgress(percent, message, step);
    opts.onProgress?.({ percent, message, step });
  };

  try {
    onLine('=== browser-use 环境安装开始 ===');
    onProgress(2, '检测 Python 3.11+…', 'python');
    const py = await detectPython();
    if (!py.ok) throw new Error(py.error || 'Python 不可用');
    onLine(`  Python ${py.version} (${py.command})`);

    onProgress(8, '选择 PyPI 镜像…', 'mirror');
    const mirror = await pickBestPipMirror(opts.mirror || 'auto');
    setupState.mirror = mirror.id;
    onLine(`  使用镜像: ${mirror.name}${mirror.url ? ` (${mirror.url})` : ''}`);

    const runtimeDir = getAgentRuntimeDir(pluginRoot);
    const venvDir = getBrowserUseVenvDir(pluginRoot);
    const browsersDir = getPlaywrightBrowsersDir(pluginRoot);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(browsersDir, { recursive: true });

    onProgress(15, '创建 Python 虚拟环境…', 'venv');
    if (fs.existsSync(venvDir)) {
      onLine(`  复用已有 venv: ${venvDir}`);
    } else {
      const venv = await runCommand(py.command, pythonArgs(py, ['-m', 'venv', venvDir]), {
        timeoutMs: 180000,
        shell: process.platform === 'win32'
      });
      if (!venv.ok) {
        throw new Error(humanizeProcessError(venv.stderr || venv.stdout) || 'venv 创建失败');
      }
      onLine(`  venv 已创建: ${venvDir}`);
    }

    const pip = venvPip(venvDir);
    const pyExe = venvPython(venvDir);
    const pipEnv = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersDir,
      PIP_DISABLE_PIP_VERSION_CHECK: '1'
    };

    onProgress(25, '升级 pip…', 'pip');
    await runCommand(pyExe, ['-m', 'pip', 'install', '-U', 'pip', 'wheel', 'setuptools'], {
      timeoutMs: 300000,
      env: pipEnv,
      onLine: (l) => onLine(`  ${l}`)
    });

    onProgress(35, '安装 browser-use[core]（可能需要几分钟）…', 'install');
    const alreadyPkg = isBrowserUseInstalled(pluginRoot);
    if (alreadyPkg) {
      onLine('  检测到 browser-use 包已存在，跳过重复安装');
      onProgress(55, 'browser-use 包已存在', 'install');
    } else {
      const inst = await pipInstall(pyExe, ['browser-use[core]'], mirror, pipEnv, onLine);
      if (!inst.ok) {
        throw new Error(humanizeProcessError(inst.stderr || inst.stdout) || 'pip install browser-use 失败');
      }
    }

    onProgress(58, '安装 Python Playwright 驱动…', 'pip');
    const pwPkg = await pipInstall(pyExe, ['playwright'], mirror, pipEnv, onLine);
    if (!pwPkg.ok) {
      throw new Error(humanizeProcessError(pwPkg.stderr || pwPkg.stdout) || 'pip install playwright 失败');
    }

    onProgress(72, '下载 Chromium 浏览器…', 'chromium');
    const chromiumEnv = {
      ...pipEnv,
      PLAYWRIGHT_BROWSERS_PATH: browsersDir,
      PLAYWRIGHT_DOWNLOAD_HOST: process.env.PLAYWRIGHT_DOWNLOAD_HOST || 'https://cdn.npmmirror.com/binaries/playwright'
    };
    const pw = await runCommand(pyExe, ['-m', 'playwright', 'install', 'chromium'], {
      timeoutMs: 900000,
      env: chromiumEnv,
      onLine: (l) => onLine(`  ${l}`)
    });
    let chromiumOk = pw.ok;
    if (!pw.ok) {
      onLine('  镜像下载失败，尝试官方源…');
      const pw2 = await runCommand(pyExe, ['-m', 'playwright', 'install', 'chromium'], {
        timeoutMs: 900000,
        env: { ...pipEnv, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
        onLine: (l) => onLine(`  ${l}`)
      });
      chromiumOk = pw2.ok;
      if (!pw2.ok) {
        onLine('  Chromium 下载失败，可点击「一键部署」重试');
      }
    }

    onProgress(90, '验证 browser-use 导入…', 'verify');
    const verify = await verifyBrowserUseImport(pluginRoot);
    if (!verify.ok) {
      throw new Error(verify.error || 'browser-use 安装后导入失败，请查看日志');
    }

    ensureRunnerScript(pluginRoot);
    if (!chromiumOk && !hasBrowserUseChromium(pluginRoot)) {
      onProgress(95, 'browser-use 包已就绪，Chromium 待安装', 'verify');
      onLine('[提示] browser-use 已可导入，但 Chromium 未就绪。请再次点击部署以下载浏览器。');
      setupState.ok = false;
      setupState.step = 'need_chromium';
      setupState.error = 'Chromium 未安装完成';
      return { ok: false, partial: true, needChromium: true, venvDir, mirror: mirror.id };
    }

    onProgress(100, 'browser-use 环境就绪', 'done');
    onLine('=== browser-use 安装完成 ===');
    setupState.ok = true;
    setupState.step = 'done';
    return { ok: true, venvDir, mirror: mirror.id };
  } catch (e) {
    const msg = e?.message || String(e);
    setupState.error = msg;
    setupState.step = 'error';
    onLine(`[错误] ${msg}`);
    return { ok: false, error: msg };
  } finally {
    setupState.running = false;
    setupState.finishedAt = Date.now();
  }
}

const KIMI_CODE_API = 'https://api.kimi.com/coding/v1/chat/completions';
const SILICONFLOW_API = 'https://api.siliconflow.cn/v1/chat/completions';
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

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

/**
 * @param {Record<string, unknown>} cfg
 */
export function resolveBrowserUseLlm(cfg) {
  if (cfg.agentBrowserUseSameLlm !== false) {
    const provider = String(cfg.apiProvider || 'siliconflow').toLowerCase();
    let apiUrl = '';
    let apiKey = '';
    let model = String(cfg.model || '').trim();
    if (provider === 'custom') {
      apiUrl = String(cfg.customApiUrl || '').trim();
      apiKey = String(cfg.customApiKey || '').trim();
      if (!model) model = 'gpt-4o';
    } else if (provider === 'deepseek') {
      apiUrl = DEEPSEEK_API;
      apiKey = String(cfg.deepseekApiKey || '').trim();
      if (!model) model = 'deepseek-chat';
    } else if (provider === 'openai') {
      apiUrl = OPENAI_API;
      apiKey = String(cfg.openaiApiKey || '').trim();
      if (!model) model = 'gpt-4o-mini';
    } else if (provider === 'kimi') {
      apiUrl = String(cfg.kimiApiUrl || KIMI_CODE_API).trim();
      apiKey = String(cfg.kimiApiKey || '').trim();
      if (!model) model = String(cfg.model || 'kimi-for-coding');
    } else if (provider === 'bailian') {
      apiUrl = String(cfg.bailianApiUrl || '').trim();
      apiKey = String(cfg.bailianApiKey || '').trim();
      if (!model) model = 'qwen-plus';
    } else if (provider === 'codingplan') {
      apiUrl = String(cfg.codingPlanApiUrl || '').trim();
      apiKey = String(cfg.codingPlanApiKey || '').trim();
      if (!model) model = 'qwen3.5-plus';
    } else {
      apiUrl = SILICONFLOW_API;
      apiKey = String(cfg.siliconflowApiKey || '').trim();
      if (!model) model = 'deepseek-ai/DeepSeek-V3';
    }
    return { provider, apiUrl, apiKey, model, sameAsChat: true };
  }

  const provider = String(cfg.agentBrowserUseProvider || cfg.apiProvider || 'openai').toLowerCase();
  const apiUrl = String(cfg.agentBrowserUseApiUrl || '').trim();
  const apiKey = String(cfg.agentBrowserUseApiKey || '').trim();
  const model = String(cfg.agentBrowserUseModel || 'gpt-4o-mini').trim();
  return { provider, apiUrl, apiKey, model, sameAsChat: false };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} url
 */
export function collectCookiesForBrowserUse(cfg, url) {
  const all = normalizeCookieEntries(cfg);
  return url ? pickCookiesForUrl(all, url) : all;
}

/**
 * @param {string} pluginRoot
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, unknown>} params
 */
export async function runBrowserUseTask(pluginRoot, cfg, params) {
  const status = await getBrowserUseEnvStatus(pluginRoot, cfg);
  if (!status.importOk) {
    return '错误：browser-use 环境未就绪，请在 Agent 设置中选择 browser-use 并点击「一键部署环境」。';
  }
  if (!status.hasChromium) {
    return '错误：browser-use 包已安装，但 Chromium 浏览器未就绪。请再次点击「一键部署 browser-use」完成浏览器下载。';
  }

  const llm = resolveBrowserUseLlm(cfg);
  if (!llm.apiKey) {
    return '错误：browser-use 需要 LLM API Key。请在「API 与模型」配置主模型，或在 browser-use 专用模型中填写 Key。';
  }

  const runner = ensureRunnerScript(pluginRoot);
  const pyExe = venvPython(getBrowserUseVenvDir(pluginRoot));
  const url = String(params.url || '').trim();
  const mode = String(params.mode || 'task').toLowerCase();
  const taskPayload = {
    mode,
    url,
    task: String(params.task || '').trim(),
    action: String(params.action || '').trim(),
    selector: String(params.selector || '').trim(),
    text: String(params.text || '').trim(),
    headless: cfg.agentBrowserHeadless === true,
    max_steps: Math.max(5, Math.min(80, Number(cfg.agentBrowserUseMaxSteps) || 30)),
    llm: {
      provider: llm.provider,
      api_key: llm.apiKey,
      api_url: llm.apiUrl,
      model: llm.model
    },
    cookies: collectCookiesForBrowserUse(cfg, url).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: c.expires
    }))
  };

  const jobDir = path.join(getAgentRuntimeDir(pluginRoot), 'browser-use', 'jobs');
  fs.mkdirSync(jobDir, { recursive: true });
  const jobFile = path.join(jobDir, `job-${Date.now()}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(taskPayload, null, 2), 'utf8');

  const browsersDir = getPlaywrightBrowsersDir(pluginRoot);
  const timeoutMs = Math.max(60000, Math.min(900000, Number(cfg.agentBrowserUseTimeoutMs) || 300000));
  const r = await runCommand(pyExe, [runner, jobFile], {
    timeoutMs,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersDir,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    },
    onLine: () => {}
  });

  try { fs.unlinkSync(jobFile); } catch { /* ignore */ }

  const raw = (r.stdout || '').trim();
  const errRaw = (r.stderr || '').trim();
  let parsed = null;
  try {
    const line = raw.split('\n').filter(Boolean).pop() || raw;
    parsed = JSON.parse(line);
  } catch {
    if (!r.ok) {
      return `browser-use 执行失败:\n${humanizeProcessError(errRaw || raw) || '未知错误'}`;
    }
  }

  if (!parsed?.ok) {
    const err = parsed?.error || errRaw || raw || 'browser-use 执行失败';
    const trace = parsed?.trace ? `\n\n${parsed.trace.slice(0, 4000)}` : '';
    return `browser-use 错误: ${err}${trace}`;
  }

  const headlessNote = cfg.agentBrowserHeadless === true ? '' : '（可见浏览器窗口）\n';
  const cookieNote = taskPayload.cookies.length
    ? `\n\n已注入 Cookies: ${taskPayload.cookies.length} 条（来自 Cookies 列表配置）`
    : '';
  return `${headlessNote}browser-use 任务完成（模型: ${llm.model}）\n\n${String(parsed.output || '').slice(0, 48000)}${cookieNote}`;
}

export { PIP_MIRRORS };
