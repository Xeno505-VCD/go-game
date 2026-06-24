// ==================== 棋盘常量 ====================
/** 标准19×19棋盘，可选 9, 13 */
export const BOARD_SIZE = 19;
/** 劫争记录上限 */
export const KO_POSITIONS_LIMIT = 1;
/** 双方连续 pass 上限 */
export const MAX_PASSES = 2;
/** 贴目（标准规则黑贴6.5目） */
export const KOMI = 6.5;

/** 星位坐标列表（19×19标准） */
export const STAR_POINTS: { row: number; col: number }[] = [
  { row: 3, col: 3 }, { row: 3, col: 9 }, { row: 3, col: 15 },
  { row: 9, col: 3 }, { row: 9, col: 9 }, { row: 9, col: 15 },
  { row: 15, col: 3 }, { row: 15, col: 9 }, { row: 15, col: 15 },
];

/** 支持的棋盘大小 */
export const BOARD_SIZE_OPTIONS = [9, 13, 19];

// ==================== 渲染颜色常量 ====================
export const BOARD_BG_COLOR = '#DEB887';
export const BOARD_LINE_COLOR = '#5D4037';
export const STONE_BLACK_COLOR = '#1a1a1a';
export const STONE_BLACK_HIGHLIGHT = '#555555';
export const STONE_WHITE_COLOR = '#F5F5F5';
export const STONE_WHITE_BORDER = '#BDBDBD';
export const STONE_WHITE_HIGHLIGHT = '#FFFFFF';
export const LAST_MOVE_MARKER = '#FF5722';
export const KO_MARKER_COLOR = '#FF9800';
export const TERRITORY_BLACK = 'rgba(30, 30, 30, 0.25)';
export const TERRITORY_WHITE = 'rgba(240, 240, 240, 0.35)';
export const CAPTURED_ANIM_COLOR = '#FF5252';
export const GHOST_STONE_ALPHA = 0.35;

// ==================== 布局常量 ====================
export const CANVAS_MAX_WIDTH = 900;
export const CANVAS_MAX_HEIGHT = 700;
export const STONE_RADIUS_RATIO = 0.44;
export const COORD_FONT_RATIO = 0.28;
export const MOBILE_WIDTH_THRESHOLD = 600;
export const BOARD_PADDING_RATIO = 0.06;

// ==================== AI常量 ====================
export const DEFAULT_AI_LEVEL = 2;

// ==================== 存储Key ====================
export const STORAGE_PREFIX = '_go_';
export const STORAGE_KEY_STATS = 'stats';
export const STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24小时
export const STORAGE_MAX_ENTRY_SIZE = 64 * 1024;       // 64KB
export const STORAGE_MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB

// ==================== 联机 ====================
export const WS_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'ws://localhost:3000'
    : 'https://go-game-ws.onrender.com'; // TODO: 在 Render 创建 Web Service 后替换为此地址
export const MOVE_TIMER_SECONDS = 30;

// ==================== WebRTC 语音 ====================
export const RTC_ICE_SERVERS: RTCIceServer[] = [
  // STUN 服务器
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // OpenRelay 免费 TURN（无需注册，测试用）
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];
