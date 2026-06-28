/**
 * CQ 码 ↔ NapCat message segment 互转
 */

/** @param {string} paramStr */
function parseCqParams(paramStr) {
  const out = {};
  const s = String(paramStr || '').trim();
  if (!s) return out;
  for (const part of s.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let val = part.slice(eq + 1).trim();
    try {
      val = decodeURIComponent(val.replace(/\+/g, ' '));
    } catch {
      /* keep raw */
    }
    out[key] = val;
  }
  return out;
}

/**
 * 将含 [CQ:...] 的字符串拆成 NapCat message segment 数组
 * @param {string} text
 */
export function parseCqTextToSegments(text) {
  const raw = String(text || '');
  if (!raw) return [];
  if (!/\[CQ:/i.test(raw)) {
    return [{ type: 'text', data: { text: raw } }];
  }

  const segments = [];
  const re = /\[CQ:(\w+)(?:,([^\]]*))?\]/gi;
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      const chunk = raw.slice(last, m.index);
      if (chunk) segments.push({ type: 'text', data: { text: chunk } });
    }
    const type = String(m[1] || '').toLowerCase();
    const params = parseCqParams(m[2] || '');
    if (type === 'at') {
      const qq = String(params.qq || params.id || '').trim();
      if (qq) segments.push({ type: 'at', data: { qq } });
    } else if (type === 'face') {
      segments.push({ type: 'face', data: { id: String(params.id || '') } });
    } else if (type === 'image') {
      segments.push({ type: 'image', data: { file: String(params.file || params.url || '') } });
    } else if (type === 'reply') {
      segments.push({ type: 'reply', data: { id: String(params.id || '') } });
    } else {
      segments.push({ type: 'text', data: { text: m[0] } });
    }
    last = m.index + m[0].length;
  }
  const tail = raw.slice(last);
  if (tail) segments.push({ type: 'text', data: { text: tail } });
  return segments.length ? segments : [{ type: 'text', data: { text: raw } }];
}

/**
 * @param {string} qq
 * @param {string} [text]
 */
export function buildAtSegments(qq, text = '') {
  const segments = [{ type: 'at', data: { qq: String(qq) } }];
  const t = String(text || '');
  if (t) segments.push({ type: 'text', data: { text: t.startsWith(' ') ? t : ` ${t}` } });
  return segments;
}

/**
 * 合并 segment 数组，自动解析其中的 CQ 文本段
 * @param {object[]} segments
 */
export function flattenMessageSegments(segments) {
  const out = [];
  for (const seg of segments || []) {
    if (!seg || typeof seg !== 'object') continue;
    if (seg.type === 'text' && typeof seg.data?.text === 'string' && /\[CQ:/i.test(seg.data.text)) {
      out.push(...parseCqTextToSegments(seg.data.text));
    } else {
      out.push(seg);
    }
  }
  return out;
}
