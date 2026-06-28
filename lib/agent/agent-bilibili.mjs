/**
 * Bilibili Agent 工具：目录搜索 + 通用 API 调用 + 快捷查询
 */
import {
  buildBiliCatalogSummary,
  describeBiliCookieStatus,
  executeBiliApiCall,
  formatBiliCatalogList,
  listBiliCategories,
  searchBiliCatalog
} from '../bili/bili-api-gateway.mjs';
import { BILI_API_CATALOG } from '../bili/bili-api-catalog.mjs';
import { describeCookieSource } from '../bili/bili-auth.mjs';
import { initiateBiliChatLogin } from '../bili/bili-chat-login.mjs';

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildBiliTools(cfg) {
  if (cfg.agentBiliToolsEnabled === false) return [];
  const tools = [];

  if (cfg.agentToolBiliCatalogEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_catalog',
        description: `搜索 Bilibili 常用 API 目录（共 ${BILI_API_CATALOG.length} 个）。${buildBiliCatalogSummary()}`,
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '关键词：search、video、user、nav、history 等' },
            category: { type: 'string', description: '分类：搜索、视频、用户、动态、登录、评论、直播、番剧 等' },
            limit: { type: 'integer', description: '返回条数，默认 20，最大 80' }
          }
        }
      },
      _builtin: 'bili_catalog'
    });
  }

  if (cfg.agentToolBiliCallEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_call',
        description: '调用 Bilibili Web API。先用 builtin_bili_catalog 查 action/path，再传入 action 或 path + params。'
          + ' 若已在「自定义域名 Cookies」配置 bilibili.com 等域名，请求会自动携带 Cookie（登录态接口如 nav、history 需要）。'
          + ' 文档：https://github.com/realysy/bili-apis',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '目录 action 名，如 search_type、view_detail、nav' },
            path: { type: 'string', description: '或直接传 API 路径，如 /x/web-interface/nav' },
            method: { type: 'string', description: 'GET 或 POST，默认跟随目录' },
            params: { type: 'object', description: 'Query 或 POST 表单参数' },
            base_url: { type: 'string', description: '可选，默认 https://api.bilibili.com' },
            referer: { type: 'string', description: '可选 Referer，默认 https://www.bilibili.com/' }
          }
        }
      },
      _builtin: 'bili_call'
    });
  }

  if (cfg.agentToolBiliLoginQrEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_login_qr',
        description: '为当前对话用户生成 B 站扫码登录二维码，绑定其 QQ 与 B 站账号 Cookie。用户说「登录 B 站」「绑定 bilibili」时使用。',
        parameters: { type: 'object', properties: {} }
      },
      _builtin: 'bili_login_qr'
    });
  }

  if (cfg.agentToolBiliQuickEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_search',
        description: '搜索 B站视频（免登录）。返回标题、UP主、播放量摘要。',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '搜索关键词' },
            page: { type: 'integer', description: '页码，默认 1' },
            page_size: { type: 'integer', description: '每页条数，默认 10，最大 20' }
          },
          required: ['keyword']
        }
      },
      _builtin: 'bili_search'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_video_info',
        description: '获取 B站视频详情（标题、UP、简介、分P、数据等）。bvid 或 aid 二选一。',
        parameters: {
          type: 'object',
          properties: {
            bvid: { type: 'string', description: 'BV 号，如 BV1xx411c7mD' },
            aid: { type: 'integer', description: 'avid 数字 id' }
          }
        }
      },
      _builtin: 'bili_video_info'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_user_info',
        description: '获取 B站用户信息（昵称、签名、等级、粉丝数等）。',
        parameters: {
          type: 'object',
          properties: {
            mid: { type: 'string', description: '用户 mid（数字 UID）' }
          },
          required: ['mid']
        }
      },
      _builtin: 'bili_user_info'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_bili_nav',
        description: '获取当前 Cookie 登录账号的 B站导航信息（需已在 Cookies 编辑器配置 bilibili.com）。未登录时 code=-101。',
        parameters: { type: 'object', properties: {} }
      },
      _builtin: 'bili_nav'
    });
  }

  return tools;
}

function summarizeSearchResults(data) {
  const items = Array.isArray(data?.data?.result) ? data.data.result : [];
  if (!items.length) return '（无搜索结果）';
  return items.slice(0, 10).map((v, i) => {
    const title = String(v.title || v.name || '').replace(/<[^>]+>/g, '');
    const author = v.author || v.uploader || '';
    const play = v.play != null ? `播放 ${v.play}` : '';
    const bvid = v.bvid || '';
    return `${i + 1}. ${title}${bvid ? ` [${bvid}]` : ''} · ${author}${play ? ` · ${play}` : ''}`;
  }).join('\n');
}

function summarizeVideoDetail(data) {
  const d = data?.data || {};
  const view = d.View || d;
  const stat = d.stat || view?.stat || {};
  const owner = view?.owner || {};
  const lines = [];
  if (view?.title) lines.push(`标题：${view.title}`);
  if (view?.bvid) lines.push(`BV：${view.bvid}`);
  if (view?.aid) lines.push(`aid：${view.aid}`);
  if (owner?.name) lines.push(`UP：${owner.name} (mid ${owner.mid})`);
  if (view?.desc) lines.push(`简介：${String(view.desc).slice(0, 300)}`);
  if (stat) lines.push(`数据：播放 ${stat.view || 0} · 弹幕 ${stat.danmaku || 0} · 点赞 ${stat.like || 0} · 投币 ${stat.coin || 0}`);
  return lines.join('\n') || JSON.stringify(data, null, 2).slice(0, 2000);
}

function summarizeUserInfo(data) {
  const d = data?.data || {};
  const lines = [];
  if (d.name || d.uname) lines.push(`昵称：${d.name || d.uname}`);
  if (d.mid) lines.push(`mid：${d.mid}`);
  if (d.sign) lines.push(`签名：${d.sign}`);
  if (d.level != null) lines.push(`等级：${d.level}`);
  if (d.fans != null) lines.push(`粉丝：${d.fans}`);
  if (d.friend != null) lines.push(`关注：${d.friend}`);
  return lines.join('\n') || JSON.stringify(data, null, 2).slice(0, 2000);
}

function summarizeNav(data) {
  const d = data?.data || {};
  if (data?.code === -101 || !d.isLogin) return '未登录：请在 Dashboard → Agent → 自定义域名 Cookies 配置 bilibili.com 的 SESSDATA 等 Cookie';
  const lines = [];
  if (d.uname) lines.push(`昵称：${d.uname}`);
  if (d.mid) lines.push(`mid：${d.mid}`);
  if (d.level_info?.current_level != null) lines.push(`等级：${d.level_info.current_level}`);
  if (d.money != null) lines.push(`B币：${d.money}`);
  if (d.face) lines.push(`头像：${d.face}`);
  return lines.join('\n') || JSON.stringify(d, null, 2).slice(0, 1500);
}

/**
 * @param {string} kind
 * @param {object} args
 * @param {{ cfg?: object, runtime?: object }} ctx
 */
export async function executeBiliTool(kind, args, ctx) {
  const cfg = ctx?.cfg || {};
  const runtime = ctx?.runtime || ctx || {};
  const db = runtime.db || null;
  const qqUserId = String(runtime.qqUserId || runtime.qqApi?.getSession?.()?.userId || '').trim();
  const cookieHint = () => (db ? describeCookieSource(cfg, 'https://api.bilibili.com', qqUserId, db) : describeBiliCookieStatus(cfg));

  if (kind === 'bili_catalog') {
    const keyword = String(args?.keyword || '').trim();
    const category = String(args?.category || '').trim();
    if (!keyword && !category) {
      const cats = listBiliCategories();
      return `Bilibili API 共 ${BILI_API_CATALOG.length} 个接口。\nCookie 状态：${cookieHint()}\n\n分类：\n${cats.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n请用 keyword 或 category 搜索具体 action。`;
    }
    const list = searchBiliCatalog({ keyword, category, limit: args?.limit });
    return `找到 ${list.length} 个接口（${cookieHint()}）：\n` + formatBiliCatalogList(list);
  }

  if (kind === 'bili_call') {
    return executeBiliApiCall({
      action: args?.action,
      path: args?.path,
      method: args?.method,
      params: args?.params || {},
      baseUrl: args?.base_url,
      referer: args?.referer,
      cfg,
      runtime
    });
  }

  if (kind === 'bili_search') {
    const keyword = String(args?.keyword || '').trim();
    if (!keyword) return '错误：keyword 不能为空';
    const page = Math.max(1, Number(args?.page) || 1);
    const pageSize = Math.max(1, Math.min(20, Number(args?.page_size) || 10));
    const result = await executeBiliApiCall({
      action: 'search_type',
      params: { search_type: 'video', keyword, page, page_size: pageSize },
      cfg,
      runtime,
      raw: true
    });
    if (result?.error) return `搜索失败：${result.error}`;
    if (result?.data?.code !== 0) return `搜索失败 code=${result.data?.code} ${result.data?.message || ''}`;
    const cookieHint = result.cookieAttached ? '' : '\n（未附加 Cookie，公开搜索无需登录）';
    return `B站搜索「${keyword}」${cookieHint}\n${summarizeSearchResults(result.data)}`;
  }

  if (kind === 'bili_video_info') {
    const bvid = String(args?.bvid || '').trim();
    const aid = args?.aid != null ? Number(args.aid) : null;
    if (!bvid && !aid) return '错误：请提供 bvid 或 aid';
    const params = bvid ? { bvid } : { aid };
    const result = await executeBiliApiCall({ action: 'view_detail', params, cfg, runtime, raw: true });
    if (result?.error) return `获取失败：${result.error}`;
    if (result?.data?.code !== 0) return `获取失败 code=${result.data?.code} ${result.data?.message || ''}`;
    return summarizeVideoDetail(result.data);
  }

  if (kind === 'bili_user_info') {
    const mid = String(args?.mid || '').trim();
    if (!mid) return '错误：mid 不能为空';
    const result = await executeBiliApiCall({ action: 'user_info', params: { mid }, cfg, runtime, raw: true });
    if (result?.error) return `获取失败：${result.error}`;
    if (result?.data?.code !== 0) return `获取失败 code=${result.data?.code} ${result.data?.message || ''}`;
    return summarizeUserInfo(result.data);
  }

  if (kind === 'bili_nav') {
    const result = await executeBiliApiCall({ action: 'nav', params: {}, cfg, runtime, raw: true });
    if (result?.error) return `获取失败：${result.error}`;
    if (!result.cookieAttached) {
      return `未配置 B站 Cookie。\n${cookieHint()}\n未绑定用户将使用主站全局 Cookie；也可在 Dashboard 扫码绑定个人 B站账号。`;
    }
    if (result?.data?.code === -101 || result?.data?.data?.isLogin === false) {
      return 'Cookie 已发送但账号未登录或已过期，请更新 SESSDATA / bili_jct 等 Cookie，或说「登录 B 站」扫码绑定。';
    }
    if (result?.data?.code !== 0) return `nav 失败 code=${result.data?.code} ${result.data?.message || ''}`;
    return summarizeNav(result.data);
  }

  if (kind === 'bili_login_qr') {
    const db = runtime.db || null;
    const qqUserId = String(runtime.qqUserId || runtime.qqApi?.getSession?.()?.userId || '').trim();
    if (!qqUserId) return '错误：无法识别当前 QQ 用户';
    if (!db) return '错误：SQLite 未就绪，请管理员在 Dashboard 部署 SQLite';
    try {
      const login = await initiateBiliChatLogin(db, qqUserId);
      if (typeof runtime.onBiliQrLoginStarted === 'function') {
        runtime.onBiliQrLoginStarted(login);
      }
      return login.message + '\n[CQ:image,url=' + login.qrImageUrl + ']';
    } catch (e) {
      return 'B 站扫码登录失败：' + e.message;
    }
  }

  return `错误：未知 Bilibili 工具 ${kind}`;
}
