/**
 * 伪人拟人化发送：回复 / 插话 / @+空格 / 错别字撤回
 */

/** @param {object} cfg */
export function pickFakeHumanSendStyle(cfg) {
  const replyW = Math.max(0, Number(cfg?.fakeHumanReplyStyleChance ?? 0.4));
  const atMsgW = Math.max(0, Number(cfg?.fakeHumanAtMessageChance ?? 0.35));
  const interjectW = Math.max(0, Number(cfg?.fakeHumanInterjectChance ?? 0.35));
  const atOnlyW = Math.max(0, Number(cfg?.fakeHumanAtOnlyChance ?? 0.08));
  const total = replyW + atMsgW + interjectW + atOnlyW || 1;
  const r = Math.random() * total;
  if (r < replyW) return 'reply';
  if (r < replyW + atMsgW) return 'at_message';
  if (r < replyW + atMsgW + interjectW) return 'interject';
  return 'at_only';
}

/** @param {string} text @param {object} cfg @param {{ force?: boolean }} [opts] */
export function maybeMakeTypo(text, cfg, opts = {}) {
  if (cfg?.fakeHumanTypoEnabled === false && cfg?.chatTypoEnabled === false && !opts.force) return null;
  const chance = Math.max(0, Math.min(1, Number(cfg?.fakeHumanTypoChance ?? cfg?.chatTypoChance ?? 0.18)));
  if (!opts.force && Math.random() >= chance) return null;
  const s = String(text || '').trim();
  if (s.length < 2 || s.length > 200) return null;

  const swaps = [
    ['的', '得'], ['了', '啦'], ['吗', '嘛'], ['在', '再'], ['做', '作'],
    ['哈', '啊'], ['吧', '把'], ['是', '事'], ['不', '布'], ['这', '着'],
    ['你', '拟'], ['好', '号'], ['没', '妹'], ['有', '又'], ['那', '哪']
  ];
  for (const [a, b] of swaps) {
    if (s.includes(a)) {
      const idx = s.indexOf(a);
      const typo = s.slice(0, idx) + b + s.slice(idx + a.length);
      if (typo !== s) return { typo, correct: s };
    }
  }
  if (s.length >= 3) {
    const i = 1 + Math.floor(Math.random() * Math.max(1, s.length - 2));
    const chars = [...s];
    if (chars[i] && chars[i + 1] && !/\s/.test(chars[i]) && !/\s/.test(chars[i + 1])) {
      [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
      const typo = chars.join('');
      if (typo !== s) return { typo, correct: s };
    }
  }
  if (s.length >= 2) {
    const i = Math.floor(Math.random() * s.length);
    const typo = s.slice(0, i) + s.slice(i + 1);
    if (typo.length >= 1 && typo !== s) return { typo, correct: s };
  }
  return null;
}

export function sleepMs(ms) {
  return new Promise((res) => setTimeout(res, Math.max(0, ms)));
}

/**
 * 发错字 → 等待 → 撤回 → 重发正确内容
 * @param {object} opts
 */
export async function deliverWithTypoRecall(opts) {
  const {
    text,
    cfg,
    buildBadSegments,
    buildGoodSegments,
    send,
    recall,
    log,
    label = 'chat'
  } = opts;
  const body = String(text || '').trim();
  if (!body) return { sent: false };

  const typoEnabled = cfg?.fakeHumanTypoEnabled !== false || cfg?.chatTypoEnabled !== false;
  const typo = typoEnabled ? maybeMakeTypo(body, cfg) : null;

  if (typo) {
    const badId = await send(buildBadSegments(typo.typo));
    log?.('info', '错字已发送，准备撤回重发', { label, typo: typo.typo.slice(0, 40), badId }, 'humanize');
    await sleepMs(500 + Math.floor(Math.random() * 900));
    if (badId) {
      const ok = await recall(badId);
      log?.('info', ok ? '错字消息已撤回' : '错字消息撤回失败', { label, badId }, 'humanize');
    }
    await send(buildGoodSegments(typo.correct));
    return { sent: true, typoCorrected: true };
  }

  await send(buildGoodSegments(body));
  return { sent: true, typoCorrected: false };
}
