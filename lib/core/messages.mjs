/**
 * 统一消息模板：支持 {var} 占位符，合并 messages / drawBotMessages / thinkingMessage
 */

export const MESSAGE_TEMPLATE_DEFAULTS = {
  cooldown: '冷却中，请 {seconds} 秒后再试。',
  noKey: '未配置 API Key，请在仪表盘填写。',
  error: '回复生成失败，请稍后再试。',
  blocked: '您暂无使用权限。',
  noFeaturePermission: '您暂无该功能使用权限。',
  rateLimit: '当前模型请求过于频繁或配额已用完，请稍后再试，或在仪表盘更换其它文字模型。',
  thinking: '正在思考…',
  imageGenFailed: '图片生成失败，请检查画图 API 配置或稍后重试。',
  drawUsage: '用法: 画图 [风格] 描述\n例: 画图 一只猫',
  drawServiceUnavailable: '画图服务不可用，请确保已启动 image_gen_server.py',
  drawQueueFull: '任务队列已满，请稍后再试。',
  drawQueued: '[CQ:at,qq={user_id}] 已加入队列，位置 {position}/{queue_len}\n描述：{prompt}',
  drawGenerating: '[CQ:at,qq={user_id}] 正在生成图片，请稍候...',
  drawSuccess: '[CQ:at,qq={user_id}] 出图完成\n{images}',
  drawFailed: '生成失败：{error}',
  drawCooldown: '操作过于频繁，请 {seconds} 秒后再试。',
  drawUserBlocked: '您暂无画图权限。',
  drawOutOfTimeWindow: '当前不在画图开放时间。',
  drawProfanityBlocked: '输入包含违规内容。',
  drawTimeout: '生成超时，请稍后重试。',
  drawQueueEmpty: '队列为空',
  drawQueueHeader: '【队列】共 {count} 个任务',
  drawQueueLine: '{index} | {prompt} | 用户{user_id}',
  drawStats: '【统计】队列:{queue_len} 今日:{today_count} 成功:{success_count} 失败:{failed_count}',
  drawHelp: '【画图帮助】\n用法: {commands}\n例: 画图 一只猫\n风格: {styles}',
  drawAdminDenied: '需要管理员权限',
  drawCancelOk: '已取消 {removed} 个任务',
  drawPromoteOk: '已提前到队首',
  drawClearOk: '已清空 {cleared} 个任务',
  commandHelp: '【指令帮助】\n{lines}'
};

/** drawBotMessages 旧键名 → messages 新键名 */
const DRAW_BOT_KEY_MAP = {
  usage: 'drawUsage',
  serviceUnavailable: 'drawServiceUnavailable',
  queueFull: 'drawQueueFull',
  queued: 'drawQueued',
  generating: 'drawGenerating',
  success: 'drawSuccess',
  failed: 'drawFailed',
  cooldown: 'drawCooldown',
  userBlocked: 'drawUserBlocked',
  outOfTimeWindow: 'drawOutOfTimeWindow',
  profanityBlocked: 'drawProfanityBlocked'
};

export function formatTemplate(template, vars = {}) {
  let s = String(template ?? '');
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return s;
}

/** 按 key 解析模板，vars 填充占位符 */
export function resolveTemplate(cfg, key, vars = {}) {
  const defaults = MESSAGE_TEMPLATE_DEFAULTS;
  let tpl = cfg?.messages?.[key];
  if (tpl == null || tpl === '') {
    const drawMsgs = cfg?.drawBotMessages || {};
    const drawKey = Object.entries(DRAW_BOT_KEY_MAP).find(([, v]) => v === key)?.[0];
    if (drawKey && drawMsgs[drawKey] != null && drawMsgs[drawKey] !== '') {
      tpl = drawMsgs[drawKey];
    }
  }
  if ((tpl == null || tpl === '') && key === 'thinking') {
    tpl = cfg?.thinkingMessage;
  }
  if (tpl == null || tpl === '') tpl = defaults[key] || '';
  return formatTemplate(tpl, vars);
}

/** 合并配置中的 messages 与 drawBotMessages 到标准 messages 结构（保存时用） */
export function normalizeMessagesConfig(cfg) {
  const messages = { ...MESSAGE_TEMPLATE_DEFAULTS, ...(cfg.messages || {}) };
  const drawMsgs = cfg.drawBotMessages || {};
  for (const [oldKey, newKey] of Object.entries(DRAW_BOT_KEY_MAP)) {
    if (drawMsgs[oldKey] != null && drawMsgs[oldKey] !== '' && (!messages[newKey] || messages[newKey] === MESSAGE_TEMPLATE_DEFAULTS[newKey])) {
      messages[newKey] = drawMsgs[oldKey];
    }
  }
  if (cfg.thinkingMessage && (!messages.thinking || messages.thinking === MESSAGE_TEMPLATE_DEFAULTS.thinking)) {
    messages.thinking = cfg.thinkingMessage;
  }
  return messages;
}
