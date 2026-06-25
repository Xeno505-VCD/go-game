import { RTC_ICE_SERVERS } from '../constants';
import { VoiceState } from '../enums';

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLocalVolume?: (level: number) => void;
  onRemoteVolume?: (level: number) => void;
  onError: (error: string) => void;
  onIceStateChange?: (state: string) => void;
}

/** 原生 WebRTC 语音通话管理器 — 完全手动信令协商 */
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
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;

  setCallbacks(cbs: VoiceCallbacks) { this.callbacks = cbs; }
  setSignalingSender(sender: (msg: Record<string, unknown>) => void) { this.sendSignaling = sender; }

  getIceConnectionState(): string {
    return this.pc?.iceConnectionState || 'disconnected';
  }

  async startCall() {
    if (!this.sendSignaling) { this.callbacks?.onError('信令未就绪'); return; }
    this.initiator = true;
    this.createPeerConnection();
    await this.acquireLocalStream();
    if (this.localStream && this.pc) {
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));
    }
    this.startLocalVolumeAnalysis();
    try {
      console.log('[VoiceChat] Initiator: 创建 Offer');
      const desc = await this.pc!.createOffer();
      console.log('[VoiceChat] Initiator: setLocalDescription...');
      await this.pc!.setLocalDescription(desc);
      console.log('[VoiceChat] Initiator: Offer 已发送, signalingState=', this.pc!.signalingState);
      this.sendSignaling({ type: 'VOICE_SIGNAL', data: desc });
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`Offer失败: ${e}`);
    }
  }

  async handleSignal(data: unknown) {
    console.log('[VoiceChat] handleSignal 被调用, pc 存在:', !!this.pc, ', 数据类型:', typeof data);
    if (!this.pc) {
      this.initiator = false;
      this.createPeerConnection();
    }
    try {
      const signal = data as RTCSessionDescriptionInit & { candidate?: RTCIceCandidateInit };
      if (signal.candidate) {
        console.log('[VoiceChat] 收到 ICE 候选, remoteDescSet=', this.remoteDescSet, ', 候选:', signal.candidate.candidate?.substring(0, 50));
        const iceCandidate = new RTCIceCandidate(signal.candidate);
        if (this.remoteDescSet) {
          try {
            await this.pc!.addIceCandidate(iceCandidate);
            console.log('[VoiceChat] ICE 候选注入成功');
          } catch (err) {
            console.error('[VoiceChat] addIceCandidate 失败:', err);
          }
        } else {
          console.log('[VoiceChat] ICE候选排队等待');
          this.pendingCandidates.push(signal.candidate);
        }
      } else {
        console.log(`[VoiceChat] 收到 SDP (type=${signal.type}), signalingState=${this.pc!.signalingState}`);
        try {
          await this.pc!.setRemoteDescription(new RTCSessionDescription(signal));
          this.remoteDescSet = true;
          console.log('[VoiceChat] setRemoteDescription 成功, 清空 ', this.pendingCandidates.length, ' 个排队候选');
          for (const c of this.pendingCandidates) {
            try {
              await this.pc!.addIceCandidate(new RTCIceCandidate(c));
            } catch (err) {
              console.error('[VoiceChat] 排队候选注入失败:', err);
            }
          }
          this.pendingCandidates = [];
          if (signal.type === 'offer') {
            console.log('[VoiceChat] 收到 Offer, 创建 Answer...');
            const answer = await this.pc!.createAnswer();
            await this.pc!.setLocalDescription(answer);
            console.log('[VoiceChat] Answer 已发送, signalingState=', this.pc!.signalingState);
            this.sendSignaling!({ type: 'VOICE_SIGNAL', data: answer });
          }
        } catch (err) {
          console.error('[VoiceChat] setRemoteDescription 失败:', err);
          this.callbacks?.onError(`SDP处理失败: ${err}`);
        }
      }
    } catch (e) {
      console.warn('[VoiceChat] 信令处理外层错误:', (e as Error).message);
    }
  }

  async toggleMic(): Promise<boolean> {
    this.micEnabled = !this.micEnabled;
    if (this.micEnabled) {
      try {
        await this.acquireLocalStream();
        // 关键：如果在 handleSignal 中已创建了 PC（接收方收到 Offer 后），不要重新创建
        if (!this.pc) {
          // 发起方或首次打开 — 创建 PC
          this.createPeerConnection();
        }
        if (this.localStream && this.pc) {
          this.localStream.getAudioTracks().forEach(t => {
            t.enabled = true;
            const senders = this.pc!.getSenders();
            const alreadyAdded = senders.some(s => s.track && s.track.id === t.id);
            if (!alreadyAdded) {
              this.pc!.addTrack(t, this.localStream!);
              // 仅在 stable 状态下重新协商（PC 已连接完成时）
              if (this.pc!.signalingState === 'stable' && this.remoteDescSet) {
                this.renegotiate();
              }
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

  private async renegotiate(): Promise<void> {
    if (!this.pc || this.pc.signalingState !== 'stable') return;
    try {
      console.log('[VoiceChat] 重新协商...');
      const desc = await this.pc.createOffer();
      await this.pc.setLocalDescription(desc);
      this.sendSignaling?.({ type: 'VOICE_SIGNAL', data: desc });
    } catch (e) {
      console.warn('[VoiceChat] 重新协商失败:', e);
    }
  }

  private setState(s: VoiceState) { this.state = s; this.callbacks?.onStateChange(s); }

  private createPeerConnection(): void {
    if (this.pc && this.pc.connectionState !== 'failed') return;
    this.pc?.close();
    this.pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
    this.remoteDescSet = false;
    this.pendingCandidates = [];

    this.pc.ontrack = (e) => {
      console.log('[VoiceChat] ✅ ontrack 触发! streams:', e.streams.length);
      if (e.streams[0]) {
        this.callbacks?.onRemoteStream(e.streams[0]);
        this.startRemoteVolumeAnalysis(e.streams[0]);
      }
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('[VoiceChat] 本地ICE候选:', e.candidate.candidate.substring(0, 60));
        this.sendSignaling?.({ type: 'VOICE_SIGNAL', data: { candidate: e.candidate.toJSON() } });
      } else {
        console.log('[VoiceChat] ICE gathering 完成 (null candidate)');
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log('[VoiceChat] ICE gathering 状态:', this.pc?.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc?.iceConnectionState || 'disconnected';
      console.log('[VoiceChat] ICE 连接状态:', iceState);
      this.callbacks?.onIceStateChange?.(iceState);
    };

    this.pc.onconnectionstatechange = () => {
      const cs = this.pc?.connectionState;
      console.log('[VoiceChat] 连接状态:', cs);
      if (cs === 'connected') this.setState(VoiceState.CONNECTED);
      else if (cs === 'failed') { this.callbacks?.onError('语音连接失败'); this.cleanup(); }
    };

    // 不设置 onnegotiationneeded — 全部手动控制
    this.setState(VoiceState.CONNECTING);
    console.log('[VoiceChat] PeerConnection 已创建');
  }

  private async acquireLocalStream(): Promise<void> {
    if (this.localStream) return;
    console.log('[VoiceChat] 请求麦克风...');
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    console.log('[VoiceChat] 麦克风已获取');
  }

  private startLocalVolumeAnalysis(): void {
    if (!this.localStream) return;
    this.ensureAudioContext();
    if (this.localAnalyser || !this.audioContext) return;
    const src = this.audioContext.createMediaStreamSource(this.localStream);
    this.localAnalyser = this.audioContext.createAnalyser();
    this.localAnalyser.fftSize = 256;
    src.connect(this.localAnalyser);
    this.startVolumeLoop();
  }

  private startRemoteVolumeAnalysis(remoteStream: MediaStream): void {
    this.ensureAudioContext();
    if (this.remoteAnalyser || !this.audioContext) return;
    const src = this.audioContext.createMediaStreamSource(remoteStream);
    this.remoteAnalyser = this.audioContext.createAnalyser();
    this.remoteAnalyser.fftSize = 256;
    src.connect(this.remoteAnalyser);
    this.startVolumeLoop();
  }

  private ensureAudioContext(): void {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
  }

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
    this.initiator = false;
    this.remoteDescSet = false;
    this.pendingCandidates = [];
    this.setState(VoiceState.DISCONNECTED);
  }
}