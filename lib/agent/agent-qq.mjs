/**
 * QQ 群/用户信息工具与会话上下文 + NapCat 全量 API 网关
 */
import {
  buildNapCatCatalogSummary,
  executeNapCatApiCall,
  formatCatalogList,
  listNapCatCategories,
  searchNapCatCatalog
} from '../napcat/napcat-api-gateway.mjs';
import { NAPCAT_API_CATALOG } from '../napcat/napcat-api-catalog.mjs';

function resolveGroupId(api, args) {
  const session = api.getSession?.() || {};
  return String(args?.group_id || session.groupId || '').trim();
}

function formatTs(ts) {
  const n = Number(ts);
  if (!n) return String(ts || '');
  try {
    return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

function formatMessageContent(content) {
  if (content == null || content === '') return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((seg) => {
      if (!seg || typeof seg !== 'object') return String(seg);
      if (seg.type === 'text') return seg.data?.text ?? seg.text ?? '';
      if (seg.type === 'image') return '[图片]';
      if (seg.type === 'face') return '[表情]';
      if (seg.type === 'at') return `@${seg.data?.qq ?? ''}`;
      return `[${seg.type}]`;
    }).join('').trim();
  }
  if (typeof content === 'object') {
    if (content.text) return String(content.text).trim();
    return JSON.stringify(content).slice(0, 500);
  }
  return String(content);
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildQqTools(cfg) {
  if (cfg.agentQqToolsEnabled === false) return [];
  const tools = [];
  const ext = cfg.agentToolQqGroupExtendedEnabled !== false;

  if (cfg.agentToolQqUserInfoEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_user_info',
        description: '查询 QQ 用户信息。支持 QQ 号（如 3042444341）或群内昵称/群名片（如 Juice、@Juice）。群聊中优先在当前群成员中按昵称/名片匹配。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'QQ 号或昵称/群名片，可带 @ 前缀' }
          },
          required: ['query']
        }
      },
      _builtin: 'qq_user_info'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_stranger_info',
        description: '获取指定非好友（陌生人）QQ 用户的详细信息：昵称、UID、QID、QQ等级、性别、年龄、个性签名、注册时间、VIP 状态、登录天数等。需已知 QQ 号。',
        parameters: {
          type: 'object',
          properties: {
            user_id: { type: 'string', description: '用户 QQ 号' },
            no_cache: { type: 'boolean', description: '是否不使用缓存，默认 false' }
          },
          required: ['user_id']
        }
      },
      _builtin: 'qq_stranger_info'
    });
  }

  if (cfg.agentToolQqGroupInfoEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_info',
        description: '查询 QQ 群详细信息（群号、群名、成员数、最大成员数、全员禁言、群备注等）。不传 group_id 时使用当前会话所在群。优先调用 get_group_detail_info。',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: '群号，可选' }
          }
        }
      },
      _builtin: 'qq_group_info'
    });
  }

  if (ext) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_list',
        description: '获取当前登录 QQ 账号加入的群聊列表（群号、群名、成员数等）。',
        parameters: {
          type: 'object',
          properties: {
            no_cache: { type: 'boolean', description: '是否跳过缓存强制刷新，默认 false' }
          }
        }
      },
      _builtin: 'qq_group_list'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_members',
        description: '获取群成员列表，或查询指定成员详情（角色、头衔、入群时间、禁言截止等）。支持 QQ 号或群内昵称/名片。',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: '群号，可选，默认当前群' },
            user_id: { type: 'string', description: '可选，指定成员 QQ 号' },
            query: { type: 'string', description: '可选，按昵称/群名片查找成员（与 user_id 二选一）' },
            limit: { type: 'integer', description: '列表模式返回条数，默认 30，最大 100' },
            no_cache: { type: 'boolean', description: '是否跳过缓存' }
          }
        }
      },
      _builtin: 'qq_group_members'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_notice',
        description: '获取指定群的公告列表（发布者、时间、内容）。',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: '群号，可选，默认当前群' }
          }
        }
      },
      _builtin: 'qq_group_notice'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_essence',
        description: '获取指定群的精华消息列表。',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: '群号，可选，默认当前群' },
            limit: { type: 'integer', description: '返回条数，默认 10，最大 30' }
          }
        }
      },
      _builtin: 'qq_group_essence'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_mute_list',
        description: '获取指定群当前被禁言的成员列表。',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: '群号，可选，默认当前群' }
          }
        }
      },
      _builtin: 'qq_group_mute_list'
    });
  }

  if (cfg.agentToolQqGroupContextEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_context',
        description: '获取群内最近聊天记录（插件本地缓存的群上下文），了解群内正在讨论的内容。仅群聊可用。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: '条数，默认 10，最大 30' }
          }
        }
      },
      _builtin: 'qq_group_context'
    });
  }

  if (cfg.agentToolQqNapcatEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_napcat_catalog',
        description: `搜索 NapCat 全量 API 目录（共 ${NAPCAT_API_CATALOG.length} 个接口）。${buildNapCatCatalogSummary()}`,
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '关键词：接口名/中文标题/分类，如 group、公告、send_group_msg' },
            category: { type: 'string', description: '可选分类：群组接口、消息接口、Go-CQHTTP、系统扩展 等' },
            limit: { type: 'integer', description: '返回条数，默认 20，最大 80' }
          }
        }
      },
      _builtin: 'qq_napcat_catalog'
    });

    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_napcat_call',
        description: '调用任意 NapCat API（OneBot action）。先用 builtin_qq_napcat_catalog 查 action 名与参数说明，再传入 action + params。群聊中 group_id/user_id 可省略以使用当前会话。写操作/高危操作需管理员且可能触发二次确认。文档：https://napcat.apifox.cn/5430207m0',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'NapCat action 名，如 get_group_list、send_group_msg、get_group_member_list' },
            params: { type: 'object', description: 'JSON 请求体，与 NapCat 文档 Body 一致' }
          },
          required: ['action']
        }
      },
      _builtin: 'qq_napcat_call'
    });
  }

  return tools;
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ userId?: string, userName?: string, userCard?: string, groupId?: string, groupName?: string, atUserIds?: string[] }} session
 */
export function buildQqSessionContextBlock(cfg, session = {}) {
  if (cfg.agentQqContextEnabled === false) return '';
  const lines = [];
  if (session.groupId) {
    lines.push(`群号：${session.groupId}`);
    if (session.groupName) lines.push(`群名：${session.groupName}`);
  }
  if (session.userId) {
    lines.push(`发送者 QQ：${session.userId}`);
    const nick = session.userCard || session.userName;
    if (nick) lines.push(`发送者昵称/群名片：${nick}`);
    else if (session.userName) lines.push(`发送者昵称：${session.userName}`);
  }
  if (Array.isArray(session.atUserIds) && session.atUserIds.length) {
    lines.push(`消息中 @ 的 QQ：${session.atUserIds.join(', ')}`);
  }
  if (!lines.length) return '';
  return '\n\n【当前 QQ 会话信息】\n' + lines.join('\n');
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} lines
 */
export function buildQqGroupContextBlock(cfg, lines) {
  if (cfg.agentQqGroupContextEnabled === false || !lines) return '';
  return `\n\n【群内最近消息（群上下文）】\n${lines}`;
}

function formatStrangerInfoText(data) {
  if (!data) return '未获取到陌生人信息';
  if (typeof data === 'string') return data;
  if (data.error) return String(data.error);
  const lines = [];
  if (data.userId) lines.push(`QQ号：${data.userId}`);
  if (data.uid) lines.push(`UID：${data.uid}`);
  if (data.nickname) lines.push(`昵称：${data.nickname}`);
  if (data.qid) lines.push(`QID：${data.qid}`);
  if (data.sex != null && data.sex !== '') lines.push(`性别：${data.sex}`);
  if (data.age != null && data.age !== '') lines.push(`年龄：${data.age}`);
  if (data.qqLevel != null && data.qqLevel !== '') lines.push(`QQ等级：${data.qqLevel}`);
  if (data.longNick) lines.push(`个性签名：${data.longNick}`);
  if (data.regTime) lines.push(`注册时间：${formatTs(data.regTime)}`);
  if (data.isVip != null) lines.push(`VIP：${data.isVip ? '是' : '否'}`);
  if (data.isYearsVip != null && data.isYearsVip) lines.push('年费VIP：是');
  if (data.vipLevel != null && data.vipLevel !== '') lines.push(`VIP等级：${data.vipLevel}`);
  if (data.remark) lines.push(`备注：${data.remark}`);
  if (data.loginDays != null && data.loginDays !== '') lines.push(`登录天数：${data.loginDays}`);
  if (data.avatar) lines.push(`头像：${data.avatar}`);
  return lines.join('\n') || '未获取到陌生人信息';
}

function formatUserInfoText(data) {
  if (!data) return '未获取到用户信息';
  if (typeof data === 'string') return data;
  if (data.error) return String(data.error);
  if (data.multiple && Array.isArray(data.candidates)) {
    return '找到多个匹配用户，请指定更精确的名称或直接使用 QQ 号：\n'
      + data.candidates.map((c, i) => `${i + 1}. ${c.nickname || '未知'} (${c.userId})`).join('\n');
  }
  const lines = [];
  if (data.userId) lines.push(`QQ号：${data.userId}`);
  if (data.nickname) lines.push(`昵称：${data.nickname}`);
  if (data.card) lines.push(`群名片：${data.card}`);
  if (data.groupNickname && data.groupNickname !== data.nickname) lines.push(`群内昵称：${data.groupNickname}`);
  if (data.qid) lines.push(`QID：${data.qid}`);
  if (data.sex != null && data.sex !== '') lines.push(`性别：${data.sex}`);
  if (data.age != null && data.age !== '') lines.push(`年龄：${data.age}`);
  if (data.level != null && data.level !== '') lines.push(`等级：${data.level}`);
  if (data.qqLevel != null && data.qqLevel !== '') lines.push(`QQ等级：${data.qqLevel}`);
  if (data.sign) lines.push(`个性签名：${data.sign}`);
  if (data.role) lines.push(`群角色：${data.role}`);
  if (data.title) lines.push(`专属头衔：${data.title}`);
  if (data.joinTime) lines.push(`入群时间：${formatTs(data.joinTime)}`);
  if (data.lastSentTime) lines.push(`最后发言：${formatTs(data.lastSentTime)}`);
  if (data.shutUpTimestamp) lines.push(`禁言截止：${formatTs(data.shutUpTimestamp)}`);
  if (data.area) lines.push(`地区：${data.area}`);
  if (data.isRobot) lines.push('身份：机器人');
  if (data.regTime) lines.push(`注册时间：${data.regTime}`);
  if (data.avatar) lines.push(`头像：${data.avatar}`);
  return lines.join('\n') || '未获取到用户信息';
}

function formatGroupInfoText(data) {
  if (!data) return '未获取到群信息';
  const lines = [];
  if (data.groupId) lines.push(`群号：${data.groupId}`);
  if (data.groupName) lines.push(`群名：${data.groupName}`);
  if (data.memberCount) lines.push(`成员数：${data.memberCount}`);
  if (data.maxMemberCount) lines.push(`最大成员数：${data.maxMemberCount}`);
  if (data.groupAllShut != null && data.groupAllShut !== '') {
    lines.push(`全员禁言：${Number(data.groupAllShut) ? '是' : '否'}`);
  }
  if (data.groupRemark) lines.push(`群备注：${data.groupRemark}`);
  if (data.groupCreateTime) lines.push(`创建时间：${formatTs(data.groupCreateTime)}`);
  if (data.groupLevel) lines.push(`群等级：${data.groupLevel}`);
  if (data.avatar) lines.push(`群头像：${data.avatar}`);
  return lines.join('\n') || '未获取到群信息';
}

function formatGroupListText(list) {
  if (!list?.length) return '（未加入任何群聊或获取失败）';
  return list.map((g, i) => {
    const parts = [`${i + 1}. ${g.groupName || '未命名群'} (${g.groupId})`];
    if (g.memberCount) parts.push(`成员 ${g.memberCount}${g.maxMemberCount ? `/${g.maxMemberCount}` : ''}`);
    if (Number(g.groupAllShut)) parts.push('[全员禁言]');
    if (g.groupRemark) parts.push(`备注:${g.groupRemark}`);
    return parts.join(' · ');
  }).join('\n');
}

function formatMemberListText(list, totalHint = '') {
  if (!list?.length) return '（无成员数据或获取失败）' + (totalHint ? `\n${totalHint}` : '');
  const lines = list.map((m, i) => {
    const name = m.card || m.nickname || m.userId;
    const role = m.role && m.role !== 'member' ? `[${m.role}]` : '';
    const title = m.title ? `「${m.title}」` : '';
    return `${i + 1}. ${name} (${m.userId}) ${role}${title}`.trim();
  });
  if (totalHint) lines.push('', totalHint);
  return lines.join('\n');
}

function formatNoticeText(list) {
  if (!list?.length) return '（暂无群公告）';
  return list.map((n, i) => {
    const text = formatMessageContent(n.message);
    const time = n.publishTime ? formatTs(n.publishTime) : '';
    const sender = n.senderId ? `发布者 ${n.senderId}` : '';
    return [`【公告 ${i + 1}】${time}`, sender, text].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatEssenceText(list) {
  if (!list?.length) return '（暂无精华消息）';
  return list.map((m, i) => {
    const text = formatMessageContent(m.content);
    const time = m.operatorTime ? formatTs(m.operatorTime) : '';
    return [`【精华 ${i + 1}】${m.senderNick || m.senderId}${time ? ` · ${time}` : ''}`, text].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatMuteListText(list) {
  if (!list?.length) return '（当前无被禁言成员）';
  return list.map((m, i) => {
    const until = m.shutUpTime ? formatTs(m.shutUpTime) : '未知';
    return `${i + 1}. ${m.nickname || m.userId} (${m.userId}) · 禁言至 ${until}`;
  }).join('\n');
}

/**
 * @param {string} kind
 * @param {object} args
 * @param {{ qqApi?: object }} runtime
 */
export async function executeQqTool(kind, args, runtime) {
  const api = runtime?.qqApi;
  if (!api) return '错误：QQ 信息工具仅在与 QQ 关联的会话中可用';

  if (kind === 'qq_user_info') {
    const query = String(args?.query || '').trim();
    if (!query) return '错误：query 不能为空';
    const result = await api.resolveUserQuery(query);
    return formatUserInfoText(result);
  }

  if (kind === 'qq_stranger_info') {
    const uid = String(args?.user_id || '').trim();
    if (!/^\d{5,12}$/.test(uid)) return '错误：user_id 必须是有效的 QQ 号';
    const noCache = args?.no_cache === true;
    const info = await api.fetchStrangerInfo?.(uid, { noCache });
    if (!info) return `未获取到 QQ ${uid} 的陌生人信息（可能不是有效 QQ 或接口不可用）`;
    return formatStrangerInfoText(info);
  }

  if (kind === 'qq_group_info') {
    const gid = resolveGroupId(api, args);
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const profile = await api.fetchGroupProfile(gid, { detail: true });
    return formatGroupInfoText(profile);
  }

  if (kind === 'qq_group_list') {
    const list = await api.fetchGroupList({ noCache: args?.no_cache === true });
    return `共 ${list.length} 个群：\n` + formatGroupListText(list);
  }

  if (kind === 'qq_group_members') {
    const gid = resolveGroupId(api, args);
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const noCache = args?.no_cache === true;
    const uid = String(args?.user_id || '').trim();
    const query = String(args?.query || '').trim();

    if (uid || query) {
      let targetId = uid;
      if (!targetId && query) {
        const resolved = await api.resolveUserQuery(query);
        if (resolved?.error) return resolved.error;
        if (resolved?.multiple) return formatUserInfoText(resolved);
        targetId = resolved?.userId || '';
      }
      if (!targetId) return '错误：未找到指定成员';
      const info = await api.fetchGroupMemberInfo(gid, targetId, { noCache });
      if (!info) return '未获取到该成员的群资料';
      return formatUserInfoText(info);
    }

    const limit = Math.max(1, Math.min(100, Number(args?.limit) || 30));
    const list = await api.fetchGroupMemberList(gid, { noCache, limit });
    const hint = list.length >= limit ? `（仅显示前 ${limit} 人，可指定 user_id/query 查单人）` : '';
    return formatMemberListText(list, hint);
  }

  if (kind === 'qq_group_notice') {
    const gid = resolveGroupId(api, args);
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const list = await api.fetchGroupNotices(gid);
    return formatNoticeText(list);
  }

  if (kind === 'qq_group_essence') {
    const gid = resolveGroupId(api, args);
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const limit = Math.max(1, Math.min(30, Number(args?.limit) || 10));
    const list = (await api.fetchGroupEssenceMessages(gid)).slice(0, limit);
    return formatEssenceText(list);
  }

  if (kind === 'qq_group_mute_list') {
    const gid = resolveGroupId(api, args);
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const list = await api.fetchGroupShutList(gid);
    return formatMuteListText(list);
  }

  if (kind === 'qq_group_context') {
    const session = api.getSession?.() || {};
    if (!session.groupId) return '错误：当前不在群聊中，无法获取群上下文';
    const limit = Math.max(1, Math.min(30, Number(args?.limit) || 10));
    const lines = api.getGroupRecentContext(limit);
    if (!lines) return '（暂无群内最近消息记录）';
    return lines;
  }

  if (kind === 'qq_napcat_catalog') {
    const keyword = String(args?.keyword || '').trim();
    const category = String(args?.category || '').trim();
    if (!keyword && !category) {
      const cats = listNapCatCategories();
      return `NapCat API 共 ${NAPCAT_API_CATALOG.length} 个接口。\n分类：\n${cats.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n请用 keyword 或 category 搜索具体 action。`;
    }
    const list = searchNapCatCatalog({ keyword, category, limit: args?.limit });
    return `找到 ${list.length} 个接口：\n` + formatCatalogList(list);
  }

  if (kind === 'qq_napcat_call') {
    const session = api.getSession?.() || {};
    const cfg = runtime?.cfg || {};
    return executeNapCatApiCall({
      action: args?.action,
      params: args?.params || {},
      callAction: api.callNapCatAction?.bind(api),
      session,
      cfg,
      runtime
    });
  }

  return `错误：未知 QQ 工具 ${kind}`;
}
