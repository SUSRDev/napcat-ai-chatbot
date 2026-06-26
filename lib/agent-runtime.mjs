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

  return tools;
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
    const query = String(args?.query || '').trim();
    if (!query) return '错误：query 不能为空';
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
  if (kind === 'qq_user_info' || kind === 'qq_group_info' || kind === 'qq_group_context') {
    return executeQqTool(kind, args, runtime);
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
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || tc.arguments || '{}');
      } catch {
        args = {};
      }

      let output = '';
      let toolType = 'unknown';
      let toolMeta = { name: fnName, args };

      try {
        const def = findToolDef(allTools, tc);
        if (def?._builtin) {
          toolType = def._builtin === 'web_search' ? 'web_search'
            : (def._builtin === 'shell_exec' || def._builtin === 'file_manager' || def._builtin === 'registry_tool' || def._builtin === 'open_explorer') ? 'shell'
            : def._builtin?.startsWith('browser_') ? 'browser'
            : def._builtin?.startsWith('qq_') ? 'qq'
            : 'builtin';
          output = await executeBuiltinTool(def, args, runtime);
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
