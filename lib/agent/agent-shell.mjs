/**
 * Agent Shell 工具 — 允许 AI 执行系统命令（cmd / PowerShell / bash）
 * 仅在 agentShellEnabled 且 Agent 模式开启时暴露给模型。
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import { spawnProcess } from './process-run.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT = 48000;

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, shell?: string, cwd?: string, timeoutMs?: number }} params
 */
export async function executeShellCommand(cfg, params, runtime = {}) {
  const command = String(params.command || '').trim();
  if (!command) return '错误：command 不能为空';
  const risky = detectShellRisk(command, cfg);
  if (risky.blocked) return `错误：高危命令已被策略禁止（${risky.reason}）`;
  if (cfg.agentDangerGuardEnabled !== false && risky.level && typeof runtime.requestRiskApproval !== 'function') {
    return `错误：检测到高危操作（${risky.reason}），当前会话未接入确认流程，已拒绝执行。`;
  }
  if (risky.level && typeof runtime.requestRiskApproval === 'function') {
    const gate = await runtime.requestRiskApproval({
      operationType: 'shell_exec',
      riskLevel: risky.level,
      reason: risky.reason,
      preview: command.slice(0, 220)
    });
    if (!gate?.approved) return formatRiskPending(gate, 'shell_exec', risky.level, risky.reason);
  }

  const maxTimeout = Math.max(5000, Math.min(600000, Number(cfg.agentShellTimeoutMs) || DEFAULT_TIMEOUT_MS));
  const timeoutMs = Math.min(maxTimeout, Math.max(1000, Number(params.timeoutMs) || maxTimeout));

  const shellPref = String(params.shell || cfg.agentShellType || 'auto').toLowerCase();
  const cwd = params.cwd ? path.resolve(String(params.cwd)) : process.cwd();

  const { exe, args, shellKind } = buildShellInvocation(command, shellPref);
  if (!exe) return '错误：无法确定 Shell 类型';

  const blocked = getBlockedPatterns(cfg);
  for (const pat of blocked) {
    if (pat.test(command)) {
      return `错误：命令被安全策略拒绝（匹配: ${pat.source})`;
    }
  }

  const useVisible = cfg.agentShellVisible !== false;
  if (useVisible) {
    try {
      await launchVisibleShell(shellKind, command, cwd);
      return [
        `shell: ${shellKind}（可见窗口）`,
        `cwd: ${cwd}`,
        '已在独立控制台窗口中启动命令，窗口将保持打开以便查看输出。',
        '--- command ---',
        command.slice(0, 4000)
      ].join('\n');
    } catch (err) {
      return `Shell 可见窗口启动失败: ${err.message}`;
    }
  }

  return new Promise((resolve) => {
    const child = spawnProcess(exe, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { try { child.kill(); } catch { /* ignore */ } }
      finish(`[超时 ${timeoutMs}ms 已终止]\n${truncate(stdout)}\n${truncate(stderr)}`);
    }, timeoutMs);

    const finish = (extra) => {
      clearTimeout(timer);
      const out = [
        `shell: ${shellKind}`,
        `cwd: ${cwd}`,
        `exit: ${child.exitCode ?? '?'}`,
        '--- stdout ---',
        truncate(stdout) || '(空)',
        '--- stderr ---',
        truncate(stderr) || '(空)'
      ];
      if (extra) out.push(extra);
      resolve(out.join('\n'));
    };

    child.stdout?.on('data', (c) => { stdout += c.toString('utf-8'); });
    child.stderr?.on('data', (c) => { stderr += c.toString('utf-8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Shell 启动失败: ${err.message}`);
    });
    child.on('close', () => finish(''));
  });
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ action: string, targetPath?: string, content?: string, newPath?: string, encoding?: string, mode?: string, url?: string }} params
 */
export async function executeFileManager(cfg, params, runtime = {}) {
  const action = String(params.action || '').trim().toLowerCase();
  const targetPath = String(params.targetPath || '').trim();
  const encoding = String(params.encoding || 'utf-8').trim() || 'utf-8';
  const mode = String(params.mode || 'overwrite').trim().toLowerCase();

  if (!action) return '错误：action 不能为空';

  const safeResolve = (p) => path.resolve(String(p || ''));
  const p = safeResolve(targetPath);

  try {
    if (action === 'list') {
      if (!p) return '错误：list 需要 targetPath';
      const items = await fsp.readdir(p, { withFileTypes: true });
      return items.slice(0, 500).map((it) => `${it.isDirectory() ? '[DIR]' : '[FILE]'} ${it.name}`).join('\n') || '(空目录)';
    }
    if (action === 'read') {
      if (!p) return '错误：read 需要 targetPath';
      const data = await fsp.readFile(p, encoding);
      return String(data).slice(0, 48000);
    }
    if (action === 'write' || action === 'append') {
      if (!p) return '错误：write/append 需要 targetPath';
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const content = String(params.content || '');
      if (action === 'append' || mode === 'append') await fsp.appendFile(p, content, encoding);
      else await fsp.writeFile(p, content, encoding);
      return `写入完成: ${p}`;
    }
    if (action === 'mkdir') {
      if (!p) return '错误：mkdir 需要 targetPath';
      await fsp.mkdir(p, { recursive: true });
      return `目录已创建: ${p}`;
    }
    if (action === 'delete') {
      if (!p) return '错误：delete 需要 targetPath';
      const level = detectFileDeleteRisk(p, cfg);
      if (cfg.agentDangerGuardEnabled !== false && level && typeof runtime.requestRiskApproval !== 'function') {
        return '错误：检测到删除高危目标，当前会话未接入确认流程，已拒绝执行。';
      }
      if (level && typeof runtime.requestRiskApproval === 'function') {
        const gate = await runtime.requestRiskApproval({
          operationType: 'file_delete',
          riskLevel: level,
          reason: '删除文件/目录',
          preview: p
        });
        if (!gate?.approved) return formatRiskPending(gate, 'file_delete', level, '删除文件/目录');
      }
      await fsp.rm(p, { recursive: true, force: true });
      return `已删除: ${p}`;
    }
    if (action === 'rename' || action === 'move') {
      const newPath = safeResolve(params.newPath || '');
      if (!p || !newPath) return '错误：rename/move 需要 targetPath 和 newPath';
      await fsp.mkdir(path.dirname(newPath), { recursive: true });
      await fsp.rename(p, newPath);
      return `已重命名/移动: ${p} -> ${newPath}`;
    }
    if (action === 'copy') {
      const newPath = safeResolve(params.newPath || '');
      if (!p || !newPath) return '错误：copy 需要 targetPath 和 newPath';
      await fsp.mkdir(path.dirname(newPath), { recursive: true });
      await fsp.cp(p, newPath, { recursive: true, force: true });
      return `已复制: ${p} -> ${newPath}`;
    }
    if (action === 'download') {
      const url = String(params.url || '').trim();
      if (!url || !p) return '错误：download 需要 url 和 targetPath';
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) return `下载失败: HTTP ${res.status}`;
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const ab = await res.arrayBuffer();
      await fsp.writeFile(p, Buffer.from(ab));
      return `下载完成: ${url} -> ${p} (${Buffer.byteLength(Buffer.from(ab))} bytes)`;
    }
    return `错误：不支持的 action ${action}`;
  } catch (e) {
    return `文件操作失败: ${e.message}`;
  }
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ action: string, hive?: string, keyPath?: string, valueName?: string, valueData?: string, valueType?: string }} params
 */
export async function executeRegistryTool(cfg, params, runtime = {}) {
  if (process.platform !== 'win32') return '错误：注册表工具仅支持 Windows';
  const action = String(params.action || '').trim().toLowerCase();
  const hive = String(params.hive || 'HKCU').trim().toUpperCase();
  const keyPath = String(params.keyPath || '').trim();
  const valueName = String(params.valueName || '').trim();
  const valueData = String(params.valueData || '');
  const valueType = String(params.valueType || 'REG_SZ').trim().toUpperCase();
  const fullKey = `${hive}\\${keyPath}`;
  if (!keyPath) return '错误：keyPath 不能为空';

  if (action === 'query' || action === 'list') {
    return executeShellCommand(cfg, { shell: 'cmd', command: `reg query "${fullKey}"${valueName ? ` /v "${valueName}"` : ''}` });
  }
  if (action === 'set' || action === 'add') {
    if (cfg.agentDangerGuardEnabled !== false && cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval !== 'function') {
      return '错误：注册表写入属于高危操作，当前会话未接入确认流程，已拒绝执行。';
    }
    if (cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval === 'function') {
      const gate = await runtime.requestRiskApproval({
        operationType: 'registry_write',
        riskLevel: 'high',
        reason: '修改注册表值',
        preview: `${fullKey} -> ${valueName || 'Default'}`
      });
      if (!gate?.approved) return formatRiskPending(gate, 'registry_write', 'high', '修改注册表值');
    }
    return executeShellCommand(cfg, { shell: 'cmd', command: `reg add "${fullKey}" /f /v "${valueName || 'Default'}" /t ${valueType} /d "${valueData.replace(/"/g, '\\"')}"` }, runtime);
  }
  if (action === 'delete') {
    if (cfg.agentDangerGuardEnabled !== false && cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval !== 'function') {
      return '错误：注册表删除属于高危操作，当前会话未接入确认流程，已拒绝执行。';
    }
    const part = valueName ? `/v "${valueName}"` : '/ve';
    if (cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval === 'function') {
      const gate = await runtime.requestRiskApproval({
        operationType: 'registry_delete',
        riskLevel: 'high',
        reason: '删除注册表值',
        preview: `${fullKey} ${valueName || '(Default)'}`
      });
      if (!gate?.approved) return formatRiskPending(gate, 'registry_delete', 'high', '删除注册表值');
    }
    return executeShellCommand(cfg, { shell: 'cmd', command: `reg delete "${fullKey}" ${part} /f` }, runtime);
  }
  if (action === 'delete_key') {
    if (cfg.agentDangerGuardEnabled !== false && cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval !== 'function') {
      return '错误：删除注册表键属于高危操作，当前会话未接入确认流程，已拒绝执行。';
    }
    if (cfg.agentDangerOnRegistryWrite !== false && typeof runtime.requestRiskApproval === 'function') {
      const gate = await runtime.requestRiskApproval({
        operationType: 'registry_delete_key',
        riskLevel: 'critical',
        reason: '删除整个注册表键',
        preview: fullKey
      });
      if (!gate?.approved) return formatRiskPending(gate, 'registry_delete_key', 'critical', '删除整个注册表键');
    }
    return executeShellCommand(cfg, { shell: 'cmd', command: `reg delete "${fullKey}" /f` }, runtime);
  }
  return `错误：不支持的 action ${action}`;
}

/**
 * @param {{ targetPath?: string }} params
 */
export async function openInFileExplorer(params) {
  const p = String(params.targetPath || '').trim();
  if (!p) return '错误：targetPath 不能为空';
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) return `错误：路径不存在 ${resolved}`;
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const exe = isWin ? 'explorer.exe' : (isMac ? 'open' : 'xdg-open');
  const args = isWin ? [resolved] : [resolved];
  return new Promise((resolve) => {
    const child = spawnProcess(exe, args, { stdio: 'ignore', shell: false });
    child.on('error', (e) => resolve(`打开资源管理器失败: ${e.message}`));
    child.on('close', () => resolve(`已打开文件资源管理器: ${resolved}`));
  });
}

function truncate(s) {
  const t = String(s || '');
  if (t.length <= MAX_OUTPUT) return t;
  return t.slice(0, MAX_OUTPUT) + `\n…(截断，共 ${t.length} 字符)`;
}

/**
 * @param {string} command
 * @param {string} pref
 */
function buildShellInvocation(command, pref) {
  const isWin = process.platform === 'win32';
  if (isWin) {
    if (pref === 'cmd' || pref === 'cmd.exe') {
      return { exe: 'cmd.exe', args: ['/d', '/s', '/c', command], shellKind: 'cmd' };
    }
    if (pref === 'auto' || pref === 'powershell' || pref === 'powershell.exe' || pref === 'pwsh') {
      return {
        exe: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        shellKind: 'powershell'
      };
    }
    return {
      exe: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      shellKind: 'powershell'
    };
  }
  if (pref === 'powershell' || pref === 'pwsh') {
    return { exe: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', command], shellKind: 'pwsh' };
  }
  return { exe: '/bin/bash', args: ['-lc', command], shellKind: 'bash' };
}

/**
 * 在可见控制台窗口中执行命令（Windows: CMD/PowerShell；macOS/Linux: 系统终端）
 * @param {string} shellKind
 * @param {string} command
 * @param {string} cwd
 */
async function launchVisibleShell(shellKind, command, cwd) {
  if (process.platform === 'win32') {
    return launchVisibleShellWindows(shellKind, command, cwd);
  }
  if (process.platform === 'darwin') {
    return launchVisibleShellMac(shellKind, command, cwd);
  }
  return launchVisibleShellLinux(shellKind, command, cwd);
}

async function launchVisibleShellWindows(shellKind, command, cwd) {
  const workDir = path.resolve(cwd);
  const scriptDir = path.join(os.tmpdir(), 'napcat-agent-shell');
  await fsp.mkdir(scriptDir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isCmd = shellKind === 'cmd';
  const scriptPath = path.join(scriptDir, isCmd ? `run-${stamp}.cmd` : `run-${stamp}.ps1`);
  if (isCmd) {
    const lines = ['@echo off', `cd /d "${workDir.replace(/"/g, '""')}"`, command];
    await fsp.writeFile(scriptPath, lines.join('\r\n') + '\r\n', 'utf8');
    await spawnDetached('cmd.exe', ['/c', 'start', 'NapCat Agent CMD', 'cmd.exe', '/k', scriptPath]);
    return;
  }
  const psLines = [
    `$ErrorActionPreference = 'Continue'`,
    `Set-Location -LiteralPath '${workDir.replace(/'/g, "''")}'`,
    command
  ];
  await fsp.writeFile(scriptPath, psLines.join('\r\n') + '\r\n', 'utf8');
  await spawnDetached('cmd.exe', [
    '/c', 'start', 'NapCat Agent PowerShell', 'powershell.exe',
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', scriptPath
  ]);
}

async function launchVisibleShellMac(shellKind, command, cwd) {
  const workDir = path.resolve(cwd).replace(/'/g, "'\\''");
  const inner = shellKind === 'cmd'
    ? `cd '${workDir}' && ${command}`
    : `cd '${workDir}' && ${command}`;
  const escaped = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await spawnDetached('osascript', [
    '-e', `tell application "Terminal" to do script "${escaped}"`
  ]);
}

async function launchVisibleShellLinux(shellKind, command, cwd) {
  const workDir = path.resolve(cwd);
  const inner = `cd ${JSON.stringify(workDir)} && ${command}; exec bash`;
  const candidates = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', inner]],
    ['gnome-terminal', ['--', 'bash', '-lc', inner]],
    ['konsole', ['-e', 'bash', '-lc', inner]],
    ['xfce4-terminal', ['-e', `bash -lc ${JSON.stringify(inner)}`]]
  ];
  for (const [exe, args] of candidates) {
    try {
      await spawnDetached(exe, args);
      return;
    } catch { /* try next */ }
  }
  throw new Error('未找到可用的图形终端（x-terminal-emulator / gnome-terminal 等）');
}

function spawnDetached(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * @param {Record<string, unknown>} cfg
 */
function getBlockedPatterns(cfg) {
  const defaults = [
    /rm\s+-rf\s+\/(?!\w)/i,
    /format\s+[a-z]:/i,
    /mkfs\./i,
    /:\s*Remove-Item\s+.*-Recurse\s+-Force\s+[A-Z]:\\/i
  ];
  const custom = Array.isArray(cfg.agentShellBlockPatterns)
    ? cfg.agentShellBlockPatterns.map((p) => {
      try { return new RegExp(String(p), 'i'); } catch { return null; }
    }).filter(Boolean)
    : [];
  return [...defaults, ...custom];
}

function detectShellRisk(command, cfg) {
  const cmd = String(command || '').toLowerCase();
  const powerOp = /(shutdown|restart-computer|stop-computer|reboot|halt)\b/i.test(cmd);
  const deleteOp = /(del\s+\/|erase\s+|remove-item|rm\s+-rf|rmdir\s+\/s|rd\s+\/s)/i.test(cmd);
  if (powerOp && cfg.agentDangerOnSystemPower !== false) {
    return { level: 'critical', reason: '关机/重启/停机类命令', blocked: false };
  }
  if (deleteOp && cfg.agentDangerOnShellDelete !== false) {
    return { level: 'high', reason: '批量删除文件命令', blocked: false };
  }
  return { level: '', reason: '', blocked: false };
}

function detectFileDeleteRisk(targetPath, cfg) {
  if (cfg.agentDangerOnFileDelete === false) return '';
  const p = String(targetPath || '').toLowerCase();
  if (/(node_modules|package\.json|pnpm-lock|yarn\.lock|index\.mjs|dashboard\.html|config\.json|scripts|lib|webui)/i.test(p)) {
    return 'critical';
  }
  return 'high';
}

function formatRiskPending(gate, type, level, reason) {
  const rid = gate?.requestId || '';
  const wait = Number(gate?.waitSeconds || 5);
  const expire = Number(gate?.expiresInSeconds || 20);
  return `高危操作已拦截，等待二次确认。\noperation=${type}\nrisk=${level}\nreason=${reason}\nrequestId=${rid}\nconfirmWait=${wait}s\nexpire=${expire}s`;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildShellTools(cfg) {
  if (!cfg.agentShellEnabled) return [];
  const shellHint = process.platform === 'win32' ? 'PowerShell（默认）或 cmd' : 'bash';
  const tools = [];
  if (cfg.agentToolShellExecEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_shell_exec',
      description: `在 NapCat 服务器上执行系统命令（${shellHint}）。默认弹出可见控制台窗口（CMD/PowerShell 保持打开）；关闭「Shell 可见窗口」后改为后台静默并回传输出。`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的完整命令' },
          shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'], description: 'Shell 类型' },
          cwd: { type: 'string', description: '工作目录（可选）' },
          timeoutMs: { type: 'number', description: '超时毫秒（可选）' }
        },
        required: ['command']
      }
    },
    _builtin: 'shell_exec'
  });
  if (cfg.agentToolFileManagerEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_file_manager',
      description: '文件管理工具：浏览、读取、写入、追加、创建目录、删除、重命名/移动、复制、下载文件。用户要求把文件发到 QQ 时，写入后需在回复中使用 [发送文件:绝对路径]。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'append', 'mkdir', 'delete', 'rename', 'move', 'copy', 'download'] },
          targetPath: { type: 'string', description: '目标路径' },
          newPath: { type: 'string', description: '新路径（rename/move/copy）' },
          content: { type: 'string', description: 'write/append 内容' },
          url: { type: 'string', description: 'download 下载地址' },
          encoding: { type: 'string', description: '文本编码，默认 utf-8' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: '写入模式' }
        },
        required: ['action']
      }
    },
    _builtin: 'file_manager'
  });
  if (cfg.agentToolRegistryEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_registry_tool',
      description: 'Windows 注册表工具：查询、设置、删除值，或删除整个键。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['query', 'list', 'set', 'add', 'delete', 'delete_key'] },
          hive: { type: 'string', description: '根键，如 HKCU / HKLM' },
          keyPath: { type: 'string', description: '子路径，如 Software\\MyApp' },
          valueName: { type: 'string', description: '值名称（可选）' },
          valueData: { type: 'string', description: '写入的数据（set/add）' },
          valueType: { type: 'string', description: '类型，如 REG_SZ / REG_DWORD' }
        },
        required: ['action', 'hive', 'keyPath']
      }
    },
    _builtin: 'registry_tool'
  });
  if (cfg.agentToolExplorerEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_open_explorer',
      description: '打开系统文件资源管理器并定位到指定路径。',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: '要打开的文件或目录路径' }
        },
        required: ['targetPath']
      }
    },
    _builtin: 'open_explorer'
  });
  return tools;
}
