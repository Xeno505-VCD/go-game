import {
  BOARD_PADDING_RATIO,
  BOARD_SIZE,
  CANVAS_MAX_HEIGHT,
  CANVAS_MAX_WIDTH,
  MOBILE_WIDTH_THRESHOLD,
  STONE_RADIUS_RATIO,
} from '../constants';
import type { LayoutConfig } from '../types';

/**
 * 响应式布局计算器
 * 根据窗口尺寸计算棋盘各元素位置（自适应 9/13/19 棋盘大小）
 */
export function calculateLayout(): LayoutConfig {
  const isMobile = window.innerWidth <= MOBILE_WIDTH_THRESHOLD;
  const W = Math.min(window.innerWidth - 20, CANVAS_MAX_WIDTH);
  const H = Math.min(window.innerHeight - 160, isMobile ? 650 : CANVAS_MAX_HEIGHT);
  const usableW = W;
  const usableH = H;
  const boardAreaW = usableW * (isMobile ? 0.92 : 0.78);
  const maxBoard = Math.min(boardAreaW, usableH);
  const padding = Math.max(maxBoard * BOARD_PADDING_RATIO, 12);
  const boardSize = maxBoard - padding * 2;
  const cellSize = boardSize / (BOARD_SIZE - 1); // 19格线间距 = 18份
  const stoneRadius = cellSize * STONE_RADIUS_RATIO;

  // 手机端：Canvas像素正方形，刚好包含棋盘 + 边距
  let canvasW = W;
  let canvasH = H;
  let boardX = (W - boardSize) / 2;
  let boardY = padding;
  if (isMobile) {
    const boardPixels = Math.round(cellSize * (BOARD_SIZE + 1)); // 加边距
    canvasW = boardPixels;
    canvasH = boardPixels;
    boardX = cellSize;
    boardY = cellSize;
  }

  return {
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    boardX,
    boardY,
    cellSize,
    stoneRadius,
  };
}

/** 根据布局和棋盘坐标计算Canvas像素坐标 */
export function getPixelX(layout: LayoutConfig, col: number): number {
  return layout.boardX + col * layout.cellSize;
}

export function getPixelY(layout: LayoutConfig, row: number): number {
  return layout.boardY + row * layout.cellSize;
}