import { ChessColor, GameMode, VoiceState } from '../enums';
import type { GameStats, TerritoryResult } from '../types';

/**
 * DOM面板管理器
 * 负责信息栏、侧面板按钮、模式弹窗、规则展开、反馈发送等全部UI交互
 */
export class Panel {
  // 信息栏
  currentTurnEl: HTMLElement;
  gameStatusEl: HTMLElement;
  timerBarEl: HTMLElement;
  aiHintEl: HTMLElement;
  rulesToggleEl: HTMLElement;
  rulesRowEl: HTMLElement;

  // 模式弹窗
  modeModalEl: HTMLElement;
  btnMode: HTMLButtonElement;
  modeLabelEl: HTMLElement;

  // 侧面板
  onlinePanelEl: HTMLElement;
  aiPanelEl: HTMLElement;
  roomInfoEl: HTMLElement;
  statsBarEl: HTMLElement;

  // 操作按钮
  btnSurrender: HTMLButtonElement;
  btnDraw: HTMLButtonElement;
  btnUndo: HTMLButtonElement;
  btnRematch: HTMLButtonElement;

  // 联机房间
  btnCreateRoom: HTMLButtonElement;
  btnJoinRoom: HTMLButtonElement;
  roomInput: HTMLInputElement;
  // 手机端房间号弹窗
  roomInputModalEl: HTMLElement;
  roomInputModalField: HTMLInputElement;

  // AI难度
  aiLevelSelect: HTMLSelectElement;

  // 反馈
  feedbackInput: HTMLTextAreaElement;
  feedbackHint: HTMLElement;

  // 回调
  private modeChangeCallbacks: ((mode: GameMode) => void)[] = [];
  private feedbackCallback: ((msg: string) => void) | null = null;

  constructor() {
    this.currentTurnEl = document.getElementById('currentTurn')!;
    this.gameStatusEl = document.getElementById('gameStatus')!;
    this.timerBarEl = document.getElementById('timerBar')!;
    this.aiHintEl = document.getElementById('aiHint')!;
    this.rulesToggleEl = document.getElementById('rulesToggle')!;
    this.rulesRowEl = document.getElementById('rulesRow')!;
    this.modeModalEl = document.getElementById('modeModal')!;
    this.btnMode = document.getElementById('btnMode') as HTMLButtonElement;
    this.modeLabelEl = document.getElementById('modeLabel')!;
    this.onlinePanelEl = document.getElementById('onlinePanel')!;
    this.aiPanelEl = document.getElementById('aiPanel')!;
    this.roomInfoEl = document.getElementById('roomInfo')!;
    this.statsBarEl = document.getElementById('statsBar')!;
    this.btnSurrender = document.getElementById('btnSurrender') as HTMLButtonElement;
    this.btnDraw = document.getElementById('btnDraw') as HTMLButtonElement;
    this.btnUndo = document.getElementById('btnUndo') as HTMLButtonElement;
    this.btnRematch = document.getElementById('btnRematch') as HTMLButtonElement;
    this.btnCreateRoom = document.getElementById('btnCreateRoom') as HTMLButtonElement;
    this.btnJoinRoom = document.getElementById('btnJoinRoom') as HTMLButtonElement;
    this.roomInput = document.getElementById('roomInput') as HTMLInputElement;
    this.roomInputModalEl = document.getElementById('roomInputModal')!;
    this.roomInputModalField = document.getElementById('roomInputModalField') as HTMLInputElement;
    this.aiLevelSelect = document.getElementById('aiLevel') as HTMLSelectElement;
    this.feedbackInput = document.getElementById('feedbackInput') as HTMLTextAreaElement;
    this.feedbackHint = document.getElementById('feedbackHint')!;
  }

  /** 初始化所有UI监听 */
  initAllListeners(
    onModeChange: (mode: GameMode) => void,
    onRematch: () => void,
    onSendFeedback: (msg: string) => void,
  ): void {
    this.onModeChange(onModeChange);

    // 模式按钮 → 打开弹窗
    this.btnMode.addEventListener('click', () => {
      this.modeModalEl.style.display = 'flex';
    });

    // 弹窗内三个模式选择
    document.getElementById('modeSelectPvp')!.addEventListener('click', () => {
      this.hideModeModal();
      this.fireModeChange(GameMode.PVP);
    });
    document.getElementById('modeSelectAi')!.addEventListener('click', () => {
      this.hideModeModal();
      this.fireModeChange(GameMode.AI);
    });
    document.getElementById('modeSelectOnline')!.addEventListener('click', () => {
      this.hideModeModal();
      this.fireModeChange(GameMode.ONLINE);
    });
    document.getElementById('modeModalCancel')!.addEventListener('click', () => {
      this.hideModeModal();
    });
    // 点击遮罩关闭
    document.getElementById('modeModalBg')!.addEventListener('click', () => {
      this.hideModeModal();
    });

    // 规则展开/收起
    this.rulesToggleEl.addEventListener('click', () => {
      this.rulesRowEl.style.display = this.rulesRowEl.style.display === 'none' ? 'block' : 'none';
    });

    // 再来一局按钮
    this.btnRematch.addEventListener('click', () => onRematch());

    // 反馈发送
    document.getElementById('btnFeedback')!.addEventListener('click', () => {
      const msg = this.feedbackInput.value.trim();
      if (!msg) return;
      onSendFeedback(msg);
    });
  }

  /** 绑定模式切换回调 */
  onModeChange(cb: (mode: GameMode) => void): void {
    this.modeChangeCallbacks.push(cb);
  }

  private fireModeChange(mode: GameMode): void {
    for (const cb of this.modeChangeCallbacks) cb(mode);
  }

  private hideModeModal(): void {
    this.modeModalEl.style.display = 'none';
  }

  /** 根据模式切换面板UI */
  showModeUI(mode: GameMode): void {
    this.hideModeModal();
    const modeLine = document.getElementById('modeLine');
    const btnDifficulty = document.getElementById('btnDifficulty');
    const btnJoinRoom = document.getElementById('btnJoinRoom');

    if (mode === GameMode.ONLINE) {
      // 联机：显示房间面板，隐藏难度/模式/重开按钮
      this.onlinePanelEl.style.display = 'flex';
      this.aiPanelEl.style.display = 'none';
      if (btnDifficulty) btnDifficulty.style.display = 'none';
      if (btnJoinRoom) btnJoinRoom.style.display = 'none';
      const restartBtn = document.getElementById('restartBtn');
      const btnMode = document.getElementById('btnMode');
      if (restartBtn) restartBtn.style.display = 'none';
      if (btnMode) btnMode.style.display = 'none';
      this.modeLabelEl.textContent = '联机对战';
      if (modeLine) modeLine.textContent = '联机对战';
    } else if (mode === GameMode.AI) {
      // 人机：显示难度按钮
      this.onlinePanelEl.style.display = 'none';
      this.aiPanelEl.style.display = 'block';
      if (btnDifficulty) btnDifficulty.style.display = '';
      if (btnJoinRoom) btnJoinRoom.style.display = '';
      this.modeLabelEl.textContent = '人机对战';
      this.aiLevelSelect.style.display = '';
      const diff = this.aiLevelSelect.options[this.aiLevelSelect.selectedIndex]?.text || '普通';
      if (modeLine) modeLine.textContent = `人机对战：(${diff})`;
    } else {
      // 双人：隐藏难度按钮
      this.onlinePanelEl.style.display = 'none';
      this.aiPanelEl.style.display = 'block';
      if (btnDifficulty) btnDifficulty.style.display = 'none';
      if (btnJoinRoom) btnJoinRoom.style.display = '';
      this.modeLabelEl.textContent = '双人对战';
      this.aiLevelSelect.style.display = 'none';
      if (modeLine) modeLine.textContent = '双人对战';
    }
    if (mode !== GameMode.ONLINE) {
      this.timerBarEl.style.display = 'none';
    }
  }

  // ==================== 信息栏更新 ====================

  updateTurn(color: ChessColor): void {
    this.currentTurnEl.textContent = color === ChessColor.BLACK ? '黑棋' : '白棋';
  }

  updateStatus(text: string): void {
    this.gameStatusEl.textContent = text;
  }

  updateHint(text: string): void {
    this.aiHintEl.textContent = text;
  }

  updateStats(stats: GameStats): void {
    this.statsBarEl.textContent =
      `总局:${stats.total} 胜:${stats.wins} 负:${stats.losses} 和:${stats.draws} | 连胜:${stats.streak}(${stats.maxStreak}场最佳)`;
  }

  updateRoomInfo(text: string): void {
    this.roomInfoEl.textContent = text;
    const row = document.getElementById('roomInfoRow');
    if (row) row.style.display = text ? '' : 'none';
  }

  // ==================== 按钮状态 ====================

  setButtonsEnabled(enabled: boolean): void {
    this.btnSurrender.disabled = !enabled;
    this.btnDraw.disabled = !enabled;
    this.btnUndo.disabled = !enabled;
  }

  /** 联机对局结束：隐藏操作按钮，显示再来一局 */
  showRematchButton(): void {
    this.btnSurrender.style.display = 'none';
    this.btnDraw.style.display = 'none';
    this.btnUndo.style.display = 'none';
    this.btnRematch.style.display = '';
  }

  /** 重置为正常操作按钮 */
  hideRematchButton(): void {
    this.btnSurrender.style.display = '';
    this.btnDraw.style.display = '';
    this.btnUndo.style.display = '';
    this.btnRematch.style.display = 'none';
  }

  // ==================== 计时器 ====================

  showTimer(seconds: number): void {
    this.timerBarEl.style.display = 'inline';
    this.timerBarEl.textContent = `⏱ ${seconds}s`;
  }

  hideTimer(): void {
    this.timerBarEl.style.display = 'none';
  }

  updateTimer(seconds: number): void {
    this.timerBarEl.textContent = `⏱ ${seconds}s`;
  }

  // ==================== 反馈 ====================

  showFeedbackSent(): void {
    this.feedbackHint.style.display = 'block';
    this.feedbackHint.textContent = '已发送，谢谢！';
    this.feedbackInput.value = '';
    setTimeout(() => {
      this.feedbackHint.style.display = 'none';
    }, 3000);
  }

  showFeedbackError(): void {
    this.feedbackHint.style.display = 'block';
    this.feedbackHint.textContent = '发送失败，请重试';
    setTimeout(() => {
      this.feedbackHint.style.display = 'none';
    }, 3000);
  }

  // ==================== 获取值 ====================

  getAiLevel(): number {
    return parseInt(this.aiLevelSelect.value);
  }

  getRoomInput(): string {
    return this.roomInput.value;
  }

  static randomRoomId(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // ==================== 围棋专用 ====================

  /** 更新提子数显示 */
  updateCaptured(black: number, white: number): void {
    const el = document.getElementById('capturedCount');
    if (el) el.textContent = `提子 黑:${black} 白:${white}`;
  }

  /** 更新领地计目结果显示 */
  updateTerritory(territory: TerritoryResult): void {
    const el = document.getElementById('territoryResult');
    if (el) el.textContent = `领地 黑:${territory.black.toFixed(1)} 白:${territory.white.toFixed(1)}`;
  }

  // ==================== 语音状态 ====================

  /** 更新语音通话状态 */
  updateVoiceState(state: VoiceState): void {
    const el = document.getElementById('voiceState');
    if (!el) return;
    const labels: Record<VoiceState, string> = {
      [VoiceState.DISCONNECTED]: '🎤 未连接',
      [VoiceState.CONNECTING]: '🎤 连接中...',
      [VoiceState.CONNECTED]: '🎤 通话中',
      [VoiceState.MUTED]: '🔇 已静音',
      [VoiceState.ERROR]: '🎤 语音错误',
    };
    el.textContent = labels[state] || '';
  }

  /** 更新音量指示器 */
  updateVoiceVolume(_channel: 'local' | 'remote', _level: number): void {
    // 简化版：仅在控制台输出音量，完整版需要 Canvas 可视化
  }
}
