import { BOARD_SIZE } from '../constants';
import type { LayoutConfig, Point } from '../types';
import { getPixelX, getPixelY } from '../ui/layout';

/**
 * 鼠标/触摸输入处理器
 * 负责将屏幕坐标转换为棋盘坐标并触发回调
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private onClickCallback: ((point: Point) => void) | null = null;
  private currentLayout: LayoutConfig;

  constructor(canvas: HTMLCanvasElement, layout: LayoutConfig) {
    this.canvas = canvas;
    this.currentLayout = layout;
    this.bindEvents();
  }

  /** 更新布局（窗口resize时调用） */
  updateLayout(layout: LayoutConfig): void {
    this.currentLayout = layout;
  }

  /** 设置点击回调 */
  setOnClick(cb: (point: Point) => void): void {
    this.onClickCallback = cb;
  }

  /** 设置悬停回调（用于落子预览 Ghost Stone） */
  setOnHover(cb: (point: Point | null) => void): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      const px = (e.clientX - rect.left) * sx;
      const py = (e.clientY - rect.top) * sy;
      const layout = this.currentLayout;
      const col = Math.round((px - layout.boardX) / layout.cellSize);
      const row = Math.round((py - layout.boardY) / layout.cellSize);
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
        cb(null);
        return;
      }
      const cx = getPixelX(layout, col);
      const cy = getPixelY(layout, row);
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist > layout.cellSize * 0.45) {
        cb(null);
        return;
      }
      cb({ row, col });
    });
    this.canvas.addEventListener('mouseleave', () => {
      cb(null);
    });
  }

  private bindEvents(): void {
    // 鼠标点击
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      this.handleInput((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
    });

    // 触摸
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length > 1) return; // 忽略多指
      const t = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      this.handleInput((t.clientX - rect.left) * sx, (t.clientY - rect.top) * sy);
    }, { passive: false });
  }

  private handleInput(px: number, py: number): void {
    const layout = this.currentLayout;
    const col = Math.round((px - layout.boardX) / layout.cellSize);
    const row = Math.round((py - layout.boardY) / layout.cellSize);

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;

    // 距离检测：防止点到格子边缘误触
    const cx = getPixelX(layout, col);
    const cy = getPixelY(layout, row);
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (dist > layout.cellSize * 0.45) return;

    if (this.onClickCallback) {
      this.onClickCallback({ row, col });
    }
  }
}