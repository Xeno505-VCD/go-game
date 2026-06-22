import { BOARD_SIZE } from '../constants';
import { ChessColor } from '../enums';
import type { BoardMatrix, CapturedGroup, Point, TerritoryResult } from '../types';

/**
 * 围棋规则引擎
 *
 * 核心能力：
 *   1. 连通块（Group）查找 — BFS
 *   2. 气（Liberty）计算 — 连通块周围的空位数
 *   3. 提子（Capture）判定 — 对方棋子气尽则提
 *   4. 劫（Ko）判定 — 防立即回提
 *   5. 合法落子检查 — 空位 + 非自杀 + 非劫
 *   6. 终局计目（Territory）— 领地归属 BFS
 */
export class GoJudge {
  /** 4个相邻方向（上下左右） */
  private static readonly NEIGHBORS: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  // ==================== 气（Liberty）计算 ====================

  /**
   * 获取指定连通块的全部棋子坐标
   */
  static getGroup(board: BoardMatrix, row: number, col: number): Point[] {
    const color = board[row][col];
    if (color === ChessColor.EMPTY) return [];

    const group: Point[] = [];
    const visited = new Set<string>();
    const queue: Point[] = [{ row, col }];
    const key = (r: number, c: number) => `${r},${c}`;
    visited.add(key(row, col));

    while (queue.length > 0) {
      const p = queue.pop()!;
      group.push(p);

      for (const [dr, dc] of GoJudge.NEIGHBORS) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        const nk = key(nr, nc);
        if (visited.has(nk)) continue;
        if (board[nr][nc] === color) {
          visited.add(nk);
          queue.push({ row: nr, col: nc });
        }
      }
    }
    return group;
  }

  /**
   * 计算连通块的气数
   * 气 = 连通块周围不同空位的数量
   */
  static countLiberties(board: BoardMatrix, group: Point[]): number {
    const liberties = new Set<string>();
    const key = (r: number, c: number) => `${r},${c}`;

    for (const p of group) {
      for (const [dr, dc] of GoJudge.NEIGHBORS) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (board[nr][nc] === ChessColor.EMPTY) {
          liberties.add(key(nr, nc));
        }
      }
    }
    return liberties.size;
  }

  /**
   * 获取指定位置连通块的气数（便捷方法）
   */
  static getLibertyCount(board: BoardMatrix, row: number, col: number): number {
    const group = GoJudge.getGroup(board, row, col);
    return GoJudge.countLiberties(board, group);
  }

  // ==================== 提子（Capture）判定 ====================

  /**
   * 落子后检查对方是否有棋子被提
   * @returns 被提的棋子坐标数组
   */
  static findCapturedGroups(
    board: BoardMatrix,
    opponentColor: ChessColor,
  ): CapturedGroup[] {
    const captured: CapturedGroup[] = [];
    const checked = new Set<string>();
    const key = (r: number, c: number) => `${r},${c}`;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== opponentColor || checked.has(key(r, c))) continue;

        const group = GoJudge.getGroup(board, r, c);
        // 标记已检查
        for (const p of group) checked.add(key(p.row, p.col));

        const liberties = GoJudge.countLiberties(board, group);
        if (liberties === 0) {
          captured.push({
            stones: group,
            color: opponentColor,
          });
        }
      }
    }
    return captured;
  }

  // ==================== 合法性检查 ====================

  /**
   * 检查落子是否合法
   * 规则：
   *   1. 不能落在已有棋子的交叉点上
   *   2. 不能自杀（落子后己方连通块无气，且不能提掉对方棋子）
   *   3. 不能违反劫规则（不能立即回提劫争点）
   */
  static isLegalMove(
    board: BoardMatrix,
    row: number,
    col: number,
    color: ChessColor,
    koPoint: Point | null,
  ): { legal: boolean; reason?: string } {
    // 1. 空位检查
    if (board[row][col] !== ChessColor.EMPTY) {
      return { legal: false, reason: '该位置已有棋子' };
    }

    // 2. 劫争检查
    if (koPoint && koPoint.row === row && koPoint.col === col) {
      return { legal: false, reason: '劫规则：不能立即回提' };
    }

    // 3. 模拟落子检查自杀规则
    const simulation = BoardSim.clone(board);
    simulation[row][col] = color;

    // 3a. 先检查是否提掉对方棋子
    const captured = GoJudge.findCapturedGroups(simulation, GoJudge.opponent(color));

    // 3b. 检查己方是否有气
    const myGroup = GoJudge.getGroup(simulation, row, col);
    const myLiberties = GoJudge.countLiberties(simulation, myGroup);

    if (myLiberties === 0 && captured.length === 0) {
      return { legal: false, reason: '自杀禁止：落子后己方无气' };
    }

    return { legal: true };
  }

  // ==================== 劫（Ko）判定 ====================

  /**
   * 检查是否形成劫争
   * 条件：
   *   1. 本次落子只提了1颗子
   *   2. 落子后棋盘状态与上一步完全一致
   *   3. 否则为null
   */
  static checkKo(
    board: BoardMatrix,
    previousBoard: BoardMatrix | null,
    move: Point,
    captured: CapturedGroup[],
  ): Point | null {
    if (!previousBoard) return null;

    // 只提了1颗子
    if (captured.length !== 1 || captured[0].stones.length !== 1) {
      return null;
    }

    // 检查提子后棋盘是否和上一步完全一致
    if (BoardSim.equals(board, previousBoard)) {
      // 劫争点 = 被提的那颗子的位置
      return captured[0].stones[0];
    }

    return null;
  }

  // ==================== 终局计目（Territory）====================

  /**
   * 计算领地归属（终局用）
   *
   * 算法：
   *   遍历所有空点 → BFS标记每个空区域
   *   → 检查区域边界颜色：
   *       全黑 → 黑方领地
   *       全白 → 白方领地
   *       混合 → 争议区（dame，不计）
   */
  static countTerritory(board: BoardMatrix): TerritoryResult {
    const territoryMap: number[][] = Array.from({ length: BOARD_SIZE }, () =>
      new Array(BOARD_SIZE).fill(0),
    );
    const visited = new Set<string>();
    const key = (r: number, c: number) => `${r},${c}`;
    let blackTerritory = 0;
    let whiteTerritory = 0;
    const damePoints: Point[] = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== ChessColor.EMPTY || visited.has(key(r, c))) continue;

        // BFS 收集空区域
        const region: Point[] = [];
        const boundaries = new Set<number>(); // 边界颜色集合
        const queue: Point[] = [{ row: r, col: c }];
        visited.add(key(r, c));

        while (queue.length > 0) {
          const p = queue.pop()!;
          region.push(p);

          for (const [dr, dc] of GoJudge.NEIGHBORS) {
            const nr = p.row + dr;
            const nc = p.col + dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
            const nk = key(nr, nc);

            if (board[nr][nc] === ChessColor.EMPTY) {
              if (!visited.has(nk)) {
                visited.add(nk);
                queue.push({ row: nr, col: nc });
              }
            } else {
              boundaries.add(board[nr][nc]);
            }
          }
        }

        // 判定区域归属
        let owner = 0;
        if (boundaries.size === 1) {
          if (boundaries.has(ChessColor.BLACK)) owner = 1;
          else if (boundaries.has(ChessColor.WHITE)) owner = 2;
        } else if (boundaries.size === 0) {
          owner = 3; // 孤岛空区（极其罕见）
        } else {
          owner = 3; // 争议区
        }

        for (const p of region) {
          territoryMap[p.row][p.col] = owner;
        }

        if (owner === 1) blackTerritory += region.length;
        else if (owner === 2) whiteTerritory += region.length;
        else {
          for (const p of region) damePoints.push(p);
        }
      }
    }

    return { black: blackTerritory, white: whiteTerritory, territoryMap, damePoints };
  }

  /** 获取对手颜色 */
  static opponent(color: ChessColor): ChessColor {
    return color === ChessColor.BLACK ? ChessColor.WHITE : ChessColor.BLACK;
  }

  /** 坐标是否在棋盘内 */
  static isInBounds(row: number, col: number): boolean {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }
}

/**
 * 棋盘模拟工具（纯函数，不修改原棋盘）
 */
class BoardSim {
  static clone(board: BoardMatrix): BoardMatrix {
    return board.map(row => [...row]);
  }

  static equals(a: BoardMatrix, b: BoardMatrix): boolean {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }
}