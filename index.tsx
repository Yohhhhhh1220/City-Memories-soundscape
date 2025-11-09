/**
 * @fileoverview Control real time music with a MIDI controller
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlaybackState, Prompt } from './types';
import { GoogleGenAI, LiveMusicFilteredPrompt } from '@google/genai';
import { PromptDjMidi } from './components/PromptDjMidi';
import { ToastMessage } from './components/ToastMessage';
import { LiveMusicHelper } from './utils/LiveMusicHelper';
import { AudioAnalyser } from './utils/AudioAnalyser';

// Validate API key
const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('API_KEY or GEMINI_API_KEY environment variable is not set');
  alert('APIキーが設定されていません。Vercelの環境変数設定を確認してください。');
}

const ai = new GoogleGenAI({ apiKey: apiKey || '' });
const model = 'lyria-realtime-exp';

function main() {
  const initialPrompts = buildInitialPrompts();

  const pdjMidi = new PromptDjMidi(initialPrompts);
  document.body.appendChild(pdjMidi);

  const toastMessage = new ToastMessage();
  document.body.appendChild(toastMessage);

  const liveMusicHelper = new LiveMusicHelper(ai, model);
  liveMusicHelper.setWeightedPrompts(initialPrompts);

  const audioAnalyser = new AudioAnalyser(liveMusicHelper.audioContext);
  liveMusicHelper.extraDestination = audioAnalyser.node;

  pdjMidi.addEventListener('prompts-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<Map<string, Prompt>>;
    const prompts = customEvent.detail;
    liveMusicHelper.setWeightedPrompts(prompts);
  }));

  pdjMidi.addEventListener('play-pause', () => {
    liveMusicHelper.playPause();
  });

  liveMusicHelper.addEventListener('playback-state-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<PlaybackState>;
    const playbackState = customEvent.detail;
    pdjMidi.playbackState = playbackState;
    playbackState === 'playing' ? audioAnalyser.start() : audioAnalyser.stop();
  }));

  liveMusicHelper.addEventListener('filtered-prompt', ((e: Event) => {
    const customEvent = e as CustomEvent<LiveMusicFilteredPrompt>;
    const filteredPrompt = customEvent.detail;
    toastMessage.show(filteredPrompt.filteredReason!)
    pdjMidi.addFilteredPrompt(filteredPrompt.text!);
  }));

  const errorToast = ((e: Event) => {
    const customEvent = e as CustomEvent<string>;
    const error = customEvent.detail;
    toastMessage.show(error);
  });

  liveMusicHelper.addEventListener('error', errorToast);
  pdjMidi.addEventListener('error', errorToast);

  audioAnalyser.addEventListener('audio-level-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<number>;
    const level = customEvent.detail;
    pdjMidi.audioLevel = level;
  }));

  // Listen for messages from external websites to control the prompts.
  window.addEventListener('message', (e) => {
    try {
      // Ignore messages from browser extensions (chrome-extension://, moz-extension://, etc.)
      if (e.origin && (
        e.origin.startsWith('chrome-extension://') ||
        e.origin.startsWith('moz-extension://') ||
        e.origin.startsWith('safari-extension://') ||
        e.origin.startsWith('ms-browser-extension://')
      )) {
        return;
      }

      // For security, in a real application, you should check the origin:
      // if (e.origin !== 'https://your-trusted-site.com') return;

      if (typeof e.data !== 'object' || e.data === null) return;

      // Only process messages with expected types
      if (!e.data.type || (e.data.type !== 'setWeights' && e.data.type !== 'setEmotionClickCounts')) {
        return;
      }

      switch (e.data.type) {
        case 'setWeights': {
          const weights = e.data.payload as Record<string, number>;
          if (!weights) return;

          const newPrompts = new Map<string, Prompt>();
          // Create a new map based on the current prompts and update weights
          for (const prompt of pdjMidi.prompts.values()) {
            const newPrompt = { ...prompt };
            // Set weight from payload, or 0 if not specified
            newPrompt.weight = weights[prompt.text] ?? 0;
            newPrompts.set(prompt.promptId, newPrompt);
          }
          
          // Update the UI
          pdjMidi.prompts = newPrompts;

          // Update the music generation
          liveMusicHelper.setWeightedPrompts(newPrompts);
          break;
        }
        case 'setEmotionClickCounts': {
          const counts = e.data.payload as Record<string, number>;
          if (!counts) return;
          pdjMidi.setEmotionClickCounts(counts);

          // Calculate new weights based on click counts
          const newPrompts = new Map<string, Prompt>();
          const weightFactor = 2 / 3; // 3 clicks reach max weight of 2

          for (const prompt of pdjMidi.prompts.values()) {
            const newPrompt = { ...prompt };
            const clickCount = counts[prompt.emotion] ?? 0;
            
            // Calculate weight, capping at the max value of 2
            newPrompt.weight = Math.min(2, clickCount * weightFactor);
            newPrompts.set(prompt.promptId, newPrompt);
          }
          
          // Update the UI with new weights
          pdjMidi.prompts = newPrompts;

          // Update the music generation
          liveMusicHelper.setWeightedPrompts(newPrompts);
          break;
        }
      }
    } catch (error) {
      // Silently ignore errors from browser extensions or unexpected messages
      // This prevents console errors from browser extensions
      if (error instanceof Error && !error.message.includes('message channel')) {
        console.warn('Error processing message:', error);
      }
    }
  });
}

function buildInitialPrompts() {
  // Pick 3 random prompts to start at weight = 1
  const startOn = [...DEFAULT_PROMPTS]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const prompts = new Map<string, Prompt>();

  for (let i = 0; i < DEFAULT_PROMPTS.length; i++) {
    const promptId = `prompt-${i}`;
    const prompt = DEFAULT_PROMPTS[i];
    const { text, color, emotion, japaneseEmotion } = prompt;
    prompts.set(promptId, {
      promptId,
      text,
      emotion,
      japaneseEmotion,
      weight: startOn.includes(prompt) ? 1 : 0,
      cc: i,
      color,
    });
  }

  return prompts;
}

const DEFAULT_PROMPTS = [
  // Positive Valence
  { color: '#ffc8dd', emotion: 'Excited', japaneseEmotion: 'わくわくする', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Strictly major key (厳格に長調であること), no minor keys or dark melodies allowed (短調や暗いメロディは一切許可しない). Uplifting, hopeful, wonder, and full of bright anticipation. Shimmering, sparkling, bright chimes and bells with a fast, light decay. Crystal-clear arpeggios playing playful, fast, light, ascending progressions and patterns (楽しげで、速く、軽い、上行系の進行とパターン). Evolving dense harmony (進化する濃密なハーモニー), and bright, airy harmony (明るく空気感のあるハーモニー), avoiding heavy or dense sounds. Lush, bright synth pads. A sense of gentle crescendo, rising pitch, gentle, uplifting swells (優しく高揚する音のうねり), and a rising, positive energy, building anticipation. A feeling of wonder, bright exploration, and cosmic nebula exploration.' },
  { color: '#bde0fe', emotion: 'Joyful', japaneseEmotion: '楽しい', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Joyful, euphoric, heartwarming. Playful, bouncing melodic fragments (弾むようなメディ断片). Glowing, warm pads and a lush string section playing clear consonant harmony. Gentle, flowing movement. Bright major key and sweet timbre (甘い音色). A feeling of gentle light beams.' },
  { color: '#a3b18a', emotion: 'Calm', japaneseEmotion: '穏やか', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Serene, tranquil, meditative. Extremely slow-moving harmony with minimal variation (変化の極めて少ない). Long, sustained drone pads (長く持続するドローン). Smooth transitions. Representing calm water with gentle, fluid sound textures. Soft, ethereal pads. Peaceful, luminous, very slow tempo.' },
  { color: '#fefae0', emotion: 'Content', japaneseEmotion: '満たされている', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Contented, warm, comforting. Rich overtones (豊かな倍音) and warm string pads with a soft attack. Slow, gentle arpeggios that always resolve (常に解決する). Stable, perfectly consonant harmony (安定した完全協和音). A feeling of satisfaction and inner peace, like soft sunlight on a peaceful meadow.' },
  
  // Negative Valence
  { color: '#b5838d', emotion: 'Lonely', japaneseEmotion: '孤独を感じる', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Introspective, solemn, isolated. Extremely sparse instrumentation (極端にまばらな楽器). A single, distant solo instrument (遠くのソロ楽器) like a flute or cello, with heavy reverb and long distant echoes. Lots of empty space and silence. Slow-panning textures creating a vast, empty mix. Melancholic minor key.' },
  { color: '#e5989b', emotion: 'Tired', japaneseEmotion: '疲れている', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Low energy, drained, heavy. Blurred, indistinct textures. Muffled sounds, as if under a heavy low-pass filter. Slowly detuned synth pads with a noticeable pitch drift (顕著な音程の揺らぎ). A feeling of gentle pitch descending (ゆっくりとピッチが下がる感覚). Foggy landscape. Very slow tempo. Minor key.' },
  { color: '#ffddd2', emotion: 'Irritated', japaneseEmotion: 'いらいらする', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Disoriented, confusing, quietly agitated. Atonal pads with mildly clashing frequencies (穏やかに衝突する周波数). Random, unpredictable short staccato sounds that appear briefly. Subtle glitch sounds. Unstable harmony that never resolves. A confusing, unstable feeling.' },
  { color: '#ffb4a2', emotion: 'Anxious / Rushed', japaneseEmotion: '焦っている', text: 'Absolutely no drums, completely without bass. Ambient, quiet soundscape, calm atmosphere. Tense, unsettling, suspenseful. A persistent, high-pitched, sharp drone (持続する高音の鋭いドローン). A quiet but fast, subtle pulse (静かだが速い、微細な鼓動). Dissonant undertones and unresolved chords. Subtle, nervous chromatic movements (神経質な半音階の動き) in the pads. A quiet, urgent feeling.' },
];

main();