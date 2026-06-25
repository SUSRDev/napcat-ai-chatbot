/**
 * GitHub Release 下载镜像源列表与测速工具。
 */

export const MIRROR_REPO = 'SUSRDev/napcat-ai-chatbot';

export const MIRROR_DIRECT_ID = 'direct';

/** @type {{ id: string, name: string, baseUrl: string, recommended?: boolean }[]} */
export const GITHUB_MIRRORS = [
  { id: MIRROR_DIRECT_ID, name: 'GitHub 原始', baseUrl: '', recommended: true },
  { id: 'github.chenc.dev', name: 'github.chenc.dev', baseUrl: 'https://github.chenc.dev' },
  { id: 'ghproxy.cfd', name: 'ghproxy.cfd', baseUrl: 'https://ghproxy.cfd' },
  { id: 'github.tbedu.top', name: 'github.tbedu.top', baseUrl: 'https://github.tbedu.top' },
  { id: 'ghproxy.cc', name: 'ghproxy.cc', baseUrl: 'https://ghproxy.cc' },
  { id: 'gh.monlor.com', name: 'gh.monlor.com', baseUrl: 'https://gh.monlor.com' },
  { id: 'cdn.akaere.online', name: 'cdn.akaere.online', baseUrl: 'https://cdn.akaere.online' },
  { id: 'gh.idayer.com', name: 'gh.idayer.com', baseUrl: 'https://gh.idayer.com' },
  { id: 'gh.llkk.cc', name: 'gh.llkk.cc', baseUrl: 'https://gh.llkk.cc' },
  { id: 'ghpxy.hwinzniej.top', name: 'ghpxy.hwinzniej.top', baseUrl: 'https://ghpxy.hwinzniej.top' },
  { id: 'github-proxy.memory-echoes.cn', name: 'github-proxy.memory-echoes.cn', baseUrl: 'https://github-proxy.memory-echoes.cn' },
  { id: 'git.yylx.win', name: 'git.yylx.win', baseUrl: 'https://git.yylx.win' },
  { id: 'gitproxy.mrhjx.cn', name: 'gitproxy.mrhjx.cn', baseUrl: 'https://gitproxy.mrhjx.cn' },
  { id: 'gh.fhjhy.top', name: 'gh.fhjhy.top', baseUrl: 'https://gh.fhjhy.top' },
  { id: 'gp.zkitefly.eu.org', name: 'gp.zkitefly.eu.org', baseUrl: 'https://gp.zkitefly.eu.org' },
  { id: 'gh-proxy.com', name: 'gh-proxy.com', baseUrl: 'https://gh-proxy.com' },
  { id: 'ghfile.geekertao.top', name: 'ghfile.geekertao.top', baseUrl: 'https://ghfile.geekertao.top' },
  { id: 'j.1lin.dpdns.org', name: 'j.1lin.dpdns.org', baseUrl: 'https://j.1lin.dpdns.org' },
  { id: 'ghproxy.imciel.com', name: 'ghproxy.imciel.com', baseUrl: 'https://ghproxy.imciel.com' },
  { id: 'github-proxy.teach-english.tech', name: 'github-proxy.teach-english.tech', baseUrl: 'https://github-proxy.teach-english.tech' },
  { id: 'gh.927223.xyz', name: 'gh.927223.xyz', baseUrl: 'https://gh.927223.xyz' },
  { id: 'github.ednovas.xyz', name: 'github.ednovas.xyz', baseUrl: 'https://github.ednovas.xyz' },
  { id: 'ghf.xn--eqrr82bzpe.top', name: 'ghf.xn--eqrr82bzpe.top', baseUrl: 'https://ghf.xn--eqrr82bzpe.top' },
  { id: 'gh.dpik.top', name: 'gh.dpik.top', baseUrl: 'https://gh.dpik.top' },
  { id: 'gh.jasonzeng.dev', name: 'gh.jasonzeng.dev', baseUrl: 'https://gh.jasonzeng.dev' },
  { id: 'gh.xxooo.cf', name: 'gh.xxooo.cf', baseUrl: 'https://gh.xxooo.cf' },
  { id: 'gh.bugdey.us.kg', name: 'gh.bugdey.us.kg', baseUrl: 'https://gh.bugdey.us.kg' },
  { id: 'ghm.078465.xyz', name: 'ghm.078465.xyz', baseUrl: 'https://ghm.078465.xyz' },
  { id: 'j.1win.ggff.net', name: 'j.1win.ggff.net', baseUrl: 'https://j.1win.ggff.net' },
  { id: 'tvv.tw', name: 'tvv.tw', baseUrl: 'https://tvv.tw' },
  { id: 'gitproxy.127731.xyz', name: 'gitproxy.127731.xyz', baseUrl: 'https://gitproxy.127731.xyz' },
  { id: 'gh.inkchills.cn', name: 'gh.inkchills.cn', baseUrl: 'https://gh.inkchills.cn' },
  { id: 'ghproxy.cxkpro.top', name: 'ghproxy.cxkpro.top', baseUrl: 'https://ghproxy.cxkpro.top' },
  { id: 'gh.sixyin.com', name: 'gh.sixyin.com', baseUrl: 'https://gh.sixyin.com' },
  { id: 'github.geekery.cn', name: 'github.geekery.cn', baseUrl: 'https://github.geekery.cn' },
  { id: 'git.669966.xyz', name: 'git.669966.xyz', baseUrl: 'https://git.669966.xyz' },
  { id: 'gh.5050net.cn', name: 'gh.5050net.cn', baseUrl: 'https://gh.5050net.cn' },
  { id: 'gh.felicity.ac.cn', name: 'gh.felicity.ac.cn', baseUrl: 'https://gh.felicity.ac.cn' },
  { id: 'github.dpik.top', name: 'github.dpik.top', baseUrl: 'https://github.dpik.top' },
  { id: 'ghp.keleyaa.com', name: 'ghp.keleyaa.com', baseUrl: 'https://ghp.keleyaa.com' },
  { id: 'gh.wsmdn.dpdns.org', name: 'gh.wsmdn.dpdns.org', baseUrl: 'https://gh.wsmdn.dpdns.org' },
  { id: 'ghproxy.monkeyray.net', name: 'ghproxy.monkeyray.net', baseUrl: 'https://ghproxy.monkeyray.net' },
  { id: 'fastgit.cc', name: 'fastgit.cc', baseUrl: 'https://fastgit.cc' },
  { id: 'gh.catmak.name', name: 'gh.catmak.name', baseUrl: 'https://gh.catmak.name' },
  { id: 'gh.noki.icu', name: 'gh.noki.icu', baseUrl: 'https://gh.noki.icu' }
];

const mirrorMap = new Map(GITHUB_MIRRORS.map((m) => [m.id, m]));

export function getMirrorById(id) {
  return mirrorMap.get(String(id || '')) || null;
}

export function listMirrors() {
  return GITHUB_MIRRORS.map((m) => ({
    id: m.id,
    name: m.name,
    baseUrl: m.baseUrl || 'https://github.com',
    recommended: !!m.recommended
  }));
}

export function buildMirroredUrl(githubUrl, mirrorId) {
  const raw = String(githubUrl || '').trim();
  if (!raw) return raw;
  if (mirrorId === MIRROR_DIRECT_ID) return raw;
  const mirror = getMirrorById(mirrorId);
  if (!mirror?.baseUrl) return raw;
  const base = mirror.baseUrl.replace(/\/+$/, '');
  return `${base}/${raw}`;
}

export function getDefaultMirrorTestUrl() {
  return `https://github.com/${MIRROR_REPO}/raw/main/package.json`;
}

export function getMirrorConfig(cfg = {}) {
  return {
    mode: cfg.updateMirrorMode === 'manual' ? 'manual' : 'auto',
    mirrorId: String(cfg.updateMirrorId || MIRROR_DIRECT_ID),
    benchmark: cfg.updateMirrorBenchmark && typeof cfg.updateMirrorBenchmark === 'object'
      ? cfg.updateMirrorBenchmark
      : {},
    bestId: String(cfg.updateMirrorBestId || ''),
    bestTestedAt: Number(cfg.updateMirrorBestTestedAt) || 0
  };
}

export function pickFastestMirror(results) {
  const ok = (Array.isArray(results) ? results : [])
    .filter((r) => r?.ok)
    .sort((a, b) => (a.latencyMs || 999999) - (b.latencyMs || 999999));
  return ok[0] || null;
}

export function resolveMirrorId(config, results) {
  const cfg = getMirrorConfig(config);
  if (cfg.mode === 'manual') return cfg.mirrorId || MIRROR_DIRECT_ID;
  const fromResults = pickFastestMirror(results);
  if (fromResults?.id) return fromResults.id;
  if (cfg.bestId && getMirrorById(cfg.bestId)) return cfg.bestId;
  const cached = pickFastestMirror(Object.entries(cfg.benchmark).map(([id, v]) => ({ id, ...v })));
  return cached?.id || MIRROR_DIRECT_ID;
}

export function resolveUpdateDownloadUrl(githubUrl, config, results) {
  const mirrorId = resolveMirrorId(config, results);
  return {
    url: buildMirroredUrl(githubUrl, mirrorId),
    mirrorId,
    mirrorName: getMirrorById(mirrorId)?.name || mirrorId
  };
}

export function isMirrorBenchmarkFresh(config, maxAgeMs = 24 * 3600000) {
  const cfg = getMirrorConfig(config);
  if (!cfg.bestTestedAt) return false;
  return Date.now() - cfg.bestTestedAt < maxAgeMs;
}

export async function testMirrorLatency(mirrorId, githubUrl, timeoutMs = 10000) {
  const id = String(mirrorId || MIRROR_DIRECT_ID);
  const url = buildMirroredUrl(githubUrl, id);
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'napcat-plugin-chat-bot-updater',
        Range: 'bytes=0-8191',
        Accept: '*/*'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok && res.status !== 206) {
      return { id, ok: false, latencyMs, status: res.status, error: `HTTP ${res.status}` };
    }
    try { await res.arrayBuffer(); } catch (_) {}
    return { id, ok: true, latencyMs, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const error = e?.name === 'AbortError' ? '超时' : (e?.message || String(e));
    return { id, ok: false, latencyMs, status: 0, error };
  }
}

export async function benchmarkMirrors(githubUrl, mirrorIds, options = {}) {
  const {
    concurrency = 6,
    timeoutMs = 10000,
    onProgress
  } = options;
  const testUrl = githubUrl || getDefaultMirrorTestUrl();
  const ids = Array.isArray(mirrorIds) && mirrorIds.length
    ? mirrorIds.map(String)
    : GITHUB_MIRRORS.map((m) => m.id);
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((id) => testMirrorLatency(id, testUrl, timeoutMs)));
    results.push(...batchResults);
    onProgress?.({
      completed: results.length,
      total: ids.length,
      results: results.map((r) => ({ ...r }))
    });
  }
  const best = pickFastestMirror(results);
  return { results, bestId: best?.id || MIRROR_DIRECT_ID, best };
}

export function mergeBenchmarkResults(existing, results) {
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  const now = Date.now();
  for (const item of results || []) {
    if (!item?.id) continue;
    out[item.id] = {
      ok: !!item.ok,
      latencyMs: Math.round(Number(item.latencyMs) || 0),
      status: item.status || 0,
      error: item.error || '',
      testedAt: now
    };
  }
  return out;
}
