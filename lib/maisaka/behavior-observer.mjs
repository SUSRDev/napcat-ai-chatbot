/**
 * 行为观察：群聊消息流 + Planner 推理事件（麦麦观察迁移）
 */

const MAX_EVENTS_PER_GROUP = 600;
const MAX_CHAT_PER_GROUP = 300;
const MAX_GROUPS = 120;

/** @type {Map<string, object>} */
const groupMeta = new Map();
/** @type {Map<string, object[]>} */
const eventFeeds = new Map();
/** @type {Map<string, object[]>} */
const chatFeeds = new Map();
/** @type {Map<string, { timer: ReturnType<typeof setInterval>, running: boolean, round: number, startedAt: number }>} */
const loopState = new Map();

let globalEventId = 1;

function gid(groupId) {
  return String(groupId || '').trim();
}

function ensureGroup(groupId, patch = {}) {
  const g = gid(groupId);
  if (!g) return null;
  const prev = groupMeta.get(g) || {
    groupId: g,
    groupName: '',
    lastActivity: 0,
    messageCount: 0,
    status: 'idle',
    loopRunning: false,
    loopRound: 0,
    plannerRunning: false,
    lastPlannerAt: 0
  };
  const next = { ...prev, ...patch, groupId: g, lastActivity: patch.lastActivity ?? prev.lastActivity ?? Date.now() };
  groupMeta.set(g, next);
  if (!eventFeeds.has(g)) eventFeeds.set(g, []);
  if (!chatFeeds.has(g)) chatFeeds.set(g, []);
  return next;
}

function trimFeed(list, max) {
  while (list.length > max) list.shift();
}

function pushEvent(groupId, type, data = {}) {
  const g = gid(groupId);
  if (!g) return null;
  ensureGroup(g);
  const ev = {
    id: globalEventId++,
    ts: Date.now(),
    type,
    groupId: g,
    data
  };
  const feed = eventFeeds.get(g);
  feed.push(ev);
  trimFeed(feed, MAX_EVENTS_PER_GROUP);
  ensureGroup(g, { lastActivity: ev.ts, status: type.startsWith('planner') ? 'planner' : (groupMeta.get(g)?.status || 'idle') });
  return ev;
}

/** @param {string} groupId @param {object} msg */
export function recordObserveChat(groupId, msg) {
  const g = gid(groupId);
  if (!g) return;
  const chat = {
    id: globalEventId++,
    ts: msg.ts || Date.now(),
    userId: String(msg.userId || ''),
    userName: String(msg.userName || msg.userId || '用户'),
    text: String(msg.text || '').slice(0, 800),
    isBot: Boolean(msg.isBot)
  };
  const list = chatFeeds.get(g) || [];
  list.push(chat);
  trimFeed(list, MAX_CHAT_PER_GROUP);
  chatFeeds.set(g, list);
  const meta = ensureGroup(g, {
    groupName: msg.groupName || groupMeta.get(g)?.groupName || '',
    messageCount: list.length,
    lastActivity: chat.ts,
    status: groupMeta.get(g)?.plannerRunning ? 'planner' : (groupMeta.get(g)?.loopRunning ? 'loop' : 'waiting')
  });
  if (meta) meta.messageCount = list.length;
}

/** @param {string} groupId @param {object} data */
export function recordObservePlannerStart(groupId, data = {}) {
  ensureGroup(gid(groupId), { plannerRunning: true, status: 'planner', lastPlannerAt: Date.now() });
  return pushEvent(groupId, 'planner_start', data);
}

/** @param {string} groupId @param {object} data */
export function recordObservePlannerRound(groupId, data = {}) {
  return pushEvent(groupId, 'planner_round', data);
}

/** @param {string} groupId @param {object} data */
export function recordObservePlannerEnd(groupId, data = {}) {
  const g = gid(groupId);
  ensureGroup(g, { plannerRunning: false, status: loopState.get(g)?.running ? 'loop' : 'waiting', lastPlannerAt: Date.now() });
  return pushEvent(groupId, 'planner_end', data);
}

/** @param {string} groupId @param {string} decision @param {object} data */
export function recordObserveDecision(groupId, decision, data = {}) {
  return pushEvent(groupId, 'decision', { decision, ...data });
}

/** @param {string} groupId @param {object} data */
export function recordObserveOutbound(groupId, data = {}) {
  return pushEvent(groupId, 'outbound', data);
}

export function listObserveGroups() {
  const out = [...groupMeta.values()]
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  if (out.length > MAX_GROUPS) return out.slice(0, MAX_GROUPS);
  return out.map((g) => ({
    ...g,
    loopRunning: loopState.get(g.groupId)?.running || false,
    loopRound: loopState.get(g.groupId)?.round || 0
  }));
}

/** @param {string} groupId @param {number} [sinceId] */
export function getObserveEvents(groupId, sinceId = 0) {
  const g = gid(groupId);
  const feed = eventFeeds.get(g) || [];
  const sid = Math.max(0, Number(sinceId) || 0);
  if (!sid) return [...feed];
  return feed.filter((e) => e.id > sid);
}

/** @param {string} groupId @param {number} [limit] */
export function getObserveChat(groupId, limit = 80) {
  const g = gid(groupId);
  const list = chatFeeds.get(g) || [];
  const n = Math.max(1, Math.min(300, Number(limit) || 80));
  return list.slice(-n);
}

/** @param {string} groupId */
export function getObserveStats(groupId) {
  const g = gid(groupId);
  const meta = groupMeta.get(g) || null;
  const events = eventFeeds.get(g) || [];
  const chats = chatFeeds.get(g) || [];
  const plannerEvents = events.filter((e) => e.type.startsWith('planner'));
  const noActions = events.filter((e) => e.type === 'planner_end' && e.data?.action === 'skip');
  const outbounds = events.filter((e) => e.type === 'outbound');
  const loop = loopState.get(g);
  return {
    groupId: g,
    meta,
    chatCount: chats.length,
    eventCount: events.length,
    plannerRuns: events.filter((e) => e.type === 'planner_start').length,
    noActionCount: noActions.length,
    outboundCount: outbounds.length,
    loopRunning: loop?.running || false,
    loopRound: loop?.round || 0,
    loopStartedAt: loop?.startedAt || 0
  };
}

export function isObserveLoopRunning(groupId) {
  return !!loopState.get(gid(groupId))?.running;
}

/**
 * @param {string} groupId
 * @param {(round: number) => Promise<void>} tickFn
 * @param {number} intervalMs
 */
export function startObserveLoop(groupId, tickFn, intervalMs = 15000) {
  const g = gid(groupId);
  if (!g) return { ok: false, error: '无效群号' };
  stopObserveLoop(g);
  const state = { running: true, round: 0, startedAt: Date.now(), timer: null };
  loopState.set(g, state);
  ensureGroup(g, { loopRunning: true, status: 'loop' });
  pushEvent(g, 'loop_start', { intervalMs });

  const runTick = async () => {
    if (!loopState.get(g)?.running) return;
    state.round += 1;
    loopState.set(g, { ...state, round: state.round });
    ensureGroup(g, { loopRound: state.round, status: 'loop' });
    try {
      await tickFn(state.round);
    } catch { /* ignore tick errors */ }
  };

  runTick();
  state.timer = setInterval(runTick, Math.max(5000, Number(intervalMs) || 15000));
  loopState.set(g, state);
  return { ok: true, groupId: g };
}

/** @param {string} groupId */
export function stopObserveLoop(groupId) {
  const g = gid(groupId);
  const st = loopState.get(g);
  if (st?.timer) clearInterval(st.timer);
  if (st?.running) pushEvent(g, 'loop_stop', { rounds: st.round || 0 });
  loopState.set(g, { running: false, round: 0, startedAt: 0, timer: null });
  ensureGroup(g, { loopRunning: false, status: 'waiting' });
  return { ok: true };
}

export function stopAllObserveLoops() {
  for (const g of [...loopState.keys()]) stopObserveLoop(g);
}

/** @param {string} groupId @param {string} groupName */
export function touchObserveGroupName(groupId, groupName) {
  if (!groupName) return;
  ensureGroup(groupId, { groupName: String(groupName).slice(0, 80) });
}

export function clearObserveGroup(groupId) {
  const g = gid(groupId);
  stopObserveLoop(g);
  eventFeeds.delete(g);
  chatFeeds.delete(g);
  groupMeta.delete(g);
}

export function getObserveGlobalStats() {
  const groups = listObserveGroups();
  let totalChat = 0;
  let totalPlanner = 0;
  let activeLoops = 0;
  for (const g of groups) {
    totalChat += g.messageCount || 0;
    const ev = eventFeeds.get(g.groupId) || [];
    totalPlanner += ev.filter((e) => e.type === 'planner_start').length;
    if (g.loopRunning) activeLoops += 1;
  }
  return { groupCount: groups.length, totalChat, totalPlanner, activeLoops };
}
