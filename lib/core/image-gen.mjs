/**
 * 多提供商图像生成：SiliconFlow / Gemini / 自定义 API / RunningHub 同步
 */

const SILICONFLOW_IMAGE_API = 'https://api.siliconflow.cn/v1/images/generations';
const GEMINI_IMAGE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const IMAGE_GEN_PRESETS = [
  {
    id: 'siliconflow-kolors',
    name: 'SiliconFlow · Kolors',
    provider: 'siliconflow',
    model: 'Kwai-Kolors/Kolors',
    size: '1024x1024'
  },
  {
    id: 'siliconflow-qwen',
    name: 'SiliconFlow · Qwen Image',
    provider: 'siliconflow',
    model: 'Qwen/Qwen-Image-Edit-2509',
    size: '1328x1328'
  },
  {
    id: 'gemini-flash',
    name: 'Gemini · Imagen 3',
    provider: 'gemini',
    model: 'imagen-3.0-generate-002',
    size: '1024x1024'
  },
  {
    id: 'openai-dalle',
    name: 'OpenAI 兼容 · DALL·E',
    provider: 'custom',
    apiUrl: 'https://api.openai.com/v1/images/generations',
    model: 'dall-e-3',
    responseFormat: 'openai_url',
    size: '1024x1024'
  },
  {
    id: 'runninghub',
    name: 'RunningHub 本地服务',
    provider: 'runninghub',
    apiUrl: 'http://127.0.0.1:1088'
  }
];

function getByPath(obj, pathStr) {
  if (!pathStr || !obj) return undefined;
  const parts = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function applyTemplate(tpl, vars) {
  let s = String(tpl || '');
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''));
  }
  return s;
}

function parseImageFromResponse(data, format, pathStr) {
  if (!data) return null;
  const fmt = (format || 'openai_url').toLowerCase();
  if (fmt === 'openai_url') {
    const url = data?.data?.[0]?.url || data?.images?.[0]?.url;
    if (url) return url;
  }
  if (fmt === 'openai_b64') {
    const b64 = data?.data?.[0]?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
  }
  if (fmt === 'runninghub') {
    const urls = data?.image_urls || data?.data?.image_urls;
    if (Array.isArray(urls) && urls[0]) return urls[0];
  }
  if (fmt === 'json_path' && pathStr) {
    const v = getByPath(data, pathStr);
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v[0]) return v[0];
  }
  // 自动探测
  const auto = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.image_urls?.[0];
  return auto || null;
}

async function generateSiliconFlow(cfg, prompt, options = {}) {
  const apiKey = (cfg.siliconflowApiKey || '').trim();
  if (!apiKey) return { ok: false, error: '未配置 SiliconFlow API Key' };
  const model = (options.model || cfg.imageGenModel || 'Kwai-Kolors/Kolors').trim();
  const size = (options.image_size || cfg.imageGenSize || '1024x1024').trim();
  const body = {
    model,
    prompt: String(prompt || '').slice(0, 2000),
    image_size: size,
    negative_prompt: (options.negative_prompt || cfg.imageGenNegativePrompt || '').trim().slice(0, 500) || undefined,
    num_inference_steps: Math.max(1, Math.min(100, Number(options.num_inference_steps ?? cfg.imageGenSteps) || 20)),
    guidance_scale: Math.max(0, Math.min(20, Number(options.guidance_scale ?? cfg.imageGenGuidanceScale) || 7.5)),
    cfg: Math.max(0.1, Math.min(20, Number(options.cfg ?? cfg.imageGenCfg) || 4))
  };
  if (!body.negative_prompt) delete body.negative_prompt;
  const res = await fetch(SILICONFLOW_IMAGE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { ok: false, error: `SiliconFlow HTTP ${res.status}` };
  const data = await res.json();
  const url = parseImageFromResponse(data, 'openai_url');
  return url ? { ok: true, url, raw: data } : { ok: false, error: '响应无图片 URL' };
}

async function generateGemini(cfg, prompt, options = {}) {
  const apiKey = (cfg.imageGenGeminiApiKey || cfg.geminiApiKey || '').trim();
  if (!apiKey) return { ok: false, error: '未配置 Gemini API Key' };
  const model = (options.model || cfg.imageGenGeminiModel || 'imagen-3.0-generate-002').trim();
  const url = `${GEMINI_IMAGE_BASE}/${model}:predict?key=${encodeURIComponent(apiKey)}`;
  const body = {
    instances: [{ prompt: String(prompt || '').slice(0, 2000) }],
    parameters: { sampleCount: 1, aspectRatio: options.aspectRatio || '1:1' }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, error: `Gemini HTTP ${res.status}: ${errText.slice(0, 120)}` };
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded || data?.predictions?.[0]?.image?.bytesBase64Encoded;
  if (b64) return { ok: true, url: `data:image/png;base64,${b64}`, raw: data };
  const imgUrl = data?.predictions?.[0]?.url;
  if (imgUrl) return { ok: true, url: imgUrl, raw: data };
  return { ok: false, error: 'Gemini 响应无图片' };
}

async function generateCustom(cfg, prompt, options = {}) {
  const apiUrl = (options.apiUrl || cfg.imageGenCustomApiUrl || '').trim();
  const apiKey = (options.apiKey || cfg.imageGenCustomApiKey || '').trim();
  if (!apiUrl) return { ok: false, error: '未配置自定义画图 API URL' };
  const method = (cfg.imageGenCustomMethod || 'POST').toUpperCase();
  const tpl = cfg.imageGenCustomBodyTemplate || '{"prompt":"{{prompt}}","model":"{{model}}","size":"{{size}}"}';
  const bodyStr = applyTemplate(tpl, {
    prompt: String(prompt || '').slice(0, 2000),
    model: options.model || cfg.imageGenModel || '',
    size: options.image_size || cfg.imageGenSize || '1024x1024',
    negative_prompt: options.negative_prompt || cfg.imageGenNegativePrompt || ''
  });
  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    body = { prompt: String(prompt || '') };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const extra = cfg.imageGenCustomHeaders || {};
  Object.assign(headers, typeof extra === 'object' ? extra : {});
  const res = await fetch(apiUrl, { method, headers, body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, error: `自定义 API HTTP ${res.status}` };
  const data = await res.json().catch(async () => ({ text: await res.text() }));
  const fmt = cfg.imageGenResponseFormat || 'openai_url';
  const url = parseImageFromResponse(data, fmt, cfg.imageGenResponsePath);
  return url ? { ok: true, url, raw: data } : { ok: false, error: '自定义 API 响应解析失败，请检查 responseFormat / responsePath' };
}

async function generateRunningHubSync(cfg, prompt, options = {}, fetchJson) {
  const base = (cfg.drawBotApiUrl || cfg.imageGenApiUrl || 'http://127.0.0.1:1088').replace(/\/$/, '');
  const body = {
    prompt: String(prompt || '').slice(0, 2000),
    user_id: options.userId || '',
    group_id: options.groupId || '',
    nickname: options.nickname || '',
    negative_prompt: options.negative_prompt || '',
    style: options.style || ''
  };
  const data = await fetchJson(`${base}/generate/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(cfg.drawBotPollTimeoutMs) || 300000)
  });
  if (!data?.success) return { ok: false, error: data?.error || 'RunningHub 服务无响应' };
  const url = (data.image_urls || [])[0];
  return url ? { ok: true, url, raw: data, image_urls: data.image_urls } : { ok: false, error: data?.error || '无图片' };
}

/** 根据配置与预设生成图片，返回 { ok, url?, error?, image_urls? } */
export async function generateImage(cfg, prompt, options = {}, fetchJson = null) {
  const presetId = options.presetId || cfg.imageGenPreset || '';
  const presets = Array.isArray(cfg.imageGenPresets) && cfg.imageGenPresets.length ? cfg.imageGenPresets : IMAGE_GEN_PRESETS;
  const preset = presets.find((p) => p.id === presetId) || null;
  let provider = (options.provider || preset?.provider || cfg.imageGenProvider || 'siliconflow').toLowerCase();
  const mergedOpts = {
    ...options,
    model: options.model || preset?.model || cfg.imageGenModel,
    image_size: options.image_size || preset?.size || cfg.imageGenSize,
    apiUrl: options.apiUrl || preset?.apiUrl
  };
  if (provider === 'runninghub') {
    if (!fetchJson) return { ok: false, error: 'RunningHub 需要 fetchJson 依赖' };
    return generateRunningHubSync(cfg, prompt, mergedOpts, fetchJson);
  }
  if (provider === 'gemini') return generateGemini(cfg, prompt, mergedOpts);
  if (provider === 'custom') {
    if (preset?.apiUrl && !cfg.imageGenCustomApiUrl) mergedOpts.apiUrl = preset.apiUrl;
    if (preset?.responseFormat) cfg = { ...cfg, imageGenResponseFormat: preset.responseFormat };
    return generateCustom(cfg, prompt, mergedOpts);
  }
  return generateSiliconFlow(cfg, prompt, mergedOpts);
}

export function resolveActivePreset(cfg) {
  const presets = Array.isArray(cfg.imageGenPresets) && cfg.imageGenPresets.length ? cfg.imageGenPresets : IMAGE_GEN_PRESETS;
  const id = cfg.imageGenPreset || '';
  return presets.find((p) => p.id === id) || presets[0] || null;
}
