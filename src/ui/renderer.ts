import {
  BOARD_BG_COLOR,
  BOARD_LINE_COLOR,
  BOARD_SIZE,
  COORD_FONT_RATIO,
  GHOST_STONE_ALPHA,
  KO_MARKER_COLOR,
  LAST_MOVE_MARKER,
  STAR_POINTS,
  STONE_BLACK_COLOR,
  STONE_BLACK_HIGHLIGHT,
  STONE_WHITE_BORDER,
  STONE_WHITE_COLOR,
  STONE_WHITE_HIGHLIGHT,
  TERRITORY_BLACK,
  TERRITORY_WHITE,
} from '../constants';
import { ChessColor } from '../enums';
import type { BoardMatrix, LayoutConfig, Point, TerritoryResult } from '../types';
import { getPixelX, getPixelY } from './layout';

/**
 * Canvas 2D 围棋渲染器
 * 支持：19×19棋盘、坐标标签、领地覆盖层、劫标记、落子预览
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: LayoutConfig;
  /** Ghost stone 落子预览 */
  private ghostStone: Point | null = null;

  constructor(ctx: CanvasRenderingContext2D, layout: LayoutConfig) {
    this.ctx = ctx;
    this.layout = layout;
  }

  updateLayout(layout: LayoutConfig): void {
    this.layout = layout;
  }

  /** 设置落子预览位置 */
  setGhostStone(point: Point | null): void {
    this.ghostStone = point;
  }

  /** 完整绘制一帧 */
  draw(
    board: BoardMatrix,
    lastMove: Point | null,
    koPoint: Point | null,
    territory: TerritoryResult | null,
  ): void {
    const { ctx, layout } = this;
    const { canvasWidth: W, canvasHeight: H } = layout;

    ctx.clearRect(0, 0, W, H);
    this.drawBoard();
    this.drawCoordinates();
    if (territory) this.drawTerritoryOverlay(territory);
    this.drawStones(board);
    if (lastMove) this.drawLastMarker(lastMove);
    if (koPoint) this.drawKoMarker(koPoint);
    if (this.ghostStone) this.drawGhostStone();
  }

  // ==================== 棋盘绘制 ====================

  private drawBoard(): void {
    const { ctx, layout } = this;
    const { boardX, boardY, cellSize } = layout;
    const boardPixelSize = cellSize * (BOARD_SIZE - 1);

    // 背景（带圆角和阴影）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = BOARD_BG_COLOR;
    const padding = cellSize * 0.5;
    ctx.fillRect(
      boardX - padding,
      boardY - padding,
      boardPixelSize + padding * 2,
      boardPixelSize + padding * 2,
    );
    ctx.restore();

    // 网格线
    ctx.strokeStyle = BOARD_LINE_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const x = getPixelX(layout, i);
      const y = getPixelY(layout, i);
      ctx.beginPath();
      ctx.moveTo(getPixelX(layout, 0), y);
      ctx.lineTo(getPixelX(layout, BOARD_SIZE - 1), y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, getPixelY(layout, 0));
      ctx.lineTo(x, getPixelY(layout, BOARD_SIZE - 1));
      ctx.stroke();
    }

    // 星位
    ctx.fillStyle = BOARD_LINE_COLOR;
    for (const { row, col } of STAR_POINTS) {
      if (row >= BOARD_SIZE || col >= BOARD_SIZE) continue;
      ctx.beginPath();
      ctx.arc(
        getPixelX(layout, col),
        getPixelY(layout, row),
        Math.max(2, cellSize * 0.08),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // ==================== 坐标标签 ====================

  private drawCoordinates(): void {
    const { ctx, layout } = this;
    const { boardX, boardY, cellSize } = layout;
    const fontSize = Math.max(9, cellSize * COORD_FONT_RATIO);

    ctx.fillStyle = BOARD_LINE_COLOR;
    ctx.font = `${fontSize}px 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 列坐标（A-T，跳过 I）
    const colLabels = 'ABCDEFGHJKLMNOPQRST';
    for (let c = 0; c < BOARD_SIZE && c < colLabels.length; c++) {
      const x = getPixelX(layout, c);
      ctx.fillText(colLabels[c], x, boardY - cellSize * 0.65);
      ctx.fillText(colLabels[c], x, boardY + (BOARD_SIZE - 1) * cellSize + cellSize * 0.65);
    }

    // 行坐标（1-19）
    ctx.textAlign = 'right';
    for (let r = 0; r < BOARD_SIZE; r++) {
      const y = getPixelY(layout, r);
      const label = String(BOARD_SIZE - r);
      ctx.fillText(label, boardX - cellSize * 0.60, y);
    }
    ctx.textAlign = 'left';
    for (let r = 0; r < BOARD_SIZE; r++) {
      const y = getPixelY(layout, r);
      const label = String(BOARD_SIZE - r);
      ctx.fillText(label, boardX + (BOARD_SIZE - 1) * cellSize + cellSize * 0.60, y);
    }
  }

  // ==================== 棋子绘制 ====================

  private drawStones(board: BoardMatrix): void {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === ChessColor.EMPTY) continue;
        this.drawStone(r, c, board[r][c]);
      }
    }
  }

  private drawStone(row: number, col: number, color: ChessColor): void {
    const { ctx, layout } = this;
    const x = getPixelX(layout, col);
    const y = getPixelY(layout, row);
    const r = layout.stoneRadius;

    ctx.save();
    if (color === ChessColor.BLACK) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, STONE_BLACK_HIGHLIGHT);
      g.addColorStop(1, STONE_BLACK_COLOR);
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, STONE_WHITE_HIGHLIGHT);
      g.addColorStop(1, '#D6D6D6');
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (color === ChessColor.WHITE) {
      ctx.strokeStyle = STONE_WHITE_BORDER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==================== 标记绘制 ====================

  private drawLastMarker(move: Point): void {
    const { ctx, layout } = this;
    const x = getPixelX(layout, move.col);
    const y = getPixelY(layout, move.row);
    ctx.fillStyle = LAST_MOVE_MARKER;
    ctx.beginPath();
    ctx.arc(x, y, layout.stoneRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawKoMarker(koPoint: Point): void {
    const { ctx, layout } = this;
    const x = getPixelX(layout, koPoint.col);
    const y = getPixelY(layout, koPoint.row);
    const s = layout.stoneRadius * 0.55;
    ctx.strokeStyle = KO_MARKER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  }

  private drawGhostStone(): void {
    if (!this.ghostStone) return;
    const { ctx, layout } = this;
    const { row, col } = this.ghostStone;
    const x = getPixelX(layout, col);
    const y = getPixelY(layout, row);
    const r = layout.stoneRadius;

    ctx.save();
    ctx.globalAlpha = GHOST_STONE_ALPHA;
    ctx.fillStyle = '#666666';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ==================== 领地覆盖层 ====================

  private drawTerritoryOverlay(territory: TerritoryResult): void {
    const { ctx, layout } = this;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const owner = territory.territoryMap[r][c];
        if (owner === 0 || owner === 3) continue; // 跳过无归属和争议区
        const x = getPixelX(layout, c);
        const y = getPixelY(layout, r);
        const s = layout.cellSize * 0.85;

        ctx.fillStyle = owner === 1 ? TERRITORY_BLACK : TERRITORY_WHITE;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
  }
}