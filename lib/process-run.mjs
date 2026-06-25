/**
 * 跨平台子进程执行（修复 Windows spawn EINVAL / CVE-2024-27980）
 * Windows 策略：永不直接 spawn .cmd/.bat，统一 cmd.exe /d /s /c "…"
 */
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

/** 部署校验：日志里应出现此版本号 */
export const PROCESS_RUN_REV = '2.6.11';

const WIN_SHELL_CMDS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'skillhub']);

function getComSpec() {
  return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
}

/** Windows 控制台输出多为 GBK，避免日志乱码 */
export function decodeWinConsole(buf) {
  if (buf == null || buf === '') return '';
  if (process.platform !== 'win32') {
    return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  }
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'latin1');
    return new TextDecoder('gb18030').decode(b);
  } catch {
    return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  }
}

function feedLines(text, onLine) {
  if (!onLine || !text) return;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim()) onLine(line);
  }
}

function quoteWinArg(arg) {
  const s = String(arg ?? '');
  if (process.platform !== 'win32') return s;
  if (!/[\s"&|<>^%!()]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export { quoteWinArg };

function buildCommandLine(cmd, args = []) {
  return [cmd, ...args].map(quoteWinArg).join(' ');
}

/**
 * @param {string} cmd
 */
export function shouldUseShell(cmd) {
  if (process.platform !== 'win32') return false;
  const base = path.basename(String(cmd || '')).toLowerCase();
  if (base.endsWith('.cmd') || base.endsWith('.bat')) return true;
  return WIN_SHELL_CMDS.has(base);
}

/**
 * Windows: cmd.exe /c 执行整条命令（不 spawn .cmd 本体）
 */
async function execViaCmd(script, opts = {}) {
  const comspec = getComSpec();
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs ?? 120000;
  const env = { ...process.env, ...(opts.env || {}) };

  try {
    const { stdout, stderr } = await execFileAsync(comspec, ['/d', '/s', '/c', script], {
      cwd,
      env,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer'
    });
    const out = decodeWinConsole(stdout);
    const err = decodeWinConsole(stderr);
    feedLines(out, opts.onLine);
    return { ok: true, code: 0, stdout: out, stderr: err };
  } catch (err) {
    const out = decodeWinConsole(err.stdout);
    const errText = decodeWinConsole(err.stderr) || err.message || '';
    feedLines(out, opts.onLine);
    feedLines(errText, opts.onLine);
    return {
      ok: false,
      code: err.code ?? 1,
      stdout: out,
      stderr: errText,
      error: err
    };
  }
}

/**
 * Windows: spawn cmd.exe /c；Unix: spawn(cmd, args)
 */
function createChild(cmd, args, opts) {
  const cwd = opts.cwd || process.cwd();
  const env = { ...process.env, ...(opts.env || {}) };
  const stdio = opts.stdio || ['ignore', 'pipe', 'pipe'];
  const isWin = process.platform === 'win32';
  const needsCmdWrapper = isWin && (
    opts.shell === true ||
    shouldUseShell(cmd) ||
    (opts.shell !== false && isWin)
  );

  if (needsCmdWrapper) {
    const line = buildCommandLine(cmd, args);
    const comspec = getComSpec();
    return spawn(comspec, ['/d', '/s', '/c', line], {
      cwd,
      env,
      stdio,
      shell: false,
      windowsHide: true
    });
  }

  return spawn(cmd, args, {
    cwd,
    env,
    stdio,
    shell: false,
    windowsHide: true
  });
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, stdio?: import('child_process').StdioOptions, shell?: boolean }} [opts]
 */
export function spawnProcess(cmd, args = [], opts = {}) {
  return createChild(cmd, args, opts);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, timeoutMs?: number, onLine?: (line: string) => void, shell?: boolean }} [opts]
 */
export function runCommand(cmd, args = [], opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120000;
  const isWin = process.platform === 'win32';

  if (isWin) {
    const line = buildCommandLine(cmd, args);
    return execViaCmd(line, { ...opts, timeoutMs });
  }

  const useExecFile = path.isAbsolute(cmd) || /\.(exe|com)$/i.test(cmd);
  if (useExecFile && opts.shell !== true) {
    const cwd = opts.cwd || process.cwd();
    const env = { ...process.env, ...(opts.env || {}) };
    return execFileAsync(cmd, args, {
      cwd,
      env,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
      .then(({ stdout, stderr }) => {
        if (opts.onLine && stdout) {
          for (const line of String(stdout).split(/\r?\n/)) {
            if (line.trim()) opts.onLine(line);
          }
        }
        return { ok: true, code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
      })
      .catch((err) => ({
        ok: false,
        code: err.code ?? 1,
        stdout: String(err.stdout || ''),
        stderr: String(err.stderr || err.message || ''),
        error: err
      }));
  }

  return runCommandSpawn(cmd, args, opts, timeoutMs);
}

/**
 * 在指定目录执行命令（Windows 用 cd /d，避免 cwd 含括号时 QQ 子进程失败）
 */
export function runCommandInDir(dir, cmd, args = [], opts = {}) {
  const workDir = path.resolve(String(dir || '.'));
  if (process.platform === 'win32') {
    const inner = buildCommandLine(cmd, args);
    const script = `pushd ${quoteWinArg(workDir)} && ${inner} && popd`;
    const safeCwd = opts.cwd || process.env.TEMP || process.env.SystemRoot || 'C:\\Windows';
    return execViaCmd(script, { ...opts, cwd: safeCwd });
  }
  return runCommand(cmd, args, { ...opts, cwd: workDir });
}

/**
 * 直接 execFile 运行 .exe（不经 cmd.exe，避免 npm.cmd 引号嵌套）
 */
export async function runNodeExe(nodeExe, args = [], opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs ?? 120000;
  const env = { ...process.env, ...(opts.env || {}) };
  try {
    const { stdout, stderr } = await execFileAsync(nodeExe, args, {
      cwd,
      env,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer'
    });
    const out = decodeWinConsole(stdout);
    const err = decodeWinConsole(stderr);
    feedLines(out, opts.onLine);
    return { ok: true, code: 0, stdout: out, stderr: err };
  } catch (e) {
    const out = decodeWinConsole(e.stdout);
    const errText = decodeWinConsole(e.stderr) || e.message || '';
    feedLines(out, opts.onLine);
    feedLines(errText, opts.onLine);
    return { ok: false, code: e.code ?? 1, stdout: out, stderr: errText, error: e };
  }
}

/** @param {string} npmCmd */
export function resolveNpmCliJs(npmCmd) {
  if (!path.isAbsolute(npmCmd)) return '';
  const dir = path.dirname(npmCmd);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.cjs')
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

/**
 * 用 node.exe 执行 npm-cli.js（Playwright 安装等，绕过 cmd/npm.cmd）
 */
export async function runNpmCli(npmCmd, args = [], opts = {}) {
  const nodeCmd = resolveNodeCommand(npmCmd);
  const cliJs = resolveNpmCliJs(npmCmd);
  if (cliJs && fs.existsSync(nodeCmd)) {
    return runNodeExe(nodeCmd, [cliJs, ...args], opts);
  }
  const cwd = opts.cwd || process.cwd();
  return runCommandInDir(cwd, npmCmd, args, opts);
}

function runCommandSpawn(cmd, args, opts, timeoutMs) {
  const cwd = opts.cwd || process.cwd();

  return new Promise((resolve) => {
    let child;
    try {
      child = createChild(cmd, args, { ...opts, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({
        ok: false,
        code: -1,
        stdout: '',
        stderr: err.message || String(err),
        error: err
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ ok: false, code: -1, stdout, stderr: stderr + '\n[timeout]', timedOut: true });
    }, timeoutMs);

    const feed = (chunk, isErr) => {
      const text = chunk.toString('utf-8');
      if (isErr) stderr += text;
      else stdout += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) opts.onLine(line);
        }
      }
    };

    child.stdout?.on('data', (c) => feed(c, false));
    child.stderr?.on('data', (c) => feed(c, true));
    child.on('error', (err) => {
      finish({
        ok: false,
        code: -1,
        stdout,
        stderr: err.message || String(err),
        error: err
      });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
  });
}

/** 在 Node 同目录、PATH、常见安装路径中查找 npm（NapCat/QQ 内置 Node 需走 PATH） */
export function findNpmCommand() {
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
  for (const c of list) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function resolveNpmCommand() {
  return findNpmCommand();
}

/** 解析真实 node 可执行文件（避免 NapCat 下 process.execPath 为 QQ.exe） */
export function resolveNodeCommand(npmCmd) {
  const npm = npmCmd || findNpmCommand();
  if (path.isAbsolute(npm)) {
    const nodeExe = path.join(
      path.dirname(npm),
      process.platform === 'win32' ? 'node.exe' : 'node'
    );
    if (fs.existsSync(nodeExe)) return nodeExe;
  }
  const execBase = path.basename(process.execPath).toLowerCase();
  if (execBase === 'node' || execBase === 'node.exe') return process.execPath;

  const seen = new Set();
  const list = [];
  const add = (p) => {
    const n = path.normalize(String(p || '').trim());
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    list.push(n);
  };
  if (process.platform === 'win32') {
    add('C:\\Program Files\\nodejs\\node.exe');
    add('C:\\Program Files (x86)\\nodejs\\node.exe');
  }
  for (const dir of String(process.env.Path || process.env.PATH || '').split(path.delimiter)) {
    const d = String(dir || '').trim();
    if (!d) continue;
    add(path.join(d, process.platform === 'win32' ? 'node.exe' : 'node'));
  }
  add(path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node.exe' : 'node'));
  for (const c of list) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return process.execPath;
}

/**
 * 检测 npm 版本（Windows: cmd.exe /c，不 spawn npm.cmd）
 * @param {string} npmCmd
 * @param {string} [cwd]
 */
async function detectNpmVersion(npmCmd, cwd) {
  const timeoutMs = 20000;
  const workDir = cwd || process.cwd();

  if (process.platform === 'win32') {
    const script = buildCommandLine(npmCmd, ['-v']);
    return execViaCmd(script, { cwd: workDir, timeoutMs });
  }

  if (path.isAbsolute(npmCmd) && fs.existsSync(npmCmd)) {
    try {
      const { stdout, stderr } = await execFileAsync(npmCmd, ['-v'], {
        cwd: workDir,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
    } catch (err) {
      return {
        ok: false,
        stdout: String(err.stdout || ''),
        stderr: String(err.stderr || err.message || err),
        error: err
      };
    }
  }

  return runCommand(npmCmd, ['-v'], { cwd: workDir, timeoutMs });
}

/**
 * 检测 Node/npm（Node 读 process.version，不启动子进程）
 * @param {string} [cwd] 用于 npm 检测的工作目录（建议传插件根目录）
 */
export async function detectNodeTooling(cwd) {
  const nodeCmd = process.execPath;
  const npmCmd = resolveNpmCommand();
  const nodeVersion = process.version || '';

  try {
    const npm = await detectNpmVersion(npmCmd, cwd);
    return {
      node: nodeVersion,
      npm: npm.ok ? npm.stdout.trim() : '',
      ok: !!nodeVersion && npm.ok,
      nodeCmd,
      npmCmd,
      rev: PROCESS_RUN_REV,
      nodeError: nodeVersion ? '' : '无法读取 process.version',
      npmError: npm.ok ? '' : (npm.stderr || npm.error?.message || 'npm 不可用')
    };
  } catch (err) {
    return {
      node: nodeVersion,
      npm: '',
      ok: false,
      nodeCmd,
      npmCmd,
      rev: PROCESS_RUN_REV,
      nodeError: '',
      npmError: err?.message || String(err)
    };
  }
}
