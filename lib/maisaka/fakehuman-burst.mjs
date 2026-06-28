/**
 * MaiBot 风格：将长回复拆成多条短句连发
 */

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
  if (cfg.fakeHumanBurstEnabled === false) return outbound || [];
  const maxLen = Math.max(8, Math.min(80, Number(cfg.fakeHumanBurstMaxLen) ?? 28));
  const maxMsgs = Math.max(1, Math.min(8, Number(cfg.fakeHumanBurstMaxMessages) ?? 4));
  const expanded = [];
  for (const ob of outbound || []) {
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
