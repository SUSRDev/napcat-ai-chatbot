/**
 * QQ 小黄脸系统表情（CQ:face）常用 id 映射
 * 参考 OneBot / NapCat face id
 */
export const QQ_FACE_BY_EMOTION = {
  微笑: '0', 开心: '13', 呲牙: '13', 笑: '13', 哈哈: '28',
  哭: '5', 流泪: '5', 难过: '15', 伤心: '9',
  生气: '31', 怒: '11', 无语: '22', 白眼: '22',
  惊讶: '14', 呆: '3', 晕: '34', 困: '25',
  害羞: '6', 尴尬: '10', 调皮: '12', 可爱: '21',
  ok: '89', OK: '89', 点赞: '74', 示爱: '74', 爱心: '76',
  疑问: '32', 嘘: '33', 再见: '39', 敲打: '38'
};

/** @param {string} emotionOrId */
export function resolveQqFaceId(emotionOrId) {
  const raw = String(emotionOrId || '').trim();
  if (!raw) return '0';
  if (/^\d+$/.test(raw)) return raw;
  for (const [key, id] of Object.entries(QQ_FACE_BY_EMOTION)) {
    if (raw.includes(key)) return id;
  }
  return '0';
}

/** @param {string} [seed] */
export function pickRandomQqFaceId(seed = '') {
  const ids = [...new Set(Object.values(QQ_FACE_BY_EMOTION))];
  if (!seed) return ids[Math.floor(Math.random() * ids.length)];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ids[h % ids.length];
}
