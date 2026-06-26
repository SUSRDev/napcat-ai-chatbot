/**
 * QQ 群/用户信息工具与会话上下文
 */

/**
 * @param {Record<string, unknown>} cfg
 */
export function buildQqTools(cfg) {
  if (cfg.agentQqToolsEnabled === false) return [];
  const tools = [];

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
  }

  if (cfg.agentToolQqGroupInfoEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_info',
        description: '查询 QQ 群信息（群号、群名、成员数等）。不传 group_id 时使用当前会话所在群。',
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

  if (cfg.agentToolQqGroupContextEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_qq_group_context',
        description: '获取群内最近聊天记录（群上下文），了解群内正在讨论的内容。仅群聊可用。',
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
  if (data.sign) lines.push(`个性签名：${data.sign}`);
  if (data.role) lines.push(`群角色：${data.role}`);
  if (data.title) lines.push(`专属头衔：${data.title}`);
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
  if (data.groupCreateTime) lines.push(`创建时间：${data.groupCreateTime}`);
  if (data.groupLevel) lines.push(`群等级：${data.groupLevel}`);
  if (data.avatar) lines.push(`群头像：${data.avatar}`);
  return lines.join('\n') || '未获取到群信息';
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

  if (kind === 'qq_group_info') {
    const session = api.getSession?.() || {};
    const gid = String(args?.group_id || session.groupId || '').trim();
    if (!gid) return '错误：未指定群号，且当前不在群聊会话中';
    const profile = await api.fetchGroupProfile(gid);
    return formatGroupInfoText(profile);
  }

  if (kind === 'qq_group_context') {
    const session = api.getSession?.() || {};
    if (!session.groupId) return '错误：当前不在群聊中，无法获取群上下文';
    const limit = Math.max(1, Math.min(30, Number(args?.limit) || 10));
    const lines = api.getGroupRecentContext(limit);
    if (!lines) return '（暂无群内最近消息记录）';
    return lines;
  }

  return `错误：未知 QQ 工具 ${kind}`;
}
