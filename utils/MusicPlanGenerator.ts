/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { MusicPlan } from '../types';

export class MusicPlanGenerator {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * ユーザーの音楽イメージからMusicPlanを生成
   * @param userRequest ユーザーの音楽イメージ（例: "1分ぐらいの朝に聞く爽やかなプログレッシブハウス"）
   * @param totalSeconds 総再生時間（秒）
   */
  public async generateMusicPlan(userRequest: string, totalSeconds: number): Promise<MusicPlan> {
    const prompt = this.buildPrompt(userRequest, totalSeconds);
    
    try {
      if (!this.apiKey) {
        throw new Error('APIキーが設定されていません');
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API呼び出しエラー: ${response.status} ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error('APIレスポンスからテキストを取得できませんでした');
      }

      // JSONを抽出（```json で囲まれている場合がある）
      let jsonText = text.trim();
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }

      const musicPlan = JSON.parse(jsonText) as MusicPlan;
      
      // バリデーション
      if (!musicPlan.title || !Array.isArray(musicPlan.stanzas)) {
        throw new Error('生成されたMusicPlanの形式が正しくありません');
      }

      return musicPlan;
    } catch (error: any) {
      console.error('MusicPlan生成エラー:', error);
      throw new Error(`MusicPlanの生成に失敗しました: ${error.message}`);
    }
  }

  /**
   * LLM用のプロンプトを構築
   */
  private buildPrompt(userRequest: string, totalSeconds: number): string {
    return `あなたは音楽生成の専門家です。ユーザーの音楽イメージに基づいて、Lyria RealTime用のMusicPlanを生成してください。

ユーザーのリクエスト: "${userRequest}"
総再生時間: ${totalSeconds}秒

MusicPlanは以下のJSON形式で返してください:

{
  "title": "音楽のタイトル",
  "stanzas": [
    {
      "prompts": [
        {"text": "プロンプト1", "weight": 2.0},
        {"text": "プロンプト2", "weight": 1.0}
      ],
      "seconds": 15,
      "config": {
        "bpm": 125,
        "mute_bass": false,
        "mute_drums": false,
        "temperature": 1.0
      }
    }
  ]
}

重要な注意事項:
1. stanzas配列の各要素は、音楽の異なるセクション（Stanza）を表します
2. 各Stanzaのsecondsの合計が総再生時間になるようにしてください
3. promptsはWeightedPromptの配列で、text（文字列）とweight（数値）を持ちます
4. weightは0.0から2.0の範囲で、プロンプトの重要度を表します
5. configはオプションで、bpm、mute_bass、mute_drums、scale、temperatureを設定できます
6. 音楽の変化を自然にするため、隣接するStanza間でweightを徐々に変化させてください
7. 急激な変化を避け、スムーズなトランジションを心がけてください

ユーザーのリクエストに基づいて、適切なMusicPlanを生成してください。JSONのみを返してください。`;
  }
}

