import { MOVE_TIMER_SECONDS } from '../constants';

/**
 * 落子倒计时器
 * 联机模式下30秒超时
 */
export class MoveTimer {
  private remaining = MOVE_TIMER_SECONDS;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onTick: ((s: number) => void) | null = null;
  private onTimeout: (() => void) | null = null;

  /** 设置每秒回调 */
  setOnTick(cb: (seconds: number) => void): void {
    this.onTick = cb;
  }

  /** 设置超时回调 */
  setOnTimeout(cb: () => void): void {
    this.onTimeout = cb;
  }

  /** 开始计时 */
  start(): void {
    this.stop();
    this.remaining = MOVE_TIMER_SECONDS;
    this.onTick?.(this.remaining);
    this.interval = setInterval(() => {
      this.remaining--;
      this.onTick?.(this.remaining);
      if (this.remaining <= 0) {
        this.stop();
        this.onTimeout?.();
      }
    }, 1000);
  }

  /** 重置计时（每次落子后调用） */
  reset(): void {
    this.stop();
    this.remaining = MOVE_TIMER_SECONDS;
    this.onTick?.(this.remaining);
    this.interval = setInterval(() => {
      this.remaining--;
      this.onTick?.(this.remaining);
      if (this.remaining <= 0) {
        this.stop();
        this.onTimeout?.();
      }
    }, 1000);
  }

  /** 停止计时 */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}