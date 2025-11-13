/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { MusicPlan, MusicStanza } from '../types';
import type { GoogleGenAI, LiveMusicSession, LiveMusicServerMessage } from '@google/genai';
import { decode, decodeAudioData } from './audio';

export class LongMusicGenerator extends EventTarget {
  private ai: GoogleGenAI;
  private model: string;
  private audioContext: AudioContext;
  private audioData: Uint8Array[] = [];
  private session: LiveMusicSession | null = null;
  private isGenerating = false;

  constructor(ai: GoogleGenAI, model: string) {
    super();
    this.ai = ai;
    this.model = model;
    this.audioContext = new AudioContext({ sampleRate: 48000 });
  }

  /**
   * 長い音楽を生成します
   * @param musicPlan 音楽生成プラン
   */
  public async generateMusic(musicPlan: MusicPlan): Promise<Blob> {
    if (this.isGenerating) {
      throw new Error('既に音楽生成が進行中です');
    }

    this.isGenerating = true;
    this.audioData = [];

    try {
      // WebSocket接続を確立
      this.session = await this.ai.live.music.connect({
        model: this.model,
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
            if (e.serverContent?.audioChunks) {
              await this.processAudioChunks(e.serverContent.audioChunks);
            }
          },
          onerror: (error?: Error) => {
            console.error('音楽生成エラー:', error);
            this.dispatchEvent(new CustomEvent('error', { 
              detail: error?.message || '音楽生成中にエラーが発生しました' 
            }));
          },
          onclose: () => {
            console.log('WebSocket接続が閉じられました');
          },
        },
      });

      // 各Stanzaを順番に処理
      for (let i = 0; i < musicPlan.stanzas.length; i++) {
        const stanza = musicPlan.stanzas[i];
        this.dispatchEvent(new CustomEvent('progress', { 
          detail: { 
            current: i + 1, 
            total: musicPlan.stanzas.length,
            stanza: stanza 
          } 
        }));

        // プロンプトを設定
        await this.session.setWeightedPrompts({
          weightedPrompts: stanza.prompts.map(p => ({
            text: p.text,
            weight: p.weight,
          })),
        });

        // 音楽生成設定を適用
        if (stanza.config) {
          const config: any = {};
          if (stanza.config.bpm !== undefined) {
            config.bpm = stanza.config.bpm;
          }
          if (stanza.config.temperature !== undefined) {
            config.temperature = stanza.config.temperature;
          }
          if (stanza.config.scale) {
            config.scale = stanza.config.scale;
          }
          if (stanza.config.mute_bass !== undefined) {
            config.muteBass = stanza.config.mute_bass;
          }
          if (stanza.config.mute_drums !== undefined) {
            config.muteDrums = stanza.config.mute_drums;
          }

          await this.session.setMusicGenerationConfig(config);
        }

        // 音楽生成を開始（最初のStanzaのみ）
        if (i === 0) {
          await this.session.play();
        }

        // Stanzaの時間分待機
        await this.sleep(stanza.seconds * 1000);

        // BPMやスケールが変更される場合は、コンテキストをリセット
        if (i < musicPlan.stanzas.length - 1) {
          const nextStanza = musicPlan.stanzas[i + 1];
          if (nextStanza.config?.bpm !== stanza.config?.bpm || 
              nextStanza.config?.scale !== stanza.config?.scale) {
            // コンテキストリセットのため、一度停止して再開
            await this.session.pause();
            await this.sleep(100);
            await this.session.play();
          }
        }
      }

      // 音楽生成を停止
      await this.session.stop();
      await this.sleep(500); // 最後のデータを受信するまで少し待機

      // 受信したオーディオデータを結合してBlobを作成
      const totalLength = this.audioData.reduce((sum, arr) => sum + arr.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const arr of this.audioData) {
        combined.set(arr, offset);
        offset += arr.length;
      }

      // WAVファイルとしてBlobを作成
      const wavBlob = this.createWavFile(combined, 48000, 2);
      
      this.isGenerating = false;
      return wavBlob;

    } catch (error: any) {
      this.isGenerating = false;
      const errorMessage = error?.message || '音楽生成に失敗しました';
      this.dispatchEvent(new CustomEvent('error', { detail: errorMessage }));
      throw error;
    } finally {
      if (this.session) {
        try {
          await this.session.stop();
        } catch (e) {
          // エラーを無視
        }
        this.session = null;
      }
    }
  }

  /**
   * オーディオチャンクを処理して保存
   */
  private async processAudioChunks(audioChunks: any[]) {
    for (const chunk of audioChunks) {
      if (chunk.data) {
        const audioBytes = decode(chunk.data);
        this.audioData.push(audioBytes);
      }
    }
  }

  /**
   * PCMデータからWAVファイルを作成
   */
  private createWavFile(pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob {
    const length = pcmData.length;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);

    // WAVヘッダーを書き込み
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, length, true);

    // PCMデータをコピー
    const pcmView = new Uint8Array(buffer, 44);
    pcmView.set(pcmData);

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * 指定時間待機
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 生成をキャンセル
   */
  public async cancel(): Promise<void> {
    if (this.session) {
      await this.session.stop();
      this.session = null;
    }
    this.isGenerating = false;
    this.audioData = [];
  }
}

