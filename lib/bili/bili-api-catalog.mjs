/**
 * Bilibili 常用 API 目录（参考 bili-apis / bilibili-API-collect）
 * 文档：https://github.com/realysy/bili-apis
 *       https://socialsisteryi.github.io/bilibili-API-collect/
 */
export const BILI_API_DOC_URL = 'https://github.com/realysy/bili-apis';
export const BILI_API_DOC_LEGACY = 'https://qinshixixing.gitbooks.io/bilibiliapi/content/';

/** @param {string} action */
export function classifyBiliRisk(action) {
  const a = String(action || '').toLowerCase();
  if (/coin|like|favorite|fav|follow|reply|send|post|delete|remove|triple|share|report|black|block|dm|message|charge|pay|buy|vote|sign|checkin/.test(a)) return 'write';
  if (/nav|history|fav\/list|relation\/modify|msg\/send|member\/myinfo/.test(a)) return 'write';
  return 'read';
}

export const BILI_API_CATALOG = [
  { action: 'search_type', title: '搜索视频', category: '搜索', method: 'GET', path: '/x/web-interface/search/type', desc: 'keyword, search_type=video, page, page_size', risk: 'read' },
  { action: 'search_all', title: '综合搜索', category: '搜索', method: 'GET', path: '/x/web-interface/wbi/search/all/v2', desc: 'keyword, page（需 WBI 签名，可能失败）', risk: 'read' },
  { action: 'search_suggest', title: '搜索建议', category: '搜索', method: 'GET', path: '/x/web-interface/search/suggest', desc: 'term 关键词', risk: 'read' },
  { action: 'search_default', title: '默认搜索词/热搜', category: '搜索', method: 'GET', path: '/x/web-interface/search/default', desc: '无参', risk: 'read' },
  { action: 'view_detail', title: '视频详情', category: '视频', method: 'GET', path: '/x/web-interface/view/detail', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'view', title: '视频信息', category: '视频', method: 'GET', path: '/x/web-interface/view', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'archive_stat', title: '视频状态数', category: '视频', method: 'GET', path: '/x/web-interface/archive/stat', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'video_desc', title: '视频简介', category: '视频', method: 'GET', path: '/x/web-interface/archive/desc', desc: 'bvid', risk: 'read' },
  { action: 'video_tags', title: '视频 TAG', category: '视频', method: 'GET', path: '/x/tag/archive/tags', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'video_pages', title: '视频分 P', category: '视频', method: 'GET', path: '/x/player/pagelist', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'video_recommend', title: '相关推荐', category: '视频', method: 'GET', path: '/x/web-interface/archive/related', desc: 'bvid 或 aid', risk: 'read' },
  { action: 'ranking_v2', title: '排行榜', category: '排行榜', method: 'GET', path: '/x/web-interface/ranking/v2', desc: 'rid 分区 tid, type=all|origin|rookie', risk: 'read' },
  { action: 'popular', title: '热门视频', category: '排行榜', method: 'GET', path: '/x/web-interface/popular', desc: 'ps, pn', risk: 'read' },
  { action: 'region_feed', title: '分区最新', category: '排行榜', method: 'GET', path: '/x/web-interface/region/feed/rcmd', desc: 'display_id, request_type', risk: 'read' },
  { action: 'user_card', title: '用户名片', category: '用户', method: 'GET', path: '/x/web-interface/card', desc: 'mid', risk: 'read' },
  { action: 'user_info', title: '用户信息', category: '用户', method: 'GET', path: '/x/space/acc/info', desc: 'mid', risk: 'read' },
  { action: 'user_relation_stat', title: '用户关系数', category: '用户', method: 'GET', path: '/x/relation/stat', desc: 'vmid 目标 mid', risk: 'read' },
  { action: 'user_videos', title: '用户投稿列表', category: '用户', method: 'GET', path: '/x/space/arc/search', desc: 'mid, ps, pn, order=pubdate', risk: 'read' },
  { action: 'user_dynamics', title: '用户动态', category: '动态', method: 'GET', path: '/x/polymer/web-dynamic/v1/feed/all', desc: 'host_mid, offset', risk: 'read' },
  { action: 'dynamic_detail', title: '动态详情', category: '动态', method: 'GET', path: '/x/polymer/web-dynamic/v1/detail', desc: 'id 动态 id', risk: 'read' },
  { action: 'nav', title: '导航/登录态', category: '登录', method: 'GET', path: '/x/web-interface/nav', desc: '需 Cookie 获取当前登录用户', risk: 'read' },
  { action: 'nav_stat', title: '未读消息数', category: '登录', method: 'GET', path: '/x/web-interface/nav/stat', desc: '需 Cookie', risk: 'read' },
  { action: 'history_cursor', title: '历史记录', category: '历史', method: 'GET', path: '/x/web-interface/history/cursor', desc: '需 Cookie, max, view_at', risk: 'read' },
  { action: 'toview', title: '稍后再看', category: '历史', method: 'GET', path: '/x/v2/history/toview', desc: '需 Cookie', risk: 'read' },
  { action: 'fav_list', title: '收藏夹列表', category: '收藏', method: 'GET', path: '/x/v3/fav/folder/created/list-all', desc: 'up_mid 或 Cookie 本人', risk: 'read' },
  { action: 'fav_content', title: '收藏夹内容', category: '收藏', method: 'GET', path: '/x/v3/fav/resource/list', desc: 'media_id, pn, ps', risk: 'read' },
  { action: 'reply_main', title: '评论区', category: '评论', method: 'GET', path: '/x/v2/reply/main', desc: 'type=1, oid=avid, mode=3, next=0', risk: 'read' },
  { action: 'reply_sub', title: '评论子回复', category: '评论', method: 'GET', path: '/x/v2/reply/reply', desc: 'type, oid, root, ps', risk: 'read' },
  { action: 'live_room_info', title: '直播间信息', category: '直播', method: 'GET', path: '/room/v1/Room/get_info', desc: 'room_id 或 id', risk: 'read' },
  { action: 'live_user_status', title: '用户直播状态', category: '直播', method: 'GET', path: '/x/live/user-status/v2', desc: 'uid=mid', risk: 'read' },
  { action: 'bangumi_season', title: '番剧 season 信息', category: '番剧', method: 'GET', path: '/pgc/view/web/season', desc: 'season_id', risk: 'read' },
  { action: 'bangumi_follow', title: '番剧追番列表', category: '番剧', method: 'GET', path: '/pgc/web/follow/list', desc: '需 Cookie, type=1番剧', risk: 'read' },
  { action: 'emoji_list', title: '表情列表', category: '表情', method: 'GET', path: '/x/emote/user/panel/web', desc: 'business=reply', risk: 'read' },
  { action: 'zone_feed', title: '分区推荐', category: '视频', method: 'GET', path: '/x/web-interface/zone/feed', desc: 'zone_id 分区号', risk: 'read' },
  { action: 'video_online', title: '视频在线人数', category: '视频', method: 'GET', path: '/x/player/online/total', desc: 'bvid 或 aid,cid', risk: 'read' },
  { action: 'member_myinfo', title: '当前账号信息', category: '登录', method: 'GET', path: '/x/member/web/account/info', desc: '需 Cookie', risk: 'read' },
  { action: 'like_video', title: '点赞视频', category: '互动', method: 'POST', path: '/x/web-interface/archive/like', desc: '需 Cookie, aid/bvid, like=1', risk: 'write' },
  { action: 'coin_video', title: '投币', category: '互动', method: 'POST', path: '/x/web-interface/coin/add', desc: '需 Cookie, aid, multiply', risk: 'write' },
  { action: 'fav_add', title: '收藏视频', category: '互动', method: 'POST', path: '/x/v3/fav/resource/deal', desc: '需 Cookie, rid=aid, add_media_ids', risk: 'write' },
  { action: 'follow_user', title: '关注用户', category: '互动', method: 'POST', path: '/x/relation/modify', desc: '需 Cookie, fid=mid, act=1关注', risk: 'write' },
  { action: 'send_dm', title: '发送私信', category: '消息', method: 'POST', path: '/x/web_im/send_msg', desc: '需 Cookie', risk: 'write' },
  { action: 'reply_send', title: '发送评论', category: '评论', method: 'POST', path: '/x/v2/reply/add', desc: '需 Cookie, type, oid, message', risk: 'write' }
];
