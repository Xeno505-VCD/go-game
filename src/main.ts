import { BOARD_SIZE } from './constants';
import { ChessColor, GameMode, GamePhase, GameStatus, VoiceState } from './enums';
import type { Point, TerritoryResult } from './types';
import { GoController } from './core/go-controller';
import { calculateLayout } from './ui/layout';
import { Renderer } from './ui/renderer';
import { Panel } from './ui/panel';
import { InputHandler } from './input/input-handler';
import { OnlineManager } from './network/online';
import { MoveTimer } from './utils/timer';
import { StatsStorage } from './storage/stats';
import { VoiceChat } from './voice/voice-chat';

/**
 * 围棋应用主入口
 */
class GoApp {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer!: Renderer;
  private inputHandler!: InputHandler;
  private controller: GoController;
  private panel: Panel;
  private online: OnlineManager;
  private timer: MoveTimer;
  private voice: VoiceChat;

  private onlineActive = false;
  private myColor: ChessColor = ChessColor.EMPTY;

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.controller = new GoController();
    this.panel = new Panel();
    this.online = new OnlineManager();
    this.timer = new MoveTimer();
    this.voice = new VoiceChat();

    this.recalcLayout();
    window.addEventListener('resize', () => this.recalcLayout());

    // 异步加载战绩
    StatsStorage.load().then(stats => {
      this.controller.setStats(stats);
      this.panel.updateStats(stats);
    });

    this.initUI();
    this.initOnline();
    this.initVoice();

    this.panel.showModeUI(GameMode.AI);
    this.render();
  }

  // ==================== UI 初始化 ====================

  private initUI(): void {
    this.panel.initAllListeners(
      (mode) => this.switchMode(mode),
      () => this.requestRematch(),
      (msg) => this.sendFeedback(msg),
    );

    this.panel.btnSurrender.addEventListener('click', () => this.surrender());
    this.panel.btnDraw.addEventListener('click', () => this.requestDraw());
    this.panel.btnUndo.addEventListener('click', () => this.requestUndo());
    this.panel.btnCreateRoom.addEventListener('click', () => this.createRoom());
    this.panel.btnJoinRoom.addEventListener('click', () => this.joinRoom());

    // 语音按钮
    this.panel.btnVoice.addEventListener('click', () => {
      const muted = this.voice.toggleMute();
      this.panel.btnVoice.classList.toggle('active', !muted);
      this.panel.btnVoice.textContent = muted ? '🎤 开启语音' : '🎤 关闭语音';
    });

    // PASS 按钮
    const passBtn = document.getElementById('btnPass');
    if (passBtn) {
      passBtn.addEventListener('click', () => this.doPass());
    }

    // 手机端输入弹窗
    const btnRoomInputMobile = document.getElementById('btnRoomInputMobile');
    if (btnRoomInputMobile) {
      btnRoomInputMobile.addEventListener('click', () => {
        document.getElementById('roomInputModal')!.style.display = 'flex';
      });
    }
    document.getElementById('roomInputModalConfirm')!.addEventListener('click', () => {
      document.getElementById('roomInputModal')!.style.display = 'none';
      const field = document.getElementById('roomInputModalField') as HTMLInputElement;
      const roomId = field.value;
      if (!roomId || roomId.length !== 4) { alert('请输入4位房间号'); return; }
      this.online.joinRoom(roomId);
      this.panel.updateRoomInfo('已连接 房间:' + roomId);
      this.onlineActive = true;
      this.controller.setMode(GameMode.ONLINE);
      this.controller.reset();
      field.value = '';
    });
    document.getElementById('roomInputModalCancel')!.addEventListener('click', () => {
      document.getElementById('roomInputModal')!.style.display = 'none';
    });
    document.getElementById('roomInputModalBg')!.addEventListener('click', () => {
      document.getElementById('roomInputModal')!.style.display = 'none';
    });

    // AI 难度
    this.panel.aiLevelSelect.addEventListener('change', () => {
      this.controller.setAiLevel(this.panel.getAiLevel());
      this.restart();
    });
    const btnDifficulty = document.getElementById('btnDifficulty');
    if (btnDifficulty) {
      btnDifficulty.addEventListener('click', () => {
        document.getElementById('difficultyModal')!.style.display = 'flex';
      });
    }
    document.querySelectorAll('.btn-diff-select').forEach(btn => {
      btn.addEventListener('click', () => {
        const level = parseInt((btn as HTMLElement).dataset.level || '2');
        this.controller.setAiLevel(level);
        (document.getElementById('aiLevel') as HTMLSelectElement).value = String(level);
        const modeLine = document.getElementById('modeLine');
        const diffText = (btn as HTMLElement).textContent?.replace(/[🌟⭐👑\s]/g, '') || '普通';
        if (modeLine) modeLine.textContent = `人机对战：(${diffText})`;
        document.getElementById('difficultyModal')!.style.display = 'none';
        this.restart();
      });
    });
    document.getElementById('difficultyModalCancel')!.addEventListener('click', () => {
      document.getElementById('difficultyModal')!.style.display = 'none';
    });
    document.getElementById('difficultyModalBg')!.addEventListener('click', () => {
      document.getElementById('difficultyModal')!.style.display = 'none';
    });
    document.getElementById('roomShowModalClose')!.addEventListener('click', () => {
      document.getElementById('roomShowModal')!.style.display = 'none';
    });
    document.getElementById('roomShowModalBg')!.addEventListener('click', () => {
      document.getElementById('roomShowModal')!.style.display = 'none';
    });

    document.getElementById('restartBtn')!.addEventListener('click', () => this.restart());

    document.getElementById('rematchAccept')!.addEventListener('click', () => {
      this.online.sendRematchResponse(true);
      document.getElementById('rematchModal')!.style.display = 'none';
    });
    document.getElementById('rematchReject')!.addEventListener('click', () => {
      this.online.sendRematchResponse(false);
      document.getElementById('rematchModal')!.style.display = 'none';
    });

    // 计时器
    this.timer.setOnTick((s) => this.panel.updateTimer(s));
    this.timer.setOnTimeout(() => {
      if (this.controller.gameMode === GameMode.ONLINE && this.onlineActive) {
        this.panel.updateHint('超时！你输了');
        this.online.sendSurrender();
      }
    });
  }

  // ==================== 联机初始化 ====================

  private initOnline(): void {
    this.online.setCallbacks({
      onAssign: (color) => {
        this.myColor = color;
        this.panel.updateHint('你执' + (color === ChessColor.BLACK ? '黑棋' : '白棋'));
      },
      onWaiting: (msg) => {
        this.panel.updateHint(msg);
      },
      onGameStart: (board, currentPlayer) => {
        this.controller.reset();
        this.controller.board.importState(board || [], []);
        this.controller.currentPlayer = currentPlayer;
        this.panel.hideRematchButton();
        this.panel.setButtonsEnabled(true);
        this.panel.updateTurn(currentPlayer);
        this.panel.updateStatus('对局中');
        this.render();
        this.timer.start();
        // 联机自动启动语音
        this.startVoiceCall();
      },
      onMove: (row, col, color, currentPlayer) => {
        this.controller.board.placeStone(row, col, color);
        this.controller.currentPlayer = currentPlayer;
        this.controller.board.resetPassCount();
        this.panel.updateTurn(currentPlayer);
        this.render();
        this.timer.reset();
      },
      onGameOver: (winner, winLine, reason) => {
        if (winner) {
          this.controller.status = GameStatus.WIN;
          const myWin = winner === this.myColor;
          this.panel.updateStatus(myWin ? '你赢了！' : '你输了！');
          this.controller.recordResult(myWin ? 'win' : 'loss');
        } else {
          this.controller.status = GameStatus.DRAW;
          this.panel.updateStatus('对局和棋！');
          this.controller.recordResult('draw');
        }
        this.panel.showRematchButton();
        this.timer.stop();
        StatsStorage.save(this.controller.stats);
        this.panel.updateStats(this.controller.stats);
        this.render();
        this.voice.hangup();
      },
      onDrawRequest: () => {
        if (confirm('对手申请和棋，同意？')) this.online.sendDrawResponse(true);
        else this.online.sendDrawResponse(false);
      },
      onDrawRejected: () => this.panel.updateHint('对手拒绝和棋'),
      onUndoRequest: () => {
        if (confirm('对手申请悔棋，同意？')) this.online.sendUndoResponse(true);
        else this.online.sendUndoResponse(false);
      },
      onUndoRejected: () => this.panel.updateHint('对手拒绝悔棋'),
      onUndoExecuted: (board, currentPlayer, moves) => {
        this.controller.board.importState(board, moves);
        this.controller.currentPlayer = currentPlayer;
        this.controller.status = GameStatus.PLAYING;
        this.panel.updateStatus('对局中');
        this.panel.updateTurn(currentPlayer);
        this.render();
        this.timer.reset();
      },
      onOpponentLeft: () => {
        this.panel.updateHint('对手已离开');
        this.timer.stop();
        this.voice.hangup();
      },
      onDisconnect: () => {
        this.panel.updateHint('连接已断开');
        this.timer.stop();
      },
      onTimerStart: () => this.timer.start(),
      onTimerReset: () => this.timer.reset(),
      onTimerStop: () => this.timer.stop(),
      onRematchRequest: () => {
        document.getElementById('rematchModal')!.style.display = 'flex';
      },
      onRematchRejected: () => {
        this.panel.updateHint('对手拒绝了再来一局');
      },
      onRematchStart: () => {
        this.controller.reset();
        this.panel.hideRematchButton();
        this.panel.setButtonsEnabled(true);
        this.panel.updateTurn(ChessColor.BLACK);
        this.panel.updateStatus('对局中');
        this.render();
        this.timer.start();
      },
      // 语音信令回调
      onVoiceOffer: (sdp) => {
        this.voice.handleOffer(sdp);
      },
      onVoiceAnswer: (sdp) => {
        this.voice.handleAnswer(sdp);
      },
      onVoiceCandidate: (candidate) => {
        this.voice.handleCandidate(candidate);
      },
      onVoiceHangup: () => {
        this.voice.dispose();
        this.panel.updateHint('对手已挂断语音');
      },
      onVoiceMute: (muted) => {
        this.panel.updateHint(muted ? '对手已静音' : '对手已取消静音');
      },
    });
  }

  // ==================== 语音初始化 ====================

  private initVoice(): void {
    this.voice.setCallbacks({
      onStateChange: (state) => {
        this.panel.updateVoiceState(state);
        const btn = this.panel.btnVoice;
        if (state === VoiceState.CONNECTED) {
          this.panel.updateHint('语音已连接');
          btn.classList.add('active');
          btn.textContent = '🎤 关闭语音';
        } else if (state === VoiceState.MUTED || state === VoiceState.DISCONNECTED) {
          btn.classList.remove('active');
          btn.textContent = '🎤 开启语音';
        }
      },
      onRemoteStream: (stream) => {
        // 播放远端音频
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play().catch(() => {});
      },
      onLocalVolume: (level) => {
        const el = document.getElementById('voiceSpeaking');
        if (el) {
          if (level > 0.15) {
            el.style.display = 'inline';
            el.textContent = '🎤 你正在发言...';
          } else {
            el.style.display = 'none';
          }
        }
      },
      onRemoteVolume: (level) => {
        const el = document.getElementById('voiceSpeaking');
        if (el) {
          if (level > 0.10) {
            el.style.display = 'inline';
            el.textContent = '🎤 对方正在发言...';
          }
        }
      },
      onError: (err) => {
        this.panel.updateHint('语音错误: ' + err);
      },
    });
  }

  private startVoiceCall(): void {
    // 注入信令发送函数，复用 online 的 WebSocket
    this.voice.setSignalingSender((msg) => {
      this.online.sendRaw(msg);
    });
    this.voice.startCall();
  }

  // ==================== 布局 ====================

  private recalcLayout(): void {
    const layout = calculateLayout();
    this.canvas.width = layout.canvasWidth;
    this.canvas.height = layout.canvasHeight;
    if (!this.renderer) {
      this.renderer = new Renderer(this.ctx, layout);
      this.inputHandler = new InputHandler(this.canvas, layout);
      this.inputHandler.setOnClick((point) => this.handleClick(point));
      this.inputHandler.setOnHover((point) => this.renderer.setGhostStone(point));
    } else {
      this.renderer.updateLayout(layout);
      this.inputHandler.updateLayout(layout);
    }
    this.render();
  }

  // ==================== 模式切换 ====================

  private switchMode(mode: GameMode): void {
    this.online.disconnect();
    this.onlineActive = false;
    this.timer.stop();
    this.panel.hideTimer();
    this.panel.hideRematchButton();
    this.controller.setMode(mode);
    this.panel.showModeUI(mode);
    this.panel.setButtonsEnabled(true);
    this.panel.updateStatus('对局中');
    this.panel.updateHint('');
    this.controller.reset();
    this.render();
  }

  private restart(): void {
    this.controller.setAiLevel(this.panel.getAiLevel());
    this.controller.reset();
    this.panel.setButtonsEnabled(true);
    this.panel.updateStatus('对局中');
    this.panel.updateTurn(ChessColor.BLACK);
    this.panel.updateHint('');
    this.timer.stop();
    this.panel.hideTimer();
    this.render();
  }

  // ==================== 核心操作 ====================

  private handleClick(point: Point): void {
    // 计目阶段下的点击
    if (this.controller.board.gamePhase === GamePhase.SCORING) {
      this.finalizeGame();
      return;
    }

    if (this.controller.gameMode === GameMode.ONLINE) {
      if (!this.onlineActive) return;
      if (this.controller.status !== GameStatus.PLAYING) return;
      if (this.controller.currentPlayer !== this.myColor) return;
      this.online.sendMove(point.row, point.col);
      return;
    }

    if (this.controller.gameMode === GameMode.AI &&
        this.controller.currentPlayer !== ChessColor.BLACK) return;

    const result = this.controller.placeStone(point.row, point.col);
    this.handleMoveResult(result);
  }

  private handleMoveResult(result: ReturnType<GoController['placeStone']>): void {
    if (!result.legal) {
      this.panel.updateHint(result.reason || '非法落子');
      return;
    }
    this.render();
    this.panel.updateTurn(this.controller.currentPlayer);
    this.panel.updateCaptured(this.controller.board.capturedBlack, this.controller.board.capturedWhite);

    if (result.action === 'CAPTURE') {
      this.panel.updateHint(`提走 ${result.captured.length} 子`);
    } else if (result.action === 'KO') {
      this.panel.updateHint('劫争！');
    }

    // AI 自动落子
    if (this.controller.gameMode === GameMode.AI &&
        this.controller.currentPlayer === ChessColor.WHITE &&
        this.controller.status === GameStatus.PLAYING) {
      this.controller.status = GameStatus.AI_THINKING;
      setTimeout(() => {
        if (this.controller.status !== GameStatus.AI_THINKING) return;
        const empty: Point[] = [];
        for (let r = 0; r < BOARD_SIZE; r++)
          for (let c = 0; c < BOARD_SIZE; c++)
            if (this.controller.board.get(r, c) === ChessColor.EMPTY)
              empty.push({ row: r, col: c });
        if (empty.length === 0) return;
        const mv = empty[Math.floor(Math.random() * empty.length)];
        const aiResult = this.controller.placeStone(mv.row, mv.col);
        this.handleMoveResult(aiResult);
      }, 50);
    }
  }

  private doPass(): void {
    if (this.controller.gameMode === GameMode.ONLINE && this.onlineActive) {
      // 联机版：发送 PASS 给服务器
      if (this.controller.currentPlayer !== this.myColor) return;
      // 本地执行
      const passResult = this.controller.pass();
      if (passResult.action === 'SCORING') {
        this.finalizeGame();
      } else {
        this.panel.updateTurn(this.controller.currentPlayer);
        this.panel.updateHint('一方 Pass');
      }
      return;
    }
    const passResult = this.controller.pass();
    if (passResult.action === 'SCORING') {
      this.finalizeGame();
    } else {
      this.panel.updateTurn(this.controller.currentPlayer);
      this.panel.updateHint('一方 Pass');
    }
  }

  private finalizeGame(): void {
    if (!this.controller.territoryResult) {
      this.controller.calculateScore();
    }
    const { winner, territory } = this.controller.finalize();
    this.panel.setButtonsEnabled(false);
    this.panel.updateTerritory(territory);
    this.render();

    let statusText = '';
    if (winner === ChessColor.BLACK) {
      statusText = `黑棋胜！黑 ${territory.black.toFixed(1)} 目 vs 白 ${territory.white.toFixed(1)} 目`;
    } else if (winner === ChessColor.WHITE) {
      statusText = `白棋胜！白 ${territory.white.toFixed(1)} 目 vs 黑 ${territory.black.toFixed(1)} 目`;
    } else {
      statusText = `平局！黑 ${territory.black.toFixed(1)} vs 白 ${territory.white.toFixed(1)}`;
    }
    this.panel.updateStatus(statusText);

    const myWin = winner === this.myColor || (this.controller.gameMode !== GameMode.ONLINE && winner === ChessColor.BLACK);
    this.controller.recordResult(myWin ? 'win' : (winner === null ? 'draw' : 'loss'));
    StatsStorage.save(this.controller.stats);
    this.panel.updateStats(this.controller.stats);
  }

  private surrender(): void {
    if (this.controller.gameMode === GameMode.ONLINE && this.onlineActive) {
      this.online.sendSurrender();
      this.controller.status = GameStatus.DRAW;
      this.panel.showRematchButton();
      this.timer.stop();
      this.panel.updateStatus('你认输了！');
      this.render();
      return;
    }
    if (this.controller.status !== GameStatus.PLAYING &&
        this.controller.status !== GameStatus.AI_THINKING) return;
    this.controller.surrender();
    this.panel.setButtonsEnabled(false);
    this.panel.updateStatus('认输');
    this.controller.recordResult('loss');
    StatsStorage.save(this.controller.stats);
    this.panel.updateStats(this.controller.stats);
    this.render();
  }

  private requestDraw(): void {
    if (this.controller.gameMode === GameMode.ONLINE && this.onlineActive) {
      this.online.sendDrawRequest();
      return;
    }
    if (!confirm('确定和棋？')) return;
    this.controller.board.setGamePhase(GamePhase.ENDED);
    this.controller.status = GameStatus.DRAW;
    this.panel.setButtonsEnabled(false);
    this.panel.updateStatus('对局和棋！');
    this.controller.recordResult('draw');
    StatsStorage.save(this.controller.stats);
    this.panel.updateStats(this.controller.stats);
    this.render();
  }

  private requestUndo(): void {
    if (this.controller.gameMode === GameMode.ONLINE && this.onlineActive) {
      this.online.sendUndoRequest();
      return;
    }
    this.controller.undo();
    this.panel.updateStatus('对局中');
    this.panel.updateTurn(this.controller.currentPlayer);
    this.render();
  }

  private requestRematch(): void {
    if (!this.onlineActive) return;
    this.online.sendRematchRequest();
    this.panel.updateHint('已发送再来一局申请...');
  }

  // ==================== 房间 ====================

  private createRoom(): void {
    const roomId = this.online.createRoom();
    this.panel.updateRoomInfo('房间号: ' + roomId);
    const showModal = document.getElementById('roomShowModal')!;
    const showNumber = document.getElementById('roomShowNumber')!;
    showNumber.textContent = roomId;
    showModal.style.display = 'flex';
    this.onlineActive = true;
    this.controller.setMode(GameMode.ONLINE);
    this.controller.reset();
  }

  private joinRoom(): void {
    const roomId = this.panel.getRoomInput();
    if (!roomId || roomId.length !== 4) {
      alert('请输入4位房间号');
      return;
    }
    this.online.joinRoom(roomId);
    this.panel.updateRoomInfo('已连接 房间:' + roomId);
    this.onlineActive = true;
    this.controller.setMode(GameMode.ONLINE);
    this.controller.reset();
  }

  // ==================== 反馈 ====================

  private async sendFeedback(msg: string): Promise<void> {
    try {
      const res = await fetch('https://go-game-ws.onrender.com/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) this.panel.showFeedbackSent();
      else this.panel.showFeedbackError();
    } catch {
      this.panel.showFeedbackError();
    }
  }

  // ==================== 渲染 ====================

  private render(): void {
    this.renderer.draw(
      this.controller.board.getGrid(),
      this.controller.board.getLastMove(),
      this.controller.board.koPoint,
      this.controller.territoryResult,
    );
    this.panel.updateCaptured(
      this.controller.board.capturedBlack,
      this.controller.board.capturedWhite,
    );
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new GoApp();
});