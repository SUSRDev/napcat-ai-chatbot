/**
 * Node/npm 检测（纯磁盘，不 spawn 子进程）
 */
import fs from 'fs';
import path from 'path';

export function findNpmCmdOnDisk() {
  const nodeDir = path.dirname(process.execPath);
  const seen = new Set();
  const candidates = [];

  const add = (p) => {
    const n = path.normalize(String(p || '').trim());
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(n);
  };

  add(path.join(nodeDir, 'npm.cmd'));
  add(path.join(nodeDir, 'npm.exe'));
  add(path.join(nodeDir, 'npm'));

  const pathEnv = (process.env.Path || process.env.PATH || '').split(path.delimiter);
  for (const dir of pathEnv) {
    const d = String(dir || '').trim();
    if (!d) continue;
    add(path.join(d, 'npm.cmd'));
    add(path.join(d, 'npm'));
  }

  if (process.platform === 'win32') {
    add('C:\\Program Files\\nodejs\\npm.cmd');
    add('C:\\Program Files (x86)\\nodejs\\npm.cmd');
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return '';
}

function readNpmPkgVersion(npmCmd) {
  if (!npmCmd) return '';
  const npmDir = path.dirname(npmCmd);
  const pkgPaths = [
    path.join(npmDir, 'node_modules', 'npm', 'package.json'),
    path.join(npmDir, 'npm', 'package.json')
  ];
  for (const pkgPath of pkgPaths) {
    try {
      if (!fs.existsSync(pkgPath)) continue;
      const v = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
      if (v) return String(v).trim();
    } catch { /* ignore */ }
  }
  return npmCmd ? 'ok' : '';
}

/** 不启动任何子进程 */
export function probeNodeNpmNoSpawn() {
  const nodeCmd = process.execPath;
  const nodeVer = process.version || '';
  const npmCmd = findNpmCmdOnDisk();
  const npmVer = readNpmPkgVersion(npmCmd);

  return {
    node: nodeVer,
    npm: npmVer,
    ok: !!nodeVer && !!npmCmd,
    nodeCmd,
    npmCmd: npmCmd || '(未找到 npm.cmd)',
    nodeError: nodeVer ? '' : '无法读取 process.version',
    npmError: npmCmd ? '' : '未在 Node 同目录或 PATH 中找到 npm.cmd'
  };
}
