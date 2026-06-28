/**
 * NapCatQQ 聊天插件
 * 多轮对话、@机器人 或 指令 触发，支持 DeepSeek/SiliconFlow/OpenAI 兼容 API
 * 配置：冷却、人设、温度、群组卡片、黑名单、指令等
 */

import fs from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { generateImage, IMAGE_GEN_PRESETS } from './lib/core/image-gen.mjs';
import { createDrawBot, DRAW_BOT_DEFAULTS, parseDrawMetaCommand } from './lib/core/draw-bot.mjs';
import { resolveTemplate, MESSAGE_TEMPLATE_DEFAULTS, normalizeMessagesConfig } from './lib/core/messages.mjs';
import {
  checkForUpdate as checkPluginUpdate,
  applyReleaseUpdate,
  readLocalVersion,
  compareSemver,
  UPDATE_REPO,
  UPDATE_REPO_URL
} from './lib/core/self-update.mjs';
import {
  listMirrors,
  getMirrorById,
  getDefaultMirrorTestUrl,
  getMirrorConfig,
  resolveUpdateDownloadUrl,
  resolveMirrorId,
  isMirrorBenchmarkFresh,
  testMirrorLatency,
  benchmarkMirrors,
  mergeBenchmarkResults,
  MIRROR_DIRECT_ID
} from './lib/core/github-mirrors.mjs';

const CHANGELOG_GITHUB_URL = `https://github.com/${UPDATE_REPO}/raw/master/CHANGELOG.md`;

import {
  smartSearchMulti,
  detectSearchRegion
} from './lib/core/smart-search.mjs';
import {
  tryReloadPluginAll,
  pingDebugService,
  collectPluginReloadIds
} from './lib/core/plugin-reload.mjs';
import {
  discoverSkills,
  skillsToApiList
} from './lib/agent/skills.mjs';
import {
  buildBuiltinTools,
  buildAgentSystemExtras,
  createAgentMcpHub,
  runAgentToolLoop,
  toolTraceToHistoryMeta
} from './lib/agent/agent-runtime.mjs';
import {
  buildQqSessionContextBlock,
  buildQqGroupContextBlock
} from './lib/agent/agent-qq.mjs';
import {
  searchNapCatCatalog,
  listNapCatCategories
} from './lib/napcat/napcat-api-gateway.mjs';
import { NAPCAT_API_CATALOG, NAPCAT_API_DOC_URL } from './lib/napcat/napcat-api-catalog.mjs';
import {
  searchBiliCatalog,
  listBiliCategories,
  describeBiliCookieStatus
} from './lib/bili/bili-api-gateway.mjs';
import { BILI_API_CATALOG, BILI_API_DOC_URL } from './lib/bili/bili-api-catalog.mjs';
import {
  openDatabase,
  closeDatabase,
  getDbPath,
  loadStoreFromDb,
  persistStoreToDb,
  migrateFromJson,
  getMeta
} from './lib/storage/sqlite-db.mjs';
import { getSqliteSetupState, runSqliteSetup, detectSqliteDriver, NPM_MIRRORS } from './lib/storage/sqlite-setup.mjs';
import {
  startBiliQrLogin,
  pollBiliQrLogin,
  getBiliSession,
  listBiliSessions,
  deleteBiliSession
} from './lib/bili/bili-auth.mjs';
import {
  detectBiliLoginIntent,
  initiateBiliChatLogin,
  scheduleBiliChatQrPoll,
  stopAllBiliChatQrPolls,
  buildBiliQrImageUrl
} from './lib/bili/bili-chat-login.mjs';
import { upsertUserProfile, listUserProfiles, getUserProfile, buildGroupUsersContextBlock } from './lib/storage/user-profiles.mjs';
import {
  recordObserveChat,
  recordObservePlannerStart,
  recordObservePlannerRound,
  recordObservePlannerEnd,
  recordObserveDecision,
  recordObserveOutbound,
  listObserveGroups,
  getObserveEvents,
  getObserveChat,
  getObserveStats,
  getObserveGlobalStats,
  startObserveLoop,
  stopObserveLoop,
  isObserveLoopRunning,
  stopAllObserveLoops,
  touchObserveGroupName,
  clearObserveGroup
} from './lib/maisaka/behavior-observer.mjs';
import {
  MAX_CHAT_FILE_BYTES,
  extractFileFromEvent,
  resolveEventFiles,
  buildFileContextBlock,
  buildWebAttachmentContextBlock,
  historyLabelForUserMedia,
  parseOutboundMediaSegments,
  segmentToOutboundMessage,
  isPreviewableTextFile,
  buildAgentFileSendBlock,
  enrichReplyWithAgentFiles
} from './lib/core/media-files.mjs';
import {
  DEFAULT_STICKER_SELECTION_PROMPT,
  DEFAULT_FAKEHUMAN_IDENTITY,
  DEFAULT_FAKEHUMAN_REPLY_STYLE,
  DEFAULT_FAKEHUMAN_REPLY_PROMPT,
  DEFAULT_FAKEHUMAN_PLANNER_PROMPT,
  DEFAULT_FAKEHUMAN_ACTION_CHOOSE_PROMPT,
  DEFAULT_FAKEHUMAN_IMAGE_DESCRIBE_PROMPT,
  DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION,
  DEFAULT_LEARN_STYLE_PROMPT,
  DEFAULT_LEARN_SLANG_PROMPT,
  DEFAULT_LEARN_BEHAVIOR_PROMPT,
  DEFAULT_EVALUATE_BEHAVIOR_PROMPT,
  renderPromptTemplate
} from './lib/maisaka/emoji-prompts.mjs';
import {
  selectStickerWithVision,
  touchStickerUsage
} from './lib/emoji/emoji-grid-select.mjs';
import { parseCqTextToSegments, buildAtSegments, flattenMessageSegments } from './lib/core/cq-message.mjs';
import {
  runMaisakaFakeHumanChat,
  runMaisakaLearning,
  loadMaisakaStore,
  saveMaisakaStore
} from './lib/maisaka/maisaka-fakehuman.mjs';
import { expandBurstReplies, pickFakeHumanRandomText, shouldUseFakeHumanTextList, getEffectiveFakeHumanPickMode, buildFakeHumanReplyerInstruction } from './lib/maisaka/fakehuman-burst.mjs';
import { resolveQqFaceId } from './lib/emoji/qq-face.mjs';
import {
  captureAndRegisterEmoji,
  extractEmojiUrlsFromEvent,
  pickRegisteredEmojiWithGrid,
  registeredEmojisToStickerCandidates,
  getRegisteredEmojis,
  DEFAULT_EMOJI_VLM_PROMPT,
  ensureEmojiRegistry
} from './lib/emoji/emoji-manager.mjs';
import {
  listEmojiLibrary,
  getEmojiLibraryStats,
  listEmojiSourceGroups,
  updateEmojiStatus,
  batchUpdateEmojiStatus,
  updateEmojiMeta,
  normalizeEmojiRegistry,
  deleteEmojiRecord,
  clearEmojiByStatus,
  findEmojiRecord,
  serializeEmojiItem,
  EMOJI_STATUSES
} from './lib/emoji/emoji-library.mjs';
import {
  listExpressions,
  getExpressionStats,
  listExpressionGroups,
  createExpression,
  updateExpression,
  reviewExpression,
  deleteExpression,
  clearExpressions,
  getExpressionSettings,
  findExpression
} from './lib/maisaka/expression-library.mjs';
import {
  listSlangs,
  getSlangStats,
  listSlangGroups,
  createSlang,
  updateSlang,
  reviewSlang,
  deleteSlang,
  clearSlangs,
  getSlangSettings,
  findSlang,
  parseSlangImport,
  importSlangs
} from './lib/maisaka/slang-library.mjs';
import {
  detectSkillhubCli,
  getSkillhubInstallDir,
  skillhubSearch,
  skillhubInstall,
  skillhubRemove,
  scanInstalledSkillhubSkills
} from './lib/skillhub/skillhub-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPluginVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    return String(raw.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

const PLUGIN_VERSION = readPluginVersion();

/** index 内联 Node/npm 检测（不 spawn，不依赖 lib 缓存） */
function inlineFindNpmCmd() {
  const nodeDir = path.dirname(process.execPath);
  const seen = new Set();
  const list = [];
  const add = (p) => {
    const n = path.normalize(String(p || '').trim());
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    list.push(n);
  };
  add(path.join(nodeDir, 'npm.cmd'));
  add(path.join(nodeDir, 'npm.exe'));
  add(path.join(nodeDir, 'npm'));
  for (const dir of String(process.env.Path || process.env.PATH || '').split(path.delimiter)) {
    const d = String(dir || '').trim();
    if (!d) continue;
    add(path.join(d, 'npm.cmd'));
    add(path.join(d, 'npm'));
  }
  if (process.platform === 'win32') {
    add('C:\\Program Files\\nodejs\\npm.cmd');
    add('C:\\Program Files (x86)\\nodejs\\npm.cmd');
  }
  for (const c of list) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '';
}

function inlineProbeNodeNpm() {
  const nodeCmd = process.execPath;
  const nodeVer = process.version || '';
  const npmCmd = inlineFindNpmCmd();
  let npmVer = 'ok';
  if (npmCmd) {
    try {
      const pkg = path.join(path.dirname(npmCmd), 'node_modules', 'npm', 'package.json');
      if (fs.existsSync(pkg)) {
        npmVer = String(JSON.parse(fs.readFileSync(pkg, 'utf-8')).version || 'ok');
      }
    } catch { /* ignore */ }
  }
  return {
    ok: !!nodeVer && !!npmCmd,
    node: nodeVer,
    npm: npmVer,
    nodeCmd,
    npmCmd: npmCmd || '(未找到 npm.cmd)',
    nodeError: nodeVer ? '' : '无 process.version',
    npmError: npmCmd ? '' : '未找到 npm.cmd（请安装 Node.js LTS）'
  };
}

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
  kimi: ['kimi-for-coding'],
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
  kimiApiKey: '',
  kimiApiUrl: KIMI_CODE_API,
  kimiModelsUrl: KIMI_CODE_MODELS_API,
  kimiCookies: '',
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
  advancedSamplingEnabled: false,
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
  logsRefreshIntervalSec: 2,
  logsScrollMode: 'down',
  webSearchEnabled: false,
  webSearchProvider: 'smart',
  webSearchRegion: 'auto',
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
  stickerSendNum: 25,
  stickerSelectionPrompt: DEFAULT_STICKER_SELECTION_PROMPT,
  stickerUsageStats: {},
  thinkingIndicatorEnabled: false,
  thinkingIndicatorMode: 'message',
  thinkingMessage: '正在思考…',
  thinkingEmojiId: '311',
  thinkingEmojiType: '1',
  afterReplyReactionEnabled: false,
  afterReplyRemoveThinkingEmoji: true,
  afterReplyEmojiId: '76',
  afterReplyEmojiMode: 'replace',
  reactionEmojiCatalog: [],
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
  kimiVisionCookies: '',
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
  fakeHumanReplyMode: 'ai',
  fakeHumanTextList: ['哈哈', '确实', '666', '笑死', '草', '好家伙', '可以'],
  fakeHumanEmojiList: ['哈', '6', '草', 'ok', '行', '可以'],
  fakeHumanAtChance: 0.25,
  fakeHumanAtWho: 'sender',
  fakeHumanSystemPrompt: '你是一个在群聊里偶尔插话的真人。根据当前这条群消息，回复一两句非常短的话（不超过30字），可以是吐槽、附和、表情、网络用语。不要长篇大论，不要重复消息内容。',
  fakeHumanBotName: '机器人',
  fakeHumanIdentity: DEFAULT_FAKEHUMAN_IDENTITY,
  fakeHumanReplyStyle: DEFAULT_FAKEHUMAN_REPLY_STYLE,
  fakeHumanReplyPrompt: DEFAULT_FAKEHUMAN_REPLY_PROMPT,
  fakeHumanPlannerPrompt: DEFAULT_FAKEHUMAN_PLANNER_PROMPT,
  fakeHumanActionChoosePrompt: DEFAULT_FAKEHUMAN_ACTION_CHOOSE_PROMPT,
  fakeHumanImageDescribePrompt: DEFAULT_FAKEHUMAN_IMAGE_DESCRIBE_PROMPT,
  fakeHumanMaisakaMode: true,
  fakeHumanGroupChatAttention: DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION,
  fakeHumanMultipleReplyStyle: [
    '你的风格平淡但不失讽刺，很简短，很白话，像贴吧老哥。',
    '用 1-2 个字回复，能一个字就不两个字。',
    '稍微阴阳怪气一点，但别太过分，像群友互怼。'
  ],
  fakeHumanMultipleProbability: 0.12,
  fakeHumanPersonalityStates: [],
  fakeHumanStateProbability: 0,
  fakeHumanEnableMemoryRecall: true,
  fakeHumanEnableExpressionLearning: true,
  fakeHumanEnableSlangLearning: true,
  fakeHumanEnableBehaviorLearning: true,
  fakeHumanSlangInjectLimit: 6,
  fakeHumanLearnSlangPrompt: DEFAULT_LEARN_SLANG_PROMPT,
  fakeHumanMemoryRecallLimit: 3,
  fakeHumanMemoryWindowSize: 20,
  fakeHumanMemoryMinIntervalSec: 120,
  fakeHumanMemoryMinNewMessages: 6,
  fakeHumanLearnStylePrompt: DEFAULT_LEARN_STYLE_PROMPT,
  fakeHumanLearnBehaviorPrompt: DEFAULT_LEARN_BEHAVIOR_PROMPT,
  fakeHumanEvaluateBehaviorPrompt: DEFAULT_EVALUATE_BEHAVIOR_PROMPT,
  fakeHumanPlannerLoop: true,
  fakeHumanPlannerMaxRounds: 5,
  observeLoopIntervalMs: 15000,
  emojiCacheEnabled: true,
  emojiAutoRegister: false,
  emojiUseRegistry: true,
  emojiMaxCacheSizeMb: 5,
  emojiVlmPrompt: DEFAULT_EMOJI_VLM_PROMPT,
  fakeHumanMaxLength: 80,
  fakeHumanBurstEnabled: true,
  fakeHumanBurstDelayMs: 800,
  fakeHumanBurstMaxLen: 28,
  fakeHumanBurstMaxMessages: 4,
  fakeHumanParseImage: true,
  fakeHumanVisionModel: '',
  fakeHumanEnableGroups: [],
  fakeHumanContextLines: 5,
  fakeHumanWebSearch: false,
  fakeHumanSyncPersona: true,
  fakeHumanFollowUpRounds: 2,
  fakeHumanFollowUpTimeoutMs: 120000,
  fakeHumanActionMode: 'reply',
  autoUpdateEnabled: true,
  autoUpdateIntervalHours: 24,
  autoUpdateLastCheckAt: 0,
  autoUpdateLastResult: '',
  updateMirrorMode: 'auto',
  updateMirrorId: MIRROR_DIRECT_ID,
  updateMirrorBenchmark: {},
  updateMirrorBestId: '',
  updateMirrorBestTestedAt: 0,
  agentToolsEnabled: false,
  agentMaxToolRounds: 6,
  skillsEnabled: true,
  skillsInjectMode: 'auto',
  skillsMaxHints: 4,
  skillsDirs: [],
  skillsAllowlist: [],
  mcpEnabled: false,
  mcpServers: [],
  skillhubRegistry: 'https://skill.xfyun.cn',
  skillhubToken: '',
  skillhubEnvReady: false,
  skillhubCliPath: '',
  agentShellEnabled: false,
  agentShellType: 'auto',
  agentShellTimeoutMs: 120000,
  agentShellBlockPatterns: [],
  agentShellVisible: true,
  agentToolWebSearchEnabled: true,
  agentToolCurrentTimeEnabled: true,
  agentToolMcpEnabled: true,
  agentToolShellExecEnabled: true,
  agentToolFileManagerEnabled: true,
  agentToolRegistryEnabled: true,
  agentToolExplorerEnabled: true,
  agentToolBrowserSnapshotEnabled: true,
  agentToolBrowserActEnabled: true,
  agentDangerGuardEnabled: true,
  agentDangerPasswordHash: '',
  agentDangerPasswordSalt: '',
  agentDangerRequireAdmin: true,
  agentDangerRequireWebConfirm: true,
  agentDangerConfirmDelaySec: 5,
  agentDangerConfirmExpireSec: 20,
  agentDangerOnSystemPower: true,
  agentDangerOnShellDelete: true,
  agentDangerOnFileDelete: true,
  agentDangerOnRegistryWrite: true,
  agentBrowserEnabled: false,
  agentBrowserEngine: 'playwright',
  agentBrowserUsePlaywright: true,
  agentBrowserHeadless: false,
  agentBrowserVisibleCloseDelayMs: 8000,
  agentBrowserUseEnvReady: false,
  agentBrowserUseSameLlm: true,
  agentBrowserUseProvider: 'openai',
  agentBrowserUseApiUrl: '',
  agentBrowserUseApiKey: '',
  agentBrowserUseModel: 'gpt-4o-mini',
  agentBrowserUseMaxSteps: 30,
  agentBrowserUseTimeoutMs: 300000,
  agentToolBrowserUseTaskEnabled: true,
  agentQqToolsEnabled: true,
  agentQqContextEnabled: true,
  agentQqGroupContextEnabled: true,
  agentQqGroupContextAuto: true,
  agentQqGroupContextLines: 10,
  agentToolQqUserInfoEnabled: true,
  agentToolQqGroupInfoEnabled: true,
  agentToolQqGroupContextEnabled: true,
  agentToolQqGroupExtendedEnabled: true,
  agentToolQqNapcatEnabled: true,
  agentToolQqNapcatAllowWrite: true,
  agentToolQqNapcatDangerGuard: true,
  agentToolQqNapcatMaxResultChars: 12000,
  agentBiliToolsEnabled: true,
  agentToolBiliCatalogEnabled: true,
  agentToolBiliCallEnabled: true,
  agentToolBiliQuickEnabled: true,
  agentToolBiliLoginQrEnabled: true,
  agentToolBiliAllowWrite: false,
  agentToolBiliDangerGuard: true,
  agentToolBiliMaxResultChars: 12000,
  agentToolBiliTimeoutMs: 30000,
  agentBrowserAdvancedEnabled: true,
  agentBrowserUserAgent: '',
  agentBrowserExtraHeaders: {},
  agentBrowserCookies: [],
  agentBrowserCookieSites: []
};

const conversationHistory = new Map();
const conversationMeta = new Map();
const cooldownUntil = new Map();
const fakeHumanLastTime = new Map();
const recentGroupMessages = new Map();
const fakeHumanTalkingTo = new Map();
let maisakaStoreCache = null;
let maisakaStorePathCache = '';
let sqliteDbRef = null;

function getConfigDir(ctx) {
  return path.dirname(getConfigPath(ctx));
}

async function initSqliteStore(ctx) {
  try {
    const configDir = getConfigDir(ctx);
    const { db, error } = await openDatabase(configDir, __dirname);
    if (!db) {
      log('warn', 'SQLite 未就绪（将使用 JSON 存储）', error || '', 'system');
      return null;
    }
    const mig = migrateFromJson(db, getMaisakaStorePath(ctx));
    if (mig.migrated) {
      log('info', 'maisaka-data.json 已迁移至 SQLite', mig.counts || {}, 'system');
    }
    sqliteDbRef = db;
    maisakaStoreCache = loadStoreFromDb(db);
    maisakaStorePathCache = getDbPath(configDir);
    return db;
  } catch (e) {
    log('warn', 'SQLite 初始化失败', e.message, 'system');
    return null;
  }
}

function getSqliteDb() {
  return sqliteDbRef;
}

function getMaisakaStorePath(ctx) {
  const cfgPath = getConfigPath(ctx);
  return path.join(path.dirname(cfgPath), 'maisaka-data.json');
}

function getMaisakaStore(ctx) {
  const p = sqliteDbRef ? getDbPath(getConfigDir(ctx)) : getMaisakaStorePath(ctx);
  if (maisakaStoreCache && maisakaStorePathCache === p) return maisakaStoreCache;
  if (sqliteDbRef) {
    maisakaStoreCache = loadStoreFromDb(sqliteDbRef);
  } else {
    maisakaStoreCache = loadMaisakaStore(getMaisakaStorePath(ctx));
  }
  maisakaStorePathCache = p;
  return maisakaStoreCache;
}

function persistMaisakaStore(ctx) {
  if (!maisakaStoreCache) return;
  if (sqliteDbRef) {
    persistStoreToDb(sqliteDbRef, maisakaStoreCache);
    return;
  }
  saveMaisakaStore(getMaisakaStorePath(ctx), maisakaStoreCache);
}

function appendRecentGroupBotMessage(groupId, selfId, botName, text) {
  const list = recentGroupMessages.get(String(groupId)) || [];
  list.push({ userId: selfId || 'self', userName: botName || 'SELF', text: String(text || '').slice(0, 500), ts: Date.now() });
  recordObserveChat(String(groupId), {
    userId: selfId || 'self',
    userName: botName || 'SELF',
    text: String(text || '').slice(0, 500),
    ts: Date.now(),
    isBot: true
  });
  const cfgLines = pluginState.config || {};
  const maxLines = Math.max(5, Math.min(50, Math.max(
    Number(cfgLines.fakeHumanContextLines) || 5,
    Number(cfgLines.agentQqGroupContextLines) || 10
  )));
  if (list.length > maxLines) list.splice(0, list.length - maxLines);
  recentGroupMessages.set(String(groupId), list);
}

/** 观察页：对指定群运行一次 Planner（仅记录，默认不出站） */
async function runObservePlannerForGroup(ctx, groupId, source = 'loop', executeOutbound = false) {
  const cfg = pluginState.config || {};
  const g = String(groupId);
  const contextLines = Math.max(1, Math.min(50, Number(cfg.fakeHumanContextLines) ?? 10));
  const recentContext = getFormattedRecentGroupContext(g, contextLines, cfg);
  const store = getMaisakaStore(ctx);
  const botName = (cfg.fakeHumanBotName || cfg.botDisplayName || '机器人').trim();
  recordObservePlannerStart(g, { source, contextLines, recentLines: recentContext.split('\n').filter(Boolean).length });
  const t0 = Date.now();
  try {
    const result = await runMaisakaFakeHumanChat({
      cfg,
      groupId: g,
      userId: '0',
      recentContext,
      plainText: source === 'loop' ? '[观察循环]' : '[观察触发]',
      personaContext: '',
      imageDesc: '',
      store,
      db: sqliteDbRef,
      llmText: (opts) => callFakeHumanLlm(cfg, opts),
      llmWithTools: (opts) => callFakeHumanLlmWithTools(cfg, opts),
      onPlannerRound: async (round) => {
        recordObservePlannerRound(g, round);
      },
      executePlannerTool: async (name, args) => {
        if (name === 'reply') return `[观察] 排程回复：${String(args.message || '').slice(0, 60)}`;
        if (name === 'send_emoji') return `[观察] 排程表情：${args.emotion || '自动'}`;
        if (name === 'send_file') return `[观察] 排程文件：${args.path || ''}`;
        if (name === 'no_action') return '本轮不发言（观察模式）';
        return 'ok';
      },
      buildReplySystemPrompt: (vars) => buildFakeHumanSystemPrompt({
        ...cfg,
        fakeHumanIdentity: vars.identity,
        fakeHumanReplyStyle: vars.replyStyle,
        _groupAttention: vars.groupChatAttentionBlock,
        _replyInstruction: vars.replyerOutputInstruction
      })
    });
    const outbound = result.outbound || [];
    recordObservePlannerEnd(g, {
      source,
      action: result.action,
      rounds: result.plan?.rounds || 0,
      reasoning: result.reasoning || result.plan?.reasoning || '',
      durationMs: Date.now() - t0,
      outboundCount: outbound.length,
      roundDetails: result.plan?.roundDetails || []
    });
    if (result.action === 'skip') {
      recordObserveDecision(g, 'no_action', { source, reasoning: result.reasoning || result.plan?.reasoning || '' });
    } else if (outbound.length) {
      recordObserveOutbound(g, { source, steps: outbound.length, preview: outbound.slice(0, 3) });
    }
    if (executeOutbound && outbound.length && cfg.fakeHumanEnabled) {
      await deliverFakeHumanOutbound(ctx, g, null, outbound, { cfg, store, recentContext, plainText: '', userId: '0' });
    }
    return result;
  } catch (e) {
    recordObservePlannerEnd(g, { source, error: e.message, durationMs: Date.now() - t0 });
    throw e;
  }
}

/** 对话中 B 站扫码登录：发二维码 + 后台轮询通知 */
async function handleBiliLoginInChat(ctx, { userId, groupId, isGroup, key }) {
  const cfg = pluginState.config || {};
  if (!sqliteDbRef) {
    try { await initSqliteStore(ctx); } catch { /* ignore */ }
  }
  if (!sqliteDbRef) {
    const err = 'SQLite 未就绪，请管理员在 Dashboard 一键部署 SQLite 后再试。';
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + err);
    else await sendPrivate(ctx, userId, err);
    return;
  }
  try {
    const login = await initiateBiliChatLogin(sqliteDbRef, userId);
    const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
    const cq = prefix + login.message + '\n[CQ:image,url=' + login.qrImageUrl + ']';
    if (isGroup) await sendGroup(ctx, groupId, cq);
    else await sendPrivate(ctx, userId, cq);
    pushHistory(key, 'user', '[B站登录请求]');
    pushHistory(key, 'assistant', login.message + ' [二维码已发送]', { tools: [{ type: 'bili_qr_login', sessionKey: login.sessionKey }] });
    makeBiliQrPollHandler(ctx, userId, groupId, isGroup)(login);
  } catch (e) {
    const err = 'B 站登录失败：' + e.message;
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + err);
    else await sendPrivate(ctx, userId, err);
  }
}

function makeBiliQrPollHandler(ctx, userId, groupId, isGroup) {
  const cfg = pluginState.config || {};
  return (login) => {
    if (!login?.sessionKey || !sqliteDbRef) return;
    scheduleBiliChatQrPoll({
      sessionKey: login.sessionKey,
      qqUserId: userId,
      db: sqliteDbRef,
      onConfirmed: async (st) => {
        const name = st.biliUname || st.session?.biliUname || '已绑定';
        const msg = `B 站登录成功！账号：${name}（mid ${st.biliMid || st.session?.biliMid || ''}）\n此后你的 B 站 API 请求将使用你的 Cookie。`;
        try {
          if (isGroup && groupId) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
          else await sendPrivate(ctx, userId, msg);
        } catch { /* ignore */ }
      },
      onExpired: async (st) => {
        const msg = st?.message || 'B 站二维码已过期，请再说「登录 B 站」重新获取。';
        try {
          if (isGroup && groupId) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
          else await sendPrivate(ctx, userId, msg);
        } catch { /* ignore */ }
      }
    });
  };
}

const tokenStats = {
  totalPrompt: 0,
  totalCompletion: 0,
  totalTokens: 0,
  byKey: new Map(),
  bySource: new Map(),
  byKeySource: new Map(),
  toolCalls: { total: 0, agent: 0, search: 0, browser: 0, shell: 0, mcp: 0 },
  recent: []
};
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
  const p = String(raw || 'smart').toLowerCase().trim();
  if (p === 'surper') return 'serper';
  if (p === 'travily') return 'tavily';
  const allowed = ['serper', 'duckduckgo', 'uapi', 'tavily', 'bocha', 'baidu', 'aliyun', 'both', 'three', 'tsu', 'all', 'smart', 'smart-domestic', 'smart-international'];
  return allowed.includes(p) ? p : 'smart';
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
  pluginManager: null,
  pluginId: 'napcat-plugin-chat-bot',
  runtimeCtx: null,
  updateInfo: null,
  updateRunning: false,
  updateProgress: null,
  updateProgressLog: [],
  autoUpdateTimer: null,
  mirrorBenchmarkRunning: false,
  mcpHub: null
};
let drawBotEngine = null;
let reactionCaptureSession = null;
let pendingReloadTimer = null;
const pendingRiskApprovals = new Map();

const REACTION_CAPTURE_COUNTDOWN_MS = 5000;
const REACTION_CAPTURE_WINDOW_MS = 45000;

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

function normalizeTokenSource(source) {
  const s = String(source || 'chat').trim().toLowerCase();
  if (['chat', 'agent', 'search', 'browser'].includes(s)) return s;
  return 'chat';
}

function recordToolCall(type) {
  const t = String(type || '').toLowerCase();
  tokenStats.toolCalls.total += 1;
  if (t === 'web_search' || t === 'search') tokenStats.toolCalls.search += 1;
  else if (t === 'browser') tokenStats.toolCalls.browser += 1;
  else if (t === 'shell') tokenStats.toolCalls.shell += 1;
  else if (t === 'mcp') tokenStats.toolCalls.mcp += 1;
  else tokenStats.toolCalls.agent += 1;
}

function recordTokenUsage(key, promptTokens, completionTokens, model, source = 'chat') {
  const total = (promptTokens || 0) + (completionTokens || 0);
  const useSource = normalizeTokenSource(source);
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
  if (!tokenStats.bySource.has(useSource)) tokenStats.bySource.set(useSource, { prompt: 0, completion: 0, total: 0, count: 0 });
  const sourceBucket = tokenStats.bySource.get(useSource);
  sourceBucket.prompt += promptTokens || 0;
  sourceBucket.completion += completionTokens || 0;
  sourceBucket.total += total;
  sourceBucket.count += 1;

  if (!tokenStats.byKeySource.has(useSource)) tokenStats.byKeySource.set(useSource, new Map());
  if (key) {
    const byKeyMap = tokenStats.byKeySource.get(useSource);
    if (!byKeyMap.has(key)) byKeyMap.set(key, { prompt: 0, completion: 0, total: 0 });
    const kb = byKeyMap.get(key);
    kb.prompt += promptTokens || 0;
    kb.completion += completionTokens || 0;
    kb.total += total;
  }

  tokenStats.recent.push({ ts: Date.now(), key, prompt: promptTokens || 0, completion: completionTokens || 0, total, model, source: useSource });
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
      if (pluginState.config.agentDangerPassword && !pluginState.config.agentDangerPasswordHash) {
        const migrated = hashDangerPassword(String(pluginState.config.agentDangerPassword));
        pluginState.config.agentDangerPasswordHash = migrated.hashHex;
        pluginState.config.agentDangerPasswordSalt = migrated.saltHex;
        pluginState.config.agentDangerPassword = '';
      }
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

/** 提取消息 segment 摘要，便于日志排查表情/图片等结构 */
function summarizeMessageSegments(event) {
  const segments = [];
  const msg = event?.message;
  if (Array.isArray(msg)) {
    for (const seg of msg) {
      if (!seg || typeof seg !== 'object') continue;
      const type = String(seg.type || 'unknown');
      const data = seg.data && typeof seg.data === 'object' ? { ...seg.data } : {};
      if (type === 'image' && data.url && String(data.url).length > 200) {
        data.url = String(data.url).slice(0, 200) + '…';
      }
      if (type === 'file' && data.url && String(data.url).length > 200) {
        data.url = String(data.url).slice(0, 200) + '…';
      }
      segments.push({ type, data });
    }
  }
  const sender = event?.sender && typeof event.sender === 'object' ? event.sender : {};
  return {
    message_id: event?.message_id ?? event?.message?.id ?? event?.message?.message_id ?? null,
    group_id: event?.group_id != null ? String(event.group_id) : null,
    user_id: event?.user_id != null ? String(event.user_id) : (sender.user_id != null ? String(sender.user_id) : null),
    sender_nick: String(sender.nickname ?? sender.nick ?? sender.card ?? '').trim() || undefined,
    message_type: event?.message_type ?? event?.sub_type ?? undefined,
    post_type: event?.post_type ?? undefined,
    raw_message: String(event?.raw_message || '').slice(0, 2000),
    segment_count: segments.length,
    segments
  };
}

function logIncomingGroupMessage(event) {
  if (!event?.group_id) return;
  const detail = summarizeMessageSegments(event);
  const types = detail.segments.map((s) => s.type);
  const hasFace = types.some((t) => /face|mface|emoji|marketface/i.test(t));
  log('info', hasFace ? '群消息入站（含表情 segment）' : '群消息入站', detail, hasFace ? 'sticker' : 'chat');
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

function isKimiCodeUrl(url) {
  return /api\.kimi\.com\/coding/i.test(String(url || ''));
}

function getKimiVisionConfig(cfg = pluginState.config) {
  return {
    apiKey: String(cfg.kimiVisionApiKey || '').trim(),
    apiUrl: normalizeCompatChatCompletionsUrl(String(cfg.kimiVisionApiUrl || KIMI_CODE_API).trim() || KIMI_CODE_API),
    modelsUrl: String(cfg.kimiVisionModelsUrl || KIMI_CODE_MODELS_API).trim() || KIMI_CODE_MODELS_API,
    cookies: String(cfg.kimiVisionCookies || '').trim()
  };
}

function getKimiChatConfig(cfg = pluginState.config) {
  return {
    apiKey: String(cfg.kimiApiKey || '').trim(),
    apiUrl: normalizeCompatChatCompletionsUrl(String(cfg.kimiApiUrl || KIMI_CODE_API).trim() || KIMI_CODE_API),
    modelsUrl: String(cfg.kimiModelsUrl || KIMI_CODE_MODELS_API).trim() || KIMI_CODE_MODELS_API
  };
}

function kimiCodeRequestHeaders(opts = {}, extra = {}) {
  const apiKey = String(opts.apiKey || '').trim();
  const cookies = String(opts.cookies || '').trim();
  const headers = { 'User-Agent': KIMI_CODE_USER_AGENT, ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (cookies) headers.Cookie = cookies;
  return headers;
}

function chatHeadersForEndpoint(endpoint, cfg = pluginState.config, extra = {}) {
  const provider = String(endpoint?.provider || cfg.apiProvider || 'siliconflow').toLowerCase();
  const kimiCode = endpoint?.kimiCode || provider === 'kimi' || isKimiCodeUrl(endpoint?.apiUrl);
  if (kimiCode) {
    const isChatKimi = provider === 'kimi';
    const fallbackCookies = isChatKimi ? '' : getKimiVisionConfig(cfg).cookies;
    return kimiCodeRequestHeaders({
      apiKey: endpoint?.apiKey,
      cookies: isChatKimi ? '' : (endpoint?.cookies ?? fallbackCookies)
    }, extra);
  }
  const headers = { ...extra };
  if (endpoint?.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
  if (endpoint?.cookies) headers.Cookie = endpoint.cookies;
  return headers;
}

function chatHeadersFromApiConfig(extra = {}) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, provider } = getApiConfig();
  return chatHeadersForEndpoint({ apiUrl, apiKey, provider }, cfg, extra);
}

/** 辅助 AI 请求体：与主对话一致，未开高级采样时不带 temperature（Kimi Code 等会 400） */
function buildAuxiliaryChatBody(cfg, { model, messages, max_tokens, temperature, tools, tool_choice }) {
  const body = {
    model: model || 'deepseek-ai/DeepSeek-V3',
    messages,
    stream: false,
    max_tokens: Math.max(1, Number(max_tokens) || 80)
  };
  if (cfg.advancedSamplingEnabled === true && temperature != null) {
    body.temperature = Math.max(0, Math.min(2, Number(temperature)));
  }
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
  }
  return body;
}

async function readApiErrorBody(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
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

function historyLabelForUser(text, hasImages, hasFiles = false) {
  return historyLabelForUserMedia(text, hasImages, hasFiles);
}

function extractKimiMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = String(message.content || '').trim();
  if (content) return content;
  return String(message.reasoning_content || '').trim();
}

async function fetchKimiModels(scope = 'vision') {
  const cfg = pluginState.config;
  const conf = scope === 'chat' ? getKimiChatConfig(cfg) : getKimiVisionConfig(cfg);
  if (!conf.apiKey) {
    log('warn', scope === 'chat' ? '未配置 Kimi 对话 API Key，无法加载模型列表' : '未配置视觉 API Key，无法加载模型列表', null, scope === 'chat' ? 'api' : 'image');
    return [KIMI_CODE_DEFAULT_MODEL];
  }
  try {
    const res = await fetch(conf.modelsUrl, {
      headers: kimiCodeRequestHeaders({
        apiKey: conf.apiKey,
        cookies: scope === 'chat' ? '' : conf.cookies
      })
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

/** 自定义视觉对话（支持多图，用于表情包拼图选择、伪人图片描述等） */
async function callVisionChatRaw({ systemPrompt, userText, imageUrls, model }) {
  const urls = (imageUrls || []).filter(Boolean).slice(0, 12);
  if (!urls.length) return '';
  const cfg = pluginState.config;
  const endpoints = buildVisionEndpointList(cfg);
  if (!endpoints.length) return '';
  const settings = getVisionFailoverSettings(cfg);
  const userContent = [
    { type: 'text', text: String(userText || '').trim() || '请查看图片并按要求回复。' },
    ...urls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))
  ];

  for (let ei = 0; ei < endpoints.length; ei++) {
    const endpoint = endpoints[ei];
    const useModel = (model || endpoint.model || KIMI_CODE_DEFAULT_MODEL).trim() || KIMI_CODE_DEFAULT_MODEL;
    try {
      const res = await fetchWithTimeout(endpoint.apiUrl, {
        method: 'POST',
        headers: visionHeadersForEndpoint(endpoint, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: 'system', content: String(systemPrompt || '').trim() || '你是视觉助手。' },
            { role: 'user', content: userContent }
          ],
          stream: false,
          temperature: 0.6,
          max_tokens: 400
        })
      }, settings.timeoutMs);
      const text = await res.text();
      if (!res.ok) continue;
      const data = text ? JSON.parse(text) : {};
      const out = extractKimiMessageText(data?.choices?.[0]?.message);
      if (out) return out;
    } catch (e) {
      log('warn', '视觉对话请求失败', { endpoint: endpoint.name, err: e.message }, 'image');
    }
  }
  return '';
}

/** 构建伪人 AI 系统提示（MaiBot 风格模板或旧版兼容） */
function buildFakeHumanSystemPrompt(cfg) {
  const identity = (cfg.fakeHumanIdentity || DEFAULT_FAKEHUMAN_IDENTITY).trim();
  const replyStyle = (cfg.fakeHumanReplyStyle || DEFAULT_FAKEHUMAN_REPLY_STYLE).trim();
  const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
  const customReply = (cfg.fakeHumanReplyPrompt || '').trim();
  const groupBlock = (cfg._groupAttention || cfg.fakeHumanGroupChatAttention || DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION).trim();
  const outputInstruction = (cfg._replyInstruction || `回复长度不超过${maxLen}字，不要换行。只输出回复正文。`).trim();
  if (customReply) {
    return renderPromptTemplate(customReply, {
      identity,
      reply_style: replyStyle,
      group_chat_attention_block: groupBlock,
      replyer_output_instruction: outputInstruction,
      bot_name: (cfg.fakeHumanBotName || '机器人').trim()
    });
  }
  const legacy = (cfg.fakeHumanSystemPrompt || DEFAULT_CONFIG.fakeHumanSystemPrompt).trim();
  return `${legacy}\n${groupBlock}\n${outputInstruction}`;
}

const ISOLATION_MODES = ['user_group', 'group', 'user', 'none'];

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
  if (mode === 'none') return 'global';
  if (mode === 'group') return `g:${g}`;
  if (mode === 'user') return `u:${u}`;
  return `g:${g}:u:${u}`;
}

function parseConversationKey(key) {
  const k = String(key || '');
  if (k === 'global') return { groupId: null, userId: null, isolationMode: 'none' };
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

function pushHistory(key, role, content, extra = {}) {
  if (!conversationHistory.has(key)) conversationHistory.set(key, []);
  const arr = conversationHistory.get(key);
  const entry = { role, content: String(content).slice(0, 4000) };
  if (extra.tools && Array.isArray(extra.tools) && extra.tools.length) {
    entry.tools = extra.tools.map((t) => {
      const tool = { type: String(t.type || '') };
      if (t.queries) tool.queries = t.queries.map((q) => String(q).slice(0, 200));
      else if (t.query) tool.query = String(t.query).slice(0, 200);
      if (t.prompt) tool.prompt = String(t.prompt).slice(0, 500);
      if (t.name) tool.name = String(t.name).slice(0, 120);
      if (t.url) tool.url = String(t.url).slice(0, 2000);
      if (t.result) tool.result = String(t.result).slice(0, 6000);
      return tool;
    });
  }
  if (extra.attachments && Array.isArray(extra.attachments) && extra.attachments.length) {
    entry.attachments = extra.attachments.map((a) => ({
      kind: String(a.kind || 'file').slice(0, 16),
      name: String(a.name || '').slice(0, 120),
      size: Math.max(0, Number(a.size) || 0),
      mime: String(a.mime || '').slice(0, 80),
      textSnippet: a.textSnippet ? String(a.textSnippet).slice(0, 6000) : '',
      dataUrl: a.dataUrl && String(a.dataUrl).length <= 500000 ? String(a.dataUrl) : ''
    }));
  }
  arr.push(entry);
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
    } else if (provider === 'kimi') {
      const kc = getKimiChatConfig(cfg);
      apiUrl = kc.apiUrl;
      apiKey = kc.apiKey;
      if (!model) model = KIMI_CODE_DEFAULT_MODEL;
    } else {
      apiUrl = SILICONFLOW_API;
      apiKey = String(cfg.siliconflowApiKey || '').trim();
      if (!model) model = 'deepseek-ai/DeepSeek-V3';
    }
  }
  apiUrl = normalizeCompatChatCompletionsUrl(apiUrl);
  return { apiUrl, apiKey, model, provider };
}

const API_PROVIDERS = ['siliconflow', 'deepseek', 'bailian', 'codingplan', 'openai', 'kimi', 'custom'];

function getProviderDefaultUrl(cfg, provider) {
  const p = String(provider || 'siliconflow').toLowerCase();
  if (p === 'deepseek') return DEEPSEEK_API;
  if (p === 'openai') return OPENAI_API;
  if (p === 'bailian') return (cfg.bailianApiUrl || BAILIAN_API).trim() || BAILIAN_API;
  if (p === 'codingplan') return (cfg.codingPlanApiUrl || CODING_PLAN_API).trim() || CODING_PLAN_API;
  if (p === 'kimi') return getKimiChatConfig(cfg).apiUrl;
  if (p === 'custom') return (cfg.customApiUrl || '').trim();
  return SILICONFLOW_API;
}

function getProviderApiKey(cfg, provider) {
  const p = String(provider || 'siliconflow').toLowerCase();
  if (p === 'deepseek') return String(cfg.deepseekApiKey || '').trim();
  if (p === 'openai') return String(cfg.openaiApiKey || '').trim();
  if (p === 'bailian') return String(cfg.bailianApiKey || '').trim();
  if (p === 'codingplan') return String(cfg.codingPlanApiKey || '').trim();
  if (p === 'kimi') return getKimiChatConfig(cfg).apiKey;
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
      model: String(raw?.model || '').trim(),
      kimiCode: raw?.kimiCode !== false,
      cookies: String(raw?.cookies || '').trim()
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
    kimiCode: raw?.kimiCode !== false,
    cookies: String(raw?.cookies || '').trim()
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
  if (provider === 'kimi' && !model) model = KIMI_CODE_DEFAULT_MODEL;
  apiUrl = normalizeCompatChatCompletionsUrl(apiUrl);
  const kimiCode = provider === 'kimi' || (entry?.kimiCode !== false && isKimiCodeUrl(apiUrl));
  const cookies = provider === 'kimi' ? '' : String(entry?.cookies || '').trim();
  return {
    id: entry?.id || 'primary',
    name: entry?.name || '主配置',
    enabled: entry?.enabled !== false,
    provider: API_PROVIDERS.includes(provider) ? provider : 'custom',
    apiUrl,
    apiKey,
    model,
    kimiCode,
    cookies,
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
  const kimiCode = entry?.kimiCode !== false && isKimiCodeUrl(apiUrl);
  const cookies = String(entry?.cookies || '').trim() || getKimiVisionConfig(cfg).cookies;
  return {
    id: entry?.id || 'vision-primary',
    name: entry?.name || '主视觉配置',
    enabled: entry?.enabled !== false,
    apiKey,
    apiUrl,
    modelsUrl,
    model,
    kimiCode,
    cookies,
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
    return kimiCodeRequestHeaders({
      apiKey: endpoint.apiKey,
      cookies: endpoint.cookies ?? getKimiVisionConfig().cookies
    }, extra);
  }
  const headers = { ...extra };
  if (endpoint?.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
  if (endpoint?.cookies) headers.Cookie = endpoint.cookies;
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

function shouldSkipWebSearchByHeuristic(text) {
  const t = String(text || '').trim().replace(/@[^\s\u2005]+/g, '').trim();
  if (!t || t.length <= 1) return true;
  if (/^(你好呀?|您好|在吗|在不在|嗨+|hi+|hello+|早上好|早安|午安|晚安|拜拜|再见|谢谢+|感谢+|多谢|好的|好哒|好哦|ok+|okay|嗯+|哦+|啊+)[\s!！。~～?？…]*$/i.test(t)) return true;
  if (/^(哈{2,}|6{3,}|233+)[\s!！。~～?？…]*$/i.test(t)) return true;
  if (/^(你是谁|你叫什么|你能做什么|怎么用)$/i.test(t)) return true;
  return false;
}

function buildSearchFallbackQuery(userText) {
  const raw = String(userText || '').trim().replace(/\[CQ:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  let t = raw.replace(/@[^\s\u2005]+/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[？?吗嘛呢吧啊呀]+$/g, '').trim();
  t = t.replace(/^(请问|问一下|想知道|帮我查|搜一下|查查|帮我搜|查询)/g, '').trim();
  t = t.replace(/(是谁|是什么|有哪些|叫什么|在哪|怎么样|多少|几个)$/g, '').trim();
  return (t || raw).slice(0, 120);
}

function parseAiSearchOutput(raw) {
  const text = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!text || /^skip$/i.test(text)) return { skip: true, query: null };
  return { skip: false, query: text.slice(0, 200) };
}

/** 使用 AI 判断是否需要搜索，并生成一条搜索关键词 */
async function aiGenerateSearchQuery(userMessage, historySummary) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return { skip: false, query: null };
  const systemPrompt = '你是搜索意图助手。根据用户问题判断是否需要联网搜索外部资料。\n\n只输出一行，不要解释：\n- 寒暄、感谢、纯闲聊、主观题、明显无需查资料 → 输出 SKIP\n- 需要查新闻、游戏角色/攻略/设定、百科事实、专业名词、人物事件、产品版本、实时信息等 → 输出一条简短中文或英文搜索关键词（不超过15个词，不要引号）';
  const context = historySummary ? `近期对话摘要：${historySummary.slice(0, 200)}。` : '';
  const userPrompt = `${context}用户当前问题：${String(userMessage).slice(0, 300)}`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 80,
        temperature: 0.2
      }))
    });
    if (!res.ok) {
      const errBody = await readApiErrorBody(res);
      log('warn', 'AI 生成搜索词 API 失败', {
        status: res.status,
        hint: res.status === 403 ? '需 KimiCLI User-Agent（已自动附加）' : (res.status === 400 ? '可能因未开高级采样却传了 temperature，已修复' : ''),
        body: errBody.slice(0, 200)
      }, 'search');
      return { skip: false, query: null };
    }
    const data = await res.json();
    return parseAiSearchOutput(data?.choices?.[0]?.message?.content || '');
  } catch (e) {
    log('warn', 'AI 生成搜索词失败', e.message, 'search');
    return { skip: false, query: null };
  }
}

/** 使用 AI 生成最多 3 条搜索关键词（用于三路联合搜索） */
async function aiGenerateSearchQueries(userMessage, historySummary) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return { skip: false, queries: [] };
  const systemPrompt = '你是搜索意图助手。根据用户问题判断是否需要联网搜索。\n\n若属于寒暄、感谢、纯闲聊、无需查资料，只输出一行：SKIP\n\n否则输出 1～3 条简短搜索关键词（每条不超过15个词），每行一条，不要编号、不要引号、不要解释。游戏、百科、新闻、实时信息类问题应输出关键词。';
  const context = historySummary ? `近期对话摘要：${historySummary.slice(0, 200)}。` : '';
  const userPrompt = `${context}用户当前问题：${String(userMessage).slice(0, 300)}`;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 120,
        temperature: 0.2
      }))
    });
    if (!res.ok) return { skip: false, queries: [] };
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if (/^skip$/im.test((text.split('\n')[0] || '').trim())) return { skip: true, queries: [] };
    const lines = text.split(/\n/).map((s) => s.replace(/^["'\d.)\s]+|["']+$/g, '').trim()).filter((s) => s.length > 0 && s.length <= 200 && !/^skip$/i.test(s));
    const queries = lines.slice(0, 3);
    if (queries.length) log('info', 'AI 生成多路搜索词', { count: queries.length, queries }, 'search');
    return { skip: false, queries };
  } catch (e) {
    log('warn', 'AI 生成多路搜索词失败', e.message, 'search');
    return { skip: false, queries: [] };
  }
}

/** 多渠道联网搜索：支持 Serper / DuckDuckGo / UAPI / Tavily / 博查 / 百度 / 阿里云 及 集合模式 */
async function webSearchMulti(query, cfg) {
  const provider = normalizeWebSearchProvider(cfg.webSearchProvider);
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return '';
  recordToolCall('search');

  const results = [];
  const runDuck = () => duckDuckGoSearch(q);
  const runSerper = () => (cfg.serperApiKey ? serperSearch(q, (cfg.serperApiKey || '').trim()) : Promise.resolve(''));
  const runUapi = () => (cfg.uapiApiKey ? uapiAggregateSearch(q, (cfg.uapiApiKey || '').trim(), { timeout_ms: cfg.uapiSearchTimeoutMs, sort: cfg.uapiSort, time_range: cfg.uapiTimeRange }) : Promise.resolve(''));
  const runTavily = () => (cfg.tavilyApiKey ? tavilySearch(q, (cfg.tavilyApiKey || '').trim()) : Promise.resolve(''));
  const runBocha = () => (cfg.bochaApiKey ? bochaWebSearch(q, (cfg.bochaApiKey || '').trim()) : Promise.resolve(''));
  const runBaidu = () => (cfg.baiduSearchApiKey ? baiduAiSearch(q, (cfg.baiduSearchApiKey || '').trim()) : Promise.resolve(''));
  const runAliyun = () => (cfg.aliyunIqsAccessKeyId && cfg.aliyunIqsAccessKeySecret ? aliyunUnifiedSearch(q, (cfg.aliyunIqsAccessKeyId || '').trim(), (cfg.aliyunIqsAccessKeySecret || '').trim()) : Promise.resolve(''));
  const runners = { duck: runDuck, serper: runSerper, uapi: runUapi, tavily: runTavily, bocha: runBocha, baidu: runBaidu, aliyun: runAliyun };

  if (provider === 'smart' || provider === 'smart-domestic' || provider === 'smart-international') {
    const regionOverride = provider === 'smart-domestic' ? 'domestic' : provider === 'smart-international' ? 'international' : null;
    const region = regionOverride || detectSearchRegion(q, cfg);
    log('info', '智能搜索开始', { region, query: q.slice(0, 80) }, 'search');
    return smartSearchMulti(q, cfg, runners, regionOverride);
  }

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
      max_tokens: options.max_tokens ?? maxTokens
    };
    if (cfg.advancedSamplingEnabled === true) {
      body.temperature = options.temperature ?? temperature;
      body.top_p = options.top_p ?? topP;
      body.top_k = options.top_k ?? topK;
      body.frequency_penalty = options.frequency_penalty ?? freqPenalty;
      body.presence_penalty = options.presence_penalty ?? presPenalty;
    }
    if (stop && stop.length) body.stop = stop;
    if (options.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice || 'auto';
    }
    if (enableThinking && provider === 'siliconflow') {
      body.extra_body = body.extra_body || {};
      body.extra_body.thinking_budget = options.thinking_budget ?? thinkingBudget;
    }

    log('info', '调用对话 API', {
      endpoint: endpoint.name,
      model: useModel,
      provider,
      messagesCount: messages.length,
      max_tokens: maxTokens,
      advancedSampling: cfg.advancedSamplingEnabled === true
    }, 'api');

    let res;
    let text = '';
    try {
      res = await fetchWithTimeout(endpoint.apiUrl, {
        method: 'POST',
        headers: chatHeadersForEndpoint(endpoint, cfg, { 'Content-Type': 'application/json' }),
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
    const msg = data?.choices?.[0]?.message || {};
    const content = (msg.content || '').trim();
    const tool_calls = msg.tool_calls || null;
    const usage = data?.usage;
    if (usage && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
      recordTokenUsage(options.usageKey, usage.prompt_tokens || 0, usage.completion_tokens || 0, useModel, options.usageSource);
      log('info', 'Token 使用', { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens, model: useModel, endpoint: endpoint.name }, 'token');
    }
    return { ok: true, content, tool_calls, usage, rawMessage: msg };
  }

  let last = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const first = await doRequest(baseModel);
    if (first.ok) {
      return {
        ok: true,
        content: first.content,
        tool_calls: first.tool_calls,
        usage: first.usage,
        rawMessage: first.rawMessage
      };
    }
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
        if (retry.ok) {
          return {
            ok: true,
            content: retry.content,
            tool_calls: retry.tool_calls,
            usage: retry.usage,
            rawMessage: retry.rawMessage
          };
        }
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

async function ensureAgentMcpHub(cfg, force = false) {
  if (!cfg?.mcpEnabled) {
    if (pluginState.mcpHub) {
      await pluginState.mcpHub.closeAll();
      pluginState.mcpHub = null;
    }
    return null;
  }
  if (!pluginState.mcpHub || force) {
    if (pluginState.mcpHub) await pluginState.mcpHub.closeAll();
    pluginState.mcpHub = createAgentMcpHub(cfg, {
      log: (lvl, msg, data) => log(lvl, msg, data, 'mcp')
    });
    await pluginState.mcpHub.reload();
  }
  const status = pluginState.mcpHub.getStatus();
  if (force || !status.length || status.some((s) => !s.connected)) {
    await pluginState.mcpHub.connectAll();
  }
  return pluginState.mcpHub;
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
  let avatar = String(raw?.avatar ?? raw?.group_avatar ?? raw?.face_url ?? raw?.faceUrl ?? '').trim();
  if (!avatar && groupId) avatar = buildGroupAvatarUrl(groupId);
  return { groupId, groupName, memberCount, avatar };
}

function buildGroupAvatarUrl(groupId, size = 100) {
  const gid = String(groupId || '').trim();
  if (!/^\d{5,12}$/.test(gid)) return '';
  const s = Math.max(40, Math.min(640, Number(size) || 100));
  return `https://p.qlogo.cn/gh/${gid}/${gid}/${s}`;
}

function extractNumericIdKey(raw) {
  const s = String(raw || '').trim();
  const parenAll = [...s.matchAll(/\((\d{5,12})\)/g)];
  if (parenAll.length) return parenAll[parenAll.length - 1][1];
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(\d{5,12})/);
  return m ? m[1] : '';
}

function normalizeNumericKeyedObject(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const id = extractNumericIdKey(k);
    if (id) out[id] = v;
  }
  return out;
}

function buildQqAvatarUrl(userId, size = 100) {
  const uid = String(userId || '').trim();
  if (!/^\d{5,12}$/.test(uid)) return '';
  return `https://q1.qlogo.cn/g?b=qq&nk=${uid}&s=${Math.max(40, Math.min(640, Number(size) || 100))}`;
}

function normalizeUserProfile(raw, userId = '') {
  const uid = String(userId || raw?.user_id || raw?.uin || raw?.userId || '').trim();
  const nickname = String(raw?.nickname ?? raw?.nick ?? raw?.nick_name ?? raw?.showName ?? '').trim();
  let avatar = String(
    raw?.avatar ?? raw?.avatar_url ?? raw?.avatarUrl ?? raw?.head_url ?? raw?.headUrl ?? raw?.faceUrl ?? ''
  ).trim();
  if (!avatar && uid) avatar = buildQqAvatarUrl(uid);
  return { userId: uid, nickname, avatar };
}

async function fetchStrangerProfile(userId) {
  const detailed = await fetchStrangerInfoDetailed(userId);
  if (!detailed) return null;
  return { userId: detailed.userId, nickname: detailed.nickname, avatar: detailed.avatar };
}

async function fetchStrangerInfoDetailed(userId, { noCache = false } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const payload = { user_id: uid };
    if (noCache) payload.no_cache = true;
    const res = await callAction('get_stranger_info', payload);
    const data = res?.data ?? res ?? {};
    const profile = normalizeUserProfile(data, uid);
    return {
      userId: uid,
      uid: String(data.uid ?? '').trim(),
      nickname: profile.nickname || String(data.nickname ?? data.nick ?? '').trim(),
      qid: String(data.qid ?? data.QID ?? '').trim(),
      sex: data.sex ?? data.gender ?? '',
      age: data.age ?? '',
      qqLevel: data.qqLevel ?? data.qq_level ?? data.level ?? '',
      longNick: String(data.long_nick ?? data.sign ?? data.signature ?? '').trim(),
      regTime: data.reg_time ?? data.regTime ?? '',
      isVip: data.is_vip ?? data.isVip ?? false,
      isYearsVip: data.is_years_vip ?? data.isYearsVip ?? false,
      vipLevel: data.vip_level ?? data.vipLevel ?? '',
      remark: String(data.remark ?? '').trim(),
      status: data.status ?? '',
      loginDays: data.login_days ?? data.loginDays ?? '',
      avatar: profile.avatar || buildQqAvatarUrl(uid)
    };
  } catch (e) {
    log('debug', '获取陌生人信息失败', { userId: uid, err: e.message }, 'config');
    return null;
  }
}

async function fetchGroupProfile(groupId, { detail = true } = {}) {
  const gid = String(groupId || '').trim();
  if (!gid) return null;
  try {
    let data = {};
    if (detail) {
      try {
        const detailRes = await callAction('get_group_detail_info', { group_id: gid });
        data = detailRes?.data ?? detailRes ?? {};
      } catch {
        /* 回退 get_group_info */
      }
    }
    if (!data.group_id && !data.group_name) {
      const res = await callAction('get_group_info', { group_id: gid });
      data = res?.data ?? res ?? {};
    }
    let avatar = String(data.group_avatar ?? data.avatar ?? data.face_url ?? data.faceUrl ?? '').trim();
    if (!avatar) avatar = buildGroupAvatarUrl(gid);
    return {
      groupId: gid,
      groupName: String(data.group_name ?? data.name ?? '').trim(),
      memberCount: Number(data.member_count ?? data.memberCount ?? 0) || 0,
      maxMemberCount: Number(data.max_member_count ?? data.maxMemberCount ?? 0) || 0,
      groupCreateTime: data.group_create_time ?? data.create_time ?? '',
      groupLevel: data.group_level ?? data.level ?? '',
      groupAllShut: data.group_all_shut ?? data.groupAllShut ?? null,
      groupRemark: String(data.group_remark ?? data.groupRemark ?? '').trim(),
      avatar
    };
  } catch (e) {
    log('debug', '获取群信息失败', { groupId: gid, err: e.message }, 'config');
    return { groupId: gid, groupName: '', memberCount: 0, avatar: buildGroupAvatarUrl(gid) };
  }
}

async function fetchGroupList({ noCache = false } = {}) {
  try {
    const payload = noCache ? { no_cache: true } : {};
    const raw = await callAction('get_group_list', payload);
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
    return list.map((g) => ({
      groupId: String(g.group_id ?? g.groupId ?? ''),
      groupName: String(g.group_name ?? g.name ?? '').trim(),
      memberCount: Number(g.member_count ?? g.memberCount ?? 0) || 0,
      maxMemberCount: Number(g.max_member_count ?? g.maxMemberCount ?? 0) || 0,
      groupAllShut: g.group_all_shut ?? g.groupAllShut ?? null,
      groupRemark: String(g.group_remark ?? g.groupRemark ?? '').trim()
    })).filter((g) => g.groupId);
  } catch (e) {
    log('debug', '获取群列表失败', e.message, 'config');
    return [];
  }
}

async function fetchGroupMemberList(groupId, { noCache = false, limit = 50 } = {}) {
  const gid = String(groupId || '').trim();
  if (!gid) return [];
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  try {
    const payload = { group_id: gid };
    if (noCache) payload.no_cache = true;
    const raw = await callAction('get_group_member_list', payload);
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
    return list.slice(0, cap).map((m) => ({
      userId: String(m.user_id ?? m.userId ?? ''),
      nickname: String(m.nickname ?? m.nick ?? '').trim(),
      card: String(m.card ?? m.group_card ?? '').trim(),
      role: String(m.role ?? '').trim(),
      title: String(m.title ?? '').trim(),
      level: m.level ?? m.qq_level ?? '',
      joinTime: m.join_time ?? m.joinTime ?? '',
      lastSentTime: m.last_sent_time ?? m.lastSentTime ?? ''
    })).filter((m) => m.userId);
  } catch (e) {
    log('debug', '获取群成员列表失败', { groupId: gid, err: e.message }, 'config');
    return [];
  }
}

async function fetchGroupMemberInfoDetail(groupId, userId, { noCache = false } = {}) {
  const gid = String(groupId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) return null;
  try {
    const payload = { group_id: gid, user_id: uid };
    if (noCache) payload.no_cache = true;
    const res = await callAction('get_group_member_info', payload);
    const data = res?.data ?? res ?? {};
    return {
      userId: uid,
      groupId: gid,
      nickname: String(data.nickname ?? data.nick ?? '').trim(),
      card: String(data.card ?? data.group_card ?? '').trim(),
      sex: data.sex ?? data.gender ?? '',
      age: data.age ?? '',
      role: String(data.role ?? '').trim(),
      title: String(data.title ?? '').trim(),
      level: data.level ?? '',
      qqLevel: data.qq_level ?? data.qqLevel ?? '',
      joinTime: data.join_time ?? data.joinTime ?? '',
      lastSentTime: data.last_sent_time ?? data.lastSentTime ?? '',
      shutUpTimestamp: data.shut_up_timestamp ?? data.shutUpTimestamp ?? '',
      area: String(data.area ?? '').trim(),
      isRobot: data.is_robot ?? data.isRobot ?? false,
      unfriendly: data.unfriendly ?? false
    };
  } catch (e) {
    log('debug', '获取群成员详情失败', { groupId: gid, userId: uid, err: e.message }, 'config');
    return null;
  }
}

async function fetchGroupNotices(groupId) {
  const gid = String(groupId || '').trim();
  if (!gid) return [];
  try {
    const raw = await callAction('_get_group_notice', { group_id: gid });
    const list = Array.isArray(raw) ? raw : (raw?.data || []);
    return list.map((n) => ({
      noticeId: String(n.notice_id ?? n.noticeId ?? ''),
      senderId: String(n.sender_id ?? n.senderId ?? ''),
      publishTime: n.publish_time ?? n.publishTime ?? '',
      readNum: n.read_num ?? n.readNum ?? '',
      message: n.message ?? n.content ?? ''
    }));
  } catch (e) {
    log('debug', '获取群公告失败', { groupId: gid, err: e.message }, 'config');
    return [];
  }
}

async function fetchGroupEssenceMessages(groupId) {
  const gid = String(groupId || '').trim();
  if (!gid) return [];
  try {
    const raw = await callAction('get_essence_msg_list', { group_id: gid });
    const list = Array.isArray(raw) ? raw : (raw?.data || []);
    return list.map((m) => ({
      messageId: String(m.message_id ?? m.messageId ?? ''),
      senderId: String(m.sender_id ?? m.senderId ?? ''),
      senderNick: String(m.sender_nick ?? m.senderNick ?? '').trim(),
      operatorId: String(m.operator_id ?? m.operatorId ?? ''),
      operatorNick: String(m.operator_nick ?? m.operatorNick ?? '').trim(),
      operatorTime: m.operator_time ?? m.operatorTime ?? '',
      content: m.content ?? m.message ?? ''
    }));
  } catch (e) {
    log('debug', '获取群精华消息失败', { groupId: gid, err: e.message }, 'config');
    return [];
  }
}

async function fetchGroupShutList(groupId) {
  const gid = String(groupId || '').trim();
  if (!gid) return [];
  try {
    const raw = await callAction('get_group_shut_list', { group_id: gid });
    const list = Array.isArray(raw) ? raw : (raw?.data || []);
    return list.map((m) => ({
      userId: String(m.user_id ?? m.userId ?? ''),
      nickname: String(m.nickname ?? m.nick ?? '').trim(),
      shutUpTime: m.shut_up_time ?? m.shutUpTime ?? m.shut_up_timestamp ?? ''
    })).filter((m) => m.userId);
  } catch (e) {
    log('debug', '获取群禁言列表失败', { groupId: gid, err: e.message }, 'config');
    return [];
  }
}

async function fetchGroupMemberProfile(groupId, userId) {
  const gid = String(groupId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) return null;
  try {
    const res = await callAction('get_group_member_info', { group_id: gid, user_id: uid });
    const data = res?.data ?? res ?? {};
    return {
      userId: uid,
      groupNickname: String(data.nickname ?? data.nick ?? '').trim(),
      card: String(data.card ?? data.group_card ?? '').trim(),
      role: String(data.role ?? '').trim(),
      title: String(data.title ?? '').trim(),
      joinTime: data.join_time ?? data.joinTime ?? '',
      lastSentTime: data.last_sent_time ?? data.lastSentTime ?? ''
    };
  } catch (e) {
    log('debug', '获取群成员信息失败', { groupId: gid, userId: uid, err: e.message }, 'config');
    return null;
  }
}

async function resolveGroupMemberIdByName(groupId, query) {
  const q = String(query || '').trim().replace(/^@+/, '');
  if (!q || !groupId) return null;
  if (/^\d{5,12}$/.test(q)) return q;
  try {
    const raw = await callAction('get_group_member_list', { group_id: String(groupId) });
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
    const lq = q.toLowerCase();
    const exact = [];
    const partial = [];
    for (const m of list) {
      const uid = m.user_id != null ? String(m.user_id) : (m.userId != null ? String(m.userId) : '');
      if (!uid) continue;
      const card = String(m.card ?? m.group_card ?? '').trim();
      const nick = String(m.nickname ?? m.nick ?? '').trim();
      const names = [card, nick].filter(Boolean).map((s) => s.toLowerCase());
      if (names.some((n) => n === lq)) exact.push(uid);
      else if (names.some((n) => n.includes(lq))) partial.push(uid);
    }
    return exact[0] || partial[0] || null;
  } catch (e) {
    log('debug', '群成员昵称解析失败', { groupId, query: q, err: e.message }, 'config');
    return null;
  }
}

async function resolveQqUserQuery(query, groupId) {
  const q = String(query || '').trim().replace(/^@+/, '');
  if (!q) return { error: '查询内容为空' };

  let userId = null;
  if (/^\d{5,12}$/.test(q)) {
    userId = q;
  } else if (groupId) {
    userId = await resolveGroupMemberIdByName(groupId, q);
  }

  if (!userId) {
    const matches = await searchUsersByQuery(q, 8);
    if (matches.length === 1) userId = matches[0].userId;
    else if (matches.length > 1) {
      return {
        multiple: true,
        candidates: matches.map((m) => ({ userId: m.userId, nickname: m.nickname || m.userName || '' }))
      };
    } else {
      return { error: `未找到用户：${q}${groupId ? '（已在当前群成员中搜索）' : ''}` };
    }
  }

  const strangerRes = await callAction('get_stranger_info', { user_id: userId }).catch(() => null);
  const strangerData = strangerRes?.data ?? strangerRes ?? {};
  const stranger = normalizeUserProfile(strangerData, userId);
  touchUserProfileCache(pluginState.config, stranger);

  const member = groupId ? await fetchGroupMemberProfile(groupId, userId) : null;
  return {
    userId,
    nickname: stranger.nickname || member?.groupNickname || member?.card || '',
    card: member?.card || '',
    groupNickname: member?.groupNickname || '',
    qid: strangerData.qid ?? strangerData.QID ?? '',
    sex: strangerData.sex ?? strangerData.gender ?? '',
    age: strangerData.age ?? '',
    level: strangerData.level ?? strangerData.qq_level ?? '',
    sign: String(strangerData.sign ?? strangerData.signature ?? '').trim(),
    regTime: strangerData.reg_time ?? strangerData.regTime ?? '',
    role: member?.role || '',
    title: member?.title || '',
    avatar: stranger.avatar || ''
  };
}

function extractAtQqFromMessage(rawMessage, event) {
  const ids = [];
  const re = /\[CQ:at,qq=(\d+)\]/gi;
  let m;
  while ((m = re.exec(String(rawMessage || '')))) ids.push(m[1]);
  if (Array.isArray(event?.message)) {
    for (const seg of event.message) {
      if (seg?.type === 'at' && seg.data?.qq && String(seg.data.qq) !== 'all') {
        ids.push(String(seg.data.qq));
      }
    }
  }
  return [...new Set(ids.filter(Boolean))];
}

function getFormattedRecentGroupContext(groupId, limit, cfg = pluginState.config) {
  const n = Math.max(1, Math.min(50, Number(limit) || Number(cfg?.agentQqGroupContextLines) || 10));
  const list = recentGroupMessages.get(String(groupId)) || [];
  return list.slice(-n).map((item) => {
    const label = item.userName ? `${item.userName}(${item.userId})` : `用户${item.userId}`;
    return `${label}: ${item.text}`;
  }).join('\n');
}

function createQqApi(session) {
  const cfg = pluginState.config || {};
  return {
    getSession: () => session,
    async fetchUserProfile(userId) {
      return fetchStrangerProfile(userId);
    },
    async fetchStrangerInfo(userId, opts) {
      return fetchStrangerInfoDetailed(userId, opts);
    },
    async fetchGroupProfile(groupId, opts) {
      const profile = await fetchGroupProfile(groupId, opts);
      if (profile) touchGroupProfileCache(cfg, profile);
      return profile;
    },
    async fetchGroupList(opts) {
      return fetchGroupList(opts);
    },
    async fetchGroupMemberList(groupId, opts) {
      return fetchGroupMemberList(groupId, opts);
    },
    async fetchGroupMemberInfo(groupId, userId, opts) {
      return fetchGroupMemberInfoDetail(groupId, userId, opts);
    },
    async fetchGroupNotices(groupId) {
      return fetchGroupNotices(groupId);
    },
    async fetchGroupEssenceMessages(groupId) {
      return fetchGroupEssenceMessages(groupId);
    },
    async fetchGroupShutList(groupId) {
      return fetchGroupShutList(groupId);
    },
    async resolveUserQuery(query) {
      return resolveQqUserQuery(query, session.groupId);
    },
    getGroupRecentContext(limit) {
      if (!session.groupId) return '';
      return getFormattedRecentGroupContext(session.groupId, limit, cfg);
    },
    async callNapCatAction(action, params) {
      return callAction(String(action || '').trim(), params || {});
    }
  };
}

function buildAgentQqContextExtras(cfg, session) {
  let extra = buildQqSessionContextBlock(cfg, session);
  let groupContextMeta = null;
  if (session.groupId && cfg.agentQqGroupContextEnabled !== false && cfg.agentQqGroupContextAuto !== false) {
    const lines = getFormattedRecentGroupContext(session.groupId, cfg.agentQqGroupContextLines, cfg);
    if (lines) {
      extra += buildQqGroupContextBlock(cfg, lines);
      groupContextMeta = { type: 'qq_group_context', name: 'builtin_qq_group_context', result: lines.slice(0, 4000) };
    }
  }
  if (sqliteDbRef && session.groupId) {
    const usersBlock = buildGroupUsersContextBlock(sqliteDbRef, session.groupId, Math.max(1, Math.min(20, Number(cfg.agentQqGroupUsersLimit) || 8)));
    if (usersBlock) extra += '\n' + usersBlock;
  }
  return { extra, groupContextMeta };
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
        avatar: buildQqAvatarUrl(uid),
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
    avatar: profile.avatar || buildGroupAvatarUrl(profile.groupId),
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
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((item) => ({
    id: String(item.id ?? '').trim(),
    name: String(item.name || item.id || '').trim(),
    type: String(item.type || '1'),
    glyph: String(item.glyph || item.name || item.id || '?').slice(0, 4)
  })).filter((x) => x.id);
}

function extractFaceReactionsFromEvent(event) {
  const out = [];
  const seen = new Set();
  const add = (id, name, meta = {}) => {
    const idStr = String(id ?? '').trim();
    if (!idStr || seen.has(idStr)) return;
    seen.add(idStr);
    const label = String(name || '').replace(/^\[|\]$/g, '').trim() || `表情${idStr}`;
    const glyph = label.length <= 4 ? label : label.slice(0, 2);
    out.push({ id: idStr, name: label, type: '1', glyph, ...meta });
  };

  const msg = event?.message;
  if (Array.isArray(msg)) {
    for (const seg of msg) {
      const type = String(seg?.type || '').toLowerCase();
      const d = seg?.data && typeof seg.data === 'object' ? seg.data : {};
      const raw = d.raw && typeof d.raw === 'object' ? d.raw : {};
      if (type === 'face') {
        add(d.id ?? raw.faceIndex, raw.faceText || d.text, {
          source: 'face',
          faceType: raw.faceType ?? d.face_type
        });
      } else if (type === 'mface' || type === 'marketface') {
        add(d.id ?? d.emoji_id ?? d.face_id ?? d.url, d.summary || d.name || d.title || d.emoji_name, {
          source: type
        });
      }
    }
  }

  const rawMsg = String(event?.raw_message || '');
  for (const m of rawMsg.matchAll(/\[CQ:face[^\]]*?\bid=(\d+)/gi)) {
    add(m[1], '');
  }
  return out;
}

function getReactionCapturePublic(session = reactionCaptureSession) {
  if (!session) return null;
  const now = Date.now();
  let countdownRemaining = 0;
  let captureRemaining = 0;
  if (session.status === 'countdown' && session.countdownEndsAt) {
    countdownRemaining = Math.max(0, Math.ceil((session.countdownEndsAt - now) / 1000));
  }
  if ((session.status === 'countdown' || session.status === 'waiting') && session.captureEndsAt) {
    captureRemaining = Math.max(0, Math.ceil((session.captureEndsAt - now) / 1000));
  }
  return {
    id: session.id,
    groupId: session.groupId,
    targetUserId: session.targetUserId,
    status: session.status,
    countdownRemaining,
    captureRemaining,
    result: session.result || null,
    pendingEntry: session.pendingEntry || null,
    error: session.error || null,
    catalogSize: normalizeReactionCatalog(pluginState.config.reactionEmojiCatalog).length
  };
}

function clearReactionCaptureTimers(session = reactionCaptureSession) {
  if (!session) return;
  if (session._promptTimer) clearTimeout(session._promptTimer);
  if (session._expireTimer) clearTimeout(session._expireTimer);
  session._promptTimer = null;
  session._expireTimer = null;
}

function cancelReactionCapture(reason = 'cancelled') {
  if (!reactionCaptureSession) return;
  clearReactionCaptureTimers(reactionCaptureSession);
  if (reactionCaptureSession.status === 'countdown' || reactionCaptureSession.status === 'waiting' || reactionCaptureSession.status === 'pending_remark') {
    reactionCaptureSession.status = reason === 'cancelled' ? 'cancelled' : reason;
  }
  log('info', '表情截取会话已结束', { reason, sessionId: reactionCaptureSession.id }, 'reaction');
}

async function startReactionCapture(ctx, { groupId, userId }) {
  const gid = String(groupId || '').trim();
  const uid = String(userId || '').trim();
  if (!gid || !uid) throw new Error('缺少群号或用户 QQ');

  cancelReactionCapture('replaced');
  const now = Date.now();
  const sessionId = `cap_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const session = {
    id: sessionId,
    groupId: gid,
    targetUserId: uid,
    status: 'countdown',
    startedAt: now,
    countdownEndsAt: now + REACTION_CAPTURE_COUNTDOWN_MS,
    captureEndsAt: now + REACTION_CAPTURE_COUNTDOWN_MS + REACTION_CAPTURE_WINDOW_MS,
    result: null,
    error: null
  };
  reactionCaptureSession = session;

  session._promptTimer = setTimeout(async () => {
    if (!reactionCaptureSession || reactionCaptureSession.id !== sessionId) return;
    if (reactionCaptureSession.status !== 'countdown') return;
    reactionCaptureSession.status = 'waiting';
    const prompt = `[CQ:at,qq=${uid}] 请在 ${Math.round(REACTION_CAPTURE_WINDOW_MS / 1000)} 秒内发送一个 QQ 表情（单个 emoji 即可），我将收录到表情回应库~`;
    try {
      await sendGroup(ctx, gid, prompt);
      log('info', '表情截取：已 @ 用户请求发送表情', { groupId: gid, userId: uid }, 'reaction');
    } catch (e) {
      reactionCaptureSession.status = 'error';
      reactionCaptureSession.error = e.message || '发送群提示失败';
      clearReactionCaptureTimers(reactionCaptureSession);
    }
  }, REACTION_CAPTURE_COUNTDOWN_MS);

  session._expireTimer = setTimeout(() => {
    if (!reactionCaptureSession || reactionCaptureSession.id !== sessionId) return;
    if (reactionCaptureSession.status !== 'countdown' && reactionCaptureSession.status !== 'waiting') return;
    reactionCaptureSession.status = 'timeout';
    reactionCaptureSession.error = '超时未收到表情';
    clearReactionCaptureTimers(reactionCaptureSession);
    log('warn', '表情截取超时', { groupId: gid, userId: uid }, 'reaction');
  }, REACTION_CAPTURE_COUNTDOWN_MS + REACTION_CAPTURE_WINDOW_MS);

  log('info', '表情截取会话开始', {
    groupId: gid,
    userId: uid,
    countdownSec: REACTION_CAPTURE_COUNTDOWN_MS / 1000,
    windowSec: REACTION_CAPTURE_WINDOW_MS / 1000
  }, 'reaction');
  return session;
}

function updateReactionCatalogEntry(id, patch, ctx) {
  const cfg = pluginState.config;
  const catalog = normalizeReactionCatalog(cfg.reactionEmojiCatalog);
  const idStr = String(id || '').trim();
  const idx = catalog.findIndex((e) => String(e.id) === idStr);
  if (idx < 0) return { ok: false, error: '表情不存在', entry: null };
  const prev = catalog[idx];
  const name = patch.name != null ? String(patch.name).trim() : prev.name;
  if (!name) return { ok: false, error: '备注不能为空', entry: null };
  const updated = {
    ...prev,
    name,
    glyph: String(patch.glyph != null ? patch.glyph : name).slice(0, 4) || prev.glyph
  };
  catalog[idx] = updated;
  cfg.reactionEmojiCatalog = catalog;
  saveConfig(ctx);
  return { ok: true, entry: updated };
}

function removeReactionCatalogEntry(id, ctx) {
  const cfg = pluginState.config;
  const catalog = normalizeReactionCatalog(cfg.reactionEmojiCatalog);
  const idStr = String(id || '').trim();
  const next = catalog.filter((e) => String(e.id) !== idStr);
  if (next.length === catalog.length) return { ok: false, error: '表情不存在' };
  cfg.reactionEmojiCatalog = next;
  saveConfig(ctx);
  return { ok: true, catalog: next };
}

function appendReactionCatalogEntry(entry, ctx) {
  const cfg = pluginState.config;
  const catalog = normalizeReactionCatalog(cfg.reactionEmojiCatalog);
  const id = String(entry?.id || '').trim();
  if (!id) return { added: false, duplicate: false, entry: null };
  const existing = catalog.find((e) => String(e.id) === id);
  if (existing) return { added: false, duplicate: true, entry: existing };
  const normalized = {
    id,
    name: String(entry.name || entry.id).trim(),
    type: String(entry.type || '1'),
    glyph: String(entry.glyph || entry.name || entry.id || '?').slice(0, 4)
  };
  catalog.push(normalized);
  cfg.reactionEmojiCatalog = catalog;
  saveConfig(ctx);
  return { added: true, duplicate: false, entry: normalized };
}

async function tryHandleReactionCapture(ctx, event, groupId, userId) {
  const session = reactionCaptureSession;
  if (!session || session.status !== 'waiting') return false;
  if (String(groupId) !== session.groupId) return false;
  if (String(userId) !== session.targetUserId) return false;

  const faces = extractFaceReactionsFromEvent(event);
  if (!faces.length) return false;

  const picked = faces[0];
  clearReactionCaptureTimers(session);

  const catalog = normalizeReactionCatalog(pluginState.config.reactionEmojiCatalog);
  const existing = catalog.find((e) => String(e.id) === String(picked.id));
  if (existing) {
    session.result = existing;
    session.status = 'duplicate';
    session.error = '该表情 ID 已在库中';
    log('info', '表情截取：重复 ID', { entry: session.result }, 'reaction');
    try {
      await sendGroup(ctx, session.groupId, `[CQ:at,qq=${session.targetUserId}] 表情「${session.result.name}」(ID: ${session.result.id}) 已在表情库中~`);
    } catch (_) { /* ignore */ }
    return true;
  }

  session.pendingEntry = picked;
  session.result = picked;
  session.status = 'pending_remark';
  log('info', '表情截取成功，等待填写备注', {
    entry: picked,
    faceCount: faces.length,
    raw_message: String(event?.raw_message || '').slice(0, 200)
  }, 'reaction');
  try {
    await sendGroup(ctx, session.groupId, `[CQ:at,qq=${session.targetUserId}] 已收到表情 (ID: ${picked.id})，请在插件面板填写备注后收录~`);
  } catch (_) { /* ignore */ }
  return true;
}

async function confirmReactionCaptureRemark(ctx, name) {
  const session = reactionCaptureSession;
  if (!session || session.status !== 'pending_remark') {
    throw new Error('当前没有待确认的表情');
  }
  const remark = String(name || '').trim();
  if (!remark) throw new Error('请填写备注');
  const base = session.pendingEntry || session.result;
  if (!base?.id) throw new Error('截取数据无效');
  const mergeResult = appendReactionCatalogEntry({
    ...base,
    name: remark,
    glyph: remark.length <= 4 ? remark : remark.slice(0, 2)
  }, ctx);
  if (!mergeResult.added) throw new Error(mergeResult.duplicate ? '该表情 ID 已在库中' : '收录失败');
  session.result = mergeResult.entry;
  session.status = 'captured';
  session.pendingEntry = null;
  log('info', '表情截取已确认收录', { entry: session.result }, 'reaction');
  try {
    await sendGroup(ctx, session.groupId, `[CQ:at,qq=${session.targetUserId}] 已收录表情「${session.result.name}」(ID: ${session.result.id}) 到表情回应库~`);
  } catch (_) { /* ignore */ }
  return session.result;
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
    const msg = String(message || '');
    if (/\[CQ:/i.test(msg)) {
      await sendGroupStructured(ctx, groupId, null, parseCqTextToSegments(msg));
      return;
    }
    await callAction('send_group_msg', { group_id: String(groupId), message: msg });
  } catch (e) {
    pluginState.logger?.error?.('[chat-bot] 发送群消息失败: ' + e.message);
  }
}

/** 发送结构化群消息（正确渲染 @/face/image） */
async function sendGroupStructured(ctx, groupId, replyMessageId, segments) {
  try {
    const message = [];
    if (replyMessageId != null) message.push({ type: 'reply', data: { id: String(replyMessageId) } });
    message.push(...flattenMessageSegments(segments));
    if (!message.length) return;
    await callAction('send_group_msg', { group_id: String(groupId), message });
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] 发送群结构化消息失败: ' + e.message);
  }
}

/** 发送群回复（回复某条消息，支持 CQ 码转 segment） */
async function sendGroupReply(ctx, groupId, replyMessageId, text) {
  try {
    await sendGroupStructured(ctx, groupId, replyMessageId, parseCqTextToSegments(text));
    log('info', '已发送群回复', { groupId, replyMessageId });
  } catch (e) {
    pluginState.logger?.warn?.('[chat-bot] 发送群回复失败: ' + e.message);
  }
}

/** 发送群消息数组（可含 reply + 其他 segment，如 face） */
async function sendGroupMessageArray(ctx, groupId, replyMessageId, segments) {
  try {
    await sendGroupStructured(ctx, groupId, replyMessageId, segments);
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

/** 分条发送文本/图片/文件（支持回复中的 URL 与 [发送文件:路径]） */
async function deliverChatReply(ctx, { isGroup, groupId, userId, prefix, replyText }) {
  const segments = parseOutboundMediaSegments(replyText);
  if (!segments.length) return;
  for (let i = 0; i < segments.length; i++) {
    const body = segmentToOutboundMessage(segments[i]);
    if (!body) {
      if (segments[i].type === 'file') {
        log('warn', '文件发送失败：路径不存在或超过 5MB', { path: segments[i].content }, 'chat');
      }
      continue;
    }
    let msg = body;
    if (i === 0 && prefix) {
      const needSpace = prefix && !/[\s\u3000]$/.test(prefix) && !body.startsWith('[CQ:');
      msg = prefix.trimEnd() + (needSpace ? ' ' : '') + body;
    }
    if (isGroup) await sendGroup(ctx, groupId, msg);
    else await sendPrivate(ctx, userId, msg);
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
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 5,
        temperature: 0.3
      }))
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
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 10,
        temperature: 0.9
      }))
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
    const id = item.id ?? item.face_id ?? item.faceId ?? item.qFaceId ?? item.QFaceId
      ?? item.resId ?? item.res_id ?? item.qid ?? item.url ?? item.file;
    const preview = item.url ?? item.preview ?? item.file ?? item.thumb ?? item.thumbnail
      ?? item.imageUrl ?? item.image_url ?? item.path ?? item.faceUrl ?? '';
    const idStr = id != null ? String(id).trim() : '';
    if (!idStr) return null;
    return {
      id: idStr,
      preview: String(preview || (isFaceIdUrl(idStr) ? idStr : '')).trim(),
      name: String(item.name || item.desc || item.summary || item.displayName || '').trim()
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
    let source = 'none';
    try {
      const detailRes = await callAction('fetch_custom_face_detail', { count: n });
      const detailData = detailRes?.data ?? detailRes ?? {};
      if (Array.isArray(detailData)) list = detailData;
      else if (Array.isArray(detailData.faces)) list = detailData.faces;
      else if (Array.isArray(detailData.face_list)) list = detailData.face_list;
      else if (detailData && typeof detailData === 'object') list = Object.values(detailData);
      if (list.length) source = 'fetch_custom_face_detail';
    } catch (e) {
      log('debug', 'fetch_custom_face_detail 不可用，回退 fetch_custom_face', e.message, 'sticker');
    }
    if (!list.length) {
      const res = await callAction('fetch_custom_face', { count: n });
      list = res?.data ?? res ?? [];
      if (list.length) source = 'fetch_custom_face';
    }
    if (!Array.isArray(list)) list = [];
    log('info', '收藏表情原始列表', {
      source,
      requested: n,
      rawCount: list.length,
      sampleKeys: list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 16) : [],
      sample: list.slice(0, 2).map((item) => (typeof item === 'object' ? item : { value: item }))
    }, 'sticker');
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const parsed = parseCustomFaceItem(item);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed);
    }
    log('info', '收藏表情解析完成', {
      parsed: out.length,
      withPreview: out.filter((f) => f.preview).length,
      samples: out.slice(0, 3).map((f) => ({ id: f.id, preview: String(f.preview || '').slice(0, 120), name: f.name }))
    }, 'sticker');
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

/** 构建回复后发表情的候选列表（合并群聊缓存注册库 + 配置池 + 收藏回退） */
async function buildStickerCandidates(cfg, store = null) {
  const seen = new Set();
  const merged = [];
  const push = (c) => {
    const id = String(c?.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(c);
  };

  if (store && cfg.emojiUseRegistry !== false) {
    for (const c of registeredEmojisToStickerCandidates(store)) push(c);
  }

  const pool = normalizeStickerPool(cfg.stickerPool);
  if (pool.length > 0) {
    for (const p of pool) push({ id: p.id, weight: p.weight, preview: p.preview, name: p.name });
  }
  if (merged.length > 0) return merged;

  if (cfg.stickerRandomFromFavorites === false) return [];
  const count = Math.max(1, Math.min(100, Number(cfg.stickerFaceCount) || 48));
  const detailed = await fetchCustomFacesDetailed(count);
  return detailed.map((f) => ({ id: f.id, weight: 1, preview: f.preview, name: f.name }));
}

/** MaiBot 风格视觉拼图选表情；失败时回退文本编号选择 */
async function pickStickerWithGridOrText(cfg, candidates, userText, replyText, contextLines = '') {
  const withPreview = (candidates || []).filter((c) => c?.id && c.preview);
  if (withPreview.length >= 2) {
    try {
      const pick = await selectStickerWithVision({
        cfg,
        candidates: withPreview,
        userText,
        replyText,
        contextLines,
        callVisionChat: (opts) => callVisionChatRaw({
          ...opts,
          model: (cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim()
        }),
        promptTemplate: (cfg.stickerSelectionPrompt || DEFAULT_STICKER_SELECTION_PROMPT).trim()
      });
      if (pick?.id) {
        touchStickerUsage(cfg, pick.id);
        log('info', '拼图视觉选择表情', {
          id: String(pick.id).slice(0, 40),
          index: pick.emoji_index,
          reason: pick.reason,
          grid: `${pick.grid_rows}x${pick.grid_columns}`,
          candidates: pick.candidateCount
        }, 'sticker');
        return pick.id;
      }
    } catch (e) {
      log('warn', '拼图视觉选表情失败，回退文本选择', e.message, 'sticker');
    }
  }
  const index = await aiPickStickerIndex(userText, replyText, candidates.length);
  const safeIndex = Math.max(0, Math.min(index, candidates.length - 1));
  return candidates[safeIndex]?.id || null;
}

/** 根据配置选取要发送的表情 id */
async function pickStickerFaceId(cfg, userText, replyText, contextLines = '', store = null) {
  const candidates = await buildStickerCandidates(cfg, store);
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
  return pickStickerWithGridOrText(cfg, candidates, userText, replyText, contextLines);
}

/** 判断是否为 URL 或本地图片路径（收藏/缓存表情需用 image 段发送） */
function isFaceIdUrl(faceId) {
  const s = String(faceId).trim();
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) return true;
  return false;
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

/** 获取群最近几条消息文本（用于伪人/群上下文） */
function getRecentGroupMessages(groupId, limit = 5) {
  return getFormattedRecentGroupContext(groupId, limit);
}

/** 伪人：AI 在 回复(1)/@(2)/戳一戳(3) 中选一种 */
async function aiChooseFakeHumanAction(recentContext) {
  const cfg = pluginState.config;
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return 1;
  const actionPrompt = (cfg.fakeHumanActionChoosePrompt || DEFAULT_FAKEHUMAN_ACTION_CHOOSE_PROMPT).trim();
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: actionPrompt },
          { role: 'user', content: '最近群消息：\n' + (recentContext || '').slice(0, 600) + '\n\n输出 1 或 2 或 3：' }
        ],
        max_tokens: 5,
        temperature: 0.6
      }))
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

function getEmojiCacheDir(ctx) {
  return path.join(path.dirname(getMaisakaStorePath(ctx)), 'emoji-cache');
}

/** 伪人 LLM tool_calls 调用 */
async function callFakeHumanLlmWithTools(cfg, { messages, tools, maxTokens = 400, temperature = 0.7 }) {
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return { content: '', tool_calls: [] };
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: maxTokens,
        temperature
      }))
    });
    if (!res.ok) {
      const errBody = await readApiErrorBody(res);
      log('warn', '伪人 Planner LLM HTTP 失败', { status: res.status, body: errBody.slice(0, 200) });
      return { content: '', tool_calls: [] };
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    return {
      content: msg.content || '',
      tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    };
  } catch (e) {
    log('warn', '伪人 Planner LLM 失败', e.message);
    return { content: '', tool_calls: [] };
  }
}

/** 从群消息缓存表情并 VLM 打标 */
async function queueCaptureGroupEmojis(ctx, event, groupId) {
  const cfg = pluginState.config;
  if (cfg.emojiCacheEnabled === false) return;
  const urls = extractEmojiUrlsFromEvent(event, (ev) => {
    const items = extractImageFromEvent(ev);
    return items.map((i) => i?.url).filter(Boolean);
  });
  if (!urls.length) return;
  const store = getMaisakaStore(ctx);
  ensureEmojiRegistry(store);
  const cacheDir = getEmojiCacheDir(ctx);
  const visionModel = (cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim();
  for (const url of urls) {
    try {
      const r = await captureAndRegisterEmoji({
        store,
        cacheDir,
        imageUrl: url,
        groupId,
        autoRegister: cfg.emojiAutoRegister === true,
        maxSizeMb: cfg.emojiMaxCacheSizeMb ?? 5,
        promptTemplate: (cfg.emojiVlmPrompt || DEFAULT_EMOJI_VLM_PROMPT).trim(),
        callVision: ({ systemPrompt, userText, imageUrls }) => callVisionChatRaw({ systemPrompt, userText, imageUrls, model: visionModel })
      });
      if (r.status === 'cached' || r.status === 'registered') {
        log('info', '群聊表情已缓存', { groupId, hash: r.emoji?.hash?.slice(0, 12), status: r.emoji?.status || r.status, emotions: r.emoji?.emotions || [] }, 'sticker');
      }
    } catch (e) {
      log('debug', '群聊表情缓存失败', e.message, 'sticker');
    }
  }
  persistMaisakaStore(ctx);
}

/** 对话与伪人共用的视觉模型 */
function getChatVisionModel(cfg) {
  const c = cfg || pluginState.config || {};
  return String(c.chatVisionModel || c.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim() || KIMI_CODE_DEFAULT_MODEL;
}

/** 执行 Planner 出站动作序列（文字+文件+表情，支持连发短句）；返回实际发送步数 */
async function deliverFakeHumanOutbound(ctx, groupId, replyMsgId, outbound, { cfg, store, recentContext, plainText, userId }) {
  const expanded = expandBurstReplies(outbound || [], cfg);
  let first = true;
  const burstDelay = Math.max(200, Number(cfg.fakeHumanBurstDelayMs) ?? 800);
  let step = 0;
  let sentCount = 0;
  for (const ob of expanded) {
    if (step > 0 && cfg.fakeHumanBurstEnabled !== false) {
      await new Promise((res) => setTimeout(res, burstDelay));
    }
    step += 1;
    const rid = first ? replyMsgId : null;
    first = false;
    if (ob.type === 'reply' && ob.message) {
      await deliverFakeHumanMessage(ctx, groupId, rid, { atUserId: ob.atUserId || '', message: ob.message });
      sentCount += 1;
    } else if (ob.type === 'at' && ob.atUserId) {
      await deliverFakeHumanMessage(ctx, groupId, rid, { atUserId: ob.atUserId, message: '' });
      sentCount += 1;
    } else if (ob.type === 'poke' && ob.userId) {
      await sendGroupPoke(ctx, groupId, ob.userId);
      sentCount += 1;
    } else if (ob.type === 'qq_face') {
      const faceId = resolveQqFaceId(ob.faceId || ob.emotion || '微笑');
      await deliverFakeHumanMessage(ctx, groupId, rid, {
        messageArray: [{ type: 'face', data: { id: String(faceId) } }]
      });
      sentCount += 1;
    } else if (ob.type === 'file' && ob.path) {
      if (ob.caption) await deliverFakeHumanMessage(ctx, groupId, rid, { message: ob.caption });
      await deliverChatReply(ctx, { isGroup: true, groupId, userId, prefix: '', replyText: `[发送文件:${ob.path}]` });
      sentCount += 1;
    } else if (ob.type === 'emoji') {
      const pick = await pickRegisteredEmojiWithGrid({
        store,
        cfg,
        userText: plainText || recentContext,
        replyText: ob.emotion || '',
        contextLines: recentContext,
        callVisionChat: (opts) => callVisionChatRaw({ ...opts, model: getChatVisionModel(cfg) })
      });
      let faceId = pick?.id || (await pickStickerFaceId(cfg, plainText, ob.emotion || '', recentContext, store));
      if (!faceId) {
        const qqId = resolveQqFaceId(ob.emotion || '微笑');
        await deliverFakeHumanMessage(ctx, groupId, rid, {
          messageArray: [{ type: 'face', data: { id: String(qqId) } }]
        });
        sentCount += 1;
      } else {
        const arr = [{ type: isFaceIdUrl(faceId) ? 'image' : 'face', data: isFaceIdUrl(faceId) ? { file: faceId } : { id: String(faceId) } }];
        await deliverFakeHumanMessage(ctx, groupId, rid, { messageArray: arr });
        sentCount += 1;
      }
    }
  }
  return sentCount;
}

/** 伪人 LLM 调用封装 */
async function callFakeHumanLlm(cfg, { systemPrompt, userPrompt, maxTokens = 120, temperature = 0.85 }) {
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return '';
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: String(systemPrompt || '').trim() },
          { role: 'user', content: String(userPrompt || '').trim() }
        ],
        max_tokens: maxTokens,
        temperature
      }))
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    log('warn', '伪人 LLM 调用失败', e.message);
    return '';
  }
}

/** 伪人 AI 一句模式：直接调用 LLM 生成单条回复（不经过 Planner / 随机短句） */
async function generateFakeHumanDirectAiReply(cfg, { recentContext, plainText, personaContext, imageDesc }) {
  const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
  let userContent = '【回复信息参考】\n最近群消息：\n' + (recentContext || (plainText || '')).slice(0, 800);
  if (personaContext) userContent += '\n' + personaContext.slice(0, 500);
  if (imageDesc) userContent += '\n\n用户本条消息图片内容：' + imageDesc.slice(0, 200);
  if (cfg.fakeHumanWebSearch && cfg.webSearchEnabled) {
    const query = (plainText || recentContext.split('\n').pop() || '').slice(0, 50);
    const searchResult = await webSearchMulti(query, cfg);
    if (searchResult) userContent += '\n\n联网参考：\n' + searchResult.slice(0, 400);
  }
  const { apiUrl, apiKey, model } = getApiConfig();
  if (!apiKey) return '';
  const sysPrompt = buildFakeHumanSystemPrompt({
    ...cfg,
    _replyInstruction: buildFakeHumanReplyerInstruction(cfg)
  });
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: Math.min(120, maxLen * 2),
        temperature: 0.85
      }))
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim().slice(0, maxLen).replace(/\n+/g, ' ');
  } catch (e) {
    log('warn', '伪人 AI 直接生成失败', e.message);
    return '';
  }
}

/** 伪人失败时的兜底回复：仅 random_text 模式用短句列表，其余模式走 AI */
async function resolveFakeHumanFallbackMessage(cfg, pickMode, aiContext) {
  const effective = getEffectiveFakeHumanPickMode(cfg, pickMode);
  if (effective === 'random_text') {
    return pickFakeHumanRandomText(cfg, pickMode);
  }
  if (aiContext) {
    const aiMsg = await generateFakeHumanDirectAiReply(cfg, aiContext);
    if (aiMsg) return aiMsg;
  }
  return null;
}

/** 发送伪人消息（@ 使用 segment，不再裸发 CQ 字符串） */
async function deliverFakeHumanMessage(ctx, groupId, replyMsgId, { atUserId, message, messageArray }) {
  const segments = [];
  if (atUserId) segments.push(...buildAtSegments(atUserId, ''));
  if (messageArray?.length) {
    segments.push(...messageArray);
  } else if (message) {
    segments.push(...parseCqTextToSegments(message));
  }
  if (!segments.length) return;
  await sendGroupStructured(ctx, groupId, replyMsgId, segments);
}

/** 伪人：MaiBot 风格 Planner+Reply / 表达/黑话/行为学习 / 长期记忆 */
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
    await deliverFakeHumanMessage(ctx, groupId, event.message_id ?? event.message?.id ?? null, { atUserId: targetId, message: '' });
    log('info', '伪人插话', { groupId: g, action: 'at' });
    return;
  }
  if (chosenAction === 3) {
    await sendGroupPoke(ctx, groupId, userId);
    log('info', '伪人插话', { groupId: g, action: 'poke' });
    return;
  }

  const visionModel = getChatVisionModel(cfg);
  let imageDesc = '';
  if (imageUrls.length && cfg.fakeHumanParseImage) {
    const descPrompt = (cfg.fakeHumanImageDescribePrompt || DEFAULT_FAKEHUMAN_IMAGE_DESCRIBE_PROMPT).trim();
    imageDesc = await callVisionChatRaw({
      systemPrompt: descPrompt,
      userText: '请描述这张图片。',
      imageUrls: [imageUrls[0]],
      model: visionModel
    });
  }

  const mode = (cfg.fakeHumanReplyMode || 'ai').toLowerCase();
  let pickMode = mode;
  if (mode === 'mixed') {
    const r = Math.random();
    pickMode = r < 0.75 ? 'ai' : ['random_text', 'emoji', 'sticker'][Math.floor(Math.random() * 3)];
  }
  log('info', '伪人回复模式', { configured: mode, effective: getEffectiveFakeHumanPickMode(cfg, pickMode), pickMode, useMaisaka: cfg.fakeHumanMaisakaMode !== false && pickMode === 'ai' });

  const useMaisaka = cfg.fakeHumanMaisakaMode !== false && pickMode === 'ai';
  const store = getMaisakaStore(ctx);
  const storePath = getMaisakaStorePath(ctx);
  const botName = (cfg.fakeHumanBotName || cfg.botDisplayName || '机器人').trim();
  let atUserId = '';
  let message = '';
  let sendAsArray = false;
  let messageArray = null;

  if (useMaisaka) {
    recordObservePlannerStart(g, { source: 'fakehuman', userId, trigger: (plainText || '').slice(0, 120) });
    const plannerT0 = Date.now();
    const result = await runMaisakaFakeHumanChat({
      cfg,
      groupId: g,
      userId,
      recentContext,
      plainText: plainText || '',
      personaContext,
      imageDesc: imageDesc ? imageDesc.slice(0, 200) : '',
      store,
      db: sqliteDbRef,
      llmText: (opts) => callFakeHumanLlm(cfg, opts),
      llmWithTools: (opts) => callFakeHumanLlmWithTools(cfg, opts),
      onPlannerRound: async (round) => {
        recordObservePlannerRound(g, round);
      },
      executePlannerTool: async (name, args) => {
        if (name === 'reply') return `已排程回复：${String(args.message || '').slice(0, 40)}`;
        if (name === 'send_qq_face') return `已排程小黄脸：${args.face_id || args.emotion || '默认'}`;
        if (name === 'send_emoji') return `已排程表情：${args.emotion || '自动'}`;
        if (name === 'send_file') return `已排程文件：${args.path || ''}`;
        if (name === 'no_action') return '本轮不发言';
        return 'ok';
      },
      buildReplySystemPrompt: (vars) => buildFakeHumanSystemPrompt({ ...cfg, fakeHumanIdentity: vars.identity, fakeHumanReplyStyle: vars.replyStyle, _groupAttention: vars.groupChatAttentionBlock, _replyInstruction: vars.replyerOutputInstruction })
    });
    persistMaisakaStore(ctx);
    recordObservePlannerEnd(g, {
      source: 'fakehuman',
      action: result.action,
      rounds: result.plan?.rounds || 0,
      reasoning: result.reasoning || result.plan?.reasoning || '',
      durationMs: Date.now() - plannerT0,
      outboundCount: (result.outbound || []).length,
      roundDetails: result.plan?.roundDetails || []
    });

    if (result.action === 'skip') {
      recordObserveDecision(g, 'no_action', { source: 'fakehuman', reasoning: result.reasoning || result.plan?.reasoning || '' });
      const fallbackMsg = await resolveFakeHumanFallbackMessage(cfg, pickMode, {
        recentContext, plainText, personaContext, imageDesc: imageDesc ? imageDesc.slice(0, 200) : ''
      });
      if (!fallbackMsg) {
        log('debug', '伪人跳过发言', { groupId: g, reason: 'planner_skip', mode: pickMode });
        return;
      }
      const replyMsgId = event.message_id ?? event.message?.id ?? null;
      await deliverFakeHumanMessage(ctx, groupId, replyMsgId, { message: fallbackMsg });
      appendRecentGroupBotMessage(g, selfId, botName, fallbackMsg);
      log('info', '伪人插话', { groupId: g, mode: shouldUseFakeHumanTextList(cfg, pickMode) ? 'random_text' : 'ai_fallback', reason: 'planner_skip' });
      return;
    }

    const replyMsgId = event.message_id ?? event.message?.id ?? null;
    const outbound = result.outbound || [];

    if (outbound.length) {
      recordObserveOutbound(g, { source: 'fakehuman', steps: outbound.length, preview: outbound.slice(0, 4) });
      const sentCount = await deliverFakeHumanOutbound(ctx, groupId, replyMsgId, outbound, { cfg, store, recentContext, plainText, userId });
      if (sentCount === 0) {
        const fallbackMsg = await resolveFakeHumanFallbackMessage(cfg, pickMode, {
          recentContext, plainText, personaContext, imageDesc: imageDesc ? imageDesc.slice(0, 200) : ''
        });
        if (!fallbackMsg) {
          log('debug', '伪人跳过发言', { groupId: g, reason: 'outbound_empty', mode: pickMode });
          return;
        }
        await deliverFakeHumanMessage(ctx, groupId, replyMsgId, { message: fallbackMsg });
        appendRecentGroupBotMessage(g, selfId, botName, fallbackMsg);
        log('info', '伪人插话', { groupId: g, mode: shouldUseFakeHumanTextList(cfg, pickMode) ? 'random_text' : 'ai_fallback', reason: 'outbound_empty' });
        return;
      }
      const sentText = outbound.filter((o) => o.type === 'reply').map((o) => o.message).join(' ') || '[组合动作]';
      appendRecentGroupBotMessage(g, selfId, botName, sentText);
      log('info', '伪人 Planner 出站', {
        groupId: g,
        steps: outbound.length,
        sent: sentCount,
        rounds: result.plan?.rounds,
        replyerFallback: !!result.replyerFallback
      });
      setImmediate(() => {
        runMaisakaLearning({ cfg, store: getMaisakaStore(ctx), storePath, groupId: g, recentContext, botName, botReply: sentText, llmText: (opts) => callFakeHumanLlm(cfg, opts) }).catch(() => {});
      });
      return;
    }

    message = result.message || '';
    atUserId = result.atUserId || '';
    if (!message && !(result.outbound || []).length) {
      log('warn', '伪人 AI 未生成内容', { groupId: g, hint: getApiConfig().apiKey ? 'Planner/Reply 返回空' : '请配置 API Key' });
      message = await resolveFakeHumanFallbackMessage(cfg, pickMode, {
        recentContext, plainText, personaContext, imageDesc: imageDesc ? imageDesc.slice(0, 200) : ''
      }) || '';
    }
  } else if (pickMode === 'sticker') {
    const faceId = await pickStickerFaceId(cfg, plainText || recentContext, '', recentContext, store);
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
    message = pickFakeHumanRandomText(cfg, pickMode) || '哈哈';
  } else {
    let userContent = '【回复信息参考】\n最近群消息：\n' + (recentContext || (plainText || '')).slice(0, 800) + (personaContext ? '\n' + personaContext.slice(0, 500) : '');
    if (imageDesc) userContent += '\n\n用户本条消息图片内容：' + imageDesc.slice(0, 200);
    else if (imageUrls.length && cfg.fakeHumanParseImage) userContent += '\n\n用户本条消息包含图片，请结合图片语境简要插话。';
    if (cfg.fakeHumanWebSearch && cfg.webSearchEnabled) {
      const query = (plainText || recentContext.split('\n').pop() || '').slice(0, 50);
      const searchResult = await webSearchMulti(query, cfg);
      if (searchResult) userContent += '\n\n联网参考：\n' + searchResult.slice(0, 400);
    }
    const { apiUrl, apiKey, model } = getApiConfig();
    const sysPrompt = buildFakeHumanSystemPrompt(cfg);
    const maxLen = Math.max(10, Math.min(200, Number(cfg.fakeHumanMaxLength) ?? 80));
    if (apiKey) {
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: chatHeadersFromApiConfig({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(buildAuxiliaryChatBody(cfg, {
            model,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userContent }
            ],
            max_tokens: Math.min(120, maxLen * 2),
            temperature: 0.85
          }))
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
      message = await resolveFakeHumanFallbackMessage(cfg, pickMode, {
        recentContext, plainText, personaContext, imageDesc: imageDesc ? imageDesc.slice(0, 200) : ''
      }) || '';
    }
    const atChance = Math.max(0, Math.min(1, Number(cfg.fakeHumanAtChance) ?? 0.25));
    if (!atUserId && Math.random() < atChance) {
      const atWho = (cfg.fakeHumanAtWho || 'sender').toLowerCase();
      atUserId = userId;
      if (atWho === 'random') {
        const randomId = await getRandomGroupMember(groupId, selfId);
        if (randomId) atUserId = randomId;
      }
    }
  }

  const replyMsgId = event.message_id ?? event.message?.id ?? null;
  if (sendAsArray && messageArray) {
    await deliverFakeHumanMessage(ctx, groupId, replyMsgId, { atUserId, messageArray });
  } else if (message) {
    await deliverFakeHumanMessage(ctx, groupId, replyMsgId, { atUserId, message });
  } else {
    log('debug', '伪人跳过发言', { groupId: g, mode: useMaisaka ? 'maisaka' : pickMode, reason: 'empty_message' });
    return;
  }

  const sentText = message || (sendAsArray ? '[表情]' : '');
  appendRecentGroupBotMessage(g, selfId, botName, sentText);
  log('info', '伪人插话', { groupId: g, mode: useMaisaka ? 'maisaka' : pickMode, atUserId: atUserId || null });

  if (useMaisaka && (cfg.fakeHumanEnableExpressionLearning !== false || cfg.fakeHumanEnableSlangLearning !== false || cfg.fakeHumanEnableBehaviorLearning !== false)) {
    setImmediate(() => {
      runMaisakaLearning({
        cfg,
        store: getMaisakaStore(ctx),
        storePath,
        groupId: g,
        recentContext,
        botName,
        botReply: sentText,
        llmText: (opts) => callFakeHumanLlm(cfg, opts)
      }).catch((e) => log('warn', '伪人学习后台任务失败', e.message));
    });
  }
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

function hashDangerPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(String(saltHex), 'hex') : randomBytes(16);
  const dk = scryptSync(String(password || ''), salt, 64);
  return { hashHex: dk.toString('hex'), saltHex: salt.toString('hex') };
}

function verifyDangerPassword(cfg, plain) {
  const hashHex = String(cfg?.agentDangerPasswordHash || '');
  const saltHex = String(cfg?.agentDangerPasswordSalt || '');
  if (!hashHex || !saltHex) return false;
  try {
    const got = Buffer.from(hashDangerPassword(plain, saltHex).hashHex, 'hex');
    const exp = Buffer.from(hashHex, 'hex');
    return got.length === exp.length && timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}

function normalizeRiskLevel(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  return 'high';
}

function createPendingRiskApproval(cfg, payload) {
  const now = Date.now();
  const waitSec = Math.max(0, Math.min(30, Number(cfg.agentDangerConfirmDelaySec) || 5));
  const expireSec = Math.max(waitSec + 5, Math.min(180, Number(cfg.agentDangerConfirmExpireSec) || 20));
  const id = `risk_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const item = {
    id,
    operationType: String(payload.operationType || 'unknown'),
    riskLevel: normalizeRiskLevel(payload.riskLevel),
    reason: String(payload.reason || ''),
    preview: String(payload.preview || '').slice(0, 300),
    userId: String(payload.userId || ''),
    groupId: String(payload.groupId || ''),
    source: String(payload.source || 'unknown'),
    createdAt: now,
    availableAt: now + waitSec * 1000,
    expiresAt: now + expireSec * 1000,
    approved: false
  };
  pendingRiskApprovals.set(id, item);
  return item;
}

function cleanupPendingRiskApprovals() {
  const now = Date.now();
  for (const [id, item] of pendingRiskApprovals.entries()) {
    if (item.expiresAt <= now) pendingRiskApprovals.delete(id);
  }
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

async function fetchRemoteChangelog(cfg = {}) {
  const benchmark = getMirrorConfig(cfg).benchmark;
  const results = Object.entries(benchmark).map(([id, v]) => ({ id, ...v }));
  const { url, mirrorName } = resolveUpdateDownloadUrl(CHANGELOG_GITHUB_URL, cfg, results);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'napcat-plugin-chat-bot',
        Accept: 'text/plain, text/markdown, */*'
      },
      signal: ctrl.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const content = await res.text();
    if (!content.trim()) {
      throw new Error('远程 CHANGELOG 为空');
    }
    return {
      content,
      source: mirrorName && mirrorName !== 'GitHub 原始' ? mirrorName : 'GitHub'
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseLatestChangelogVersion(md) {
  const m = String(md || '').match(/^##\s+\[([^\]]+)\]/m);
  return m ? m[1].trim() : '';
}

function readLocalChangelogFile() {
  const file = path.join(__dirname, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return '';
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

async function resolveChangelogContent(cfg = {}) {
  const localContent = readLocalChangelogFile();
  const localTop = parseLatestChangelogVersion(localContent);
  try {
    const remote = await fetchRemoteChangelog(cfg);
    const remoteTop = parseLatestChangelogVersion(remote.content);
    if (localContent && compareSemver(localTop, remoteTop) >= 0) {
      return { content: localContent, source: 'local', remoteTop, localTop };
    }
    return { content: remote.content, source: remote.source, remoteTop, localTop };
  } catch (remoteErr) {
    if (localContent) {
      return { content: localContent, source: 'local', error: remoteErr?.message || String(remoteErr) };
    }
    throw remoteErr;
  }
}

async function runPluginUpdateCheck(ctx, { persist = true, autoApply = false } = {}) {
  if (pluginState.updateRunning) {
    return { success: false, error: '更新正在进行中', info: pluginState.updateInfo };
  }
  try {
    const info = await checkPluginUpdate(__dirname, pluginState.logger);
    pluginState.updateInfo = info;
    if (persist) {
      pluginState.config.autoUpdateLastCheckAt = Date.now();
      pluginState.config.autoUpdateLastResult = info.hasUpdate
        ? `发现新版本 v${info.latestVersion}`
        : `已是最新 v${info.currentVersion}`;
      saveConfig(ctx);
    }
    log('info', info.hasUpdate ? '发现插件新版本' : '插件已是最新版本', {
      current: info.currentVersion,
      latest: info.latestVersion
    }, 'system');
    if (autoApply && info.hasUpdate && pluginState.config.autoUpdateEnabled) {
      const applied = await runPluginUpdateApply(ctx, info.release);
      return { success: true, info, applied };
    }
    return { success: true, info };
  } catch (e) {
    const msg = e?.message || String(e);
    if (persist) {
      pluginState.config.autoUpdateLastResult = `检查失败: ${msg}`;
      saveConfig(ctx);
    }
    log('warn', '检查插件更新失败', { error: msg }, 'system');
    return { success: false, error: msg, info: pluginState.updateInfo };
  }
}

async function resolveMirrorForDownload(ctx, githubUrl, progressEmit) {
  const cfg = pluginState.config;
  const mirrorCfg = getMirrorConfig(cfg);
  if (mirrorCfg.mode === 'manual') {
    const resolved = resolveUpdateDownloadUrl(githubUrl, cfg);
    progressEmit?.({
      phase: 'mirror',
      message: `使用指定镜像：${resolved.mirrorName}`,
      percent: 8
    });
    return resolved;
  }
  if (isMirrorBenchmarkFresh(cfg)) {
    const resolved = resolveUpdateDownloadUrl(githubUrl, cfg);
    progressEmit?.({
      phase: 'mirror',
      message: `使用最快镜像：${resolved.mirrorName}`,
      percent: 8
    });
    return resolved;
  }
  progressEmit?.({ phase: 'mirror', message: '正在测速选择最快镜像源…', percent: 4 });
  const testUrl = githubUrl || getDefaultMirrorTestUrl();
  const { results, bestId, best } = await benchmarkMirrors(testUrl, null, {
    concurrency: 6,
    onProgress: (p) => progressEmit?.({
      phase: 'mirror',
      message: `镜像测速 ${p.completed}/${p.total}…`,
      percent: 4 + Math.round((p.completed / Math.max(p.total, 1)) * 6)
    })
  });
  cfg.updateMirrorBenchmark = mergeBenchmarkResults(cfg.updateMirrorBenchmark, results);
  cfg.updateMirrorBestId = bestId;
  cfg.updateMirrorBestTestedAt = Date.now();
  saveConfig(ctx);
  const resolved = resolveUpdateDownloadUrl(githubUrl, cfg, results);
  progressEmit?.({
    phase: 'mirror',
    message: `已选择 ${resolved.mirrorName}${best?.ok ? `（${best.latencyMs}ms）` : ''}`,
    percent: 10
  });
  return resolved;
}

function collectPluginReloadIdsLocal(ctx) {
  return collectPluginReloadIds(ctx, __dirname);
}

/** 尝试热重载本插件（更新后使 index.mjs 等新后端代码生效） */
async function tryReloadPlugin(ctx) {
  const pm = pluginState.pluginManager || ctx?.pluginManager;
  const debugOpts = {
    wsUrl: pluginState.config?.updateDebugWsUrl || process.env.NAPCAT_DEBUG_WS,
    token: pluginState.config?.updateDebugToken || process.env.NAPCAT_DEBUG_TOKEN,
    allowDebugWs: pluginState.config?.updateReloadViaDebug !== false
  };
  return tryReloadPluginAll(pm, ctx || pluginState.runtimeCtx, __dirname, debugOpts);
}

/** 延迟调度热重载，避免在更新任务栈内卸载当前插件导致进度无法上报 */
function schedulePluginReload(ctx, { delayMs = 2000, reason = 'update' } = {}) {
  const runtimeCtx = ctx || pluginState.runtimeCtx;
  const pm = pluginState.pluginManager || runtimeCtx?.pluginManager;
  const pluginIds = collectPluginReloadIdsLocal(runtimeCtx);
  if (pendingReloadTimer) {
    clearTimeout(pendingReloadTimer);
    pendingReloadTimer = null;
  }
  if (!pm?.reloadPlugin && pluginState.config?.updateReloadViaDebug === false) {
    log('warn', '热重载不可用，请安装 napcat-plugin-debug 或手动重启 NapCat', { reason }, 'system');
    return false;
  }
  pendingReloadTimer = setTimeout(() => {
    pendingReloadTimer = null;
    tryReloadPlugin(runtimeCtx).then((r) => {
      if (r.ok) {
        log('info', '插件热重载成功', { method: r.method, pluginId: r.pluginId }, 'system');
      } else {
        log('warn', '插件热重载失败，可安装 napcat-plugin-debug 或手动重载插件', { reason: r.reason, tried: r.tried }, 'system');
      }
    }).catch((e) => {
      log('warn', '插件热重载异常', { error: e?.message || String(e) }, 'system');
    });
  }, Math.max(500, Number(delayMs) || 2000));
  log('info', '已调度插件热重载', { reason, delayMs, pluginIds, viaDebug: pluginState.config?.updateReloadViaDebug !== false }, 'system');
  return true;
}

async function runPluginUpdateApply(ctx, releaseInfo, onProgress) {
  if (pluginState.updateRunning) throw new Error('更新正在进行中');
  const release = releaseInfo || pluginState.updateInfo?.release;
  if (!release?.downloadUrl) throw new Error('请先检查更新');
  pluginState.updateRunning = true;
  pluginState.updateProgressLog = [];
  const emit = (payload) => {
    const item = {
      phase: payload?.phase || 'progress',
      message: String(payload?.message || ''),
      percent: Math.max(0, Math.min(100, Math.round(Number(payload?.percent) || 0))),
      success: payload?.success,
      version: payload?.version,
      error: payload?.error,
      at: Date.now()
    };
    pluginState.updateProgress = item;
    const last = pluginState.updateProgressLog[pluginState.updateProgressLog.length - 1];
    if (!last || last.message !== item.message || last.percent !== item.percent) {
      pluginState.updateProgressLog.push(item);
      if (pluginState.updateProgressLog.length > 100) pluginState.updateProgressLog.shift();
    }
    onProgress?.(item);
  };
  try {
    log('info', '开始下载并安装插件更新', { version: release.version, asset: release.assetName }, 'system');
    emit({ phase: 'start', message: `开始更新至 v${release.version}…`, percent: 2 });
    const result = await applyReleaseUpdate(__dirname, release, pluginState.logger, emit, {
      resolveDownloadUrl: (url, progressEmit) => resolveMirrorForDownload(ctx, url, progressEmit)
    });
    const reloadScheduled = schedulePluginReload(ctx, { delayMs: 1500, reason: 'post-update' });
    emit({
      phase: 'reload',
      message: reloadScheduled ? '文件已写入，即将自动热重载后端…' : '文件已写入，请手动重启 NapCat 使后端生效',
      percent: 96,
      reloadScheduled
    });
    pluginState.config.autoUpdateLastResult = `已更新至 v${result.version}`;
    pluginState.updateInfo = {
      ...(pluginState.updateInfo || {}),
      currentVersion: result.version,
      latestVersion: result.version,
      hasUpdate: false,
      checkedAt: Date.now()
    };
    saveConfig(ctx);
    emit({
      phase: 'complete',
      message: reloadScheduled
        ? `已更新至 v${result.version}，正在热重载…`
        : `已更新至 v${result.version}，请重启 NapCat`,
      percent: 100,
      success: true,
      version: result.version,
      reloadScheduled
    });
    return result;
  } catch (e) {
    const msg = e?.message || String(e);
    emit({ phase: 'error', message: msg, percent: 0, success: false, error: msg });
    throw e;
  } finally {
    pluginState.updateRunning = false;
  }
}

function scheduleAutoUpdate(ctx) {
  if (pluginState.autoUpdateTimer) {
    clearInterval(pluginState.autoUpdateTimer);
    pluginState.autoUpdateTimer = null;
  }
  const tick = async () => {
    const cfg = pluginState.config;
    if (!cfg.autoUpdateEnabled) return;
    const hours = Math.max(1, Number(cfg.autoUpdateIntervalHours) || 24);
    const last = Number(cfg.autoUpdateLastCheckAt) || 0;
    if (Date.now() - last < hours * 3600000) return;
    await runPluginUpdateCheck(ctx, { persist: true, autoApply: true });
  };
  setTimeout(() => { tick().catch(() => {}); }, 20000);
  pluginState.autoUpdateTimer = setInterval(() => { tick().catch(() => {}); }, 3600000);
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
    pluginState.pluginId = String(ctx.fileId || c.fileId || ctx.pluginName || c.pluginName || path.basename(__dirname) || 'napcat-plugin-chat-bot');
    pluginState.runtimeCtx = ctx;
    loadConfig(ctx);
    try {
      await initSqliteStore(ctx);
    } catch (e) {
      log('warn', 'SQLite 初始化失败', e.message, 'system');
    }

    log('info', '聊天插件已初始化', { apiProvider: pluginState.config.apiProvider || 'siliconflow', sqlite: !!sqliteDbRef }, 'system');

    if (pluginState.config.mcpEnabled) {
      ensureAgentMcpHub(pluginState.config).catch((e) => {
        log('warn', 'MCP 初始化失败', e.message, 'mcp');
      });
    }

    drawBotEngine = createDrawBot({
      fetchJson,
      sendGroup: async (drawCtx, gid, m) => sendGroup(drawCtx, gid, m),
      log,
      isAdminUser
    });

    if (router) {
      router.getNoAuth('/config', (_, res) => {
        const safeCfg = { ...pluginState.config };
        safeCfg.agentDangerPasswordHash = '';
        safeCfg.agentDangerPasswordSalt = '';
        safeCfg.agentDangerPasswordSet = Boolean(pluginState.config.agentDangerPasswordHash && pluginState.config.agentDangerPasswordSalt);
        res.json({ success: true, config: safeCfg });
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
          const allowed = ['siliconflow', 'deepseek', 'bailian', 'codingplan', 'openai', 'kimi', 'custom'];
          cfg.apiProvider = allowed.includes(p) ? p : 'siliconflow';
        }
        if (body.deepseekApiKey !== undefined) cfg.deepseekApiKey = str('deepseekApiKey', '');
        if (body.siliconflowApiKey !== undefined) cfg.siliconflowApiKey = str('siliconflowApiKey', '');
        if (body.kimiApiKey !== undefined) cfg.kimiApiKey = str('kimiApiKey', '');
        if (body.kimiApiUrl !== undefined) cfg.kimiApiUrl = str('kimiApiUrl', KIMI_CODE_API);
        if (body.kimiModelsUrl !== undefined) cfg.kimiModelsUrl = str('kimiModelsUrl', KIMI_CODE_MODELS_API);
        if (body.kimiCookies !== undefined) cfg.kimiCookies = str('kimiCookies', '');
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
          cfg.cooldownByUser = normalizeNumericKeyedObject(body.cooldownByUser);
        }
        if (body.cooldownByGroup !== undefined && typeof body.cooldownByGroup === 'object' && body.cooldownByGroup !== null) {
          cfg.cooldownByGroup = normalizeNumericKeyedObject(body.cooldownByGroup);
        }
        if (body.conversationIsolationMode !== undefined) {
          cfg.conversationIsolationMode = normalizeIsolationMode(body.conversationIsolationMode);
        }
        if (body.groupIsolationOverrides !== undefined && typeof body.groupIsolationOverrides === 'object' && body.groupIsolationOverrides !== null) {
          cfg.groupIsolationOverrides = normalizeNumericKeyedObject(body.groupIsolationOverrides);
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
        if (body.advancedSamplingEnabled !== undefined) cfg.advancedSamplingEnabled = bool('advancedSamplingEnabled', false);
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
        if (body.webSearchRegion !== undefined) {
          const r = String(body.webSearchRegion).toLowerCase();
          cfg.webSearchRegion = ['auto', 'domestic', 'international'].includes(r) ? r : 'auto';
        }
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
        if (body.logsRefreshIntervalSec !== undefined) cfg.logsRefreshIntervalSec = num('logsRefreshIntervalSec', 2, 1, 60);
        if (body.logsScrollMode !== undefined) cfg.logsScrollMode = ['down', 'up'].includes(String(body.logsScrollMode)) ? body.logsScrollMode : 'down';
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
        if (body.stickerSendNum !== undefined) cfg.stickerSendNum = Math.max(1, Math.min(64, parseInt(body.stickerSendNum, 10) || 25));
        if (body.stickerSelectionPrompt !== undefined) cfg.stickerSelectionPrompt = String(body.stickerSelectionPrompt || DEFAULT_STICKER_SELECTION_PROMPT).trim() || DEFAULT_STICKER_SELECTION_PROMPT;
        if (body.stickerUsageStats !== undefined && body.stickerUsageStats && typeof body.stickerUsageStats === 'object') cfg.stickerUsageStats = body.stickerUsageStats;
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
        if (body.kimiVisionCookies !== undefined) cfg.kimiVisionCookies = str('kimiVisionCookies', '');
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
        if (body.fakeHumanGroupChance !== undefined) cfg.fakeHumanGroupChance = typeof body.fakeHumanGroupChance === 'object' && body.fakeHumanGroupChance !== null ? normalizeNumericKeyedObject(body.fakeHumanGroupChance) : {};
        if (body.fakeHumanMinInterval !== undefined) cfg.fakeHumanMinInterval = Math.max(0, parseInt(body.fakeHumanMinInterval, 10) || 90);
        if (body.fakeHumanReplyMode !== undefined) cfg.fakeHumanReplyMode = ['ai', 'random_text', 'emoji', 'sticker', 'mixed'].includes(String(body.fakeHumanReplyMode).toLowerCase()) ? String(body.fakeHumanReplyMode).toLowerCase() : 'ai';
        if (body.fakeHumanTextList !== undefined) cfg.fakeHumanTextList = Array.isArray(body.fakeHumanTextList) ? body.fakeHumanTextList.map(String).filter(Boolean) : (cfg.fakeHumanTextList || []);
        if (body.fakeHumanEmojiList !== undefined) cfg.fakeHumanEmojiList = Array.isArray(body.fakeHumanEmojiList) ? body.fakeHumanEmojiList.map(String).filter(Boolean) : (cfg.fakeHumanEmojiList || []);
        if (body.fakeHumanAtChance !== undefined) cfg.fakeHumanAtChance = Math.max(0, Math.min(1, parseFloat(body.fakeHumanAtChance) || 0.25));
        if (body.fakeHumanAtWho !== undefined) cfg.fakeHumanAtWho = ['sender', 'random'].includes(String(body.fakeHumanAtWho).toLowerCase()) ? String(body.fakeHumanAtWho).toLowerCase() : 'sender';
        if (body.fakeHumanSystemPrompt !== undefined) cfg.fakeHumanSystemPrompt = String(body.fakeHumanSystemPrompt || '').trim();
        if (body.fakeHumanBotName !== undefined) cfg.fakeHumanBotName = String(body.fakeHumanBotName || '机器人').trim() || '机器人';
        if (body.fakeHumanIdentity !== undefined) cfg.fakeHumanIdentity = String(body.fakeHumanIdentity || DEFAULT_FAKEHUMAN_IDENTITY).trim() || DEFAULT_FAKEHUMAN_IDENTITY;
        if (body.fakeHumanReplyStyle !== undefined) cfg.fakeHumanReplyStyle = String(body.fakeHumanReplyStyle || DEFAULT_FAKEHUMAN_REPLY_STYLE).trim() || DEFAULT_FAKEHUMAN_REPLY_STYLE;
        if (body.fakeHumanReplyPrompt !== undefined) cfg.fakeHumanReplyPrompt = String(body.fakeHumanReplyPrompt || DEFAULT_FAKEHUMAN_REPLY_PROMPT).trim() || DEFAULT_FAKEHUMAN_REPLY_PROMPT;
        if (body.fakeHumanPlannerPrompt !== undefined) cfg.fakeHumanPlannerPrompt = String(body.fakeHumanPlannerPrompt || DEFAULT_FAKEHUMAN_PLANNER_PROMPT).trim() || DEFAULT_FAKEHUMAN_PLANNER_PROMPT;
        if (body.fakeHumanActionChoosePrompt !== undefined) cfg.fakeHumanActionChoosePrompt = String(body.fakeHumanActionChoosePrompt || DEFAULT_FAKEHUMAN_ACTION_CHOOSE_PROMPT).trim() || DEFAULT_FAKEHUMAN_ACTION_CHOOSE_PROMPT;
        if (body.fakeHumanImageDescribePrompt !== undefined) cfg.fakeHumanImageDescribePrompt = String(body.fakeHumanImageDescribePrompt || DEFAULT_FAKEHUMAN_IMAGE_DESCRIBE_PROMPT).trim() || DEFAULT_FAKEHUMAN_IMAGE_DESCRIBE_PROMPT;
        if (body.fakeHumanMaisakaMode !== undefined) cfg.fakeHumanMaisakaMode = Boolean(body.fakeHumanMaisakaMode);
        if (body.fakeHumanPlannerLoop !== undefined) cfg.fakeHumanPlannerLoop = Boolean(body.fakeHumanPlannerLoop);
        if (body.fakeHumanPlannerMaxRounds !== undefined) cfg.fakeHumanPlannerMaxRounds = Math.max(1, Math.min(8, parseInt(body.fakeHumanPlannerMaxRounds, 10) || 5));
        if (body.emojiCacheEnabled !== undefined) cfg.emojiCacheEnabled = Boolean(body.emojiCacheEnabled);
        if (body.emojiAutoRegister !== undefined) cfg.emojiAutoRegister = Boolean(body.emojiAutoRegister);
        if (body.emojiUseRegistry !== undefined) cfg.emojiUseRegistry = Boolean(body.emojiUseRegistry);
        if (body.emojiMaxCacheSizeMb !== undefined) cfg.emojiMaxCacheSizeMb = Math.max(1, Math.min(20, parseInt(body.emojiMaxCacheSizeMb, 10) || 5));
        if (body.emojiVlmPrompt !== undefined) cfg.emojiVlmPrompt = String(body.emojiVlmPrompt || DEFAULT_EMOJI_VLM_PROMPT).trim() || DEFAULT_EMOJI_VLM_PROMPT;
        if (body.fakeHumanGroupChatAttention !== undefined) cfg.fakeHumanGroupChatAttention = String(body.fakeHumanGroupChatAttention || DEFAULT_FAKEHUMAN_GROUP_CHAT_ATTENTION).trim();
        if (body.fakeHumanMultipleReplyStyle !== undefined) cfg.fakeHumanMultipleReplyStyle = Array.isArray(body.fakeHumanMultipleReplyStyle) ? body.fakeHumanMultipleReplyStyle.map(String).filter(Boolean) : cfg.fakeHumanMultipleReplyStyle;
        if (body.fakeHumanMultipleProbability !== undefined) cfg.fakeHumanMultipleProbability = Math.max(0, Math.min(1, parseFloat(body.fakeHumanMultipleProbability) || 0));
        if (body.fakeHumanPersonalityStates !== undefined) cfg.fakeHumanPersonalityStates = Array.isArray(body.fakeHumanPersonalityStates) ? body.fakeHumanPersonalityStates.map(String).filter(Boolean) : [];
        if (body.fakeHumanStateProbability !== undefined) cfg.fakeHumanStateProbability = Math.max(0, Math.min(1, parseFloat(body.fakeHumanStateProbability) || 0));
        if (body.fakeHumanEnableMemoryRecall !== undefined) cfg.fakeHumanEnableMemoryRecall = Boolean(body.fakeHumanEnableMemoryRecall);
        if (body.fakeHumanEnableExpressionLearning !== undefined) cfg.fakeHumanEnableExpressionLearning = Boolean(body.fakeHumanEnableExpressionLearning);
        if (body.fakeHumanEnableSlangLearning !== undefined) cfg.fakeHumanEnableSlangLearning = Boolean(body.fakeHumanEnableSlangLearning);
        if (body.fakeHumanEnableBehaviorLearning !== undefined) cfg.fakeHumanEnableBehaviorLearning = Boolean(body.fakeHumanEnableBehaviorLearning);
        if (body.fakeHumanMemoryRecallLimit !== undefined) cfg.fakeHumanMemoryRecallLimit = Math.max(1, Math.min(10, parseInt(body.fakeHumanMemoryRecallLimit, 10) || 3));
        if (body.fakeHumanMemoryMinIntervalSec !== undefined) cfg.fakeHumanMemoryMinIntervalSec = Math.max(30, parseInt(body.fakeHumanMemoryMinIntervalSec, 10) || 120);
        if (body.fakeHumanMemoryMinNewMessages !== undefined) cfg.fakeHumanMemoryMinNewMessages = Math.max(1, parseInt(body.fakeHumanMemoryMinNewMessages, 10) || 6);
        if (body.fakeHumanLearnStylePrompt !== undefined) cfg.fakeHumanLearnStylePrompt = String(body.fakeHumanLearnStylePrompt || DEFAULT_LEARN_STYLE_PROMPT).trim();
        if (body.fakeHumanLearnBehaviorPrompt !== undefined) cfg.fakeHumanLearnBehaviorPrompt = String(body.fakeHumanLearnBehaviorPrompt || DEFAULT_LEARN_BEHAVIOR_PROMPT).trim();
        if (body.fakeHumanEvaluateBehaviorPrompt !== undefined) cfg.fakeHumanEvaluateBehaviorPrompt = String(body.fakeHumanEvaluateBehaviorPrompt || DEFAULT_EVALUATE_BEHAVIOR_PROMPT).trim();
        if (body.fakeHumanMaxLength !== undefined) cfg.fakeHumanMaxLength = Math.max(10, Math.min(200, parseInt(body.fakeHumanMaxLength, 10) || 80));
        if (body.fakeHumanEnableGroups !== undefined) cfg.fakeHumanEnableGroups = Array.isArray(body.fakeHumanEnableGroups) ? body.fakeHumanEnableGroups.map(String).filter(Boolean) : [];
        if (body.fakeHumanContextLines !== undefined) cfg.fakeHumanContextLines = Math.max(1, Math.min(50, parseInt(body.fakeHumanContextLines, 10) || 5));
        if (body.fakeHumanWebSearch !== undefined) cfg.fakeHumanWebSearch = Boolean(body.fakeHumanWebSearch);
        if (body.fakeHumanSyncPersona !== undefined) cfg.fakeHumanSyncPersona = Boolean(body.fakeHumanSyncPersona);
        if (body.fakeHumanFollowUpRounds !== undefined) cfg.fakeHumanFollowUpRounds = Math.max(0, Math.min(10, parseInt(body.fakeHumanFollowUpRounds, 10) ?? 2));
        if (body.fakeHumanFollowUpTimeoutMs !== undefined) cfg.fakeHumanFollowUpTimeoutMs = Math.max(10000, parseInt(body.fakeHumanFollowUpTimeoutMs, 10) || 120000);
        if (body.fakeHumanActionMode !== undefined) cfg.fakeHumanActionMode = ['reply', 'at', 'poke', 'ai_choose'].includes(String(body.fakeHumanActionMode).toLowerCase()) ? String(body.fakeHumanActionMode).toLowerCase() : 'reply';
        if (body.autoUpdateEnabled !== undefined) cfg.autoUpdateEnabled = bool('autoUpdateEnabled', true);
        if (body.autoUpdateIntervalHours !== undefined) cfg.autoUpdateIntervalHours = num('autoUpdateIntervalHours', 24, 1, 168);
        if (body.autoUpdateLastCheckAt !== undefined) cfg.autoUpdateLastCheckAt = num('autoUpdateLastCheckAt', 0, 0, Number.MAX_SAFE_INTEGER);
        if (body.autoUpdateLastResult !== undefined) cfg.autoUpdateLastResult = str('autoUpdateLastResult', '');
        if (body.updateMirrorMode !== undefined) cfg.updateMirrorMode = String(body.updateMirrorMode) === 'manual' ? 'manual' : 'auto';
        if (body.updateMirrorId !== undefined) cfg.updateMirrorId = String(body.updateMirrorId || MIRROR_DIRECT_ID);
        if (body.updateMirrorBenchmark !== undefined && body.updateMirrorBenchmark && typeof body.updateMirrorBenchmark === 'object') {
          cfg.updateMirrorBenchmark = body.updateMirrorBenchmark;
        }
        if (body.updateMirrorBestId !== undefined) cfg.updateMirrorBestId = String(body.updateMirrorBestId || '');
        if (body.updateMirrorBestTestedAt !== undefined) cfg.updateMirrorBestTestedAt = num('updateMirrorBestTestedAt', 0, 0, Number.MAX_SAFE_INTEGER);
        if (body.fakeHumanParseImage !== undefined) cfg.fakeHumanParseImage = Boolean(body.fakeHumanParseImage);
        if (body.fakeHumanBurstEnabled !== undefined) cfg.fakeHumanBurstEnabled = Boolean(body.fakeHumanBurstEnabled);
        if (body.fakeHumanBurstDelayMs !== undefined) cfg.fakeHumanBurstDelayMs = num('fakeHumanBurstDelayMs', 800, 200, 5000);
        if (body.fakeHumanBurstMaxLen !== undefined) cfg.fakeHumanBurstMaxLen = num('fakeHumanBurstMaxLen', 28, 8, 80);
        if (body.fakeHumanBurstMaxMessages !== undefined) cfg.fakeHumanBurstMaxMessages = num('fakeHumanBurstMaxMessages', 4, 1, 8);
        if (body.fakeHumanVisionModel !== undefined) cfg.fakeHumanVisionModel = String(body.fakeHumanVisionModel || '').trim();
        if (body.agentToolsEnabled !== undefined) cfg.agentToolsEnabled = Boolean(body.agentToolsEnabled);
        if (body.agentMaxToolRounds !== undefined) cfg.agentMaxToolRounds = num('agentMaxToolRounds', 6, 1, 999);
        if (body.skillsEnabled !== undefined) cfg.skillsEnabled = Boolean(body.skillsEnabled);
        if (body.skillsInjectMode !== undefined) {
          const sm = String(body.skillsInjectMode || 'auto').toLowerCase();
          cfg.skillsInjectMode = ['auto', 'all', 'none', 'off'].includes(sm) ? sm : 'auto';
        }
        if (body.skillsMaxHints !== undefined) cfg.skillsMaxHints = num('skillsMaxHints', 4, 1, 8);
        if (body.skillsDirs !== undefined) cfg.skillsDirs = Array.isArray(body.skillsDirs) ? body.skillsDirs.map(String) : [];
        if (body.skillsAllowlist !== undefined) cfg.skillsAllowlist = Array.isArray(body.skillsAllowlist) ? body.skillsAllowlist.map(String) : [];
        if (body.mcpEnabled !== undefined) cfg.mcpEnabled = Boolean(body.mcpEnabled);
        if (body.mcpServers !== undefined) cfg.mcpServers = Array.isArray(body.mcpServers) ? body.mcpServers : [];
        if (body.skillhubRegistry !== undefined) cfg.skillhubRegistry = String(body.skillhubRegistry || 'https://skill.xfyun.cn').trim();
        if (body.skillhubToken !== undefined) cfg.skillhubToken = String(body.skillhubToken || '').trim();
        if (body.skillhubEnvReady !== undefined) cfg.skillhubEnvReady = Boolean(body.skillhubEnvReady);
        if (body.skillhubCliPath !== undefined) cfg.skillhubCliPath = String(body.skillhubCliPath || '').trim();
        if (body.agentShellEnabled !== undefined) cfg.agentShellEnabled = Boolean(body.agentShellEnabled);
        if (body.agentShellType !== undefined) cfg.agentShellType = String(body.agentShellType || 'auto');
        if (body.agentShellTimeoutMs !== undefined) cfg.agentShellTimeoutMs = num('agentShellTimeoutMs', 120000, 5000, 600000);
        if (body.agentShellBlockPatterns !== undefined) cfg.agentShellBlockPatterns = Array.isArray(body.agentShellBlockPatterns) ? body.agentShellBlockPatterns.map(String).filter(Boolean) : [];
        if (body.agentShellVisible !== undefined) cfg.agentShellVisible = Boolean(body.agentShellVisible);
        if (body.agentToolWebSearchEnabled !== undefined) cfg.agentToolWebSearchEnabled = Boolean(body.agentToolWebSearchEnabled);
        if (body.agentToolCurrentTimeEnabled !== undefined) cfg.agentToolCurrentTimeEnabled = Boolean(body.agentToolCurrentTimeEnabled);
        if (body.agentToolMcpEnabled !== undefined) cfg.agentToolMcpEnabled = Boolean(body.agentToolMcpEnabled);
        if (body.agentToolShellExecEnabled !== undefined) cfg.agentToolShellExecEnabled = Boolean(body.agentToolShellExecEnabled);
        if (body.agentToolFileManagerEnabled !== undefined) cfg.agentToolFileManagerEnabled = Boolean(body.agentToolFileManagerEnabled);
        if (body.agentToolRegistryEnabled !== undefined) cfg.agentToolRegistryEnabled = Boolean(body.agentToolRegistryEnabled);
        if (body.agentToolExplorerEnabled !== undefined) cfg.agentToolExplorerEnabled = Boolean(body.agentToolExplorerEnabled);
        if (body.agentToolBrowserSnapshotEnabled !== undefined) cfg.agentToolBrowserSnapshotEnabled = Boolean(body.agentToolBrowserSnapshotEnabled);
        if (body.agentToolBrowserActEnabled !== undefined) cfg.agentToolBrowserActEnabled = Boolean(body.agentToolBrowserActEnabled);
        if (body.agentDangerGuardEnabled !== undefined) cfg.agentDangerGuardEnabled = Boolean(body.agentDangerGuardEnabled);
        if (body.agentDangerRequireAdmin !== undefined) cfg.agentDangerRequireAdmin = Boolean(body.agentDangerRequireAdmin);
        if (body.agentDangerRequireWebConfirm !== undefined) cfg.agentDangerRequireWebConfirm = Boolean(body.agentDangerRequireWebConfirm);
        if (body.agentDangerConfirmDelaySec !== undefined) cfg.agentDangerConfirmDelaySec = num('agentDangerConfirmDelaySec', 5, 0, 30);
        if (body.agentDangerConfirmExpireSec !== undefined) cfg.agentDangerConfirmExpireSec = num('agentDangerConfirmExpireSec', 20, 5, 180);
        if (body.agentDangerOnSystemPower !== undefined) cfg.agentDangerOnSystemPower = Boolean(body.agentDangerOnSystemPower);
        if (body.agentDangerOnShellDelete !== undefined) cfg.agentDangerOnShellDelete = Boolean(body.agentDangerOnShellDelete);
        if (body.agentDangerOnFileDelete !== undefined) cfg.agentDangerOnFileDelete = Boolean(body.agentDangerOnFileDelete);
        if (body.agentDangerOnRegistryWrite !== undefined) cfg.agentDangerOnRegistryWrite = Boolean(body.agentDangerOnRegistryWrite);
        if (body.agentBrowserEnabled !== undefined) cfg.agentBrowserEnabled = Boolean(body.agentBrowserEnabled);
        if (body.agentBrowserEngine !== undefined) {
          const eng = String(body.agentBrowserEngine || 'playwright').toLowerCase();
          cfg.agentBrowserEngine = eng === 'browser-use' ? 'browser-use' : 'playwright';
        }
        if (body.agentBrowserUsePlaywright !== undefined) cfg.agentBrowserUsePlaywright = Boolean(body.agentBrowserUsePlaywright);
        if (body.agentBrowserHeadless !== undefined) cfg.agentBrowserHeadless = Boolean(body.agentBrowserHeadless);
        if (body.agentBrowserVisibleCloseDelayMs !== undefined) cfg.agentBrowserVisibleCloseDelayMs = num('agentBrowserVisibleCloseDelayMs', 8000, 1000, 120000);
        if (body.agentBrowserUseEnvReady !== undefined) cfg.agentBrowserUseEnvReady = Boolean(body.agentBrowserUseEnvReady);
        if (body.agentBrowserUseSameLlm !== undefined) cfg.agentBrowserUseSameLlm = Boolean(body.agentBrowserUseSameLlm);
        if (body.agentBrowserUseProvider !== undefined) cfg.agentBrowserUseProvider = String(body.agentBrowserUseProvider || 'openai').toLowerCase();
        if (body.agentBrowserUseApiUrl !== undefined) cfg.agentBrowserUseApiUrl = String(body.agentBrowserUseApiUrl || '').trim();
        if (body.agentBrowserUseApiKey !== undefined) cfg.agentBrowserUseApiKey = String(body.agentBrowserUseApiKey || '').trim();
        if (body.agentBrowserUseModel !== undefined) cfg.agentBrowserUseModel = String(body.agentBrowserUseModel || '').trim();
        if (body.agentBrowserUseMaxSteps !== undefined) cfg.agentBrowserUseMaxSteps = num('agentBrowserUseMaxSteps', 30, 5, 80);
        if (body.agentBrowserUseTimeoutMs !== undefined) cfg.agentBrowserUseTimeoutMs = num('agentBrowserUseTimeoutMs', 300000, 60000, 900000);
        if (body.agentToolBrowserUseTaskEnabled !== undefined) cfg.agentToolBrowserUseTaskEnabled = Boolean(body.agentToolBrowserUseTaskEnabled);
        if (body.agentQqToolsEnabled !== undefined) cfg.agentQqToolsEnabled = Boolean(body.agentQqToolsEnabled);
        if (body.agentQqContextEnabled !== undefined) cfg.agentQqContextEnabled = Boolean(body.agentQqContextEnabled);
        if (body.agentQqGroupContextEnabled !== undefined) cfg.agentQqGroupContextEnabled = Boolean(body.agentQqGroupContextEnabled);
        if (body.agentQqGroupContextAuto !== undefined) cfg.agentQqGroupContextAuto = Boolean(body.agentQqGroupContextAuto);
        if (body.agentQqGroupContextLines !== undefined) cfg.agentQqGroupContextLines = num('agentQqGroupContextLines', 10, 1, 50);
        if (body.agentToolQqUserInfoEnabled !== undefined) cfg.agentToolQqUserInfoEnabled = Boolean(body.agentToolQqUserInfoEnabled);
        if (body.agentToolQqGroupInfoEnabled !== undefined) cfg.agentToolQqGroupInfoEnabled = Boolean(body.agentToolQqGroupInfoEnabled);
        if (body.agentToolQqGroupContextEnabled !== undefined) cfg.agentToolQqGroupContextEnabled = Boolean(body.agentToolQqGroupContextEnabled);
        if (body.agentToolQqGroupExtendedEnabled !== undefined) cfg.agentToolQqGroupExtendedEnabled = Boolean(body.agentToolQqGroupExtendedEnabled);
        if (body.agentToolQqNapcatEnabled !== undefined) cfg.agentToolQqNapcatEnabled = Boolean(body.agentToolQqNapcatEnabled);
        if (body.agentToolQqNapcatAllowWrite !== undefined) cfg.agentToolQqNapcatAllowWrite = Boolean(body.agentToolQqNapcatAllowWrite);
        if (body.agentToolQqNapcatDangerGuard !== undefined) cfg.agentToolQqNapcatDangerGuard = Boolean(body.agentToolQqNapcatDangerGuard);
        if (body.agentToolQqNapcatMaxResultChars !== undefined) cfg.agentToolQqNapcatMaxResultChars = Math.max(2000, Math.min(50000, parseInt(body.agentToolQqNapcatMaxResultChars, 10) || 12000));
        if (body.agentBiliToolsEnabled !== undefined) cfg.agentBiliToolsEnabled = Boolean(body.agentBiliToolsEnabled);
        if (body.agentToolBiliCatalogEnabled !== undefined) cfg.agentToolBiliCatalogEnabled = Boolean(body.agentToolBiliCatalogEnabled);
        if (body.agentToolBiliCallEnabled !== undefined) cfg.agentToolBiliCallEnabled = Boolean(body.agentToolBiliCallEnabled);
        if (body.agentToolBiliQuickEnabled !== undefined) cfg.agentToolBiliQuickEnabled = Boolean(body.agentToolBiliQuickEnabled);
        if (body.agentToolBiliAllowWrite !== undefined) cfg.agentToolBiliAllowWrite = Boolean(body.agentToolBiliAllowWrite);
        if (body.agentToolBiliLoginQrEnabled !== undefined) cfg.agentToolBiliLoginQrEnabled = Boolean(body.agentToolBiliLoginQrEnabled);
        if (body.agentToolBiliDangerGuard !== undefined) cfg.agentToolBiliDangerGuard = Boolean(body.agentToolBiliDangerGuard);
        if (body.agentToolBiliMaxResultChars !== undefined) cfg.agentToolBiliMaxResultChars = Math.max(2000, Math.min(50000, parseInt(body.agentToolBiliMaxResultChars, 10) || 12000));
        if (body.agentToolBiliTimeoutMs !== undefined) cfg.agentToolBiliTimeoutMs = Math.max(5000, Math.min(120000, parseInt(body.agentToolBiliTimeoutMs, 10) || 30000));
        if (body.agentBrowserAdvancedEnabled !== undefined) cfg.agentBrowserAdvancedEnabled = Boolean(body.agentBrowserAdvancedEnabled);
        if (body.agentBrowserUserAgent !== undefined) cfg.agentBrowserUserAgent = String(body.agentBrowserUserAgent || '').trim();
        if (body.agentBrowserExtraHeaders !== undefined) cfg.agentBrowserExtraHeaders = body.agentBrowserExtraHeaders && typeof body.agentBrowserExtraHeaders === 'object' && !Array.isArray(body.agentBrowserExtraHeaders) ? body.agentBrowserExtraHeaders : {};
        if (body.agentBrowserCookies !== undefined) cfg.agentBrowserCookies = Array.isArray(body.agentBrowserCookies) ? body.agentBrowserCookies : [];
        if (body.agentBrowserCookieSites !== undefined) cfg.agentBrowserCookieSites = Array.isArray(body.agentBrowserCookieSites) ? body.agentBrowserCookieSites : [];
        saveConfig(ctx);
        if (cfg.mcpEnabled) {
          ensureAgentMcpHub(cfg, true).catch((e) => log('warn', 'MCP 重载失败', e.message, 'mcp'));
        } else if (pluginState.mcpHub) {
          pluginState.mcpHub.closeAll().catch(() => {});
          pluginState.mcpHub = null;
        }
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

      router.getNoAuth('/emoji-registry', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          ensureEmojiRegistry(store);
          const status = req.query?.registered === 'true' ? 'owned' : (req.query?.status || 'all');
          const result = listEmojiLibrary(store, {
            status,
            groupId: req.query?.groupId || '',
            q: req.query?.q || '',
            limit: parseInt(req.query?.limit, 10) || 500,
            imageBase: 'emoji-library/image'
          });
          res.json({ success: true, stats: getEmojiLibraryStats(store), total: result.total, data: result.data });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/emoji-library/stats', (_, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          ensureEmojiRegistry(store);
          res.json({ success: true, stats: getEmojiLibraryStats(store), groups: listEmojiSourceGroups(store) });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/emoji-library/image/:id', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const rec = findEmojiRecord(store, decodeURIComponent(req.params.id || ''));
          if (!rec?.localPath || !fs.existsSync(rec.localPath)) return res.status(404).end();
          const ext = path.extname(rec.localPath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          fs.createReadStream(rec.localPath).pipe(res);
        } catch {
          res.status(500).end();
        }
      });

      router.getNoAuth('/emoji-library', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          ensureEmojiRegistry(store);
          const fixed = normalizeEmojiRegistry(store);
          if (fixed > 0) persistMaisakaStore(rtCtx);
          const imageBase = 'emoji-library/image';
          const result = listEmojiLibrary(store, {
            status: req.query?.status || 'all',
            groupId: req.query?.groupId || req.query?.group_id || '',
            q: req.query?.q || '',
            limit: parseInt(req.query?.limit, 10) || 50,
            offset: parseInt(req.query?.offset, 10) || 0,
            imageBase
          });
          res.json({
            success: true,
            statuses: EMOJI_STATUSES,
            stats: getEmojiLibraryStats(store),
            groups: listEmojiSourceGroups(store),
            total: result.total,
            data: result.data
          });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.postNoAuth('/emoji-library/status', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || req.body?.hash || '').trim();
          const status = String(req.body?.status || '').trim();
          const rec = updateEmojiStatus(store, id, status);
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, emoji: serializeEmojiItem(store, rec, { imageBase: 'emoji-library/image' }) });
        } catch (e) {
          res.json({ success: false, error: e.message || String(e) });
        }
      });

      router.postNoAuth('/emoji-library/update', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || req.body?.hash || '').trim();
          const rec = updateEmojiMeta(store, id, {
            description: req.body?.description,
            emotions: req.body?.emotions ?? req.body?.tags
          });
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, emoji: serializeEmojiItem(store, rec, { imageBase: 'emoji-library/image' }) });
        } catch (e) {
          res.json({ success: false, error: e.message || String(e) });
        }
      });

      router.postNoAuth('/emoji-library/batch', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
          const status = String(req.body?.status || '').trim();
          const updated = batchUpdateEmojiStatus(store, ids, status);
          persistMaisakaStore(rtCtx);
          res.json({ success: true, count: updated.length });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/emoji-library/delete', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const cacheDir = getEmojiCacheDir(rtCtx);
          const id = String(req.body?.id || '').trim();
          if (!deleteEmojiRecord(store, id, cacheDir)) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/emoji-library/clear', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const cacheDir = getEmojiCacheDir(rtCtx);
          const status = String(req.body?.status || '').trim();
          const n = clearEmojiByStatus(store, status, cacheDir);
          persistMaisakaStore(rtCtx);
          res.json({ success: true, cleared: n });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/emoji-registry/toggle', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || req.body?.hash || '').trim();
          const registered = req.body?.registered !== false;
          const rec0 = findEmojiRecord(store, id);
          if (!rec0) return res.json({ success: false, error: 'not_found' });
          const target = registered ? 'owned' : 'recognized';
          const rec = updateEmojiStatus(store, id, target);
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, emoji: serializeEmojiItem(store, rec, { imageBase: 'emoji-library/image' }) });
        } catch (e) {
          res.json({ success: false, error: e.message || String(e) });
        }
      });

      router.getNoAuth('/expressions/stats', (_, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          res.json({
            success: true,
            stats: getExpressionStats(store),
            settings: getExpressionSettings(store),
            groups: listExpressionGroups(store)
          });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/expressions', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const result = listExpressions(store, {
            status: req.query?.status || 'all',
            groupId: req.query?.groupId || req.query?.group_id || '',
            q: req.query?.q || '',
            limit: parseInt(req.query?.limit, 10) || 50,
            offset: parseInt(req.query?.offset, 10) || 0
          });
          res.json({
            success: true,
            stats: getExpressionStats(store),
            settings: getExpressionSettings(store),
            groups: listExpressionGroups(store),
            total: result.total,
            data: result.data
          });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.postNoAuth('/expressions', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const rec = createExpression(store, req.body || {});
          persistMaisakaStore(rtCtx);
          res.json({ success: true, expression: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/expressions/update', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          const rec = updateExpression(store, id, req.body || {});
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, expression: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/expressions/review', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          const action = String(req.body?.action || 'pass').trim();
          const rec = reviewExpression(store, id, action, req.body?.reviewer || 'manual');
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, expression: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/expressions/delete', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          if (!deleteExpression(store, id)) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/expressions/clear', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const status = String(req.body?.status || 'all').trim();
          const n = clearExpressions(store, status === 'all' ? '' : status);
          persistMaisakaStore(rtCtx);
          res.json({ success: true, cleared: n });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/expressions/settings', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const settings = getExpressionSettings(store);
          if (req.body?.learningEnabled != null) settings.learningEnabled = !!req.body.learningEnabled;
          if (req.body?.usageEnabled != null) settings.usageEnabled = !!req.body.usageEnabled;
          if (req.body?.autoAiPass != null) settings.autoAiPass = !!req.body.autoAiPass;
          store.expressionSettings = settings;
          persistMaisakaStore(rtCtx);
          res.json({ success: true, settings });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/slangs/stats', (_, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          res.json({
            success: true,
            stats: getSlangStats(store),
            settings: getSlangSettings(store),
            groups: listSlangGroups(store)
          });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/slangs', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const result = listSlangs(store, {
            status: req.query?.status || 'all',
            groupId: req.query?.groupId || req.query?.group_id || '',
            type: req.query?.type || '',
            q: req.query?.q || '',
            limit: parseInt(req.query?.limit, 10) || 50,
            offset: parseInt(req.query?.offset, 10) || 0
          });
          res.json({
            success: true,
            stats: getSlangStats(store),
            settings: getSlangSettings(store),
            groups: listSlangGroups(store),
            total: result.total,
            data: result.data
          });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.postNoAuth('/slangs', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const rec = createSlang(store, req.body || {});
          persistMaisakaStore(rtCtx);
          res.json({ success: true, data: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/import', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const raw = String(req.body?.content || req.body?.text || '').trim();
          const format = String(req.body?.format || 'auto').trim();
          const groupId = String(req.body?.groupId || req.body?.group_id || '').trim();
          const parsed = parseSlangImport(raw, format);
          if (!parsed.items.length) {
            return res.json({ success: false, error: parsed.errors.join('；') || '未解析到词条', errors: parsed.errors });
          }
          const result = importSlangs(store, parsed.items, { groupId, skipDuplicate: req.body?.skipDuplicate !== false });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, ...result, errors: parsed.errors });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/update', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          const rec = updateSlang(store, id, req.body || {});
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, data: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/review', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          const action = String(req.body?.action || 'pass').trim();
          const rec = reviewSlang(store, id, action);
          if (!rec) return res.json({ success: false, error: 'not_found' });
          persistMaisakaStore(rtCtx);
          res.json({ success: true, data: rec });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/delete', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const id = String(req.body?.id || '').trim();
          const ok = deleteSlang(store, id);
          persistMaisakaStore(rtCtx);
          res.json({ success: ok, error: ok ? undefined : 'not_found' });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/clear', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const status = String(req.body?.status || 'all').trim();
          const n = clearSlangs(store, status === 'all' ? '' : status);
          persistMaisakaStore(rtCtx);
          res.json({ success: true, cleared: n });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/slangs/settings', (req, res) => {
        try {
          const rtCtx = pluginState.runtimeCtx || ctx;
          const store = getMaisakaStore(rtCtx);
          const settings = getSlangSettings(store);
          if (req.body?.learningEnabled != null) settings.learningEnabled = !!req.body.learningEnabled;
          if (req.body?.usageEnabled != null) settings.usageEnabled = !!req.body.usageEnabled;
          if (req.body?.autoAiPass != null) settings.autoAiPass = !!req.body.autoAiPass;
          store.slangSettings = settings;
          persistMaisakaStore(rtCtx);
          res.json({ success: true, settings });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/napcat-api/catalog', (req, res) => {
        try {
          const q = String(req.query?.q || req.query?.keyword || '').trim();
          const category = String(req.query?.category || '').trim();
          const limit = Math.max(1, Math.min(200, parseInt(req.query?.limit, 10) || 50));
          const list = q || category
            ? searchNapCatCatalog({ keyword: q, category, limit })
            : NAPCAT_API_CATALOG.slice(0, limit);
          res.json({
            success: true,
            total: NAPCAT_API_CATALOG.length,
            docUrl: NAPCAT_API_DOC_URL,
            categories: listNapCatCategories(),
            data: list
          });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/bili-api/catalog', (req, res) => {
        try {
          const cfg = pluginState.config || {};
          const q = String(req.query?.q || req.query?.keyword || '').trim();
          const category = String(req.query?.category || '').trim();
          const limit = Math.max(1, Math.min(200, parseInt(req.query?.limit, 10) || 50));
          const qqUserId = String(req.query?.qqUserId || '').trim();
          const list = q || category
            ? searchBiliCatalog({ keyword: q, category, limit })
            : BILI_API_CATALOG.slice(0, limit);
          res.json({
            success: true,
            total: BILI_API_CATALOG.length,
            docUrl: BILI_API_DOC_URL,
            cookieStatus: describeBiliCookieStatus(cfg, undefined, qqUserId, sqliteDbRef),
            categories: listBiliCategories(),
            data: list
          });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/sqlite/env/status', async (_, res) => {
        try {
          const detected = await detectSqliteDriver(__dirname);
          const configDir = getConfigDir(ctx);
          const dbPath = getDbPath(configDir);
          res.json({
            success: true,
            data: {
              driver: detected.driver || '',
              ready: detected.ok,
              dbPath: fs.existsSync(dbPath) ? dbPath : '',
              dbOpen: !!sqliteDbRef,
              migrated: sqliteDbRef ? getMeta(sqliteDbRef, 'json_migrated') === '1' : false,
              error: detected.error || ''
            },
            mirrors: NPM_MIRRORS
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/sqlite/env/progress', (req, res) => {
        const since = Number(req.query?.since) || 0;
        res.json({ success: true, ...getSqliteSetupState(since) });
      });

      router.postNoAuth('/sqlite/env/install', async (req, res) => {
        try {
          const mirror = String(req.body?.mirror || 'npmmirror').trim();
          if (getSqliteSetupState().running) {
            res.json({ success: false, error: 'SQLite 安装任务进行中' });
            return;
          }
          res.json({ success: true, started: true });
          runSqliteSetup(__dirname, { mirror }).then(async (result) => {
            if (result.ok) {
              closeDatabase();
              sqliteDbRef = null;
              maisakaStoreCache = null;
              await initSqliteStore(ctx);
              log('info', 'SQLite 环境部署完成', { driver: result.driver }, 'system');
            }
          }).catch((e) => log('error', 'SQLite 安装失败', e.message, 'system'));
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/bili/auth/qr/start', async (req, res) => {
        try {
          const qqUserId = String(req.body?.qqUserId || '').trim();
          if (!qqUserId) return res.status(400).json({ success: false, error: 'qqUserId 不能为空' });
          if (!sqliteDbRef) await initSqliteStore(ctx);
          if (!sqliteDbRef) return res.json({ success: false, error: 'SQLite 未就绪，请先在 Dashboard 一键部署 SQLite' });
          const data = await startBiliQrLogin(sqliteDbRef, qqUserId);
          res.json({ success: true, data });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/bili/auth/qr/poll', async (req, res) => {
        try {
          const sessionKey = String(req.query?.sessionKey || '').trim();
          if (!sessionKey) return res.status(400).json({ success: false, error: 'sessionKey 不能为空' });
          if (!sqliteDbRef) return res.json({ success: false, error: 'SQLite 未就绪' });
          const data = await pollBiliQrLogin(sqliteDbRef, sessionKey);
          res.json({ success: true, data });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/bili/auth/sessions', (_, res) => {
        res.json({ success: true, data: sqliteDbRef ? listBiliSessions(sqliteDbRef) : [] });
      });

      router.getNoAuth('/bili/auth/session', (req, res) => {
        const qqUserId = String(req.query?.qqUserId || '').trim();
        if (!sqliteDbRef || !qqUserId) return res.json({ success: true, data: null });
        const session = getBiliSession(sqliteDbRef, qqUserId);
        const safe = session ? { ...session, cookies: undefined, cookieCount: (session.cookies || []).length } : null;
        res.json({ success: true, data: safe });
      });

      router.postNoAuth('/bili/auth/session/delete', (req, res) => {
        try {
          const qqUserId = String(req.body?.qqUserId || '').trim();
          if (!sqliteDbRef || !qqUserId) return res.json({ success: false, error: '无效参数' });
          const ok = deleteBiliSession(sqliteDbRef, qqUserId);
          res.json({ success: ok, deleted: ok });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/user-profiles', (req, res) => {
        try {
          if (!sqliteDbRef) return res.json({ success: true, data: [] });
          const data = listUserProfiles(sqliteDbRef, {
            groupId: req.query?.groupId,
            q: req.query?.q,
            limit: req.query?.limit
          });
          res.json({ success: true, data });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/observe/groups', async (_, res) => {
        try {
          const groups = listObserveGroups();
          try {
            const raw = await callAction('get_group_list', {});
            const glist = Array.isArray(raw) ? raw : (raw?.data || raw?.result || []);
            for (const g of glist) {
              const id = String(g.group_id ?? g.groupId ?? '');
              if (id) touchObserveGroupName(id, g.group_name || g.groupName || '');
            }
          } catch { /* ignore */ }
          res.json({ success: true, data: listObserveGroups(), global: getObserveGlobalStats() });
        } catch (e) {
          res.json({ success: false, data: [], error: e.message });
        }
      });

      router.getNoAuth('/observe/feed', (req, res) => {
        try {
          const groupId = String(req.query?.groupId || '').trim();
          if (!groupId) return res.status(400).json({ success: false, error: 'groupId 必填' });
          const sinceId = Number(req.query?.sinceEventId) || 0;
          const chatLimit = Math.max(10, Math.min(200, Number(req.query?.chatLimit) || 80));
          res.json({
            success: true,
            groupId,
            chat: getObserveChat(groupId, chatLimit),
            events: getObserveEvents(groupId, sinceId),
            stats: getObserveStats(groupId),
            loopRunning: isObserveLoopRunning(groupId)
          });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/observe/stats', (req, res) => {
        const groupId = String(req.query?.groupId || '').trim();
        if (!groupId) {
          return res.json({ success: true, global: getObserveGlobalStats(), groups: listObserveGroups() });
        }
        res.json({ success: true, data: getObserveStats(groupId) });
      });

      router.postNoAuth('/observe/loop/start', async (req, res) => {
        try {
          const groupId = String(req.body?.groupId || '').trim();
          if (!groupId) return res.status(400).json({ success: false, error: 'groupId 必填' });
          const intervalMs = Math.max(5000, Math.min(120000, Number(req.body?.intervalMs) || Number(pluginState.config.observeLoopIntervalMs) || 15000));
          const executeOutbound = Boolean(req.body?.executeOutbound);
          if (isObserveLoopRunning(groupId)) {
            return res.json({ success: false, error: '该群观察循环已在运行' });
          }
          const r = startObserveLoop(groupId, async () => {
            await runObservePlannerForGroup(ctx, groupId, 'loop', executeOutbound);
          }, intervalMs);
          res.json({ success: r.ok !== false, ...r, intervalMs });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/observe/loop/stop', (req, res) => {
        const groupId = String(req.body?.groupId || '').trim();
        if (!groupId) return res.status(400).json({ success: false, error: 'groupId 必填' });
        res.json({ success: true, ...stopObserveLoop(groupId) });
      });

      router.postNoAuth('/observe/planner/tick', async (req, res) => {
        try {
          const groupId = String(req.body?.groupId || '').trim();
          if (!groupId) return res.status(400).json({ success: false, error: 'groupId 必填' });
          const executeOutbound = Boolean(req.body?.executeOutbound);
          await runObservePlannerForGroup(ctx, groupId, 'manual', executeOutbound);
          res.json({ success: true, feed: getObserveEvents(groupId, 0).slice(-20) });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/observe/clear', (req, res) => {
        const groupId = String(req.body?.groupId || '').trim();
        if (!groupId) return res.status(400).json({ success: false, error: 'groupId 必填' });
        clearObserveGroup(groupId);
        res.json({ success: true });
      });

      router.getNoAuth('/kimi/models', async (req, res) => {
        try {
          const scope = String(req.query?.scope || 'vision').toLowerCase() === 'chat' ? 'chat' : 'vision';
          const models = await fetchKimiModels(scope);
          res.json({ success: true, models, scope });
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

      router.postNoAuth('/reactions/capture/start', async (req, res) => {
        try {
          const groupId = String(req.body?.groupId ?? req.body?.group_id ?? '').trim();
          const userId = String(req.body?.userId ?? req.body?.user_id ?? req.body?.qq ?? '').trim();
          if (!groupId || !userId) {
            return res.status(400).json({ success: false, error: '缺少群号或用户 QQ' });
          }
          const active = reactionCaptureSession && ['countdown', 'waiting', 'pending_remark'].includes(reactionCaptureSession.status);
          if (active) {
            return res.json({ success: false, error: '已有进行中的截取任务，请等待完成或取消' });
          }
          const ctx = pluginState.runtimeCtx;
          if (!ctx) return res.status(503).json({ success: false, error: '插件未就绪' });
          await startReactionCapture(ctx, { groupId, userId });
          res.json({ success: true, session: getReactionCapturePublic() });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/reactions/capture/status', (_, res) => {
        res.json({
          success: true,
          session: getReactionCapturePublic(),
          catalog: normalizeReactionCatalog(pluginState.config.reactionEmojiCatalog)
        });
      });

      router.postNoAuth('/reactions/capture/cancel', (_, res) => {
        cancelReactionCapture('cancelled');
        res.json({ success: true, session: getReactionCapturePublic() });
      });

      router.postNoAuth('/reactions/capture/confirm', async (req, res) => {
        try {
          const ctx = pluginState.runtimeCtx;
          if (!ctx) return res.status(503).json({ success: false, error: '插件未就绪' });
          const name = String(req.body?.name ?? req.body?.remark ?? '').trim();
          const entry = await confirmReactionCaptureRemark(ctx, name);
          res.json({
            success: true,
            entry,
            session: getReactionCapturePublic(),
            catalog: normalizeReactionCatalog(pluginState.config.reactionEmojiCatalog)
          });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/reactions/catalog/update', (req, res) => {
        try {
          const ctx = pluginState.runtimeCtx;
          if (!ctx) return res.status(503).json({ success: false, error: '插件未就绪' });
          const id = String(req.body?.id ?? '').trim();
          const name = req.body?.name ?? req.body?.remark;
          const result = updateReactionCatalogEntry(id, { name, glyph: req.body?.glyph }, ctx);
          if (!result.ok) return res.json({ success: false, error: result.error });
          res.json({
            success: true,
            entry: result.entry,
            catalog: normalizeReactionCatalog(pluginState.config.reactionEmojiCatalog)
          });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.postNoAuth('/reactions/catalog/delete', (req, res) => {
        try {
          const ctx = pluginState.runtimeCtx;
          if (!ctx) return res.status(503).json({ success: false, error: '插件未就绪' });
          const id = String(req.body?.id ?? '').trim();
          const result = removeReactionCatalogEntry(id, ctx);
          if (!result.ok) return res.json({ success: false, error: result.error });
          res.json({ success: true, catalog: result.catalog });
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/stats', async (_, res) => {
        const sourceRaw = normalizeTokenSource(_.query?.source || 'all');
        const source = (_.query?.source || '').toString().toLowerCase() === 'all' ? 'all' : sourceRaw;
        const sourceBucket = source === 'all'
          ? { prompt: tokenStats.totalPrompt, completion: tokenStats.totalCompletion, total: tokenStats.totalTokens }
          : (tokenStats.bySource.get(source) || { prompt: 0, completion: 0, total: 0 });
        const keyMap = source === 'all'
          ? tokenStats.byKey
          : (tokenStats.byKeySource.get(source) || new Map());

        const byKey = [];
        for (const [key, v] of keyMap.entries()) {
          byKey.push({ key, ...v });
        }
        const recentRaw = tokenStats.recent.slice(-50).reverse();
        const recent = source === 'all' ? recentRaw : recentRaw.filter((r) => r.source === source);
        const bySource = {};
        for (const [sKey, sVal] of tokenStats.bySource.entries()) {
          bySource[sKey] = { ...sVal };
        }
        const cfg = pluginState.config;
        let drawStats = null;
        if (cfg.drawBotEnabled) {
          const base = (cfg.drawBotApiUrl || 'http://127.0.0.1:1088').replace(/\/$/, '');
          drawStats = await fetchJson(`${base}/api/stats`);
        }
        res.json({
          success: true,
          source,
          totalPrompt: sourceBucket.prompt || 0,
          totalCompletion: sourceBucket.completion || 0,
          totalTokens: sourceBucket.total || 0,
          byKey: byKey.sort((a, b) => b.total - a.total),
          recent,
          bySource,
          toolCalls: { ...tokenStats.toolCalls },
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
            if (cached?.nickname && cached?.avatar && Date.now() - (cached.updatedAt || 0) < 3600000) {
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

      router.getNoAuth('/update/status', (_, res) => {
        const info = pluginState.updateInfo;
        res.json({
          success: true,
          currentVersion: readLocalVersion(__dirname),
          latestVersion: info?.latestVersion || null,
          hasUpdate: !!info?.hasUpdate,
          checkedAt: info?.checkedAt || pluginState.config.autoUpdateLastCheckAt || 0,
          releaseUrl: info?.release?.htmlUrl || UPDATE_REPO_URL + '/releases',
          updating: pluginState.updateRunning,
          autoUpdateEnabled: !!pluginState.config.autoUpdateEnabled,
          autoUpdateIntervalHours: pluginState.config.autoUpdateIntervalHours ?? 24,
          lastResult: pluginState.config.autoUpdateLastResult || '',
          updateMirrorMode: pluginState.config.updateMirrorMode === 'manual' ? 'manual' : 'auto',
          updateMirrorId: pluginState.config.updateMirrorId || MIRROR_DIRECT_ID,
          updateMirrorBestId: pluginState.config.updateMirrorBestId || '',
          updateMirrorBestTestedAt: pluginState.config.updateMirrorBestTestedAt || 0
        });
      });

      router.getNoAuth('/update/mirrors', (_, res) => {
        const cfg = pluginState.config;
        const mirrorCfg = getMirrorConfig(cfg);
        const activeId = resolveMirrorId(cfg);
        res.json({
          success: true,
          mirrors: listMirrors(),
          mode: mirrorCfg.mode,
          mirrorId: mirrorCfg.mirrorId,
          activeId,
          activeName: getMirrorById(activeId)?.name || activeId,
          benchmark: mirrorCfg.benchmark,
          bestId: mirrorCfg.bestId,
          bestTestedAt: mirrorCfg.bestTestedAt,
          testing: pluginState.mirrorBenchmarkRunning
        });
      });

      router.postNoAuth('/update/mirrors/test', async (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) return res.json({ success: false, error: '缺少 ids' });
        const testUrl = pluginState.updateInfo?.release?.downloadUrl || getDefaultMirrorTestUrl();
        try {
          const results = await Promise.all(ids.map((id) => testMirrorLatency(id, testUrl, 10000)));
          res.json({ success: true, results, testUrl });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/update/mirrors/benchmark', async (req, res) => {
        if (pluginState.mirrorBenchmarkRunning) {
          return res.json({ success: false, error: '测速正在进行中' });
        }
        pluginState.mirrorBenchmarkRunning = true;
        const testUrl = pluginState.updateInfo?.release?.downloadUrl || getDefaultMirrorTestUrl();
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : null;
        try {
          const { results, bestId, best } = await benchmarkMirrors(testUrl, ids, { concurrency: 6 });
          const cfg = pluginState.config;
          cfg.updateMirrorBenchmark = mergeBenchmarkResults(cfg.updateMirrorBenchmark, results);
          cfg.updateMirrorBestId = bestId;
          cfg.updateMirrorBestTestedAt = Date.now();
          saveConfig(ctx);
          res.json({
            success: true,
            results,
            bestId,
            best,
            testUrl
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        } finally {
          pluginState.mirrorBenchmarkRunning = false;
        }
      });

      router.postNoAuth('/update/mirrors/save', (req, res) => {
        const body = req.body || {};
        const cfg = pluginState.config;
        if (body.mode !== undefined) cfg.updateMirrorMode = body.mode === 'manual' ? 'manual' : 'auto';
        if (body.mirrorId !== undefined) cfg.updateMirrorId = String(body.mirrorId || MIRROR_DIRECT_ID);
        if (body.benchmark !== undefined && body.benchmark && typeof body.benchmark === 'object') {
          cfg.updateMirrorBenchmark = body.benchmark;
        }
        if (body.bestId !== undefined) cfg.updateMirrorBestId = String(body.bestId || '');
        if (body.bestTestedAt !== undefined) cfg.updateMirrorBestTestedAt = Number(body.bestTestedAt) || 0;
        saveConfig(ctx);
        res.json({ success: true });
      });

      router.postNoAuth('/update/check', async (_, res) => {
        try {
          const result = await runPluginUpdateCheck(ctx, { persist: true, autoApply: false });
          res.json(result);
        } catch (e) {
          res.json({ success: false, error: e.message });
        }
      });

      router.getNoAuth('/update/progress', (_, res) => {
        res.json({
          success: true,
          updating: pluginState.updateRunning,
          progress: pluginState.updateProgress,
          logs: pluginState.updateProgressLog || []
        });
      });

      router.postNoAuth('/update/apply', async (req, res) => {
        if (pluginState.updateRunning) {
          return res.json({ success: false, error: '更新正在进行中' });
        }
        try {
          if (!pluginState.updateInfo?.hasUpdate && !pluginState.updateInfo?.release) {
            await runPluginUpdateCheck(ctx, { persist: false, autoApply: false });
          }
          if (!pluginState.updateInfo?.hasUpdate) {
            return res.json({ success: false, error: '当前已是最新版本' });
          }
          const release = pluginState.updateInfo.release;
          pluginState.updateProgressLog = [];
          pluginState.updateProgress = { phase: 'prepare', message: '任务已启动…', percent: 0, at: Date.now() };
          res.json({ success: true, started: true, version: release.version });
          const runtimeCtx = ctx;
          setImmediate(() => {
            runPluginUpdateApply(runtimeCtx, release).catch((e) => {
              log('error', '后台更新失败', { error: e?.message || String(e) }, 'system');
            });
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/update/reload', async (_, res) => {
        try {
          const result = await tryReloadPlugin(ctx);
          if (result.ok) {
            log('info', '手动触发热重载成功', result, 'system');
            res.json({ success: true, ...result, message: '插件已热重载' });
          } else {
            res.json({ success: false, ...result, error: '热重载失败。可安装 napcat-plugin-debug，或在 NapCat 插件页手动重载。' });
          }
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/update/hmr-status', async (_, res) => {
        const pm = pluginState.pluginManager;
        const debug = await pingDebugService({
          wsUrl: pluginState.config?.updateDebugWsUrl || process.env.NAPCAT_DEBUG_WS,
          token: pluginState.config?.updateDebugToken || process.env.NAPCAT_DEBUG_TOKEN
        });
        let loaded = [];
        try {
          if (pm?.getLoadedPlugins) loaded = pm.getLoadedPlugins().map((p) => p?.id || p?.name).filter(Boolean);
        } catch (_) {}
        res.json({
          success: true,
          pluginId: pluginState.pluginId,
          pluginManager: !!(pm?.reloadPlugin),
          debugService: debug,
          loadedPlugins: loaded.slice(0, 20)
        });
      });

      router.getNoAuth('/changelog', async (_, res) => {
        try {
          const resolved = await resolveChangelogContent(pluginState.config || {});
          res.json({
            success: true,
            content: resolved.content,
            version: readLocalVersion(__dirname),
            source: resolved.source
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/agent/status', async (_, res) => {
        try {
          const cfg = pluginState.config || {};
          const skills = discoverSkills(cfg, __dirname);
          let mcpStatus = [];
          if (cfg.mcpEnabled) {
            await ensureAgentMcpHub(cfg);
            mcpStatus = pluginState.mcpHub?.getStatus() || [];
          }
          res.json({
            success: true,
            agentToolsEnabled: !!cfg.agentToolsEnabled,
            skillsEnabled: !!cfg.skillsEnabled,
            mcpEnabled: !!cfg.mcpEnabled,
            skills: skillsToApiList(skills),
            mcp: mcpStatus,
            mcpToolCount: pluginState.mcpHub?.getOpenAiTools()?.length || 0
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/skills/list', (_, res) => {
        const cfg = pluginState.config || {};
        const skills = discoverSkills(cfg, __dirname);
        res.json({ success: true, skills: skillsToApiList(skills) });
      });

      router.postNoAuth('/agent/reload', async (_, res) => {
        try {
          const cfg = pluginState.config || {};
          if (cfg.mcpEnabled) {
            await ensureAgentMcpHub(cfg, true);
          } else if (pluginState.mcpHub) {
            await pluginState.mcpHub.closeAll();
            pluginState.mcpHub = null;
          }
          res.json({
            success: true,
            mcp: pluginState.mcpHub?.getStatus() || [],
            skills: skillsToApiList(discoverSkills(cfg, __dirname))
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/agent/risk/confirm', async (req, res) => {
        try {
          cleanupPendingRiskApprovals();
          const cfg = pluginState.config || {};
          const body = req.body || {};
          const id = String(body.requestId || '').trim();
          const userId = String(body.userId || '').trim();
          const password = String(body.password || '');
          const item = pendingRiskApprovals.get(id);
          if (!item) return res.json({ success: false, error: '确认请求不存在或已过期' });
          const now = Date.now();
          if (now < item.availableAt) return res.json({ success: false, error: '冷静期未到，暂不可确认' });
          if (now > item.expiresAt) {
            pendingRiskApprovals.delete(id);
            return res.json({ success: false, error: '确认已过期，请重新触发操作' });
          }
          if (cfg.agentDangerRequireAdmin !== false && !isAdminUser(userId || item.userId, cfg)) {
            return res.json({ success: false, error: '当前 QQ 非管理员，不能确认高危操作' });
          }
          const hasPassword = String(cfg.agentDangerPasswordHash || '') && String(cfg.agentDangerPasswordSalt || '');
          if (hasPassword && !verifyDangerPassword(cfg, password)) {
            return res.json({ success: false, error: '危险操作密码错误' });
          }
          item.approved = true;
          item.approvedAt = now;
          pendingRiskApprovals.set(id, item);
          res.json({ success: true, requestId: id, operationType: item.operationType, riskLevel: item.riskLevel });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/agent/danger-password/set', async (req, res) => {
        try {
          const cfg = pluginState.config || {};
          const body = req.body || {};
          const currentPassword = String(body.currentPassword || '');
          const newPassword = String(body.newPassword || '');
          if (newPassword.length < 8) return res.json({ success: false, error: '新密码至少 8 位' });
          const hasOld = String(cfg.agentDangerPasswordHash || '') && String(cfg.agentDangerPasswordSalt || '');
          if (hasOld && !verifyDangerPassword(cfg, currentPassword)) {
            return res.json({ success: false, error: '当前密码不正确' });
          }
          const hashed = hashDangerPassword(newPassword);
          cfg.agentDangerPasswordHash = hashed.hashHex;
          cfg.agentDangerPasswordSalt = hashed.saltHex;
          saveConfig(ctx);
          res.json({ success: true });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/agent/online-chat', async (req, res) => {
        try {
          cleanupPendingRiskApprovals();
          const cfg = pluginState.config || {};
          const body = req.body || {};
          const text = String(body.text || '').trim().slice(0, 4000);
          const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
          const attachments = rawAttachments
            .map((a) => ({
              kind: String(a?.kind || '').toLowerCase(),
              name: String(a?.name || '').slice(0, 120),
              size: Math.max(0, Number(a?.size) || 0),
              mime: String(a?.mime || '').slice(0, 80),
              textSnippet: String(a?.textSnippet || '').slice(0, 3000),
              dataUrl: String(a?.dataUrl || '')
            }))
            .filter((a) => a.name && a.size <= MAX_CHAT_FILE_BYTES)
            .slice(0, 8);
          if (!text && attachments.length === 0) {
            res.json({ success: false, error: '请输入消息内容或上传附件' });
            return;
          }

          const groupIdRaw = String(body.groupId || '').trim();
          const groupId = /^\d+$/.test(groupIdRaw) ? groupIdRaw : '';
          const userIdRaw = String(body.userId || '').trim();
          const userId = /^\d+$/.test(userIdRaw) ? userIdRaw : '90000001';
          const userName = String(body.userName || '在线调试').trim().slice(0, 32);
          const groupName = String(body.groupName || 'MCP 调试群').trim().slice(0, 32);
          const approvedRiskId = String(body.riskApprovalId || '').trim();
          let pendingRiskRequest = null;

          const key = getConversationKey(groupId || null, userId);
          touchConversationMeta(key, {
            userId,
            userName,
            groupId: groupId || null,
            groupName: groupId ? groupName : ''
          });

          const history = getHistory(key);
          let systemContent = (cfg.systemPrompt || DEFAULT_CONFIG.systemPrompt).trim() || '你是友好助手。';
          const imageUrls = attachments
            .filter((a) => a.kind === 'image')
            .map((a) => String(a.dataUrl || '').trim())
            .filter((u) => /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(u))
            .filter((u) => !visionPayloadTooLarge(u))
            .slice(0, 1);
          let imageAnalysis = '';
          if (cfg.chatParseImage !== false && imageUrls.length) {
            imageAnalysis = await analyzeImageWithKimi(
              imageUrls,
              text || '请识别图片主要内容',
              (cfg.kimiVisionModel || KIMI_CODE_DEFAULT_MODEL).trim()
            );
            if (imageAnalysis) {
              const qHint = text ? `用户问题：${text}` : '用户未附带文字';
              systemContent += `\n\n【图片信息（在线聊天视觉模型提取）】\n${qHint}\n\n${imageAnalysis}`;
            } else {
              systemContent += '\n\n用户发送了图片，但视觉分析未返回有效结果。请提示用户补充文字描述。';
            }
          } else if (cfg.chatParseImage !== false && attachments.some((a) => a.kind === 'image')) {
            systemContent += '\n\n用户发送了图片，但图片体积过大或格式不完整，视觉模型暂未识别。请提示用户上传更小更清晰图片。';
          }
          if (cfg.skillsEnabled) {
            systemContent += buildAgentSystemExtras(cfg, __dirname, text);
          }
          if (cfg.agentToolsEnabled) {
            systemContent += buildAgentFileSendBlock(cfg);
          }
          const fileAttachBlock = buildWebAttachmentContextBlock(attachments.filter((a) => a.kind === 'file' && a.textSnippet));
          if (fileAttachBlock) systemContent += fileAttachBlock;
          const qqSession = {
            userId,
            userName,
            userCard: '',
            groupId: groupId || '',
            groupName: groupId ? groupName : '',
            atUserIds: []
          };
          const qqExtras = buildAgentQqContextExtras(cfg, qqSession);
          systemContent += qqExtras.extra;
          const qqContextMeta = qqExtras.groupContextMeta;
          const messages = [
            { role: 'system', content: systemContent },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            {
              role: 'user',
              content: (
                ((text || '[仅附件消息]').slice(0, 2000)) +
                (attachments.length
                  ? ('\n\n[用户上传附件]\n' + attachments.map((a, i) => {
                    const sizeKb = Math.max(1, Math.round((a.size || 0) / 1024));
                    const line = `${i + 1}. ${a.kind === 'image' ? '图片' : '文件'} ${a.name} (${sizeKb}KB, ${a.mime || 'unknown'})`;
                    if (a.textSnippet) return line + `\n内容摘要:\n${a.textSnippet.slice(0, 1200)}`;
                    return line;
                  }).join('\n'))
                  : '')
              )
            }
          ];

          let replyText = '';
          let agentToolTrace = [];
          if (cfg.agentToolsEnabled) {
            await ensureAgentMcpHub(cfg);
            const maxRounds = Math.max(1, Math.min(999, Number(cfg.agentMaxToolRounds) || 6));
            const agentChatCompletion = (msgList, opts = {}) => chatCompletion(msgList, { ...opts, usageKey: key, usageSource: 'agent' });
            const agentResult = await runAgentToolLoop({
              messages,
              chatCompletion: agentChatCompletion,
              cfg,
              mcpHub: pluginState.mcpHub,
              builtinTools: buildBuiltinTools(cfg, __dirname),
              runtime: {
                cfg,
                webSearchMulti,
                pluginRoot: __dirname,
                db: sqliteDbRef,
                qqUserId: userId,
                qqApi: createQqApi(qqSession),
                onBiliQrLoginStarted: makeBiliQrPollHandler(ctx, userId, groupId || '', !!groupId),
                requestRiskApproval: async (risk) => {
                  if (cfg.agentDangerGuardEnabled === false) return { approved: true };
                  if (cfg.agentDangerRequireAdmin !== false && !isAdminUser(userId, cfg)) {
                    return { approved: false, reason: '当前 QQ 非管理员，拒绝高危操作', requestId: '' };
                  }
                  const needWebConfirm = cfg.agentDangerRequireWebConfirm !== false;
                  if (!needWebConfirm) return { approved: true };
                  if (approvedRiskId) {
                    const approved = pendingRiskApprovals.get(approvedRiskId);
                    if (approved && approved.approved && Date.now() <= approved.expiresAt && approved.userId === userId) {
                      pendingRiskApprovals.delete(approvedRiskId);
                      return { approved: true, requestId: approvedRiskId };
                    }
                  }
                  const reqItem = createPendingRiskApproval(cfg, {
                    operationType: risk.operationType,
                    riskLevel: risk.riskLevel,
                    reason: risk.reason,
                    preview: risk.preview,
                    userId,
                    groupId,
                    source: 'web_online_chat'
                  });
                  pendingRiskRequest = {
                    requestId: reqItem.id,
                    operationType: reqItem.operationType,
                    riskLevel: reqItem.riskLevel,
                    reason: reqItem.reason,
                    preview: reqItem.preview,
                    availableAt: reqItem.availableAt,
                    expiresAt: reqItem.expiresAt,
                    waitSeconds: Math.max(0, Math.ceil((reqItem.availableAt - Date.now()) / 1000)),
                    expiresInSeconds: Math.max(0, Math.ceil((reqItem.expiresAt - Date.now()) / 1000))
                  };
                  return {
                    approved: false,
                    requestId: reqItem.id,
                    waitSeconds: pendingRiskRequest.waitSeconds,
                    expiresInSeconds: pendingRiskRequest.expiresInSeconds
                  };
                }
              },
              maxRounds,
              onToolExecuted: (t) => {
                recordToolCall(t?.type || 'agent');
                log('info', '在线调试工具调用', t, 'agent');
              }
            });
            replyText = String(agentResult.content || '').trim();
            agentToolTrace = agentResult.toolTrace || [];
            replyText = enrichReplyWithAgentFiles(replyText, agentToolTrace, text);
          } else {
            const result = await chatCompletion(messages, { usageKey: key, usageSource: 'chat' });
            if (result && typeof result === 'object') {
              replyText = result.content !== undefined ? String(result.content || '') : String(result.text || '');
            } else {
              replyText = String(result || '');
            }
          }

          if (!replyText) replyText = cfg.messages?.error || DEFAULT_CONFIG.messages.error;

          pushHistory(key, 'user', historyLabelForUserMedia(text, imageUrls.length > 0, attachments.some((a) => a.kind === 'file')), {
            attachments: attachments.map((a) => ({
              kind: a.kind,
              name: a.name,
              size: a.size,
              mime: a.mime,
              textSnippet: a.textSnippet,
              dataUrl: a.dataUrl
            }))
          });
          const assistantTools = [];
          if (qqContextMeta) assistantTools.push(qqContextMeta);
          if (agentToolTrace.length) assistantTools.push(...toolTraceToHistoryMeta(agentToolTrace));
          if (imageAnalysis) assistantTools.push({ type: 'image_vision', result: imageAnalysis });
          pushHistory(key, 'assistant', replyText, assistantTools.length ? { tools: assistantTools } : {});

          const out = getHistory(key).slice(-40);
          res.json({
            success: true,
            key,
            reply: replyText,
            messages: out,
            toolCount: assistantTools.length,
            assistantTools,
            mcpEnabled: !!cfg.mcpEnabled,
            agentToolsEnabled: !!cfg.agentToolsEnabled,
            riskRequest: pendingRiskRequest
          });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/agent/mcp/test', async (req, res) => {
        try {
          const serverId = String(req.body?.serverId || req.body?.id || '').trim();
          const cfg = pluginState.config || {};
          const servers = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
          const target = servers.find((s) => String(s.id) === serverId);
          if (!target) {
            res.json({ success: false, error: '未找到 MCP 服务配置' });
            return;
          }
          const hub = createAgentMcpHub({ mcpServers: [target] }, {
            log: (lvl, msg, data) => log(lvl, msg, data, 'mcp')
          });
          await hub.reload();
          const [status] = await hub.connectAll();
          await hub.closeAll();
          res.json({ success: true, status });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/skillhub/env/status', async (_, res) => {
        try {
          const { getSkillhubEnvStatus } = await import('./lib/skillhub/skillhub-env.mjs');
          const cfg = pluginState.config || {};
          const status = await getSkillhubEnvStatus(cfg, __dirname);
          res.json({ success: true, ...status });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e), pluginVersion: PLUGIN_VERSION });
        }
      });

      router.getNoAuth('/skillhub/env/ping', (_, res) => {
        res.json({
          success: true,
          pluginVersion: PLUGIN_VERSION,
          node: process.version,
          execPath: process.execPath,
          platform: process.platform
        });
      });

      router.getNoAuth('/skillhub/env/logs', async (req, res) => {
        const since = parseInt(req.query?.since, 10) || 0;
        try {
          const setup = await import('./lib/skillhub/skillhub-setup.mjs');
          res.json({ success: true, pluginVersion: PLUGIN_VERSION, ...setup.getSkillhubSetupLogs(since) });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e), pluginVersion: PLUGIN_VERSION });
        }
      });

      router.postNoAuth('/skillhub/env/setup', async (req, res) => {
        const cfg = pluginState.config || {};
        const body = req.body || {};
        let setupMod;
        try {
          setupMod = await import('./lib/skillhub/skillhub-setup.mjs');
        } catch (e) {
          res.json({ success: false, error: `无法加载 lib/skillhub-setup.mjs: ${e?.message || e}` });
          return;
        }
        if (typeof setupMod.runSkillhubEnvSetupFromStep2 !== 'function') {
          res.json({ success: false, error: 'lib/skillhub-setup.mjs 过旧，请完整复制 lib 目录后重启 NapCat' });
          return;
        }
        if (setupMod.getSkillhubSetupLogs(0).running) {
          res.json({ success: false, error: '配置任务进行中' });
          return;
        }
        res.json({ success: true, started: true, pluginVersion: PLUGIN_VERSION });

        setupMod.skillhubSetupReset();
        setupMod.skillhubSetupPushLog('=== SkillHub 环境配置开始 ===');
        setupMod.skillhubSetupPushLog(`平台: ${process.platform} · 插件目录: ${__dirname}`);
        setupMod.skillhubSetupPushLog(`[index] v${PLUGIN_VERSION} · 内联检测（不 spawn 子进程）`);

        const node = inlineProbeNodeNpm();
        setupMod.skillhubSetupPushLog('[1/5] 检测 Node.js / npm…');
        if (!node.ok) {
          setupMod.skillhubSetupPushLog(`  Node: ${node.node || '—'} @ ${node.nodeCmd}`);
          setupMod.skillhubSetupPushLog(`  npm: ${node.npmCmd}`);
          setupMod.skillhubSetupPushLog(`  问题: ${node.npmError || node.nodeError}`);
          setupMod.skillhubSetupFinishError(node.npmError || node.nodeError || '未检测到 Node.js/npm');
          return;
        }
        setupMod.skillhubSetupPushLog(`  Node ${node.node} (${node.nodeCmd})`);
        setupMod.skillhubSetupPushLog(`  npm ${node.npm} (${node.npmCmd})`);

        const ctx = pluginState.runtimeCtx;
        setupMod.runSkillhubEnvSetupFromStep2(cfg, __dirname, (partial) => {
          Object.assign(pluginState.config, partial);
          saveConfig(ctx);
        }, {
          installPlaywright: body.installPlaywright !== false,
          installCliGlobal: body.installCliGlobal !== false
        }).catch((e) => log('error', 'SkillHub 环境配置失败', e.message, 'skillhub'));
      });

      router.postNoAuth('/skillhub/env/playwright', async (_, res) => {
        let setupMod;
        try {
          setupMod = await import('./lib/skillhub/skillhub-setup.mjs');
        } catch (e) {
          res.json({ success: false, error: `无法加载 lib/skillhub-setup.mjs: ${e?.message || e}` });
          return;
        }
        if (typeof setupMod.runPlaywrightInstallOnly !== 'function') {
          res.json({ success: false, error: 'lib/skillhub-setup.mjs 过旧，请完整复制 lib 目录后重启 NapCat' });
          return;
        }
        if (setupMod.getSkillhubSetupLogs(0).running) {
          res.json({ success: false, error: '配置任务进行中' });
          return;
        }
        res.json({ success: true, started: true, pluginVersion: PLUGIN_VERSION });
        const ctx = pluginState.runtimeCtx;
        setupMod.runPlaywrightInstallOnly(__dirname, (partial) => {
          Object.assign(pluginState.config, partial);
          saveConfig(ctx);
        }).catch((e) => log('error', 'Playwright 安装失败', e.message, 'skillhub'));
      });

      router.getNoAuth('/browser-use/env/status', async (_, res) => {
        try {
          const bu = await import('./lib/agent/agent-browser-use.mjs');
          const cfg = pluginState.config || {};
          const status = await bu.getBrowserUseEnvStatus(__dirname, cfg);
          res.json({ success: true, data: status, mirrors: bu.PIP_MIRRORS || [] });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/browser-use/env/progress', async (req, res) => {
        try {
          const bu = await import('./lib/agent/agent-browser-use.mjs');
          const since = Number(req.query?.since) || 0;
          res.json({ success: true, ...bu.getBrowserUseSetupState(since) });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/browser-use/env/install', async (req, res) => {
        try {
          const bu = await import('./lib/agent/agent-browser-use.mjs');
          const mirror = String(req.body?.mirror || 'auto').trim();
          if (!bu.armBrowserUseInstall(mirror)) {
            res.json({ success: false, error: 'browser-use 安装任务进行中' });
            return;
          }
          res.json({ success: true, started: true });
          const ctx = pluginState.runtimeCtx;
          bu.installAgentBrowserUse(__dirname, { mirror }).then((result) => {
            if (result.ok) {
              pluginState.config.agentBrowserUseEnvReady = true;
              pluginState.config.agentBrowserEnabled = true;
              pluginState.config.agentBrowserEngine = 'browser-use';
              saveConfig(ctx);
            } else if (result.partial && result.needChromium) {
              pluginState.config.agentBrowserEnabled = true;
              pluginState.config.agentBrowserEngine = 'browser-use';
              saveConfig(ctx);
            }
          }).catch((e) => log('error', 'browser-use 安装失败', e.message, 'agent'));
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/browser-use/env/verify', async (_, res) => {
        try {
          const bu = await import('./lib/agent/agent-browser-use.mjs');
          const result = await bu.verifyAgentBrowserUseEnv(__dirname);
          if (result.ok) {
            pluginState.config.agentBrowserUseEnvReady = true;
            pluginState.config.agentBrowserEnabled = true;
            pluginState.config.agentBrowserEngine = 'browser-use';
            saveConfig(pluginState.runtimeCtx);
          }
          res.json({ success: true, data: result, rev: bu.BROWSER_USE_REV });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/skillhub/search', async (req, res) => {
        try {
          const cfg = pluginState.config || {};
          if (!cfg.skillhubEnvReady) {
            res.json({ success: false, error: '环境未配置', needSetup: true });
            return;
          }
          const q = String(req.query?.q || '').trim();
          const cli = await detectSkillhubCli(cfg);
          const r = await skillhubSearch(cfg, cli, q);
          if (!r.ok) {
            const err = r.stderr || r.stdout || '搜索失败';
            res.json({ success: false, error: err, via: r.via || 'unknown' });
            return;
          }
          const payload = r.json || { items: [], total: 0 };
          res.json({ success: true, data: payload, items: payload.items || [], total: payload.total ?? 0, via: r.via || 'http' });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.getNoAuth('/skillhub/installed', async (_, res) => {
        try {
          const cfg = pluginState.config || {};
          const installDir = getSkillhubInstallDir(__dirname);
          const installed = scanInstalledSkillhubSkills(installDir);
          res.json({ success: true, envReady: !!cfg.skillhubEnvReady, installed, installDir });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/skillhub/install', async (req, res) => {
        try {
          const cfg = pluginState.config || {};
          if (!cfg.skillhubEnvReady) {
            res.json({ success: false, error: '请先一键配置环境', needSetup: true });
            return;
          }
          const slug = String(req.body?.slug || '').trim();
          if (!slug) {
            res.json({ success: false, error: '缺少 slug' });
            return;
          }
          const cli = await detectSkillhubCli(cfg);
          const installDir = getSkillhubInstallDir(__dirname);
          const r = await skillhubInstall(cfg, cli, slug, installDir, {
            namespace: req.body?.namespace
          });
          if (!r.ok) {
            res.json({ success: false, error: r.stderr || r.stdout || '安装失败' });
            return;
          }
          const skillsDirs = Array.isArray(cfg.skillsDirs) ? [...cfg.skillsDirs] : [];
          if (!skillsDirs.includes(installDir)) {
            cfg.skillsDirs = [...skillsDirs, installDir];
            cfg.skillsEnabled = true;
            saveConfig(pluginState.runtimeCtx);
          }
          res.json({ success: true, data: r.json, installed: scanInstalledSkillhubSkills(installDir), installDir });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
        }
      });

      router.postNoAuth('/skillhub/remove', async (req, res) => {
        try {
          const cfg = pluginState.config || {};
          const slug = String(req.body?.slug || '').trim();
          if (!slug) {
            res.json({ success: false, error: '缺少 slug' });
            return;
          }
          const cli = await detectSkillhubCli(cfg);
          const installDir = getSkillhubInstallDir(__dirname);
          const r = await skillhubRemove(cfg, cli, slug, installDir);
          res.json({ success: r.ok, data: r.json, error: r.ok ? '' : (r.stderr || '删除失败'), installed: scanInstalledSkillhubSkills(installDir) });
        } catch (e) {
          res.json({ success: false, error: e?.message || String(e) });
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
          icon: 'smart_toy',
          htmlFile: 'webui/dashboard.html',
          description: '多轮对话、人设、冷却、群组与黑名单'
        });
      }
      try {
        initConfigUi(ctx);
      } catch (err) {
        pluginState.logger?.warn?.('[chat-bot] 配置 UI 初始化失败: ' + (err?.message || err));
      }
      scheduleAutoUpdate(ctx);
    }
  } catch (e) {
    const msg = e?.message || String(e);
    const stack = e?.stack ? String(e.stack).split('\n').slice(0, 5).join('\n') : '';
    pluginState.logger?.error?.('[chat-bot] 插件初始化失败: ' + msg + (stack ? '\n' + stack : ''));
    // 不向上抛出，避免 NapCat 报 "failed to load (check plugin structure)"
  }
  pluginState.logger?.info?.('[chat-bot] 聊天插件已初始化，@机器人 或 指令 即可对话');
};

const plugin_onmessage = async (ctx, event) => {
  if (!event?.raw_message && !Array.isArray(event?.message)) return;

  const selfId = event.self_id != null ? String(event.self_id) : null;
  const userId = (event.user_id != null ? String(event.user_id) : (event.sender?.user_id != null ? String(event.sender.user_id) : null));
  if (!userId) return;

  const groupId = event.group_id ? String(event.group_id) : null;
  const isGroup = !!groupId;

  if (isGroup && (!selfId || userId !== selfId)) {
    if (await tryHandleReactionCapture(ctx, event, groupId, userId)) return;
  }

  if (!event?.raw_message) return;
  if (selfId && userId === selfId) return;

  const cfg = pluginState.config;
  if (!cfg.enabled) return;
  if (isGroup) logIncomingGroupMessage(event);
  const plainText = extractPlainText(event.raw_message).trim();
  const hasImages = extractImageFromEvent(event).length > 0;
  const hasFiles = extractFileFromEvent(event).length > 0;

  if (isGroup && (plainText.length > 0 || hasImages || hasFiles) && (!selfId || userId !== selfId)) {
    const senderName = event.sender?.card || event.sender?.nickname || event.sender?.nick || '';
    const list = recentGroupMessages.get(String(groupId)) || [];
    const msgText = plainText.length > 0 ? plainText.slice(0, 500) : (hasImages ? '[图片]' : (hasFiles ? '[文件]' : ''));
    list.push({ userId, userName: senderName, text: msgText, ts: Date.now() });
    recordObserveChat(groupId, { userId, userName: senderName, text: msgText, ts: Date.now() });
    const cfgLines = pluginState.config || {};
    const maxLines = Math.max(5, Math.min(50, Math.max(
      Number(cfgLines.fakeHumanContextLines) || 5,
      Number(cfgLines.agentQqGroupContextLines) || 10
    )));
    if (list.length > maxLines) list.splice(0, list.length - maxLines);
    recentGroupMessages.set(String(groupId), list);
    if (hasImages && cfg.emojiCacheEnabled !== false) {
      setImmediate(() => {
        queueCaptureGroupEmojis(ctx, event, groupId).catch((e) => log('debug', '群聊表情采集失败', e.message, 'sticker'));
      });
    }
    if (sqliteDbRef) {
      setImmediate(() => {
        try {
          upsertUserProfile(sqliteDbRef, {
            qqUserId: userId,
            nickname: event.sender?.nickname || event.sender?.nick || '',
            card: event.sender?.card || '',
            groupId,
            sex: event.sender?.sex || '',
            age: event.sender?.age,
            qqLevel: event.sender?.level || event.sender?.qq_level || ''
          });
        } catch { /* ignore */ }
      });
    }
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
  if (!userText && !hasImages && !hasFiles) return;

  const cd = checkCooldown(groupId, userId);
  if (!cd.ok) {
    log('info', '冷却中，拒绝请求', { key: getConversationKey(groupId, userId), seconds: cd.seconds }, 'chat');
    const msg = formatReply(cfg.messages?.cooldown || DEFAULT_CONFIG.messages.cooldown, { seconds: cd.seconds });
    if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
    else await sendPrivate(ctx, userId, msg);
    return;
  }
  setCooldown(groupId, userId);

  const key = getConversationKey(groupId, userId);
  const userName = event.sender?.nickname || event.sender?.nick || event.sender?.card || '';
  const groupName = event.group_name || '';
  const userCard = event.sender?.card || '';

  const imageGen = isImageGenTrigger(plainText, userText, cfg);
  if (cfg.agentToolBiliLoginQrEnabled !== false && detectBiliLoginIntent(userText || plainText)) {
    await handleBiliLoginInChat(ctx, { userId, groupId, isGroup, key });
    return;
  }
  if (imageGen) {
    if (!canUseFeature(userId, 'imageGen')) {
      const msg = cfg.messages?.noFeaturePermission || DEFAULT_CONFIG.messages.noFeaturePermission;
      if (isGroup) await sendGroup(ctx, groupId, formatReply(cfg.replyPrefix || '', { user_id: userId }) + msg);
      else await sendPrivate(ctx, userId, msg);
      return;
    }
    const prompt = (imageGen.prompt || '').trim() || '一只可爱的猫';
    log('info', '图像生成请求', { prompt: prompt.slice(0, 80), groupId: groupId || 'private', userId });
    touchConversationMeta(key, { userId, userName, groupId: groupId || null, groupName });
    const url = await createImage(prompt);
    if (url) {
      const imgMsg = '[CQ:image,url=' + url + ']';
      const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
      if (isGroup) await sendGroup(ctx, groupId, prefix + imgMsg);
      else await sendPrivate(ctx, userId, imgMsg);
      pushHistory(key, 'user', historyLabelForUser(userText || prompt, false));
      pushHistory(key, 'assistant', '[图片]', { tools: [{ type: 'image_gen', prompt, url }] });
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

  touchConversationMeta(key, { userId, userName, groupId: groupId || null, groupName });

  log('info', '处理对话请求', { key, groupId: groupId || 'private', userId, userName, isGroup, userTextLength: userText.length, userTextPreview: userText.slice(0, 120), hasImages }, 'chat');

  const userMessageId = getEventMessageId(event);
  await applyThinkingIndicator(ctx, cfg, event, isGroup, groupId, userId);

  const history = getHistory(key);
  log('debug', '当前对话历史条数', { key, count: history.length }, 'chat');
  let systemContent = (cfg.systemPrompt || DEFAULT_CONFIG.systemPrompt).trim() || '你是友好助手。';

  let imageUrls = [];
  let imageAnalysis = '';
  let userFiles = [];
  let fileContextBlock = '';
  let searchQueries = [];
  let searchResult = '';
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

  if (hasFiles) {
    userFiles = await resolveEventFiles(callAction, event, 3);
    if (userFiles.length) {
      fileContextBlock = buildFileContextBlock(userFiles);
      systemContent += fileContextBlock;
      log('info', '已解析用户文件', { count: userFiles.length, names: userFiles.map((f) => f.name) }, 'chat');
    } else {
      log('info', '用户发送文件但无法读取（可能超过 5MB 或非文本类型）', null, 'chat');
      if (!userText && !hasImages) {
        systemContent += '\n\n用户发送了文件，但文件超过 5MB 或不是可预览的文本类型（如 txt/md/json/代码文件等），请礼貌说明并让用户改用文字描述或发送较小文本文件。';
      }
    }
  }

  if (cfg.webSearchEnabled && imageUrls.length === 0 && !cfg.agentToolsEnabled) {
    const historySummary = history.slice(-4).map((h) => h.content).join(' ').slice(0, 300);
    const smartMode = (cfg.smartSearchQueryMode || 'ai').toLowerCase();
    const triple = !!cfg.webSearchTriple;
    searchResult = '';
    searchQueries = [];

    if (shouldSkipWebSearchByHeuristic(userText)) {
      log('info', '跳过联网搜索', { reason: '寒暄或无需检索' }, 'search');
    } else if (triple) {
      const decided = smartMode === 'ai'
        ? await aiGenerateSearchQueries(userText, historySummary)
        : { skip: false, queries: [] };
      if (decided.skip) {
        log('info', 'AI 判断无需联网搜索', null, 'search');
      } else {
        const fixed = (cfg.webSearchQuery || '').trim();
        const fallback = buildSearchFallbackQuery(userText);
        let qList = decided.queries || [];
        if (smartMode === 'fixed') {
          qList = fixed ? [fixed] : (fallback ? [fallback] : []);
        } else if (!qList.length) {
          qList = fallback ? [fallback] : [];
          if (!qList.length && userText) {
            const raw = String(userText).trim().replace(/\[CQ:[^\]]+\]/g, '').slice(0, 120);
            if (raw) qList = [raw];
          }
          if (qList.length) log('info', 'AI 未生成搜索词，使用用户原话', { query: qList[0].slice(0, 60) }, 'search');
        }
        if (qList.length === 1) {
          qList = [qList[0]];
        }
        if (qList.length) {
          searchQueries = qList.slice();
          log('info', '三路联合搜索开始', { provider: cfg.webSearchProvider, queries: qList, count: qList.length }, 'search');
          const parts = [];
          for (let i = 0; i < qList.length; i++) {
            const q = qList[i];
            const one = await webSearchMulti(q, cfg);
            if (one) parts.push(`【搜索 ${i + 1} - 关键词: "${q.slice(0, 50)}"】\n${one}`);
            log('debug', '单路搜索完成', { index: i + 1, query: q.slice(0, 60), resultLen: (one || '').length });
          }
          searchResult = parts.join('\n\n---\n\n');
        }
      }
    } else {
      let query = '';
      if (smartMode === 'fixed') {
        query = (cfg.webSearchQuery || '').trim() || buildSearchFallbackQuery(userText);
      } else {
        const decided = await aiGenerateSearchQuery(userText, historySummary);
        if (decided.skip) {
          log('info', 'AI 判断无需联网搜索', null, 'search');
        } else if (decided.query) {
          query = decided.query;
          log('info', 'AI 生成搜索词', { query });
        } else {
          query = buildSearchFallbackQuery(userText);
          if (query) log('info', 'AI 未生成搜索词，使用用户原话', { query: query.slice(0, 60) }, 'search');
        }
      }
      if (!query && userText) {
        query = String(userText).trim().replace(/\[CQ:[^\]]+\]/g, '').slice(0, 120);
        if (query) log('warn', '搜索词清洗后为空，已回退原始用户消息', { query: query.slice(0, 60) }, 'search');
      }
      if (query) {
        searchQueries = [query];
        log('info', '联网搜索开始', { provider: cfg.webSearchProvider, query: query.slice(0, 100) }, 'search');
        searchResult = await webSearchMulti(query, cfg);
      }
    }

    if (searchResult) {
      systemContent += '\n\n【以下为联网检索到的相关资料，供你参考并可在回复中结合人设使用】\n' + searchResult;
      log('info', '联网搜索完成，已注入人设', { resultLength: searchResult.length, triple }, 'search');
    } else {
      log('warn', '联网搜索无结果', { triple }, 'search');
    }
  }

  if (cfg.skillsEnabled) {
    systemContent += buildAgentSystemExtras(cfg, __dirname, userText);
  }
  if (cfg.agentToolsEnabled) {
    systemContent += buildAgentFileSendBlock(cfg);
  }

  let resolvedGroupName = groupName;
  if (isGroup && groupId && !resolvedGroupName) {
    const cached = cfg.groupProfileCache?.[String(groupId)];
    if (cached?.groupName) resolvedGroupName = cached.groupName;
    else {
      const gp = await fetchGroupProfile(groupId);
      if (gp?.groupName) {
        resolvedGroupName = gp.groupName;
        touchGroupProfileCache(cfg, gp);
      }
    }
  }

  const qqSession = {
    userId,
    userName,
    userCard,
    groupId: groupId || '',
    groupName: resolvedGroupName,
    atUserIds: isGroup ? extractAtQqFromMessage(event.raw_message, event) : []
  };
  const qqExtras = buildAgentQqContextExtras(cfg, qqSession);
  systemContent += qqExtras.extra;
  const qqContextMeta = qqExtras.groupContextMeta;

  const userMessage = userText
    || (imageAnalysis ? '请根据图片信息和上下文自然地回复用户。' : '你好');
  const messages = [
    { role: 'system', content: systemContent },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  let replyText;
  let fromRateLimit = false;
  let agentToolTrace = [];
  try {
    if (cfg.agentToolsEnabled) {
      await ensureAgentMcpHub(cfg);
      const maxRounds = Math.max(1, Math.min(999, Number(cfg.agentMaxToolRounds) || 6));
      const agentChatCompletion = (msgList, opts = {}) => chatCompletion(msgList, { ...opts, usageKey: key, usageSource: 'agent' });
      const agentResult = await runAgentToolLoop({
        messages,
        chatCompletion: agentChatCompletion,
        cfg,
        mcpHub: pluginState.mcpHub,
        builtinTools: buildBuiltinTools(cfg, __dirname),
        runtime: {
          cfg,
          webSearchMulti,
          pluginRoot: __dirname,
          db: sqliteDbRef,
          qqUserId: userId,
          qqApi: createQqApi(qqSession),
          onBiliQrLoginStarted: makeBiliQrPollHandler(ctx, userId, groupId || '', isGroup),
          requestRiskApproval: async (risk) => {
            if (cfg.agentDangerGuardEnabled === false) return { approved: true };
            if (cfg.agentDangerRequireAdmin !== false && !isAdminUser(userId, cfg)) {
              return { approved: false, reason: '当前 QQ 非管理员，拒绝高危操作', requestId: '' };
            }
            if (cfg.agentDangerRequireWebConfirm !== false) {
              return { approved: false, reason: '当前为 QQ 会话，无法弹窗二次确认，已拒绝高危操作', requestId: '' };
            }
            return { approved: true };
          }
        },
        maxRounds,
        onToolExecuted: (t) => {
          recordToolCall(t?.type || 'agent');
          log('info', 'Agent 工具调用', t, 'agent');
        }
      });
      replyText = agentResult.content;
      agentToolTrace = agentResult.toolTrace || [];
      const replyBeforeFiles = replyText;
      replyText = enrichReplyWithAgentFiles(replyText, agentToolTrace, userText);
      if (replyText !== replyBeforeFiles) {
        log('info', 'Agent 回复已自动补全 QQ 文件发送标记', { userTextPreview: userText.slice(0, 40) }, 'chat');
      }
    } else {
      const result = await chatCompletion(messages, { usageKey: key, usageSource: 'chat' });
      if (result && typeof result === 'object') {
        replyText = result.content !== undefined ? result.content : (result.text !== undefined ? result.text : '');
        if (result.ok === false && result.status === 429 && result.text) fromRateLimit = true;
      } else {
        replyText = typeof result === 'string' ? result : '';
      }
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

  pushHistory(key, 'user', historyLabelForUser(userText, imageUrls.length > 0, userFiles.length > 0), {
    attachments: userFiles.map((f) => ({
      kind: 'file',
      name: f.name,
      size: f.size,
      mime: f.mime || 'text/plain',
      textSnippet: f.textSnippet
    }))
  });
  const assistantTools = [];
  if (qqContextMeta) assistantTools.push(qqContextMeta);
  if (agentToolTrace.length) assistantTools.push(...toolTraceToHistoryMeta(agentToolTrace));
  if (searchResult) assistantTools.push({ type: 'web_search', queries: searchQueries, result: searchResult });
  if (imageAnalysis) assistantTools.push({ type: 'image_vision', result: imageAnalysis });
  if (userFiles.length) assistantTools.push({ type: 'user_file', name: userFiles.map((f) => f.name).join(', '), result: fileContextBlock.slice(0, 4000) });
  pushHistory(key, 'assistant', replyText, assistantTools.length ? { tools: assistantTools } : {});

  const prefix = isGroup ? formatReply(cfg.replyPrefix || '', { user_id: userId }) : '';
  await deliverChatReply(ctx, { isGroup, groupId, userId, prefix, replyText });
  log('info', '消息已发送', { key, groupId: groupId || 'private', userId, replyLength: replyText.length }, 'chat');

  if (userMessageId) await applyAfterReplyReaction(cfg, userMessageId);

  if (cfg.appendStickerAfterReply) {
    const stickerStore = isGroup ? getMaisakaStore(ctx) : null;
    const faceId = await pickStickerFaceId(cfg, userText, replyText, `用户：${String(userText || '').slice(0, 200)}\n机器人：${String(replyText || '').slice(0, 400)}`, stickerStore);
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
  if (pendingReloadTimer) {
    clearTimeout(pendingReloadTimer);
    pendingReloadTimer = null;
  }
  clearReactionCaptureTimers(reactionCaptureSession);
  reactionCaptureSession = null;
  conversationHistory.clear();
  conversationMeta.clear();
  cooldownUntil.clear();
  recentGroupMessages.clear();
  fakeHumanLastTime.clear();
  fakeHumanTalkingTo.clear();
  if (pluginState.autoUpdateTimer) {
    clearInterval(pluginState.autoUpdateTimer);
    pluginState.autoUpdateTimer = null;
  }
  pluginState.updateRunning = false;
  pluginState.mirrorBenchmarkRunning = false;
  drawBotEngine?.cleanup?.();
  closeDatabase();
  sqliteDbRef = null;
  maisakaStoreCache = null;
  stopAllObserveLoops();
  stopAllBiliChatQrPolls();
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
