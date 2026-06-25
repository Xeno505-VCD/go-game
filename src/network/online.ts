import { WS_URL, MOVE_TIMER_SECONDS } from '../constants';
import { ChessColor, GameStatus } from '../enums';
import type { BoardMatrix, HistoryStep, Point, WsMessage } from '../types';

/**
 * 联机对局事件回调
 */
export interface OnlineCallbacks {
  /** 分配到颜色 */
  onAssign: (color: ChessColor) => void;
  /** 等待对手 */
  onWaiting: (msg: string) => void;
  /** 对局开始 */
  onGameStart: (board: BoardMatrix, currentPlayer: ChessColor) => void;
  /** 对方落子（服务器确认） */
  onMove: (row: number, col: number, color: ChessColor, currentPlayer: ChessColor) => void;
  /** 对局结束 */
  onGameOver: (winner: ChessColor | null, winLine: Point[], reason?: string) => void;
  /** 和棋申请 */
  onDrawRequest: () => void;
  /** 和棋被拒 */
  onDrawRejected: () => void;
  /** 悔棋申请 */
  onUndoRequest: () => void;
  /** 悔棋被拒 */
  onUndoRejected: () => void;
  /** 悔棋已执行 */
  onUndoExecuted: (board: BoardMatrix, currentPlayer: ChessColor, moves: HistoryStep[]) => void;
  /** 对手离开 */
  onOpponentLeft: () => void;
  /** 连接断开 */
  onDisconnect: () => void;
  /** 倒计时开始 */
  onTimerStart: () => void;
  /** 倒计时重置 */
  onTimerReset: () => void;
  /** 倒计时停止 */
  onTimerStop: () => void;
  /** 再来一局：收到申请 */
  onRematchRequest: () => void;
  /** 再来一局：被拒 */
  onRematchRejected: () => void;
  /** 再来一局：开始 */
  onRematchStart: () => void;
  /** PASS结果 */
  onPass: (currentPlayer: ChessColor, action: 'PASS' | 'SCORING') => void;
  // 语音信令回调
  /** 收到语音信令（simple-peer signal data） */
  onVoiceSignal?: (data: unknown) => Promise<void>;
  /** 对方挂断 */
  onVoiceHangup?: () => void;
  /** 对方静音状态变更 */
  onVoiceMute?: (muted: boolean) => void;
}

/**
 * 联机WebSocket管理器
 */
export class OnlineManager {
  private ws: WebSocket | null = null;
  private roomId = '';
  private myColor: ChessColor = ChessColor.EMPTY;
  private callbacks: OnlineCallbacks | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  setCallbacks(cbs: OnlineCallbacks): void {
    this.callbacks = cbs;
  }

  createRoom(): string {
    this.roomId = String(Math.floor(1000 + Math.random() * 9000));
    this.connect();
    return this.roomId;
  }

  joinRoom(roomId: string): void {
    this.roomId = roomId;
    this.connect();
  }

  getRoomId(): string {
    return this.roomId;
  }

  getMyColor(): ChessColor {
    return this.myColor;
  }

  sendMove(row: number, col: number): void {
    this.send({ type: 'MOVE', row, col });
  }

  sendPass(): void {
    this.send({ type: 'PASS' });
  }

  sendSurrender(): void {
    this.send({ type: 'SURRENDER' });
  }

  sendDrawRequest(): void {
    this.send({ type: 'DRAW_REQUEST' });
  }

  sendDrawResponse(accept: boolean): void {
    this.send({ type: 'DRAW_RESPONSE', accept });
  }

  sendUndoRequest(): void {
    this.send({ type: 'UNDO_REQUEST' });
  }

  sendUndoResponse(accept: boolean): void {
    this.send({ type: 'UNDO_RESPONSE', accept });
  }

  sendRematchRequest(): void {
    this.send({ type: 'REMATCH_REQUEST' });
  }

  sendRematchResponse(accept: boolean): void {
    this.send({ type: 'REMATCH_RESPONSE', accept });
  }

  /** 发送任意消息（供语音信令等扩展使用） */
  sendRaw(data: Record<string, unknown>): void {
    this.send(data);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
  }

  private connect(): void {
    this.intentionalClose = false;
    this.cleanup();
    const wsUrl = WS_URL.replace('https', 'wss') + '/join?room=' + this.roomId;
    if (wsUrl.startsWith('ws://')) {
      this.ws = new WebSocket('ws://localhost:3000/join?room=' + this.roomId);
    } else {
      this.ws = new WebSocket(wsUrl);
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.callbacks?.onTimerStop();
    };

    this.ws.onmessage = async (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        await this.handleMessage(msg);
      } catch (e) { console.error('[Online] 消息处理失败:', e); }
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (!this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      } else {
        this.callbacks?.onDisconnect();
      }
    };

    this.startPing();
  }

  private async handleMessage(msg: WsMessage): Promise<void> {
    const cb = this.callbacks;
    if (!cb) return;

    switch (msg.type) {
      case 'ASSIGN':
        this.myColor = msg.color as ChessColor;
        cb.onAssign(this.myColor);
        break;
      case 'WAITING':
        cb.onWaiting(msg.msg as string);
        break;
      case 'GAME_START':
        cb.onGameStart(
          (msg.board as BoardMatrix) || [],
          (msg.currentPlayer as ChessColor) || ChessColor.BLACK,
        );
        cb.onTimerStart();
        break;
      case 'MOVE':
        cb.onMove(
          msg.row as number,
          msg.col as number,
          msg.color as ChessColor,
          msg.currentPlayer as ChessColor,
        );
        cb.onTimerReset();
        break;
      case 'GAME_OVER':
        cb.onGameOver(
          (msg.winner as ChessColor) || null,
          (msg.winLine as Point[]) || [],
          msg.reason as string | undefined,
        );
        cb.onTimerStop();
        break;
      case 'DRAW_REQUEST':
        cb.onDrawRequest();
        break;
      case 'DRAW_REJECTED':
        cb.onDrawRejected();
        break;
      case 'UNDO_REQUEST':
        cb.onUndoRequest();
        break;
      case 'UNDO_REJECTED':
        cb.onUndoRejected();
        break;
      case 'UNDO_EXECUTED':
        cb.onUndoExecuted(
          msg.board as BoardMatrix,
          msg.currentPlayer as ChessColor,
          (msg.moves as HistoryStep[]) || [],
        );
        cb.onTimerReset();
        break;
      case 'OPPONENT_LEFT':
        cb.onOpponentLeft();
        cb.onTimerStop();
        break;
      case 'REMATCH_REQUEST':
        cb.onRematchRequest();
        break;
      case 'REMATCH_REJECTED':
        cb.onRematchRejected();
        break;
      case 'REMATCH_START':
        cb.onRematchStart();
        break;
      case 'PASS_RESULT':
        cb.onPass(
          (msg.currentPlayer as ChessColor) || ChessColor.BLACK,
          (msg.action as 'PASS' | 'SCORING') || 'PASS',
        );
        break;
      case 'FULL':
        cb.onDisconnect();
        break;
      // 语音信令（必须 await，确保 SDP 处理完成）
      case 'VOICE_SIGNAL':
        console.log('[Online] VOICE_SIGNAL 收到, forwarding to VoiceChat');
        await cb.onVoiceSignal?.(msg.data);
        console.log('[Online] VOICE_SIGNAL 处理完成');
        break;
      case 'VOICE_HANGUP':
        cb.onVoiceHangup?.();
        break;
      case 'VOICE_MUTE':
        cb.onVoiceMute?.(msg.muted as boolean);
        break;
    }
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionalClose) this.connect();
    }, delay);
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}