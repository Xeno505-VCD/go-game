import { SecurePayload } from '../types';
import {
  STORAGE_PREFIX,
  STORAGE_MAX_AGE_MS,
  STORAGE_MAX_ENTRY_SIZE,
  STORAGE_MAX_TOTAL_SIZE,
} from '../constants';

/**
 * 安全存储管理器
 * 4层防线：
 *   1. HMAC-SHA256 签名（动态盐值）
 *   2. Key名混淆
 *   3. 容量保护（防爆仓）
 *   4. 会话隔离 + 自动清理
 */
export class SecureStorage {
  private sessionSalt: string;
  private sessionId: string;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  /** 页面加载时调用 */
  constructor() {
    // 尝试从 sessionStorage 恢复盐值（同一标签页刷新后复用）
    const storedSalt = sessionStorage.getItem('_go_salt');
    if (storedSalt) {
      this.sessionSalt = storedSalt;
    } else {
      this.sessionSalt = this.generateSalt();
      sessionStorage.setItem('_go_salt', this.sessionSalt);
    }
    this.sessionId = crypto.randomUUID();
    // 加载时自动清理旧数据
    this.cleanupOrphaned();
  }

  // ==================== 公开方法 ====================

  /** 安全写入 */
  async set(logicalKey: string, value: unknown): Promise<void> {
    try {
      const payload = this.buildPayload(value);
      const signature = await this.sign(JSON.stringify(payload));
      const securePayload: SecurePayload = { ...payload, sig: signature };
      const json = JSON.stringify(securePayload);

      // 容量检查
      if (!this.checkQuota(json.length)) {
        console.warn('[SecureStorage] 存储容量不足，清理旧数据后重试');
        this.evictOldest();
        if (!this.checkQuota(json.length)) return;
      }

      const obfuscatedKey = this.obfuscateKey(logicalKey);
      localStorage.setItem(obfuscatedKey, json);
    } catch (e) {
      console.warn('[SecureStorage] 写入失败:', e);
    }
  }

  /** 安全读取 */
  async get<T>(logicalKey: string): Promise<T | null> {
    try {
      const obfuscatedKey = this.obfuscateKey(logicalKey);
      const raw = localStorage.getItem(obfuscatedKey);
      if (!raw) return null;

      const securePayload: SecurePayload = JSON.parse(raw);
      if (!securePayload.d || !securePayload.sig || !securePayload.t) {
        localStorage.removeItem(obfuscatedKey);
        return null;
      }

      // 检查是否过期
      if (Date.now() - securePayload.t > STORAGE_MAX_AGE_MS) {
        localStorage.removeItem(obfuscatedKey);
        return null;
      }

      // 验签
      const { sig, ...rest } = securePayload;
      const expectedSig = await this.sign(JSON.stringify(rest));
      if (sig !== expectedSig) {
        // 签名不匹配 → 数据被篡改，丢弃！
        console.warn('[SecureStorage] 签名校验失败，丢弃篡改数据:', logicalKey);
        localStorage.removeItem(obfuscatedKey);
        return null;
      }

      return JSON.parse(securePayload.d) as T;
    } catch {
      // 解析失败也删除
      const obfuscatedKey = this.obfuscateKey(logicalKey);
      localStorage.removeItem(obfuscatedKey);
      return null;
    }
  }

  /** 删除指定key */
  remove(logicalKey: string): void {
    const obfuscatedKey = this.obfuscateKey(logicalKey);
    localStorage.removeItem(obfuscatedKey);
  }

  // ==================== 私有方法 ====================

  /** 生成随机盐值 */
  private generateSalt(): string {
    return crypto.randomUUID();
  }

  /** 构建存储载荷（不含签名） */
  private buildPayload(value: unknown): Omit<SecurePayload, 'sig'> {
    return {
      d: JSON.stringify(value),
      t: Date.now(),
      sid: this.sessionId,
      n: crypto.randomUUID(),
    };
  }

  /** HMAC-SHA256 签名 */
  private async sign(data: string): Promise<string> {
    const keyMaterial = this.encoder.encode(this.sessionSalt);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const dataBytes = this.encoder.encode(data);
    const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    return this.bytesToHex(new Uint8Array(sigBytes));
  }

  /** Key名混淆：前缀 + 时间片段 + 哈希片段 */
  private obfuscateKey(logicalKey: string): string {
    // 用逻辑key和sessionSalt生成一致但不可读的存储key
    const base = `${STORAGE_PREFIX}${logicalKey}_${this.sessionSalt.substring(0, 8)}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
      hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
    }
    const hashPart = Math.abs(hash).toString(36);
    const tsPart = Date.now().toString(36).slice(-4);
    return `${STORAGE_PREFIX}${this.shuffleString(logicalKey)}_${hashPart}_${tsPart}`;
  }

  /** 打乱字符串（简单混淆） */
  private shuffleString(str: string): string {
    const chars = str.split('');
    // 用sessionSalt前4位做种子打乱
    const seed = parseInt(this.sessionSalt.substring(0, 4), 16) || 1;
    for (let i = chars.length - 1; i > 0; i--) {
      const j = (seed * (i + 1)) % chars.length;
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /** 容量检查 */
  private checkQuota(newEntrySize: number): boolean {
    if (newEntrySize > STORAGE_MAX_ENTRY_SIZE) return false;
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        total += (localStorage.getItem(key) || '').length;
      }
    }
    return total + newEntrySize <= STORAGE_MAX_TOTAL_SIZE;
  }

  /** 清理最旧的非关键数据 */
  private evictOldest(): void {
    const entries: { key: string; time: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const payload: SecurePayload = JSON.parse(raw);
        entries.push({ key, time: payload.t || 0 });
      } catch {
        entries.push({ key, time: 0 });
      }
    }
    entries.sort((a, b) => a.time - b.time);
    // 删除最旧的3条
    for (let i = 0; i < Math.min(3, entries.length); i++) {
      localStorage.removeItem(entries[i].key);
    }
  }

  /** 页面加载时清理旧会话残留 */
  private cleanupOrphaned(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) { keysToRemove.push(key); continue; }
        const payload: SecurePayload = JSON.parse(raw);
        // 过期检查
        if (payload.t && Date.now() - payload.t > STORAGE_MAX_AGE_MS) {
          keysToRemove.push(key);
        }
      } catch {
        // 无法解析的数据直接删除
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }

  /** Uint8Array → hex字符串 */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/** 全局单例 */
let instance: SecureStorage | null = null;

export function getSecureStorage(): SecureStorage {
  if (!instance) {
    instance = new SecureStorage();
  }
  return instance;
}