import { AiLevel, ChessColor, GameMode, GameStatus, PlayerRole } from './enums';

/** 棋盘坐标 */
export interface Point {
  row: number;
  col: number;
}

/** 棋盘二维数组，0=空 1=黑 2=白 */
export type BoardMatrix = ChessColor[][];

/** 围棋落子结果 */
export interface GoMoveResult {
  /** 是否合法 */
  legal: boolean;
  /** 落子后执行的操作 */
  action: 'MOVE' | 'CAPTURE' | 'ILLEGAL' | 'KO';
  /** 被提走的棋子坐标列表 */
  captured: Point[];
  /** 当前劫争点（不能立即回提的位置） */
  koPoint: Point | null;
  /** 非法原因 */
  reason?: string;
}

/** 被提棋子组 */
export interface CapturedGroup {
  stones: Point[];
  color: ChessColor;
}

/** 领地计算结果 */
export interface TerritoryResult {
  /** 黑方目数（领地+提子） */
  black: number;
  /** 白方目数（领地+提子） */
  white: number;
  /** 领地归属图：0=未知 1=黑 2=白 3=争议 */
  territoryMap: number[][];
  /** 争议点列表 */
  damePoints: Point[];
}

/** 棋谱树节点 */
export interface MoveNode {
  row: number;
  col: number;
  color: ChessColor;
  children: MoveNode[];
}

/** AI配置参数 */
export interface AiConfig {
  level: AiLevel;
  searchDepth: number;
  mistakeRate: number;
  attackWeight: number;
  defenseWeight: number;
  useOpeningBook: boolean;
}

/** 棋型打分结果 */
export interface ChessScore {
  point: Point;
  score: number;
}

/** 落子历史记录 */
export interface HistoryStep {
  row: number;
  col: number;
  color: ChessColor;
}

/** 对局数据统计 */
export interface GameStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  maxStreak: number;
}

/** 布局尺寸配置 */
export interface LayoutConfig {
  canvasWidth: number;
  canvasHeight: number;
  boardX: number;
  boardY: number;
  cellSize: number;
  stoneRadius: number;
}

/** 联机WebSocket消息 */
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

/** 安全存储载荷 */
export interface SecurePayload {
  /** 实际数据（JSON字符串） */
  d: string;
  /** 写入时间戳 */
  t: number;
  /** 会话ID */
  sid: string;
  /** 随机nonce */
  n: string;
  /** HMAC-SHA256签名（hex） */
  sig: string;
}