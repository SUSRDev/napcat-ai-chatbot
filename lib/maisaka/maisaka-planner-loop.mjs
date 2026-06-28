/**
 * MaiBot 风格多轮 Planner 工具循环
 * 工具：reply / send_emoji / send_file / at / poke / wait / no_action
 */
import { renderPromptTemplate } from './emoji-prompts.mjs';
import { DEFAULT_FAKEHUMAN_PLANNER_PROMPT } from './emoji-prompts.mjs';

export const PLANNER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'reply',
      description: '向群聊发送一段文字回复。可与其他工具在同轮组合（如先发文字再发表情）。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '口语化回复正文，简短自然' },
          at_user_id: { type: 'string', description: '可选，要 @ 的 QQ 号' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_qq_face',
      description: '发送单个 QQ 小黄脸系统表情（轻量，适合「哈？」「6」这类反应）。可指定 face_id 或 emotion（开心/无语/哭/ok 等）。',
      parameters: {
        type: 'object',
        properties: {
          face_id: { type: 'string', description: 'QQ face id，如 0 微笑、13 呲牙、89 OK' },
          emotion: { type: 'string', description: '情绪关键词，自动映射 face id' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_emoji',
      description: '发送一个表情包表达情绪。适合安慰、调侃、无语等场景。可与 reply 组合使用。',
      parameters: {
        type: 'object',
        properties: {
          emotion: { type: 'string', description: '目标情绪或场景，如：安慰、开心、阴阳怪气' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_file',
      description: '向用户发送本地文件。path 必须是已存在的绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          caption: { type: 'string', description: '可选说明文字，会作为 reply 先发' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'at',
      description: '只 @ 某个用户，不附带文字。',
      parameters: {
        type: 'object',
        properties: { user_id: { type: 'string', description: 'QQ 号' } },
        required: ['user_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'poke',
      description: '戳一戳某用户。',
      parameters: {
        type: 'object',
        properties: { user_id: { type: 'string', description: 'QQ 号' } },
        required: ['user_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: '等待片刻再决定下一步（最多 3 秒）。',
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: '秒数 1-3' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'no_action',
      description: '本轮不发言，结束规划。',
      parameters: { type: 'object', properties: {} }
    }
  }
];

/**
 * @param {object} opts
 * @returns {Promise<{ actions: object[], reasoning: string, rounds: number }>}
 */
export async function runMaisakaPlannerLoop(opts) {
  const {
    cfg,
    botName,
    identity,
    recentContext,
    plainText,
    memoryBlock = '',
    expressionBlock = '',
    behaviorBlock = '',
    slangBlock = '',
    personaContext = '',
    imageDesc = '',
    userId,
    llmWithTools,
    executeTool,
    maxRounds = 5,
    onRound
  } = opts;

  const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
  const systemPrompt = [
    renderPromptTemplate((cfg.fakeHumanPlannerPrompt || DEFAULT_FAKEHUMAN_PLANNER_PROMPT).trim(), {
      bot_name: botName,
      identity,
      max_length: maxLen,
      message_window: recentContext.slice(0, 1200)
    }),
    '',
    '你是群聊 Planner。通过调用工具决定行动，可以一轮调用多个工具。',
    'MaiBot 风格：优先用多次 reply 连发 2-4 条极短句（每条 5-20 字），像真人分段打字；不要一条长消息。',
    '也可以单独 send_qq_face 发一个小黄脸，或与短句组合。',
    '不要输出 JSON，必须使用 tool_calls。',
    memoryBlock,
    expressionBlock,
    behaviorBlock,
    slangBlock
  ].filter(Boolean).join('\n');

  const userPrompt = [
    personaContext ? `【主对话同步】\n${personaContext.slice(0, 400)}` : '',
    imageDesc ? `【图片】${imageDesc}` : '',
    `【最近群消息】\n${recentContext.slice(0, 1000)}`,
    `【触发消息】${plainText.slice(0, 300)}`,
    `默认回复对象 QQ：${userId}`
  ].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const actions = [];
  let reasoning = '';
  let rounds = 0;
  const roundDetails = [];

  for (let r = 0; r < maxRounds; r++) {
    rounds = r + 1;
    const roundStart = Date.now();
    const result = await llmWithTools({ messages, tools: PLANNER_TOOLS, maxTokens: 400, temperature: 0.7 });
    const content = String(result?.content || '').trim();
    if (content) reasoning = content;
    const toolCalls = result?.tool_calls || [];
    const roundTools = [];

    if (!toolCalls.length) {
      roundDetails.push({ round: rounds, reasoning: content, tools: [], durationMs: Date.now() - roundStart });
      if (typeof onRound === 'function') {
        await onRound({ round: rounds, maxRounds, reasoning: content, tools: [], durationMs: Date.now() - roundStart, messagesCount: messages.length });
      }
      // 模型不支持 tool_calls 时，将纯文本回复当作 reply 出站
      const plain = content.replace(/\[CQ:[^\]]+\]/gi, '').replace(/\s+/g, ' ').trim();
      if (plain && !actions.some((a) => ['reply', 'send_emoji', 'send_qq_face'].includes(a.tool))) {
        actions.push({ tool: 'reply', args: { message: plain.slice(0, maxLen) }, result: 'content_fallback' });
      }
      break;
    }

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls
    });

    let terminal = false;
    for (const tc of toolCalls) {
      const name = tc.function?.name || tc.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || tc.arguments || '{}');
      } catch {
        args = {};
      }
      const out = await executeTool(name, args);
      actions.push({ tool: name, args, result: out });
      roundTools.push({ name, args, result: out });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof out === 'string' ? out : JSON.stringify(out)
      });
      if (name === 'no_action') terminal = true;
      if (name === 'wait') {
        const sec = Math.max(1, Math.min(3, Number(args.seconds) || 1));
        await new Promise((res) => setTimeout(res, sec * 1000));
      }
    }
    const durationMs = Date.now() - roundStart;
    roundDetails.push({ round: rounds, reasoning: content, tools: roundTools, durationMs });
    if (typeof onRound === 'function') {
      await onRound({
        round: rounds,
        maxRounds,
        reasoning: content,
        tools: roundTools,
        durationMs,
        messagesCount: messages.length,
        toolCatalogSize: PLANNER_TOOLS.length
      });
    }
    if (terminal) break;
    const hasOutbound = actions.some((a) => ['reply', 'send_emoji', 'send_qq_face', 'send_file', 'at', 'poke'].includes(a.tool));
    if (hasOutbound) break;
  }

  return { actions, reasoning, rounds, roundDetails };
}

/** 从 planner actions 提取待发内容 */
export function flattenPlannerActions(actions) {
  const outbound = [];
  for (const a of actions || []) {
    if (a.tool === 'reply') {
      const message = String(a.args?.message || '').trim();
      if (!message) continue;
      outbound.push({
        type: 'reply',
        message,
        atUserId: String(a.args?.at_user_id || '').trim()
      });
    } else if (a.tool === 'send_qq_face') {
      outbound.push({
        type: 'qq_face',
        faceId: String(a.args?.face_id || '').trim(),
        emotion: String(a.args?.emotion || '').trim()
      });
    } else if (a.tool === 'send_emoji') {
      outbound.push({ type: 'emoji', emotion: String(a.args?.emotion || '').trim() });
    } else if (a.tool === 'send_file') {
      outbound.push({
        type: 'file',
        path: String(a.args?.path || '').trim(),
        caption: String(a.args?.caption || '').trim()
      });
    } else if (a.tool === 'at') {
      outbound.push({ type: 'at', atUserId: String(a.args?.user_id || '').trim() });
    } else if (a.tool === 'poke') {
      outbound.push({ type: 'poke', userId: String(a.args?.user_id || '').trim() });
    }
  }
  return outbound;
}
