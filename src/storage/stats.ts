import type { GameStats } from '../types';
import { getSecureStorage } from './secure-storage';
import { STORAGE_KEY_STATS } from '../constants';

/**
 * 安全战绩持久化
 * 使用 SecureStorage 防篡改
 */
export class StatsStorage {
  private static defaults: GameStats = {
    total: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    maxStreak: 0,
  };

  /** 加载战绩（异步验签） */
  static async load(): Promise<GameStats> {
    const ss = getSecureStorage();
    const stored = await ss.get<GameStats>(STORAGE_KEY_STATS);
    if (!stored) return { ...StatsStorage.defaults };
    // 字段完整性校验
    return {
      total: stored.total ?? 0,
      wins: stored.wins ?? 0,
      losses: stored.losses ?? 0,
      draws: stored.draws ?? 0,
      streak: stored.streak ?? 0,
      maxStreak: stored.maxStreak ?? 0,
    };
  }

  /** 保存战绩（异步签名） */
  static async save(stats: GameStats): Promise<void> {
    const ss = getSecureStorage();
    await ss.set(STORAGE_KEY_STATS, stats);
  }
}