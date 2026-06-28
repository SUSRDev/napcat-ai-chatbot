/**
 * Agent 运行时：内置工具 + MCP 工具 + Skills 注入 + 多轮 tool calling 循环
 */
import {
  discoverSkills,
  selectSkillsForMessage,
  buildSkillsSystemBlock
} from './skills.mjs';
import { McpHub } from './mcp-client.mjs';
import { buildShellTools, executeShellCommand, executeFileManager, executeRegistryTool, openInFileExplorer } from './agent-shell.mjs';
import { buildBrowserTools, executeBrowserTool } from './agent-browser.mjs';
import { buildQqTools, executeQqTool } from './agent-qq.mjs';
import { buildBiliTools, executeBiliTool } from './agent-bilibili.mjs';

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} [pluginRoot]
 */
export function buildBuiltinTools(cfg, pluginRoot = '') {
  const tools = [];

  if (cfg.webSearchEnabled && cfg.agentToolWebSearchEnabled !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'builtin_web_search',
        description: '联网搜索实时信息（新闻、百科、游戏攻略、天气等）。当用户问题需要查资料时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词，简短精确' }
          },
          required: ['query']
        }
      },
      _builtin: 'web_search'
    });
  }

  if (cfg.agentToolCurrentTimeEnabled !== false) tools.push({
    type: 'function',
    function: {
      name: 'builtin_current_time',
      description: '获取当前日期时间（本地时区），用于回答「现在几点」「今天星期几」等问题。',
      parameters: { type: 'object', properties: {} }
    },
    _builtin: 'current_time'
  });

  tools.push(...buildShellTools(cfg));
  tools.push(...buildBrowserTools(cfg));
  tools.push(...buildQqTools(cfg));
  tools.push(...buildBiliTools(cfg));

  return tools;
}

/**
 * 从工具 args 或用户原文提取搜索词（部分模型 tool_call 会传空 args）
 * @param {Record<string, unknown>} args
 * @param {string} [fallbackText]
 */
export function extractSearchQueryFromArgs(args, fallbackText = '') {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const candidates = [
    a.query, a.q, a.search, a.keyword, a.keywords, a.input, a.text,
    a.search_query, a.searchQuery, a.搜索, a.搜索词, a.关键词, a.关键字
  ];
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (s) return s.slice(0, 500);
  }
  const user = String(fallbackText || '')
    .replace(/\[CQ:[^\]]+\]/gi, ' ')
    .replace(/@\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!user) return '';
  const m1 = user.match(/^(.{1,80}?)(是什么|是啥|什么意思|啥意思|怎么理解|介绍一下|百科|定义)/);
  if (m1?.[1]?.trim()) return `${m1[1].trim()} ${m1[2]}`.slice(0, 500);
  const m2 = user.match(/(?:什么是|什么叫|介绍一下|搜一下|查一下|帮我查)\s*(.{1,80})/);
  if (m2?.[1]?.trim()) return m2[1].trim().slice(0, 500);
  return user.slice(0, 500);
}

/** @param {object[]} messages */
export function getLastUserMessageText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n').trim();
    }
  }
  return '';
}

function parseToolCallArgs(tc) {
  const raw = tc?.function?.arguments ?? tc?.arguments ?? '{}';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  const str = String(raw ?? '').trim();
  if (!str) return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // 模型偶发返回非 JSON 字符串，当作 query 本身
    if (str.length >= 1 && str.length <= 500 && !str.startsWith('{')) return { query: str };
    return {};
  }
}

/**
 * @param {object} toolDef
 * @param {Record<string, unknown>} args
 * @param {object} runtime
 */
export async function executeBuiltinTool(toolDef, args, runtime) {
  const kind = toolDef._builtin;
  if (kind === 'current_time') {
    const now = new Date();
    return `当前时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`;
  }
  if (kind === 'web_search') {
    const fallback = runtime?.userText || runtime?.lastUserMessage || '';
    const query = extractSearchQueryFromArgs(args, fallback);
    if (!query) return '错误：query 不能为空（模型未传参且无法从用户消息推断搜索词）';
    if (!String(args?.query || '').trim() && runtime?.log) {
      runtime.log('info', 'web_search 已从用户消息补全 query', { query: query.slice(0, 80), rawArgs: args }, 'agent');
    }
    const { cfg, webSearchMulti } = runtime;
    if (!webSearchMulti) return '错误：搜索功能未初始化';
    const result = await webSearchMulti(query, cfg);
    return result || '（未检索到结果）';
  }
  if (kind === 'shell_exec') {
    const { cfg } = runtime;
    return executeShellCommand(cfg, args, runtime);
  }
  if (kind === 'file_manager') {
    const { cfg } = runtime;
    return executeFileManager(cfg, args, runtime);
  }
  if (kind === 'registry_tool') {
    const { cfg } = runtime;
    return executeRegistryTool(cfg, args, runtime);
  }
  if (kind === 'open_explorer') {
    return openInFileExplorer(args);
  }
  if (kind === 'browser_snapshot' || kind === 'browser_act' || kind === 'browser_use_task') {
    const { cfg, pluginRoot } = runtime;
    return executeBrowserTool(cfg, pluginRoot || '', kind, args);
  }
  if (kind === 'qq_user_info' || kind === 'qq_stranger_info' || kind === 'qq_group_info' || kind === 'qq_group_context'
    || kind === 'qq_group_list' || kind === 'qq_group_members' || kind === 'qq_group_notice'
    || kind === 'qq_group_essence' || kind === 'qq_group_mute_list'
    || kind === 'qq_napcat_catalog' || kind === 'qq_napcat_call') {
    return executeQqTool(kind, args, runtime);
  }
  if (kind === 'bili_catalog' || kind === 'bili_call' || kind === 'bili_search'
    || kind === 'bili_video_info' || kind === 'bili_user_info' || kind === 'bili_nav'
    || kind === 'bili_login_qr') {
    return executeBiliTool(kind, args, { cfg: runtime?.cfg, runtime });
  }
  return `错误：未知内置工具 ${kind}`;
}

/**
 * @param {object[]} tools
 */
export function sanitizeToolsForApi(tools) {
  return tools.map((t) => {
    const { _mcp, _builtin, ...rest } = t;
    return rest;
  });
}

/**
 * @param {object[]} allTools
 * @param {object} toolCall
 */
export function findToolDef(allTools, toolCall) {
  const name = toolCall?.function?.name || toolCall?.name;
  return allTools.find((t) => t.function?.name === name);
}

/**
 * @param {object} params
 */
export async function runAgentToolLoop(params) {
  const {
    messages: initialMessages,
    chatCompletion,
    cfg,
    mcpHub,
    builtinTools,
    runtime,
    maxRounds = 6,
    onToolExecuted
  } = params;

  const mcpTools = cfg.mcpEnabled && cfg.agentToolMcpEnabled !== false && mcpHub ? mcpHub.getOpenAiTools() : [];
  const allTools = [...builtinTools, ...mcpTools];
  const apiTools = sanitizeToolsForApi(allTools);

  if (!apiTools.length) {
    const result = await chatCompletion(initialMessages, {});
    return {
      content: extractContent(result),
      toolTrace: [],
      messages: initialMessages
    };
  }

  const messages = [...initialMessages];
  const toolTrace = [];
  let lastContent = '';
  const lastUserMessage = getLastUserMessageText(initialMessages);
  const runtimeWithContext = {
    ...runtime,
    lastUserMessage: runtime?.userText || runtime?.lastUserMessage || lastUserMessage,
    log: runtime?.log
  };

  for (let round = 0; round < maxRounds; round++) {
    const result = await chatCompletion(messages, { tools: apiTools, tool_choice: 'auto' });
    const msg = normalizeCompletionResult(result);
    lastContent = msg.content || '';

    if (!msg.tool_calls?.length) {
      return { content: lastContent, toolTrace, messages };
    }

    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls
    });

    for (const tc of msg.tool_calls) {
      const fnName = tc.function?.name || tc.name;
      let args = parseToolCallArgs(tc);

      let output = '';
      let toolType = 'unknown';
      let toolMeta = { name: fnName, args };

      try {
        const def = findToolDef(allTools, tc);
        if (def?._builtin === 'web_search') {
          const resolvedQuery = extractSearchQueryFromArgs(args, runtimeWithContext.lastUserMessage);
          if (resolvedQuery) {
            args = { ...args, query: resolvedQuery };
            toolMeta.args = args;
          }
        }
        if (def?._builtin) {
          toolType = def._builtin === 'web_search' ? 'web_search'
            : (def._builtin === 'shell_exec' || def._builtin === 'file_manager' || def._builtin === 'registry_tool' || def._builtin === 'open_explorer') ? 'shell'
            : def._builtin?.startsWith('browser_') ? 'browser'
            : def._builtin?.startsWith('qq_') ? 'qq'
            : 'builtin';
          output = await executeBuiltinTool(def, args, runtimeWithContext);
        } else if (def?._mcp && mcpHub) {
          toolType = 'mcp';
          toolMeta.serverId = def._mcp.serverId;
          toolMeta.mcpTool = def._mcp.toolName;
          output = await mcpHub.callByOpenAiName(fnName, args);
        } else if (fnName?.startsWith('mcp__') && mcpHub) {
          toolType = 'mcp';
          output = await mcpHub.callByOpenAiName(fnName, args);
        } else {
          output = `错误：未注册的工具 ${fnName}`;
        }
      } catch (e) {
        output = `工具执行失败: ${e.message}`;
      }

      const traceEntry = { type: toolType, ...toolMeta, result: String(output).slice(0, 4000) };
      toolTrace.push(traceEntry);
      if (onToolExecuted) onToolExecuted(traceEntry);

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: String(output).slice(0, 12000)
      });
    }
  }

  return {
    content: lastContent || '（已达工具调用轮次上限，请简化问题后重试）',
    toolTrace,
    messages
  };
}

function extractContent(result) {
  if (result && typeof result === 'object') {
    if (result.content != null) return String(result.content);
    if (result.text != null) return String(result.text);
  }
  return typeof result === 'string' ? result : '';
}

function normalizeCompletionResult(result) {
  if (result?.rawMessage) {
    return {
      content: result.content || '',
      tool_calls: result.tool_calls || null
    };
  }
  return {
    content: extractContent(result),
    tool_calls: result?.tool_calls || null
  };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} pluginRoot
 * @param {string} userText
 */
export function buildAgentSystemExtras(cfg, pluginRoot, userText) {
  if (!cfg.skillsEnabled) return '';
  const skills = discoverSkills(cfg, pluginRoot);
  const selected = selectSkillsForMessage(skills, userText, cfg);
  return buildSkillsSystemBlock(selected);
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {{ log?: Function }} opts
 */
export function createAgentMcpHub(cfg, opts = {}) {
  const servers = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
  return new McpHub(servers, { log: opts.log });
}

/**
 * @param {object[]} toolTrace
 */
export function toolTraceToHistoryMeta(toolTrace) {
  return toolTrace.map((t) => {
    if (t.type === 'web_search') {
      return { type: 'web_search', queries: [t.args?.query].filter(Boolean), result: t.result };
    }
    if (t.type === 'mcp') {
      return { type: 'mcp_tool', name: t.mcpTool || t.name, serverId: t.serverId, args: t.args, result: t.result };
    }
    if (t.type === 'shell') {
      return { type: 'shell_exec', name: t.name, args: t.args, result: t.result };
    }
    if (t.type === 'browser') {
      return { type: 'browser_tool', name: t.name, args: t.args, result: t.result };
    }
    if (t.type === 'qq') {
      return { type: 'qq_tool', name: t.name, args: t.args, result: t.result };
    }
    return { type: 'agent_tool', name: t.name, result: t.result };
  });
}
