/**
 * 智能搜索：国内 / 国外多平台并行检索
 */

export function detectSearchRegion(query, cfg = {}) {
  const mode = String(cfg.webSearchRegion || 'auto').toLowerCase();
  if (mode === 'domestic' || mode === 'international') return mode;
  const t = String(query || '');
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t)) return 'domestic';
  return 'international';
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

/** B站公开搜索 API（免 Key） */
export async function bilibiliSearch(query) {
  const q = String(query || '').trim();
  if (!q) return '';
  try {
    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=6&keyword=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        Referer: 'https://search.bilibili.com/',
        Accept: 'application/json'
      }
    });
    if (!res.ok) return '';
    const data = await res.json();
    if (data.code !== 0) return '';
    const items = Array.isArray(data.data?.result) ? data.data.result : [];
    const parts = items.slice(0, 6).map((v) => {
      const title = stripHtml(v.title || v.name || '');
      const author = stripHtml(v.author || v.uploader || '');
      const desc = stripHtml(v.description || v.desc || '').slice(0, 200);
      const play = v.play != null ? `播放 ${v.play}` : '';
      return [title, author, play, desc].filter(Boolean).join(' | ');
    }).filter(Boolean);
    return parts.join('\n\n');
  } catch (_) {
    return '';
  }
}

/** 抖音：通过 DuckDuckGo 站内检索（无公开免 Key API） */
export async function douyinSiteSearch(query, duckFn) {
  if (typeof duckFn !== 'function') return '';
  const q = String(query || '').trim();
  if (!q) return '';
  return duckFn(`site:douyin.com ${q}`);
}

/**
 * @param {string} query
 * @param {object} cfg
 * @param {object} runners - { duck, serper, uapi, tavily, bocha, baidu, aliyun }
 * @param {'domestic'|'international'|null} regionOverride
 */
export async function smartSearchMulti(query, cfg, runners, regionOverride = null) {
  const q = String(query || '').trim().slice(0, 500);
  if (!q) return '';
  const region = regionOverride || detectSearchRegion(q, cfg);
  const tasks = [];

  if (region === 'domestic') {
    tasks.push({ source: '哔哩哔哩', run: () => bilibiliSearch(q) });
    tasks.push({ source: '抖音', run: () => douyinSiteSearch(q, runners.duck) });
    if (cfg.bochaApiKey) tasks.push({ source: '博查', run: () => runners.bocha(q) });
    if (cfg.baiduSearchApiKey) tasks.push({ source: '百度AI搜索', run: () => runners.baidu(q) });
    if (cfg.aliyunIqsAccessKeyId && cfg.aliyunIqsAccessKeySecret) {
      tasks.push({ source: '阿里云IQS', run: () => runners.aliyun(q) });
    }
    if (cfg.uapiApiKey) tasks.push({ source: 'UAPI', run: () => runners.uapi(q) });
    tasks.push({ source: 'DuckDuckGo', run: () => runners.duck(q) });
  } else {
    tasks.push({ source: 'DuckDuckGo', run: () => runners.duck(q) });
    if (cfg.serperApiKey) tasks.push({ source: 'Serper', run: () => runners.serper(q) });
    if (cfg.tavilyApiKey) tasks.push({ source: 'Tavily', run: () => runners.tavily(q) });
    if (cfg.uapiApiKey) tasks.push({ source: 'UAPI', run: () => runners.uapi(q) });
    if (cfg.bochaApiKey) tasks.push({ source: '博查', run: () => runners.bocha(q) });
  }

  const settled = await Promise.all(tasks.map(async (t) => {
    try {
      const text = await t.run();
      return text ? { source: t.source, text } : null;
    } catch (_) {
      return null;
    }
  }));

  const results = settled.filter(Boolean);
  if (!results.length) return '';
  return results.map((r) => `【${r.source}】\n${r.text}`).join('\n\n---\n\n');
}
