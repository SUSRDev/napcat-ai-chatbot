/**
 * Agent Shell 工具 — 允许 AI 执行系统命令（cmd / PowerShell / bash）
 * 仅在 agentShellEnabled 且 Agent 模式开启时暴露给模型。
 */
import path from 'path';
import { spawnProcess } from './process-run.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT = 48000;

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ command: string, shell?: string, cwd?: string, timeoutMs?: number }} params
 */
export async function executeShellCommand(cfg, params) {
  const command = String(params.command || '').trim();
  if (!command) return '错误：command 不能为空';

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

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildShellTools(cfg) {
  if (!cfg.agentShellEnabled) return [];
  const shellHint = process.platform === 'win32' ? 'PowerShell（默认）或 cmd' : 'bash';
  return [{
    type: 'function',
    function: {
      name: 'builtin_shell_exec',
      description: `在 NapCat 服务器上执行系统命令（${shellHint}）。用于文件操作、运行脚本、调用 CLI、管理系统。谨慎使用破坏性命令。`,
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
  }];
}
