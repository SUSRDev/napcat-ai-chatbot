/**
 * 插件热重载：优先 PluginManager.reloadPlugin，回退 napcat-plugin-debug WebSocket。
 * 与 NapCat 官方 HMR 文档一致：https://doc.napneko.icu/develop/plugin/hot-reload
 */

import path from 'path';

const DEFAULT_DEBUG_WS = 'ws://127.0.0.1:8998';

export function collectPluginReloadIds(ctx, pluginDir) {
  const base = path.basename(pluginDir || '');
  const ids = [
    ctx?.fileId,
    ctx?.pluginId,
    ctx?.pluginName,
    base,
    'napcat-plugin-chat-bot'
  ].map((s) => String(s || '').trim()).filter(Boolean);
  return [...new Set(ids)];
}

/** 从 PluginManager 扫描已注册插件，按目录名匹配真实 id */
export function resolvePluginIdFromManager(pm, pluginDir, ctx) {
  const dir = path.basename(pluginDir || '').toLowerCase();
  const dirNorm = String(pluginDir || '').replace(/\\/g, '/').toLowerCase();
  const lists = [];
  if (typeof pm.getLoadedPlugins === 'function') lists.push(pm.getLoadedPlugins());
  if (typeof pm.getAllPlugins === 'function') lists.push(pm.getAllPlugins());
  for (const list of lists) {
    for (const entry of list || []) {
      if (!entry || typeof entry !== 'object') continue;
      const id = String(entry.id || entry.fileId || entry.name || '').trim();
      const p = String(entry.path || entry.pluginPath || entry.dir || '').replace(/\\/g, '/').toLowerCase();
      if (!id) continue;
      if (p && (p.endsWith('/' + dir) || p.endsWith(dir) || dirNorm && p.includes(dirNorm))) return id;
      if (id.toLowerCase() === dir) return id;
    }
  }
  const candidates = collectPluginReloadIds(ctx, pluginDir);
  return candidates[0] || dir;
}

function debugJsonRpc(wsUrl, method, params, token, timeoutMs = 10000) {
  if (typeof WebSocket === 'undefined') {
    return Promise.resolve({ ok: false, reason: 'no_websocket' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      resolve(result);
    };
    let ws;
    const timer = setTimeout(() => done({ ok: false, reason: 'debug_ws_timeout' }), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      done({ ok: false, reason: 'debug_ws_connect', error: e?.message || String(e) });
      return;
    }
    ws.addEventListener('open', () => {
      const payload = { jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] };
      if (token) payload.auth = token;
      ws.send(JSON.stringify(payload));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(String(ev.data || ''));
        if (data.error) {
          done({ ok: false, reason: 'debug_rpc_error', error: data.error.message || JSON.stringify(data.error) });
          return;
        }
        if (method === 'reloadPlugin' && data.result === true) {
          done({ ok: true, method: 'debug_ws', pluginId: params?.[0] });
          return;
        }
        if (method === 'getDebugInfo' && data.result) {
          done({ ok: true, info: data.result });
          return;
        }
        done({ ok: data.result === true, result: data.result, method: 'debug_ws' });
      } catch (e) {
        done({ ok: false, reason: 'debug_ws_parse', error: e?.message || String(e) });
      }
    });
    ws.addEventListener('error', () => done({ ok: false, reason: 'debug_ws_error' }));
    ws.addEventListener('close', () => {
      if (!settled) done({ ok: false, reason: 'debug_ws_closed' });
    });
  });
}

/** 通过 napcat-plugin-debug 的 WebSocket 热重载（开发机需安装并启用该插件） */
export async function reloadViaDebugService(pluginIds, options = {}) {
  const wsUrl = options.wsUrl || process.env.NAPCAT_DEBUG_WS || DEFAULT_DEBUG_WS;
  const token = options.token || process.env.NAPCAT_DEBUG_TOKEN || '';
  const ids = Array.isArray(pluginIds) ? pluginIds : [pluginIds].filter(Boolean);
  for (const id of ids) {
    const r = await debugJsonRpc(wsUrl, 'reloadPlugin', [id], token);
    if (r.ok) return { ...r, pluginId: id };
  }
  return { ok: false, reason: 'debug_reload_failed', tried: ids };
}

/** 统一热重载：PluginManager → loadDirectoryPlugin → debug WebSocket */
export async function tryReloadPluginAll(pm, ctx, pluginDir, options = {}) {
  const pluginIds = collectPluginReloadIds(ctx, pluginDir);
  const primaryId = pm ? resolvePluginIdFromManager(pm, pluginDir, ctx) : pluginIds[0];
  const tryIds = [...new Set([primaryId, ...pluginIds].filter(Boolean))];
  const dir = path.basename(pluginDir || '');

  if (pm?.reloadPlugin) {
    for (const id of tryIds) {
      try {
        const ok = await pm.reloadPlugin(id);
        if (ok) return { ok: true, pluginId: id, method: 'reloadPlugin' };
      } catch (_) {}
    }
  }

  if (pm?.loadDirectoryPlugin && dir) {
    try {
      await pm.loadDirectoryPlugin(dir);
      return { ok: true, pluginId: dir, method: 'loadDirectoryPlugin' };
    } catch (_) {}
  }

  if (options.allowDebugWs !== false) {
    const viaDebug = await reloadViaDebugService(tryIds, options);
    if (viaDebug.ok) return viaDebug;
  }

  return { ok: false, reason: 'reload_failed', tried: tryIds };
}

export async function pingDebugService(options = {}) {
  const wsUrl = options.wsUrl || process.env.NAPCAT_DEBUG_WS || DEFAULT_DEBUG_WS;
  const token = options.token || process.env.NAPCAT_DEBUG_TOKEN || '';
  const r = await debugJsonRpc(wsUrl, 'ping', [], token, 5000);
  return r.ok || r.result === 'pong' ? { ok: true, wsUrl } : { ok: false, wsUrl, reason: r.reason };
}
