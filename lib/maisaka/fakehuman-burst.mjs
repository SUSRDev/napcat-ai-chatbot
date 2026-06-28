/**
 * MaiBot 风格：将长回复拆成多条短句连发
 */

/** 当前这条回复实际生效的模式（mixed 时看 pickMode，否则看配置） */
export function getEffectiveFakeHumanPickMode(cfg, pickMode) {
  const mode = String(cfg?.fakeHumanReplyMode || 'ai').toLowerCase();
  if (mode === 'mixed') return String(pickMode || 'ai').toLowerCase();
  return mode;
}

/** 连发拆分：由 fakeHumanBurstEnabled 控制，AI 模式也允许 */
export function shouldFakeHumanBurst(cfg) {
  return cfg?.fakeHumanBurstEnabled !== false;
}

/** 是否允许使用「随机短句列表」作为回复来源 */
export function shouldUseFakeHumanTextList(cfg, pickMode) {
  return getEffectiveFakeHumanPickMode(cfg, pickMode) === 'random_text';
}

/** 从随机短句列表抽一条；非 random_text 模式返回 null */
export function pickFakeHumanRandomText(cfg, pickMode) {
  if (!shouldUseFakeHumanTextList(cfg, pickMode)) return null;
  const textList = Array.isArray(cfg?.fakeHumanTextList) ? cfg.fakeHumanTextList : [];
  if (!textList.length) return '哈哈';
  return textList[Math.floor(Math.random() * textList.length)];
}

/** Replyer / 系统提示中的输出格式说明 */
export function buildFakeHumanReplyerInstruction(cfg) {
  const maxLen = Math.max(10, Math.min(200, Number(cfg?.fakeHumanMaxLength) ?? 80));
  if (!shouldFakeHumanBurst(cfg)) {
    return `只输出一条自然口语回复，长度不超过 ${maxLen} 字。不要换行，不要 markdown，不要 JSON，不要用 ||| 分隔多条。`;
  }
  const maxMsgs = Math.min(4, Math.max(1, Number(cfg?.fakeHumanBurstMaxMessages) || 4));
  const burstLen = Math.max(8, Math.min(40, Number(cfg?.fakeHumanBurstMaxLen) || 20));
  return `可输出 1-${maxMsgs} 条极短口语句，用 ||| 分隔（每条不超过 ${burstLen} 字）。不要 markdown，不要 JSON。`;
}

/** 未开启连发时只保留第一条文字回复 */
export function collapseFakeHumanOutbound(outbound, cfg) {
  const list = outbound || [];
  if (shouldFakeHumanBurst(cfg)) return list;
  const firstReply = list.find((o) => o.type === 'reply' && o.message);
  if (!firstReply) return list;
  const maxLen = Math.max(10, Math.min(200, Number(cfg?.fakeHumanMaxLength) ?? 80));
  const nonReply = list.filter((o) => o.type !== 'reply' || !o.message);
  return [...nonReply, {
    ...firstReply,
    message: String(firstReply.message).replace(/\n+/g, ' ').slice(0, maxLen)
  }];
}

/** @param {string} text @param {number} maxLen @param {number} maxParts */
export function splitIntoShortBursts(text, maxLen = 28, maxParts = 4) {
  let s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return [];
  if (s.length <= maxLen) return [s];

  const parts = [];
  const delimiters = /([。！？!?…~～；;]+)/;
  const chunks = s.split(delimiters).filter(Boolean);

  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = '';
  };

  for (const chunk of chunks) {
    if (delimiters.test(chunk)) {
      buf += chunk;
      flush();
      continue;
    }
    if ((buf + chunk).length <= maxLen) {
      buf += chunk;
      continue;
    }
    if (buf) flush();
    if (chunk.length <= maxLen) {
      buf = chunk;
      continue;
    }
    for (let i = 0; i < chunk.length; i += maxLen) {
      parts.push(chunk.slice(i, i + maxLen));
    }
  }
  flush();

  const merged = [];
  for (const p of parts) {
    if (merged.length && (merged[merged.length - 1].length + p.length) <= maxLen) {
      merged[merged.length - 1] += p;
    } else {
      merged.push(p);
    }
  }
  return merged.slice(0, Math.max(1, maxParts));
}

/**
 * @param {object[]} outbound
 * @param {object} cfg
 */
export function expandBurstReplies(outbound, cfg) {
  const collapsed = collapseFakeHumanOutbound(outbound, cfg);
  if (!shouldFakeHumanBurst(cfg)) return collapsed;
  const maxLen = Math.max(8, Math.min(80, Number(cfg.fakeHumanBurstMaxLen) ?? 28));
  const maxMsgs = Math.max(1, Math.min(8, Number(cfg.fakeHumanBurstMaxMessages) ?? 4));
  const expanded = [];
  for (const ob of collapsed || []) {
    if (ob.type !== 'reply' || !ob.message) {
      expanded.push(ob);
      continue;
    }
    const parts = splitIntoShortBursts(ob.message, maxLen, maxMsgs);
    if (parts.length <= 1) {
      expanded.push(ob);
      continue;
    }
    for (let i = 0; i < parts.length; i++) {
      expanded.push({
        ...ob,
        message: parts[i],
        atUserId: i === 0 ? ob.atUserId : ''
      });
    }
  }
  return expanded;
}
