import { RTC_ICE_SERVERS } from '../constants';
import { VoiceState } from '../enums';

/**
 * 语音通话事件回调
 */
export interface VoiceCallbacks {
  /** 状态变更 */
  onStateChange: (state: VoiceState) => void;
  /** 远端音频流到达（用于播放） */
  onRemoteStream: (stream: MediaStream) => void;
  /** 音量级别（用于可视化） */
  onLocalVolume?: (level: number) => void;
  onRemoteVolume?: (level: number) => void;
  /** 错误 */
  onError: (error: string) => void;
}

/**
 * WebRTC P2P 语音通话管理器
 *
 * 架构：
 *   终端A ←──WebSocket信令──→ 服务器 ←──WebSocket信令──→ 终端B
 *     └──────── WebRTC P2P 音频流 (直连) ────────────────┘
 *
 * 流程：
 *   1. getUserMedia → 获取本地麦克风
 *   2. createOffer / createAnswer → 通过信令交换 SDP
 *   3. ICE 候选交换 → P2P 连接
 *   4. Opus 编码音频流实时传输
 */
export class VoiceChat {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private state: VoiceState = VoiceState.DISCONNECTED;
  private callbacks: VoiceCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private remoteAudio: HTMLAudioElement | null = null;
  /** 信令发送函数（由外部注入） */
  private sendSignaling: ((msg: Record<string, unknown>) => void) | null = null;

  setCallbacks(cbs: VoiceCallbacks): void {
    this.callbacks = cbs;
  }

  /** 注入信令发送函数（复用 WebSocket） */
  setSignalingSender(sender: (msg: Record<string, unknown>) => void): void {
    this.sendSignaling = sender;
  }

  /** 初始化并开始通话（发起方） */
  async startCall(): Promise<void> {
    if (!this.sendSignaling) {
      this.callbacks?.onError('信令通道未就绪');
      return;
    }
    try {
      this.setState(VoiceState.CONNECTING);
      await this.initLocalStream();
      this.createPeerConnection();
      const offer = await this.pc!.createOffer({ offerToReceiveAudio: true });
      await this.pc!.setLocalDescription(offer);
      this.sendSignaling({ type: 'VOICE_OFFER', sdp: this.pc!.localDescription });
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`启动通话失败: ${e}`);
    }
  }

  /** 处理远端 Offer（接收方） */
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      this.setState(VoiceState.CONNECTING);
      await this.initLocalStream();
      this.createPeerConnection();
      await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.pc!.createAnswer({ offerToReceiveAudio: true });
      await this.pc!.setLocalDescription(answer);
      this.sendSignaling?.({
        type: 'VOICE_ANSWER',
        sdp: this.pc!.localDescription,
      });
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`处理Offer失败: ${e}`);
    }
  }

  /** 处理远端 Answer（发起方收到应答） */
  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (e) {
      this.callbacks?.onError(`处理Answer失败: ${e}`);
    }
  }

  /** 处理 ICE 候选 */
  async handleCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      if (!this.pc) return;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[VoiceChat] ICE候选添加失败:', e);
    }
  }

  /** 切换静音 */
  toggleMute(): boolean {
    if (!this.localStream) return this.muted;
    this.muted = !this.muted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.muted;
    });
    this.setState(this.muted ? VoiceState.MUTED : VoiceState.CONNECTED);
    // 通知对方
    this.sendSignaling?.({ type: 'VOICE_MUTE', muted: this.muted });
    return this.muted;
  }

  /** 挂断通话 */
  hangup(): void {
    this.sendSignaling?.({ type: 'VOICE_HANGUP' });
    this.cleanup();
  }

  /** 释放所有资源 */
  dispose(): void {
    this.cleanup();
  }

  // ==================== 私有方法 ====================

  private setState(state: VoiceState): void {
    this.state = state;
    this.callbacks?.onStateChange(state);
  }

  /** 获取本地麦克风 */
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

  /** 创建 RTCPeerConnection */
  private createPeerConnection(): void {
    this.pc?.close();
    this.pc = new RTCPeerConnection({
      iceServers: RTC_ICE_SERVERS,
    });

    // 添加本地音频轨道
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.pc!.addTrack(track, this.localStream!);
      });
    }

    // 远端音频流到达
    this.pc.ontrack = (event) => {
      if (event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.callbacks?.onRemoteStream(this.remoteStream);
        this.startVolumeAnalysis();
        if (this.state !== VoiceState.MUTED) {
          this.setState(VoiceState.CONNECTED);
        }
      }
    };

    // ICE 候选 → 通过信令发送
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling?.({
          type: 'VOICE_ICE',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // ICE 连接状态变化
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc?.connectionState;
      if (cs === 'failed') {
        this.setState(VoiceState.ERROR);
        this.callbacks?.onError('语音连接断开');
      } else if (cs === 'disconnected') {
        // ICE 可能正在重新协商，等待自动恢复，不报错
        this.setState(VoiceState.CONNECTING);
      } else if (cs === 'connected') {
        if (this.state !== VoiceState.MUTED) {
          this.setState(VoiceState.CONNECTED);
        }
      }
    };
  }

  /** 启动音量分析（用于可视化） */
  private startVolumeAnalysis(): void {
    if (this.audioContext) return;
    try {
      this.audioContext = new AudioContext();
      // 浏览器自动播放策略要求 AudioContext 在用户交互后恢复
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (this.localStream) {
        const src = this.audioContext.createMediaStreamSource(this.localStream);
        this.localAnalyser = this.audioContext.createAnalyser();
        this.localAnalyser.fftSize = 256;
        src.connect(this.localAnalyser);
      }

      if (this.remoteStream) {
        const src = this.audioContext.createMediaStreamSource(this.remoteStream);
        this.remoteAnalyser = this.audioContext.createAnalyser();
        this.remoteAnalyser.fftSize = 256;
        src.connect(this.remoteAnalyser);
      }

      this.volumeInterval = setInterval(() => {
        if (this.localAnalyser && this.callbacks?.onLocalVolume) {
          this.callbacks.onLocalVolume(this.getVolume(this.localAnalyser));
        }
        if (this.remoteAnalyser && this.callbacks?.onRemoteVolume) {
          this.callbacks.onRemoteVolume(this.getVolume(this.remoteAnalyser));
        }
      }, 100);
    } catch {
      // AudioContext 可能在某些环境下不可用
    }
  }

  /** 从 AnalyserNode 计算音量级别 (0-1) */
  private getVolume(analyser: AnalyserNode): number {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return Math.min(1, sum / data.length / 128);
  }

  /** 清理资源 */
  private cleanup(): void {
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
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