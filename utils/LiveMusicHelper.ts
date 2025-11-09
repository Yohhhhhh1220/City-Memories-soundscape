/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { PlaybackState, Prompt } from '../types';
import type { AudioChunk, GoogleGenAI, LiveMusicFilteredPrompt, LiveMusicServerMessage, LiveMusicSession } from '@google/genai';
import { decode, decodeAudioData } from './audio';
import { throttle } from './throttle';

export class LiveMusicHelper extends EventTarget {

  private ai: GoogleGenAI;
  private model: string;

  private session: LiveMusicSession | null = null;
  private sessionPromise: Promise<LiveMusicSession> | null = null;

  private connectionError = true;

  private filteredPrompts = new Set<string>();
  private nextStartTime = 0;
  private bufferTime = 2;

  public readonly audioContext: AudioContext;
  public extraDestination: AudioNode | null = null;

  private outputNode: GainNode;
  private playbackState: PlaybackState = 'stopped';

  private prompts: Map<string, Prompt>;

  constructor(ai: GoogleGenAI, model: string) {
    super();
    this.ai = ai;
    this.model = model;
    this.prompts = new Map();
    this.audioContext = new AudioContext({ sampleRate: 48000 });
    this.outputNode = this.audioContext.createGain();
  }

  private getSession(): Promise<LiveMusicSession> {
    if (!this.sessionPromise) this.sessionPromise = this.connect();
    return this.sessionPromise;
  }

  private async connect(): Promise<LiveMusicSession> {
    try {
      console.log('WebSocket接続を開始します...');
      this.sessionPromise = this.ai.live.music.connect({
        model: this.model,
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
            if (e.setupComplete) {
              console.log('WebSocket接続が確立されました');
              this.connectionError = false;
            }
            if (e.filteredPrompt) {
              this.filteredPrompts = new Set([...this.filteredPrompts, e.filteredPrompt.text!])
              this.dispatchEvent(new CustomEvent<LiveMusicFilteredPrompt>('filtered-prompt', { detail: e.filteredPrompt }));
            }
            if (e.serverContent?.audioChunks) {
              await this.processAudioChunks(e.serverContent.audioChunks);
            }
          },
          onerror: (error?: Error) => {
            console.error('WebSocket接続エラー:', error);
            this.connectionError = true;
            this.stop();
            let errorMessage = 'WebSocket接続エラーが発生しました。';
            if (error?.message) {
              errorMessage += `\n詳細: ${error.message}`;
            }
            errorMessage += '\n\n確認事項:\n1. APIキーが正しく設定されているか\n2. APIキーが有効か（Gemini APIの制限を確認）\n3. ネットワーク接続が正常か';
            this.dispatchEvent(new CustomEvent('error', { detail: errorMessage }));
          },
          onclose: (event?: CloseEvent) => {
            console.warn('WebSocket接続が閉じられました', event);
            this.connectionError = true;
            this.stop();
            let errorMessage = 'WebSocket接続が閉じられました。';
            if (event) {
              errorMessage += `\nコード: ${event.code}`;
              if (event.reason) {
                errorMessage += `\n理由: ${event.reason}`;
              }
            }
            errorMessage += '\n\n確認事項:\n1. APIキーが正しく設定されているか（Vercelの環境変数を確認）\n2. APIキーが有効で、Gemini APIのアクセス権限があるか\n3. ネットワーク接続が正常か\n4. ファイアウォールがWebSocket接続をブロックしていないか';
            this.dispatchEvent(new CustomEvent('error', { detail: errorMessage }));
          },
        },
      });
      return this.sessionPromise;
    } catch (error: any) {
      console.error('接続エラー:', error);
      this.connectionError = true;
      let errorMessage = '接続に失敗しました。';
      if (error?.message) {
        errorMessage += `\n詳細: ${error.message}`;
      }
      errorMessage += '\n\n確認事項:\n1. APIキーが正しく設定されているか\n2. APIキーが有効か\n3. ネットワーク接続が正常か';
      this.dispatchEvent(new CustomEvent('error', { detail: errorMessage }));
      throw error;
    }
  }

  private setPlaybackState(state: PlaybackState) {
    this.playbackState = state;
    this.dispatchEvent(new CustomEvent('playback-state-changed', { detail: state }));
  }

  private async processAudioChunks(audioChunks: AudioChunk[]) {
    if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
    const audioBuffer = await decodeAudioData(
      decode(audioChunks[0].data!),
      this.audioContext,
      48000,
      2,
    );
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode);
    if (this.nextStartTime === 0) {
      this.nextStartTime = this.audioContext.currentTime + this.bufferTime;
      setTimeout(() => {
        this.setPlaybackState('playing');
      }, this.bufferTime * 1000);
    }
    if (this.nextStartTime < this.audioContext.currentTime) {
      this.setPlaybackState('loading');
      this.nextStartTime = 0;
      return;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
  }

  public get activePrompts() {
    return Array.from(this.prompts.values())
      .filter((p) => {
        return !this.filteredPrompts.has(p.text) && p.weight !== 0;
      })
  }

  public readonly setWeightedPrompts = throttle(async (prompts: Map<string, Prompt>) => {
    this.prompts = prompts;

    if (this.activePrompts.length === 0) {
      this.dispatchEvent(new CustomEvent('error', { detail: 'There needs to be one active prompt to play.' }));
      this.pause();
      return;
    }

    // store the prompts to set later if we haven't connected yet
    // there should be a user interaction before calling setWeightedPrompts
    if (!this.session) return;

    const weightedPrompts = this.activePrompts.map((p) => {
      return {text: p.text, weight: p.weight};
    });
    try {
      await this.session.setWeightedPrompts({
        weightedPrompts,
      });
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
      this.pause();
    }
  }, 200);

  public async play() {
    try {
      this.setPlaybackState('loading');
      this.session = await this.getSession();
      await this.setWeightedPrompts(this.prompts);
      await this.audioContext.resume();
      this.session.play();
      this.outputNode.connect(this.audioContext.destination);
      if (this.extraDestination) this.outputNode.connect(this.extraDestination);
      this.outputNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1);
    } catch (error: any) {
      this.setPlaybackState('stopped');
      const errorMessage = error?.message || '再生に失敗しました。APIキーとネットワーク接続を確認してください。';
      this.dispatchEvent(new CustomEvent('error', { detail: errorMessage }));
    }
  }

  public pause() {
    if (this.session) this.session.pause();
    this.setPlaybackState('paused');
    this.outputNode.gain.setValueAtTime(1, this.audioContext.currentTime);
    this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    this.nextStartTime = 0;
    this.outputNode = this.audioContext.createGain();
  }

  public stop() {
    if (this.session) this.session.stop();
    this.setPlaybackState('stopped');
    this.outputNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.1);
    this.nextStartTime = 0;
    this.session = null;
    this.sessionPromise = null;
  }

  public async playPause() {
    switch (this.playbackState) {
      case 'playing':
        return this.pause();
      case 'paused':
      case 'stopped':
        return this.play();
      case 'loading':
        return this.stop();
    }
  }

}