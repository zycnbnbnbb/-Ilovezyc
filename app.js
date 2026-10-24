'use strict';

// 瓦(Codev)一体式实时网页雷达 — viewer 主程序。
// 协议契约: docs/val-radar/INTEGRATION_20261017.md §4(v4 二进制 + meta JSON + config JSON)。
// 同时保留 v2(0x02)/v1(0x01) 解析以兼容旧 demo host(fake-host.js / val-demo-host.js)。
// 坐标变换契约由 public/radar-transform.js 提供(双端对齐, 不在此处改动)。

// === DOM 引用 ===
const canvas = document.getElementById('radar');
const ctx = canvas.getContext('2d', { alpha: false });
const joinView = document.getElementById('joinView');
const roomInput = document.getElementById('roomInput');
const serverInput = document.getElementById('serverInput');
const connectBtn = document.getElementById('connectBtn');
const demoBtn = document.getElementById('demoBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const panelBtn = document.getElementById('panelBtn');
const rosterBtn = document.getElementById('rosterBtn');
const settingsPanel = document.getElementById('settingsPanel');
const rosterPanel = document.getElementById('rosterPanel');
const joinError = document.getElementById('joinError');
const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const frameText = document.getElementById('frameText');
const mapNameEl = document.getElementById('mapName');
const roomBadge = document.getElementById('roomBadge');
const playerCount = document.getElementById('playerCount');
const webFps = document.getElementById('webFps');
const scaleText = document.getElementById('scaleText');
const viewerCount = document.getElementById('viewerCount');
const sizeText = document.getElementById('sizeText');
const modeText = document.getElementById('modeText');
const roster = document.getElementById('roster');
const spikePanel = document.getElementById('spikePanel');
// 解码状态条(top)
const decodeRoom = document.getElementById('decodeRoom');
const decodeHost = document.getElementById('decodeHost');
const decodeState = document.getElementById('decodeState');
const decodeKeystream = document.getElementById('decodeKeystream');
const decodeRatio = document.getElementById('decodeRatio');
const decodeChars = document.getElementById('decodeChars');
const decodePps = document.getElementById('decodePps');
const decodeGapResets = document.getElementById('decodeGapResets');
const decodeNotes = document.getElementById('decodeNotes');
const keystreamSpark = document.getElementById('keystreamSpark');
// kill feed 浮层
const killFeed = document.getElementById('killFeed');

const optionIds = [
  'showLabels', 'showHealth', 'showArmor', 'showWeapon',
  'showSpikePos', 'showSpikeTimer', 'showSpikeCarrier', 'showFov', 'showGrid',
  'showDeath', 'showKillFeed', 'showDecode',
];

const controls = Object.fromEntries(optionIds.map((id) => [id, document.getElementById(id)]));
const mapScaleSlider = document.getElementById('mapScale');
const iconSizeSlider = document.getElementById('iconSize');
const mapScaleValue = document.getElementById('mapScaleValue');
const iconSizeValue = document.getElementById('iconSizeValue');
const serverInputMirror = document.getElementById('serverInputMirror');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themeLightBtn = document.getElementById('themeLightBtn');

// === 常量与表 ===
const VIRTUAL_SIZE = 614;
const LERP_SPEED = 15;                       // 位置插值: 1 - exp(-15*dt)
const DEATH_MARKER_TTL_MS = 20_000;          // 死亡 X 标记存活 20s 后渐隐
const KILL_FEED_MAX = 20;
const KEYSTREAM_SPARK_MAX = 60;              // sparkline 最多采样点
const {
  MAP_TRANSFORMS,
  inferMapFromPositions,
  worldToMinimap,
  mapHeadingDegrees,
  selfFollowRotationDegrees,
  transformPointForSelfFollow,
} = window.TitanRadarTransform;

// v2/v4 共用: mapId → 内部 code(与 radar-transform.js MAP_TRANSFORMS 的 key 对齐)。
// 索引顺序与 docs §4.1 枚举一致: 0未知 1Ascent 2Bind 3Icebox 4Haven 5Split 6Breeze
// 7Fracture 8Corrode 9Pearl 10Lotus 11Sunset 12Abyss 13Summit。
// code 名是参考 viewer 的内部代号(Bind→Duality, Icebox→Port, ...), 坐标标定表用它做 key。
const MAP_NAMES = [
  '', 'Ascent', 'Duality', 'Port', 'Triad', 'Bonsai',
  'Foxtrot', 'Canyon', 'Rook', 'Pitt', 'Jam', 'Juliett', 'Abyss', 'Summit',
];

const MAP_ASSETS = {
  Ascent: '/maps/Ascent_minimap.png',
  Duality: '/maps/Bind_minimap.png',
  Port: '/maps/Icebox_minimap.png',
  Triad: '/maps/Haven_minimap.png',
  Bonsai: '/maps/Split_minimap.png',
  Foxtrot: '/maps/Breeze_minimap.png',
  Canyon: '/maps/Fracture_minimap.png',
  Rook: '/maps/Corrode_minimap.png',
  Pitt: '/maps/Pearl_minimap.png',
  Jam: '/maps/Lotus_minimap.png',
  Juliett: '/maps/Sunset_minimap.png',
  Infinity: '/maps/Abyss_minimap.png',
  Abyss: '/maps/Abyss_minimap.png',
  YouSuiDiKu: '/maps/Abyss_minimap.png',
  Summit: '/maps/Summit_minimap.png',
};

const MAP_DISPLAY = {
  Ascent: '亚海悬城',
  Duality: '源工重镇',
  Port: '冬寒深巷',
  Triad: '隐世修所',
  Bonsai: '霓虹町',
  Foxtrot: '微风岛屿',
  Canyon: '裂变峡谷',
  Rook: '古寨',
  Pitt: '深海明珠',
  Jam: '莲花古城',
  Juliett: '日落之城',
  Infinity: '幽邃地窟',
  Abyss: '幽邃地窟',
  YouSuiDiKu: '幽邃地窟',
  Summit: '天枢云阙',
};

// v2 heroId 表(1-29), 仅旧 demo 用。v4 用 RES_TO_AGENT。
const HERO_CODES = [
  '', 'Bot', 'Jett', 'Sage', 'Phoenix', 'Reyna', 'Sova', 'Viper', 'Raze', 'Cypher',
  'Breach', 'Skye', 'Killjoy', 'Brimstone', 'Omen', 'Yoru', 'Astra', 'KAYO',
  'Chamber', 'Neon', 'Fade', 'Gekko', 'Deadlock', 'Iso', 'Clove', 'Vyse', 'Tejo',
  'Waylay', 'Harbor', 'Pine',
];

const HERO_DISPLAY = {
  Bot: '机器人', Jett: '捷风', Sage: '贤者', Phoenix: '不死鸟', Reyna: '芮娜',
  Sova: '猎枭', Viper: '蝰蛇', Raze: '雷兹', Cypher: '零', Breach: '铁臂',
  Skye: '斯凯', Killjoy: '奇乐', Brimstone: '炼狱', Omen: '幽影', Yoru: '夜露',
  Astra: '星礈', KAYO: 'KO', Chamber: '尚博勒', Neon: '霓虹', Fade: '黑梦',
  Gekko: '盖可', Deadlock: '钢锁', Iso: '壹决', Clove: '暮蝶', Vyse: '维斯',
  Tejo: '钛狐', Waylay: '幻棱', Harbor: '海神', Pine: '禁灭',
};

const WEAPON_CODES = [
  '', 'Knife', 'Classic', 'Shorty', 'Frenzy', 'Ghost', 'Sheriff', 'HeadHunter',
  'Stinger', 'Spectre', 'Bucky', 'Judge', 'Bulldog', 'Guardian', 'Phantom',
  'Vandal', 'Marshal', 'Outlaw', 'Operator', 'Ares', 'Odin', 'TourDeForce',
  'ZhuiLie',
];

const WEAPON_DISPLAY = {
  Knife: '小刀', Classic: '标配', Shorty: '短炮', Frenzy: '狂怒', Ghost: '鬼魅',
  Sheriff: '正义', HeadHunter: '猎头', Stinger: '蜂刺', Spectre: '骇灵',
  Bucky: '雄鹿', Judge: '判官', Bulldog: '獠犬', Guardian: '戍卫',
  Phantom: '幻影', Vandal: '狂徒', Marshal: '飞将', Outlaw: '莽侠',
  Operator: '冥驹', Ares: '战神', Odin: '奥丁', TourDeForce: '大招', ZhuiLie: '追猎',
};

// v4: CharacterCoreInfo.ResId(短号)→ 特工图标 code + 中文名。
// 编号来自游戏 heroIDTables(Titan id_catalog.cpp / esp_assets.cpp, 代号 Wushu=Jett, Thorne=Sage, Hunter=Sova …),
// 10-17 局实测: res 3005/3018/3002/3004/3024/3016 与导出表里的 AGT_SO/NE/SA/RE/CL/KA 资源一一对上(自己 3005 = 猎枭)。
// 3021 是海神(1.24 新人物), 钢锁是 3022; 3028 禁灭; 3201 训练机器人。未命中时 UI 用编号圆 "R<actor>" 兜底。
const RES_TO_AGENT = Object.fromEntries([
  [3001, 'Jett'], [3002, 'Sage'], [3003, 'Phoenix'], [3004, 'Reyna'], [3005, 'Sova'],
  [3006, 'Viper'], [3007, 'Raze'], [3008, 'Cypher'], [3009, 'Breach'], [3010, 'Skye'],
  [3011, 'Killjoy'], [3012, 'Brimstone'], [3013, 'Omen'], [3014, 'Yoru'], [3015, 'Astra'],
  [3016, 'KAYO'], [3017, 'Chamber'], [3018, 'Neon'], [3019, 'Fade'], [3020, 'Gekko'],
  [3021, 'Harbor'], [3022, 'Deadlock'], [3023, 'Iso'], [3024, 'Clove'], [3025, 'Vyse'],
  [3026, 'Tejo'], [3027, 'Waylay'], [3028, 'Pine'], [3201, 'Bot'],
].map(([resId, code]) => [resId, { code, display: HERO_DISPLAY[code] }]));

const CAMP_DISPLAY = { 0: '未知', 1: '红方', 2: '蓝方' };
const SESSION_STATE_DISPLAY = {
  handshake: '握手中', live: '实时', rebind: '重绑定', resync: '回溯重解', stopped: '已停止',
};

const imageCache = new Map();
const mapImage = new Image();
const spikeIcon = new Image();
spikeIcon.src = '/world/spike.png';

// === 状态 ===
const state = {
  ws: null,
  connected: false,
  authed: false,
  hostOnline: false,
  autoReconnect: false,
  connectionId: 0,
  reconnectDelay: 1000,
  reconnectTimer: null,
  currentRoom: '',
  currentMap: '',
  mapInference: '',
  manualMapCode: '',
  mapPrompted: false,
  mapReady: false,
  pendingFrame: null,
  pendingRAF: 0,
  animRAF: 0,
  lastAnimAt: 0,
  lastDrawAt: 0,
  lastFrameAt: 0,
  lastRosterAt: 0,
  lastMetaAt: 0,
  framesThisSecond: 0,
  fps: 0,
  frame: null,
  markers: [],
  rosterPlayers: new Map(),
  rosterMap: '',
  rosterTeam: null,
  spike: null,
  // v4: 最新 meta(JSON 文本帧, ≤2/s)。v4 帧到达时按下标对齐合并到 frame.players。
  meta: null,
  metaPlayers: [],          // meta.players 原序, 与 v4 frame entry 同序同集
  events: [],               // 累积全量事件(spawn/death), 按 t_ms 升序去重
  deaths: [],               // 仅 death 子集, 用于地图 X 标记 + kill feed
  keystreamHistory: [],     // sparkline 采样
  trackedActor: null,       // roster 点玩家追踪(相机跟随)
  config: {
    webFps: 60,
    radarX: 400,
    radarY: 400,
    radarSize: 100,
    radarScale: 50,
    smallMap: false,
    mapId: 0,
    levelPath: '',
    server: '',
  },
  ui: {
    showLabels: true,
    showHealth: true,
    showArmor: true,
    showWeapon: true,
    showSpikePos: true,
    showSpikeTimer: true,
    showSpikeCarrier: true,
    showFov: true,
    showGrid: false,
    showDeath: true,
    showKillFeed: true,
    showDecode: false,
    mapScale: 100,
    iconSize: 24,
  },
};

const NON_RETRY_CLOSE_CODES = new Set([1000, 4001, 4002, 4003, 4005, 4006, 4007, 4029]);

// === 工具 ===
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function degToRad(deg) {
  return deg * Math.PI / 180;
}

function wsDefaultUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function normalizeWsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return wsDefaultUrl();
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  if (raw.startsWith('http://')) return 'ws://' + raw.slice('http://'.length);
  if (raw.startsWith('https://')) return 'wss://' + raw.slice('https://'.length);
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + raw;
}

function parseRoomFromLocation() {
  const path = location.pathname.match(/\/(\d{6})(?:\/)?$/);
  if (path) return path[1];
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const value = query.get('room') || query.get('r') || hash.get('room') || hash.get('r') || '';
  return /^\d{6}$/.test(value) ? value : '';
}

function setStatus(text, ok = false) {
  statusText.textContent = text;
  statusDot.classList.toggle('ok', ok);
  const waiting = !ok && /等待|重连|未在线|连接中|重绑定|回溯|握手/.test(text);
  if (statusBar) {
    statusBar.classList.toggle('connected', ok);
    statusBar.classList.toggle('waiting', waiting);
    statusBar.classList.toggle('disconnected', !ok && !waiting);
  }
}

function showJoin(message = '') {
  state.mapPrompted = false;
  resetMapChoice();
  joinView.classList.remove('hidden');
  joinError.textContent = message;
  document.body.classList.remove('radar-live');
  settingsPanel?.classList.remove('open');
  panelBtn?.classList.remove('open');
  rosterPanel?.classList.remove('open');
  rosterBtn?.classList.remove('open');
  setDecodeBarVisible(false);
}

function enterRadar(waiting = false) {
  if (!state.mapPrompted) {
    // 刚进入雷达: 稍等一下收第一批帧, 地图还没确定(或只是靠坐标猜的)就弹出选图面板
    state.mapPrompted = true;
    setTimeout(maybePromptMap, 1500);
  }
  joinView.classList.add('hidden');
  document.body.classList.add('radar-live');
  setStatus(waiting ? '等待 Host' : '接收中', !waiting);
  setDecodeBarVisible(state.ui.showDecode);
}

function clearRadar() {
  state.frame = null;
  state.markers = [];
  state.rosterPlayers.clear();
  state.rosterMap = '';
  state.rosterTeam = null;
  state.spike = null;
  state.pendingFrame = null;
  state.lastFrameAt = 0;
  state.meta = null;
  state.metaPlayers = [];
  state.events = [];
  state.deaths = [];
  state.keystreamHistory = [];
  state.trackedActor = null;
  viewerCount.textContent = '0';
  state.currentMap = '';
  state.mapReady = false;
  mapImage.removeAttribute('src');
  mapNameEl.textContent = 'Unknown';
  refreshMapPick();
  playerCount.textContent = '0';
  roster.replaceChildren();
  if (killFeed) killFeed.replaceChildren();
  killFeedRenderCache.delete(killFeed);
  updateSpikePanel();
}

// === 设置持久化 ===
function saveUiSettings() {
  localStorage.setItem('titan-radar-ui', JSON.stringify(state.ui));
}

function loadUiSettings() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('titan-radar-ui') || 'null'); } catch (_) {}
  if (stored && typeof stored === 'object') {
    Object.assign(state.ui, stored);
    // 2026-10-23: 解码调试面板改成默认关(手机上会挡住地图); 老设置里存的「开」只在第一次升级时关掉, 之后用户自己开的会保留
    if (stored.uiRev !== 2) state.ui.showDecode = false;
  }
  state.ui.uiRev = 2;
  for (const id of optionIds) {
    if (controls[id]) controls[id].checked = Boolean(state.ui[id]);
  }
  mapScaleSlider.value = String(state.ui.mapScale);
  iconSizeSlider.value = String(state.ui.iconSize);
  mapScaleValue.textContent = `${state.ui.mapScale}%`;
  iconSizeValue.textContent = String(state.ui.iconSize);
}

function bindUiSettings() {
  for (const id of optionIds) {
    controls[id]?.addEventListener('change', () => {
      state.ui[id] = controls[id].checked;
      saveUiSettings();
      if (id === 'showDecode') setDecodeBarVisible(state.ui.showDecode);
    });
  }
  mapScaleSlider?.addEventListener('input', () => {
    state.ui.mapScale = Number(mapScaleSlider.value);
    mapScaleValue.textContent = `${state.ui.mapScale}%`;
    saveUiSettings();
  });
  iconSizeSlider?.addEventListener('input', () => {
    state.ui.iconSize = Number(iconSizeSlider.value);
    iconSizeValue.textContent = String(state.ui.iconSize);
    saveUiSettings();
  });
}

function syncServerMirror() {
  if (serverInputMirror) serverInputMirror.value = normalizeWsUrl(serverInput.value);
}

// 解码状态条显隐: 仅在 live 且 showDecode 开时可见。
function setDecodeBarVisible(visible) {
  if (!decodeBar) return;
  decodeBar.classList.toggle('hidden', !visible);
}

function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeDarkBtn?.classList.toggle('active-def', !light);
  themeDarkBtn?.classList.toggle('active-atk', false);
  themeLightBtn?.classList.toggle('active-atk', light);
  themeLightBtn?.classList.toggle('active-def', false);
  localStorage.setItem('titan-radar-theme', light ? 'light' : 'dark');
}

function bindShellControls() {
  panelBtn?.addEventListener('click', () => {
    const open = !settingsPanel?.classList.contains('open');
    settingsPanel?.classList.toggle('open', open);
    panelBtn.classList.toggle('open', open);
    if (open) rosterPanel?.classList.remove('open');
  });
  rosterBtn?.addEventListener('click', () => {
    const open = !rosterPanel?.classList.contains('open');
    rosterPanel?.classList.toggle('open', open);
    rosterBtn.classList.toggle('open', open);
    if (open) settingsPanel?.classList.remove('open');
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      settingsPanel?.classList.remove('open');
      rosterPanel?.classList.remove('open');
      panelBtn?.classList.remove('open');
      rosterBtn?.classList.remove('open');
    }
  });
  themeDarkBtn?.addEventListener('click', () => applyTheme('dark'));
  themeLightBtn?.addEventListener('click', () => applyTheme('light'));
  serverInput.addEventListener('input', syncServerMirror);
  serverInputMirror?.addEventListener('input', () => {
    serverInput.value = serverInputMirror.value;
    localStorage.setItem('titan-radar-server', normalizeWsUrl(serverInput.value));
  });
}

// === config / meta 应用 ===
function applyConfig(msg) {
  const cfg = state.config;
  if (Number.isFinite(msg.webFps)) cfg.webFps = clamp(msg.webFps, 1, 144);
  if (Number.isFinite(msg.radarX)) cfg.radarX = msg.radarX;
  if (Number.isFinite(msg.radarY)) cfg.radarY = msg.radarY;
  if (Number.isFinite(msg.radarSize)) cfg.radarSize = clamp(msg.radarSize, 10, 300);
  if (Number.isFinite(msg.radarScale)) cfg.radarScale = clamp(msg.radarScale, 1, 200);
  if (typeof msg.smallMap === 'boolean') cfg.smallMap = msg.smallMap;
  if (Number.isFinite(msg.mapId)) cfg.mapId = msg.mapId;
  if (typeof msg.levelPath === 'string') cfg.levelPath = msg.levelPath;
  if (typeof msg.server === 'string') cfg.server = msg.server;
  webFps.textContent = String(Math.round(cfg.webFps));
  scaleText.textContent = String(Math.round(cfg.radarScale));
  sizeText.textContent = String(Math.round(cfg.radarSize));
  modeText.textContent = cfg.smallMap ? '小地图' : '标准';
}

// 事件去重键: death 用 (victim_actor, server_play_time); spawn 用 (actor, t_ms)。
function eventDedupeKey(ev) {
  if (ev.kind === 'death') {
    const spt = Number.isFinite(ev.server_play_time) ? Number(ev.server_play_time).toFixed(2) : '';
    return `death:${ev.victim_actor}:${spt}`;
  }
  if (ev.kind === 'spawn') return `spawn:${ev.actor}:${ev.t_ms}`;
  return `${ev.kind}:${ev.t_ms}`;
}

function applyMeta(meta) {
  if (!meta || meta.type !== 'radar_meta') return;
  state.meta = meta;
  state.lastMetaAt = performance.now();
  if (Array.isArray(meta.players)) state.metaPlayers = meta.players;

  // 累积事件(全量, 按 t_ms 升序去重)。
  if (Array.isArray(meta.events)) {
    const seen = new Set(state.events.map(eventDedupeKey));
    for (const ev of meta.events) {
      if (!ev || !ev.kind) continue;
      const key = eventDedupeKey(ev);
      if (seen.has(key)) continue;
      seen.add(key);
      ev.receivedAt = performance.now();
      state.events.push(ev);
      if (ev.kind === 'death') state.deaths.push(ev);
    }
    state.events.sort((a, b) => (a.t_ms || 0) - (b.t_ms || 0));
  }

  // keystream sparkline 采样。
  const bits = meta.session && Number.isFinite(meta.session.keystream_bits)
    ? meta.session.keystream_bits : 0;
  state.keystreamHistory.push(bits);
  if (state.keystreamHistory.length > KEYSTREAM_SPARK_MAX) state.keystreamHistory.shift();

  renderDecodeStatus(meta);
  renderKillFeed();
}

// === agent 图标 ===
function agentFromResId(resId) {
  if (!resId) return null;
  return RES_TO_AGENT[resId] || null;
}

function getAgentIcon(heroCode, isTeam) {
  if (!heroCode) return null;
  const key = `${heroCode}_${isTeam ? 'Team' : 'Enemy'}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const img = new Image();
  img.src = `/agent/${heroCode}_${isTeam ? 'Team' : 'Enemy'}.png`;
  imageCache.set(key, img);
  return img;
}

// === 地图加载 ===
function loadMap(mapCode, options = {}) {
  if (state.currentMap === mapCode && state.mapInference === (options.inferred || '')) return;
  state.currentMap = mapCode || '';
  state.mapInference = options.inferred || '';
  state.mapReady = false;
  const display = MAP_DISPLAY[mapCode] || mapCode || 'Unknown';
  const suffix = options.inferred ? ` · ${options.inferred}` : '';
  const approx = MAP_TRANSFORMS[mapCode]?.approximate ? ' · 近似标定' : '';
  mapNameEl.textContent = mapCode && !MAP_TRANSFORMS[mapCode]
    ? `${display} · 相对雷达` : `${display}${approx}${suffix}`;
  refreshMapPick();
  if (!mapCode || !MAP_ASSETS[mapCode]) {
    mapImage.removeAttribute('src');
    return;
  }
  mapImage.src = MAP_ASSETS[mapCode];
}

mapImage.onload = () => { state.mapReady = true; };
mapImage.onerror = () => { state.mapReady = false; };

// 缺标定的 mapId 退化为相对雷达: 以 self 为中心同心圆 + 朝向旋转。
function worldToFallbackMinimap(player, self) {
  const scale = Math.max(1, state.config.radarScale * 100 / Math.max(10, state.config.radarSize));
  let relX = (self.x - player.x) / scale;
  let relY = (self.y - player.y) / scale;
  const middleX = relY;
  relY = -relX;
  relX = middleX;
  const a = degToRad(self.yaw || 0);
  const s = Math.sin(a);
  const c = Math.cos(a);
  return {
    x: VIRTUAL_SIZE / 2 + relX * c - relY * s,
    y: VIRTUAL_SIZE / 2 + relX * s + relY * c,
  };
}

// === 玩家身份与队伍归一 ===
function playerKey(player) {
  // v4: actor NetGUID 是稳定主键(actor netguid 升序插入序, 永不重排)。
  if (player.actor > 0) return `actor:${player.actor}`;
  const identity = player.heroId > 0 ? `hero:${player.heroId}` : `slot:${player.index}`;
  return `${player.team || 0}:${identity}`;
}

function normalizePlayerTeams(players, myTeam) {
  const self = players.find((player) => player.isSelf);
  const referenceTeam = self ? self.team : myTeam;
  for (const player of players) {
    if (!player.isSelf && player.team === referenceTeam) {
      player.isTeammate = true;
    }
  }
}

// v4: camp 是 CampID 原值(1红/2蓝); myTeam 来自 header(或 self.camp 推断)。
function normalizePlayerTeamsV4(players, myTeam) {
  const self = players.find((p) => p.is_self);
  const refTeam = self ? self.camp : myTeam;
  for (const p of players) {
    p.isSelf = Boolean(p.is_self);
    p.isTeammate = !p.isSelf && refTeam > 0 && p.camp === refTeam;
  }
}

// === 协议解析 ===
function parseFrame(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4) throw new Error('frame too short');
  const type = view.getUint8(0);
  const mapId = view.getUint8(1);
  const myTeam = view.getUint8(2);
  const count = view.getUint8(3);

  if (type === 0x04) return parseFrameV4(view, mapId, myTeam, count);
  if (type === 0x02) return parseFrameV2(view, mapId, myTeam, count);
  if (type === 0x01) return parseFrameV1(view, mapId, myTeam, count);
  throw new Error(`bad frame type ${type}`);
}

// v4: 12B 头 + 28B/人, 全小端。见 INTEGRATION_20261017.md §4.1。
// 字段偏移: +0 actor u32, +4 x f32, +8 y f32, +12 yaw f32, +16 hp f32,
// +20 camp u8, +21 res_id u16, +23 alive u8, +24 is_self u8, +25 flags u8, +26 pad u8×2。
// (契约标注 "28B × N" / "总长 = 12 + 28·N"; pad×2 使结构恰为 28 字节。)
function parseFrameV4(view, mapId, myTeam, count) {
  const need = 12 + count * 28;
  if (view.byteLength < need) throw new Error(`truncated v4 frame ${view.byteLength}/${need}`);
  const tickMs = view.getUint32(4, true);
  let off = 12;
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const actor = view.getUint32(off, true); off += 4;
    const x = view.getFloat32(off, true); off += 4;
    const y = view.getFloat32(off, true); off += 4;
    const yaw = view.getFloat32(off, true); off += 4;
    const hp = view.getFloat32(off, true); off += 4;
    const camp = view.getUint8(off++);
    const res_id = view.getUint16(off, true); off += 2;
    const alive = view.getUint8(off++);
    const is_self = view.getUint8(off++);
    const flags = view.getUint8(off++);
    off += 2; // pad u8×2 (结构对齐到 28 字节)
    const agent = agentFromResId(res_id);
    players.push({
      index: i, actor, x, y, yaw,
      hp: clamp(hp, 0, 255),
      armor: 0,                 // v4 暂无护甲字段(留给后续 bit 偏移定位)
      weaponId: 0, weapon: '—', // v4 暂无武器字段
      heroId: 0,
      heroCode: agent ? agent.code : '',
      hero: agent ? agent.display : `R${actor}`,
      res_id, camp,
      alive: Boolean(alive),
      is_self: Boolean(is_self),
      hasC4: Boolean(flags & 0x04),
      tickMs,
    });
  }
  normalizePlayerTeamsV4(players, myTeam);
  return { version: 4, mapId, mapCode: MAP_NAMES[mapId] || '', myTeam, tickMs, players, spike: null };
}

function parseFrameV1(view, mapId, myTeam, count) {
  const need = 4 + count * 12 + 12;
  if (view.byteLength < need) throw new Error(`truncated v1 frame ${view.byteLength}/${need}`);
  let off = 4;
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const x = view.getInt16(off, true) * 10; off += 2;
    const y = view.getInt16(off, true) * 10; off += 2;
    const yaw = view.getUint16(off, true) / 10; off += 2;
    const team = view.getUint8(off++);
    const heroId = view.getUint8(off++);
    const hp = view.getUint8(off++);
    const armor = view.getUint8(off++);
    const weaponId = view.getUint8(off++);
    const flags = view.getUint8(off++);
    const heroCode = HERO_CODES[heroId] || '';
    const weaponCode = WEAPON_CODES[weaponId] || '';
    players.push({
      index: i, x, y, yaw, team, heroId, heroCode,
      hero: HERO_DISPLAY[heroCode] || heroCode || `Hero ${heroId}`,
      hp, armor, weaponId,
      weapon: WEAPON_DISPLAY[weaponCode] || weaponCode || `Weapon ${weaponId}`,
      isTeammate: Boolean(flags & 0x01),
      isSelf: Boolean(flags & 0x02),
      hasC4: Boolean(flags & 0x04),
    });
  }
  off = 4 + count * 12;
  const active = view.getUint8(off++);
  let spike = null;
  if (active) {
    spike = {
      active: true,
      remainingTime: view.getUint16(off, true) / 10,
      totalTime: view.getUint16(off + 2, true) / 10,
      progress: view.getUint16(off + 4, true) / 1000,
      flags: view.getUint8(off + 6),
      x: view.getInt16(off + 7, true) * 10,
      y: view.getInt16(off + 9, true) * 10,
    };
    spike.canDefuse = Boolean(spike.flags & 0x01);
    spike.defusing = Boolean(spike.flags & 0x02);
    spike.halfDefuse = Boolean(spike.flags & 0x04);
  }
  normalizePlayerTeams(players, myTeam);
  return { version: 1, mapId, mapCode: MAP_NAMES[mapId] || '', myTeam, players, spike };
}

function parseFrameV2(view, mapId, myTeam, count) {
  const need = 4 + count * 20 + 22;
  if (view.byteLength < need) throw new Error(`truncated v2 frame ${view.byteLength}/${need}`);
  let off = 4;
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const x = view.getFloat32(off, true); off += 4;
    const y = view.getFloat32(off, true); off += 4;
    const yaw = view.getFloat32(off, true); off += 4;
    const team = view.getUint8(off++);
    const heroId = view.getUint8(off++);
    const hp = view.getUint8(off++);
    const armor = view.getUint8(off++);
    const weaponId = view.getUint8(off++);
    const flags = view.getUint8(off++);
    off += 2; // pad
    const heroCode = HERO_CODES[heroId] || '';
    const weaponCode = WEAPON_CODES[weaponId] || '';
    players.push({
      index: i, x, y, yaw, team, heroId, heroCode,
      hero: HERO_DISPLAY[heroCode] || heroCode || `Hero ${heroId}`,
      hp, armor, weaponId,
      weapon: WEAPON_DISPLAY[weaponCode] || weaponCode || `Weapon ${weaponId}`,
      isTeammate: Boolean(flags & 0x01),
      isSelf: Boolean(flags & 0x02),
      hasC4: Boolean(flags & 0x04),
    });
  }
  off = 4 + count * 20;
  const active = view.getUint8(off++);
  let spike = null;
  if (active) {
    spike = {
      active: true,
      remainingTime: view.getFloat32(off, true),
      totalTime: view.getFloat32(off + 4, true),
      progress: view.getFloat32(off + 8, true),
      flags: view.getUint8(off + 12),
      x: view.getFloat32(off + 13, true),
      y: view.getFloat32(off + 17, true),
    };
    spike.canDefuse = Boolean(spike.flags & 0x01);
    spike.defusing = Boolean(spike.flags & 0x02);
    spike.halfDefuse = Boolean(spike.flags & 0x04);
  }
  normalizePlayerTeams(players, myTeam);
  return { version: 2, mapId, mapCode: MAP_NAMES[mapId] || '', myTeam, players, spike };
}

// 把最新 meta 的 players(与 v4 同序同集)按下标合并进 frame.players,
// 补充 v4 帧不带的身份详情(channel/player_state/positions/first_seen/last_pos/bound)。
// 队伍归一已在 parseFrameV4 里用 header myTeam + self.camp 完成, 此处不重做。
function mergeMetaPlayers(framePlayers) {
  const metaPlayers = state.metaPlayers;
  if (!Array.isArray(metaPlayers) || metaPlayers.length === 0) return;
  for (let i = 0; i < framePlayers.length && i < metaPlayers.length; i += 1) {
    const mp = metaPlayers[i];
    const fp = framePlayers[i];
    if (!mp || !fp) continue;
    // meta 是权威身份源: res_id/camp/alive/is_self 若帧里缺, 用 meta 补。
    if (!fp.res_id && mp.res_id) {
      fp.res_id = mp.res_id;
      const agent = agentFromResId(mp.res_id);
      if (agent) { fp.heroCode = agent.code; fp.hero = agent.display; }
    }
    if (fp.camp == null && mp.camp != null) fp.camp = mp.camp;
    if (mp.hp != null) fp.hp = clamp(mp.hp, 0, 255);
    if (mp.alive != null) fp.alive = mp.alive;
    if (mp.is_self != null) fp.is_self = mp.is_self;
    fp.channel = mp.channel;
    fp.player_state = mp.player_state;
    fp.positions = mp.positions;
    fp.first_seen_ms = mp.first_seen_ms;
    fp.last_pos = mp.last_pos;
    fp.bound = mp.bound;
  }
}

function resolveFrameMap(frame) {
  if (state.manualMapCode && MAP_TRANSFORMS[state.manualMapCode]) {
    return { mapCode: state.manualMapCode, inferred: '手动' };
  }
  if (frame.mapCode && MAP_TRANSFORMS[frame.mapCode]) {
    return { mapCode: frame.mapCode, inferred: '' };
  }
  const inferred = inferMapFromPositions(frame.players);
  if (inferred && MAP_TRANSFORMS[inferred.mapCode]) {
    return { mapCode: inferred.mapCode, inferred: '坐标判定' };
  }
  return { mapCode: frame.mapCode || '', inferred: '' };
}

function processFrame(frame) {
  state.frame = frame;
  // v4: 合并最新 meta 身份详情(按下标对齐)。
  if (frame.version === 4) mergeMetaPlayers(frame.players);
  const resolved = resolveFrameMap(frame);
  frame.mapCode = resolved.mapCode;
  loadMap(resolved.mapCode, { inferred: resolved.inferred });
  const rosterPlayers = rememberRoster(frame);
  playerCount.textContent = String(rosterPlayers.length);
  state.lastFrameAt = performance.now();
  state.framesThisSecond += 1;
  state.hostOnline = true;
  setStatus('接收中', true);

  const self = frame.players.find((p) => p.isSelf) || frame.players[0] || { x: 0, y: 0, yaw: 0 };
  const prev = new Map(state.markers.map((m) => [m.key, m]));
  const next = [];
  for (const player of frame.players) {
    const key = playerKey(player);
    const mapped = frame.mapCode ? worldToMinimap(player.x, player.y, frame.mapCode) : null;
    const point = mapped || (player.isSelf ? { x: VIRTUAL_SIZE / 2, y: VIRTUAL_SIZE / 2 } : worldToFallbackMinimap(player, self));
    const old = prev.get(key);
    next.push({
      key,
      player,
      x: old ? old.x : point.x,
      y: old ? old.y : point.y,
      targetX: point.x,
      targetY: point.y,
    });
  }
  state.markers = next;
  if (frame.spike && frame.spike.active) {
    const mappedSpike = frame.mapCode ? worldToMinimap(frame.spike.x, frame.spike.y, frame.mapCode) : null;
    state.spike = { ...frame.spike, point: mappedSpike || worldToFallbackMinimap(frame.spike, self) };
  } else {
    state.spike = null;
  }
  updateSpikePanel();
  if (performance.now() - state.lastRosterAt > 250) {
    renderRoster(rosterPlayers);
    state.lastRosterAt = performance.now();
  }
}

function scheduleProcessFrame(frame) {
  state.pendingFrame = frame;
  if (state.pendingRAF) return;
  state.pendingRAF = requestAnimationFrame(() => {
    state.pendingRAF = 0;
    if (state.pendingFrame) {
      processFrame(state.pendingFrame);
      state.pendingFrame = null;
    }
  });
}

function rememberRoster(frame) {
  const self = frame.players.find((player) => player.isSelf);
  const currentTeam = self ? (self.camp != null ? self.camp : self.team) : (frame.myTeam != null ? frame.myTeam : null);
  const mapChanged = frame.mapCode && state.rosterMap && frame.mapCode !== state.rosterMap;
  const teamChanged = state.rosterTeam !== null && currentTeam !== state.rosterTeam;
  if (mapChanged || teamChanged) {
    state.rosterPlayers.clear();
  }
  if (frame.mapCode) state.rosterMap = frame.mapCode;
  state.rosterTeam = currentTeam;

  const visible = new Set();
  for (const player of frame.players) {
    const key = playerKey(player);
    visible.add(key);
    state.rosterPlayers.set(key, { ...player, missing: false });
  }
  for (const [key, player] of state.rosterPlayers) {
    if (!visible.has(key)) {
      state.rosterPlayers.set(key, {
        ...player,
        hp: 0, armor: 0, hasC4: false, missing: true,
        alive: false,
      });
    }
  }
  return Array.from(state.rosterPlayers.values());
}

async function handleBinary(data) {
  try {
    const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    scheduleProcessFrame(parseFrame(buf));
  } catch (e) {
    setStatus(e.message, false);
  }
}

// === 连接 ===
function connect(options = {}) {
  const room = roomInput.value.trim();
  if (!/^\d{6}$/.test(room)) {
    showJoin('房间号需要 6 位数字');
    roomInput.focus();
    return;
  }
  const url = normalizeWsUrl(serverInput.value);
  localStorage.setItem('titan-radar-server', url);
  localStorage.setItem('titan-radar-room', room);
  syncServerMirror();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const resetDelay = options.resetDelay !== false;
  const previousWs = state.ws;
  state.connectionId += 1;
  const connectionId = state.connectionId;
  if (previousWs && previousWs.readyState !== WebSocket.CLOSED) {
    try { previousWs.close(1000, 'superseded'); } catch (_) {}
  }
  clearRadar();
  state.currentRoom = room;
  roomBadge.textContent = room;
  if (decodeRoom) decodeRoom.textContent = room;
  state.autoReconnect = true;
  if (resetDelay) state.reconnectDelay = 1000;
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.binaryType = 'arraybuffer';
  setStatus('连接中', false);
  joinError.textContent = '';
  connectBtn.disabled = true;

  ws.onopen = () => {
    if (connectionId !== state.connectionId || ws !== state.ws) return;
    state.connected = true;
    state.authed = false;
    state.hostOnline = false;
    state.reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: 'auth', role: 'viewer', room }));
  };
  ws.onmessage = (ev) => {
    if (connectionId !== state.connectionId || ws !== state.ws) return;
    if (typeof ev.data !== 'string') {
      handleBinary(ev.data);
      enterRadar(false);
      return;
    }
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (_) {}
    if (!msg) return;
    if (msg.type === 'auth_ok' || msg.type === 'joined') {
      state.authed = true;
      connectBtn.disabled = false;
      enterRadar(Boolean(msg.waiting));
      return;
    }
    if (msg.type === 'host_online') {
      state.hostOnline = true;
      setStatus(msg.message || 'Host 已在线', true);
      enterRadar(false);
      return;
    }
    if (msg.type === 'room_stats') {
      viewerCount.textContent = String(Math.max(0, Number(msg.viewerCount) || 0));
      return;
    }
    if (msg.type === 'config') {
      applyConfig(msg);
      return;
    }
    if (msg.type === 'radar_meta') {
      applyMeta(msg);
      return;
    }
    if (msg.error) {
      const text = msg.error === 'rate_limited'
        ? `连接过快,请等待 ${Math.max(1, Number(msg.seconds) || 60)}s`
        : (msg.message || msg.error);
      setStatus(text, false);
      if (msg.error === 'host_offline') {
        state.hostOnline = false;
        enterRadar(true);
      } else {
        showJoin(text);
      }
    }
  };
  ws.onclose = (ev) => {
    if (connectionId !== state.connectionId || ws !== state.ws) return;
    state.ws = null;
    state.connected = false;
    state.authed = false;
    connectBtn.disabled = false;
    if (NON_RETRY_CLOSE_CODES.has(ev.code)) {
      state.autoReconnect = false;
    }
    if (!state.autoReconnect) {
      setStatus(ev.code === 1000 ? '已断开' : '连接断开', false);
      showJoin('');
      return;
    }
    const delay = state.reconnectDelay;
    setStatus(`重连中 (${Math.round(delay / 1000)}s)`, false);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (state.autoReconnect && connectionId === state.connectionId) connect({ resetDelay: false });
    }, delay);
    state.reconnectDelay = Math.min(delay * 2, 30000);
  };
  ws.onerror = () => {
    if (connectionId !== state.connectionId || ws !== state.ws) return;
    connectBtn.disabled = false;
    setStatus('连接错误', false);
  };
}

function disconnect() {
  state.autoReconnect = false;
  state.connectionId += 1;
  state.connected = false;
  state.authed = false;
  state.reconnectDelay = 1000;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  connectBtn.disabled = false;
  const ws = state.ws;
  state.ws = null;
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    try { ws.close(1000, 'manual'); } catch (_) {}
  }
  clearRadar();
  showJoin('');
}

// === 渲染: 画布与相机 ===
function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: rect.width, h: rect.height };
}

function mapRect(bounds) {
  const scale = clamp(state.ui.mapScale, 50, 150) / 100;
  const size = Math.max(260, Math.min(bounds.w, bounds.h) * 0.92 * scale);
  return {
    x: Math.round((bounds.w - size) / 2),
    y: Math.round((bounds.h - size) / 2),
    size: Math.round(size),
  };
}

function rawScreenPoint(marker, rect) {
  return {
    x: rect.x + marker.x / VIRTUAL_SIZE * rect.size,
    y: rect.y + marker.y / VIRTUAL_SIZE * rect.size,
  };
}

function trackedMarker() {
  if (state.trackedActor) {
    const m = state.markers.find((mk) => mk.player.actor === state.trackedActor);
    if (m) return m;
  }
  return state.markers.find((marker) => marker.player.isSelf) || null;
}

function cameraState(rect) {
  const center = { x: rect.x + rect.size / 2, y: rect.y + rect.size / 2 };
  const selfMarker = trackedMarker();
  if (!selfMarker) {
    return { active: false, rotation: 0, center, markerPoint: center, yaw: 0 };
  }
  return {
    active: true,
    rotation: degToRad(selfFollowRotationDegrees(selfMarker.player.yaw, state.currentMap)),
    center,
    markerPoint: rawScreenPoint(selfMarker, rect),
    yaw: selfMarker.player.yaw,
  };
}

function screenPoint(marker, rect) {
  const point = rawScreenPoint(marker, rect);
  const camera = cameraState(rect);
  if (!camera.active) return point;
  return transformPointForSelfFollow(
    point,
    camera.markerPoint,
    camera.center,
    camera.yaw,
    state.currentMap,
  );
}

function cameraRotationDegrees() {
  const selfMarker = trackedMarker();
  return selfMarker
    ? selfFollowRotationDegrees(selfMarker.player.yaw, state.currentMap)
    : 0;
}

function applyCameraCanvasTransform(rect) {
  const camera = cameraState(rect);
  if (!camera.active) return;
  ctx.translate(camera.center.x, camera.center.y);
  ctx.rotate(camera.rotation);
  ctx.translate(-camera.markerPoint.x, -camera.markerPoint.y);
}

function drawBackground(bounds, rect) {
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, bounds.w, bounds.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.size, rect.size);
  ctx.clip();
  applyCameraCanvasTransform(rect);
  ctx.fillStyle = '#10161d';
  ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
  if (MAP_TRANSFORMS[state.currentMap] && state.mapReady && mapImage.naturalWidth > 0) {
    const imageRot = MAP_TRANSFORMS[state.currentMap]?.imageRot || 0;
    if (imageRot) {
      ctx.save();
      ctx.translate(rect.x + rect.size / 2, rect.y + rect.size / 2);
      ctx.rotate(degToRad(imageRot));
      ctx.drawImage(mapImage, -rect.size / 2, -rect.size / 2, rect.size, rect.size);
      ctx.restore();
    } else {
      ctx.drawImage(mapImage, rect.x, rect.y, rect.size, rect.size);
    }
    ctx.fillStyle = 'rgba(4, 7, 10, 0.18)';
    ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
  } else {
    drawFallbackMap(rect);
  }
  if (state.ui.showGrid) drawGrid(rect);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.size - 1, rect.size - 1);
}

function drawFallbackMap(rect) {
  ctx.fillStyle = '#111820';
  ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
  const cx = rect.x + rect.size / 2;
  const cy = rect.y + rect.size / 2;
  ctx.strokeStyle = 'rgba(255,70,85,0.22)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, rect.size * i / 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(236,232,225,0.08)';
  ctx.beginPath();
  ctx.moveTo(cx, rect.y);
  ctx.lineTo(cx, rect.y + rect.size);
  ctx.moveTo(rect.x, cy);
  ctx.lineTo(rect.x + rect.size, cy);
  ctx.stroke();
  ctx.fillStyle = 'rgba(236,232,225,0.48)';
  ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.currentMap && !MAP_TRANSFORMS[state.currentMap]
    ? '相对雷达' : '等待地图识别', cx, cy + 36);
}

function drawGrid(rect) {
  const step = rect.size / 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i += 1) {
    const p = rect.x + step * i;
    const q = rect.y + step * i;
    ctx.beginPath();
    ctx.moveTo(p, rect.y);
    ctx.lineTo(p, rect.y + rect.size);
    ctx.moveTo(rect.x, q);
    ctx.lineTo(rect.x + rect.size, q);
    ctx.stroke();
  }
}

function drawFov(point, marker, rect, color) {
  if (!state.ui.showFov || isDead(marker.player)) return;
  const angle = degToRad(
    mapHeadingDegrees(marker.player.yaw, state.currentMap) + cameraRotationDegrees(),
  );
  const radius = rect.size * 0.065;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.arc(point.x, point.y, radius, angle - Math.PI / 4, angle + Math.PI / 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// alive 显式优先(v4); v2 用 hp<=0 推断。
function isDead(player) {
  if (player == null) return false;
  if (typeof player.alive === 'boolean') return !player.alive;
  return player.hp <= 0;
}

function drawMarker(marker, rect) {
  const p = screenPoint(marker, rect);
  const player = marker.player;
  let color = player.isSelf ? '#4ff3df' : (player.isTeammate ? '#58a6ff' : '#ff4655');
  if (isDead(player)) color = '#747b86';
  drawFov(p, marker, rect, color);

  const icon = getAgentIcon(player.heroCode, player.isTeammate || player.isSelf);
  const size = clamp(state.ui.iconSize, 14, 40) * rect.size / VIRTUAL_SIZE;
  ctx.save();
  ctx.globalAlpha = isDead(player) ? 0.5 : 1;
  if (icon && icon.complete && icon.naturalWidth > 0) {
    ctx.drawImage(icon, p.x - size / 2, p.y - size / 2, size, size);
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5, size / 4), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#050608';
    ctx.lineWidth = 2;
    ctx.stroke();
    // res_id 未知时画编号 R<actor>(v4)或 hero 首字(v2)。
    if (player.actor > 0) {
      ctx.fillStyle = '#050608';
      ctx.font = `700 ${Math.max(8, size * 0.3)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(player.actor), p.x, p.y);
    }
  }

  const yaw = degToRad(
    mapHeadingDegrees(player.yaw, state.currentMap) + cameraRotationDegrees(),
  );
  const tip = Math.max(12, size * 0.72);
  ctx.strokeStyle = color;
  ctx.lineWidth = player.isSelf ? 2.2 : 1.6;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(yaw) * tip, p.y + Math.sin(yaw) * tip);
  ctx.stroke();

  if (state.ui.showSpikeCarrier && player.hasC4 && !isDead(player)) {
    ctx.fillStyle = '#f6c84c';
    ctx.font = `700 ${Math.max(9, size * 0.34)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('C4', p.x + size * 0.52, p.y - size * 0.28);
  }

  if (state.ui.showLabels) {
    ctx.font = `700 ${Math.max(10, size * 0.42)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.fillStyle = color;
    const labelY = p.y - size * 0.62;
    ctx.strokeText(player.hero, p.x, labelY);
    ctx.fillText(player.hero, p.x, labelY);
  }

  if (state.ui.showHealth) {
    const bw = Math.max(34, size * 1.65);
    const bh = Math.max(4, size * 0.16);
    const bx = p.x - bw / 2;
    const by = p.y + size * 0.56;
    const hpRatio = clamp(player.hp, 0, 100) / 100;
    const armorMax = player.armor > 50 ? 100 : 50;
    const armorRatio = clamp(player.armor, 0, armorMax) / armorMax;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = player.hp > 50 ? '#34d399' : '#ff4655';
    ctx.fillRect(bx, by, bw * hpRatio, bh);
    if (state.ui.showArmor && player.armor > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(bx, by + bh + 2, bw, bh);
      ctx.fillStyle = '#58a6ff';
      ctx.fillRect(bx, by + bh + 2, bw * armorRatio, bh);
    }
    const vitalY = by + bh * (state.ui.showArmor && player.armor > 0 ? 2 : 1) +
      (state.ui.showArmor && player.armor > 0 ? 5 : 3);
    ctx.font = `700 ${Math.max(9, size * 0.32)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.84)';
    ctx.fillStyle = '#f4f7fb';
    const vitalText = state.ui.showArmor && player.armor > 0
      ? `${Math.round(player.hp)}  |  ${Math.round(player.armor)}`
      : String(Math.round(player.hp));
    ctx.strokeText(vitalText, p.x, vitalY);
    ctx.fillText(vitalText, p.x, vitalY);
  }

  if (state.ui.showWeapon && player.weapon && player.weapon !== '—' && !isDead(player)) {
    ctx.font = `${Math.max(9, size * 0.34)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(236,232,225,0.78)';
    ctx.fillText(player.weapon, p.x, p.y + size * 0.94);
  }
  ctx.restore();
}

function drawSpike(rect) {
  if (!state.ui.showSpikePos || !state.spike || !state.spike.point) return;
  const p = screenPoint(state.spike.point, rect);
  const size = Math.max(18, rect.size * 0.036);
  if (spikeIcon.complete && spikeIcon.naturalWidth > 0) {
    ctx.drawImage(spikeIcon, p.x - size / 2, p.y - size / 2, size, size);
  } else {
    ctx.fillStyle = '#f6c84c';
    ctx.fillRect(p.x - size / 3, p.y - size / 3, size * 0.66, size * 0.66);
  }
}

// 死亡 X 标记: meta.events 的 death 在地图上画红 X, 20s 后渐隐。
function drawDeathMarkers(rect) {
  if (!state.ui.showDeath) return;
  const now = performance.now();
  const mapCode = state.currentMap;
  for (const ev of state.deaths) {
    if (!ev || !Array.isArray(ev.pos)) continue;
    const mapped = mapCode ? worldToMinimap(ev.pos[0], ev.pos[1], mapCode) : null;
    if (!mapped) continue;
    const p = screenPoint({ x: mapped.x, y: mapped.y }, rect);
    const age = now - (ev.receivedAt || 0);
    if (age > DEATH_MARKER_TTL_MS) continue;
    const alpha = Math.max(0, 1 - age / DEATH_MARKER_TTL_MS);
    const s = Math.max(10, rect.size * 0.022);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ff4655';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y - s);
    ctx.lineTo(p.x + s, p.y + s);
    ctx.moveTo(p.x + s, p.y - s);
    ctx.lineTo(p.x - s, p.y + s);
    ctx.stroke();
    ctx.restore();
  }
}

function render(now = performance.now()) {
  const dt = Math.min((now - (state.lastAnimAt || now)) / 1000, 0.1);
  state.lastAnimAt = now;
  const factor = 1 - Math.exp(-LERP_SPEED * dt);
  for (const marker of state.markers) {
    marker.x += (marker.targetX - marker.x) * factor;
    marker.y += (marker.targetY - marker.y) * factor;
  }

  const minDrawInterval = 1000 / clamp(state.config.webFps || 60, 1, 144);
  if (now - state.lastDrawAt >= minDrawInterval) {
    state.lastDrawAt = now;
    const bounds = fitCanvas();
    const rect = mapRect(bounds);
    drawBackground(bounds, rect);
    drawSpike(rect);
    drawDeathMarkers(rect);
    for (const marker of state.markers) drawMarker(marker, rect);
    if (!state.frame) {
      ctx.fillStyle = 'rgba(236,232,225,0.72)';
      ctx.font = '15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('等待雷达数据', bounds.w / 2, bounds.h / 2);
    }
  }
  state.animRAF = requestAnimationFrame(render);
}

// === Roster 侧栏 ===
function rosterGroup(player) {
  return player.isSelf || player.isTeammate ? 'ally' : 'enemy';
}

function createRosterGroup(title, count, kind) {
  const header = document.createElement('div');
  header.className = `roster-group ${kind}`;
  const name = document.createElement('span');
  name.textContent = title;
  const value = document.createElement('strong');
  value.textContent = String(count);
  header.append(name, value);
  return header;
}

function fmtFirstSeen(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function createRosterRow(p, group) {
  const row = document.createElement('div');
  row.className = `player-row ${group}${p.missing ? ' missing' : ''}`;
  if (row.dataset) row.dataset.actor = p.actor != null ? String(p.actor) : '';
  // 点击行 → 相机跟随该玩家(再点取消)。
  row.addEventListener('click', () => {
    if (!p.actor) return;
    state.trackedActor = state.trackedActor === p.actor ? null : p.actor;
    row.classList.toggle('tracked', state.trackedActor === p.actor);
  });
  const mark = document.createElement('span');
  mark.className = `team-mark ${p.isSelf ? 'self' : (p.isTeammate ? 'ally' : 'enemy')}`;
  const icon = getAgentIcon(p.heroCode, group === 'ally');
  if (icon?.src) {
    const avatar = document.createElement('img');
    avatar.src = icon.src;
    avatar.alt = '';
    avatar.addEventListener('error', () => { mark.textContent = (p.hero || '?').slice(0, 1); });
    mark.append(avatar);
  } else {
    mark.textContent = (p.hero || '?').slice(0, 1);
  }
  const main = document.createElement('div');
  main.className = 'player-main';
  const name = document.createElement('strong');
  name.textContent = p.hero;
  if (p.isSelf || p.hasC4) {
    const badges = document.createElement('span');
    badges.className = 'player-badges';
    if (p.isSelf) badges.textContent = '自己';
    if (p.hasC4) badges.textContent += `${badges.textContent ? '  ' : ''}C4`;
    name.append(badges);
  }
  const sub = document.createElement('span');
  sub.textContent = p.missing
    ? `${p.weapon}  已阵亡`
    : `${p.weapon}  ${Math.round(p.x)}, ${Math.round(p.y)}`;
  main.append(name, sub);
  // v4 详情行: ResId / 队伍 / 观察数 / 首现时间 / 通道(仅在 v4 字段存在时追加)。
  if (p.actor != null || p.res_id != null || p.positions != null) {
    const details = document.createElement('span');
    details.className = 'player-details';
    const parts = [];
    if (p.res_id != null) parts.push(`ResId ${p.res_id}`);
    if (p.camp != null) parts.push(CAMP_DISPLAY[p.camp] || `队${p.camp}`);
    if (p.positions != null) parts.push(`观察 ${p.positions}`);
    if (p.first_seen_ms != null) parts.push(`首现 ${fmtFirstSeen(p.first_seen_ms)}`);
    if (p.channel != null) parts.push(`ch${p.channel}`);
    details.textContent = parts.join(' · ');
    main.append(details);
  }
  const vitals = document.createElement('div');
  vitals.className = 'player-vitals';
  const hp = document.createElement('div');
  hp.className = 'vital health';
  hp.innerHTML = `<span>HP</span><strong>${Math.round(p.hp)}</strong><i><b style="width:${clamp(p.hp, 0, 100)}%"></b></i>`;
  const armorMax = p.armor > 50 ? 100 : 50;
  const armor = document.createElement('div');
  armor.className = 'vital armor';
  armor.innerHTML = `<span>AP</span><strong>${Math.round(p.armor)}</strong><i><b style="width:${clamp(p.armor, 0, armorMax) / armorMax * 100}%"></b></i>`;
  vitals.append(hp, armor);
  row.append(mark, main, vitals);
  return row;
}

const rosterRenderCache = new WeakMap();

function rosterRowSignature(player, group) {
  // 包含所有显示字段; 隐藏坐标无需重建行。v4 字段(actor/res_id/camp/alive/positions/
  // first_seen_ms)缺席时归一为 null, 保证 v2/v4 schema 各自内部稳定。
  return JSON.stringify([
    group, playerKey(player), player.hero, player.heroCode, player.weapon,
    player.hp, player.armor, Boolean(player.isSelf), Boolean(player.isTeammate),
    Boolean(player.hasC4), Boolean(player.missing),
    player.missing ? null : Math.round(player.x),
    player.missing ? null : Math.round(player.y),
    player.actor ?? null, player.res_id ?? null, player.camp ?? null,
    player.alive ?? null, player.positions ?? null, player.first_seen_ms ?? null,
    player.channel ?? null,
  ]);
}

function renderRoster(players) {
  const sorted = [...players].sort((a, b) => {
    const aGroup = a.isSelf ? 0 : (a.isTeammate ? 1 : 2);
    const bGroup = b.isSelf ? 0 : (b.isTeammate ? 1 : 2);
    return aGroup - bGroup || Number(a.missing) - Number(b.missing)
      || (a.actor || a.heroId) - (b.actor || b.heroId);
  });
  const allyCount = sorted.filter((player) => rosterGroup(player) === 'ally').length;
  const enemyCount = sorted.length - allyCount;

  document.querySelectorAll('.roster').forEach((host) => {
    const previous = rosterRenderCache.get(host) || [];
    const next = [];
    function append(signature, create) {
      const index = next.length;
      const old = previous[index];
      const node = old?.signature === signature ? old.node : create();
      const existing = host.children[index];
      if (existing !== node) {
        if (existing) host.replaceChild(node, existing);
        else host.append(node);
      }
      next.push({ signature, node });
    }
    let currentGroup = '';
    for (const player of sorted) {
      const group = rosterGroup(player);
      if (group !== currentGroup) {
        const count = group === 'ally' ? allyCount : enemyCount;
        append(`header:${group}:${count}`, () =>
          createRosterGroup(group === 'ally' ? '我方' : '敌方', count, group));
        currentGroup = group;
      }
      append(rosterRowSignature(player, group), () => createRosterRow(player, group));
    }
    while (host.children.length > next.length) host.lastElementChild.remove();
    rosterRenderCache.set(host, next);
  });
}

function updateSpikePanel() {
  if (!state.ui.showSpikeTimer || !state.spike || !state.spike.active || state.spike.remainingTime <= 0) {
    spikePanel.classList.add('hidden');
    return;
  }
  const s = state.spike;
  spikePanel.classList.remove('hidden');
  spikePanel.classList.toggle('urgent', s.remainingTime < 10);
  const time = s.remainingTime < 10 ? s.remainingTime.toFixed(1) : String(Math.floor(s.remainingTime));
  spikePanel.querySelector('.spike-time').textContent = time;
  spikePanel.querySelector('.spike-status').textContent =
    `${s.canDefuse ? '可拆' : '不可拆'}${s.defusing ? ' 拆除中' : ''}${s.halfDefuse ? ' 已半拆' : ''}`;
  spikePanel.querySelector('.spike-bar i').style.width = `${Math.round(clamp(s.progress, 0, 1) * 100)}%`;
}

// === Kill feed 浮层 ===
const killFeedRenderCache = new WeakMap();

function agentCodeFromRes(resId) {
  const a = agentFromResId(resId);
  return a ? a.code : '';
}

function agentDisplayFromRes(resId, actorFallback) {
  const a = agentFromResId(resId);
  return a ? a.display : (actorFallback ? `R${actorFallback}` : '未知');
}

function createKillFeedIcon(resId, actor, isTeam) {
  const code = agentCodeFromRes(resId);
  if (!code) {
    const span = document.createElement('span');
    span.className = 'kf-agent fallback';
    span.textContent = actor ? `R${actor}` : '?';
    return span;
  }
  const icon = getAgentIcon(code, isTeam);
  const img = document.createElement('img');
  img.src = icon?.src || '';
  img.alt = '';
  img.className = 'kf-agent';
  img.addEventListener('error', () => {
    const span = document.createElement('span');
    span.className = 'kf-agent fallback';
    span.textContent = agentDisplayFromRes(resId, actor).slice(0, 1);
    if (img.parentElement) img.parentElement.replaceChild(span, img);
  });
  return img;
}

function createKillFeedRow(ev) {
  const row = document.createElement('div');
  row.className = 'kf-row';
  const t = document.createElement('span');
  t.className = 'kf-time';
  if (Number.isFinite(ev.t_ms)) {
    const d = new Date(ev.t_ms);
    const pad = (n) => String(n).padStart(2, '0');
    t.textContent = `${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const killer = document.createElement('span');
  killer.className = 'kf-killer';
  killer.append(createKillFeedIcon(ev.killer_res, ev.killer_actor, true));
  const kName = document.createElement('span');
  kName.textContent = agentDisplayFromRes(ev.killer_res, ev.killer_actor);
  killer.append(kName);
  const arrow = document.createElement('span');
  arrow.className = 'kf-arrow';
  arrow.textContent = '▸';
  const victim = document.createElement('span');
  victim.className = 'kf-victim';
  victim.append(createKillFeedIcon(ev.victim_res, ev.victim_actor, false));
  const vName = document.createElement('span');
  vName.textContent = agentDisplayFromRes(ev.victim_res, ev.victim_actor);
  victim.append(vName);
  row.append(t, killer, arrow, victim);
  return row;
}

function renderKillFeed() {
  if (!killFeed) return;
  if (!state.ui.showKillFeed) { killFeed.replaceChildren(); killFeedRenderCache.delete(killFeed); return; }
  // 最近死亡在前(t_ms 倒序), 最多 KILL_FEED_MAX 条。
  const deaths = state.deaths.slice(-KILL_FEED_MAX).reverse();
  const previous = killFeedRenderCache.get(killFeed) || [];
  const next = [];
  function append(signature, create) {
    const index = next.length;
    const old = previous[index];
    const node = old?.signature === signature ? old.node : create();
    const existing = killFeed.children[index];
    if (existing !== node) {
      if (existing) killFeed.replaceChild(node, existing);
      else killFeed.append(node);
    }
    next.push({ signature, node });
  }
  for (const ev of deaths) {
    const sig = JSON.stringify([ev.t_ms, ev.victim_actor, ev.killer_actor, ev.victim_res, ev.killer_res]);
    append(sig, () => createKillFeedRow(ev));
  }
  while (killFeed.children.length > next.length) killFeed.lastElementChild.remove();
  killFeedRenderCache.set(killFeed, next);
}

// === 解码状态条 ===
function drawKeystreamSpark() {
  if (!keystreamSpark || !keystreamSpark.getContext) return;
  const sctx = keystreamSpark.getContext('2d');
  if (!sctx) return;
  const w = keystreamSpark.width || 120;
  const h = keystreamSpark.height || 24;
  sctx.clearRect(0, 0, w, h);
  const data = state.keystreamHistory;
  if (data.length < 2) return;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  sctx.strokeStyle = '#3be8c4';
  sctx.lineWidth = 1.4;
  sctx.beginPath();
  for (let i = 0; i < data.length; i += 1) {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((data[i] - min) / span) * (h - 2) - 1;
    if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
  }
  sctx.stroke();
}

function renderDecodeStatus(meta) {
  if (!meta) return;
  const s = meta.session || {};
  const d = meta.decode || {};
  if (decodeState) decodeState.textContent = SESSION_STATE_DISPLAY[s.state] || s.state || '—';
  if (decodeHost) decodeHost.textContent = state.hostOnline ? '在线' : '离线';
  if (decodeKeystream) decodeKeystream.textContent = String(s.keystream_bits ?? 0);
  if (decodeRatio) decodeRatio.textContent = `${Math.round((d.exact_ratio ?? 0) * 100)}%`;
  if (decodeChars) decodeChars.textContent = String(d.chars ?? 0);
  if (decodePps) decodePps.textContent = (Number.isFinite(d.pps_in) ? d.pps_in.toFixed(1) : '0');
  if (decodeGapResets) decodeGapResets.textContent = String(d.gap_resets ?? 0);
  if (decodeNotes) decodeNotes.textContent = (Array.isArray(d.notes) ? d.notes : []).join(' · ');
  if (state.ui.showDecode && statusBar) {
    statusBar.classList.toggle('decode-on', true);
  }
  drawKeystreamSpark();
}

// === 演示按钮: 直连房间 123456 看合成数据(demo-host-v4.js) ===
function connectDemo() {
  roomInput.value = '123456';
  serverInput.value = wsDefaultUrl();
  connect();
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
demoBtn?.addEventListener('click', connectDemo);
roomInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') connect();
});

setInterval(() => {
  state.fps = state.framesThisSecond;
  state.framesThisSecond = 0;
  frameText.textContent = `${state.fps} fps`;
  if (state.authed && performance.now() - state.lastFrameAt > 5000) {
    setStatus(state.hostOnline ? '等待 Host 数据' : 'Host 未在线', false);
  }
}, 1000);

loadUiSettings();
bindUiSettings();
bindShellControls();

// === 选地图 ===
// 手动选图只在当前标签页里记住(sessionStorage): 以前存 localStorage, 下一局换了图还会沿用上一局的。
// 入口有两个: 顶部的大按钮(点开选图面板)和设置里的下拉框, 走同一个 selectManualMap()。
const MAP_PICK_ORDER = [
  ['Ascent', 'Ascent'], ['Duality', 'Bind'], ['Port', 'Icebox'], ['Triad', 'Haven'], ['Bonsai', 'Split'],
  ['Foxtrot', 'Breeze'], ['Canyon', 'Fracture'], ['Rook', 'Corrode'], ['Pitt', 'Pearl'], ['Jam', 'Lotus'],
  ['Juliett', 'Sunset'], ['Abyss', 'Abyss'], ['Summit', 'Summit'],
];
const MANUAL_MAP_KEY = 'titan-radar-manual-map';
let mapGridBuilt = false;

function storedManualMap() {
  try { return sessionStorage.getItem(MANUAL_MAP_KEY) || ''; } catch (_) { return ''; }
}

function storeManualMap(code) {
  try {
    if (code) sessionStorage.setItem(MANUAL_MAP_KEY, code);
    else sessionStorage.removeItem(MANUAL_MAP_KEY);
  } catch (_) {}
}

function refreshMapPick() {
  const btn = document.getElementById('mapPickBtn');
  const nameEl = document.getElementById('mapPickName');
  if (!btn || !nameEl) return;
  const code = state.currentMap;
  const known = Boolean(code && MAP_DISPLAY[code]);
  let label = '选择地图';
  if (known) {
    label = MAP_DISPLAY[code];
    if (!state.manualMapCode) label += state.mapInference === '坐标判定' ? ' · 估计' : ' · 自动';
  }
  nameEl.textContent = label;
  // 还没确定 / 只是靠坐标猜的: 按钮呼吸提醒去选
  btn.classList.toggle('need', !known || (!state.manualMapCode && state.mapInference === '坐标判定'));
  syncMapSheetActive();
}

function syncMapSheetActive() {
  const grid = document.getElementById('mapGrid');
  if (grid) {
    for (const el of grid.children) el.classList.toggle('active', el.dataset.map === state.manualMapCode);
  }
  document.getElementById('mapAutoBtn')?.classList.toggle('active', !state.manualMapCode);
  const sel = document.getElementById('manualMapSelect');
  if (sel && sel.value !== state.manualMapCode) sel.value = state.manualMapCode;
}

function buildMapSheet() {
  if (mapGridBuilt) return;
  const grid = document.getElementById('mapGrid');
  if (!grid) return;
  mapGridBuilt = true;
  for (const [code, english] of MAP_PICK_ORDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-opt';
    btn.dataset.map = code;
    if (MAP_ASSETS[code]) btn.style.backgroundImage = `url("${MAP_ASSETS[code]}")`;
    const name = document.createElement('span');
    name.className = 'map-opt-name';
    name.textContent = MAP_DISPLAY[code] || code;
    const en = document.createElement('span');
    en.className = 'map-opt-en';
    en.textContent = english.toUpperCase();
    btn.append(name, en);
    btn.addEventListener('click', () => selectManualMap(code));
    grid.appendChild(btn);
  }
}

function openMapSheet() {
  const sheet = document.getElementById('mapSheet');
  if (!sheet) return;
  buildMapSheet();
  syncMapSheetActive();
  sheet.classList.remove('hidden');
}

function closeMapSheet() {
  document.getElementById('mapSheet')?.classList.add('hidden');
}

// code 为空 = 自动识别(清掉当前地图, 等下一帧 resolveFrameMap 重新判定)
function selectManualMap(code) {
  state.manualMapCode = code && MAP_ASSETS[code] ? code : '';
  storeManualMap(state.manualMapCode);
  if (state.manualMapCode) {
    loadMap(state.manualMapCode, { inferred: '手动' });
  } else {
    state.currentMap = '';
    loadMap('');
  }
  refreshMapPick();
  closeMapSheet();
}

// 退出雷达(回到进入页)时忘掉手动选的图: 下次进来很可能是另一局
function resetMapChoice() {
  state.manualMapCode = '';
  storeManualMap('');
  closeMapSheet();
  syncMapSheetActive();
}

// 刚进入雷达 1.5 秒后: 地图不是手选的、也不是包里的 mapId 给出的, 就弹出选图面板
function maybePromptMap() {
  if (!document.body.classList.contains('radar-live')) return;
  const fromPacket = state.currentMap && MAP_DISPLAY[state.currentMap] && state.mapInference === '';
  if (!state.manualMapCode && !fromPacket) openMapSheet();
}

(function initMapPicker() {
  state.manualMapCode = storedManualMap();
  try { localStorage.removeItem(MANUAL_MAP_KEY); } catch (_) {}   // 旧版本留下的永久选择: 清掉
  const sel = document.getElementById('manualMapSelect');
  if (sel) {
    sel.value = state.manualMapCode;
    sel.addEventListener('change', () => selectManualMap(sel.value));
  }
  if (state.manualMapCode && MAP_ASSETS[state.manualMapCode]) loadMap(state.manualMapCode, { inferred: '手动' });
  document.getElementById('mapPickBtn')?.addEventListener('click', openMapSheet);
  document.getElementById('mapSheetBackdrop')?.addEventListener('click', closeMapSheet);
  document.getElementById('mapAutoBtn')?.addEventListener('click', () => selectManualMap(''));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMapSheet(); });
  refreshMapPick();
})();

applyTheme(localStorage.getItem('titan-radar-theme') || 'dark');
applyConfig(state.config);
roomInput.value = parseRoomFromLocation() || localStorage.getItem('titan-radar-room') || '';
serverInput.value = parseRoomFromLocation()
  ? wsDefaultUrl()
  : (localStorage.getItem('titan-radar-server') || wsDefaultUrl());
syncServerMirror();
roomBadge.textContent = roomInput.value || '未连接';
if (decodeRoom) decodeRoom.textContent = roomInput.value || '—';
state.animRAF = requestAnimationFrame(render);
if (parseRoomFromLocation()) setTimeout(connect, 0);
