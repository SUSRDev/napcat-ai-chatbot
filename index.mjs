/**
 * NapCatQQ 聊天插件
 * 多轮对话、@机器人 或 指令 触发，支持 DeepSeek/SiliconFlow/OpenAI 兼容 API
 * 配置：冷却、人设、温度、群组卡片、黑名单、指令等
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateImage, IMAGE_GEN_PRESETS } from './lib/image-gen.mjs';
import { createDrawBot, DRAW_BOT_DEFAULTS, parseDrawMetaCommand } from './lib/draw-bot.mjs';
import { resolveTemplate, MESSAGE_TEMPLATE_DEFAULTS, normalizeMessagesConfig } from './lib/messages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const SILICONFLOW_API = 'https://api.siliconflow.cn/v1/chat/completions';
const SILICONFLOW_IMAGE_API = 'https://api.siliconflow.cn/v1/images/generations';
// 魔搭（ModelScope）提供 OpenAI 兼容接口，这里直接使用其 chat/completions 完整路径
const OPENAI_API = 'https://api-inference.modelscope.cn/v1/chat/completions';
const BAILIAN_API = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const CODING_PLAN_API = 'https://coding-intl.dashscope.aliyuncs.com/v1';
const SERPER_API = 'https://google.serper.dev/search';
const DUCKDUCKGO_API = 'https://api.duckduckgo.com/';
const UAPI_SEARCH_API = 'https://uapis.cn/api/v1/search/aggregate';
const TAVILY_SEARCH_API = 'https://api.tavily.com/search';
const BOCHA_WEB_SEARCH_API = 'https://api.bochaai.com/v1/web-search';
const BAIDU_AI_SEARCH_API = 'https://qianfan.baidubce.com/v2/ai_search/chat/completions';
const ALIYUN_IQS_API = 'https://iqs.cn-zhangjiakou.aliyuncs.com'; // 需 AK/SK 签名，见文档
const VISION_FALLBACK_MODELS = ['gpt-4o', 'gpt-4o-mini'];
const MAX_VISION_IMAGE_BYTES = 1572864;
const KIMI_CODE_API = 'https://api.kimi.com/coding/v1/chat/completions';
const KIMI_CODE_MODELS_API = 'https://api.kimi.com/coding/v1/models';
const KIMI_CODE_DEFAULT_MODEL = 'kimi-for-coding';
/** Kimi Code chat 接口会校验 Coding Agent 白名单 User-Agent，缺省会 403 */
const KIMI_CODE_USER_AGENT = 'KimiCLI/1.3';
const KIMI_IMAGE_ANALYZE_PROMPT = '你是图片信息提取工具，不是对话助手。你会收到用户提问和一张图片。请只根据用户提问，从图片中提取与之相关的可见信息（文字、数字、时间、物体、颜色、布局、人物、界面元素等），输出客观、结构化的图片信息摘要，供后续文字模型回答用户。禁止直接回复用户、禁止闲聊、禁止给建议。若用户未附带文字问题，则输出图片的全面客观描述。';
const MAX_LOG_ENTRIES = 2000;
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_TYPES = ['system', 'api', 'model', 'chat', 'search', 'token', 'sticker', 'image', 'fakehuman', 'config', 'reaction', 'draw'];
/** QQ 消息表情回应常用 ID（set_msg_emoji_like），可在仪表盘扩展 */
const DEFAULT_REACTION_EMOJIS = [
  { id: '76', name: '赞', type: '1', glyph: '+' },
  { id: '124', name: '爱心', type: '1', glyph: '♥' },
  { id: '311', name: '思考', type: '1', glyph: '?' },
  { id: '182', name: '鼓掌', type: '1', glyph: '*' },
  { id: '271', name: 'OK', type: '1', glyph: 'o' },
  { id: '66', name: '笑脸', type: '1', glyph: ':)' },
  { id: '67', name: '开心', type: '1', glyph: '^' },
  { id: '78', name: '捂脸', type: '1', glyph: 'x' }
];
const DEFAULT_FALLBACK_MODELS = {
  siliconflow: [
    'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-V3',
    'Qwen/Qwen2.5-7B-Instruct',
    'Qwen/Qwen2.5-14B-Instruct',
    'Qwen/Qwen2.5-32B-Instruct'
  ],
  openai: [
    'Qwen/Qwen3.5-397B-A17B',
    'Qwen/Qwen3-235B-A22B-Instruct-2507',
    'Qwen/Qwen3-30B-A3B-Instruct-2507',
    'Qwen/Qwen3-14B',
    'Qwen/Qwen3-8B',
    'Qwen/Qwen3-4B-Instruct-2507',
    'Qwen/Qwen3-4B',
    'Qwen/Qwen3-1.7B',
    'Qwen/Qwen3-0.6B',
    'Qwen/Qwen3-Coder-Next',
    'Qwen/Qwen3-Coder-Next-Base',
    'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct',
    'Qwen/Qwen2.5-3B-Instruct',
    'Qwen/Qwen2.5-0.5B-Instruct',
    'Qwen/Qwen2.5-32B-Instruct',
    'Qwen/Qwen2.5-72B-Instruct',
    'Qwen/QwQ-32B',
    'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-V3.2-Speciale',
    'deepseek-ai/DeepSeek-V3',
    'deepseek-ai/DeepSeek-R1-0528',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'
  ],
  deepseek: ['deepseek-chat'],
  bailian: [
    'qwen3.5-plus',
    'qwen-plus',
    'qwen-turbo'
  ],
  codingplan: [
    'qwen3.5-plus',
    'qwen3-max-2026-01-23',
    'qwen3-coder-next',
    'qwen3-coder-plus',
    'MiniMax-M2.5',
    'glm-5',
    'glm-4.7',
    'kimi-k2.5'
  ],
  custom: ['gpt-4o', 'gpt-4o-mini']
};

const DEFAULT_SYSTEM_PROMPT = '你是友好、有帮助的群聊/私聊助手。请用简洁自然的语言回复，适合即时通讯场景，不要用Markdown语法！例如加粗等等！不要使用Markdown语法！。';

const DEFAULT_CONFIG = {
  enabled: true,
  apiProvider: 'siliconflow',
  deepseekApiKey: '',
  siliconflowApiKey: '',
  bailianApiKey: '',
  bailianApiUrl: BAILIAN_API,
  codingPlanApiKey: '',
  codingPlanApiUrl: CODING_PLAN_API,
  openaiApiKey: '',
  customApiUrl: '',
  customApiKey: '',
  model: 'deepseek-ai/DeepSeek-V3',
  modelFallbackList: [],
  apiFailoverEnabled: false,
  apiFailoverRetries: 2,
  apiFailoverMaxEndpoints: 5,
  apiFailoverTimeoutMs: 90000,
  apiFailoverRetryDelayMs: 1200,
  apiFailoverOnAuth: true,
  apiFailoverOnRateLimit: true,
  apiFailoverOnServerError: true,
  apiFailoverOnTimeout: true,
  apiFailoverOnNetwork: true,
  apiPool: [],
  temperature: 0.7,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  cooldownSeconds: 10,
  cooldownScope: 'user',
  cooldownByUser: {},
  cooldownByGroup: {},
  conversationIsolationMode: 'user_group',
  groupIsolationOverrides: {},
  adminCommandsEnabled: false,
  adminUsers: [],
  adminCommandPrefix: '#',
  adminCommands: ['clear', 'status', 'cooldown', 'help', 'on', 'off', 'draw-cancel', 'draw-promote', 'draw-clear', 'draw-stats', 'draw-queue', 'draw-help'],
  botDisplayName: '助手',
  maxHistoryMessages: 12,
  maxTokens: 8192,
  top_p: 0.95,
  top_k: 20,
  frequency_penalty: 0,
  presence_penalty: 0,
  stop: null,
  enableThinking: false,
  thinkingBudget: 4096,
  enableGroups: [],
  whitelistGroups: [],
  blacklistGroups: [],
  whitelistUsers: [],
  blacklistUsers: [],
  userProfileCache: {},
  groupProfileCache: {},
  triggerMode: 'at_only',
  commandPrefix: '/',
  customCommands: ['chat', '问', '问一下'],
  replyPrefix: '[CQ:at,qq={user_id}] ',
  pokeAfterReply: false,
  pokeMode: 'never',
  pokeRandomChance: 0.5,
  skipPrivate: false,
  privateEnabled: true,
  theme: 'dark',
  logLevel: 'info',
  webSearchEnabled: false,
  webSearchProvider: 'duckduckgo',
  smartSearchQueryMode: 'ai',
  webSearchTriple: false,
  serperApiKey: '',
  uapiApiKey: '',
  tavilyApiKey: '',
  bochaApiKey: '',
  baiduSearchApiKey: '',
  aliyunIqsAccessKeyId: '',
  aliyunIqsAccessKeySecret: '',
  webSearchQuery: '',
  uapiSearchTimeoutMs: 10000,
  uapiSort: '',
  uapiTimeRange: '',
  customTriggerKeywords: [],
  appendStickerAfterReply: false,
  stickerRandomFromFavorites: true,
  stickerSelectMode: 'ai',
  stickerFaceCount: 48,
  stickerPool: [],
  stickerFixedId: '',
  thinkingIndicatorEnabled: false,
  thinkingIndicatorMode: 'message',
  thinkingMessage: '正在思考…',
  thinkingEmojiId: '311',
  thinkingEmojiType: '1',
  afterReplyReactionEnabled: false,
  afterReplyRemoveThinkingEmoji: true,
  afterReplyEmojiId: '76',
  afterReplyEmojiMode: 'replace',
  reactionEmojiCatalog: DEFAULT_REACTION_EMOJIS,
  imageGenEnabled: false,
  imageGenProvider: 'siliconflow',
  imageGenPreset: 'siliconflow-kolors',
  imageGenPresets: IMAGE_GEN_PRESETS,
  imageGenGeminiApiKey: '',
  imageGenGeminiModel: 'imagen-3.0-generate-002',
  imageGenCustomApiUrl: '',
  imageGenCustomApiKey: '',
  imageGenCustomMethod: 'POST',
  imageGenCustomBodyTemplate: '{"prompt":"{{prompt}}","model":"{{model}}","image_size":"{{size}}"}',
  imageGenCustomHeaders: {},
  imageGenResponseFormat: 'openai_url',
  imageGenResponsePath: 'data[0].url',
  imageGenApiUrl: 'http://127.0.0.1:1088',
  ...DRAW_BOT_DEFAULTS,
  imageGenModel: 'Kwai-Kolors/Kolors',
  imageGenSize: '1024x1024',
  imageGenCommands: ['画', '画图', '生成图', 'draw'],
  imageGenNegativePrompt: '',
  imageGenSteps: 20,
  imageGenGuidanceScale: 7.5,
  imageGenCfg: 4,
  messages: {
    ...MESSAGE_TEMPLATE_DEFAULTS
  },
  chatAllowUsers: [],
  chatParseImage: true,
  kimiVisionModel: KIMI_CODE_DEFAULT_MODEL,
  kimiVisionApiKey: '',
  kimiVisionApiUrl: KIMI_CODE_API,
  kimiVisionModelsUrl: KIMI_CODE_MODELS_API,
  visionFailoverEnabled: false,
  visionFailoverRetries: 2,
  visionFailoverMaxEndpoints: 4,
  visionFailoverTimeoutMs: 60000,
  visionFailoverRetryDelayMs: 1000,
  visionFailoverOnAuth: true,
  visionFailoverOnRateLimit: true,
  visionFailoverOnServerError: true,
  visionFailoverOnTimeout: true,
  visionFailoverOnNetwork: true,
  visionPool: [],
  imageGenAllowUsers: [],
  videoAllowUsers: [],
  fakeHumanEnabled: false,
  fakeHumanChance: 0.05,
  fakeHumanGroupChance: {},
  fakeHumanMinInterval: 90,
  fakeHumanReplyMode: 'mixed',
  fakeHumanTextList: ['哈哈', '确实', '666', '笑死', '草', '好家伙', '可以'],
  fakeHumanEmojiList: ['哈', '6', '草', 'ok', '行', '可以'],
  fakeHumanAtChance: 0.25,
  fakeHumanAtWho: 'sender',
  fakeHumanSystemPrompt: '你是一个在群聊里偶尔插话的真人。根据当前这条群消息，回复一两句非常短的话（不超过30字），可以是吐槽、附和、表情、网络用语。不要长篇大论，不要重复消息内容。',
  fakeHumanMaxLength: 80,
  fakeHumanParseImage: true,
  fakeHumanVisionModel: '',
  fakeHumanEnableGroups: [],
  fakeHumanContextLines: 5,
  fakeHumanWebSearch: false,
  fakeHumanSyncPersona: true,
  fakeHumanFollowUpRounds: 2,
  fakeHumanFollowUpTimeoutMs: 120000,
  fakeHumanActionMode: 'reply'
};

const conversationHistory = new Map();
const conversationMeta = new Map();
const cooldownUntil = new Map();
const fakeHumanLastTime = new Map();
const recentGroupMessages = new Map();
const fakeHumanTalkingTo = new Map();
const tokenStats = { totalPrompt: 0, totalCompletion: 0, totalTokens: 0, byKey: new Map(), recent: [] };
const logBuffer = [];
const MAX_HISTORY = 50;
const MAX_RECENT_STATS = 100;

function normalizeModelList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const model = String(item || '').trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }
  return out;
}

function normalizeWebSearchProvider(raw) {
  const p = String(raw || 'duckduckgo').toLowerCase().trim();
  if (p === 'surper') return 'serper';
  if (p === 'travily') return 'tavily';
  const allowed = ['serper', 'duckduckgo', 'uapi', 'tavily', 'bocha', 'baidu', 'aliyun', 'both', 'three', 'tsu', 'all'];
  return allowed.includes(p) ? p : 'duckduckgo';
}

function getFallbackModelCandidates(cfg, provider, baseModel) {
  const customList = normalizeModelList(cfg.modelFallbackList);
  const source = customList.length > 0
    ? customList
    : (DEFAULT_FALLBACK_MODELS[provider] || DEFAULT_FALLBACK_MODELS.siliconflow);
  return normalizeModelList(source).filter((m) => m !== baseModel);
}

let pluginState = {
  config: { ...DEFAULT_CONFIG },
  configPath: '',
  logger: null,
  actions: null,
  adapterName: '',
  pluginManager: null
};
let drawBotEngine = null;

async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (e) {
    log('warn', 'HTTP 请求失败', { url: String(url).slice(0, 80), err: e.message }, 'api');
    return null;
  }
}

function log(level, message, detail, type = 'system') {
  const logType = LOG_TYPES.includes(type) ? type : 'system';
  let imagePreview;
  let detailStr;
  if (detail != null) {
    if (typeof detail === 'object') {
      const copy = { ...detail };
      if (copy.previewUrl) {
        const pu = String(copy.previewUrl);
        if (/^https?:\/\//i.test(pu)) imagePreview = pu;
        else if (pu.startsWith('data:image')) copy.previewUrl = `[base64 ${pu.length} chars]`;
      }
      detailStr = JSON.stringify(copy);
    } else {
      detailStr = String(detail);
    }
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    type: logType,
    message,
    detail: detailStr,
    imagePreview
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  const minLevel = LOG_LEVELS[pluginState.config?.logLevel || 'info'] ?? 1;
  if ((LOG_LEVELS[level] ?? 1) >= minLevel) {
    if (pluginState.logger) {
      const fn = pluginState.logger[level] || pluginState.logger.info;
      if (typeof fn === 'function') fn.call(pluginState.logger, `[chat-bot][${logType}] ${message}` + (detailStr != null ? ' ' + detailStr : ''));
    }
  }
}

function recordTokenUsage(key, promptTokens, completionTokens, model) {
  const total = (promptTokens || 0) + (completionTokens || 0);
  tokenStats.totalPrompt += promptTokens || 0;
  tokenStats.totalCompletion += completionTokens || 0;
  tokenStats.totalTokens += total;
  if (key) {
    if (!tokenStats.byKey.has(key)) tokenStats.byKey.set(key, { prompt: 0, completion: 0, total: 0 });
    const b = tokenStats.byKey.get(key);
    b.prompt += promptTokens || 0;
    b.completion += completionTokens || 0;
    b.total += total;
  }
  tokenStats.recent.push({ ts: Date.now(), key, prompt: promptTokens || 0, completion: completionTokens || 0, total, model });
  if (tokenStats.recent.length > MAX_RECENT_STATS) tokenStats.recent.shift();
}

function getConfigPath(ctx) {
  if (pluginState.configPath) return pluginState.configPath;
  const base = ctx?.configPath || path.join(__dirname, 'config.json');
  return path.isAbsolute(base) ? base : path.join(__dirname, base);
}

function loadConfig(ctx) {
  const p = getConfigPath(ctx);
  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      pluginState.config = { ...DEFAULT_CONFIG, ...raw };
      if ((pluginState.config.apiProvider || '').toLowerCase() === 'xiaviercodex') {
        pluginState.config.apiProvider = 'custom';
        if (!pluginState.config.customApiUrl && pluginState.config.xiavierCodexApiUrl) {
          pluginState.config.customApiUrl = pluginState.config.xiavierCodexApiUrl;
        }
        if (!pluginState.config.customApiKey && pluginState.config.xiavierCodexApiKey) {
          pluginState.config.customApiKey = pluginState.config.xiavierCodexApiKey;
        }
      }
      if (pluginState.config.messages) pluginState.config.messages = { ...DEFAULT_CONFIG.messages, ...pluginState.config.messages };
      if (pluginState.config.messages.thinking) pluginState.config.thinkingMessage = pluginState.config.messages.thinking;
      else if (pluginState.config.thinkingMessage) pluginState.config.messages.thinking = pluginState.config.thinkingMessage;
      pluginState.config.modelFallbackList = normalizeModelList(pluginState.config.modelFallbackList);
      pluginState.config.apiPool = normalizeApiPool(pluginState.config.apiPool);
      pluginState.config.visionPool = normalizeVisionPool(pluginState.config.visionPool);
      if (!pluginState.config.kimiVisionModel && pluginState.config.chatVisionModel) {
        pluginState.config.kimiVisionModel = pluginState.config.chatVisionModel;
      }
      if (!pluginState.config.kimiVisionModel) {
        pluginState.config.kimiVisionModel = KIMI_CODE_DEFAULT_MODEL;
      }
    } catch (e) {
      pluginState.logger?.warn?.('[chat-bot] 加载配置失败，使用认');
    }
  }
}

function saveConfig(ctx) {
  try {
    const p = getConfigPath(ctx);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(pluginState.config, null, 2), 'utf-8');
  } catch (e) {
    pluginState.logger?.error?.('[chat-bot] 保存配置失败: ' + e.message);
  }
}

function extractPlainText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\[CQ:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
}

/** 从消息事件中提取图片：返回 { url?, file? } 列表（QQ 图可能只有 file，需后续用 get_image 解析） */
function extractImageFromEvent(event) {
  const out = [];
  const seen = new Set();
  const add = (url, file) => {
    const key = `${url || ''}\t${file || ''}`;
    if (seen.has(key)) return;
    if (!url && !file) return;
    seen.add(key);
    out.push({ url: url && String(url).trim() ? String(url).trim() : null, file: file && String(file).trim() ? String(file).trim() : null });
  };
  const msg = event?.message;
  if (Array.isArray(msg)) {
    for (const seg of msg) {
      if (seg?.type !== 'image') continue;
      const url = seg?.data?.url ? String(seg.data.url).trim() : null;
      const file = seg?.data?.file ? String(seg.data.file).trim() : null;
      add(url, file);
    }
  }
  const raw = event?.raw_message || '';
  const cqMatch = raw.matchAll(/\[CQ:image[^\]]*\]/g);
  for (const m of cqMatch) {
    const part = m[0];
    const urlMatch = part.match(/url=([^,\]]+)/);
    const fileMatch = part.match(/file=([^,\]]+)/);
    const url = urlMatch ? decodeURIComponent(urlMatch[1].trim()) : null;
    const file = fileMatch ? decodeURIComponent(fileMatch[1].trim()) : null;
    add(url, file);
  }
  return out;
}

/** 是否为 QQ 多媒体域名（部分接口无法直接拉取） */
function isQqCdnImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /multimedia\.nt\.qq\.com|gchat\.qpic\.cn|qpic\.cn\/qq\/|c2cpicdw\.qpic\.cn/i.test(url.replace(/&amp;/g, '&'));
}

/** 估算 data URL 字符长度（含 data:image/...;base64, 前缀） */
function estimateVisionDataUrlLength(rawBytes) {
  const n = Number(rawBytes) || 0;
  return 23 + Math.ceil(n * 4 / 3);
}

function visionPayloadTooLarge(lenOrDataUrl) {
  const size = typeof lenOrDataUrl === 'string' ? lenOrDataUrl.length : estimateVisionDataUrlLength(lenOrDataUrl);
  return size > MAX_VISION_IMAGE_BYTES;
}

function bufferToVisionDataUrl(buf, mime = 'image/jpeg', item = null) {
  if (!buf || !buf.length) return null;
  if (visionPayloadTooLarge(buf.length)) {
    log('warn', '图片过大，视觉模式跳过', { size: buf.length, limit: MAX_VISION_IMAGE_BYTES, file: item?.file }, 'image');
    return null;
  }
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  if (visionPayloadTooLarge(dataUrl)) {
    log('warn', '图片 base64 过大，视觉模式跳过', { size: dataUrl.length, limit: MAX_VISION_IMAGE_BYTES, file: item?.file }, 'image');
    return null;
  }
  return dataUrl;
}

/** 将单条图片信息解析为可访问 URL；requireBase64 时强制 base64（Kimi 等无法拉取 QQ CDN） */
async function resolveImageToUrl(ctx, item, options = {}) {
  const forVision = !!options.forVision;
  const requireBase64 = !!options.requireBase64;
  const hasUrl = item.url && /^https?:\/\//i.test(item.url);
  const hasFile = item.file && String(item.file).trim();
  const normalizedUrl = hasUrl ? item.url.replace(/&amp;/g, '&') : null;
  const qqCdn = normalizedUrl && isQqCdnImageUrl(normalizedUrl);

  const toDataUrl = (buf, mime = 'image/jpeg') => bufferToVisionDataUrl(buf, mime, item);

  const tryGetImage = async () => {
    if (!hasFile) return null;
    try {
      const data = await callAction('get_image', { file: item.file });
      if (data?.base64 && typeof data.base64 === 'string') {
        const b64 = data.base64.replace(/^data:image\/\w+;base64,/, '').trim();
        if (!b64.length) return null;
        const buf = Buffer.from(b64, 'base64');
        return bufferToVisionDataUrl(buf, 'image/jpeg', item);
      }
      if (data?.path || data?.file) {
        const p = path.resolve(String(data.path || data.file));
        if (fs.existsSync(p)) return toDataUrl(fs.readFileSync(p));
      }
      if (data?.url && /^https?:\/\//i.test(String(data.url))) {
        const u = String(data.url).replace(/&amp;/g, '&');
        if (!requireBase64 && !isQqCdnImageUrl(u)) return u;
      }
    } catch (e) {
      log('warn', 'get_image 解析失败', { file: item.file, err: e.message }, 'image');
    }
    return null;
  };

  if (requireBase64 || qqCdn) {
    const dataUrl = await tryGetImage();
    if (dataUrl) return dataUrl;
    if (requireBase64) {
      log('warn', '无法将图片转为 base64', { hasFile, qqCdn, url: normalizedUrl?.slice(0, 80) }, 'image');
      return null;
    }
  }

  if (forVision && normalizedUrl && !qqCdn) return normalizedUrl;
  if (normalizedUrl && !qqCdn) return normalizedUrl;

  const dataUrl = await tryGetImage();
  if (dataUrl) return dataUrl;
  if (forVision && normalizedUrl) return normalizedUrl;
  return null;
}

async function resolveEventImages(ctx, event, maxCount = 4, options = false) {
  const opts = typeof options === 'boolean' ? { forVision: options } : (options || {});
  const forVision = !!opts.forVision;
  const requireBase64 = !!opts.requireBase64;
  const items = extractImageFromEvent(event);
  const urls = [];
  for (let i = 0; i < Math.min(maxCount, items.length); i++) {
    const u = await resolveImageToUrl(ctx, items[i], { forVision, requireBase64 });
    if (!u) continue;
    if (u.startsWith('data:') && u.length > MAX_VISION_IMAGE_BYTES) {
      log('warn', '图片过大已跳过', { index: i, size: u.length }, 'image');
      continue;
    }
    if (requireBase64 && !u.startsWith('data:')) {
      log('warn', '外部视觉 API 需要 base64，跳过 HTTP 图片', { index: i, preview: u.slice(0, 80) }, 'image');
      continue;
    }
    urls.push(u);
  }
  return urls;
}

function getVisionFallbackModels(cfg) {
  return [...VISION_FALLBACK_MODELS, ...(cfg.model ? [cfg.model] : [])];
}

function getKimiVisionConfig(cfg = pluginState.config) {
  return {
    apiKey: String(cfg.kimiVisionApiKey || '').trim(),
    apiUrl: normalizeCompatChatCompletionsUrl(String(cfg.kimiVisionApiUrl || KIMI_CODE_API).trim() || KIMI_CODE_API),
    modelsUrl: String(cfg.kimiVisionModelsUrl || KIMI_CODE_MODELS_API).trim() || KIMI_CODE_MODELS_API
  };
}

function kimiCodeRequestHeaders(cfg = pluginState.config, extra = {}) {
  const { apiKey } = getKimiVisionConfig(cfg);
  const headers = { 'User-Agent': KIMI_CODE_USER_AGENT, ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function touchConversationMeta(key, patch = {}) {
  const meta = conversationMeta.get(key) || { lastActivity: 0, messageCount: 0 };
  Object.assign(meta, patch);
  meta.lastActivity = Date.now();
  conversationMeta.set(key, meta);
}

function isTransientApiError(status, text) {
  if (status === 429 || status === 502 || status === 504) return true;
  if (status === 503 && !isModelRouteError(status, text)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildKimiAnalyzeContent(imageUrls, userQuestion) {
  const urls = (imageUrls || []).slice(0, 1);
  if (!urls.length) return '';
  const q = String(userQuestion || '').trim();
  const prompt = q
    ? `用户的问题是：「${q}」\n请结合该问题，从图片中提取所有相关可见信息。只输出与问题相关的图片信息摘要，不要直接回答用户。`
    : '用户只发送了图片，未附带文字。请全面客观描述这张图片中的可见内容。只输出图片信息，不要回答问题。';
  return [
    { type: 'text', text: prompt },
    ...urls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))
  ];
}

function buildMultimodalUserContent(text, imageUrls) {
  const t = String(text || '').trim() || '请仔细查看图片并描述你看到的内容，回答用户的问题。';
  if (!imageUrls || !imageUrls.length) return t;
  const urls = imageUrls.slice(0, 1);
  return [
    { type: 'text', text: t },
    ...urls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))
  ];
}

function historyLabelForUser(text, hasImages) {
  const t = String(text || '').trim();
  if (hasImages) return t ? `[图片] ${t}` : '[图片]';
  return t;
}

function extractKimiMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = String(message.content || '').trim();
  if (content) return content;
  return String(message.reasoning_content || '').trim();
}

async function fetchKimiModels() {
  const { apiKey, modelsUrl } = getKimiVisionConfig();
  if (!apiKey) {
    log('warn', '未配置视觉 API Key，无法加载模型列表', null, 'image');
    return [KIMI_CODE_DEFAULT_MODEL];
  }
  try {
    const res = await fetch(modelsUrl, {
      headers: kimiCodeRequestHeaders()
    });
    if (!res.ok) {
      log('warn', '视觉模型列表获取失败', { status: res.status }, 'image');
      return [KIMI_CODE_DEFAULT_MODEL];
    }
    const data = await res.json();
    const list = (data?.data || []).map((m) => m.id || m.name).filter(Boolean);
    const normalized = normalizeModelList(list);
    log('info', '视觉模型列表已加载', { count: normalized.length, models: normalized }, 'image');
    return normalized.length ? normalized : [KIMI_CODE_DEFAULT_MODEL];
  } catch (e) {
    log('warn', '视觉模型列表请求异常', e.message, 'image');
    return [KIMI_CODE_DEFAULT_MODEL];
  }
}

async function analyzeImageWithKimi(imageUrls, userQuestion, model) {
  const urls = (imageUrls || []).slice(0, 1);
  if (!urls.length) return '';
  const cfg = pluginState.config;
  const endpoints = buildVisionEndpointList(cfg);
  if (!endpoints.length) {
    log('warn', '未配置视觉 API Key，跳过图片分析', null, 'image');
    return '';
  }
  const settings = getVisionFailoverSettings(cfg);
  const q = String(userQuestion || '').trim();
  const userContent = buildKimiAnalyzeContent(urls, q);
  let lastStatus = 0;

  for (let ei = 0; ei < endpoints.length; ei++) {
    const endpoint = endpoints[ei];
    const useModel = (model || endpoint.model || KIMI_CODE_DEFAULT_MODEL).trim() || KIMI_CODE_DEFAULT_MODEL;
    const retries = settings.enabled ? settings.retries : 1;

    for (let attempt = 1; attempt <= retries; attempt++) {
      log('info', '视觉模型图片分析开始', {
        endpoint: endpoint.name,
        attempt,
        model: useModel,
        userQuestion: q ? q.slice(0, 120) : '(无文字，全图描述)',
        payloadSize: urls[0]?.length || 0
      }, 'image');

      let res;
      let text = '';
      try {
        res = await fetchWithTimeout(endpoint.apiUrl, {
          method: 'POST',
          headers: visionHeadersForEndpoint(endpoint, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            model: useModel,
            messages: [
              { role: 'system', content: KIMI_IMAGE_ANALYZE_PROMPT },
              { role: 'user', content: userContent }
            ],
            stream: false,
            temperature: 1,
            max_tokens: 800
          })
        }, settings.timeoutMs);
        text = await res.text();
      } catch (e) {
        log('warn', '视觉 API 请求异常', { endpoint: endpoint.name, err: e.message, attempt }, 'image');
        if (!settings.enabled || !shouldRotateApiFailure(0, '', e, settings)) return '';
        if (attempt < retries) {
          await sleep(settings.retryDelayMs);
          continue;
        }
        break;
      }

      if (res.ok) {
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          log('warn', '视觉 API 响应解析失败', e.message, 'image');
          if (attempt < retries) {
            await sleep(settings.retryDelayMs);
            continue;
          }
          break;
        }
        const analysis = extractKimiMessageText(data?.choices?.[0]?.message);
        if (analysis) {
          log('info', '视觉图片分析完成', { endpoint: endpoint.name, length: analysis.length, model: useModel }, 'image');
          return analysis;
        }
      } else {
        lastStatus = res.status;
        const hint = res.status === 403 ? '（需 Coding Agent User-Agent，已自动附加）' : '';
        log('warn', `视觉 API 图片分析失败${hint}`, { endpoint: endpoint.name, status: res.status, body: text.slice(0, 300), attempt }, 'image');
        if (!settings.enabled || !shouldRotateApiFailure(res.status, text, null, settings)) return '';
        if (attempt < retries) {
          await sleep(settings.retryDelayMs);
          continue;
        }
      }
      break;
    }

    if (settings.enabled && ei < endpoints.length - 1) {
      log('info', '切换下一视觉 API 端点', { from: endpoint.name, to: endpoints[ei + 1]?.name }, 'image');
      await sleep(settings.retryDelayMs);
    }
  }

  if (lastStatus) log('warn', '所有视觉端点均失败', { lastStatus }, 'image');
  return '';
}

const ISOLATION_MODES = ['user_group', 'group', 'user'];

function normalizeIsolationMode(mode) {
  const m = String(mode || 'user_group').toLowerCase();
  return ISOLATION_MODES.includes(m) ? m : 'user_group';
}

function getEffectiveIsolationMode(groupId, cfg = pluginState.config) {
  if (!groupId) return 'private';
  const g = String(groupId);
  const overrides = cfg.groupIsolationOverrides || {};
  if (overrides[g] != null && overrides[g] !== '') return normalizeIsolationMode(overrides[g]);
  return normalizeIsolationMode(cfg.conversationIsolationMode);
}

function getConversationKey(groupId, userId, cfg = pluginState.config) {
  const u = String(userId);
  if (!groupId) return `p:${u}`;
  const g = String(groupId);
  const mode = getEffectiveIsolationMode(g, cfg);
  if (mode === 'group') return `g:${g}`;
  if (mode === 'user') return `u:${u}`;
  return `g:${g}:u:${u}`;
}

function parseConversationKey(key) {
  const k = String(key || '');
  if (k.startsWith('g:') && k.includes(':u:')) {
    const parts = k.split(':');
    if (parts.length >= 4) return { groupId: parts[1], userId: parts[3], isolationMode: 'user_group' };
  }
  if (k.startsWith('g:')) return { groupId: k.slice(2), userId: null, isolationMode: 'group' };
  if (k.startsWith('u:')) return { groupId: null, userId: k.slice(2), isolationMode: 'user' };
  if (k.startsWith('p:')) return { groupId: null, userId: k.slice(2), isolationMode: 'private' };
  return { groupId: null, userId: null, isolationMode: 'unknown' };
}

function getHistory(key) {
  const arr = conversationHistory.get(key) || [];
  const max = Math.min(MAX_HISTORY, Math.max(2, (pluginState.config?.maxHistoryMessages ?? 12) * 2 + 2));
  return arr.slice(-max);
}

function pushHistory(key, role, content) {
  if (!conversationHistory.has(key)) conversationHistory.set(key, []);
  const arr = conversationHistory.get(key);
  arr.push({ role, content: String(content).slice(0, 4000) });
  const max = Math.min(MAX_HISTORY, Math.max(4, (pluginState.config?.maxHistoryMessages ?? 12) * 2 + 4));
  if (arr.length > max) conversationHistory.set(key, arr.slice(-max));
  const meta = conversationMeta.get(key) || { lastActivity: 0, messageCount: 0 };
  meta.lastActivity = Date.now();
  meta.messageCount = arr.length;
  meta.lastMessage = String(content).slice(0, 120);
  conversationMeta.set(key, meta);
}

/** 取当前生效的冷却秒数：优先用户/群单独配置，否则用全局 */
function getEffectiveCooldownSeconds(groupId, userId, cfg) {
  const scope = cfg.cooldownScope === 'group' ? 'group' : 'user';
  const defaultSec = Math.max(0, Number(cfg.cooldownSeconds) ?? 0);
  if (scope === 'group' && groupId) {
    const g = String(groupId);
    const overrides = cfg.cooldownByGroup || {};
    if (typeof overrides[g] === 'number' && overrides[g] >= 0) return Math.min(3600, Math.max(0, overrides[g]));
  }
  if (scope === 'user' || !groupId) {
    const u = String(userId);
    const overrides = cfg.cooldownByUser || {};
    if (typeof overrides[u] === 'number' && overrides[u] >= 0) return Math.min(3600, Math.max(0, overrides[u]));
  }
  return defaultSec;
}

function checkCooldown(groupId, userId) {
  const cfg = pluginState.config;
  const sec = getEffectiveCooldownSeconds(groupId, userId, cfg);
  if (sec <= 0) return { ok: true };
  const key = cfg.cooldownScope === 'group' ? `g:${groupId}` : getConversationKey(groupId, userId);
  const until = cooldownUntil.get(key) || 0;
  const now = Date.now();
  if (now < until) return { ok: false, seconds: Math.ceil((until - now) / 1000) };
  return { ok: true };
}

function setCooldown(groupId, userId) {
  const cfg = pluginState.config;
  const sec = getEffectiveCooldownSeconds(groupId, userId, cfg);
  if (sec <= 0) return;
  const key = cfg.cooldownScope === 'group' ? `g:${groupId}` : getConversationKey(groupId, userId);
  cooldownUntil.set(key, Date.now() + sec * 1000);
}

function shouldHandleGroup(groupId) {
  if (!groupId) return true;
  const cfg = pluginState.config;
  const g = String(groupId);
  if ((cfg.blacklistGroups || []).includes(g)) return false;
  const whitelist = (cfg.whitelistGroups || []).map(String);
  if (whitelist.length > 0 && !whitelist.includes(g)) return false;
  if ((cfg.enableGroups || []).length === 0) return true;
  return (cfg.enableGroups || []).includes(g);
}

function shouldHandleGroupForFakeHuman(groupId) {
  if (!groupId) return false;
  const cfg = pluginState.config;
  const g = String(groupId);
  if ((cfg.blacklistGroups || []).includes(g)) return false;
  const enableList = cfg.fakeHumanEnableGroups || [];
  if (enableList.length === 0) return shouldHandleGroup(groupId);
  return enableList.includes(g);
}

function getFakeHumanChanceForGroup(groupId) {
  const cfg = pluginState.config;
  const g = String(groupId);
  const override = (cfg.fakeHumanGroupChance || {})[g];
  if (override != null && typeof override === 'number') return Math.max(0, Math.min(1, override));
  return Math.max(0, Math.min(1, Number(cfg.fakeHumanChance) ?? 0.05));
}

function shouldHandleUser(userId) {
  const cfg = pluginState.config;
  const u = String(userId);
  if ((cfg.whitelistUsers || []).length) return cfg.whitelistUsers.includes(u);
  if ((cfg.blacklistUsers || []).includes(u)) return false;
  return true;
}

/** 检查用户是否可使用某功能。空列表表示所有人可用。feature: 'chat' | 'imageGen' | 'video' */
function canUseFeature(userId, feature) {
  const cfg = pluginState.config;
  const key = feature === 'imageGen' ? 'imageGenAllowUsers' : feature === 'video' ? 'videoAllowUsers' : 'chatAllowUsers';
  const list = cfg[key];
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.includes(String(userId));
}

function normalizeCompatChatCompletionsUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  const clean = raw.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/compatible-mode\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  try {
    const u = new URL(clean);
    if (!u.pathname || u.pathname === '/') return `${clean}/v1/chat/completions`;
  } catch (_) { /* ignore invalid url */ }
  return clean;
}

function isModelRouteError(status, text) {
  if (status === 429) return false;
  if (status !== 503 && status !== 404 && status !== 400) return false;
  const t = String(text || '').toLowerCase();
  return t.includes('model_not_found') || t.includes('no available channel') || t.includes('model not found');
}

function getApiConfig(options = {}) {
  const cfg = pluginState.config;
  const provider = (options.provider || cfg.apiProvider || 'siliconflow').toLowerCase();
  let apiUrl = '';
  if (provider === 'custom') apiUrl = (cfg.customApiUrl || '').trim();
  let apiKey = '';
  let model = (options.model || cfg.model || '').trim();

  if (provider === 'custom' && apiUrl) {
    apiKey = String(cfg.customApiKey || '').trim();
    if (!model) model = 'gpt-4o';
  } else if (!apiUrl) {
    if (provider === 'deepseek') {
      apiUrl = DEEPSEEK_API;
      apiKey = String(cfg.deepseekApiKey || '').trim();
      if (!model) model = 'deepseek-chat';
      const m = (model || '').toLowerCase();
      if (m.startsWith('deepseek-ai/') || m.includes('deepseek-v3') || m.includes('deepseek-r1') || m.includes('distill-qwen')) {
        model = 'deepseek-chat';
      }
    } else if (provider === 'openai') {
      apiUrl = OPENAI_API;
      apiKey = String(cfg.openaiApiKey || '').trim();
      if (!model) model = 'gpt-3.5-turbo';
    } else if (provider === 'bailian') {
      apiUrl = (cfg.bailianApiUrl || BAILIAN_API).trim() || BAILIAN_API;
      apiKey = String(cfg.bailianApiKey || '').trim();
      if (!model) model = 'qwen3.5-plus';
    } else if (provider === 'codingplan') {
      apiUrl = (cfg.codingPlanApiUrl || CODING_PLAN_API).trim() || CODING_PLAN_API;
      apiKey = String(cfg.codingPlanApiKey || '').trim();
      if (!model) model = 'qwen3.5-plus';
    } else {
      apiUrl = SILICONFLOW_API;
      apiKey = String(cfg.siliconflowApiKey || '').trim();
      if (!model) model = 'deepseek-ai/DeepSeek-V3';
    }
  }
  apiUrl = normalizeCompatChatCompletionsUrl(apiUrl);
  return { apiUrl, apiKey, model, provider };
}

const API_PROVIDERS = ['siliconflow', 'deepseek', 'bailian', 'codingplan', 'openai', 'custom'];

function getProviderDefaultUrl(cfg, provider) {
  const p = String(provider || 'siliconflow').toLowerCase();
  if (p === 'deepseek') return DEEPSEEK_API;
  if (p === 'openai') return OPENAI_API;
  if (p === 'bailian') return (cfg.bailianApiUrl || BAILIAN_API).trim() || BAILIAN_API;
  if (p === 'codingplan') return (cfg.codingPlanApiUrl || CODING_PLAN_API).trim() || CODING_PLAN_API;
  if (p === 'custom') return (cfg.customApiUrl || '').trim();
  return SILICONFLOW_API;
}

function getProviderApiKey(cfg, provider) {
  const p = String(provider || 'siliconflow').toLowerCase();
  if (p === 'deepseek') return String(cfg.deepseekApiKey || '').trim();
  if (p === 'openai') return String(cfg.openaiApiKey || '').trim();
  if (p === 'bailian') return String(cfg.bailianApiKey || '').trim();
  if (p === 'codingplan') return String(cfg.codingPlanApiKey || '').trim();
  if (p === 'custom') return String(cfg.customApiKey || '').trim();
  return String(cfg.siliconflowApiKey || '').trim();
}

function makePoolId(prefix = 'pool') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeApiPool(list) {
  if (!Array.isArray(list)) return [];
  return list.map((raw, i) => {
    const provider = String(raw?.provider || 'custom').toLowerCase();
    return {
      id: String(raw?.id || makePoolId('api')).trim() || makePoolId('api'),
      name: String(raw?.name || `备用端点 ${i + 1}`).trim() || `备用端点 ${i + 1}`,
      enabled: raw?.enabled !== false,
      provider: API_PROVIDERS.includes(provider) ? provider : 'custom',
      apiUrl: String(raw?.apiUrl || '').trim(),
      apiKey: String(raw?.apiKey || '').trim(),
      model: String(raw?.model || '').trim()
    };
  });
}

function normalizeVisionPool(list) {
  if (!Array.isArray(list)) return [];
  return list.map((raw, i) => ({
    id: String(raw?.id || makePoolId('vis')).trim() || makePoolId('vis'),
    name: String(raw?.name || `备用视觉 ${i + 1}`).trim() || `备用视觉 ${i + 1}`,
    enabled: raw?.enabled !== false,
    apiKey: String(raw?.apiKey || '').trim(),
    apiUrl: String(raw?.apiUrl || '').trim(),
    modelsUrl: String(raw?.modelsUrl || '').trim(),
    model: String(raw?.model || KIMI_CODE_DEFAULT_MODEL).trim() || KIMI_CODE_DEFAULT_MODEL,
    kimiCode: raw?.kimiCode !== false
  }));
}

function resolveChatEndpoint(entry, cfg = pluginState.config) {
  const provider = String(entry?.provider || cfg.apiProvider || 'siliconflow').toLowerCase();
  const apiKey = String(entry?.apiKey || '').trim() || getProviderApiKey(cfg, provider);
  let apiUrl = String(entry?.apiUrl || '').trim() || getProviderDefaultUrl(cfg, provider);
  let model = String(entry?.model || '').trim() || String(cfg.model || '').trim();
  if (provider === 'custom' && !model) model = 'gpt-4o';
  if (provider === 'deepseek' && !model) model = 'deepseek-chat';
  if (provider === 'openai' && !model) model = 'gpt-3.5-turbo';
  if (provider === 'bailian' && !model) model = 'qwen3.5-plus';
  if (provider === 'codingplan' && !model) model = 'qwen3.5-plus';
  if (provider === 'siliconflow' && !model) model = 'deepseek-ai/DeepSeek-V3';
  apiUrl = normalizeCompatChatCompletionsUrl(apiUrl);
  return {
    id: entry?.id || 'primary',
    name: entry?.name || '主配置',
    enabled: entry?.enabled !== false,
    provider: API_PROVIDERS.includes(provider) ? provider : 'custom',
    apiUrl,
    apiKey,
    model,
    isPrimary: !!entry?.isPrimary
  };
}

function resolveVisionEndpoint(entry, cfg = pluginState.config) {
  const apiKey = String(entry?.apiKey || '').trim() || String(cfg.kimiVisionApiKey || '').trim();
  const apiUrl = normalizeCompatChatCompletionsUrl(
    String(entry?.apiUrl || '').trim() || String(cfg.kimiVisionApiUrl || KIMI_CODE_API).trim() || KIMI_CODE_API
  );
  const modelsUrl = String(entry?.modelsUrl || '').trim() || String(cfg.kimiVisionModelsUrl || KIMI_CODE_MODELS_API).trim() || KIMI_CODE_MODELS_API;
  const model = String(entry?.model || '').trim() || String(cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim() || KIMI_CODE_DEFAULT_MODEL;
  const kimiCode = entry?.kimiCode !== false && /api\.kimi\.com\/coding/i.test(apiUrl);
  return {
    id: entry?.id || 'vision-primary',
    name: entry?.name || '主视觉配置',
    enabled: entry?.enabled !== false,
    apiKey,
    apiUrl,
    modelsUrl,
    model,
    kimiCode,
    isPrimary: !!entry?.isPrimary
  };
}

function buildChatEndpointList(cfg = pluginState.config) {
  const settings = getChatFailoverSettings(cfg);
  const primary = resolveChatEndpoint({
    id: 'primary',
    name: '主配置',
    enabled: true,
    provider: cfg.apiProvider,
    model: cfg.model,
    isPrimary: true
  }, cfg);
  const list = [];
  if (primary.apiKey) list.push(primary);
  if (settings.enabled && Array.isArray(cfg.apiPool)) {
    for (const raw of cfg.apiPool) {
      if (!raw?.enabled) continue;
      const resolved = resolveChatEndpoint(raw, cfg);
      if (!resolved.apiKey) continue;
      if (list.some((e) => e.apiUrl === resolved.apiUrl && e.apiKey === resolved.apiKey && e.model === resolved.model)) continue;
      list.push(resolved);
    }
  }
  return list.slice(0, settings.maxEndpoints);
}

function buildVisionEndpointList(cfg = pluginState.config) {
  const settings = getVisionFailoverSettings(cfg);
  const primary = resolveVisionEndpoint({ id: 'vision-primary', name: '主视觉配置', isPrimary: true }, cfg);
  const list = [];
  if (primary.apiKey) list.push(primary);
  if (settings.enabled && Array.isArray(cfg.visionPool)) {
    for (const raw of cfg.visionPool) {
      if (!raw?.enabled) continue;
      const resolved = resolveVisionEndpoint(raw, cfg);
      if (!resolved.apiKey) continue;
      if (list.some((e) => e.apiUrl === resolved.apiUrl && e.apiKey === resolved.apiKey && e.model === resolved.model)) continue;
      list.push(resolved);
    }
  }
  return list.slice(0, settings.maxEndpoints);
}

function getChatFailoverSettings(cfg = pluginState.config) {
  return {
    enabled: Boolean(cfg.apiFailoverEnabled),
    retries: Math.max(1, Math.min(10, Number(cfg.apiFailoverRetries) || 2)),
    maxEndpoints: Math.max(1, Math.min(20, Number(cfg.apiFailoverMaxEndpoints) || 5)),
    timeoutMs: Math.max(3000, Math.min(300000, Number(cfg.apiFailoverTimeoutMs) || 90000)),
    retryDelayMs: Math.max(0, Math.min(30000, Number(cfg.apiFailoverRetryDelayMs) || 1200)),
    onAuth: cfg.apiFailoverOnAuth !== false,
    onRateLimit: cfg.apiFailoverOnRateLimit !== false,
    onServerError: cfg.apiFailoverOnServerError !== false,
    onTimeout: cfg.apiFailoverOnTimeout !== false,
    onNetwork: cfg.apiFailoverOnNetwork !== false
  };
}

function getVisionFailoverSettings(cfg = pluginState.config) {
  return {
    enabled: Boolean(cfg.visionFailoverEnabled),
    retries: Math.max(1, Math.min(10, Number(cfg.visionFailoverRetries) || 2)),
    maxEndpoints: Math.max(1, Math.min(20, Number(cfg.visionFailoverMaxEndpoints) || 4)),
    timeoutMs: Math.max(3000, Math.min(300000, Number(cfg.visionFailoverTimeoutMs) || 60000)),
    retryDelayMs: Math.max(0, Math.min(30000, Number(cfg.visionFailoverRetryDelayMs) || 1000)),
    onAuth: cfg.visionFailoverOnAuth !== false,
    onRateLimit: cfg.visionFailoverOnRateLimit !== false,
    onServerError: cfg.visionFailoverOnServerError !== false,
    onTimeout: cfg.visionFailoverOnTimeout !== false,
    onNetwork: cfg.visionFailoverOnNetwork !== false
  };
}

function shouldRotateApiFailure(status, text, err, settings) {
  if (err?.code === 'TIMEOUT' || err?.message === 'TIMEOUT') return settings.onTimeout;
  if (err && (err.name === 'TypeError' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED')) return settings.onNetwork;
  if (status === 401 || status === 403) return settings.onAuth;
  if (status === 429) return settings.onRateLimit;
  if (status >= 500) return settings.onServerError;
  if (isTransientApiError(status, text)) return settings.onServerError;
  if (isModelRouteError(status, text)) return true;
  return false;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const ms = Math.max(1000, Math.min(300000, Number(timeoutMs) || 60000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error('TIMEOUT');
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function visionHeadersForEndpoint(endpoint, extra = {}) {
  if (endpoint?.kimiCode) {
    const cfg = { ...pluginState.config, kimiVisionApiKey: endpoint.apiKey };
    return kimiCodeRequestHeaders(cfg, extra);
  }
  const headers = { ...extra };
  if (endpoint?.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
  return headers;
}

/** Serper 联网搜索，返回摘要文本，失败返回空字符串 */
async function serperSearch(query, apiKey) {
  if (!query || !apiKey || !apiKey.trim()) return '';
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey.trim()
      },
      body: JSON.stringify({ q: String(query).slice(0, 200) })
    });
    if (!res.ok) return '';
    const data = await res.json();
    const organic = data?.organic || [];
    const snippets = organic.slice(0, 5).map((o) => (o.snippet || o.title || '').trim()).filter(Boolean);
    return snippets.join('\n\n');
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] Serper 搜索失败: ' + e.message);
    return '';
  }
}

/** DuckDuckGo Instant Answer API，无需 API Key，返回摘要文本 */
async function duckDuckGoSearch(query) {
  if (!query || !String(query).trim()) return '';
  const cleanText = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  const uniqPush = (arr, text) => {
    const t = cleanText(text);
    if (!t) return;
    if (!arr.includes(t)) arr.push(t);
  };
  try {
    const q = String(query).trim().slice(0, 200);
    const url = `${DUCKDUCKGO_API}?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1&kl=cn-zh`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const data = await res.json();
    const parts = [];
    if (data.AbstractText && data.AbstractText.trim()) uniqPush(parts, data.AbstractText);
    const related = data.RelatedTopics || [];
    for (const t of related.slice(0, 8)) {
      const text = t.Text || (t.Topics && t.Topics[0] && t.Topics[0].Text);
      uniqPush(parts, text);
    }
    const results = data.Results || [];
    for (const r of results.slice(0, 5)) {
      uniqPush(parts, r.Result || r.Body || r.Text || '');
    }
    if (parts.length > 0) return parts.join('\n\n');

    // Instant Answer 对长尾/中文问题命中率低，补一次 HTML 搜索结果抓取
    const htmlRes = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
      }
    });
    if (!htmlRes.ok) return '';
    const html = await htmlRes.text();
    const htmlParts = [];
    const snippetMatches = html.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>|<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    for (const m of snippetMatches.slice(0, 12)) {
      uniqPush(htmlParts, m);
    }
    return htmlParts.join('\n\n');
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] DuckDuckGo 搜索失败: ' + e.message);
    return '';
  }
}

/** UAPI 智能搜索（uapis.cn aggregate），返回摘要文本 */
async function uapiAggregateSearch(query, apiKey, options = {}) {
  if (!query || !String(query).trim() || !apiKey || !apiKey.trim()) return '';
  const timeout = Math.max(1000, Math.min(30000, Number(options.timeout_ms) || Number(pluginState.config?.uapiSearchTimeoutMs) || 10000));
  try {
    log('info', 'UAPI 智能搜索请求', { query: String(query).slice(0, 100), timeout_ms: timeout });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const body = {
      query: String(query).trim().slice(0, 500),
      fetch_full: false,
      timeout_ms: timeout
    };
    if (options.sort != null && String(options.sort).trim()) body.sort = String(options.sort).trim();
    if (options.time_range != null && String(options.time_range).trim()) body.time_range = String(options.time_range).trim();
    const res = await fetch(UAPI_SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) {
      const errBody = await res.text();
      log('warn', 'UAPI 搜索 API 非 200', { status: res.status, body: errBody.slice(0, 200) });
      return '';
    }
    const data = await res.json();
    const results = data?.results || [];
    const processTime = data?.process_time_ms;
    const totalResults = data?.total_results;
    log('info', 'UAPI 智能搜索完成', { total_results: totalResults, results_count: results.length, process_time_ms: processTime });
    const snippets = results.slice(0, 8).map((r) => [r.title, r.snippet].filter(Boolean).join(': ')).filter(Boolean);
    return snippets.join('\n\n');
  } catch (e) {
    log('warn', 'UAPI 智能搜索失败', e.message);
    return '';
  }
}

/** Tavily Search API（AI Agent 优化），返回摘要文本 */
async function tavilySearch(query, apiKey, options = {}) {
  if (!query || !String(query).trim() || !apiKey || !apiKey.trim()) return '';
  try {
    log('info', 'Tavily 搜索请求', { query: String(query).slice(0, 80) }, 'search');
    const res = await fetch(TAVILY_SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey.trim(),
        query: String(query).trim().slice(0, 500),
        search_depth: options.search_depth || 'basic',
        max_results: Math.min(20, Math.max(1, options.max_results || 10)),
        include_answer: options.include_answer !== false
      })
    });
    if (!res.ok) return '';
    const data = await res.json();
    const parts = [];
    if (data.answer && String(data.answer).trim()) parts.push(String(data.answer).trim());
    const results = data.results || [];
    for (const r of results.slice(0, 10)) {
      const c = (r.content || r.title || '').trim();
      if (c) parts.push(c);
    }
    const out = parts.join('\n\n');
    if (out) log('info', 'Tavily 搜索完成', { resultsCount: results.length }, 'search');
    return out;
  } catch (e) {
    log('warn', 'Tavily 搜索失败', e.message);
    return '';
  }
}

/** 博查 Web Search API，返回摘要文本 */
async function bochaWebSearch(query, apiKey, options = {}) {
  if (!query || !String(query).trim() || !apiKey || !apiKey.trim()) return '';
  try {
    log('info', '博查 搜索请求', { query: String(query).slice(0, 80) });
    const res = await fetch(BOCHA_WEB_SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        query: String(query).trim().slice(0, 500),
        freshness: options.freshness || 'noLimit',
        summary: options.summary !== false,
        count: Math.min(50, Math.max(1, options.count || 10))
      })
    });
    if (!res.ok) return '';
    const data = await res.json();
    const list = data?.data?.webPages?.value || [];
    const parts = list.slice(0, 10).map((p) => [p.name, p.snippet || p.summary].filter(Boolean).join(': ')).filter(Boolean);
    const out = parts.join('\n\n');
    if (out) log('info', '博查 搜索完成', { count: list.length });
    return out;
  } catch (e) {
    log('warn', '博查 搜索失败', e.message);
    return '';
  }
}

/** 百度 AI 搜索（千帆 AppBuilder），返回总结 + 引用摘要 */
async function baiduAiSearch(query, apiKey, options = {}) {
  if (!query || !String(query).trim() || !apiKey || !apiKey.trim()) return '';
  try {
    log('info', '百度 AI 搜索请求', { query: String(query).slice(0, 80) });
    const res = await fetch(BAIDU_AI_SEARCH_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: options.model || 'ernie-3.5-8k',
        messages: [{ role: 'user', content: String(query).trim().slice(0, 500) }],
        stream: false
      })
    });
    if (!res.ok) return '';
    const data = await res.json();
    const parts = [];
    const content = data?.choices?.[0]?.message?.content;
    if (content && String(content).trim()) parts.push(String(content).trim());
    const refs = data.references || [];
    for (const r of refs.slice(0, 8)) {
      const t = (r.title || '').trim();
      const c = (r.content || r.snippet || '').trim();
      if (t || c) parts.push((t ? t + ': ' : '') + c);
    }
    const out = parts.join('\n\n');
    if (out) log('info', '百度 AI 搜索完成', { refsCount: refs.length });
    return out;
  } catch (e) {
    log('warn', '百度 AI 搜索失败', e.message);
    return '';
  }
}

/** 阿里云 IQS UnifiedSearch（需 AK/SK，此处为占位；正式使用需接入 SDK 或签名） */
async function aliyunUnifiedSearch(query, accessKeyId, accessKeySecret, options = {}) {
  if (!query || !String(query).trim() || !accessKeyId || !accessKeySecret) return '';
  try {
    log('info', '阿里云 IQS 搜索请求', { query: String(query).slice(0, 80) });
    const body = {
      query: String(query).trim().slice(0, 500),
      time_range: options.time_range || 'NoLimit',
      engine_type: options.engine_type || 'Generic',
      contents: { main_text: true, rerank_score: true }
    };
    const res = await fetch(`${ALIYUN_IQS_API}/UnifiedSearch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return '';
    const data = await res.json();
    const items = data.pageItems || data.page_items || [];
    const parts = items.slice(0, 10).map((p) => [p.title, p.snippet || p.summary || p.main_text].filter(Boolean).join(': ')).filter(Boolean);
    const out = parts.join('\n\n');
    if (out) log('info', '阿里云 IQS 搜索完成', { count: items.length });
    return out;
  } catch (e) {
    log('warn', '阿里云 IQS 搜索失败（若未配置签名可能不可用）', e.message);
    return '';
  }
}

/** 使用 AI 根据用户输入和上下文生成一条搜索关键词（用于智能搜索） */
async function aiGenerateSearchQuery(userMessage, historySummary) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return null;
  const systemPrompt = '你是一个搜索关键词提取助手。根据用户当前的问题和简要上下文，输出一条简短的中文或英文搜索关键词（不超过 15 个词），用于联网搜索以辅助回答。不要解释，只输出关键词本身，不要引号。若无法提炼出有效搜索需求，输出空。';
  const context = historySummary ? `近期对话摘要：${historySummary.slice(0, 200)}。` : '';
  const userPrompt = `${context}用户当前问题：${String(userMessage).slice(0, 300)}`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 80
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = (data?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 200);
    return q || null;
  } catch (e) {
    log('warn', 'AI 生成搜索词失败', e.message);
    return null;
  }
}

/** 使用 AI 生成最多 3 条搜索关键词（用于三路联合搜索） */
async function aiGenerateSearchQueries(userMessage, historySummary) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return [];
  const systemPrompt = '你是一个搜索关键词提取助手。根据用户当前的问题和简要上下文，输出 1～3 条简短的中文或英文搜索关键词（每条不超过 15 个词），用于联网搜索以多角度辅助回答。每行一条关键词，不要编号、不要引号、不要解释。若无法提炼出有效搜索需求，输出空。';
  const context = historySummary ? `近期对话摘要：${historySummary.slice(0, 200)}。` : '';
  const userPrompt = `${context}用户当前问题：${String(userMessage).slice(0, 300)}`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 120
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    const lines = text.split(/\n/).map((s) => s.replace(/^["'\d.)\s]+|["']+$/g, '').trim()).filter((s) => s.length > 0 && s.length <= 200);
    const queries = lines.slice(0, 3);
    if (queries.length) log('info', 'AI 生成多路搜索词', { count: queries.length, queries }, 'search');
    return queries;
  } catch (e) {
    log('warn', 'AI 生成多路搜索词失败', e.message);
    return [];
  }
}

/** 多渠道联网搜索：支持 Serper / DuckDuckGo / UAPI / Tavily / 博查 / 百度 / 阿里云 及 集合模式 */
async function webSearchMulti(query, cfg) {
  const provider = normalizeWebSearchProvider(cfg.webSearchProvider);
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return '';

  const results = [];
  const runDuck = () => duckDuckGoSearch(q);
  const runSerper = () => (cfg.serperApiKey ? serperSearch(q, (cfg.serperApiKey || '').trim()) : Promise.resolve(''));
  const runUapi = () => (cfg.uapiApiKey ? uapiAggregateSearch(q, (cfg.uapiApiKey || '').trim(), { timeout_ms: cfg.uapiSearchTimeoutMs, sort: cfg.uapiSort, time_range: cfg.uapiTimeRange }) : Promise.resolve(''));
  const runTavily = () => (cfg.tavilyApiKey ? tavilySearch(q, (cfg.tavilyApiKey || '').trim()) : Promise.resolve(''));
  const runBocha = () => (cfg.bochaApiKey ? bochaWebSearch(q, (cfg.bochaApiKey || '').trim()) : Promise.resolve(''));
  const runBaidu = () => (cfg.baiduSearchApiKey ? baiduAiSearch(q, (cfg.baiduSearchApiKey || '').trim()) : Promise.resolve(''));
  const runAliyun = () => (cfg.aliyunIqsAccessKeyId && cfg.aliyunIqsAccessKeySecret ? aliyunUnifiedSearch(q, (cfg.aliyunIqsAccessKeyId || '').trim(), (cfg.aliyunIqsAccessKeySecret || '').trim()) : Promise.resolve(''));

  if (provider === 'all') {
    const [d, s, u, t, b, bd, ay] = await Promise.all([runDuck(), runSerper(), runUapi(), runTavily(), runBocha(), runBaidu(), runAliyun()]);
    if (d) results.push({ source: 'DuckDuckGo', text: d });
    if (s) results.push({ source: 'Serper', text: s });
    if (u) results.push({ source: 'UAPI', text: u });
    if (t) results.push({ source: 'Tavily', text: t });
    if (b) results.push({ source: '博查', text: b });
    if (bd) results.push({ source: '百度AI搜索', text: bd });
    if (ay) results.push({ source: '阿里云IQS', text: ay });
  } else if (provider === 'tavily') {
    const t = await runTavily();
    if (t) results.push({ source: 'Tavily', text: t });
  } else if (provider === 'bocha') {
    const b = await runBocha();
    if (b) results.push({ source: '博查', text: b });
  } else if (provider === 'baidu') {
    const bd = await runBaidu();
    if (bd) results.push({ source: '百度AI搜索', text: bd });
  } else if (provider === 'aliyun') {
    const ay = await runAliyun();
    if (ay) results.push({ source: '阿里云IQS', text: ay });
  } else if (provider === 'tsu') {
    const [t, s, u] = await Promise.all([runTavily(), runSerper(), runUapi()]);
    if (t) results.push({ source: 'Tavily', text: t });
    if (s) results.push({ source: 'Serper', text: s });
    if (u) results.push({ source: 'UAPI', text: u });
  } else {
    if (provider === 'serper' || provider === 'both' || provider === 'three') {
      const s = await runSerper();
      if (s) results.push({ source: 'Serper', text: s });
    }
    if (provider === 'duckduckgo' || provider === 'both' || provider === 'three') {
      const d = await runDuck();
      if (d) results.push({ source: 'DuckDuckGo', text: d });
    }
    if (provider === 'uapi' || provider === 'three') {
      const u = await runUapi();
      if (u) results.push({ source: 'UAPI', text: u });
    }
  }

  if (results.length === 0) return '';
  const combined = results.map((r) => `【${r.source}】\n${r.text}`).join('\n\n---\n\n');
  return combined;
}

async function chatCompletionOnEndpoint(messages, options, endpoint, settings) {
  const cfg = pluginState.config;
  if (!endpoint?.apiKey) throw new Error('NO_KEY');
  const temperature = Math.max(0, Math.min(2, Number(cfg.temperature) ?? 0.7));
  const maxTokens = Math.max(100, Math.min(32768, Number(cfg.maxTokens) ?? 8192));
  const topP = Math.max(0, Math.min(1, Number(cfg.top_p) ?? 0.95));
  const topK = Math.max(1, Math.min(100, Number(cfg.top_k) ?? 20));
  const freqPenalty = Math.max(-2, Math.min(2, Number(cfg.frequency_penalty) ?? 0));
  const presPenalty = Math.max(-2, Math.min(2, Number(cfg.presence_penalty) ?? 0));
  const stop = cfg.stop != null && (Array.isArray(cfg.stop) ? cfg.stop.length > 0 : String(cfg.stop).trim()) ? (Array.isArray(cfg.stop) ? cfg.stop : [String(cfg.stop).trim()]) : undefined;
  const enableThinking = Boolean(cfg.enableThinking);
  const thinkingBudget = Math.max(0, Math.min(65536, Number(cfg.thinkingBudget) ?? 4096));
  const provider = String(endpoint.provider || cfg.apiProvider || 'siliconflow').toLowerCase();
  const baseModel = options.model || endpoint.model || 'deepseek-ai/DeepSeek-V3';
  const retries = settings.enabled ? settings.retries : 1;

  async function doRequest(useModel) {
    const body = {
      model: useModel,
      messages,
      stream: false,
      temperature: options.temperature ?? temperature,
      max_tokens: options.max_tokens ?? maxTokens,
      top_p: options.top_p ?? topP,
      top_k: options.top_k ?? topK,
      frequency_penalty: options.frequency_penalty ?? freqPenalty,
      presence_penalty: options.presence_penalty ?? presPenalty
    };
    if (stop && stop.length) body.stop = stop;
    if (enableThinking && provider === 'siliconflow') {
      body.extra_body = body.extra_body || {};
      body.extra_body.thinking_budget = options.thinking_budget ?? thinkingBudget;
    }

    log('info', '调用对话 API', {
      endpoint: endpoint.name,
      model: useModel,
      provider,
      messagesCount: messages.length,
      max_tokens: maxTokens
    }, 'api');

    let res;
    let text = '';
    try {
      res = await fetchWithTimeout(endpoint.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${endpoint.apiKey}`
        },
        body: JSON.stringify(body)
      }, settings.timeoutMs);
      text = await res.text();
    } catch (e) {
      log('warn', '对话 API 请求异常', { endpoint: endpoint.name, err: e.message }, 'api');
      return { ok: false, status: 0, text: e.message, error: e };
    }

    const status = res.status;
    if (!res.ok) {
      log('warn', '对话 API 错误', { endpoint: endpoint.name, status, body: text.slice(0, 300) }, 'api');
      return { ok: false, status, text };
    }

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      log('warn', '对话 API 响应 JSON 解析失败', e.message, 'api');
      return { ok: false, status: 500, text };
    }
    const content = data?.choices?.[0]?.message?.content?.trim() || '';
    const usage = data?.usage;
    if (usage && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
      recordTokenUsage(options.usageKey, usage.prompt_tokens || 0, usage.completion_tokens || 0, useModel);
      log('info', 'Token 使用', { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens, model: useModel, endpoint: endpoint.name }, 'token');
    }
    return { ok: true, content, usage };
  }

  let last = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const first = await doRequest(baseModel);
    if (first.ok) return { ok: true, content: first.content, usage: first.usage };
    last = first;

    const modelRouteErr = isModelRouteError(first.status, first.text);
    const transientErr = isTransientApiError(first.status, first.text) || first.error?.code === 'TIMEOUT';
    const shouldRetryModels = first.status === 429 || modelRouteErr || transientErr;

    if (transientErr && !modelRouteErr && attempt < retries) {
      log('warn', '对话 API 临时错误，将重试', { endpoint: endpoint.name, status: first.status, attempt }, 'api');
      await sleep(settings.retryDelayMs || 1500);
      continue;
    }

    if (shouldRetryModels) {
      const visionExtra = options.hasVision ? getVisionFallbackModels(cfg) : [];
      const genericFallback = options.hasVision ? [] : getFallbackModelCandidates(cfg, provider, baseModel);
      const candidates = normalizeModelList([...visionExtra, ...genericFallback]).filter((m) => m !== baseModel);
      for (const fallbackModel of candidates) {
        const reason = first.status === 429 ? '429' : transientErr ? 'transient' : 'model_route';
        log('info', '切换备用模型重试', { endpoint: endpoint.name, from: baseModel, to: fallbackModel, provider, reason }, 'model');
        const retry = await doRequest(fallbackModel);
        if (retry.ok) return { ok: true, content: retry.content, usage: retry.usage };
        last = retry;
        if (first.status === 429 && retry.status !== 429) break;
        if (!isModelRouteError(retry.status, retry.text) && !isTransientApiError(retry.status, retry.text) && first.status !== 429) break;
      }
      if (first.status === 429) return { ok: false, status: 429, text: resolveTemplate(pluginState.config, 'rateLimit', {}) };
    }

    if (!settings.enabled || !shouldRotateApiFailure(first.status, first.text, first.error, settings)) {
      throw new Error(`API ${first.status || first.error?.message || 'error'}`);
    }
    if (attempt < retries) {
      await sleep(settings.retryDelayMs);
      continue;
    }
    break;
  }

  if (last?.status === 429) return { ok: false, status: 429, text: resolveTemplate(pluginState.config, 'rateLimit', {}) };
  throw new Error(`API ${last?.status || last?.error?.message || 'error'}`);
}

async function chatCompletion(messages, options = {}) {
  const cfg = pluginState.config;
  const settings = getChatFailoverSettings(cfg);
  const endpoints = buildChatEndpointList(cfg);
  if (!endpoints.length) throw new Error('NO_KEY');

  if (!settings.enabled || endpoints.length <= 1) {
    return chatCompletionOnEndpoint(messages, options, endpoints[0], settings);
  }

  let lastErr = null;
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    try {
      return await chatCompletionOnEndpoint(messages, options, endpoint, settings);
    } catch (err) {
      lastErr = err;
      log('warn', '对话端点失败', { endpoint: endpoint.name, message: err.message }, 'api');
      if (i < endpoints.length - 1) {
        log('info', '切换下一对话 API 端点', { from: endpoint.name, to: endpoints[i + 1]?.name }, 'api');
        await sleep(settings.retryDelayMs);
      }
    }
  }
  throw lastErr || new Error('API_FAILOVER_EXHAUSTED');
}

function formatReply(template, vars) {
  let s = String(template || '');
  for (const [k, v] of Object.entries(vars || {})) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return s;
}

function normalizeGroupItem(raw) {
  const groupId = String(raw?.group_id ?? raw?.groupId ?? '').trim();
  const groupName = String(raw?.group_name ?? raw?.name ?? '').trim();
  const memberCount = Number(raw?.member_count ?? raw?.memberCount ?? 0) || 0;
  return { groupId, groupName, memberCount };
}

async function fetchStrangerProfile(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const res = await callAction('get_stranger_info', { user_id: uid });
    const data = res?.data ?? res ?? {};
    return {
      userId: uid,
      nickname: String(data.nickname ?? data.nick ?? data.nick_name ?? '').trim(),
      avatar: String(data.avatar ?? data.avatar_url ?? data.head_url ?? '').trim(),
      sex: data.sex,
      age: data.age
    };
  } catch (e) {
    log('debug', '获取用户信息失败', { userId: uid, err: e.message }, 'config');
    return { userId: uid, nickname: '', avatar: '' };
  }
}

async function fetchGroupProfile(groupId) {
  const gid = String(groupId || '').trim();
  if (!gid) return null;
  try {
    const res = await callAction('get_group_info', { group_id: gid });
    const data = res?.data ?? res ?? {};
    return {
      groupId: gid,
      groupName: String(data.group_name ?? data.name ?? '').trim(),
      memberCount: Number(data.member_count ?? data.memberCount ?? 0) || 0
    };
  } catch (e) {
    log('debug', '获取群信息失败', { groupId: gid, err: e.message }, 'config');
    return { groupId: gid, groupName: '', memberCount: 0 };
  }
}

async function searchUsersByQuery(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const matches = [];
  const seen = new Set();

  if (/^\d{5,12}$/.test(q)) {
    const info = await fetchStrangerProfile(q);
    if (info) {
      matches.push(info);
      seen.add(info.userId);
    }
  }

  const lq = q.toLowerCase();
  for (const item of getConversationsList()) {
    const uid = String(item.userId || '').trim();
    if (!uid || seen.has(uid)) continue;
    const hay = [uid, item.userName, item.groupName].join(' ').toLowerCase();
    if (hay.includes(lq)) {
      seen.add(uid);
      matches.push({
        userId: uid,
        nickname: item.userName || '',
        avatar: '',
        fromConversation: true,
        groupName: item.groupName || ''
      });
    }
    if (matches.length >= limit) return matches;
  }

  if (/^\d+$/.test(q) && q.length >= 3 && !seen.has(q)) {
    const info = await fetchStrangerProfile(q);
    if (info && !seen.has(info.userId)) matches.push(info);
  }

  return matches.slice(0, limit);
}

async function searchGroupsByQuery(query, limit = 24) {
  const q = String(query || '').trim().toLowerCase();
  let list = [];
  try {
    const raw = await callAction('get_group_list', {});
    list = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
  } catch {
    return [];
  }
  const normalized = list.map(normalizeGroupItem).filter((g) => g.groupId);
  if (!q) return normalized.slice(0, limit);
  return normalized.filter((g) => g.groupId.includes(q) || (g.groupName || '').toLowerCase().includes(q)).slice(0, limit);
}

function touchUserProfileCache(cfg, profile) {
  if (!profile?.userId) return;
  if (!cfg.userProfileCache) cfg.userProfileCache = {};
  cfg.userProfileCache[String(profile.userId)] = {
    nickname: profile.nickname || '',
    avatar: profile.avatar || '',
    updatedAt: Date.now()
  };
}

function touchGroupProfileCache(cfg, profile) {
  if (!profile?.groupId) return;
  if (!cfg.groupProfileCache) cfg.groupProfileCache = {};
  cfg.groupProfileCache[String(profile.groupId)] = {
    groupName: profile.groupName || '',
    memberCount: profile.memberCount || 0,
    updatedAt: Date.now()
  };
}

async function callAction(actionName, params) {
  const { actions, adapterName, pluginManager } = pluginState;
  if (!actions) throw new Error('插件未就绪');
  return await actions.call(actionName, params, adapterName, pluginManager?.config);
}

function getEventMessageId(event) {
  const id = event?.message_id ?? event?.message?.id ?? event?.message?.message_id;
  return id != null ? id : null;
}

async function setMessageEmojiLike(messageId, emojiId, set = true) {
  if (messageId == null || !emojiId) return false;
  try {
    await callAction('set_msg_emoji_like', {
      message_id: messageId,
      emoji_id: String(emojiId),
      set: !!set
    });
    log('debug', '表情回应已设置', { messageId, emojiId, set }, 'reaction');
    return true;
  } catch (e) {
    log('warn', '设置表情回应失败', { messageId, emojiId, err: e.message }, 'reaction');
    return false;
  }
}

function normalizeReactionCatalog(raw) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_REACTION_EMOJIS;
  return raw.map((item) => ({
    id: String(item.id ?? '').trim(),
    name: String(item.name || item.id || '').trim(),
    type: String(item.type || '1'),
    glyph: String(item.glyph || item.name || item.id || '?').slice(0, 4)
  })).filter((x) => x.id);
}

/** 思考阶段：发文字提示和/或在用户消息上贴表情回应 */
async function applyThinkingIndicator(ctx, cfg, event, isGroup, groupId, userId) {
  if (!cfg.thinkingIndicatorEnabled) return;
  const mode = String(cfg.thinkingIndicatorMode || 'message').toLowerCase();
  if (mode === 'silent' || mode === 'none') return;
  const msgId = getEventMessageId(event);
  if (mode === 'message' || mode === 'both') {
    const text = resolveTemplate(cfg, 'thinking', { user_id: userId }).trim();
    if (text) {
      const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
      if (isGroup) await sendGroup(ctx, groupId, prefix + text);
      else await sendPrivate(ctx, userId, text);
    }
  }
  if ((mode === 'emoji' || mode === 'both') && msgId) {
    await setMessageEmojiLike(msgId, cfg.thinkingEmojiId || '311', true);
  }
}

/** 回答后：移除思考表情、贴新表情回应 */
async function applyAfterReplyReaction(cfg, messageId) {
  if (!messageId) return;
  const thinkingId = String(cfg.thinkingEmojiId || '311').trim();
  if (cfg.thinkingIndicatorEnabled && cfg.afterReplyRemoveThinkingEmoji !== false && thinkingId) {
    await setMessageEmojiLike(messageId, thinkingId, false);
  }
  if (cfg.afterReplyReactionEnabled) {
    const afterId = String(cfg.afterReplyEmojiId || '').trim();
    const mode = String(cfg.afterReplyEmojiMode || 'replace').toLowerCase();
    if (mode === 'remove_only') return;
    if (afterId) await setMessageEmojiLike(messageId, afterId, true);
  }
}

async function sendGroup(ctx, groupId, message) {
  try {
    await callAction('send_group_msg', { group_id: String(groupId), message: String(message) });
  } catch (e) {
    pluginState.logger?.error?.('[chat-bot] 发送群消息失败: ' + e.message);
  }
}

/** 发送群回复（回复某条消息，message 为 array 时 type 含 reply） */
async function sendGroupReply(ctx, groupId, replyMessageId, text) {
  try {
    const message = replyMessageId != null
      ? [{ type: 'reply', data: { id: String(replyMessageId) } }, { type: 'text', data: { text: String(text || '') } }]
      : [{ type: 'text', data: { text: String(text || '') } }];
    await callAction('send_group_msg', { group_id: String(groupId), message });
    log('info', '已发送群回复', { groupId, replyMessageId });
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] 发送群回复失败: ' + e.message);
  }
}

/** 发送群消息数组（可含 reply + 其他 segment，如 face） */
async function sendGroupMessageArray(ctx, groupId, replyMessageId, segments) {
  try {
    const message = [];
    if (replyMessageId != null) message.push({ type: 'reply', data: { id: String(replyMessageId) } });
    message.push(...segments);
    if (!message.length) return;
    await callAction('send_group_msg', { group_id: String(groupId), message });
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] 发送群消息数组失败: ' + e.message);
  }
}

async function sendPrivate(ctx, userId, message) {
  try {
    await callAction('send_private_msg', { user_id: String(userId), message: String(message) });
  } catch (e) {
    pluginState.logger?.error?.('[chat-bot] 发送私聊失败: ' + e.message);
  }
}

/** 群内戳一戳（NapCat: group_poke，target_id 为被戳者；或 send_group_poke） */
async function sendGroupPoke(ctx, groupId, targetUserId) {
  const g = String(groupId);
  const t = String(targetUserId);
  try {
    await callAction('group_poke', { group_id: g, user_id: t, target_id: t });
    log('info', '已发送戳一戳', { groupId: g, targetUserId: t });
  } catch (e1) {
    try {
      await callAction('send_group_poke', { group_id: g, user_id: t });
      log('info', '已发送戳一戳', { groupId: g, targetUserId: t });
    } catch (e2) {
      pluginState.logger?.warn?.('[chat-bot] 戳一戳失败: ' + (e2.message || e1.message));
    }
  }
}

/** AI 决定是否戳一戳：根据用户消息与回复内容返回 true/false */
async function aiDecidePoke(userText, replyText) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return Math.random() < 0.5;
  const systemPrompt = '你是一个互动助手。根据「用户说了什么」和「助手的回复内容与语气」，判断是否适合对用户做一个轻量的戳一戳互动（表示友好、提醒、调侃等）。只输出 0 或 1，0 表示不戳，1 表示戳。不要其他文字。';
  const userPrompt = `用户说：${String(userText).slice(0, 200)}\n\n助手回复：${String(replyText).slice(0, 300)}\n\n是否戳一戳？只输出 0 或 1：`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 5
      })
    });
    if (!res.ok) return Math.random() < 0.5;
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim().replace(/\D/g, '');
    if (text.includes('1')) {
      log('info', 'AI 决定戳一戳');
      return true;
    }
  } catch (e) {
    log('warn', 'AI 戳一戳决策失败，不戳', e.message);
  }
  return false;
}

/** 使用 AI 根据用户消息与回复内容，从 0 到 totalCount-1 中选一个最合适发送的表情编号；强调随机分散避免总选同一编号 */
async function aiPickStickerIndex(userText, replyText, totalCount) {
  if (totalCount <= 0) return 0;
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return Math.floor(Math.random() * totalCount);
  const systemPrompt = `你是表情选择助手。从 0 到 ${totalCount - 1} 中选一个整数作为表情编号。你无法看到表情样子，请根据「用户说了什么」和「助手回复的语气」判断氛围（友好/搞笑/安慰/无语等），选一个最贴合的编号。重要：每次选择要多样，不要总选同一个数字，可以随机分散在不同编号。只输出一个 0～${totalCount - 1} 的整数，不要其他文字。`;
  const userPrompt = `用户说：${String(userText).slice(0, 200)}\n\n助手回复：${String(replyText).slice(0, 300)}\n\n请输出一个 0～${totalCount - 1} 的整数（根据氛围选，可随机）：`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        temperature: 0.9,
        max_tokens: 10
      })
    });
    if (!res.ok) return Math.floor(Math.random() * totalCount);
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim().replace(/\D/g, '');
    const num = parseInt(text, 10);
    if (!isNaN(num) && num >= 0 && num < totalCount) {
      log('info', 'AI 选择表情编号', { index: num, total: totalCount }, 'sticker');
      return num;
    }
  } catch (e) {
    log('warn', 'AI 选择表情失败，改用随机', e.message);
  }
  return Math.floor(Math.random() * totalCount);
}

/** 解析单条收藏表情 */
function parseCustomFaceItem(item) {
  if (item == null) return null;
  if (typeof item === 'object') {
    const id = item.id ?? item.face_id ?? item.faceId ?? item.resId ?? item.res_id ?? item.qid ?? item.url ?? item.file;
    const preview = item.url || item.preview || item.file || item.thumb || item.thumbnail || '';
    const idStr = id != null ? String(id).trim() : '';
    if (!idStr) return null;
    return {
      id: idStr,
      preview: String(preview || (isFaceIdUrl(idStr) ? idStr : '')).trim(),
      name: String(item.name || item.desc || item.summary || '').trim()
    };
  }
  const s = String(item).trim();
  if (!s) return null;
  return { id: s, preview: isFaceIdUrl(s) ? s : '', name: '' };
}

/** 拉取账号收藏表情详情 */
async function fetchCustomFacesDetailed(count = 100) {
  try {
    const n = Math.max(1, Math.min(100, Number(count) || 48));
    let list = [];
    try {
      const detailRes = await callAction('fetch_custom_face_detail', { count: n });
      const detailData = detailRes?.data ?? detailRes ?? {};
      if (Array.isArray(detailData)) list = detailData;
      else if (Array.isArray(detailData.faces)) list = detailData.faces;
      else if (detailData && typeof detailData === 'object') list = Object.values(detailData);
    } catch (_) { /* fallback */ }
    if (!list.length) {
      const res = await callAction('fetch_custom_face', { count: n });
      list = res?.data ?? res ?? [];
    }
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const parsed = parseCustomFaceItem(item);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed);
    }
    return out;
  } catch (e) {
    log('warn', '拉取收藏表情失败', e.message, 'sticker');
    return [];
  }
}

/** 拉取收藏表情列表，返回 id/url 数组；失败返回 []。项可能为数字 id 或图片 URL。 */
async function fetchCustomFaces(count = 48) {
  const detailed = await fetchCustomFacesDetailed(count);
  return detailed.map((f) => f.id);
}

function normalizeStickerPool(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const weight = Math.max(0, Math.min(1000, Number(item.weight) || 1));
    out.push({
      id,
      weight,
      preview: String(item.preview || '').trim(),
      name: String(item.name || '').trim()
    });
  }
  return out;
}

function pickWeightedStickerId(candidates) {
  const items = (candidates || []).filter((c) => c?.id && (Number(c.weight) ?? 1) > 0);
  if (!items.length) return null;
  const total = items.reduce((s, c) => s + (Number(c.weight) || 1), 0);
  if (total <= 0) return items[0].id;
  let r = Math.random() * total;
  for (const item of items) {
    r -= Number(item.weight) || 1;
    if (r <= 0) return item.id;
  }
  return items[items.length - 1].id;
}

/** 构建回复后发表情的候选列表 */
async function buildStickerCandidates(cfg) {
  const pool = normalizeStickerPool(cfg.stickerPool);
  if (pool.length > 0) {
    return pool.map((p) => ({ id: p.id, weight: p.weight }));
  }
  if (cfg.stickerRandomFromFavorites === false) return [];
  const count = Math.max(1, Math.min(100, Number(cfg.stickerFaceCount) || 48));
  const ids = await fetchCustomFaces(count);
  return ids.map((id) => ({ id, weight: 1 }));
}

/** 根据配置选取要发送的表情 id */
async function pickStickerFaceId(cfg, userText, replyText) {
  const candidates = await buildStickerCandidates(cfg);
  if (!candidates.length) return null;
  const mode = String(cfg.stickerSelectMode || 'ai').toLowerCase();
  if (mode === 'fixed') {
    const fixed = String(cfg.stickerFixedId || '').trim();
    if (fixed && candidates.some((c) => c.id === fixed)) return fixed;
    return candidates[0].id;
  }
  if (mode === 'weighted') return pickWeightedStickerId(candidates);
  if (mode === 'random') {
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }
  const index = await aiPickStickerIndex(userText, replyText, candidates.length);
  const safeIndex = Math.max(0, Math.min(index, candidates.length - 1));
  return candidates[safeIndex].id;
}

/** 判断是否为 URL（收藏表情可能返回 URL，需用 image 段发送） */
function isFaceIdUrl(faceId) {
  const s = String(faceId).trim();
  return /^https?:\/\//i.test(s);
}

/** 发送群聊表情（支持数字 face id 或 URL；URL 时以图片形式发送） */
async function sendGroupFace(ctx, groupId, faceId) {
  try {
    const idStr = String(faceId).trim();
    let message;
    if (isFaceIdUrl(idStr)) {
      message = [{ type: 'image', data: { file: idStr } }];
    } else {
      message = [{ type: 'face', data: { id: idStr } }];
    }
    await callAction('send_group_msg', { group_id: String(groupId), message });
    log('info', '已发送群表情', { groupId, faceId: idStr.slice(0, 50) }, 'sticker');
  } catch (e) {
    log('warn', '发送群表情失败', { groupId, faceId: String(faceId).slice(0, 50), err: e.message });
  }
}

/** 发送私聊表情（支持数字 face id 或 URL） */
async function sendPrivateFace(ctx, userId, faceId) {
  try {
    const idStr = String(faceId).trim();
    let message;
    if (isFaceIdUrl(idStr)) {
      message = [{ type: 'image', data: { file: idStr } }];
    } else {
      message = [{ type: 'face', data: { id: idStr } }];
    }
    await callAction('send_private_msg', { user_id: String(userId), message });
    log('info', '已发送私聊表情', { userId, faceId: idStr.slice(0, 50) });
  } catch (e) {
    log('warn', '发送私聊表情失败', { userId, faceId: String(faceId).slice(0, 50), err: e.message });
  }
}

/** 获取群内随机成员 QQ（排除 selfId），失败或无成员返回 null */
async function getRandomGroupMember(groupId, selfId) {
  try {
    const raw = await callAction('get_group_member_list', { group_id: String(groupId) });
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
    const ids = list
      .map((m) => (m.user_id != null ? String(m.user_id) : (m.userId != null ? String(m.userId) : null)))
      .filter((id) => id && id !== selfId);
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  } catch (e) {
    log('warn', '获取群成员列表失败', { groupId, err: e.message });
    return null;
  }
}

/** 获取群最近几条消息文本（用于伪人上下文） */
function getRecentGroupMessages(groupId, limit = 5) {
  const list = recentGroupMessages.get(String(groupId)) || [];
  return list.slice(-Math.max(1, limit)).map((m) => `用户${m.userId}: ${m.text}`).join('\n');
}

/** 伪人：AI 在 回复(1)/@(2)/戳一戳(3) 中选一种 */
async function aiChooseFakeHumanAction(recentContext) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return 1;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: '根据最近群聊内容，选一种互动方式。只输出一个数字：1=发一段文字/表情回复，2=只@对方，3=只戳一戳对方。不要其他文字。' },
          { role: 'user', content: '最近群消息：\n' + (recentContext || '').slice(0, 600) + '\n\n输出 1 或 2 或 3：' }
        ],
        stream: false,
        temperature: 0.6,
        max_tokens: 5
      })
    });
    if (!res.ok) return 1;
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim().replace(/\D/g, '');
    if (text.includes('2')) return 2;
    if (text.includes('3')) return 3;
  } catch (e) {
    log('warn', '伪人 3 选 1 失败', e.message);
  }
  return 1;
}

/** 伪人：根据配置在群里随机插话，支持多条上下文、联网、与主对话同步、连续对话、@/戳/回复 3 选 1 */
async function tryFakeHumanReply(ctx, event, groupId, userId, plainText) {
  const cfg = pluginState.config;
  if (!cfg.fakeHumanEnabled) return;
  const g = String(groupId);
  if (!shouldHandleGroupForFakeHuman(g)) return;

  const now = Date.now();
  const followUpTimeout = Math.max(30000, Number(cfg.fakeHumanFollowUpTimeoutMs) ?? 120000);
  const followUpRounds = Math.max(0, Math.min(10, Number(cfg.fakeHumanFollowUpRounds) ?? 2));
  const talking = fakeHumanTalkingTo.get(g);
  const isFollowUp = talking && talking.userId === userId && (now - talking.ts) < followUpTimeout && talking.rounds < followUpRounds;
  if (!isFollowUp) {
    const chance = getFakeHumanChanceForGroup(g);
    if (Math.random() >= chance) return;
    const interval = Math.max(0, Number(cfg.fakeHumanMinInterval) ?? 90) * 1000;
    const last = fakeHumanLastTime.get(g) || 0;
    if (now - last < interval) return;
    fakeHumanLastTime.set(g, now);
    fakeHumanTalkingTo.set(g, { userId, ts: now, rounds: 1 });
  } else {
    talking.rounds += 1;
    talking.ts = now;
  }

  const selfId = event.self_id != null ? String(event.self_id) : null;
  const contextLines = Math.max(1, Math.min(50, Number(cfg.fakeHumanContextLines) ?? 5));
  const recentContext = getRecentGroupMessages(groupId, contextLines);
  let imageUrls = [];
  if (cfg.fakeHumanParseImage) {
    const imageItems = extractImageFromEvent(event);
    for (let i = 0; i < Math.min(4, imageItems.length); i++) {
      const u = await resolveImageToUrl(ctx, imageItems[i]);
      if (u) imageUrls.push(u);
    }
  }
  let personaContext = '';
  if (cfg.fakeHumanSyncPersona) {
    const key = getConversationKey(groupId, userId);
    const history = getHistory(key);
    if (history.length) {
      personaContext = '\n与该用户的主对话历史（最近几轮）：\n' + history.slice(-6).map((h) => `${h.role}: ${h.content.slice(0, 150)}`).join('\n');
    }
  }

  const actionMode = (cfg.fakeHumanActionMode || 'reply').toLowerCase();
  let chosenAction = 1;
  if (actionMode === 'ai_choose') {
    chosenAction = await aiChooseFakeHumanAction(recentContext);
    log('info', '伪人 AI 选择', { action: chosenAction, groupId: g });
  }
  if (chosenAction === 2) {
    const atWho = (cfg.fakeHumanAtWho || 'sender').toLowerCase();
    let targetId = userId;
    if (atWho === 'random') {
      const rid = await getRandomGroupMember(groupId, selfId);
      if (rid) targetId = rid;
    }
    await sendGroup(ctx, groupId, `[CQ:at,qq=${targetId}] `);
    log('info', '伪人插话', { groupId: g, action: 'at' });
    return;
  }
  if (chosenAction === 3) {
    await sendGroupPoke(ctx, groupId, userId);
    log('info', '伪人插话', { groupId: g, action: 'poke' });
    return;
  }

  const mode = (cfg.fakeHumanReplyMode || 'mixed').toLowerCase();
  const modes = ['ai', 'random_text', 'emoji', 'sticker'];
  const pickMode = mode === 'mixed' ? modes[Math.floor(Math.random() * modes.length)] : mode;

  let atPrefix = '';
  const atChance = Math.max(0, Math.min(1, Number(cfg.fakeHumanAtChance) ?? 0.25));
  if (Math.random() < atChance) {
    const atWho = (cfg.fakeHumanAtWho || 'sender').toLowerCase();
    let targetId = userId;
    if (atWho === 'random') {
      const randomId = await getRandomGroupMember(groupId, selfId);
      if (randomId) targetId = randomId;
    }
    atPrefix = `[CQ:at,qq=${targetId}] `;
  }

  let message = '';
  let sendAsArray = false;
  let messageArray = null;

  if (pickMode === 'sticker') {
    const faceId = await pickStickerFaceId(cfg, plainText || recentContext, '');
    if (faceId) {
      messageArray = [{ type: isFaceIdUrl(faceId) ? 'image' : 'face', data: isFaceIdUrl(faceId) ? { file: faceId } : { id: String(faceId) } }];
      sendAsArray = true;
    } else {
      const emojiList = cfg.fakeHumanEmojiList || DEFAULT_CONFIG.fakeHumanEmojiList;
      message = (emojiList.length ? emojiList[Math.floor(Math.random() * emojiList.length)] : '哈');
    }
  } else if (pickMode === 'emoji') {
    const emojiList = cfg.fakeHumanEmojiList || DEFAULT_CONFIG.fakeHumanEmojiList;
    message = (emojiList.length ? emojiList[Math.floor(Math.random() * emojiList.length)] : '哈');
  } else if (pickMode === 'random_text') {
    const textList = cfg.fakeHumanTextList || DEFAULT_CONFIG.fakeHumanTextList;
    message = (Array.isArray(textList) && textList.length) ? textList[Math.floor(Math.random() * textList.length)] : '哈哈';
  } else {
    let userContent = '最近群消息：\n' + (recentContext || (plainText || '')).slice(0, 800) + (personaContext ? '\n' + personaContext.slice(0, 500) : '');
    if (imageUrls.length) userContent += '\n\n用户本条消息包含图片，请结合图片内容简要插话（若只有图片无文字，就根据图片内容回复一两句）。';
    if (cfg.fakeHumanWebSearch && cfg.webSearchEnabled) {
      const query = (plainText || recentContext.split('\n').pop() || '').slice(0, 50);
      const searchResult = await webSearchMulti(query, cfg);
      if (searchResult) userContent += '\n\n联网参考：\n' + searchResult.slice(0, 400);
    }
    const { apiUrl, apiKey, model } = getApiConfig();
    const visionModel = (cfg.fakeHumanVisionModel || '').trim() || model || 'deepseek-ai/DeepSeek-V3';
    const sysPrompt = (cfg.fakeHumanSystemPrompt || DEFAULT_CONFIG.fakeHumanSystemPrompt).trim() || '你是一个在群聊里偶尔插话的真人，回复一两句短话。';
    const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
    if (apiKey) {
      try {
        const userMsg = imageUrls.length > 0
          ? { role: 'user', content: [{ type: 'text', text: userContent }, ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))] }
          : { role: 'user', content: userContent };
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: visionModel,
            messages: [
              { role: 'system', content: sysPrompt + '\n回复长度不超过' + maxLen + '字，不要换行。' },
              userMsg
            ],
            stream: false,
            temperature: 0.8,
            max_tokens: 50
          })
        });
        if (res.ok) {
          const data = await res.json();
          const content = (data?.choices?.[0]?.message?.content || '').trim().slice(0, maxLen).replace(/\n+/g, ' ');
          if (content) message = content;
        }
      } catch (e) {
        log('warn', '伪人 AI 生成失败', e.message);
      }
    }
    if (!message) {
      const textList = cfg.fakeHumanTextList || DEFAULT_CONFIG.fakeHumanTextList;
      message = (Array.isArray(textList) && textList.length) ? textList[Math.floor(Math.random() * textList.length)] : '哈哈';
    }
  }

  const replyMsgId = event.message_id ?? event.message?.id ?? null;
  const finalContent = atPrefix + message;
  if (sendAsArray && messageArray) {
    const seg = messageArray[0];
    const segments = seg ? (seg.type === 'face' ? [{ type: 'face', data: { id: String(seg.data?.id || '') } }] : seg.data?.file ? [{ type: 'image', data: { file: seg.data.file } }] : []) : [];
    if (segments.length) {
      await sendGroupMessageArray(ctx, groupId, replyMsgId, segments);
    } else {
      const faceCq = seg?.data?.id ? (isFaceIdUrl(seg.data.id) ? `[CQ:image,file=${seg.data.id}]` : `[CQ:face,id=${seg.data.id}]`) : '';
      const toSend = (atPrefix + faceCq).trim() || faceCq;
      if (toSend) await sendGroup(ctx, groupId, toSend);
    }
  } else {
    const text = (finalContent || message || ' ').trim();
    if (replyMsgId != null) await sendGroupReply(ctx, groupId, replyMsgId, text);
    else await sendGroup(ctx, groupId, text);
  }
  log('info', '伪人插话', { groupId: g, mode: pickMode });
}

/** 多提供商图像生成，返回图片 URL 或 null */
async function createImage(prompt, options = {}) {
  const cfg = pluginState.config;
  try {
    const provider = (cfg.imageGenProvider || 'siliconflow').toLowerCase();
    log('info', '请求图像生成', { provider, promptLen: String(prompt || '').length }, 'image');
    const result = await generateImage(cfg, prompt, options, fetchJson);
    if (result?.ok && result.url) {
      log('info', '图像生成成功', { url: String(result.url).slice(0, 60) }, 'image');
      return result.url;
    }
    log('warn', '图像生成失败', { error: result?.error }, 'image');
    return null;
  } catch (e) {
    log('warn', '图像生成异常', e.message, 'image');
    return null;
  }
}

/** 判断是否为图像生成触发，返回 { prompt } 或 null */
function isImageGenTrigger(plainText, textAfterAt, cfg) {
  if (!cfg.imageGenEnabled || !(cfg.imageGenCommands || []).length) return null;
  const raw = (textAfterAt != null ? textAfterAt : plainText || '').trim();
  const commands = (cfg.imageGenCommands || ['画', '画图', '生成图']).map((c) => String(c).trim()).filter(Boolean);
  const prefix = (cfg.commandPrefix || '/').trim();
  let rest = raw;
  if (prefix && rest.toLowerCase().startsWith(prefix)) rest = rest.slice(prefix.length).trim();
  for (const cmd of commands) {
    if (rest === cmd) return { prompt: '' };
    if (rest.toLowerCase().startsWith(cmd.toLowerCase() + ' ') || rest.toLowerCase().startsWith(cmd.toLowerCase() + '，')) {
      rest = rest.slice(cmd.length).replace(/^[\s，,]+/, '').trim();
      return { prompt: rest || '' };
    }
  }
  return null;
}

function isBotAt(rawMessage, selfId) {
  if (!rawMessage || !selfId) return false;
  return new RegExp(`\\[CQ:at,qq=${selfId}\\]`).test(rawMessage);
}

function extractTextAfterAt(rawMessage, selfId) {
  if (!rawMessage) return '';
  const plain = rawMessage.replace(new RegExp(`\\[CQ:at,qq=${selfId}\\]`, 'gi'), '').replace(/\[CQ:[^\]]+\]/g, '').trim();
  return plain;
}

function isCommandTrigger(plainText, cfg) {
  const prefix = (cfg.commandPrefix || '/').trim();
  const commands = (cfg.customCommands || ['chat', '问']).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  const lower = plainText.toLowerCase();
  if (!prefix && commands.length) {
    for (const cmd of commands) {
      if (lower === cmd || lower.startsWith(cmd + ' ')) return { cmd, rest: plainText.slice(cmd.length).trim() };
    }
    return null;
  }
  if (prefix && lower.startsWith(prefix)) {
    const rest = plainText.slice(prefix.length).trim();
    if (!commands.length) return { cmd: '', rest };
    for (const cmd of commands) {
      if (rest.toLowerCase() === cmd || rest.toLowerCase().startsWith(cmd + ' ')) {
        return { cmd, rest: rest.slice(cmd.length).trim() };
      }
    }
    return { cmd: '', rest };
  }
  return null;
}

function isCustomTrigger(plainText, cfg) {
  const keywords = (cfg.customTriggerKeywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (!keywords.length) return null;
  const t = plainText.trim();
  for (const kw of keywords) {
    if (t === kw || t.startsWith(kw + ' ') || t.includes(' ' + kw + ' ') || t.endsWith(' ' + kw)) return { useText: t || '你好' };
    if (t.toLowerCase() === kw.toLowerCase()) return { useText: t || '你好' };
  }
  return null;
}

function isAdminUser(userId, cfg = pluginState.config) {
  const admins = (cfg.adminUsers || []).map(String).filter(Boolean);
  return admins.length > 0 && admins.includes(String(userId));
}

async function tryHandleAdminCommand(ctx, plainText, groupId, userId, isGroup) {
  const cfg = pluginState.config;
  if (!cfg.adminCommandsEnabled || !isAdminUser(userId, cfg)) return false;

  const prefix = (cfg.adminCommandPrefix || '#').trim();
  if (!prefix) return false;
  const t = plainText.trim();
  if (!t.startsWith(prefix)) return false;

  const rest = t.slice(prefix.length).trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  const cmdLower = (parts[0] || '').toLowerCase();
  const args = parts.slice(1);
  const allowedCmds = (cfg.adminCommands || DEFAULT_CONFIG.adminCommands).map((c) => String(c).toLowerCase());
  if (!cmdLower || !allowedCmds.includes(cmdLower)) return false;

  const reply = async (msg) => {
    const text = String(msg);
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + text);
    else await sendPrivate(ctx, userId, text);
  };

  if (cmdLower === 'help') {
    const drawLines = (cfg.drawCommandsEnabled !== false)
      ? '\n画图指令：/draw-help · /draw-queue · #draw-cancel · #draw-stats（管理员）'
      : '';
    await reply(resolveTemplate(cfg, 'commandHelp', {
      lines: `管理员：${allowedCmds.join('、')}\n用法：${prefix}命令 [参数]${drawLines}`
    }) || `管理员指令：${allowedCmds.join('、')}\n用法：${prefix}命令 [参数]${drawLines}`);
    return true;
  }

  const drawAdminCmds = (cfg.drawAdminCommands || DRAW_BOT_DEFAULTS.drawAdminCommands || []).map((c) => String(c).toLowerCase());
  const drawUserCmds = (cfg.drawUserCommands || DRAW_BOT_DEFAULTS.drawUserCommands || []).map((c) => String(c).toLowerCase());
  if (drawBotEngine && cfg.drawCommandsEnabled !== false && (drawAdminCmds.includes(cmdLower) || drawUserCmds.includes(cmdLower))) {
    const handled = await drawBotEngine.handleDrawMetaCommand(ctx, cfg, groupId, userId, {
      cmd: cmdLower,
      arg: args.join(' '),
      adminOnly: drawAdminCmds.includes(cmdLower)
    });
    if (handled) return true;
  }

  if (cmdLower === 'clear') {
    const target = args[0];
    if (!target) {
      const key = getConversationKey(groupId, userId);
      conversationHistory.delete(key);
      conversationMeta.delete(key);
      await reply('已清空当前上下文记忆。');
    } else if (isGroup && target.toLowerCase() === 'all') {
      const g = String(groupId);
      let n = 0;
      for (const k of [...conversationHistory.keys()]) {
        if (k === `g:${g}` || k.startsWith(`g:${g}:u:`)) {
          conversationHistory.delete(k);
          conversationMeta.delete(k);
          n++;
        }
      }
      await reply(`已清空本群 ${n} 个会话记忆。`);
    } else {
      const key = isGroup ? getConversationKey(groupId, target) : `p:${target}`;
      conversationHistory.delete(key);
      conversationMeta.delete(key);
      await reply(`已清空用户 ${target} 的会话记忆。`);
    }
    log('info', '管理员清空对话', { admin: userId, cmd: cmdLower, args }, 'config');
    return true;
  }

  if (cmdLower === 'status') {
    const key = getConversationKey(groupId, userId);
    const hist = conversationHistory.get(key) || [];
    const mode = isGroup ? getEffectiveIsolationMode(groupId, cfg) : 'private';
    const cd = checkCooldown(groupId, userId);
    await reply([
      `运行：${cfg.enabled ? '开启' : '暂停'}`,
      `隔离：${mode}`,
      `当前会话：${hist.length} 条`,
      `模型：${cfg.model || '-'}`,
      `冷却：${cd.ok ? '就绪' : `剩余 ${cd.seconds}s`}`
    ].join('\n'));
    return true;
  }

  if (cmdLower === 'cooldown') {
    const sec = parseInt(args[0], 10);
    if (!isNaN(sec)) {
      cfg.cooldownSeconds = Math.max(0, Math.min(3600, sec));
      saveConfig(null);
      await reply(`全局冷却已设为 ${cfg.cooldownSeconds} 秒。`);
    } else {
      const cd = checkCooldown(groupId, userId);
      await reply(cd.ok ? '当前不在冷却中。' : `冷却剩余 ${cd.seconds} 秒。`);
    }
    return true;
  }

  if (cmdLower === 'on') {
    cfg.enabled = true;
    saveConfig(null);
    await reply('机器人已开启。');
    log('info', '管理员开启机器人', { admin: userId }, 'config');
    return true;
  }

  if (cmdLower === 'off') {
    cfg.enabled = false;
    saveConfig(null);
    await reply('机器人已暂停。');
    log('info', '管理员暂停机器人', { admin: userId }, 'config');
    return true;
  }

  return false;
}

function filterConversationsList(list, query = {}) {
  let out = [...list];
  const type = String(query.type || 'all').toLowerCase();
  if (type === 'group') out = out.filter((c) => !!c.groupId);
  else if (type === 'private') out = out.filter((c) => !c.groupId);
  const groupId = query.group_id != null ? String(query.group_id).trim() : '';
  if (groupId) out = out.filter((c) => String(c.groupId || '') === groupId);
  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    out = out.filter((c) => {
      const hay = [c.key, c.groupId, c.userId, c.userName, c.groupName, c.lastMessage, c.isolationMode]
        .map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(search);
    });
  }
  const sort = String(query.sort || 'recent').toLowerCase();
  if (sort === 'name') {
    out.sort((a, b) => {
      const an = (a.userName || a.userId || a.groupName || '').localeCompare(b.userName || b.userId || b.groupName || '', 'zh');
      return an;
    });
  } else if (sort === 'count') {
    out.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0));
  } else {
    out.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }
  const total = out.length;
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 200));
  return { data: out.slice(offset, offset + limit), total, offset, limit };
}

function shouldTrigger(ctx, event, plainText, selfId) {
  const cfg = pluginState.config;
  const groupId = event.group_id ? String(event.group_id) : null;
  const isGroup = !!groupId;
  const atMe = isGroup && isBotAt(event.raw_message || '', selfId);
  const textAfterAt = atMe ? extractTextAfterAt(event.raw_message || '', selfId).trim() : plainText;
  const cmd = isCommandTrigger(plainText, cfg);
  const custom = isCustomTrigger(plainText, cfg);

  if (cfg.triggerMode === 'at_only') {
    if (isGroup) return atMe ? { useText: textAfterAt || '你好' } : (custom || null);
    return cfg.privateEnabled ? { useText: plainText || '你好' } : (custom || null);
  }
  if (cfg.triggerMode === 'command_only') {
    if (cmd) return { useText: (cmd.rest || '你好').trim() };
    return custom;
  }
  if (cfg.triggerMode === 'custom') {
    return custom;
  }
  if (atMe) return { useText: textAfterAt || '你好' };
  if (cmd) return { useText: (cmd.rest || '你好').trim() };
  if (custom) return custom;
  return null;
}

const plugin_init = async (ctxOrCore, _obContext, _actions, _instance) => {
  try {
    const c = typeof ctxOrCore === 'object' && ctxOrCore !== null ? ctxOrCore : (_instance || {});
    const ctx = { ...c, ...(typeof _instance === 'object' && _instance !== null ? _instance : {}), ...(typeof _obContext === 'object' && _obContext !== null ? _obContext : {}) };
    const router = ctx.router || c.router;
    pluginState.configPath = ctx.configPath || c.configPath || path.join(__dirname, 'config.json');
    pluginState.logger = ctx.logger || c.logger || console;
    pluginState.actions = ctx.actions || c.actions;
    pluginState.adapterName = ctx.adapterName || c.adapterName;
    pluginState.pluginManager = ctx.pluginManager || c.pluginManager;
    loadConfig(ctx);

    log('info', '聊天插件已初始化', { apiProvider: pluginState.config.apiProvider || 'siliconflow' }, 'system');

    drawBotEngine = createDrawBot({
      fetchJson,
      sendGroup: async (drawCtx, gid, m) => sendGroup(drawCtx, gid, m),
      log,
      isAdminUser
    });

    if (router) {
      router.getNoAuth('/config', (_, res) => {
        res.json({ success: true, config: pluginState.config });
      });

      router.getNoAuth('/config/export', (_, res) => {
        res.json({
          success: true,
          plugin: 'napcat-plugin-chat-bot',
          exportedAt: new Date().toISOString(),
          config: { ...pluginState.config }
        });
      });

      router.postNoAuth('/config/import', (req, res) => {
        try {
          const body = req.body || {};
          const incoming = body.config;
          const mode = body.mode === 'replace' ? 'replace' : 'merge';
          if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ success: false, error: '缺少有效的 config 对象' });
          }
          if (mode === 'replace') {
            pluginState.config = { ...DEFAULT_CONFIG, ...incoming };
          } else {
            pluginState.config = { ...pluginState.config, ...incoming };
            if (incoming.messages && typeof incoming.messages === 'object') {
              pluginState.config.messages = {
                ...DEFAULT_CONFIG.messages,
                ...(pluginState.config.messages || {}),
                ...incoming.messages
              };
            }
          }
          if (pluginState.config.messages) {
            pluginState.config.messages = { ...DEFAULT_CONFIG.messages, ...pluginState.config.messages };
          }
          saveConfig(ctx);
          res.json({ success: true, config: pluginState.config });
        } catch (e) {
          pluginState.logger?.error?.('[chat-bot] 导入配置失败: ' + e.message);
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/config', (req, res) => {
        const body = req.body || {};
        const cfg = pluginState.config;
        const str = (v, d) => (body[v] !== undefined ? String(body[v] ?? '').trim() : (cfg[v] ?? d));
        const num = (v, d, min, max) => {
          if (body[v] === undefined) return cfg[v] ?? d;
          const n = Number(body[v]);
          if (isNaN(n)) return cfg[v] ?? d;
          if (min != null && n < min) return min;
          if (max != null && n > max) return max;
          return n;
        };
        const arr = (v) => (body[v] !== undefined ? (Array.isArray(body[v]) ? body[v].map(String) : []) : cfg[v]);
        const bool = (v, d) => (body[v] !== undefined ? Boolean(body[v]) : (cfg[v] ?? d));

        if (body.enabled !== undefined) cfg.enabled = bool('enabled', true);
        if (body.apiProvider !== undefined) {
          const p = str('apiProvider', 'siliconflow').toLowerCase();
          const allowed = ['siliconflow', 'deepseek', 'bailian', 'codingplan', 'openai', 'custom'];
          cfg.apiProvider = allowed.includes(p) ? p : 'siliconflow';
        }
        if (body.deepseekApiKey !== undefined) cfg.deepseekApiKey = str('deepseekApiKey', '');
        if (body.siliconflowApiKey !== undefined) cfg.siliconflowApiKey = str('siliconflowApiKey', '');
        if (body.bailianApiKey !== undefined) cfg.bailianApiKey = str('bailianApiKey', '');
        if (body.bailianApiUrl !== undefined) cfg.bailianApiUrl = str('bailianApiUrl', BAILIAN_API);
        if (body.codingPlanApiKey !== undefined) cfg.codingPlanApiKey = str('codingPlanApiKey', '');
        if (body.codingPlanApiUrl !== undefined) cfg.codingPlanApiUrl = str('codingPlanApiUrl', CODING_PLAN_API);
        if (body.openaiApiKey !== undefined) cfg.openaiApiKey = str('openaiApiKey', '');
        if (body.customApiUrl !== undefined) cfg.customApiUrl = str('customApiUrl', '');
        if (body.customApiKey !== undefined) cfg.customApiKey = str('customApiKey', '');
        if (body.model !== undefined) cfg.model = str('model', 'deepseek-ai/DeepSeek-V3');
        if (body.modelFallbackList !== undefined) {
          const rawFallbacks = Array.isArray(body.modelFallbackList)
            ? body.modelFallbackList
            : String(body.modelFallbackList || '').split(/\r?\n|[,，]/);
          cfg.modelFallbackList = normalizeModelList(rawFallbacks);
        }
        if (body.apiFailoverEnabled !== undefined) cfg.apiFailoverEnabled = bool('apiFailoverEnabled', false);
        if (body.apiFailoverRetries !== undefined) cfg.apiFailoverRetries = num('apiFailoverRetries', 2, 1, 10);
        if (body.apiFailoverMaxEndpoints !== undefined) cfg.apiFailoverMaxEndpoints = num('apiFailoverMaxEndpoints', 5, 1, 20);
        if (body.apiFailoverTimeoutMs !== undefined) cfg.apiFailoverTimeoutMs = num('apiFailoverTimeoutMs', 90000, 3000, 300000);
        if (body.apiFailoverRetryDelayMs !== undefined) cfg.apiFailoverRetryDelayMs = num('apiFailoverRetryDelayMs', 1200, 0, 30000);
        if (body.apiFailoverOnAuth !== undefined) cfg.apiFailoverOnAuth = bool('apiFailoverOnAuth', true);
        if (body.apiFailoverOnRateLimit !== undefined) cfg.apiFailoverOnRateLimit = bool('apiFailoverOnRateLimit', true);
        if (body.apiFailoverOnServerError !== undefined) cfg.apiFailoverOnServerError = bool('apiFailoverOnServerError', true);
        if (body.apiFailoverOnTimeout !== undefined) cfg.apiFailoverOnTimeout = bool('apiFailoverOnTimeout', true);
        if (body.apiFailoverOnNetwork !== undefined) cfg.apiFailoverOnNetwork = bool('apiFailoverOnNetwork', true);
        if (body.apiPool !== undefined) cfg.apiPool = normalizeApiPool(body.apiPool);
        if (body.temperature !== undefined) cfg.temperature = num('temperature', 0.7, 0, 2);
        if (body.systemPrompt !== undefined) cfg.systemPrompt = str('systemPrompt', DEFAULT_CONFIG.systemPrompt);
        if (body.cooldownSeconds !== undefined) cfg.cooldownSeconds = num('cooldownSeconds', 10, 0, 3600);
        if (body.cooldownScope !== undefined) cfg.cooldownScope = body.cooldownScope === 'group' ? 'group' : 'user';
        if (body.cooldownByUser !== undefined && typeof body.cooldownByUser === 'object' && body.cooldownByUser !== null) {
          cfg.cooldownByUser = body.cooldownByUser;
        }
        if (body.cooldownByGroup !== undefined && typeof body.cooldownByGroup === 'object' && body.cooldownByGroup !== null) {
          cfg.cooldownByGroup = body.cooldownByGroup;
        }
        if (body.conversationIsolationMode !== undefined) {
          cfg.conversationIsolationMode = normalizeIsolationMode(body.conversationIsolationMode);
        }
        if (body.groupIsolationOverrides !== undefined && typeof body.groupIsolationOverrides === 'object' && body.groupIsolationOverrides !== null) {
          cfg.groupIsolationOverrides = body.groupIsolationOverrides;
        }
        if (body.adminCommandsEnabled !== undefined) cfg.adminCommandsEnabled = Boolean(body.adminCommandsEnabled);
        if (body.adminUsers !== undefined) cfg.adminUsers = Array.isArray(body.adminUsers) ? body.adminUsers.map(String).filter(Boolean) : [];
        if (body.adminCommandPrefix !== undefined) cfg.adminCommandPrefix = str('adminCommandPrefix', '#');
        if (body.adminCommands !== undefined) {
          cfg.adminCommands = Array.isArray(body.adminCommands) ? body.adminCommands.map(String).filter(Boolean) : (cfg.adminCommands || []);
        }
        if (body.botDisplayName !== undefined) cfg.botDisplayName = str('botDisplayName', '助手');
        if (body.maxHistoryMessages !== undefined) cfg.maxHistoryMessages = num('maxHistoryMessages', 12, 1, 50);
        if (body.maxTokens !== undefined) cfg.maxTokens = num('maxTokens', 8192, 100, 32768);
        if (body.top_p !== undefined) cfg.top_p = num('top_p', 0.95, 0, 1);
        if (body.top_k !== undefined) cfg.top_k = Math.max(1, Math.min(100, parseInt(body.top_k, 10) || 20));
        if (body.frequency_penalty !== undefined) cfg.frequency_penalty = num('frequency_penalty', 0, -2, 2);
        if (body.presence_penalty !== undefined) cfg.presence_penalty = num('presence_penalty', 0, -2, 2);
        if (body.stop !== undefined) cfg.stop = body.stop == null || body.stop === '' ? null : (Array.isArray(body.stop) ? body.stop : [String(body.stop).trim()].filter(Boolean));
        if (body.enableThinking !== undefined) cfg.enableThinking = bool('enableThinking', false);
        if (body.thinkingBudget !== undefined) cfg.thinkingBudget = Math.max(0, Math.min(65536, parseInt(body.thinkingBudget, 10) || 4096));
        if (body.enableGroups !== undefined) cfg.enableGroups = arr('enableGroups');
        if (body.whitelistGroups !== undefined) cfg.whitelistGroups = arr('whitelistGroups');
        if (body.blacklistGroups !== undefined) cfg.blacklistGroups = arr('blacklistGroups');
        if (body.whitelistUsers !== undefined) cfg.whitelistUsers = arr('whitelistUsers');
        if (body.blacklistUsers !== undefined) cfg.blacklistUsers = arr('blacklistUsers');
        if (body.triggerMode !== undefined) cfg.triggerMode = ['at_only', 'command_only', 'both', 'custom'].includes(body.triggerMode) ? body.triggerMode : 'at_only';
        if (body.commandPrefix !== undefined) cfg.commandPrefix = str('commandPrefix', '/');
        if (body.customCommands !== undefined) cfg.customCommands = Array.isArray(body.customCommands) ? body.customCommands.map(String).filter(Boolean) : (cfg.customCommands || []);
        if (body.replyPrefix !== undefined) cfg.replyPrefix = str('replyPrefix', '[CQ:at,qq={user_id}] ');
        if (body.skipPrivate !== undefined) cfg.skipPrivate = bool('skipPrivate', false);
        if (body.privateEnabled !== undefined) cfg.privateEnabled = bool('privateEnabled', true);
        if (body.theme !== undefined) cfg.theme = ['dark', 'light', 'system'].includes(body.theme) ? body.theme : 'dark';
        if (body.webSearchEnabled !== undefined) cfg.webSearchEnabled = bool('webSearchEnabled', false);
        if (body.webSearchProvider !== undefined) cfg.webSearchProvider = normalizeWebSearchProvider(body.webSearchProvider);
        if (body.smartSearchQueryMode !== undefined) cfg.smartSearchQueryMode = ['fixed', 'ai'].includes(String(body.smartSearchQueryMode).toLowerCase()) ? String(body.smartSearchQueryMode).toLowerCase() : 'ai';
        if (body.serperApiKey !== undefined) cfg.serperApiKey = str('serperApiKey', '');
        if (body.uapiApiKey !== undefined) cfg.uapiApiKey = str('uapiApiKey', '');
        if (body.tavilyApiKey !== undefined) cfg.tavilyApiKey = str('tavilyApiKey', '');
        if (body.bochaApiKey !== undefined) cfg.bochaApiKey = str('bochaApiKey', '');
        if (body.baiduSearchApiKey !== undefined) cfg.baiduSearchApiKey = str('baiduSearchApiKey', '');
        if (body.aliyunIqsAccessKeyId !== undefined) cfg.aliyunIqsAccessKeyId = str('aliyunIqsAccessKeyId', '');
        if (body.aliyunIqsAccessKeySecret !== undefined) cfg.aliyunIqsAccessKeySecret = str('aliyunIqsAccessKeySecret', '');
        if (body.uapiSearchTimeoutMs !== undefined) cfg.uapiSearchTimeoutMs = Math.max(1000, Math.min(30000, parseInt(body.uapiSearchTimeoutMs, 10) || 10000));
        if (body.uapiSort !== undefined) cfg.uapiSort = str('uapiSort', '');
        if (body.uapiTimeRange !== undefined) cfg.uapiTimeRange = str('uapiTimeRange', '');
        if (body.logLevel !== undefined) cfg.logLevel = ['debug', 'info', 'warn', 'error'].includes(String(body.logLevel)) ? body.logLevel : 'info';
        if (body.appendStickerAfterReply !== undefined) cfg.appendStickerAfterReply = bool('appendStickerAfterReply', false);
        if (body.pokeAfterReply !== undefined) cfg.pokeAfterReply = bool('pokeAfterReply', false);
        if (body.pokeMode !== undefined) cfg.pokeMode = ['never', 'always', 'random', 'ai'].includes(String(body.pokeMode).toLowerCase()) ? String(body.pokeMode).toLowerCase() : 'never';
        if (body.pokeRandomChance !== undefined) cfg.pokeRandomChance = Math.max(0, Math.min(1, parseFloat(body.pokeRandomChance) || 0.5));
        if (body.stickerRandomFromFavorites !== undefined) cfg.stickerRandomFromFavorites = bool('stickerRandomFromFavorites', true);
        if (body.stickerSelectMode !== undefined) {
          const m = String(body.stickerSelectMode).toLowerCase();
          cfg.stickerSelectMode = ['ai', 'random', 'weighted', 'fixed'].includes(m) ? m : 'ai';
        }
        if (body.stickerFaceCount !== undefined) cfg.stickerFaceCount = Math.max(1, Math.min(100, parseInt(body.stickerFaceCount, 10) || 48));
        if (body.stickerPool !== undefined) cfg.stickerPool = normalizeStickerPool(body.stickerPool);
        if (body.stickerFixedId !== undefined) cfg.stickerFixedId = String(body.stickerFixedId ?? '').trim();
        if (body.thinkingIndicatorEnabled !== undefined) cfg.thinkingIndicatorEnabled = bool('thinkingIndicatorEnabled', false);
        if (body.thinkingIndicatorMode !== undefined) {
          const tm = String(body.thinkingIndicatorMode).toLowerCase();
          cfg.thinkingIndicatorMode = ['message', 'emoji', 'both', 'silent'].includes(tm) ? tm : 'message';
        }
        if (body.messages !== undefined && typeof body.messages === 'object') {
          cfg.messages = { ...MESSAGE_TEMPLATE_DEFAULTS, ...cfg.messages, ...body.messages };
          if (cfg.messages.thinking != null) cfg.thinkingMessage = cfg.messages.thinking;
        }
        if (body.thinkingMessage !== undefined) {
          cfg.thinkingMessage = str('thinkingMessage', '正在思考…');
          if (!cfg.messages) cfg.messages = { ...MESSAGE_TEMPLATE_DEFAULTS };
          cfg.messages.thinking = cfg.thinkingMessage;
        }
        if (body.drawCommandsEnabled !== undefined) cfg.drawCommandsEnabled = bool('drawCommandsEnabled', true);
        if (body.drawUserCommands !== undefined) cfg.drawUserCommands = Array.isArray(body.drawUserCommands) ? body.drawUserCommands.map(String).filter(Boolean) : cfg.drawUserCommands;
        if (body.drawAdminCommands !== undefined) cfg.drawAdminCommands = Array.isArray(body.drawAdminCommands) ? body.drawAdminCommands.map(String).filter(Boolean) : cfg.drawAdminCommands;
        if (body.thinkingEmojiId !== undefined) cfg.thinkingEmojiId = str('thinkingEmojiId', '311');
        if (body.thinkingEmojiType !== undefined) cfg.thinkingEmojiType = str('thinkingEmojiType', '1');
        if (body.afterReplyReactionEnabled !== undefined) cfg.afterReplyReactionEnabled = bool('afterReplyReactionEnabled', false);
        if (body.afterReplyRemoveThinkingEmoji !== undefined) cfg.afterReplyRemoveThinkingEmoji = bool('afterReplyRemoveThinkingEmoji', true);
        if (body.afterReplyEmojiId !== undefined) cfg.afterReplyEmojiId = str('afterReplyEmojiId', '');
        if (body.afterReplyEmojiMode !== undefined) {
          const am = String(body.afterReplyEmojiMode).toLowerCase();
          cfg.afterReplyEmojiMode = ['replace', 'add', 'remove_only'].includes(am) ? am : 'replace';
        }
        if (body.reactionEmojiCatalog !== undefined) cfg.reactionEmojiCatalog = normalizeReactionCatalog(body.reactionEmojiCatalog);
        if (body.webSearchQuery !== undefined) cfg.webSearchQuery = str('webSearchQuery', '');
        if (body.webSearchTriple !== undefined) cfg.webSearchTriple = bool('webSearchTriple', false);
        if (body.customTriggerKeywords !== undefined) cfg.customTriggerKeywords = Array.isArray(body.customTriggerKeywords) ? body.customTriggerKeywords.map(String).filter(Boolean) : (cfg.customTriggerKeywords || []);
        if (body.imageGenEnabled !== undefined) cfg.imageGenEnabled = bool('imageGenEnabled', false);
        if (body.imageGenProvider !== undefined) {
          const ip = String(body.imageGenProvider).toLowerCase();
          cfg.imageGenProvider = ['siliconflow', 'gemini', 'custom', 'runninghub'].includes(ip) ? ip : 'siliconflow';
        }
        if (body.imageGenPreset !== undefined) cfg.imageGenPreset = str('imageGenPreset', '');
        if (body.imageGenPresets !== undefined && Array.isArray(body.imageGenPresets)) cfg.imageGenPresets = body.imageGenPresets;
        if (body.imageGenGeminiApiKey !== undefined) cfg.imageGenGeminiApiKey = str('imageGenGeminiApiKey', '');
        if (body.imageGenGeminiModel !== undefined) cfg.imageGenGeminiModel = str('imageGenGeminiModel', 'imagen-3.0-generate-002');
        if (body.imageGenCustomApiUrl !== undefined) cfg.imageGenCustomApiUrl = str('imageGenCustomApiUrl', '');
        if (body.imageGenCustomApiKey !== undefined) cfg.imageGenCustomApiKey = str('imageGenCustomApiKey', '');
        if (body.imageGenCustomMethod !== undefined) cfg.imageGenCustomMethod = str('imageGenCustomMethod', 'POST');
        if (body.imageGenCustomBodyTemplate !== undefined) cfg.imageGenCustomBodyTemplate = String(body.imageGenCustomBodyTemplate ?? '');
        if (body.imageGenCustomHeaders !== undefined && typeof body.imageGenCustomHeaders === 'object') cfg.imageGenCustomHeaders = body.imageGenCustomHeaders;
        if (body.imageGenResponseFormat !== undefined) cfg.imageGenResponseFormat = str('imageGenResponseFormat', 'openai_url');
        if (body.imageGenResponsePath !== undefined) cfg.imageGenResponsePath = str('imageGenResponsePath', 'data[0].url');
        if (body.imageGenApiUrl !== undefined) cfg.imageGenApiUrl = str('imageGenApiUrl', 'http://127.0.0.1:1088');
        if (body.drawBotEnabled !== undefined) cfg.drawBotEnabled = bool('drawBotEnabled', false);
        if (body.drawBotApiUrl !== undefined) cfg.drawBotApiUrl = str('drawBotApiUrl', 'http://127.0.0.1:1088');
        if (body.drawBotTriggerKeywords !== undefined) cfg.drawBotTriggerKeywords = Array.isArray(body.drawBotTriggerKeywords) ? body.drawBotTriggerKeywords.map(String).filter(Boolean) : cfg.drawBotTriggerKeywords;
        if (body.drawBotSlashCommands !== undefined) cfg.drawBotSlashCommands = Array.isArray(body.drawBotSlashCommands) ? body.drawBotSlashCommands.map(String).filter(Boolean) : cfg.drawBotSlashCommands;
        if (body.drawBotUseSyncMode !== undefined) cfg.drawBotUseSyncMode = bool('drawBotUseSyncMode', false);
        if (body.drawBotCooldownSeconds !== undefined) cfg.drawBotCooldownSeconds = Math.max(0, parseInt(body.drawBotCooldownSeconds, 10) || 0);
        if (body.drawBotStylePresets !== undefined && typeof body.drawBotStylePresets === 'object') cfg.drawBotStylePresets = body.drawBotStylePresets;
        if (body.drawBotAdminTokens !== undefined) cfg.drawBotAdminTokens = Array.isArray(body.drawBotAdminTokens) ? body.drawBotAdminTokens.map(String).filter(Boolean) : [];
        if (body.drawBotMessages !== undefined && typeof body.drawBotMessages === 'object') cfg.drawBotMessages = { ...cfg.drawBotMessages, ...body.drawBotMessages };
        if (body.imageGenModel !== undefined) cfg.imageGenModel = str('imageGenModel', 'Kwai-Kolors/Kolors');
        if (body.imageGenSize !== undefined) cfg.imageGenSize = str('imageGenSize', '1024x1024');
        if (body.imageGenCommands !== undefined) cfg.imageGenCommands = Array.isArray(body.imageGenCommands) ? body.imageGenCommands.map(String).filter(Boolean) : (cfg.imageGenCommands || ['画', '画图', '生成图']);
        if (body.imageGenNegativePrompt !== undefined) cfg.imageGenNegativePrompt = str('imageGenNegativePrompt', '');
        if (body.imageGenSteps !== undefined) cfg.imageGenSteps = Math.max(1, Math.min(100, parseInt(body.imageGenSteps, 10) || 20));
        if (body.imageGenGuidanceScale !== undefined) cfg.imageGenGuidanceScale = Math.max(0, Math.min(20, parseFloat(body.imageGenGuidanceScale) || 7.5));
        if (body.imageGenCfg !== undefined) cfg.imageGenCfg = Math.max(0.1, Math.min(20, parseFloat(body.imageGenCfg) || 4));
        if (body.chatAllowUsers !== undefined) cfg.chatAllowUsers = Array.isArray(body.chatAllowUsers) ? body.chatAllowUsers.map(String).filter(Boolean) : [];
        if (body.chatParseImage !== undefined) cfg.chatParseImage = Boolean(body.chatParseImage);
        if (body.kimiVisionModel !== undefined) cfg.kimiVisionModel = str('kimiVisionModel', KIMI_CODE_DEFAULT_MODEL) || KIMI_CODE_DEFAULT_MODEL;
        if (body.kimiVisionApiKey !== undefined) cfg.kimiVisionApiKey = str('kimiVisionApiKey', '');
        if (body.kimiVisionApiUrl !== undefined) cfg.kimiVisionApiUrl = str('kimiVisionApiUrl', KIMI_CODE_API);
        if (body.kimiVisionModelsUrl !== undefined) cfg.kimiVisionModelsUrl = str('kimiVisionModelsUrl', KIMI_CODE_MODELS_API);
        if (body.visionFailoverEnabled !== undefined) cfg.visionFailoverEnabled = bool('visionFailoverEnabled', false);
        if (body.visionFailoverRetries !== undefined) cfg.visionFailoverRetries = num('visionFailoverRetries', 2, 1, 10);
        if (body.visionFailoverMaxEndpoints !== undefined) cfg.visionFailoverMaxEndpoints = num('visionFailoverMaxEndpoints', 4, 1, 20);
        if (body.visionFailoverTimeoutMs !== undefined) cfg.visionFailoverTimeoutMs = num('visionFailoverTimeoutMs', 60000, 3000, 300000);
        if (body.visionFailoverRetryDelayMs !== undefined) cfg.visionFailoverRetryDelayMs = num('visionFailoverRetryDelayMs', 1000, 0, 30000);
        if (body.visionFailoverOnAuth !== undefined) cfg.visionFailoverOnAuth = bool('visionFailoverOnAuth', true);
        if (body.visionFailoverOnRateLimit !== undefined) cfg.visionFailoverOnRateLimit = bool('visionFailoverOnRateLimit', true);
        if (body.visionFailoverOnServerError !== undefined) cfg.visionFailoverOnServerError = bool('visionFailoverOnServerError', true);
        if (body.visionFailoverOnTimeout !== undefined) cfg.visionFailoverOnTimeout = bool('visionFailoverOnTimeout', true);
        if (body.visionFailoverOnNetwork !== undefined) cfg.visionFailoverOnNetwork = bool('visionFailoverOnNetwork', true);
        if (body.visionPool !== undefined) cfg.visionPool = normalizeVisionPool(body.visionPool);
        if (body.chatVisionModel !== undefined) {
          cfg.kimiVisionModel = str('chatVisionModel', cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL) || KIMI_CODE_DEFAULT_MODEL;
        }
        if (body.imageGenAllowUsers !== undefined) cfg.imageGenAllowUsers = Array.isArray(body.imageGenAllowUsers) ? body.imageGenAllowUsers.map(String).filter(Boolean) : [];
        if (body.videoAllowUsers !== undefined) cfg.videoAllowUsers = Array.isArray(body.videoAllowUsers) ? body.videoAllowUsers.map(String).filter(Boolean) : [];
        if (body.fakeHumanEnabled !== undefined) cfg.fakeHumanEnabled = Boolean(body.fakeHumanEnabled);
        if (body.fakeHumanChance !== undefined) cfg.fakeHumanChance = Math.max(0, Math.min(1, parseFloat(body.fakeHumanChance) || 0.05));
        if (body.fakeHumanGroupChance !== undefined) cfg.fakeHumanGroupChance = typeof body.fakeHumanGroupChance === 'object' && body.fakeHumanGroupChance !== null ? body.fakeHumanGroupChance : {};
        if (body.fakeHumanMinInterval !== undefined) cfg.fakeHumanMinInterval = Math.max(0, parseInt(body.fakeHumanMinInterval, 10) || 90);
        if (body.fakeHumanReplyMode !== undefined) cfg.fakeHumanReplyMode = ['ai', 'random_text', 'emoji', 'sticker', 'mixed'].includes(String(body.fakeHumanReplyMode).toLowerCase()) ? String(body.fakeHumanReplyMode).toLowerCase() : 'mixed';
        if (body.fakeHumanTextList !== undefined) cfg.fakeHumanTextList = Array.isArray(body.fakeHumanTextList) ? body.fakeHumanTextList.map(String).filter(Boolean) : (cfg.fakeHumanTextList || []);
        if (body.fakeHumanEmojiList !== undefined) cfg.fakeHumanEmojiList = Array.isArray(body.fakeHumanEmojiList) ? body.fakeHumanEmojiList.map(String).filter(Boolean) : (cfg.fakeHumanEmojiList || []);
        if (body.fakeHumanAtChance !== undefined) cfg.fakeHumanAtChance = Math.max(0, Math.min(1, parseFloat(body.fakeHumanAtChance) || 0.25));
        if (body.fakeHumanAtWho !== undefined) cfg.fakeHumanAtWho = ['sender', 'random'].includes(String(body.fakeHumanAtWho).toLowerCase()) ? String(body.fakeHumanAtWho).toLowerCase() : 'sender';
        if (body.fakeHumanSystemPrompt !== undefined) cfg.fakeHumanSystemPrompt = String(body.fakeHumanSystemPrompt || '').trim();
        if (body.fakeHumanMaxLength !== undefined) cfg.fakeHumanMaxLength = Math.max(10, Math.min(200, parseInt(body.fakeHumanMaxLength, 10) || 80));
        if (body.fakeHumanEnableGroups !== undefined) cfg.fakeHumanEnableGroups = Array.isArray(body.fakeHumanEnableGroups) ? body.fakeHumanEnableGroups.map(String).filter(Boolean) : [];
        if (body.fakeHumanContextLines !== undefined) cfg.fakeHumanContextLines = Math.max(1, Math.min(50, parseInt(body.fakeHumanContextLines, 10) || 5));
        if (body.fakeHumanWebSearch !== undefined) cfg.fakeHumanWebSearch = Boolean(body.fakeHumanWebSearch);
        if (body.fakeHumanSyncPersona !== undefined) cfg.fakeHumanSyncPersona = Boolean(body.fakeHumanSyncPersona);
        if (body.fakeHumanFollowUpRounds !== undefined) cfg.fakeHumanFollowUpRounds = Math.max(0, Math.min(10, parseInt(body.fakeHumanFollowUpRounds, 10) ?? 2));
        if (body.fakeHumanFollowUpTimeoutMs !== undefined) cfg.fakeHumanFollowUpTimeoutMs = Math.max(10000, parseInt(body.fakeHumanFollowUpTimeoutMs, 10) || 120000);
        if (body.fakeHumanActionMode !== undefined) cfg.fakeHumanActionMode = ['reply', 'at', 'poke', 'ai_choose'].includes(String(body.fakeHumanActionMode).toLowerCase()) ? String(body.fakeHumanActionMode).toLowerCase() : 'reply';
        if (body.fakeHumanParseImage !== undefined) cfg.fakeHumanParseImage = Boolean(body.fakeHumanParseImage);
        if (body.fakeHumanVisionModel !== undefined) cfg.fakeHumanVisionModel = String(body.fakeHumanVisionModel || '').trim();
        saveConfig(ctx);
        res.json({ success: true });
      });

      router.getNoAuth('/logs', (req, res) => {
        const limit = Math.min(2000, Math.max(1, parseInt(req.query?.limit, 10) || 500));
        const level = (req.query?.level || '').toLowerCase();
        const type = (req.query?.type || '').toLowerCase();
        let entries = [...logBuffer];
        if (level && LOG_LEVELS[level] != null) {
          entries = entries.filter((e) => (LOG_LEVELS[e.level] ?? 0) >= LOG_LEVELS[level]);
        }
        if (type && LOG_TYPES.includes(type)) {
          entries = entries.filter((e) => e.type === type);
        }
        const from = Math.max(0, entries.length - limit);
        res.json({ success: true, logs: entries.slice(from), total: logBuffer.length, types: LOG_TYPES });
      });

      router.postNoAuth('/logs/clear', (_, res) => {
        logBuffer.length = 0;
        log('info', '运行日志已清空', null, 'config');
        res.json({ success: true });
      });

      router.getNoAuth('/stickers', async (req, res) => {
        try {
          const count = Math.max(1, Math.min(100, parseInt(req.query?.count, 10) || 100));
          const data = await fetchCustomFacesDetailed(count);
          res.json({ success: true, data, total: data.length, count });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/kimi/models', async (_, res) => {
        try {
          const models = await fetchKimiModels();
          res.json({ success: true, models });
        } catch (e) {
          res.json({ success: false, models: [KIMI_CODE_DEFAULT_MODEL], error: e.message });
        }
      });

      router.getNoAuth('/conversations', async (req, res) => {
        let list = getConversationsList();
        try {
          const raw = await callAction('get_group_list', {});
          const groups = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
          const groupMap = new Map();
          for (const g of groups) {
            const id = String(g.group_id ?? g.groupId ?? '');
            if (id) groupMap.set(id, g.group_name || g.groupName || '');
          }
          for (const item of list) {
            if (item.groupId && groupMap.has(String(item.groupId))) {
              item.groupName = groupMap.get(String(item.groupId)) || item.groupName;
            }
          }
        } catch (_) { /* ignore */ }
        const filtered = filterConversationsList(list, req.query || {});
        res.json({
          success: true,
          data: filtered.data,
          total: filtered.total,
          offset: filtered.offset,
          limit: filtered.limit,
          isolationMode: pluginState.config.conversationIsolationMode || 'user_group'
        });
      });

      router.getNoAuth('/conversations/groups', async (_, res) => {
        const list = getConversationsList();
        const groups = new Map();
        for (const item of list) {
          if (!item.groupId) continue;
          const g = String(item.groupId);
          const existing = groups.get(g);
          if (!existing) {
            groups.set(g, { groupId: g, groupName: item.groupName || '', count: 1, lastActivity: item.lastActivity || 0 });
          } else {
            existing.count += 1;
            if (item.groupName) existing.groupName = item.groupName;
            if ((item.lastActivity || 0) > (existing.lastActivity || 0)) existing.lastActivity = item.lastActivity;
          }
        }
        res.json({
          success: true,
          data: Array.from(groups.values()).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
        });
      });

      router.getNoAuth('/permission-users', (_, res) => {
        const list = getConversationsList();
        const byUser = new Map();
        for (const item of list) {
          if (item.userId) {
            const u = String(item.userId);
            const existing = byUser.get(u);
            if (!existing || (item.lastActivity || 0) > (existing.lastActivity || 0)) {
              byUser.set(u, { userId: u, lastActivity: item.lastActivity || 0, groupId: item.groupId });
            }
          }
        }
        res.json({ success: true, data: Array.from(byUser.values()).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)) });
      });

      router.getNoAuth('/reactions', (_, res) => {
        const cfg = pluginState.config;
        res.json({ success: true, data: normalizeReactionCatalog(cfg.reactionEmojiCatalog) });
      });

      router.getNoAuth('/stats', async (_, res) => {
        const byKey = [];
        for (const [key, v] of tokenStats.byKey.entries()) {
          byKey.push({ key, ...v });
        }
        const cfg = pluginState.config;
        let drawStats = null;
        if (cfg.drawBotEnabled) {
          const base = (cfg.drawBotApiUrl || 'http://127.0.0.1:1088').replace(/\/$/, '');
          drawStats = await fetchJson(`${base}/api/stats`);
        }
        res.json({
          success: true,
          totalPrompt: tokenStats.totalPrompt,
          totalCompletion: tokenStats.totalCompletion,
          totalTokens: tokenStats.totalTokens,
          byKey: byKey.sort((a, b) => b.total - a.total),
          recent: tokenStats.recent.slice(-50).reverse(),
          conversationCount: conversationHistory.size,
          features: {
            chat: cfg.enabled !== false,
            imageGen: !!cfg.imageGenEnabled,
            drawBot: !!cfg.drawBotEnabled,
            fakeHuman: !!cfg.fakeHumanEnabled,
            webSearch: !!cfg.webSearchEnabled,
            thinking: !!cfg.thinkingIndicatorEnabled,
            sticker: !!cfg.appendStickerAfterReply
          },
          drawStats
        });
      });

      drawBotEngine.registerRoutes(router, () => pluginState.config, () => saveConfig(ctx));

      router.getNoAuth('/groups', async (_, res) => {
        try {
          const raw = await callAction('get_group_list', {});
          const data = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
          res.json({ success: true, data });
        } catch (e) {
          pluginState.logger?.error?.('[chat-bot] 获取群列表失败: ' + e.message);
          res.json({ success: false, error: e.message, data: [] });
        }
      });

      router.getNoAuth('/users/resolve', async (req, res) => {
        try {
          const q = String(req.query?.q ?? req.query?.query ?? '').trim();
          const data = await searchUsersByQuery(q, Math.min(30, parseInt(req.query?.limit, 10) || 20));
          res.json({ success: true, data, query: q });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/users/info', async (req, res) => {
        try {
          const userId = String(req.query?.user_id ?? req.query?.qq ?? '').trim();
          if (!userId) return res.status(400).json({ success: false, error: '缺少 user_id' });
          const profile = await fetchStrangerProfile(userId);
          if (profile) touchUserProfileCache(pluginState.config, profile);
          res.json({ success: true, data: profile });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/users/profiles', async (req, res) => {
        try {
          const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
          const out = {};
          for (const id of ids.slice(0, 50)) {
            const cached = pluginState.config.userProfileCache?.[id];
            if (cached?.nickname && Date.now() - (cached.updatedAt || 0) < 3600000) {
              out[id] = { userId: id, ...cached };
              continue;
            }
            const profile = await fetchStrangerProfile(id);
            if (profile) {
              touchUserProfileCache(pluginState.config, profile);
              out[id] = profile;
            }
          }
          saveConfig(ctx);
          res.json({ success: true, data: out });
        } catch (e) {
          res.json({ success: false, data: {}, error: e.message });
        }
      });

      router.getNoAuth('/groups/resolve', async (req, res) => {
        try {
          const q = String(req.query?.q ?? req.query?.query ?? '').trim();
          const data = await searchGroupsByQuery(q, Math.min(50, parseInt(req.query?.limit, 10) || 24));
          res.json({ success: true, data, query: q });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/groups/info', async (req, res) => {
        try {
          const groupId = String(req.query?.group_id ?? '').trim();
          if (!groupId) return res.status(400).json({ success: false, error: '缺少 group_id' });
          const profile = await fetchGroupProfile(groupId);
          if (profile) touchGroupProfileCache(pluginState.config, profile);
          saveConfig(ctx);
          res.json({ success: true, data: profile });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/history/get', (req, res) => {
        const key = (req.query?.key || '').trim();
        if (!key) {
          res.status(400).json({ success: false, error: '缺少 key' });
          return;
        }
        const messages = conversationHistory.get(key) || [];
        const meta = conversationMeta.get(key) || {};
        const parsed = parseConversationKey(key);
        res.json({
          success: true,
          key,
          groupId: parsed.groupId,
          userId: parsed.userId,
          isolationMode: parsed.isolationMode,
          userName: meta.userName || '',
          groupName: meta.groupName || '',
          messages,
          meta
        });
      });

      router.postNoAuth('/history/clear', (req, res) => {
        const { group_id, user_id, key: keyBody } = req.body || {};
        if (keyBody && String(keyBody).trim()) {
          const k = String(keyBody).trim();
          conversationHistory.delete(k);
          conversationMeta.delete(k);
          log('info', '已清空指定对话历史', { key: k });
          res.json({ success: true, cleared: k });
          return;
        }
        if (group_id != null && user_id != null) {
          const key = getConversationKey(String(group_id), String(user_id));
          conversationHistory.delete(key);
          conversationMeta.delete(key);
          log('info', '已清空对话历史', { key });
        } else {
          conversationHistory.clear();
          conversationMeta.clear();
          log('info', '已清空全部对话历史', {});
        }
        res.json({ success: true });
      });

      if (router.page) {
        router.page({
          path: 'dashboard',
          title: '聊天机器人',
          icon: '',
          htmlFile: 'webui/dashboard.html',
          description: '多轮对话、人设、冷却、群组与黑名单'
        });
      }
      try {
        initConfigUi(ctx);
      } catch (err) {
        pluginState.logger?.warn?.('[chat-bot] 配置 UI 初始化失败: ' + (err?.message || err));
      }
    }
  } catch (e) {
    pluginState.logger?.error?.('[chat-bot] 插件初始化失败: ' + (e?.message || e));
    throw e;
  }
  pluginState.logger?.info?.('[chat-bot] 聊天插件已初始化，@机器人 或 指令 即可对话');
};

const plugin_onmessage = async (ctx, event) => {
  const cfg = pluginState.config;
  if (!cfg.enabled) return;
  if (!event?.raw_message) return;

  const selfId = event.self_id != null ? String(event.self_id) : null;
  const userId = (event.user_id != null ? String(event.user_id) : (event.sender?.user_id != null ? String(event.sender.user_id) : null));
  if (!userId) return;
  if (selfId && userId === selfId) return;

  const groupId = event.group_id ? String(event.group_id) : null;
  const isGroup = !!groupId;
  const plainText = extractPlainText(event.raw_message).trim();
  const hasImages = extractImageFromEvent(event).length > 0;

  if (isGroup && (plainText.length > 0 || hasImages) && (!selfId || userId !== selfId)) {
    const list = recentGroupMessages.get(String(groupId)) || [];
    list.push({ userId, text: plainText.length > 0 ? plainText.slice(0, 500) : '[图片]', ts: Date.now() });
    const maxLines = Math.max(5, Math.min(50, Number(pluginState.config.fakeHumanContextLines) || 5));
    if (list.length > maxLines) list.splice(0, list.length - maxLines);
    recentGroupMessages.set(String(groupId), list);
  }

  if (isGroup) {
    if (!shouldHandleGroup(groupId)) return;
    if (!shouldHandleUser(userId)) {
      const msg = cfg.messages?.blocked || DEFAULT_CONFIG.messages.blocked;
      if (msg) await sendGroup(ctx, groupId, formatReply(msg, { user_id: userId }));
      return;
    }
  } else {
    if (cfg.skipPrivate) return;
    if (!cfg.privateEnabled) return;
    if (!shouldHandleUser(userId)) {
      const msg = cfg.messages?.blocked || DEFAULT_CONFIG.messages.blocked;
      if (msg) await sendPrivate(ctx, userId, msg);
      return;
    }
  }

  if (plainText.length > 0) {
    const adminHandled = await tryHandleAdminCommand(ctx, plainText, groupId, userId, isGroup);
    if (adminHandled) return;
    if (isGroup && cfg.drawCommandsEnabled !== false && drawBotEngine) {
      const meta = parseDrawMetaCommand(plainText, cfg);
      if (meta && !meta.viaAdminPrefix) {
        const handled = await drawBotEngine.handleDrawMetaCommand(ctx, cfg, groupId, userId, meta);
        if (handled) return;
      }
    }
  }

  const trigger = shouldTrigger(ctx, event, plainText, selfId);
  if (!trigger) {
    if (isGroup && cfg.drawBotEnabled && plainText.length > 0 && drawBotEngine) {
      const drew = await drawBotEngine.handleDrawMessage(ctx, cfg, event, groupId, userId, plainText);
      if (drew) return;
    }
    if (isGroup && cfg.fakeHumanEnabled && (plainText.length > 0 || hasImages)) {
      await tryFakeHumanReply(ctx, event, groupId, userId, plainText);
    }
    return;
  }
  log('info', '触发通过', { triggerMode: cfg.triggerMode, isGroup: !!groupId, userId, groupId: groupId || 'private', plainPreview: plainText.slice(0, 80) }, 'chat');

  const userText = (trigger.useText || '').trim().slice(0, 2000);
  if (!userText && !hasImages) return;

  const cd = checkCooldown(groupId, userId);
  if (!cd.ok) {
    log('info', '冷却中，拒绝请求', { key: getConversationKey(groupId, userId), seconds: cd.seconds }, 'chat');
    const msg = formatReply(cfg.messages?.cooldown || DEFAULT_CONFIG.messages.cooldown, { seconds: cd.seconds });
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
    else await sendPrivate(ctx, userId, msg);
    return;
  }
  setCooldown(groupId, userId);

  const imageGen = isImageGenTrigger(plainText, userText, cfg);
  if (imageGen) {
    if (!canUseFeature(userId, 'imageGen')) {
      const msg = cfg.messages?.noFeaturePermission || DEFAULT_CONFIG.messages.noFeaturePermission;
      if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
      else await sendPrivate(ctx, userId, msg);
      return;
    }
    const prompt = (imageGen.prompt || '').trim() || '一只可爱的猫';
    log('info', '图像生成请求', { prompt: prompt.slice(0, 80), groupId: groupId || 'private', userId });
    const url = await createImage(prompt);
    if (url) {
      const imgMsg = '[CQ:image,url=' + url + ']';
      const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
      if (isGroup) await sendGroup(ctx, groupId, prefix + imgMsg);
      else await sendPrivate(ctx, userId, imgMsg);
      log('info', '图像已发送', { groupId: groupId || 'private', userId });
    } else {
      const errMsg = resolveTemplate(cfg, 'imageGenFailed', { user_id: userId });
      if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + errMsg);
      else await sendPrivate(ctx, userId, errMsg);
    }
    return;
  }

  if (!canUseFeature(userId, 'chat')) {
    const msg = cfg.messages?.noFeaturePermission || DEFAULT_CONFIG.messages.noFeaturePermission;
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
    else await sendPrivate(ctx, userId, msg);
    return;
  }

  const key = getConversationKey(groupId, userId);
  const userName = event.sender?.nickname || event.sender?.nick || event.sender?.card || '';
  const groupName = event.group_name || event.group_name || '';
  touchConversationMeta(key, { userId, userName, groupId: groupId || null, groupName });

  log('info', '处理对话请求', { key, groupId: groupId || 'private', userId, userName, isGroup, userTextLength: userText.length, userTextPreview: userText.slice(0, 120), hasImages }, 'chat');

  const userMessageId = getEventMessageId(event);
  await applyThinkingIndicator(ctx, cfg, event, isGroup, groupId, userId);

  const history = getHistory(key);
  log('debug', '当前对话历史条数', { key, count: history.length }, 'chat');
  let systemContent = (cfg.systemPrompt || DEFAULT_CONFIG.systemPrompt).trim() || '你是友好助手。';

  let imageUrls = [];
  let imageAnalysis = '';
  if (cfg.chatParseImage !== false && hasImages) {
    imageUrls = await resolveEventImages(ctx, event, 1, { forVision: true, requireBase64: true });
    if (imageUrls.length) {
      log('info', '已解析用户图片，交由 Kimi Code 分析', {
        count: imageUrls.length,
        format: imageUrls[0]?.startsWith('data:') ? 'base64' : 'url',
        payloadSize: imageUrls[0]?.length || 0
      }, 'image');
      imageAnalysis = await analyzeImageWithKimi(
        imageUrls,
        userText,
        (cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim()
      );
      if (imageAnalysis) {
        const qHint = userText ? `用户问题：${userText}` : '用户未附带文字';
        systemContent += `\n\n【图片信息（Kimi Code 根据用户问题从图中提取，供你参考；由你结合用户问题作答，Kimi 不负责最终回复）】\n${qHint}\n\n${imageAnalysis}`;
        log('info', 'Kimi 分析完成，交由主文字模型生成回复', { analysisLen: imageAnalysis.length }, 'chat');
      } else {
        log('warn', 'Kimi Code 未能分析图片', null, 'image');
        systemContent += '\n\n用户发送了图片，但图片分析暂时失败。请礼貌说明暂时看不清，并请用户文字描述。';
      }
    } else {
      log('warn', '消息含图片但解析失败', null, 'image');
    }
  }

  if (cfg.webSearchEnabled && imageUrls.length === 0) {
    const historySummary = history.slice(-4).map((h) => h.content).join(' ').slice(0, 300);
    const smartMode = (cfg.smartSearchQueryMode || 'fixed').toLowerCase();
    const triple = !!cfg.webSearchTriple;
    let searchResult = '';

    if (triple) {
      const queries = await aiGenerateSearchQueries(userText, historySummary);
      const fallback = (cfg.webSearchQuery || '').trim();
      const qList = queries.length >= 2 ? queries : (queries.length === 1 ? [queries[0], fallback, fallback].filter(Boolean) : [fallback, fallback, fallback].filter(Boolean)).slice(0, 3);
      log('info', '三路联合搜索开始', { provider: cfg.webSearchProvider, queries: qList, count: qList.length }, 'search');
      const parts = [];
      for (let i = 0; i < qList.length; i++) {
        const q = qList[i];
        const one = await webSearchMulti(q, cfg);
        if (one) parts.push(`【搜索 ${i + 1} - 关键词: "${q.slice(0, 50)}"】\n${one}`);
        log('debug', '单路搜索完成', { index: i + 1, query: q.slice(0, 60), resultLen: (one || '').length });
      }
      searchResult = parts.join('\n\n---\n\n');
    } else {
      let query = (cfg.webSearchQuery || '').trim();
      if (smartMode === 'ai') {
        const aiQuery = await aiGenerateSearchQuery(userText, historySummary);
        if (aiQuery) {
          query = aiQuery;
          log('info', 'AI 生成搜索词', { query });
        } else {
          log('info', 'AI 未生成搜索词，使用默认', { defaultQuery: query.slice(0, 60) });
        }
      }
      log('info', '联网搜索开始', { provider: cfg.webSearchProvider, query: query.slice(0, 100) }, 'search');
      searchResult = await webSearchMulti(query, cfg);
    }

    if (searchResult) {
      systemContent += '\n\n【以下为联网检索到的相关资料，供你参考并可在回复中结合人设使用】\n' + searchResult;
      log('info', '联网搜索完成，已注入人设', { resultLength: searchResult.length, triple }, 'search');
    } else {
      log('warn', '联网搜索无结果', { triple }, 'search');
    }
  }

  const userMessage = userText
    || (imageAnalysis ? '请根据图片信息和上下文自然地回复用户。' : '你好');
  const messages = [
    { role: 'system', content: systemContent },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  let replyText;
  let fromRateLimit = false;
  try {
    const result = await chatCompletion(messages, { usageKey: key });
    if (result && typeof result === 'object') {
      replyText = result.content !== undefined ? result.content : (result.text !== undefined ? result.text : '');
      if (result.ok === false && result.status === 429 && result.text) fromRateLimit = true;
    } else {
      replyText = typeof result === 'string' ? result : '';
    }
  } catch (err) {
    log('error', '对话生成异常', { message: err.message, hadImage: imageUrls.length > 0 }, 'chat');
    if (err.message === 'NO_KEY') {
      replyText = cfg.messages?.noKey || DEFAULT_CONFIG.messages.noKey;
    } else if (err.code === 'RATE_LIMIT' || err.message === 'RATE_LIMIT') {
      replyText = '当前模型请求过于频繁或配额已用完，请稍后再试，或在仪表盘更换其它文字模型。';
      fromRateLimit = true;
    } else if (imageUrls.length > 0 && !imageAnalysis) {
      replyText = '看到你发的图啦，但这边暂时没分析出来，能简单说一下图里是什么吗？';
    } else {
      replyText = cfg.messages?.error || DEFAULT_CONFIG.messages.error;
    }
  }

  if (!replyText) replyText = cfg.messages?.error || DEFAULT_CONFIG.messages.error;
  log('info', fromRateLimit ? '限频/配额用尽，已使用友好提示回复' : '回复已生成', { replyLength: replyText.length }, 'chat');

  pushHistory(key, 'user', historyLabelForUser(userText, imageUrls.length > 0));
  pushHistory(key, 'assistant', replyText);

  const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
  const needSpace = prefix && !/[\s\u3000]$/.test(prefix);
  const fullReply = prefix ? (prefix.trimEnd() + (needSpace ? ' ' : '') + replyText.trim()) : replyText.trim();

  if (isGroup) await sendGroup(ctx, groupId, fullReply);
  else await sendPrivate(ctx, userId, replyText.trim());
  log('info', '消息已发送', { key, groupId: groupId || 'private', userId, replyLength: replyText.length }, 'chat');

  if (userMessageId) await applyAfterReplyReaction(cfg, userMessageId);

  if (cfg.appendStickerAfterReply) {
    const faceId = await pickStickerFaceId(cfg, userText, replyText);
    if (faceId) {
      if (isGroup) await sendGroupFace(ctx, groupId, faceId);
      else await sendPrivateFace(ctx, userId, faceId);
    } else {
      log('debug', '无可用表情可发，已跳过', { poolSize: (cfg.stickerPool || []).length }, 'sticker');
    }
  }

  if (isGroup && cfg.pokeAfterReply && (cfg.pokeMode || 'never') !== 'never') {
    let doPoke = false;
    const mode = (cfg.pokeMode || 'never').toLowerCase();
    if (mode === 'always') doPoke = true;
    else if (mode === 'random') doPoke = Math.random() < (Math.max(0, Math.min(1, Number(cfg.pokeRandomChance) ?? 0.5)));
    else if (mode === 'ai') doPoke = await aiDecidePoke(userText, replyText);
    if (doPoke) await sendGroupPoke(ctx, groupId, userId);
  }
};

function getConversationsList() {
  const list = [];
  for (const [key, arr] of conversationHistory.entries()) {
    const meta = conversationMeta.get(key) || {};
    const parsed = parseConversationKey(key);
    list.push({
      key,
      groupId: parsed.groupId,
      userId: parsed.userId,
      isolationMode: parsed.isolationMode,
      userName: meta.userName || '',
      groupName: meta.groupName || '',
      lastMessage: meta.lastMessage || (arr.length ? String(arr[arr.length - 1]?.content || '').slice(0, 120) : ''),
      lastActivity: meta.lastActivity || 0,
      messageCount: Array.isArray(arr) ? arr.length : 0
    });
  }
  return list.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

const plugin_onevent = async () => {};
const plugin_get_config = async () => pluginState.config;
const plugin_set_config = async (ctx, config) => {
  if (config) {
    pluginState.config = { ...DEFAULT_CONFIG, ...pluginState.config, ...config };
    saveConfig(ctx);
  }
};
const plugin_cleanup = async () => {
  conversationHistory.clear();
  cooldownUntil.clear();
  drawBotEngine?.cleanup?.();
  pluginState.logger?.info?.('[chat-bot] 插件已卸载');
};

let plugin_config_ui = [];
function initConfigUi(ctx) {
  try {
    const C = ctx?.NapCatConfig;
    if (C && typeof C.combine === 'function' && typeof C.html === 'function' && typeof C.boolean === 'function') {
      plugin_config_ui = C.combine(
        C.boolean('enabled', '启用聊天', true, '响应 @ 与指令触发对话'),
        C.boolean('imageGenEnabled', '启用画图(@)', false, '需 @ 或指令触发，支持多 API'),
        C.boolean('drawBotEnabled', 'RunningHub 画图', false, '群内直接「画图」无需 @'),
        C.boolean('privateEnabled', '启用私聊', true, '私聊可直接对话'),
        C.boolean('thinkingIndicatorEnabled', '思考提示', false, '处理时发文字或表情回应'),
        C.boolean('appendStickerAfterReply', '回复后发表情', false, ''),
        C.boolean('fakeHumanEnabled', '伪人模式', false, '群聊随机插话'),
        C.boolean('webSearchEnabled', '联网搜索', false, ''),
        C.html(`
          <div style="padding:12px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;margin-top:12px;">
            <a href="#" onclick="window.open(window.location.origin+'/plugin/napcat-plugin-chat-bot/page/dashboard','_blank');return false;" style="color:#3b82f6;font-weight:600;">打开完整仪表盘</a>
            <span style="color:#94a3b8;font-size:13px;margin-left:8px">图表统计、画图预设、表情回应、对话管理等</span>
          </div>
        `)
      );
    }
  } catch (e) {
    plugin_config_ui = [];
  }
}
export { plugin_init, plugin_onmessage, plugin_onevent, plugin_get_config, plugin_set_config, plugin_cleanup, plugin_config_ui };
