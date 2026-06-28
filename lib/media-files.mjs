/**
 * 聊天图片/文件：入站解析、出站拆分、可读文本文件判定
 */
import fs from 'fs';
import path from 'path';

export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

const TEXT_FILE_EXT = /\.(txt|md|markdown|json|csv|log|yaml|yml|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|py|java|go|rs|cpp|c|h|hpp|cs|php|rb|sh|bat|ps1|sql|ini|cfg|conf|env|toml|vue|svelte|lua|swift|kt|scala|r|tex|bib|properties)$/i;

/** @param {string} name @param {string} [mime] */
export function isPreviewableTextFile(name, mime = '') {
  const m = String(mime || '').toLowerCase();
  if (/^text\//i.test(m) || m === 'application/json' || m === 'application/xml' || m === 'application/javascript') return true;
  return TEXT_FILE_EXT.test(String(name || ''));
}

/** @param {object} event */
export function extractFileFromEvent(event) {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    const file = item.file ? String(item.file).trim() : '';
    const url = item.url ? String(item.url).trim() : '';
    const name = String(item.name || 'file').trim() || 'file';
    const size = Math.max(0, Number(item.size) || 0);
    const key = `${file}\t${url}\t${name}`;
    if (seen.has(key)) return;
    if (!file && !url) return;
    seen.add(key);
    out.push({ file: file || null, url: url || null, name, size });
  };
  const msg = event?.message;
  if (Array.isArray(msg)) {
    for (const seg of msg) {
      if (seg?.type !== 'file') continue;
      add({
        file: seg?.data?.file,
        url: seg?.data?.url,
        name: seg?.data?.file_name || seg?.data?.name,
        size: seg?.data?.file_size ?? seg?.data?.size
      });
    }
  }
  const raw = String(event?.raw_message || '');
  for (const m of raw.matchAll(/\[CQ:file[^\]]*\]/gi)) {
    const part = m[0];
    const fileMatch = part.match(/(?:^|,|\s)file=([^,\]]+)/i);
    const urlMatch = part.match(/url=([^,\]]+)/i);
    const nameMatch = part.match(/name=([^,\]]+)/i);
    const sizeMatch = part.match(/file_size=(\d+)/i);
    add({
      file: fileMatch ? decodeURIComponent(fileMatch[1].trim()) : '',
      url: urlMatch ? decodeURIComponent(urlMatch[1].trim()) : '',
      name: nameMatch ? decodeURIComponent(nameMatch[1].trim()) : 'file',
      size: sizeMatch ? Number(sizeMatch[1]) : 0
    });
  }
  return out;
}

/**
 * @param {Function} callAction
 * @param {object} item
 */
export async function resolveChatFileItem(callAction, item) {
  const name = String(item?.name || 'file').trim() || 'file';
  const size = Math.max(0, Number(item?.size) || 0);
  if (size > MAX_CHAT_FILE_BYTES) {
    return { ok: false, skipped: true, reason: 'too_large', name, size };
  }
  if (!isPreviewableTextFile(name)) {
    return { ok: false, skipped: true, reason: 'unsupported_type', name, size };
  }

  const readText = (buf) => {
    if (!buf || !buf.length) return '';
    if (buf.length > MAX_CHAT_FILE_BYTES) return '';
    return buf.toString('utf8');
  };

  if (item?.file) {
    try {
      const data = await callAction('get_file', { file: item.file });
      const payload = data?.data ?? data ?? {};
      const reportedSize = Number(payload.file_size ?? payload.size ?? size) || 0;
      if (reportedSize > MAX_CHAT_FILE_BYTES) {
        return { ok: false, skipped: true, reason: 'too_large', name, size: reportedSize };
      }
      if (payload.base64 && typeof payload.base64 === 'string') {
        const b64 = payload.base64.replace(/^data:[^;]+;base64,/, '').trim();
        const text = readText(Buffer.from(b64, 'base64'));
        if (text) return { ok: true, name, size: reportedSize || size, textSnippet: text.slice(0, 12000), mime: 'text/plain' };
      }
      const p = payload.path || payload.file;
      if (p && fs.existsSync(p)) {
        const st = fs.statSync(p);
        if (st.size > MAX_CHAT_FILE_BYTES) {
          return { ok: false, skipped: true, reason: 'too_large', name, size: st.size };
        }
        const text = readText(fs.readFileSync(p));
        if (text) return { ok: true, name, size: st.size, textSnippet: text.slice(0, 12000), mime: 'text/plain' };
      }
      if (payload.url && /^https?:\/\//i.test(String(payload.url))) {
        const res = await fetch(String(payload.url).replace(/&amp;/g, '&'));
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_CHAT_FILE_BYTES) {
          return { ok: false, skipped: true, reason: 'too_large', name, size: buf.length };
        }
        const text = readText(buf);
        if (text) return { ok: true, name, size: buf.length, textSnippet: text.slice(0, 12000), mime: 'text/plain' };
      }
    } catch {
      /* fall through */
    }
  }

  if (item?.url && /^https?:\/\//i.test(String(item.url))) {
    try {
      const res = await fetch(String(item.url).replace(/&amp;/g, '&'));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_CHAT_FILE_BYTES) {
        return { ok: false, skipped: true, reason: 'too_large', name, size: buf.length };
      }
      const text = readText(buf);
      if (text) return { ok: true, name, size: buf.length, textSnippet: text.slice(0, 12000), mime: 'text/plain' };
    } catch {
      /* ignore */
    }
  }

  return { ok: false, skipped: true, reason: 'unreadable', name, size };
}

/**
 * @param {Function} callAction
 * @param {object} event
 * @param {number} [maxCount]
 */
export async function resolveEventFiles(callAction, event, maxCount = 3) {
  const items = extractFileFromEvent(event).slice(0, maxCount);
  const resolved = [];
  for (const item of items) {
    const r = await resolveChatFileItem(callAction, item);
    if (r.ok) resolved.push(r);
  }
  return resolved;
}

/** @param {object[]} files */
export function buildFileContextBlock(files) {
  if (!files?.length) return '';
  const parts = files.map((f, i) => {
    const header = `【文件 ${i + 1}: ${f.name}${f.size ? ` (${Math.round(f.size / 1024)}KB)` : ''}】`;
    return `${header}\n${String(f.textSnippet || '').slice(0, 8000)}`;
  });
  return '\n\n【用户发送的文件内容（供参考）】\n' + parts.join('\n\n---\n\n');
}

/** @param {object[]} attachments */
export function buildWebAttachmentContextBlock(attachments) {
  if (!attachments?.length) return '';
  return '\n\n[用户上传附件]\n' + attachments.map((a, i) => {
    const sizeKb = Math.max(1, Math.round((Number(a.size) || 0) / 1024));
    const line = `${i + 1}. ${a.kind === 'image' ? '图片' : '文件'} ${a.name || '未命名'} (${sizeKb}KB)`;
    if (a.textSnippet) return `${line}\n内容:\n${String(a.textSnippet).slice(0, 3000)}`;
    if (a.kind === 'image') return `${line}（已作为图片处理）`;
    return line;
  }).join('\n');
}

/** @param {string} text @param {boolean} [hasImages] @param {boolean} [hasFiles] */
export function historyLabelForUserMedia(text, hasImages, hasFiles) {
  const t = String(text || '').trim();
  const tags = [];
  if (hasImages) tags.push('[图片]');
  if (hasFiles) tags.push('[文件]');
  const prefix = tags.length ? tags.join('') + (t ? ' ' : '') : '';
  return prefix + t || tags.join('') || '[消息]';
}

const MD_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
const STANDALONE_IMAGE_URL_RE = /(^|\n)\s*(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s<>"']*)?)\s*(?=\n|$)/gi;
const FILE_SEND_RE = /\[(?:发送)?文件[:：]\s*([^\]\n]+)\]/gi;
const CQ_MEDIA_RE = /\[CQ:(?:image|file)[^\]]*\]/i;

/**
 * 将模型回复拆成文本/图片/文件段，便于分条发送
 * @param {string} replyText
 * @returns {{ type: 'text'|'image'|'file', content: string, name?: string }[]}
 */
export function parseOutboundMediaSegments(replyText) {
  const raw = String(replyText || '').trim();
  if (!raw) return [];
  if (CQ_MEDIA_RE.test(raw)) return [{ type: 'text', content: raw }];

  const segments = [];
  let rest = raw;

  const fileMarks = [];
  let fm;
  FILE_SEND_RE.lastIndex = 0;
  while ((fm = FILE_SEND_RE.exec(raw))) {
    fileMarks.push({ start: fm.index, end: fm.index + fm[0].length, path: fm[1].trim() });
  }

  const imageMarks = [];
  MD_IMAGE_RE.lastIndex = 0;
  while ((fm = MD_IMAGE_RE.exec(raw))) {
    imageMarks.push({ start: fm.index, end: fm.index + fm[0].length, url: fm[1] });
  }
  STANDALONE_IMAGE_URL_RE.lastIndex = 0;
  while ((fm = STANDALONE_IMAGE_URL_RE.exec(raw))) {
    const url = (fm[2] || fm[1] || '').trim();
    if (!url) continue;
    const start = fm.index + (fm[1] ? fm[1].length : 0);
    imageMarks.push({ start, end: start + url.length, url });
  }

  const marks = [...fileMarks.map((m) => ({ ...m, kind: 'file' })), ...imageMarks.map((m) => ({ ...m, kind: 'image' }))]
    .sort((a, b) => a.start - b.start);

  if (!marks.length) return [{ type: 'text', content: raw }];

  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor) {
      const chunk = raw.slice(cursor, mark.start).trim();
      if (chunk) segments.push({ type: 'text', content: chunk });
    }
    if (mark.kind === 'image') {
      segments.push({ type: 'image', content: mark.url });
    } else {
      const p = path.resolve(String(mark.path || '').trim());
      segments.push({ type: 'file', content: p, name: path.basename(p) });
    }
    cursor = mark.end;
  }
  const tail = raw.slice(cursor).trim();
  if (tail) segments.push({ type: 'text', content: tail });
  return segments.length ? segments : [{ type: 'text', content: raw }];
}

/** @param {{ type: string, content: string, name?: string }} seg */
export function segmentToOutboundMessage(seg) {
  if (seg.type === 'image') {
    const url = String(seg.content || '').trim();
    if (/^https?:\/\//i.test(url)) return `[CQ:image,file=${url}]`;
    if (fs.existsSync(url)) return `[CQ:image,file=${url.replace(/\\/g, '/')}]`;
    return '';
  }
  if (seg.type === 'file') {
    const p = String(seg.content || '').trim();
    if (!p || !fs.existsSync(p)) return '';
    const st = fs.statSync(p);
    if (st.size > MAX_CHAT_FILE_BYTES) return '';
    const norm = p.replace(/\\/g, '/');
    const name = seg.name || path.basename(p);
    return `[CQ:file,file=${norm},name=${name},size=${st.size}]`;
  }
  return String(seg.content || '');
}
