/**
 * SkillHub 一键环境配置（独立模块）
 */
import fs from 'fs';
import path from 'path';
import {
  detectSkillhubCli,
  installSkillhubCliGlobal,
  getSkillhubInstallDir,
  getSkillhubRegistry,
  installAgentPlaywright,
  humanizeProcessError,
  runSkillhub
} from './skillhub-cli.mjs';

export const SETUP_MODULE_VER = '2.6.11';

function probeNodeNpmNoSpawn() {
  const nodeDir = path.dirname(process.execPath);
  const seen = new Set();
  const list = [];
  const add = (p) => {
    const n = path.normalize(String(p || '').trim());
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    list.push(n);
  };
  add(path.join(nodeDir, 'npm.cmd'));
  add(path.join(nodeDir, 'npm.exe'));
  add(path.join(nodeDir, 'npm'));
  for (const dir of String(process.env.Path || process.env.PATH || '').split(path.delimiter)) {
    const d = String(dir || '').trim();
    if (!d) continue;
    add(path.join(d, 'npm.cmd'));
    add(path.join(d, 'npm'));
  }
  if (process.platform === 'win32') {
    add('C:\\Program Files\\nodejs\\npm.cmd');
    add('C:\\Program Files (x86)\\nodejs\\npm.cmd');
  }
  let npmCmd = '';
  for (const c of list) {
    try { if (fs.existsSync(c)) { npmCmd = c; break; } } catch { /* ignore */ }
  }
  let npmVer = 'ok';
  if (npmCmd) {
    try {
      const pkg = path.join(path.dirname(npmCmd), 'node_modules', 'npm', 'package.json');
      if (fs.existsSync(pkg)) npmVer = String(JSON.parse(fs.readFileSync(pkg, 'utf-8')).version || 'ok');
    } catch { /* ignore */ }
  }
  return {
    node: process.version || '',
    npm: npmVer,
    ok: !!process.version && !!npmCmd,
    nodeCmd: process.execPath,
    npmCmd: npmCmd || '(未找到 npm.cmd)',
    nodeError: process.version ? '' : '无 process.version',
    npmError: npmCmd ? '' : '未找到 npm.cmd'
  };
}

/** @type {{ running: boolean, ok: boolean, step: string, logs: { ts: number, line: string }[], error: string, finishedAt: number }} */
let setupState = {
  running: false,
  ok: false,
  step: '',
  logs: [],
  error: '',
  finishedAt: 0
};

export function getSkillhubSetupLogs(since = 0) {
  const idx = Math.max(0, Number(since) || 0);
  return {
    logs: setupState.logs.slice(idx),
    total: setupState.logs.length,
    running: setupState.running,
    ok: setupState.ok,
    step: setupState.step,
    error: setupState.error,
    finishedAt: setupState.finishedAt,
    setupModuleVer: SETUP_MODULE_VER
  };
}

export function skillhubSetupReset() {
  setupState = {
    running: true,
    ok: false,
    step: 'init',
    logs: [],
    error: '',
    finishedAt: 0
  };
}

export function skillhubSetupPushLog(line) {
  const text = String(line || '').trimEnd();
  if (!text) return;
  setupState.logs.push({ ts: Date.now(), line: text });
  if (setupState.logs.length > 2000) setupState.logs.shift();
}

export function skillhubSetupFinishError(message) {
  setupState.error = String(message || '未知错误');
  setupState.step = 'error';
  setupState.running = false;
  setupState.finishedAt = Date.now();
  skillhubSetupPushLog(`[错误] ${setupState.error}`);
}

function readPluginVersion(pluginRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf-8'));
    return String(raw.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * 从第 2 步开始（第 1 步由 index.mjs 内联完成）
 */
export async function runSkillhubEnvSetupFromStep2(cfg, pluginRoot, saveCfg, options = {}) {
  const installPlaywright = options.installPlaywright !== false;
  const installCliGlobal = options.installCliGlobal !== false;

  try {
    skillhubSetupPushLog(`[setup] module v${SETUP_MODULE_VER}`);

    setupState.step = 'cli';
    skillhubSetupPushLog('[2/5] 检测 SkillHub CLI (@astron-team/skillhub)…');
    let cli = await detectSkillhubCli(cfg);
    if (cli.mode === 'missing' && installCliGlobal) {
      skillhubSetupPushLog('  CLI 未安装，正在执行: npm install -g @astron-team/skillhub');
      const inst = await installSkillhubCliGlobal((line) => skillhubSetupPushLog(`  ${line}`));
      if (!inst.ok) {
        skillhubSetupPushLog('  全局安装失败，将使用 npx 模式…');
      } else {
        skillhubSetupPushLog('  全局安装完成');
      }
      cli = await detectSkillhubCli(cfg);
    }
    if (cli.mode === 'missing') {
      throw new Error(`SkillHub CLI 不可用: ${cli.error || 'unknown'}`);
    }
    skillhubSetupPushLog(`  CLI 模式: ${cli.mode} · 版本: ${cli.version || '?'}`);

    setupState.step = 'dirs';
    skillhubSetupPushLog('[3/5] 创建技能目录…');
    const installDir = getSkillhubInstallDir(pluginRoot);
    fs.mkdirSync(installDir, { recursive: true });
    skillhubSetupPushLog(`  安装目录: ${installDir}`);

    const token = String(cfg.skillhubToken || '').trim();
    if (token) {
      skillhubSetupPushLog('[3.5] 配置 SkillHub Token…');
      await runSkillhub(cli, ['login', '--token', token, '--registry', getSkillhubRegistry(cfg), '--json'], {
        onLine: (l) => skillhubSetupPushLog(`  ${l}`)
      });
    }

    setupState.step = 'doctor';
    skillhubSetupPushLog('[4/5] 运行 skillhub doctor 同步清单…');
    await runSkillhub(cli, ['doctor', '--json'], {
      onLine: (l) => skillhubSetupPushLog(`  ${l}`)
    });

    if (installPlaywright) {
      setupState.step = 'playwright';
      skillhubSetupPushLog('[5/5] 安装浏览器自动化 (Playwright)…');
      const pw = await installAgentPlaywright(pluginRoot, (line) => skillhubSetupPushLog(line));
      if (!pw.ok) {
        skillhubSetupPushLog('  Playwright 安装失败（可在商店页点击「安装 Playwright」重试）');
      }
    } else {
      skillhubSetupPushLog('[5/5] 跳过 Playwright');
    }

    const skillsDirs = Array.isArray(cfg.skillsDirs) ? [...cfg.skillsDirs] : [];
    if (!skillsDirs.includes(installDir)) skillsDirs.push(installDir);

    saveCfg({
      skillhubEnvReady: true,
      skillsDirs,
      skillsEnabled: true,
      agentToolsEnabled: true,
      agentShellEnabled: true,
      agentBrowserEnabled: true
    });

    setupState.ok = true;
    setupState.step = 'done';
    skillhubSetupPushLog('=== 环境配置完成 · 可使用 Skills 商店搜索安装技能 ===');
    return { ok: true };
  } catch (e) {
    const msg = e?.message || String(e);
    setupState.error = msg;
    setupState.step = 'error';
    skillhubSetupPushLog(`[错误] ${msg}`);
    return { ok: false, error: setupState.error };
  } finally {
    setupState.running = false;
    setupState.finishedAt = Date.now();
  }
}

/** 完整流程（兼容旧调用；第 1 步仍走无 spawn 检测） */
export async function runSkillhubEnvSetup(cfg, pluginRoot, saveCfg, options = {}) {
  if (setupState.running) {
    return { ok: false, error: '已有配置任务在运行' };
  }
  skillhubSetupReset();
  const pkgVer = readPluginVersion(pluginRoot);
  skillhubSetupPushLog('=== SkillHub 环境配置开始 ===');
  skillhubSetupPushLog(`平台: ${process.platform} · 插件目录: ${pluginRoot}`);
  skillhubSetupPushLog(`[setup] v${SETUP_MODULE_VER} · package v${pkgVer}`);
  skillhubSetupPushLog(`[1/5] 检测 Node.js / npm… (无子进程)`);
  const node = probeNodeNpmNoSpawn();
  if (!node.ok) {
    skillhubSetupFinishError(node.npmError || node.nodeError || '未检测到 Node.js/npm');
    return { ok: false, error: setupState.error };
  }
  skillhubSetupPushLog(`  Node ${node.node} (${node.nodeCmd})`);
  skillhubSetupPushLog(`  npm ${node.npm} (${node.npmCmd})`);
  return runSkillhubEnvSetupFromStep2(cfg, pluginRoot, saveCfg, options);
}

/** 仅安装 Playwright（环境已配置但第 5 步失败时重试） */
export async function runPlaywrightInstallOnly(pluginRoot, saveCfg) {
  if (setupState.running) {
    return { ok: false, error: '已有配置任务在运行' };
  }
  skillhubSetupReset();
  skillhubSetupPushLog('=== Playwright 安装 ===');
  try {
    setupState.step = 'playwright';
    const pw = await installAgentPlaywright(pluginRoot, (line) => skillhubSetupPushLog(line));
    if (pw.ok && saveCfg) {
      saveCfg({ agentBrowserEnabled: true });
    }
    setupState.ok = !!pw.ok;
    setupState.step = pw.ok ? 'done' : 'error';
    if (!pw.ok) setupState.error = humanizeProcessError(pw.error) || 'Playwright 安装失败';
    return pw;
  } catch (e) {
    const msg = e?.message || String(e);
    setupState.error = msg;
    setupState.step = 'error';
    skillhubSetupPushLog(`[错误] ${msg}`);
    return { ok: false, error: msg };
  } finally {
    setupState.running = false;
    setupState.finishedAt = Date.now();
  }
}
