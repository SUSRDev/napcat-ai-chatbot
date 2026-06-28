/**
 * SQLite 一键部署：npm 镜像安装 better-sqlite3 + 可选 sqlite3.exe
 */
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { getAgentRuntimeDir } from '../skillhub/skillhub-cli.mjs';
import { runCommandInDir, resolveNpmCommand } from '../skillhub/skillhub-cli.mjs';

export const SQLITE_SETUP_REV = '1.0.0';

export const NPM_MIRRORS = [
  { id: 'npmmirror', name: 'npmmirror 淘宝', url: 'https://registry.npmmirror.com' },
  { id: 'tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/npm/' },
  { id: 'huawei', name: '华为云', url: 'https://repo.huaweicloud.com/repository/npm/' },
  { id: 'official', name: 'npm 官方', url: 'https://registry.npmjs.org' }
];

/** @type {{ running: boolean, ok: boolean, step: string, percent: number, message: string, mirror: string, logs: { ts: number, line: string }[], error: string, finishedAt: number, driver: string }} */
let setupState = {
  running: false,
  ok: false,
  step: '',
  percent: 0,
  message: '',
  mirror: '',
  logs: [],
  error: '',
  finishedAt: 0,
  driver: ''
};

export function getSqliteSetupState(since = 0) {
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
    driver: setupState.driver,
    rev: SQLITE_SETUP_REV
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

export function getSqliteModuleDir(pluginRoot) {
  return path.join(getAgentRuntimeDir(pluginRoot), 'sqlite-npm');
}

export function getSqliteCliPath(pluginRoot) {
  const base = path.join(getAgentRuntimeDir(pluginRoot), 'sqlite-tools');
  return process.platform === 'win32'
    ? path.join(base, 'sqlite3.exe')
    : path.join(base, 'sqlite3');
}

const SQLITE_WIN_URLS = [
  'https://registry.npmmirror.com/-/binary/sqlite3/v3.45.0/sqlite3-win-x64-3430000.zip',
  'https://www.sqlite.org/2024/sqlite-tools-win-x64-3450000.zip'
];

async function downloadFile(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

/**
 * @param {string} pluginRoot
 * @param {{ mirror?: string }} opts
 */
export async function runSqliteSetup(pluginRoot, opts = {}) {
  if (setupState.running) return getSqliteSetupState();
  setupState = {
    running: true,
    ok: false,
    step: 'init',
    percent: 0,
    message: '准备安装 SQLite…',
    mirror: opts.mirror || 'npmmirror',
    logs: [],
    error: '',
    finishedAt: 0,
    driver: ''
  };

  try {
    const modDir = getSqliteModuleDir(pluginRoot);
    const mirrorCfg = NPM_MIRRORS.find((m) => m.id === setupState.mirror) || NPM_MIRRORS[0];
    fs.mkdirSync(modDir, { recursive: true });

    setProgress(10, '初始化 npm 包目录…', 'npm-init');
    pushLog(`使用镜像：${mirrorCfg.name} (${mirrorCfg.url})`);
    if (!fs.existsSync(path.join(modDir, 'package.json'))) {
      fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify({
        name: 'napcat-sqlite-runtime',
        private: true,
        type: 'commonjs'
      }, null, 2));
    }

    setProgress(25, '安装 better-sqlite3…', 'npm-install');
    const npm = resolveNpmCommand();
    const installArgs = ['install', 'better-sqlite3@11.8.1', '--no-save', '--no-package-lock'];
    if (mirrorCfg.url) installArgs.push(`--registry=${mirrorCfg.url}`);
    const r = await runCommandInDir(modDir, npm, installArgs, { timeoutMs: 600000 });
    pushLog(r.stdout || r.stderr || '');
    if (!r.ok) throw new Error(r.stderr || r.stdout || 'npm install better-sqlite3 失败');

    setProgress(70, '验证 better-sqlite3…', 'verify');
    const testPath = path.join(modDir, 'test-load.cjs');
    fs.writeFileSync(testPath, "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('SELECT 1'); db.close(); console.log('ok');");
    const test = await runCommandInDir(modDir, process.execPath, [testPath], { timeoutMs: 30000 });
    fs.unlinkSync(testPath);
    if (!test.ok || !String(test.stdout).includes('ok')) {
      throw new Error('better-sqlite3 加载验证失败：' + (test.stderr || test.stdout));
    }
    setupState.driver = 'better-sqlite3';
    pushLog('better-sqlite3 安装成功');

    setProgress(85, '下载 sqlite3 CLI（可选）…', 'cli');
    try {
      const toolsDir = path.dirname(getSqliteCliPath(pluginRoot));
      fs.mkdirSync(toolsDir, { recursive: true });
      const zipPath = path.join(toolsDir, 'sqlite-tools.zip');
      for (const url of SQLITE_WIN_URLS) {
        try {
          pushLog(`尝试下载 CLI：${url}`);
          await downloadFile(url, zipPath);
          pushLog('sqlite3 CLI 已下载（需手动解压到 sqlite-tools/ 目录时可使用）');
          break;
        } catch (e) {
          pushLog(`CLI 下载跳过：${e.message}`);
        }
      }
    } catch { /* optional */ }

    setProgress(100, 'SQLite 环境就绪', 'done');
    setupState.ok = true;
    setupState.running = false;
    setupState.finishedAt = Date.now();
    pushLog('[完成] SQLite 驱动已安装');
  } catch (e) {
    setupState.error = e.message || String(e);
    setupState.step = 'error';
    setupState.running = false;
    setupState.finishedAt = Date.now();
    pushLog(`[错误] ${setupState.error}`);
  }
  return getSqliteSetupState();
}

export async function detectSqliteDriver(pluginRoot) {
  const modDir = getSqliteModuleDir(pluginRoot);
  const bsPath = path.join(modDir, 'node_modules', 'better-sqlite3');
  if (fs.existsSync(bsPath)) {
    try {
      const testPath = path.join(modDir, 'test-load.cjs');
      fs.writeFileSync(testPath, "const D=require('better-sqlite3'); const db=new D(':memory:'); db.close(); console.log('ok');");
      const test = await runCommandInDir(modDir, process.execPath, [testPath], { timeoutMs: 15000 });
      try { fs.unlinkSync(testPath); } catch { /* ignore */ }
      if (test.ok && String(test.stdout).includes('ok')) {
        return { ok: true, driver: 'better-sqlite3', moduleDir: modDir };
      }
    } catch { /* ignore */ }
  }
  try {
    await import('node:sqlite');
    return { ok: true, driver: 'node:sqlite', moduleDir: '' };
  } catch { /* ignore */ }
  return { ok: false, driver: '', error: '未安装 SQLite 驱动，请在 Dashboard 一键部署' };
}
