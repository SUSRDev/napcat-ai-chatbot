/**
 * Agent Skills 加载器（兼容 OpenClaw / Agent Skills 风格的 SKILL.md）
 * 从插件 skills/ 目录及配置的额外路径发现技能，注入系统提示词。
 */
import fs from 'fs';
import path from 'path';

const SKILL_FILE = 'SKILL.md';

/** @typedef {{ id: string, name: string, description: string, dir: string, body: string, triggers: string[], enabled: boolean, requires: Record<string, unknown> }} SkillRecord */

/**
 * 简易 YAML frontmatter 解析（无第三方依赖）
 * @param {string} text
 */
export function parseSkillFrontmatter(text) {
  const raw = String(text || '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([\w.-]+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val.startsWith('[') && val.endsWith(']')) {
      try {
        meta[key] = JSON.parse(val.replace(/'/g, '"'));
        continue;
      } catch {
        meta[key] = val;
        continue;
      }
    } else if (val === 'true' || val === 'false') {
      meta[key] = val === 'true';
      continue;
    }
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

/**
 * @param {string} dir
 * @returns {SkillRecord | null}
 */
export function loadSkillFromDir(dir) {
  const skillPath = path.join(dir, SKILL_FILE);
  if (!fs.existsSync(skillPath)) return null;
  let text = '';
  try {
    text = fs.readFileSync(skillPath, 'utf-8');
  } catch {
    return null;
  }
  const { meta, body } = parseSkillFrontmatter(text);
  const id = String(meta.name || path.basename(dir)).trim();
  if (!id) return null;
  const triggers = Array.isArray(meta.triggers)
    ? meta.triggers.map((t) => String(t).trim()).filter(Boolean)
    : typeof meta.triggers === 'string'
      ? meta.triggers.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      : [];
  const enabled = meta.enabled !== false;
  return {
    id,
    name: String(meta.name || id),
    description: String(meta.description || meta.summary || '').trim(),
    dir,
    body,
    triggers,
    enabled,
    requires: typeof meta.requires === 'object' && meta.requires ? meta.requires : {}
  };
}

/**
 * @param {string} rootDir
 * @returns {SkillRecord[]}
 */
export function scanSkillsDirectory(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const skills = [];
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const direct = loadSkillFromDir(rootDir);
  if (direct) skills.push(direct);

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skill = loadSkillFromDir(path.join(rootDir, ent.name));
    if (skill) skills.push(skill);
  }
  return skills;
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} pluginRoot
 */
export function discoverSkills(cfg, pluginRoot) {
  const dirs = new Set();
  dirs.add(path.join(pluginRoot, 'skills'));
  if (cfg.skillhubEnvReady) {
    dirs.add(path.join(pluginRoot, 'skills', 'skillhub'));
  }
  const extra = Array.isArray(cfg.skillsDirs) ? cfg.skillsDirs : [];
  for (const d of extra) {
    const p = path.isAbsolute(d) ? d : path.join(pluginRoot, d);
    dirs.add(p);
  }
  const byId = new Map();
  for (const dir of dirs) {
    for (const skill of scanSkillsDirectory(dir)) {
      if (!skill.enabled) continue;
      byId.set(skill.id, skill);
    }
  }
  return [...byId.values()];
}

/**
 * @param {SkillRecord[]} skills
 * @param {string} userText
 * @param {Record<string, unknown>} cfg
 */
export function selectSkillsForMessage(skills, userText, cfg) {
  if (!skills.length) return [];
  const allowlist = Array.isArray(cfg.skillsAllowlist)
    ? cfg.skillsAllowlist.map((s) => String(s).trim()).filter(Boolean)
    : [];
  let pool = skills;
  if (allowlist.length) {
    pool = pool.filter((s) => allowlist.includes(s.id));
  }
  const mode = String(cfg.skillsInjectMode || 'auto').toLowerCase();
  if (mode === 'all') return pool;
  if (mode === 'none' || mode === 'off') return [];

  const text = String(userText || '').toLowerCase();
  const matched = pool.filter((s) => {
    if (!s.triggers.length) return false;
    return s.triggers.some((t) => text.includes(String(t).toLowerCase()));
  });
  if (matched.length) return matched;

  // auto：无触发词匹配时注入带 description 的前 N 个技能摘要 + 全部无 triggers 的通用技能
  const universal = pool.filter((s) => !s.triggers.length);
  const withDesc = pool.filter((s) => s.description && s.triggers.length);
  const maxHints = Math.max(1, Math.min(8, Number(cfg.skillsMaxHints) || 4));
  return [...universal, ...withDesc.slice(0, maxHints)];
}

/**
 * @param {SkillRecord[]} skills
 */
export function buildSkillsSystemBlock(skills) {
  if (!skills.length) return '';
  const parts = ['\n\n【已加载 Agent Skills — 请按以下技能说明处理用户请求】'];
  for (const s of skills) {
    parts.push(`\n## Skill: ${s.name}`);
    if (s.description) parts.push(`> ${s.description}`);
    if (s.body) parts.push(s.body);
  }
  return parts.join('\n');
}

/**
 * @param {SkillRecord[]} skills
 */
export function skillsToApiList(skills) {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    dir: s.dir,
    triggers: s.triggers,
    enabled: s.enabled,
    bodyPreview: s.body.slice(0, 200)
  }));
}
