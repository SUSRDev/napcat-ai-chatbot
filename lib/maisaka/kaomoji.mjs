/**
 * 颜文字：按场景选取，注入表达习惯
 */
export const DEFAULT_KAOMOJI_BY_MOOD = {
  开心: ['(＾∀＾)', '(=´▽`=)', '(｡◕‿◕｡)', '(*^▽^*)','AWA','awa',':D'],
  难过: ['(´；ω；`)', '(｡•́︿•̀｡)', '(T_T)','qwq','qvq','QaQ','QAQ',':('],
  安慰: ['(づ｡◕‿◕｡)づ', '(´･ω･`)', '(｡･ω･｡)'],
  无语: ['(￣ヘ￣)', '(ー_ー)', '(¬_¬)'],
  惊讶: ['(°o°)', '(⊙_⊙)', '(ﾟДﾟ)'],
  害羞: ['(*/ω＼*)', '(//∇//)', '(⁄ ⁄•⁄ω⁄•⁄ ⁄)'],
  调侃: ['(¬‿¬)', '(￣y▽,￣)╭', '( ͡° ͜ʖ ͡°)'],
  默认: ['(｡･ω･｡)', '(=´▽`=)', '(^人^)']
};

/** @param {string} [context] @param {object} [cfg] */
export function pickKaomojiForContext(context = '', cfg = {}) {
  const ctx = String(context || '');
  const extraPool = Array.isArray(cfg?.kaomojiExtraList) ? cfg.kaomojiExtraList.filter(Boolean) : [];
  for (const [mood, list] of Object.entries(DEFAULT_KAOMOJI_BY_MOOD)) {
    if (mood === '默认') continue;
    if (ctx.includes(mood)) return pickFrom([...list, ...extraPool]);
  }
  if (/疼|伤|崴|摔|难过|哭|安慰|抱抱|没事/.test(ctx)) return pickFrom([...DEFAULT_KAOMOJI_BY_MOOD.安慰, ...extraPool]);
  if (/哈|笑|开心|牛|6|厉害|好耶/.test(ctx)) return pickFrom([...DEFAULT_KAOMOJI_BY_MOOD.开心, ...extraPool]);
  if (/啊\?|离谱|无语|服了|什么/.test(ctx)) return pickFrom([...DEFAULT_KAOMOJI_BY_MOOD.无语, ...extraPool]);
  if (/[?？]|怎么|啥|惊/.test(ctx)) return pickFrom([...DEFAULT_KAOMOJI_BY_MOOD.惊讶, ...extraPool]);
  return pickFrom([...DEFAULT_KAOMOJI_BY_MOOD.默认, ...extraPool]);
}

function pickFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** @param {object} cfg @param {string} [scope] chat|fakehuman */
export function buildKaomojiHint(cfg, context = '', scope = 'chat') {
  const enabled = scope === 'fakehuman'
    ? cfg?.fakeHumanKaomojiEnabled !== false
    : cfg?.chatKaomojiEnabled !== false;
  if (!enabled) return '';
  const chance = Math.max(0, Math.min(1, Number(cfg?.kaomojiUseChance ?? 0.35)));
  if (Math.random() >= chance) return '';
  const sample = pickKaomojiForContext(context, cfg);
  const extra = Array.isArray(cfg?.kaomojiExtraList) ? cfg.kaomojiExtraList.filter(Boolean).slice(0, 6) : [];
  const examples = [sample, '(＾∀＾)', '(´；ω；`)', ...extra].filter(Boolean).slice(0, 5).join('、');
  return `【颜文字】可适当在句末或句中使用日式颜文字（不要每句都加），如 ${examples} 等，与语气自然融合。`;
}
