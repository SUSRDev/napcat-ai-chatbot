/**
 * 从 GitHub Release 检查并安装插件更新。
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const UPDATE_REPO = 'SUSRDev/napcat-ai-chatbot';
export const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPO}`;
export const GITHUB_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

const SKIP_COPY = new Set(['config.json', 'node_modules', '.git', '.update-tmp', '.update-backup']);
const PRESERVE_FILE_RE = /^config\.json$/i;

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}

function report(onProgress, phase, message, percent) {
  onProgress?.({
    phase,
    message: String(message || ''),
    percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  });
}

export function parseSemver(version) {
  const m = String(version || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: `${m[1]}.${m[2]}.${m[3]}` };
}

export function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

export function readLocalVersion(pluginDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8'));
    return String(raw.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export function pickZipAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((a) => /^napcat-plugin-chat-bot-v.*\.zip$/i.test(a.name))
    || assets.find((a) => /\.zip$/i.test(a.name))
    || null;
}

export async function fetchLatestRelease(logger) {
  const res = await fetch(GITHUB_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'napcat-plugin-chat-bot-updater'
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  const release = await res.json();
  const tag = String(release.tag_name || release.name || '').trim();
  const version = tag.replace(/^v/i, '');
  const asset = pickZipAsset(release);
  if (!asset?.browser_download_url) {
    throw new Error('最新 Release 未找到插件 zip 安装包');
  }
  logger?.info?.(`[chat-bot] 检测到最新 Release: ${tag}`);
  return {
    tag,
    version,
    name: String(release.name || tag),
    htmlUrl: String(release.html_url || UPDATE_REPO_URL + '/releases'),
    publishedAt: release.published_at || null,
    assetName: asset.name,
    downloadUrl: asset.browser_download_url
  };
}

export async function checkForUpdate(pluginDir, logger, onProgress) {
  report(onProgress, 'check', '正在查询 GitHub 最新 Release…', 4);
  const currentVersion = readLocalVersion(pluginDir);
  const latest = await fetchLatestRelease(logger);
  const hasUpdate = compareSemver(latest.version, currentVersion) > 0;
  report(onProgress, 'check', hasUpdate ? `发现新版本 v${latest.version}` : `当前已是最新 v${currentVersion}`, 8);
  return {
    currentVersion,
    latestVersion: latest.version,
    hasUpdate,
    release: latest,
    checkedAt: Date.now()
  };
}

async function downloadFile(url, destPath, onProgress, fileName) {
  const name = fileName || path.basename(destPath);
  report(onProgress, 'download', `正在连接 GitHub 下载 ${name}…`, 12);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'napcat-plugin-chat-bot-updater' }
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    report(onProgress, 'download', `下载完成 ${name}（${formatBytes(buf.length)}）`, 52);
    return buf.length;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = 12 + Math.round((received / total) * 40);
      report(onProgress, 'download', `正在下载 ${name}（${formatBytes(received)} / ${formatBytes(total)}）`, pct);
    } else {
      report(onProgress, 'download', `正在下载 ${name}（已接收 ${formatBytes(received)}）`, 20);
    }
  }
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(destPath, buf);
  report(onProgress, 'download', `下载完成 ${name}（${formatBytes(buf.length)}）`, 52);
  return buf.length;
}

async function extractZip(zipPath, destDir, onProgress) {
  report(onProgress, 'extract', '正在解压更新包…', 56);
  fs.mkdirSync(destDir, { recursive: true });
  const zipName = path.basename(zipPath);
  if (process.platform === 'win32') {
    report(onProgress, 'extract', `正在解压 ${zipName}（PowerShell）…`, 58);
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 180000 });
    report(onProgress, 'extract', '解压完成', 64);
    return;
  }
  try {
    report(onProgress, 'extract', `正在解压 ${zipName}（unzip）…`, 58);
    await execFileAsync('unzip', ['-o', zipPath, '-d', destDir], { timeout: 180000 });
    report(onProgress, 'extract', '解压完成', 64);
  } catch {
    throw new Error('解压失败，请确保系统已安装 unzip，或在 Windows 上使用 PowerShell');
  }
}

function resolveExtractRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const sub = path.join(extractDir, entries[0].name);
    if (fs.existsSync(path.join(sub, 'package.json'))) return sub;
  }
  return extractDir;
}

function shouldSkipCopy(name) {
  if (!name || name.startsWith('.')) return true;
  if (SKIP_COPY.has(name)) return true;
  if (PRESERVE_FILE_RE.test(name)) return true;
  return false;
}

function listFilesRecursive(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkipCopy(ent.name)) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(full, rel));
    else out.push(rel);
  }
  return out;
}

function copyFilesWithProgress(srcDir, destDir, files, onProgress) {
  const total = files.length || 1;
  let i = 0;
  for (const rel of files) {
    i += 1;
    const src = path.join(srcDir, rel);
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const pct = 66 + Math.round((i / total) * 24);
    report(onProgress, 'install', `正在安装文件：${rel}`, pct);
  }
}

function rmRecursive(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

export async function applyReleaseUpdate(pluginDir, releaseInfo, logger, onProgress) {
  const tmpRoot = path.join(pluginDir, '.update-tmp');
  const assetName = releaseInfo.assetName || 'update.zip';
  const zipPath = path.join(tmpRoot, assetName);
  const extractDir = path.join(tmpRoot, 'extract');
  report(onProgress, 'prepare', '正在准备更新环境…', 6);
  rmRecursive(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    await downloadFile(releaseInfo.downloadUrl, zipPath, onProgress, assetName);
    await extractZip(zipPath, extractDir, onProgress);
    report(onProgress, 'verify', '正在校验更新包结构…', 65);
    const sourceRoot = resolveExtractRoot(extractDir);
    if (!fs.existsSync(path.join(sourceRoot, 'package.json'))) {
      throw new Error('更新包结构无效，缺少 package.json');
    }
    const files = listFilesRecursive(sourceRoot);
    report(onProgress, 'install', `共 ${files.length} 个文件待安装，开始写入…`, 66);
    copyFilesWithProgress(sourceRoot, pluginDir, files, onProgress);
    const newVersion = readLocalVersion(pluginDir);
    report(onProgress, 'cleanup', '正在清理临时文件…', 94);
    logger?.info?.(`[chat-bot] 插件已更新至 v${newVersion}`);
    return { success: true, version: newVersion };
  } finally {
    rmRecursive(tmpRoot);
  }
}
