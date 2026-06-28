/**
 * SkillHub CLI 封装（@astron-team/skillhub）
 * 文档: https://skillhub.cn/install/skillhub.md — CLI only: npm i -g @astron-team/skillhub
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as processRun from '../agent/process-run.mjs';

const execFileAsync = promisify(execFile);

function fallbackResolveNpmCommand() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = process.platform === 'win32'
    ? [path.join(nodeDir, 'npm.cmd'), path.join(nodeDir, 'npm.exe'), 'npm.cmd']
    : [path.join(nodeDir, 'npm'), 'npm'];
  for (const c of candidates) {
    if (c === 'npm' || c === 'npm.cmd' || fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function quoteWinArg(arg) {
  const s = String(arg ?? '');
  if (process.platform !== 'win32') return s;
  if (!/[\s"&|<>^%!()]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** 当 process-run.mjs 过旧时的最小 runCommand */
async function fallbackRunCommand(cmd, args = [], opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120000;
  const cwd = opts.cwd || process.cwd();
  const line = [cmd, ...args].map(quoteWinArg).join(' ');
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    try {
      const { stdout, stderr } = await execFileAsync(comspec, ['/d', '/s', '/c', line], {
        cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024
      });
      return { ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
    } catch (err) {
      return { ok: false, code: err.code ?? 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message || '') };
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024
    });
    return { ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (err) {
    return { ok: false, code: err.code ?? 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message || '') };
  }
}

export const runCommand = processRun.runCommand || fallbackRunCommand;
export const runCommandInDir = processRun.runCommandInDir || ((dir, cmd, args, opts) => runCommand(cmd, args, { ...opts, cwd: dir }));
export const runNpmCli = processRun.runNpmCli || ((npmCmd, args, opts) => runCommandInDir(opts?.cwd || process.cwd(), npmCmd, args, opts));
export const runNodeExe = processRun.runNodeExe || ((node, args, opts) => runCommand(node, args, opts));
export const detectNodeTooling = processRun.detectNodeTooling;
export const resolveNpmCommand = processRun.resolveNpmCommand || fallbackResolveNpmCommand;
export const resolveNodeCommand = processRun.resolveNodeCommand || (() => process.execPath);
export const PROCESS_RUN_REV = processRun.PROCESS_RUN_REV || 'legacy';

const SKILLHUB_PKG = '@astron-team/skillhub';
/** SkillHub CLI 官方默认 API Registry（非官网 skillhub.cn） */
const DEFAULT_REGISTRY = 'https://skill.xfyun.cn';

const REGISTRY_ALIASES = {
  'https://skillhub.cn': 'https://skill.xfyun.cn',
  'http://skillhub.cn': 'https://skill.xfyun.cn',
  'https://www.skillhub.cn': 'https://skill.xfyun.cn',
  'http://www.skillhub.cn': 'https://skill.xfyun.cn'
};

/**
 * @param {string} [input]
 */
export function normalizeSkillhubRegistry(input) {
  const raw = String(input || '').trim().replace(/\/$/, '');
  if (!raw) return DEFAULT_REGISTRY;
  return REGISTRY_ALIASES[raw.toLowerCase()] || raw;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function getSkillhubRegistry(cfg) {
  return normalizeSkillhubRegistry(cfg?.skillhubRegistry || process.env.SKILLHUB_REGISTRY || DEFAULT_REGISTRY);
}

/**
 * @param {string} pluginRoot
 */
export function getSkillhubInstallDir(pluginRoot) {
  const envOverride = String(process.env.NAPCAT_SKILLHUB_DIR || '').trim();
  if (envOverride) return path.resolve(envOverride);
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    return path.join(base, 'napcat-plugin-chat-bot', 'skills', 'skillhub');
  }
  return path.join(pluginRoot, 'skills', 'skillhub');
}

function parseVersionJson(stdout) {
  try {
    const m = stdout.match(/\{[\s\S]*\}/);
    if (!m) return '';
    const j = JSON.parse(m[0]);
    return String(j.version || j.cliVersion || '').trim();
  } catch {
    return stdout.trim().split('\n')[0] || '';
  }
}

/**
 * @param {Record<string, unknown>} cfg
 */
export async function detectSkillhubCli(cfg) {
  const custom = String(cfg.skillhubCliPath || '').trim();
  if (custom) {
    const r = await runCommand(custom, ['version', '--json'], { timeoutMs: 20000 });
    if (r.ok) {
      return { mode: 'custom', command: custom, argsPrefix: [], version: parseVersionJson(r.stdout) };
    }
  }
  const r1 = await runCommand('skillhub', ['version', '--json'], { timeoutMs: 20000 });
  if (r1.ok) {
    return { mode: 'global', command: 'skillhub', argsPrefix: [], version: parseVersionJson(r1.stdout) };
  }
  const r2 = await runCommand('npx', ['-y', `${SKILLHUB_PKG}@latest`, 'version', '--json'], { timeoutMs: 90000 });
  if (r2.ok) {
    return { mode: 'npx', command: 'npx', argsPrefix: ['-y', `${SKILLHUB_PKG}@latest`], version: parseVersionJson(r2.stdout) };
  }
  return { mode: 'missing', command: '', argsPrefix: [], version: '', error: r2.stderr || r1.stderr };
}

/**
 * @param {{ command: string, argsPrefix: string[] }} cli
 * @param {string[]} args
 * @param {object} opts
 */
export async function runSkillhub(cli, args, opts = {}) {
  if (!cli?.command) {
    return { ok: false, stdout: '', stderr: 'SkillHub CLI 未安装', json: null };
  }
  const fullArgs = [...(cli.argsPrefix || []), ...args];
  const r = await runCommand(cli.command, fullArgs, opts);
  let json = null;
  if (args.includes('--json') || fullArgs.includes('--json')) {
    try {
      const m = (r.stdout || '').match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    } catch { /* ignore */ }
  }
  return { ...r, json };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, argsPrefix: string[] }} cli
 */
function skillhubEnv(cfg) {
  const env = { ...process.env };
  const reg = getSkillhubRegistry(cfg);
  env.SKILLHUB_REGISTRY = reg;
  const token = String(cfg.skillhubToken || process.env.SKILLHUB_TOKEN || '').trim();
  if (token) env.SKILLHUB_TOKEN = token;
  return env;
}

/**
 * HTTP 直连 Registry 搜索（不经过 CLI 子进程，NapCat/QQ 环境更稳）
 * @param {Record<string, unknown>} cfg
 * @param {string} query
 */
export async function skillhubSearchHttp(cfg, query, opts = {}) {
  const registry = getSkillhubRegistry(cfg);
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 20));
  const q = String(query || '').trim();
  const params = new URLSearchParams({ q, limit: String(limit) });
  const token = String(cfg.skillhubToken || process.env.SKILLHUB_TOKEN || '').trim();
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${registry}/api/cli/v1/skills/search?${params}`;
  let res;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs || 60000)
    });
  } catch (e) {
    return { ok: false, stdout: '', stderr: `Registry 网络错误: ${e?.message || e}`, json: null, via: 'http' };
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('json')) {
    const hint = /skillhub\.cn/i.test(registry) && !/xfyun/i.test(registry)
      ? 'Registry 填了官网 skillhub.cn，请改为 API 地址 https://skill.xfyun.cn'
      : `Registry 返回 HTML 而非 API（HTTP ${res.status}），请检查 Registry 地址`;
    return { ok: false, stdout: '', stderr: hint, json: null, via: 'http' };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, stdout: '', stderr: 'Registry 响应不是有效 JSON', json: null, via: 'http' };
  }
  if (!res.ok && body?.code !== 0) {
    return {
      ok: false,
      stdout: '',
      stderr: body?.msg || body?.message || `HTTP ${res.status}`,
      json: null,
      via: 'http'
    };
  }
  const data = body?.data ?? body;
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = data?.total ?? items.length;
  const json = { ok: true, items, total };
  return { ok: true, stdout: JSON.stringify(json), stderr: '', json, via: 'http' };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, argsPrefix: string[] }} cli
 * @param {string} query
 */
export async function skillhubSearch(cfg, cli, query, opts = {}) {
  const http = await skillhubSearchHttp(cfg, query, opts);
  if (http.ok) return http;
  const args = ['search', String(query || '').trim(), '--limit', String(opts.limit || 20), '--json'];
  const reg = getSkillhubRegistry(cfg);
  if (reg) args.push('--registry', reg);
  const cliRes = await runSkillhub(cli, args, { env: skillhubEnv(cfg), timeoutMs: 60000, onLine: opts.onLine });
  if (!cliRes.ok && http.stderr) {
    cliRes.stderr = [http.stderr, cliRes.stderr].filter(Boolean).join(' · ');
  }
  return { ...cliRes, via: 'cli' };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, argsPrefix: string[] }} cli
 * @param {string} slug
 * @param {string} installDir
 */
export async function skillhubInstall(cfg, cli, slug, installDir, opts = {}) {
  const args = [
    'install', String(slug).trim(),
    '--dir', installDir,
    '--force',
    '--json'
  ];
  const reg = getSkillhubRegistry(cfg);
  if (reg) args.push('--registry', reg);
  const ns = String(opts.namespace || 'global').trim();
  if (ns) args.push('--namespace', ns);
  return runSkillhub(cli, args, { env: skillhubEnv(cfg), timeoutMs: 180000, onLine: opts.onLine });
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, argsPrefix: string[] }} cli
 * @param {string} slug
 * @param {string} installDir
 */
export async function skillhubRemove(cfg, cli, slug, installDir, opts = {}) {
  const args = ['remove', String(slug).trim(), '--all', '--json'];
  const reg = getSkillhubRegistry(cfg);
  if (reg) args.push('--registry', reg);
  const r = await runSkillhub(cli, args, { env: skillhubEnv(cfg), timeoutMs: 120000, onLine: opts.onLine });
  if (r.ok) return r;
  const target = path.join(installDir, slug);
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, stdout: 'removed local dir', stderr: '', json: { ok: true } };
    }
  } catch (e) {
    return { ok: false, stdout: r.stdout, stderr: (r.stderr || '') + '\n' + e.message, json: null };
  }
  return r;
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, argsPrefix: string[] }} cli
 * @param {string} installDir
 */
export async function skillhubList(cfg, cli, installDir) {
  const args = ['list', '--dir', installDir, '--json'];
  const reg = getSkillhubRegistry(cfg);
  if (reg) args.push('--registry', reg);
  return runSkillhub(cli, args, { env: skillhubEnv(cfg), timeoutMs: 60000 });
}

/**
 * 扫描本地 skillhub 安装目录
 * @param {string} installDir
 */
export function scanInstalledSkillhubSkills(installDir) {
  if (!installDir || !fs.existsSync(installDir)) return [];
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(installDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(installDir, ent.name);
    const skillMd = path.join(dir, 'SKILL.md');
    const metaPath = path.join(dir, '.skillhub', 'metadata.json');
    let meta = {};
    try {
      if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch { /* ignore */ }
    let description = '';
    if (fs.existsSync(skillMd)) {
      const text = fs.readFileSync(skillMd, 'utf-8');
      const dm = text.match(/^description:\s*(.+)$/m);
      if (dm) description = dm[1].trim();
    }
    out.push({
      slug: meta.slug || ent.name,
      namespace: meta.namespace || 'global',
      version: meta.version || '',
      name: ent.name,
      dir,
      description,
      installedAt: meta.installedAt || ''
    });
  }
  return out;
}

/**
 * 全局安装 SkillHub CLI
 * @param {(line: string) => void} onLine
 */
export async function installSkillhubCliGlobal(onLine) {
  const npmCmd = resolveNpmCommand();
  return runCommand(npmCmd, ['install', '-g', SKILLHUB_PKG], {
    timeoutMs: 300000,
    onLine
  });
}

export function getAgentRuntimeDir(pluginRoot) {
  const envOverride = String(process.env.NAPCAT_AGENT_RUNTIME || '').trim();
  if (envOverride) return path.resolve(envOverride);
  // Windows：插件路径常含空格/括号（如 NapCat.Shell_2 (2)），npm 在 cmd 下会失败
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    return path.join(base, 'napcat-plugin-chat-bot', 'agent-runtime');
  }
  return path.join(pluginRoot, '.agent-runtime');
}

/** 无空格/括号的 npm 工作目录（Windows 安装 playwright 包时用） */
export function getAgentNpmWorkDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.TEMP || os.homedir();
    return path.join(base, 'napcat-plugin-chat-bot', 'npm-work');
  }
  return path.join(os.tmpdir(), 'napcat-plugin-chat-bot-npm-work');
}

export function getPlaywrightModulePath(pluginRoot) {
  return path.join(getAgentRuntimeDir(pluginRoot), 'node_modules', 'playwright');
}

export function getPlaywrightBrowsersDir(pluginRoot) {
  return path.join(getAgentRuntimeDir(pluginRoot), 'browsers');
}

function pushInstallError(onLine, result, prefix) {
  const text = humanizeProcessError([result.stderr, result.stdout].filter(Boolean).join('\n').trim())
    || `${prefix} 失败 (code ${result.code ?? '?'})`;
  for (const line of text.split(/\r?\n/).slice(0, 15)) {
    if (line.trim()) onLine(`  ! ${line.trim()}`);
  }
}

/** QQ/NapCat 宿主拦截 spawn 时返回 JSON，转成可读说明 */
export function humanizeProcessError(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  try {
    const j = JSON.parse(s);
    if (j && j.message === 'unexpected failure') {
      const code = j.exitCode ?? j.code ?? '?';
      return `宿主环境拦截子进程 (exitCode: ${code})。已跳过 Playwright 安装脚本，改用手动下载浏览器。`;
    }
  } catch { /* not json */ }
  return s;
}

function isWinPathCmdError(result) {
  const t = [result.stderr, result.stdout, result.error?.message].filter(Boolean).join(' ');
  return /syntax is incorrect|语法不正确|文件名|目录名|卷标|unexpected failure|"ok"\s*:\s*false/i.test(t);
}

async function copyPlaywrightPackage(fromRoot, toRoot, onLine) {
  const src = path.join(fromRoot, 'node_modules', 'playwright');
  const dest = path.join(toRoot, 'node_modules', 'playwright');
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.join(toRoot, 'node_modules'), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  onLine(`  已同步 playwright → ${toRoot}`);
  return true;
}

async function npmInstallPlaywright(npmCmd, workDir, installOpts, onLine) {
  fs.mkdirSync(workDir, { recursive: true });
  const pkgJson = path.join(workDir, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: 'napcat-agent-runtime', private: true }, null, 2));
  }
  onLine(`  在 ${workDir} 执行 npm install playwright…`);
  return runNpmCli(npmCmd, ['install', 'playwright', '--ignore-scripts', '--no-fund', '--no-audit'], {
    ...installOpts,
    cwd: workDir
  });
}

async function installPlaywrightChromium(runtimeDir, nodeCmd, npmCmd, pwCli, npmEnv, onLine) {
  const opts = {
    timeoutMs: 600000,
    env: npmEnv,
    onLine: (l) => onLine(`  ${l}`)
  };
  let chrom = await runNodeExe(nodeCmd, [pwCli, 'install', 'chromium'], { ...opts, cwd: runtimeDir });
  if (chrom.ok) return chrom;

  if (isWinPathCmdError(chrom)) {
    onLine('  改用 npx playwright install chromium…');
    chrom = await runCommandInDir(runtimeDir, 'npx', ['playwright', 'install', 'chromium'], opts);
    if (chrom.ok) return chrom;
    onLine('  改用 npm exec playwright install…');
    chrom = await runNpmCli(npmCmd, ['exec', '--', 'playwright', 'install', 'chromium'], { ...opts, cwd: runtimeDir });
  }
  return chrom;
}

/**
 * 在 .agent-runtime 安装 Playwright + Chromium（cwd 安装，不用 --prefix）
 * @param {string} pluginRoot
 * @param {(line: string) => void} onLine
 */
export async function installAgentPlaywright(pluginRoot, onLine = () => {}) {
  const runtimeDir = getAgentRuntimeDir(pluginRoot);
  const npmWorkDir = getAgentNpmWorkDir();
  fs.mkdirSync(runtimeDir, { recursive: true });
  const pkgJson = path.join(runtimeDir, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: 'napcat-agent-runtime', private: true }, null, 2));
  }

  const npmCmd = resolveNpmCommand();
  const nodeCmd = resolveNodeCommand(npmCmd);
  const npmDir = path.isAbsolute(npmCmd) ? path.dirname(npmCmd) : '';
  const browsersDir = getPlaywrightBrowsersDir(pluginRoot);

  onLine(`  npm: ${npmCmd}`);
  onLine(`  node: ${nodeCmd}`);
  onLine(`  Playwright 目录: ${runtimeDir}`);

  const npmEnv = { ...process.env };
  if (path.isAbsolute(nodeCmd)) {
    npmEnv.NODE = nodeCmd;
    if (npmDir) {
      const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
      npmEnv[pathKey] = `${npmDir}${path.delimiter}${npmEnv[pathKey] || npmEnv.PATH || ''}`;
    }
  }
  npmEnv.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  npmEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';

  const installOpts = {
    timeoutMs: 600000,
    env: npmEnv,
    onLine: (l) => onLine(`  ${l}`)
  };

  onLine(`  ${path.basename(npmCmd)} install playwright（跳过 postinstall 脚本）…`);
  let pwInstall = await npmInstallPlaywright(npmCmd, runtimeDir, installOpts, onLine);

  if (!pwInstall.ok) {
    onLine('  主目录安装失败，改在 npm-work 备用目录…');
    pwInstall = await npmInstallPlaywright(npmCmd, npmWorkDir, installOpts, onLine);
    if (pwInstall.ok) await copyPlaywrightPackage(npmWorkDir, runtimeDir, onLine);
  }

  if (!pwInstall.ok) {
    const tempRoot = path.join(process.env.TEMP || 'C:\\Windows\\Temp', `napcat-pw-${Date.now()}`);
    onLine(`  路径/cmd 异常，改在 TEMP 安装: ${tempRoot}`);
    try {
      pwInstall = await npmInstallPlaywright(npmCmd, tempRoot, installOpts, onLine);
      if (pwInstall.ok) {
        await copyPlaywrightPackage(tempRoot, runtimeDir, onLine);
      }
    } catch (e) {
      onLine(`  TEMP 安装异常: ${e?.message || e}`);
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  if (!pwInstall.ok) {
    onLine('  Playwright 包安装失败:');
    pushInstallError(onLine, pwInstall, 'npm install');
    return { ok: false, error: humanizeProcessError(pwInstall.stderr || pwInstall.stdout) || 'npm install playwright 失败' };
  }

  const pwCli = path.join(runtimeDir, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(pwCli)) {
    const altCli = path.join(npmWorkDir, 'node_modules', 'playwright', 'cli.js');
    if (fs.existsSync(altCli)) {
      await copyPlaywrightPackage(npmWorkDir, runtimeDir, onLine);
    }
  }
  if (!fs.existsSync(pwCli)) {
    onLine(`  未找到 playwright CLI: ${pwCli}`);
    return { ok: false, error: 'playwright 未写入 node_modules' };
  }

  onLine('  下载 Chromium…');
  fs.mkdirSync(browsersDir, { recursive: true });
  const chrom = await installPlaywrightChromium(runtimeDir, nodeCmd, npmCmd, pwCli, npmEnv, onLine);
  if (!chrom.ok) {
    onLine('  Chromium 下载失败:');
    pushInstallError(onLine, chrom, 'playwright install chromium');
    return {
      ok: false,
      partial: true,
      error: humanizeProcessError(chrom.stderr || chrom.stdout) || 'playwright install chromium 失败'
    };
  }

  onLine('  Playwright 就绪');
  return { ok: true, runtimeDir, browsersDir };
}
