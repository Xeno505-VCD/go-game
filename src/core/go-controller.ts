import { DEFAULT_AI_LEVEL, KOMI } from '../constants';
import { AiLevel, ChessColor, GameMode, GamePhase, GameStatus } from '../enums';
import type { GameStats, GoMoveResult, Point, TerritoryResult, CapturedGroup } from '../types';
import { Board } from './board';
import { GoJudge } from './go-judge';

/**
 * 围棋游戏流程控制器
 * 编排落子 → 提子 → 劫判定 → Pass → 终局计目
 */
export class GoController {
  board: Board;
  currentPlayer: ChessColor = ChessColor.BLACK;
  gameMode: GameMode = GameMode.AI;
  aiLevel: AiLevel = DEFAULT_AI_LEVEL;
  status: GameStatus = GameStatus.PLAYING;
  lastCaptured: CapturedGroup[] = [];
  territoryResult: TerritoryResult | null = null;
  stats: GameStats = { total: 0, wins: 0, losses: 0, draws: 0, streak: 0, maxStreak: 0 };

  constructor() {
    this.board = new Board();
  }

  /** 切换模式并重开 */
  setMode(mode: GameMode): void {
    this.gameMode = mode;
    this.reset();
  }

  /** 设置AI难度 */
  setAiLevel(level: AiLevel): void {
    this.aiLevel = level;
  }

  /** 重置对局 */
  reset(): void {
    this.board.reset();
    this.currentPlayer = ChessColor.BLACK;
    this.status = GameStatus.PLAYING;
    this.lastCaptured = [];
    this.territoryResult = null;
  }

  /**
   * 执行落子（含完整围棋规则校验）
   * @returns 落子结果
   */
  placeStone(row: number, col: number): GoMoveResult {
    // 只能在PLAYING阶段落子
    if (this.board.gamePhase !== GamePhase.PLAYING) {
      return { legal: false, action: 'ILLEGAL', captured: [], koPoint: null, reason: '对局已结束' };
    }
    if (this.status === GameStatus.AI_THINKING) {
      return { legal: false, action: 'ILLEGAL', captured: [], koPoint: null, reason: 'AI 思考中' };
    }

    // 合法性检查
    const legality = GoJudge.isLegalMove(
      this.board.getGrid(),
      row,
      col,
      this.currentPlayer,
      this.board.koPoint,
    );
    if (!legality.legal) {
      return { legal: false, action: 'ILLEGAL', captured: [], koPoint: null, reason: legality.reason };
    }

    // 保存快照（用于劫判定）
    this.board.saveSnapshot();

    // 实际落子
    this.board.placeStone(row, col, this.currentPlayer);

    // 提走对方气尽的棋子
    this.lastCaptured = GoJudge.findCapturedGroups(
      this.board.getGrid(),
      GoJudge.opponent(this.currentPlayer),
    );
    let action: GoMoveResult['action'] = 'MOVE';
    for (const group of this.lastCaptured) {
      this.board.removeStones(group.stones, group.color);
      action = 'CAPTURE';
    }

    // 劫判定
    const koPoint = GoJudge.checkKo(
      this.board.getGrid(),
      this.board.getPreviousBoard(),
      { row, col },
      this.lastCaptured,
    );
    this.board.setKoPoint(koPoint);

    // 落子后重置 pass 计数
    this.board.resetPassCount();

    // 切换执棋方
    this.currentPlayer = this.currentPlayer === ChessColor.BLACK ? ChessColor.WHITE : ChessColor.BLACK;

    return {
      legal: true,
      action: koPoint ? 'KO' : action,
      captured: this.lastCaptured.flatMap(g => g.stones),
      koPoint,
    };
  }

  /**
   * 执行 Pass
   */
  pass(): { action: 'PASS' | 'SCORING' } {
    const phase = this.board.gamePhase;
    if (phase !== GamePhase.PLAYING) {
      return { action: 'PASS' };
    }

    this.board.doPass();
    this.lastCaptured = [];

    if (this.board.gamePhase === GamePhase.SCORING) {
      this.status = GameStatus.PLAYING;
      return { action: 'SCORING' };
    }

    this.currentPlayer = this.currentPlayer === ChessColor.BLACK ? ChessColor.WHITE : ChessColor.BLACK;
    return { action: 'PASS' };
  }

  /**
   * 进入计目阶段并计算结果
   */
  calculateScore(): TerritoryResult {
    const territory = GoJudge.countTerritory(this.board.getGrid());
    // 加上提子数
    territory.black += this.board.capturedWhite;  // 白方被提 = 黑方得分
    territory.white += this.board.capturedBlack;  // 黑方被提 = 白方得分
    // 贴目（黑方贴白方6.5）
    territory.white += KOMI;
    this.territoryResult = territory;
    this.board.setGamePhase(GamePhase.ENDED);
    return territory;
  }

  /**
   * 确认终局结果
   * @returns winner (null=平局)
   */
  finalize(): { winner: ChessColor | null; territory: TerritoryResult } {
    if (!this.territoryResult) {
      this.calculateScore();
    }
    const t = this.territoryResult!;
    this.status = t.black > t.white ? GameStatus.WIN : GameStatus.DRAW;
    // 围棋中白方胜率更高（因为有贴目），这里简单判定
    const winner = t.black > t.white ? ChessColor.BLACK :
                   t.white > t.black ? ChessColor.WHITE : null;

    return { winner, territory: t };
  }

  /** 认输 */
  surrender(): ChessColor {
    const winner = this.currentPlayer === ChessColor.BLACK ? ChessColor.WHITE : ChessColor.BLACK;
    this.status = GameStatus.DRAW; // 围棋中认输通常标记为中盘胜
    return winner;
  }

  /** 悔棋（人机撤回2步，双人撤回1步） */
  undo(): ChessColor {
    if (this.gameMode === GameMode.AI) {
      if (this.board.getHistory().length < 2) return this.currentPlayer;
      this.board.undo(2);
      this.currentPlayer = ChessColor.BLACK;
    } else {
      if (this.board.getHistory().length < 1) return this.currentPlayer;
      const removed = this.board.undo(1);
      this.currentPlayer = removed[0].color;
    }
    this.status = GameStatus.PLAYING;
    this.lastCaptured = [];
    this.board.setKoPoint(null);
    this.board.resetPassCount();
    return this.currentPlayer;
  }

  /** 获取对手颜色 */
  getOpponentColor(): ChessColor {
    return this.currentPlayer === ChessColor.BLACK ? ChessColor.WHITE : ChessColor.BLACK;
  }

  /** 更新战绩统计 */
  recordResult(result: 'win' | 'loss' | 'draw'): GameStats {
    this.stats.total++;
    if (result === 'win') {
      this.stats.wins++;
      this.stats.streak++;
      this.stats.maxStreak = Math.max(this.stats.maxStreak, this.stats.streak);
    } else if (result === 'loss') {
      this.stats.losses++;
      this.stats.streak = 0;
    } else {
      this.stats.draws++;
    }
    return { ...this.stats };
  }

  /** 设置战绩（从存储加载） */
  setStats(s: GameStats): void {
    this.stats = s;
  }
}