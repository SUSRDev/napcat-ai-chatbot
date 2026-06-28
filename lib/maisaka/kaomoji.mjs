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

/** @param {string} [context] */
export function pickKaomojiForContext(context = '') {
  const ctx = String(context || '');
  for (const [mood, list] of Object.entries(DEFAULT_KAOMOJI_BY_MOOD)) {
    if (mood === '默认') continue;
    if (ctx.includes(mood)) return list[Math.floor(Math.random() * list.length)];
  }
  if (/疼|伤|崴|摔|难过|哭|安慰|抱抱|没事/.test(ctx)) return pickFrom(DEFAULT_KAOMOJI_BY_MOOD.安慰);
  if (/哈|笑|开心|牛|6|厉害|好耶/.test(ctx)) return pickFrom(DEFAULT_KAOMOJI_BY_MOOD.开心);
  if (/啊\?|离谱|无语|服了|什么/.test(ctx)) return pickFrom(DEFAULT_KAOMOJI_BY_MOOD.无语);
  if (/[?？]|怎么|啥|惊/.test(ctx)) return pickFrom(DEFAULT_KAOMOJI_BY_MOOD.惊讶);
  return pickFrom(DEFAULT_KAOMOJI_BY_MOOD.默认);
}

function pickFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** @param {object} cfg */
export function buildKaomojiHint(cfg, context = '') {
  if (cfg?.fakeHumanKaomojiEnabled === false && cfg?.chatKaomojiEnabled === false) return '';
  const sample = pickKaomojiForContext(context);
  return `【颜文字】可适当在句末或句中使用日式颜文字（不要每句都加），如 ${sample}、（＾∀＾）、(´；ω；\`) 等，与语气自然融合。`;
}
