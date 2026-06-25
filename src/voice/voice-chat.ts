import { RTC_ICE_SERVERS } from '../constants';
import { VoiceState } from '../enums';

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLocalVolume?: (level: number) => void;
  onRemoteVolume?: (level: number) => void;
  onError: (error: string) => void;
  /** ICE连接状态变化 — 用于诊断面板实时显示 */
  onIceStateChange?: (state: string) => void;
}

/** 原生 WebRTC 语音通话管理器 */
export class VoiceChat {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private state: VoiceState = VoiceState.DISCONNECTED;
  private sendSignaling: ((msg: Record<string, unknown>) => void) | null = null;
  private callbacks: VoiceCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private micEnabled = false;
  private speakerEnabled = false;
  private initiator = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSetup = false;

  setCallbacks(cbs: VoiceCallbacks) { this.callbacks = cbs; }
  setSignalingSender(sender: (msg: Record<string, unknown>) => void) { this.sendSignaling = sender; }

  /** 获取当前 ICE 连接状态（供外部轮询） */
  getIceConnectionState(): string {
    return this.pc?.iceConnectionState || 'disconnected';
  }

  /** 发起通话（黑方/initiator 使用） */
  async startCall() {
    if (!this.sendSignaling) { this.callbacks?.onError('信令未就绪'); return; }
    this.initiator = true;
    await this.ensurePC();
    await this.acquireLocalStream();
    // 添加本地轨道到PC
    if (this.localStream && this.pc) {
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));
    }
    this.startLocalVolumeAnalysis();
    try {
      this.makingOffer = true;
      await this.pc!.setLocalDescription();
      this.sendSignaling({ type: 'VOICE_SIGNAL', data: this.pc!.localDescription?.toJSON() });
      this.makingOffer = false;
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`语音初始化失败: ${e}`);
    }
  }

  /** 处理远端信令 */
  async handleSignal(data: unknown) {
    try {
      await this.ensurePC();
      const signal = data as RTCSessionDescriptionInit & { candidate?: RTCIceCandidateInit };
      if (signal.candidate) {
        await this.pc!.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        const desc = new RTCSessionDescription(signal);
        const readyForOffer = !this.makingOffer &&
          (this.pc!.signalingState === 'stable' || this.pc!.signalingState === 'have-local-offer');
        const collision = desc.type === 'offer' && !readyForOffer;
        this.ignoreOffer = collision && !this.initiator;
        if (this.ignoreOffer) return;
        await this.pc!.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          // Receiver 收到 Offer → 创建 Answer（此时不获取麦克风，等用户点击）
          await this.pc!.setLocalDescription();
          this.sendSignaling!({ type: 'VOICE_SIGNAL', data: this.pc!.localDescription?.toJSON() });
        }
      }
    } catch (e) {
      console.warn('[VoiceChat] 信令处理:', (e as Error).message);
    }
  }

  /** 打开/关闭麦克风（用户点击按钮） */
  async toggleMic(): Promise<boolean> {
    this.micEnabled = !this.micEnabled;
    if (this.micEnabled) {
      try {
        await this.ensurePC();
        await this.acquireLocalStream();
        if (this.localStream) {
          this.localStream.getAudioTracks().forEach(t => {
            t.enabled = true;
            // 确保轨道已添加到PC（如果还没加）
            if (this.pc) {
              const senders = this.pc.getSenders();
              const alreadyAdded = senders.some(s => s.track && s.track.id === t.id);
              if (!alreadyAdded) this.pc.addTrack(t, this.localStream!);
            }
          });
        }
        this.startLocalVolumeAnalysis();
      } catch (e) {
        this.micEnabled = false;
        this.callbacks?.onError(`麦克风访问失败: ${e}`);
        return false;
      }
    } else {
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = false);
      }
    }
    this.sendSignaling?.({ type: 'VOICE_MUTE', muted: !this.micEnabled });
    return this.micEnabled;
  }

  toggleSpeaker(): boolean {
    this.speakerEnabled = !this.speakerEnabled;
    const audio = document.getElementById('remoteAudio') as HTMLAudioElement;
    if (audio) audio.muted = !this.speakerEnabled;
    return this.speakerEnabled;
  }

  get isMicOn() { return this.micEnabled; }
  get isSpeakerOn() { return this.speakerEnabled; }

  hangup() { this.sendSignaling?.({ type: 'VOICE_HANGUP' }); this.cleanup(); }
  dispose() { this.cleanup(); }

  // ========== 私有方法 ==========

  private setState(s: VoiceState) { this.state = s; this.callbacks?.onStateChange(s); }

  /** 确保 PeerConnection 已创建（不获取媒体流） */
  private async ensurePC(): Promise<void> {
    if (this.pc && this.pc.connectionState !== 'failed') return;
    this.pc?.close();
    this.pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });

    // 远端音频流
    this.pc.ontrack = (e) => {
      if (e.streams[0]) {
        this.callbacks?.onRemoteStream(e.streams[0]);
        this.startRemoteVolumeAnalysis(e.streams[0]);
      }
    };

    // ICE 候选
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignaling?.({ type: 'VOICE_SIGNAL', data: { candidate: e.candidate.toJSON() } });
      }
    };

    // ICE连接状态 → 实时诊断
    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc?.iceConnectionState || 'disconnected';
      console.log('[VoiceChat] ICE状态:', iceState);
      this.callbacks?.onIceStateChange?.(iceState);
    };

    // 连接状态（用于VoiceState映射）
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc?.connectionState;
      if (cs === 'connected') { this.setState(VoiceState.CONNECTED); }
      else if (cs === 'failed') { this.callbacks?.onError('语音连接失败'); this.cleanup(); }
    };

    // 信令协商重入 (perfect negotiation)
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc!.setLocalDescription();
        this.sendSignaling?.({ type: 'VOICE_SIGNAL', data: this.pc!.localDescription?.toJSON() });
      } catch (e) { /* ignore */ }
      finally { this.makingOffer = false; }
    };

    this.setState(VoiceState.CONNECTING);
    this.isSetup = true;
    console.log('[VoiceChat] PeerConnection 已创建');
  }

  /** 获取本地麦克风流 */
  private async acquireLocalStream(): Promise<void> {
    if (this.localStream) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  }

  /** 启动本地音量分析（麦克风打开时立即启动，不依赖远端流） */
  private startLocalVolumeAnalysis(): void {
    if (!this.localStream) return;
    this.ensureAudioContext();
    if (this.localAnalyser || !this.audioContext) return;
    try {
      const src = this.audioContext.createMediaStreamSource(this.localStream);
      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 256;
      src.connect(this.localAnalyser);
      this.startVolumeLoop();
    } catch { /* ignore */ }
  }

  /** 启动远端音量分析（远端流到达时启动） */
  private startRemoteVolumeAnalysis(remoteStream: MediaStream): void {
    this.ensureAudioContext();
    if (this.remoteAnalyser || !this.audioContext) return;
    try {
      const src = this.audioContext.createMediaStreamSource(remoteStream);
      this.remoteAnalyser = this.audioContext.createAnalyser();
      this.remoteAnalyser.fftSize = 256;
      src.connect(this.remoteAnalyser);
      this.startVolumeLoop();
    } catch { /* ignore */ }
  }

  /** 确保 AudioContext 已创建并恢复 */
  private ensureAudioContext(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /** 启动音量轮询循环（仅启动一次） */
  private startVolumeLoop(): void {
    if (this.volumeInterval) return;
    this.volumeInterval = setInterval(() => {
      if (this.localAnalyser && this.callbacks?.onLocalVolume) {
        this.callbacks.onLocalVolume(this.getVolume(this.localAnalyser));
      }
      if (this.remoteAnalyser && this.callbacks?.onRemoteVolume) {
        this.callbacks.onRemoteVolume(this.getVolume(this.remoteAnalyser));
      }
    }, 100);
  }

  private getVolume(analyser: AnalyserNode): number {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
    return Math.min(1, sum / data.length / 128);
  }

  private cleanup() {
    if (this.volumeInterval) { clearInterval(this.volumeInterval); this.volumeInterval = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.audioContext) { this.audioContext.close().catch(() => {}); this.audioContext = null; }
    this.localAnalyser = null; this.remoteAnalyser = null;
    this.micEnabled = false; this.speakerEnabled = false;
    this.initiator = false; this.makingOffer = false; this.ignoreOffer = false;
    this.isSetup = false;
    this.setState(VoiceState.DISCONNECTED);
  }
}