import SimplePeer, { type Instance, type SignalData } from 'simple-peer';
import { RTC_ICE_SERVERS } from '../constants';
import { VoiceState } from '../enums';

/** 语音通话事件回调 */
export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLocalVolume?: (level: number) => void;
  onRemoteVolume?: (level: number) => void;
  onError: (error: string) => void;
}

/**
 * WebRTC P2P 语音通话管理器
 * 使用 simple-peer 封装 WebRTC，自动处理信令/重连
 */
export class VoiceChat {
  private peer: Instance | null = null;
  private localStream: MediaStream | null = null;
  private state: VoiceState = VoiceState.DISCONNECTED;
  private callbacks: VoiceCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private sendSignaling: ((msg: Record<string, unknown>) => void) | null = null;

  setCallbacks(cbs: VoiceCallbacks): void {
    this.callbacks = cbs;
  }

  setSignalingSender(sender: (msg: Record<string, unknown>) => void): void {
    this.sendSignaling = sender;
  }

  /** 发起通话（创建房间的终端调用） */
  async startCall(): Promise<void> {
    if (!this.sendSignaling) {
      this.callbacks?.onError('信令通道未就绪');
      return;
    }
    try {
      this.setState(VoiceState.CONNECTING);
      await this.initLocalStream();
      this.createPeer(true); // initiator = true
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`启动通话失败: ${e}`);
    }
  }

  /** 处理远端信令 */
  handleSignal(data: SignalData): void {
    if (!this.peer) {
      // 首次收到信号，创建接收方 peer
      this.initLocalStream().then(() => {
        this.createPeer(false);
        if (this.peer) {
          this.peer.signal(data);
        }
      }).catch(e => {
        this.callbacks?.onError(`启动通话失败: ${e}`);
      });
      return;
    }
    this.peer.signal(data);
  }

  toggleMute(): boolean {
    if (!this.localStream) return this.muted;
    this.muted = !this.muted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.muted;
    });
    this.setState(this.muted ? VoiceState.MUTED : VoiceState.CONNECTED);
    this.sendSignaling?.({ type: 'VOICE_MUTE', muted: this.muted });
    return this.muted;
  }

  hangup(): void {
    this.sendSignaling?.({ type: 'VOICE_HANGUP' });
    this.cleanup();
  }

  dispose(): void {
    this.cleanup();
  }

  // ==================== 私有方法 ====================

  private setState(state: VoiceState): void {
    this.state = state;
    this.callbacks?.onStateChange(state);
  }

  private async initLocalStream(): Promise<void> {
    if (this.localStream) return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
    } catch (e) {
      throw new Error('麦克风权限被拒绝或不可用');
    }
  }

  private createPeer(initiator: boolean): void {
    this.peer?.destroy();
    this.setState(VoiceState.CONNECTING);

    this.peer = new SimplePeer({
      initiator,
      stream: this.localStream!,
      config: { iceServers: RTC_ICE_SERVERS },
      trickle: true,
    });

    // 信令 → 通过 WebSocket 发送
    this.peer.on('signal', (data: SignalData) => {
      this.sendSignaling?.({ type: 'VOICE_SIGNAL', data });
    });

    // 远端音频流到达
    this.peer.on('stream', (stream: MediaStream) => {
      this.callbacks?.onRemoteStream(stream);
      this.startVolumeAnalysis(stream);
      if (!this.muted) {
        this.setState(VoiceState.CONNECTED);
      }
    });

    this.peer.on('error', (err: Error) => {
      console.warn('[VoiceChat] P2P错误:', err.message);
      // 只报致命错误
      if (err.message.includes('connection') || err.message.includes('ICE')) {
        this.callbacks?.onError('语音连接异常: ' + err.message);
      }
    });

    this.peer.on('close', () => {
      this.setState(VoiceState.DISCONNECTED);
    });

    this.peer.on('connect', () => {
      if (this.state === VoiceState.CONNECTING) {
        this.setState(VoiceState.CONNECTED);
      }
    });
  }

  private startVolumeAnalysis(remoteStream: MediaStream): void {
    if (this.audioContext) return;
    try {
      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (this.localStream) {
        const src = this.audioContext.createMediaStreamSource(this.localStream);
        this.localAnalyser = this.audioContext.createAnalyser();
        this.localAnalyser.fftSize = 256;
        src.connect(this.localAnalyser);
      }

      const src = this.audioContext.createMediaStreamSource(remoteStream);
      this.remoteAnalyser = this.audioContext.createAnalyser();
      this.remoteAnalyser.fftSize = 256;
      src.connect(this.remoteAnalyser);

      this.volumeInterval = setInterval(() => {
        if (this.localAnalyser && this.callbacks?.onLocalVolume) {
          this.callbacks.onLocalVolume(this.getVolume(this.localAnalyser));
        }
        if (this.remoteAnalyser && this.callbacks?.onRemoteVolume) {
          this.callbacks.onRemoteVolume(this.getVolume(this.remoteAnalyser));
        }
      }, 100);
    } catch {
      // AudioContext 不可用
    }
  }

  private getVolume(analyser: AnalyserNode): number {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return Math.min(1, sum / data.length / 128);
  }

  private cleanup(): void {
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.localAnalyser = null;
    this.remoteAnalyser = null;
    this.muted = false;
    this.setState(VoiceState.DISCONNECTED);
  }
}