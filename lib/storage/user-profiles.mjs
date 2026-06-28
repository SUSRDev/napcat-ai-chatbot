/**
 * 群聊用户资料（SQLite user_profiles）
 */

/** @param {object} db @param {object} patch */
export function upsertUserProfile(db, patch) {
  const uid = String(patch.qqUserId || patch.userId || '').trim();
  if (!uid || !db) return null;
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM user_profiles WHERE qq_user_id = ?').get(uid);
  const extra = { ...(existing ? JSON.parse(existing.extra || '{}') : {}), ...(patch.extra || {}) };

  db.prepare(`INSERT INTO user_profiles(
    qq_user_id, nickname, card, group_id, group_name, sex, age, sign, qid, qq_level,
    bili_mid, bili_uname, avatar, remark, extra, last_seen_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(qq_user_id) DO UPDATE SET
    nickname = COALESCE(NULLIF(excluded.nickname, ''), nickname),
    card = COALESCE(NULLIF(excluded.card, ''), card),
    group_id = COALESCE(NULLIF(excluded.group_id, ''), group_id),
    group_name = COALESCE(NULLIF(excluded.group_name, ''), group_name),
    sex = COALESCE(NULLIF(excluded.sex, ''), sex),
    age = COALESCE(NULLIF(excluded.age, ''), age),
    sign = COALESCE(NULLIF(excluded.sign, ''), sign),
    qid = COALESCE(NULLIF(excluded.qid, ''), qid),
    qq_level = COALESCE(NULLIF(excluded.qq_level, ''), qq_level),
    bili_mid = COALESCE(NULLIF(excluded.bili_mid, ''), bili_mid),
    bili_uname = COALESCE(NULLIF(excluded.bili_uname, ''), bili_uname),
    avatar = COALESCE(NULLIF(excluded.avatar, ''), avatar),
    remark = COALESCE(NULLIF(excluded.remark, ''), remark),
    extra = excluded.extra,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at`)
    .run(
      uid,
      patch.nickname || existing?.nickname || '',
      patch.card || existing?.card || '',
      patch.groupId || patch.group_id || existing?.group_id || '',
      patch.groupName || patch.group_name || existing?.group_name || '',
      patch.sex || existing?.sex || '',
      patch.age != null ? String(patch.age) : (existing?.age || ''),
      patch.sign || existing?.sign || '',
      patch.qid || existing?.qid || '',
      patch.qqLevel != null ? String(patch.qqLevel) : (existing?.qq_level || ''),
      patch.biliMid || existing?.bili_mid || '',
      patch.biliUname || existing?.bili_uname || '',
      patch.avatar || existing?.avatar || '',
      patch.remark || existing?.remark || '',
      JSON.stringify(extra),
      now,
      now
    );

  return getUserProfile(db, uid);
}

/** @param {object} db @param {string} qqUserId */
export function getUserProfile(db, qqUserId) {
  const uid = String(qqUserId || '').trim();
  if (!uid || !db) return null;
  const r = db.prepare('SELECT * FROM user_profiles WHERE qq_user_id = ?').get(uid);
  if (!r) return null;
  return rowToProfile(r);
}

function rowToProfile(r) {
  let extra = {};
  try { extra = JSON.parse(r.extra || '{}'); } catch { /* ignore */ }
  return {
    qqUserId: r.qq_user_id,
    nickname: r.nickname,
    card: r.card,
    groupId: r.group_id,
    groupName: r.group_name,
    sex: r.sex,
    age: r.age,
    sign: r.sign,
    qid: r.qid,
    qqLevel: r.qq_level,
    biliMid: r.bili_mid,
    biliUname: r.bili_uname,
    avatar: r.avatar,
    remark: r.remark,
    extra,
    lastSeenAt: r.last_seen_at,
    updatedAt: r.updated_at
  };
}

/** @param {object} db @param {object} opts */
export function listUserProfiles(db, opts = {}) {
  if (!db) return [];
  const groupId = String(opts.groupId || '').trim();
  const q = String(opts.q || '').trim();
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  let sql = 'SELECT * FROM user_profiles WHERE 1=1';
  const params = [];
  if (groupId) { sql += ' AND group_id = ?'; params.push(groupId); }
  if (q) { sql += ' AND (nickname LIKE ? OR card LIKE ? OR qq_user_id LIKE ? OR bili_uname LIKE ?)'; const like = `%${q}%`; params.push(like, like, like, like); }
  sql += ' ORDER BY last_seen_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(rowToProfile);
}

/** 构建 Agent 系统信息块（当前群用户摘要） */
export function buildGroupUsersContextBlock(db, groupId, limit = 8) {
  if (!db || !groupId) return '';
  const list = listUserProfiles(db, { groupId, limit });
  if (!list.length) return '';
  const lines = list.map((u, i) => {
    const name = u.card || u.nickname || u.qqUserId;
    const parts = [`${i + 1}. ${name}(${u.qqUserId})`];
    if (u.biliUname) parts.push(`B站:${u.biliUname}`);
    if (u.sign) parts.push(`签名:${u.sign.slice(0, 30)}`);
    return parts.join(' · ');
  });
  return '【本群已知用户资料】\n' + lines.join('\n');
}
