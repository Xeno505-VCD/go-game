import { RTC_ICE_SERVERS } from '../constants';
import { VoiceState } from '../enums';

export interface VoiceCallbacks {
  onStateChange: (state: VoiceState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLocalVolume?: (level: number) => void;
  onRemoteVolume?: (level: number) => void;
  onError: (error: string) => void;
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

  setCallbacks(cbs: VoiceCallbacks) { this.callbacks = cbs; }
  setSignalingSender(sender: (msg: Record<string, unknown>) => void) { this.sendSignaling = sender; }

  /** 发起通话 */
  async startCall() {
    if (!this.sendSignaling) { this.callbacks?.onError('信令未就绪'); return; }
    this.initiator = true;
    await this.setup();
  }

  /** 处理远端信令 */
  async handleSignal(data: unknown) {
    if (!this.pc) {
      this.initiator = false;
      await this.setup();
    }
    try {
      const signal = data as RTCSessionDescriptionInit & { candidate?: RTCIceCandidateInit };
      if (signal.candidate) {
        await this.pc!.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        const desc = new RTCSessionDescription(signal);
        const readyForOffer = !this.makingOffer && (this.pc!.signalingState === 'stable' || this.initiator);
        const collision = desc.type === 'offer' && !readyForOffer;
        this.ignoreOffer = collision && !this.initiator;
        if (this.ignoreOffer) return;
        await this.pc!.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await this.pc!.setLocalDescription();
          this.sendSignaling!({ type: 'VOICE_SIGNAL', data: this.pc!.localDescription?.toJSON() });
        }
      }
    } catch (e) {
      console.warn('[VoiceChat] 信令处理:', (e as Error).message);
    }
  }

  toggleMic(): boolean {
    if (!this.localStream) return this.micEnabled;
    this.micEnabled = !this.micEnabled;
    this.localStream.getAudioTracks().forEach(t => t.enabled = this.micEnabled);
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

  private async setup() {
    try {
      this.setState(VoiceState.CONNECTING);
      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      }
      this.createPC();
      if (this.initiator) {
        this.makingOffer = true;
        await this.pc!.setLocalDescription();
        this.sendSignaling!({ type: 'VOICE_SIGNAL', data: this.pc!.localDescription?.toJSON() });
        this.makingOffer = false;
      }
    } catch (e) {
      this.setState(VoiceState.ERROR);
      this.callbacks?.onError(`语音初始化失败: ${e}`);
    }
  }

  private createPC() {
    this.pc?.close();
    this.pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });

    // 添加本地音频轨道
    this.localStream!.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));

    // 远端音频流
    this.pc.ontrack = (e) => {
      if (e.streams[0]) {
        this.callbacks?.onRemoteStream(e.streams[0]);
        this.startVolumeAnalysis(e.streams[0]);
      }
    };

    // ICE 候选
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignaling?.({ type: 'VOICE_SIGNAL', data: { candidate: e.candidate.toJSON() } });
      }
    };

    // 连接状态
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
  }

  private startVolumeAnalysis(remoteStream: MediaStream) {
    if (this.audioContext) return;
    try {
      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') this.audioContext.resume();

      if (this.localStream) {
        const src = this.audioContext.createMediaStreamSource(this.localStream);
        this.localAnalyser = this.audioContext.createAnalyser(); this.localAnalyser.fftSize = 256;
        src.connect(this.localAnalyser);
      }
      const src = this.audioContext.createMediaStreamSource(remoteStream);
      this.remoteAnalyser = this.audioContext.createAnalyser(); this.remoteAnalyser.fftSize = 256;
      src.connect(this.remoteAnalyser);

      this.volumeInterval = setInterval(() => {
        if (this.localAnalyser && this.callbacks?.onLocalVolume) {
          this.callbacks.onLocalVolume(this.getVolume(this.localAnalyser));
        }
        if (this.remoteAnalyser && this.callbacks?.onRemoteVolume) {
          this.callbacks.onRemoteVolume(this.getVolume(this.remoteAnalyser));
        }
      }, 100);
    } catch { /* AudioContext 不可用 */ }
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
    this.micEnabled = true; this.speakerEnabled = true;
    this.initiator = false; this.makingOffer = false; this.ignoreOffer = false;
    this.setState(VoiceState.DISCONNECTED);
  }
}