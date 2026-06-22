/** 对局模式 */
export enum GameMode {
  /** 人机单机 */
  AI = 'ai',
  /** 本地双人同屏 */
  PVP = 'pvp',
  /** 在线联机 */
  ONLINE = 'online',
}

/** AI难度等级（数值映射到 select option value） */
export enum AiLevel {
  NOVICE = 0,
  EASY = 1,
  MEDIUM = 2,
  HARD = 3,
  MASTER = 4,
}

/** 对局状态 */
export enum GameStatus {
  /** 对局进行中 */
  PLAYING = 'PLAYING',
  /** AI思考中 */
  AI_THINKING = 'AI_THINKING',
  /** 等待对方确认（和棋/悔棋申请中） */
  WAIT_CONFIRM = 'WAIT_CONFIRM',
  /** 胜利 */
  WIN = 'WIN',
  /** 和棋 */
  DRAW = 'DRAW',
}

/** 棋子颜色 */
export enum ChessColor {
  EMPTY = 0,
  BLACK = 1,
  WHITE = 2,
}

/** 玩家角色 */
export enum PlayerRole {
  BLACK = 'BLACK',
  WHITE = 'WHITE',
}

/** 游戏阶段 */
export enum GamePhase {
  /** 对弈中 */
  PLAYING = 'PLAYING',
  /** 计目阶段 */
  SCORING = 'SCORING',
  /** 对局结束 */
  ENDED = 'ENDED',
}

/** 语音通话状态 */
export enum VoiceState {
  /** 未连接 */
  DISCONNECTED = 'DISCONNECTED',
  /** 连接中（信令交换） */
  CONNECTING = 'CONNECTING',
  /** 通话中 */
  CONNECTED = 'CONNECTED',
  /** 已静音 */
  MUTED = 'MUTED',
  /** 错误 */
  ERROR = 'ERROR',
}
