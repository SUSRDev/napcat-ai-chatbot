/**
 * MaiBot 风格表情包网格视觉选择
 * 参考: https://github.com/Mai-with-u/MaiBot/blob/main/src/maisaka/builtin_tool/send_emoji.py
 */
import {
  DEFAULT_STICKER_SELECTION_PROMPT,
  parseEmojiSelectionJson,
  renderPromptTemplate
} from '../maisaka/emoji-prompts.mjs';

const TILE_SIZE = 256;
const TILE_GAP = 12;
const MAX_CANDIDATE = 64;

/** @param {number} count */
export function calculateGridShape(count) {
  const n = Math.max(1, Math.min(MAX_CANDIDATE, Number(count) || 1));
  let bestColumns = n;
  let bestRows = 1;
  let bestScore = null;
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const emptySlots = rows * columns - n;
    const aspectGap = Math.abs(columns - rows);
    const score = [aspectGap, emptySlots];
    if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      bestScore = score;
      bestColumns = columns;
      bestRows = rows;
    }
  }
  return { grid_rows: bestRows, grid_columns: bestColumns };
}

/**
 * @param {Array<{ id: string, preview?: string, name?: string, weight?: number }>} pool
 * @param {number} sampleSize
 */
export function sampleStickerCandidates(pool, sampleSize) {
  const list = (pool || []).filter((p) => p?.id);
  if (!list.length) return [];
  const n = Math.max(1, Math.min(MAX_CANDIDATE, Number(sampleSize) || 25, list.length));
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

async function fetchImageBuffer(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  try {
    const res = await fetch(u.replace(/&amp;/g, '&'), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

async function buildGridWithSharp(candidates, buffers) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return null;
  }
  const { grid_rows, grid_columns } = calculateGridShape(candidates.length);
  const canvasWidth = grid_columns * TILE_SIZE + TILE_GAP * (grid_columns - 1);
  const canvasHeight = grid_rows * TILE_SIZE + TILE_GAP * (grid_rows - 1);

  const composites = [];
  for (let i = 0; i < candidates.length; i++) {
    const buf = buffers[i];
    const row = Math.floor(i / grid_columns);
    const col = i % grid_columns;
    const left = col * (TILE_SIZE + TILE_GAP);
    const top = row * (TILE_SIZE + TILE_GAP);
    if (buf) {
      const tile = await sharp(buf)
        .resize(TILE_SIZE, TILE_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      composites.push({ input: tile, left, top });
    }
    const labelSvg = Buffer.from(
      `<svg width="${TILE_SIZE}" height="${TILE_SIZE}"><rect x="14" y="14" width="56" height="56" rx="8" fill="rgba(0,0,0,0.72)"/><text x="42" y="50" font-size="28" fill="white" text-anchor="middle" font-family="Arial">${i + 1}</text></svg>`
    );
    composites.push({ input: labelSvg, left, top });
  }

  const out = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();
  return { pngBuffer: out, grid_rows, grid_columns };
}

/**
 * @param {Array<{ preview?: string }>} candidates
 */
export async function buildEmojiGridImage(candidates) {
  const buffers = await Promise.all(
    candidates.map((c) => fetchImageBuffer(c.preview))
  );
  const grid = await buildGridWithSharp(candidates, buffers);
  if (grid?.pngBuffer) {
    const dataUrl = `data:image/png;base64,${grid.pngBuffer.toString('base64')}`;
    return { ...grid, dataUrl, mode: 'grid' };
  }
  const previews = candidates
    .map((c, i) => ({ index: i + 1, preview: c.preview, name: c.name || '' }))
    .filter((c) => c.preview);
  return { mode: 'multi', previews, ...calculateGridShape(candidates.length) };
}

/**
 * @param {object} opts
 */
export async function selectStickerWithVision(opts) {
  const {
    cfg,
    candidates,
    userText = '',
    replyText = '',
    contextLines = '',
    callVisionChat,
    promptTemplate = DEFAULT_STICKER_SELECTION_PROMPT
  } = opts;

  if (!candidates?.length) return null;
  const sampleSize = cfg?.stickerSendNum ?? 25;
  const sampled = opts.preserveOrder
    ? candidates.slice(0, Math.max(1, Math.min(MAX_CANDIDATE, Number(sampleSize) || candidates.length, candidates.length)))
    : sampleStickerCandidates(candidates, sampleSize);
  if (!sampled.length) return null;

  const grid = await buildEmojiGridImage(sampled);
  const emojiCount = sampled.length;
  const systemPrompt = renderPromptTemplate(promptTemplate, {
    grid_rows: grid.grid_rows,
    grid_columns: grid.grid_columns,
    emoji_count: emojiCount
  });

  const userContext = [
    contextLines ? `群聊上下文：\n${contextLines.slice(0, 800)}` : '',
    userText ? `用户：${String(userText).slice(0, 300)}` : '',
    replyText ? `机器人回复：${String(replyText).slice(0, 400)}` : '',
    `候选总数：${emojiCount}，拼图布局：${grid.grid_rows}x${grid.grid_columns}`,
    '请只输出 JSON：{"emoji_index":数字,"reason":"理由"}'
  ].filter(Boolean).join('\n\n');

  let visionResult = '';
  if (typeof callVisionChat === 'function') {
    if (grid.mode === 'grid' && grid.dataUrl) {
      visionResult = await callVisionChat({
        systemPrompt,
        userText: userContext,
        imageUrls: [grid.dataUrl]
      });
    } else if (grid.mode === 'multi' && grid.previews?.length) {
      const urls = grid.previews.slice(0, 12).map((p) => p.preview).filter(Boolean);
      visionResult = await callVisionChat({
        systemPrompt: systemPrompt + '\n\n若无法看到拼图，请根据多张候选图序号选择最合适的一张。',
        userText: userContext + '\n\n候选序号从 1 到 ' + urls.length,
        imageUrls: urls
      });
    }
  }

  const parsed = parseEmojiSelectionJson(visionResult);
  let index = parsed?.emoji_index ?? 1;
  if (index < 1 || index > sampled.length) index = 1;

  return {
    id: sampled[index - 1].id,
    emoji_index: index,
    reason: parsed?.reason || '',
    candidateCount: sampled.length,
    grid_rows: grid.grid_rows,
    grid_columns: grid.grid_columns
  };
}

/** @param {Record<string, unknown>} cfg @param {string} id */
export function touchStickerUsage(cfg, id) {
  if (!id) return;
  if (!cfg.stickerUsageStats || typeof cfg.stickerUsageStats !== 'object') {
    cfg.stickerUsageStats = {};
  }
  const key = String(id);
  const prev = cfg.stickerUsageStats[key] || { query_count: 0, last_used: 0 };
  cfg.stickerUsageStats[key] = {
    query_count: (Number(prev.query_count) || 0) + 1,
    last_used: Date.now()
  };
}
