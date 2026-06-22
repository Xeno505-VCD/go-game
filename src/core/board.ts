import { BOARD_SIZE } from '../constants';
import { ChessColor, GamePhase } from '../enums';
import type { BoardMatrix, HistoryStep, Point } from '../types';

/**
 * 围棋棋盘状态管理器
 * 新增：气/劫/提子/计目 支持
 */
export class Board {
  private grid: BoardMatrix;
  private lastMove: Point | null = null;
  private moveHistory: HistoryStep[] = [];
  private previousBoard: BoardMatrix | null = null;
  private _koPoint: Point | null = null;
  private _capturedBlack = 0;  // 黑方被提子数
  private _capturedWhite = 0;  // 白方被提子数
  private _passCount = 0;
  private _gamePhase: GamePhase = GamePhase.PLAYING;

  constructor() {
    this.grid = this.createEmpty();
  }

  /** 创建空棋盘 */
  private createEmpty(): BoardMatrix {
    const grid: BoardMatrix = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      grid[r] = new Array(BOARD_SIZE).fill(ChessColor.EMPTY);
    }
    return grid;
  }

  /** 棋盘深拷贝 */
  static cloneGrid(grid: BoardMatrix): BoardMatrix {
    return grid.map(row => [...row]);
  }

  /** 重置棋盘 */
  reset(): void {
    this.grid = this.createEmpty();
    this.lastMove = null;
    this.moveHistory = [];
    this.previousBoard = null;
    this._koPoint = null;
    this._capturedBlack = 0;
    this._capturedWhite = 0;
    this._passCount = 0;
    this._gamePhase = GamePhase.PLAYING;
  }

  /** 获取棋盘数据（只读） */
  getGrid(): BoardMatrix {
    return this.grid;
  }

  /** 获取指定位置棋子 */
  get(row: number, col: number): ChessColor {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return ChessColor.EMPTY;
    return this.grid[row][col];
  }

  /** 保存当前棋盘快照（落子前调用） */
  saveSnapshot(): void {
    this.previousBoard = Board.cloneGrid(this.grid);
  }

  /** 落子（不包含规则校验，由 GoJudge 调用） */
  placeStone(row: number, col: number, color: ChessColor): void {
    this.grid[row][col] = color;
    this.lastMove = { row, col };
    this.moveHistory.push({ row, col, color });
  }

  /** 移除指定位置的棋子（提子用） */
  removeStones(points: Point[], capturedColor: ChessColor): void {
    for (const p of points) {
      this.grid[p.row][p.col] = ChessColor.EMPTY;
    }
    if (capturedColor === ChessColor.BLACK) {
      this._capturedBlack += points.length;
    } else if (capturedColor === ChessColor.WHITE) {
      this._capturedWhite += points.length;
    }
  }

  /** 获取最后落子位置 */
  getLastMove(): Point | null {
    return this.lastMove;
  }

  /** 获取落子历史 */
  getHistory(): HistoryStep[] {
    return this.moveHistory;
  }

  /** 获取上一步棋盘快照 */
  getPreviousBoard(): BoardMatrix | null {
    return this.previousBoard;
  }

  // ==================== 劫争 ====================

  /** 获取当前劫争点 */
  get koPoint(): Point | null {
    return this._koPoint;
  }

  /** 设置劫争点 */
  setKoPoint(point: Point | null): void {
    this._koPoint = point;
  }

  // ==================== 提子数 ====================

  get capturedBlack(): number {
    return this._capturedBlack;
  }

  get capturedWhite(): number {
    return this._capturedWhite;
  }

  // ==================== Pass + 游戏阶段 ====================

  get passCount(): number {
    return this._passCount;
  }

  /** 执行 pass */
  doPass(): void {
    this._passCount++;
    if (this._passCount >= 2) {
      this._gamePhase = GamePhase.SCORING;
    }
  }

  /** 重置 pass 计数 */
  resetPassCount(): void {
    this._passCount = 0;
  }

  get gamePhase(): GamePhase {
    return this._gamePhase;
  }

  setGamePhase(phase: GamePhase): void {
    this._gamePhase = phase;
  }

  /** 棋盘是否已满 */
  isFull(): boolean {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.grid[r][c] === ChessColor.EMPTY) return false;
      }
    }
    return true;
  }

  /** 获取所有空点 */
  getEmptyPoints(): Point[] {
    const points: Point[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.grid[r][c] === ChessColor.EMPTY) {
          points.push({ row: r, col: c });
        }
      }
    }
    return points;
  }

  /** 悔棋（移除最后n步） */
  undo(steps: number): HistoryStep[] {
    const removed: HistoryStep[] = [];
    for (let i = 0; i < steps && this.moveHistory.length > 0; i++) {
      const step = this.moveHistory.pop()!;
      this.grid[step.row][step.col] = ChessColor.EMPTY;
      removed.push(step);
    }
    this.lastMove = this.moveHistory.length > 0
      ? { row: this.moveHistory[this.moveHistory.length - 1].row, col: this.moveHistory[this.moveHistory.length - 1].col }
      : null;
    return removed;
  }

  /** 导入棋盘状态（联机同步） */
  importState(
    grid: BoardMatrix,
    history: HistoryStep[],
    capturedBlack = 0,
    capturedWhite = 0,
    koPoint: Point | null = null,
    passCount = 0,
    gamePhase: GamePhase = GamePhase.PLAYING,
  ): void {
    this.grid = grid;
    this.moveHistory = history;
    this.lastMove = history.length > 0
      ? { row: history[history.length - 1].row, col: history[history.length - 1].col }
      : null;
    this._capturedBlack = capturedBlack;
    this._capturedWhite = capturedWhite;
    this._koPoint = koPoint;
    this._passCount = passCount;
    this._gamePhase = gamePhase;
  }
}