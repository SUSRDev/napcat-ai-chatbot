/**
 * RunningHub 画图机器人逻辑（从 napcat-plugin-ai-draw-bot 迁移）
 */

import { resolveTemplate } from './messages.mjs';

export const DRAW_BOT_DEFAULTS = {
  drawBotEnabled: false,
  drawBotApiUrl: 'http://127.0.0.1:1088',
  drawBotTriggerKeywords: ['画图', '生图', '绘图', 'AI画图'],
  drawBotSlashCommands: ['/draw', '/画图'],
  drawCommandsEnabled: true,
  drawUserCommands: ['help', 'draw-help', 'draw-queue'],
  drawAdminCommands: ['draw-cancel', 'draw-promote', 'draw-clear', 'draw-stats', 'draw-blacklist'],
  drawBotCooldownSeconds: 60,
  drawBotCooldownScope: 'user',
  drawBotUseSyncMode: false,
  drawBotPollIntervalMs: 5000,
  drawBotPollTimeoutMs: 300000,
  drawBotDailyLimitPerUser: 0,
  drawBotDailyLimitPerGroup: 0,
  drawBotStylePresets: {
    二次元: 'anime style, high quality, ',
    写实: 'photorealistic, 8k, detailed, ',
    赛博: 'cyberpunk, neon, futuristic, '
  },
  drawBotNegativePromptDefault: 'blurry, low quality, deformed',
  drawBotProfanityCheckEnabled: false,
  drawBotProfanityCheckApiUrl: 'https://uapis.cn/api/v1/text/profanitycheck',
  drawBotOpenTimeWindow: false,
  drawBotOpenTimeStart: '08:00',
  drawBotOpenTimeEnd: '22:00',
  drawBotAdminTokens: [],
  drawBotUserCooldownOverrides: {},
  drawBotUserInstanceOverrides: {},
  drawBotUserWebSearchOverrides: {},
  drawBotUserPromptOptimizeOverrides: {},
  drawBotTavilyApiKey: '',
  drawBotDashscopeApiUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  drawBotDashscopeApiKey: '',
  drawBotQwenModel: 'qwen3.5-plus',
  drawBotMessages: {}
};

const drawCooldownUntil = new Map();

function getApiBase(cfg) {
  return (cfg.drawBotApiUrl || 'http://127.0.0.1:1088').replace(/\/$/, '');
}

function msg(cfg, key, vars) {
  return resolveTemplate(cfg, key, vars);
}

/** 解析画图元指令（/draw-queue、前缀+draw-help 等） */
export function parseDrawMetaCommand(plainText, cfg) {
  if (!cfg.drawCommandsEnabled) return null;
  const t = String(plainText || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const userCmds = (cfg.drawUserCommands || DRAW_BOT_DEFAULTS.drawUserCommands).map((c) => String(c).toLowerCase());
  const adminCmds = (cfg.drawAdminCommands || DRAW_BOT_DEFAULTS.drawAdminCommands).map((c) => String(c).toLowerCase());
  const allMeta = [...new Set([...userCmds, ...adminCmds, 'help'])];

  const tryMatch = (cmdName, rest = '') => {
    const c = cmdName.toLowerCase();
    if (!allMeta.includes(c)) return null;
    const adminOnly = adminCmds.includes(c);
    return { cmd: c, arg: rest.trim(), adminOnly };
  };

  // 斜杠指令 /draw-queue
  for (const c of allMeta) {
    const slash = '/' + c;
    if (lower === slash) return tryMatch(c, '');
    if (lower.startsWith(slash + ' ')) return tryMatch(c, t.slice(slash.length).trim());
  }

  // 指令前缀 + 命令名，如 /draw-queue（commandPrefix 为 /）
  const cp = (cfg.commandPrefix ?? '/').trim();
  if (cp) {
    for (const c of allMeta) {
      const full = cp + c;
      if (lower === full.toLowerCase()) return tryMatch(c, '');
      if (lower.startsWith(full.toLowerCase() + ' ')) return tryMatch(c, t.slice(full.length).trim());
    }
  }

  // 管理员前缀 + draw-cancel
  const ap = (cfg.adminCommandPrefix || '#').trim();
  if (ap && t.startsWith(ap)) {
    const rest = t.slice(ap.length).trim();
    const parts = rest.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    if (adminCmds.includes(cmd)) {
      return { cmd, arg: parts.slice(1).join(' '), adminOnly: true, viaAdminPrefix: true };
    }
  }

  return null;
}

export function createDrawBot(deps) {
  const { fetchJson, sendGroup, log, isAdminUser } = deps;

  function getCooldownSeconds(cfg, userId) {
    const ov = cfg.drawBotUserCooldownOverrides || {};
    const userSec = ov[String(userId)];
    if (userSec != null && Number(userSec) >= 0) return Number(userSec);
    return Number(cfg.drawBotCooldownSeconds) || 0;
  }

  function checkCooldown(cfg, groupId, userId) {
    const sec = getCooldownSeconds(cfg, userId);
    if (sec <= 0) return { ok: true };
    const key = cfg.drawBotCooldownScope === 'group' ? `g:${groupId}` : `g:${groupId}:u:${userId}`;
    const until = drawCooldownUntil.get(key) || 0;
    if (Date.now() < until) return { ok: false, seconds: Math.ceil((until - Date.now()) / 1000) };
    return { ok: true };
  }

  function setCooldown(cfg, groupId, userId) {
    const sec = getCooldownSeconds(cfg, userId);
    if (sec <= 0) return;
    const key = cfg.drawBotCooldownScope === 'group' ? `g:${groupId}` : `g:${groupId}:u:${userId}`;
    drawCooldownUntil.set(key, Date.now() + sec * 1000);
  }

  function matchDrawTrigger(cfg, raw) {
    for (const kw of cfg.drawBotTriggerKeywords || []) {
      const k = String(kw).trim();
      if (!k) continue;
      if (raw === k || raw.startsWith(k + ' ')) return raw.slice(k.length).trim();
    }
    for (const cmd of cfg.drawBotSlashCommands || []) {
      const c = String(cmd).trim();
      if (!c) continue;
      const cl = c.toLowerCase();
      const rl = raw.toLowerCase();
      if (rl === cl || rl.startsWith(cl + ' ')) return raw.slice(c.length).trim();
    }
    return null;
  }

  function parsePrompt(cfg, raw) {
    const presets = cfg.drawBotStylePresets || {};
    const negDefault = cfg.drawBotNegativePromptDefault || '';
    let style = '';
    let rest = raw.trim();
    for (const key of Object.keys(presets)) {
      if (rest.startsWith(key + ' ') || rest === key) {
        style = presets[key] || '';
        rest = rest.slice(key.length).trim();
        break;
      }
    }
    return { style, prompt: rest, negative_prompt: negDefault };
  }

  async function apiGenerate(cfg, prompt, userId, groupId, nickname, sync, opts = {}) {
    const base = getApiBase(cfg);
    const url = sync ? `${base}/generate/sync` : `${base}/generate`;
    const body = {
      prompt,
      user_id: userId,
      group_id: groupId,
      nickname: nickname || '',
      negative_prompt: opts.negative_prompt || '',
      style: opts.style || ''
    };
    if (opts.instance_type) body.instance_type = opts.instance_type;
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: sync ? AbortSignal.timeout(Number(cfg.drawBotPollTimeoutMs) || 300000) : undefined
    });
  }

  function getAdminToken(cfg) {
    const tokens = cfg.drawBotAdminTokens || [];
    return Array.isArray(tokens) ? tokens[0] : String(tokens || '').split(/[,，\s]+/)[0];
  }

  async function handleDrawMetaCommand(ctx, cfg, groupId, userId, parsed) {
    if (!parsed?.cmd) return false;
    if (parsed.adminOnly && !(isAdminUser?.(userId, cfg))) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawAdminDenied'));
      return true;
    }

    const token = getAdminToken(cfg);
    const base = getApiBase(cfg);

    if (parsed.cmd === 'help' || parsed.cmd === 'draw-help') {
      const styles = Object.keys(cfg.drawBotStylePresets || {}).join('、') || '—';
      const cmds = [
        ...(cfg.drawBotSlashCommands || ['/draw']),
        ...(cfg.drawBotTriggerKeywords || ['画图']),
        '/draw-queue', '/draw-help'
      ].join('、');
      await sendGroup(ctx, groupId, msg(cfg, 'drawHelp', { commands: cmds, styles }));
      return true;
    }

    if (parsed.cmd === 'draw-queue') {
      if (!token?.trim()) {
        await sendGroup(ctx, groupId, msg(cfg, 'drawServiceUnavailable'));
        return true;
      }
      const data = await fetchJson(`${base}/api/queue`, { headers: { 'X-Admin-Token': token } });
      if (!data?.success) {
        await sendGroup(ctx, groupId, data?.error || msg(cfg, 'drawServiceUnavailable'));
        return true;
      }
      const q = data.queue || [];
      if (!q.length) {
        await sendGroup(ctx, groupId, msg(cfg, 'drawQueueEmpty'));
        return true;
      }
      let text = msg(cfg, 'drawQueueHeader', { count: q.length }) + '\n';
      q.forEach((task, i) => {
        text += msg(cfg, 'drawQueueLine', {
          index: i,
          prompt: (task.prompt || '').slice(0, 30),
          user_id: task.user_id
        }) + '\n';
      });
      await sendGroup(ctx, groupId, text.slice(0, 1500));
      return true;
    }

    if (!token?.trim()) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawServiceUnavailable'));
      return true;
    }

    if (parsed.cmd === 'draw-cancel') {
      const body = {};
      const arg = (parsed.arg || '').trim();
      if (/^\d+$/.test(arg)) body.index = parseInt(arg, 10);
      else if (arg) body.user_id = arg;
      const data = await fetchJson(`${base}/api/queue/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify(body)
      });
      await sendGroup(ctx, groupId, data?.success
        ? msg(cfg, 'drawCancelOk', { removed: data.removed || 0 })
        : (data?.error || msg(cfg, 'drawFailed', { error: '操作失败' })));
      return true;
    }

    if (parsed.cmd === 'draw-promote') {
      const idx = parseInt((parsed.arg || '0').trim(), 10);
      const data = await fetchJson(`${base}/api/queue/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ index: idx })
      });
      await sendGroup(ctx, groupId, data?.success ? msg(cfg, 'drawPromoteOk') : (data?.error || msg(cfg, 'drawFailed', { error: '操作失败' })));
      return true;
    }

    if (parsed.cmd === 'draw-clear') {
      const data = await fetchJson(`${base}/api/queue/clear`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token }
      });
      await sendGroup(ctx, groupId, data?.success
        ? msg(cfg, 'drawClearOk', { cleared: data.cleared || 0 })
        : (data?.error || msg(cfg, 'drawFailed', { error: '操作失败' })));
      return true;
    }

    if (parsed.cmd === 'draw-stats') {
      const data = await fetchJson(`${base}/api/stats`);
      if (data?.success) {
        await sendGroup(ctx, groupId, msg(cfg, 'drawStats', {
          queue_len: data.queue_len ?? 0,
          today_count: data.today_count ?? 0,
          success_count: data.success_count ?? 0,
          failed_count: data.failed_count ?? 0
        }));
      } else {
        await sendGroup(ctx, groupId, msg(cfg, 'drawFailed', { error: '获取统计失败' }));
      }
      return true;
    }

    if (parsed.cmd === 'draw-blacklist') {
      await sendGroup(ctx, groupId, '【黑名单】功能请在仪表盘配置用户黑白名单。');
      return true;
    }

    return false;
  }

  async function pollUntilDone(ctx, cfg, groupId, userId, createdAt) {
    const interval = Number(cfg.drawBotPollIntervalMs) || 5000;
    const timeout = Number(cfg.drawBotPollTimeoutMs) || 300000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const r = await fetchJson(`${getApiBase(cfg)}/api/poll?user_id=${encodeURIComponent(userId)}&group_id=${encodeURIComponent(groupId)}&after=${createdAt}`);
      if (r?.success && r.task) {
        const t = r.task;
        if (t.status === 'success' && t.image_urls?.length) {
          setCooldown(cfg, groupId, userId);
          const imagesCq = t.image_urls.map((u) => `[CQ:image,file=${u}]`).join('\n');
          await sendGroup(ctx, groupId, msg(cfg, 'drawSuccess', { user_id: userId, images: imagesCq, task_id: t.task_id || '-' }));
          return;
        }
        if (t.status === 'failed') {
          await sendGroup(ctx, groupId, msg(cfg, 'drawFailed', { error: t.error || '未知错误' }));
          return;
        }
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    await sendGroup(ctx, groupId, msg(cfg, 'drawTimeout'));
  }

  async function profanityCheck(cfg, text) {
    if (!cfg.drawBotProfanityCheckEnabled || !text?.trim()) return { ok: true };
    try {
      const res = await fetch(cfg.drawBotProfanityCheckApiUrl || 'https://uapis.cn/api/v1/text/profanitycheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: String(text).slice(0, 2000) }),
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'forbidden') return { ok: false, words: data.forbidden_words || [] };
    } catch (_) { /* ignore */ }
    return { ok: true };
  }

  async function handleDrawMessage(ctx, cfg, event, groupId, userId, plainText) {
    if (!cfg.drawBotEnabled) return false;

    const meta = parseDrawMetaCommand(plainText, cfg);
    if (meta) {
      return handleDrawMetaCommand(ctx, cfg, groupId, userId, meta);
    }

    const promptInput = matchDrawTrigger(cfg, plainText);
    if (promptInput === null) return false;

    const cd = checkCooldown(cfg, groupId, userId);
    if (!cd.ok) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawCooldown', { seconds: cd.seconds }));
      return true;
    }

    const parsed = parsePrompt(cfg, promptInput);
    if (!parsed.prompt) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawUsage'));
      return true;
    }

    const prof = await profanityCheck(cfg, parsed.prompt);
    if (!prof.ok) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawProfanityBlocked'));
      return true;
    }

    const nickname = event.sender?.nickname || event.sender?.card || '';
    const genOpts = { style: parsed.style, negative_prompt: parsed.negative_prompt };

    if (cfg.drawBotUseSyncMode) {
      await sendGroup(ctx, groupId, msg(cfg, 'drawGenerating', { user_id: userId }));
      const data = await apiGenerate(cfg, parsed.prompt, userId, groupId, nickname, true, genOpts);
      if (!data?.success) {
        await sendGroup(ctx, groupId, data?.error || msg(cfg, 'drawServiceUnavailable'));
        return true;
      }
      if (data.image_urls?.length) {
        setCooldown(cfg, groupId, userId);
        const imagesCq = data.image_urls.map((u) => `[CQ:image,file=${u}]`).join('\n');
        await sendGroup(ctx, groupId, msg(cfg, 'drawSuccess', { user_id: userId, images: imagesCq, task_id: data.task_id || '-' }));
      } else {
        await sendGroup(ctx, groupId, msg(cfg, 'drawFailed', { error: data?.error || '未知' }));
      }
      return true;
    }

    const data = await apiGenerate(cfg, parsed.prompt, userId, groupId, nickname, false, genOpts);
    if (!data?.success) {
      const err = data?.error || '';
      if (err.includes('队列已满')) await sendGroup(ctx, groupId, msg(cfg, 'drawQueueFull'));
      else await sendGroup(ctx, groupId, err || msg(cfg, 'drawServiceUnavailable'));
      return true;
    }
    const pos = data.queue_position ?? data.queue_len ?? 1;
    await sendGroup(ctx, groupId, msg(cfg, 'drawQueued', {
      user_id: userId,
      position: pos,
      queue_len: data.queue_len ?? pos,
      prompt: (data.prompt || parsed.prompt).slice(0, 80)
    }));
    pollUntilDone(ctx, cfg, groupId, userId, data.created_at).catch((e) => log?.('warn', '画图轮询失败', e.message, 'image'));
    return true;
  }

  function registerRoutes(router, getCfg) {
    router.getNoAuth('/draw/server-status', async (_, res) => {
      try {
        const cfg = getCfg();
        const data = await fetchJson(`${getApiBase(cfg)}/health`);
        res.json({ success: true, ok: data?.ok === true });
      } catch {
        res.json({ success: true, ok: false });
      }
    });
    router.getNoAuth('/draw/queue', async (req, res) => {
      const cfg = getCfg();
      const token = req.headers['x-admin-token'] || req.query?.admin_token;
      const tokens = cfg.drawBotAdminTokens || [];
      if (!tokens.length || !tokens.includes(token)) return res.json({ success: false, error: '需要管理权限' });
      try {
        const data = await fetchJson(`${getApiBase(cfg)}/api/queue`, { headers: { 'X-Admin-Token': token } });
        res.json(data);
      } catch (e) {
        res.json({ success: false, error: e.message });
      }
    });
    router.getNoAuth('/draw/stats', async (_, res) => {
      try {
        const cfg = getCfg();
        const data = await fetchJson(`${getApiBase(cfg)}/api/stats`);
        res.json(data);
      } catch (e) {
        res.json({ success: false, error: e.message });
      }
    });
    router.postNoAuth('/draw/queue/clear', async (req, res) => {
      const cfg = getCfg();
      const token = req.headers['x-admin-token'] || req.query?.admin_token;
      const tokens = cfg.drawBotAdminTokens || [];
      if (!tokens.length || !tokens.includes(token)) return res.json({ success: false, error: '需要管理权限' });
      try {
        const data = await fetchJson(`${getApiBase(cfg)}/api/queue/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }
        });
        res.json(data);
      } catch (e) {
        res.json({ success: false, error: e.message });
      }
    });
  }

  return { handleDrawMessage, handleDrawMetaCommand, parseDrawMetaCommand, registerRoutes, cleanup: () => drawCooldownUntil.clear() };
}
