/**
 * SkillHub 环境状态（不静态依赖 skillhub-setup，避免加载失败）
 */
import fs from 'fs';
import path from 'path';
import { probeNodeNpmNoSpawn } from './skillhub-node-probe.mjs';
import {
  detectSkillhubCli,
  getSkillhubInstallDir,
  getAgentRuntimeDir,
  getSkillhubRegistry,
  scanInstalledSkillhubSkills
} from './skillhub-cli.mjs';

export const SKILLHUB_ENV_REV = '2.6.11';

function readPluginVersion(pluginRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf-8'));
    return String(raw.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} pluginRoot
 */
export async function getSkillhubEnvStatus(cfg, pluginRoot) {
  const node = probeNodeNpmNoSpawn();
  let cli = { mode: 'unknown', version: '', error: '' };
  try {
    cli = await detectSkillhubCli(cfg);
  } catch (e) {
    cli = { mode: 'error', version: '', error: e?.message || String(e) };
  }
  const installDir = getSkillhubInstallDir(pluginRoot);
  const installed = scanInstalledSkillhubSkills(installDir);
  const runtimeDir = getAgentRuntimeDir(pluginRoot);
  const hasPlaywright = fs.existsSync(path.join(runtimeDir, 'node_modules', 'playwright', 'package.json'));
  let hasChromium = false;
  try {
    const browsersDir = path.join(runtimeDir, 'browsers');
    hasChromium = fs.existsSync(browsersDir) && fs.readdirSync(browsersDir).length > 0;
  } catch { /* ignore */ }
  const pluginVersion = readPluginVersion(pluginRoot);

  let setupModuleVer = '';
  let setupRunning = false;
  try {
    const setup = await import('./skillhub-setup.mjs');
    setupModuleVer = setup.SETUP_MODULE_VER || '';
    setupRunning = !!setup.getSkillhubSetupLogs(0).running;
  } catch { /* skillhub-setup 未部署时不阻塞状态页 */ }

  return {
    pluginVersion,
    envRev: SKILLHUB_ENV_REV,
    setupModuleVer,
    envReady: !!cfg.skillhubEnvReady && cli.mode !== 'missing' && cli.mode !== 'error',
    nodeOk: node.ok,
    nodeVersion: node.node,
    npmVersion: node.npm,
    npmCmd: node.npmCmd,
    cliMode: cli.mode,
    cliVersion: cli.version || '',
    cliError: cli.error || '',
    registry: getSkillhubRegistry(cfg),
    installDir,
    installedCount: installed.length,
    installed,
    agentRuntimeDir: runtimeDir,
    hasPlaywright,
    hasChromium,
    setupRunning,
    platform: process.platform,
    homedir: installDir
  };
}
