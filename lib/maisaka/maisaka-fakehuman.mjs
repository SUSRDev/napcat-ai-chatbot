/**
 * MaiBot 风格伪人：多轮 Planner 工具循环 + 记忆/表达/行为/黑话学习
 */
import {
  DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION,
  DEFAULT_FAKEHUMAN_PLANNER_PROMPT,
  DEFAULT_FAKEHUMAN_MEMORY_IMPRESSION_PROMPT,
  DEFAULT_LEARN_STYLE_PROMPT,
  DEFAULT_LEARN_SLANG_PROMPT,
  DEFAULT_LEARN_BEHAVIOR_PROMPT,
  DEFAULT_EVALUATE_BEHAVIOR_PROMPT,
  parseLearnStyleJson,
  parseLearnSlangJson,
  parseLearnBehaviorJson,
  parseBehaviorFeedbackJson,
  renderPromptTemplate
} from './emoji-prompts.mjs';
import {
  loadMaisakaStore,
  saveMaisakaStore,
  getRecallState,
  nextMaisakaId,
  searchMemories,
  selectExpressions,
  selectBehaviors,
  upsertMemory,
  upsertExpression,
  upsertBehavior,
  applyBehaviorScoreDelta
} from './maisaka-store.mjs';
import { selectSlangs, upsertSlang } from './slang-library.mjs';
import { buildKaomojiHint } from './kaomoji.mjs';
import { ensureDefaultExpressions } from './expression-library.mjs';
import { searchMemoriesDb } from '../storage/sqlite-db.mjs';
import { runMaisakaPlannerLoop, flattenPlannerActions } from './maisaka-planner-loop.mjs';
import { buildFakeHumanReplyerInstruction, shouldFakeHumanBurst } from './fakehuman-burst.mjs';

/** @param {Record<string, unknown>} cfg */
export function pickMaisakaPersona(cfg) {
  let identity = (cfg.fakeHumanIdentity || '').trim();
  let replyStyle = (cfg.fakeHumanReplyStyle || '').trim();
  const states = Array.isArray(cfg.fakeHumanPersonalityStates) ? cfg.fakeHumanPersonalityStates.filter(Boolean) : [];
  const stateP = Math.max(0, Math.min(1, Number(cfg.fakeHumanStateProbability) ?? 0));
  let slangBoost = false;
  if (states.length && Math.random() < stateP) {
    identity = states[Math.floor(Math.random() * states.length)];
    slangBoost = true;
  }
  const multi = Array.isArray(cfg.fakeHumanMultipleReplyStyle) ? cfg.fakeHumanMultipleReplyStyle.filter(Boolean) : [];
  const multiP = Math.max(0, Math.min(1, Number(cfg.fakeHumanMultipleProbability) ?? 0.15));
  if (multi.length && Math.random() < multiP) {
    replyStyle = multi[Math.floor(Math.random() * multi.length)];
    slangBoost = true;
  }
  return { identity, replyStyle, slangBoost, darkMode: slangBoost };
}

/** @param {object} store @param {Record<string, unknown>} cfg @param {string} groupId @param {string} recentContext @param {Function} llmText @param {object} [db] @param {{ cacheOnly?: boolean }} [opts] */
export async function buildHeuristicMemoryBlock(store, cfg, groupId, recentContext, llmText, db = null, opts = {}) {
  if (cfg.fakeHumanEnableMemoryRecall === false) return '';
  const state = getRecallState(store, groupId);
  state.msgCounter = (Number(state.msgCounter) || 0) + 1;
  const minInterval = Math.max(30, Number(cfg.fakeHumanMemoryMinIntervalSec) ?? 180) * 1000;
  const minNew = Math.max(1, Number(cfg.fakeHumanMemoryMinNewMessages) ?? 8);
  const sinceLast = Date.now() - (Number(state.lastAt) || 0);
  const newMsgs = state.msgCounter - (Number(state.lastMsgCount) || 0);
  if (state.cachedBlock && sinceLast < minInterval && newMsgs < minNew) return state.cachedBlock;
  if (opts.cacheOnly) return state.cachedBlock || '';

  const prompt = renderPromptTemplate(
    (cfg.fakeHumanMemoryImpressionPrompt || DEFAULT_FAKEHUMAN_MEMORY_IMPRESSION_PROMPT).trim(),
    { chat_identity: `群 ${groupId}`, message_window: recentContext.slice(0, 1200) }
  );
  const impression = await llmText({ systemPrompt: '你是记忆印象生成器。', userPrompt: prompt, maxTokens: 120, temperature: 0.4 });
  if (!impression) return state.cachedBlock || '';

  const limit = Number(cfg.fakeHumanMemoryRecallLimit) ?? 3;
  const hits = db
    ? searchMemoriesDb(db, groupId, impression, limit)
    : searchMemories(store, groupId, impression, limit);
  if (!hits.length) {
    upsertMemory(store, { id: nextMaisakaId('mem'), groupId: String(groupId), impression: impression.slice(0, 300), text: recentContext.slice(0, 400), tags: [], createdAt: Date.now() });
    state.lastAt = Date.now();
    state.lastMsgCount = state.msgCounter;
    state.cachedBlock = '';
    return '';
  }
  const block = '【启发式记忆-内部参考，不要原样复述】\n' + hits.map((h, i) => `${i + 1}. ${h.impression || h.text}`.slice(0, 200)).join('\n');
  state.lastAt = Date.now();
  state.lastMsgCount = state.msgCounter;
  state.cachedBlock = block;
  return block;
}

export function buildExpressionBlock(store, groupId, recentContext) {
  ensureDefaultExpressions(store);
  const picks = selectExpressions(store, groupId, recentContext, 4);
  if (!picks.length) return '';
  return '【表达习惯参考】\n' + picks.map((e) => `当「${e.situation}」时，可以「${e.style}」`).join('\n');
}

export function buildBehaviorBlock(store, groupId, recentContext) {
  const picks = selectBehaviors(store, groupId, recentContext, 3);
  if (!picks.length) return '';
  return '【行为表现参考】\n' + picks.map((b) => `[behavior_id:${b.id}] ${b.action} → ${b.outcome || '未知结果'}`).join('\n');
}

export function buildSlangBlock(store, groupId, recentContext, cfg = {}) {
  const limit = Math.max(1, Math.min(12, Number(cfg.fakeHumanSlangInjectLimit) ?? 6));
  const picks = selectSlangs(store, groupId, recentContext, limit);
  if (!picks.length) return '';
  return '【黑话/梗参考（自然融入，不要刻意解释）】\n'
    + picks.map((s) => {
      const tags = (s.tags || []).length ? ` [${s.tags.join(',')}]` : '';
      const usage = s.usage ? `，例：${s.usage}` : '';
      return `「${s.term}」${s.meaning ? `：${s.meaning}` : ''}${usage}${tags}`;
    }).join('\n');
}

/**
 * MaiBot 多轮 Planner 工具循环
 * @param {object} opts
 */
export async function runMaisakaFakeHumanChat(opts) {
  const {
    cfg, groupId, userId, recentContext, plainText, personaContext = '', imageDesc = '',
    llmText, llmWithTools, buildReplySystemPrompt, executePlannerTool
  } = opts;

  const { identity, replyStyle, darkMode, slangBoost } = pickMaisakaPersona(cfg);
  const store = opts.store;
  const db = opts.db || null;
  const botName = (cfg.fakeHumanBotName || '机器人').trim();
  const memoryBlock = await buildHeuristicMemoryBlock(store, cfg, groupId, recentContext, llmText, db, { cacheOnly: true });
  const expressionBlock = buildExpressionBlock(store, groupId, recentContext);
  const behaviorBlock = buildBehaviorBlock(store, groupId, recentContext);
  const slangBlock = buildSlangBlock(store, groupId, recentContext, cfg);

  let plannerMeta = null;
  const usePlannerLoop = cfg.fakeHumanPlannerLoop !== false;
  if (usePlannerLoop && typeof llmWithTools === 'function') {
    const loop = await runMaisakaPlannerLoop({
      cfg,
      botName,
      identity,
      recentContext,
      plainText,
      memoryBlock,
      expressionBlock,
      behaviorBlock,
      slangBlock,
      personaContext,
      imageDesc,
      userId,
      llmWithTools,
      executeTool: executePlannerTool || (async () => 'ok'),
      maxRounds: Math.max(1, Math.min(8, Number(cfg.fakeHumanPlannerMaxRounds) ?? 5)),
      onRound: opts.onPlannerRound
    });
    plannerMeta = { plan: loop, reasoning: loop.reasoning };
    const outbound = flattenPlannerActions(loop.actions);
    if (outbound.length) {
      return { action: 'multi', outbound, darkMode, ...plannerMeta };
    }
    // Planner 选了 no_action 或没有有效 tool_calls → 默认回退 Replyer 文本生成
    if (loop.actions.some((a) => a.tool === 'no_action') && cfg.fakeHumanPlannerNoActionFallback === false) {
      return { action: 'skip', outbound: [], darkMode, plannerSkipped: true, ...plannerMeta };
    }
  }

  const replyResult = await runMaisakaReplyer({
    cfg, groupId, userId, recentContext, plainText, personaContext, imageDesc,
    llmText, buildReplySystemPrompt, identity, replyStyle, darkMode, slangBoost,
    memoryBlock, expressionBlock, behaviorBlock, slangBlock
  });
  return { ...replyResult, ...plannerMeta, replyerFallback: !!plannerMeta };
}

/** Replyer 文本生成（Planner 无有效出站时的回退） */
async function runMaisakaReplyer(opts) {
  const {
    cfg, userId, recentContext, plainText, personaContext = '', imageDesc = '',
    llmText, buildReplySystemPrompt, identity, replyStyle, darkMode, slangBoost,
    memoryBlock, expressionBlock, behaviorBlock, slangBlock
  } = opts;

  const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
  const groupAttention = (cfg.fakeHumanGroupChatAttention || DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION).trim();
  const replySystem = buildReplySystemPrompt({
    identity,
    replyStyle,
    groupChatAttentionBlock: groupAttention,
    replyerOutputInstruction: buildFakeHumanReplyerInstruction(cfg)
  });
  const replyUser = [
    '【回复信息参考】',
    `最近群消息：\n${recentContext.slice(0, 900)}`,
    memoryBlock, expressionBlock, behaviorBlock, slangBlock,
    buildKaomojiHint(cfg, `${plainText}\n${recentContext}`, 'fakehuman'),
    personaContext ? `\n【主对话同步】\n${personaContext.slice(0, 400)}` : '',
    imageDesc ? `\n【图片内容】${imageDesc}` : '',
    `\n请像真人一样插一句嘴。触发：${plainText.slice(0, 200)}`
  ].filter(Boolean).join('\n\n');

  let message = await llmText({ systemPrompt: replySystem, userPrompt: replyUser, maxTokens: Math.min(200, maxLen * 3), temperature: (darkMode || slangBoost) ? 0.95 : 0.88 });
  message = String(message || '').trim().replace(/\[CQ:[^\]]+\]/gi, '').trim();
  let burstParts = message.includes('|||')
    ? message.split('|||').map((s) => s.trim()).filter(Boolean)
    : [message.replace(/\n+/g, ' ').slice(0, maxLen)];
  if (!shouldFakeHumanBurst(cfg)) {
    burstParts = burstParts.slice(0, 1).map((s) => s.replace(/\n+/g, ' ').slice(0, maxLen)).filter(Boolean);
  }

  const atChance = Math.max(0, Math.min(1, Number(cfg.fakeHumanAtChance) ?? 0.25));
  const atUserId = Math.random() < atChance ? userId : '';

  const outbound = burstParts.slice(0, Math.max(1, Math.min(6, Number(cfg.fakeHumanBurstMaxMessages) ?? 4))).map((m, i) => ({
    type: 'reply',
    message: m.slice(0, maxLen),
    atUserId: i === 0 ? atUserId : ''
  }));

  return {
    action: outbound.length ? 'multi' : 'skip',
    message: burstParts[0] || '',
    atUserId,
    darkMode,
    outbound
  };
}

/** @param {object} opts */
export async function runMaisakaLearning(opts) {
  const { cfg, store, storePath, groupId, recentContext, botName, botReply, llmText } = opts;
  if (!recentContext || recentContext.length < 30) return;

  const chatForLearn = recentContext.split('\n').map((line, i) => `[source_id:${i + 1}] ${line}`).join('\n')
    + (botReply ? `\n[source_id:SELF] SELF: ${botReply}` : '');

  if (cfg.fakeHumanEnableExpressionLearning !== false && store.expressionSettings?.learningEnabled !== false) {
    const stylePrompt = renderPromptTemplate((cfg.fakeHumanLearnStylePrompt || DEFAULT_LEARN_STYLE_PROMPT).trim(), { chat_str: chatForLearn.slice(0, 3000) });
    const styleRaw = await llmText({ systemPrompt: '你是表达风格学习器。', userPrompt: stylePrompt, maxTokens: 500, temperature: 0.3 });
    for (const item of parseLearnStyleJson(styleRaw)) {
      upsertExpression(store, {
        id: nextMaisakaId('exp'),
        groupId: String(groupId),
        situation: String(item.situation).slice(0, 40),
        style: String(item.style).slice(0, 40),
        count: 1,
        score: 1,
        source: 'learned',
        createdAt: Date.now()
      });
    }
  }

  if (cfg.fakeHumanEnableSlangLearning !== false && store.slangSettings?.learningEnabled !== false) {
    const slangPrompt = renderPromptTemplate((cfg.fakeHumanLearnSlangPrompt || DEFAULT_LEARN_SLANG_PROMPT).trim(), { chat_str: chatForLearn.slice(0, 3000) });
    const slangRaw = await llmText({ systemPrompt: '你是群聊黑话/梗提取器。', userPrompt: slangPrompt, maxTokens: 600, temperature: 0.35 });
    for (const item of parseLearnSlangJson(slangRaw)) {
      upsertSlang(store, {
        id: nextMaisakaId('slang'),
        groupId: String(groupId),
        term: String(item.term).slice(0, 40),
        meaning: String(item.meaning || '').slice(0, 120),
        usage: String(item.usage || '').slice(0, 80),
        tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 8) : [],
        type: item.type || 'slang',
        count: 1,
        score: 1,
        source: 'learned',
        createdAt: Date.now()
      });
    }
  }

  if (cfg.fakeHumanEnableBehaviorLearning !== false) {
    const behaviorPrompt = renderPromptTemplate((cfg.fakeHumanLearnBehaviorPrompt || DEFAULT_LEARN_BEHAVIOR_PROMPT).trim(), { chat_str: chatForLearn.slice(0, 3500), bot_name: botName, scene_profile: '（单场景）' });
    const behaviorRaw = await llmText({ systemPrompt: '你是行为学习器。', userPrompt: behaviorPrompt, maxTokens: 600, temperature: 0.3 });
    for (const item of parseLearnBehaviorJson(behaviorRaw)) {
      upsertBehavior(store, { id: nextMaisakaId('bhv'), groupId: String(groupId), action: String(item.action).slice(0, 120), outcome: String(item.outcome || '').slice(0, 120), actorType: item.actor_type || 'observed_behavior', score: 1, successCount: 0, failureCount: 0, createdAt: Date.now() });
    }
    const refs = selectBehaviors(store, groupId, recentContext, 2);
    if (refs.length && botReply) {
      const evalPrompt = renderPromptTemplate((cfg.fakeHumanEvaluateBehaviorPrompt || DEFAULT_EVALUATE_BEHAVIOR_PROMPT).trim(), { bot_name: botName, behavior_references: refs.map((b) => `[behavior_id:${b.id}] ${b.action}`).join('\n') });
      const evalRaw = await llmText({ systemPrompt: evalPrompt, userPrompt: `后续聊天：\n${chatForLearn.slice(-1500)}`, maxTokens: 400, temperature: 0.2 });
      const { feedback } = parseBehaviorFeedbackJson(evalRaw);
      for (const fb of feedback) {
        if (fb?.adopted) applyBehaviorScoreDelta(store, fb.behavior_id, Number(fb.score_delta) || 0);
      }
    }
  }
  saveMaisakaStore(storePath, store);
}

export { loadMaisakaStore, saveMaisakaStore };
