/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export interface Prompt {
  readonly promptId: string;
  text: string;
  emotion: string;
  japaneseEmotion: string;
  weight: number;
  cc: number;
  color: string;
}

export interface ControlChange {
  channel: number;
  cc: number;
  value: number;
}

export type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

// Long Music Generation Types
export interface WeightedPrompt {
  text: string;
  weight: number;
}

export interface MusicStanzaConfig {
  bpm?: number;
  mute_bass?: boolean;
  mute_drums?: boolean;
  scale?: string;
  temperature?: number;
}

export interface MusicStanza {
  prompts: WeightedPrompt[];
  seconds: number;
  config?: MusicStanzaConfig;
}

export interface MusicPlan {
  title: string;
  stanzas: MusicStanza[];
}