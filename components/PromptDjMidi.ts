/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { throttle } from '../utils/throttle';

import './PromptController';
import './PlayPauseButton';
import type { PlaybackState, Prompt } from '../types';
import { MidiDispatcher } from '../utils/MidiDispatcher';

/** The grid of prompt inputs. */
@customElement('prompt-dj-midi')
// FIX: The 'PromptDjMidi' class must extend 'LitElement' to function as a proper web component.
export class PromptDjMidi extends LitElement {
  static override styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
      position: relative;
    }
    #background {
      will-change: background-image;
      position: absolute;
      height: 100%;
      width: 100%;
      z-index: -1;
      background: #111;
    }
    #logo {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 360px;
      height: 120px;
      z-index: 10;
    }
    #logo svg,
    #logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    #grid {
      width: 35vmin;
      height: 70vmin;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2vmin;
      margin-top: 3vmin;
    }
    prompt-controller {
      width: 100%;
    }
    play-pause-button {
      position: relative;
      width: 10vmin;
    }
    #buttons {
      position: absolute;
      top: 0;
      left: 0;
      padding: 5px;
      display: flex;
      gap: 5px;
    }
    button {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      background: #0002;
      -webkit-font-smoothing: antialiased;
      border: 1.5px solid #fff;
      border-radius: 4px;
      user-select: none;
      padding: 3px 6px;
      &.active {
        background-color: #fff;
        color: #000;
      }
    }
    select {
      font: inherit;
      padding: 5px;
      background: #fff;
      color: #000;
      border-radius: 4px;
      border: none;
      outline: none;
      cursor: pointer;
    }
  `;

  @property({ type: Object }) prompts: Map<string, Prompt>;
  private midiDispatcher: MidiDispatcher;

  @property({ type: Boolean }) private showMidi = false;
  @property({ type: String }) public playbackState: PlaybackState = 'stopped';
  @state() public audioLevel = 0;
  @state() private midiInputIds: string[] = [];
  @state() private activeMidiInputId: string | null = null;
  @state() private emotionClickCounts = new Map<string, number>();

  @property({ type: Object })
  private filteredPrompts = new Set<string>();

  constructor(
    initialPrompts: Map<string, Prompt>,
  ) {
    super();
    this.prompts = initialPrompts;
    this.midiDispatcher = new MidiDispatcher();
  }

  private handlePromptChanged(e: CustomEvent<Prompt>) {
    const prompt = this.prompts.get(e.detail.promptId);
    if (!prompt) return;

    // Preserve original text and emotion
    const updatedPrompt: Prompt = {
      ...prompt,
      weight: e.detail.weight,
      cc: e.detail.cc,
    };

    const newPrompts = new Map(this.prompts);
    newPrompts.set(e.detail.promptId, updatedPrompt);

    this.prompts = newPrompts;
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent('prompts-changed', { detail: this.prompts }),
    );
  }

  /** Generates radial gradients for each prompt based on weight and color. */
  private readonly makeBackground = throttle(
    () => {
      const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

      const MAX_WEIGHT = 0.5;
      const MAX_ALPHA = 0.6;

      const bg: string[] = [];

      [...this.prompts.values()].forEach((p, i) => {
        const alphaPct = clamp01(p.weight / MAX_WEIGHT) * MAX_ALPHA;
        const alpha = Math.round(alphaPct * 0xff)
          .toString(16)
          .padStart(2, '0');

        const stop = p.weight / 2;
        const x = (i % 2) / 1;
        const y = Math.floor(i / 2) / 3;
        const s = `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${p.color}${alpha} 0px, ${p.color}00 ${stop * 100}%)`;

        bg.push(s);
      });

      return bg.join(', ');
    },
    30, // don't re-render more than once every XXms
  );

  private toggleShowMidi() {
    return this.setShowMidi(!this.showMidi);
  }

  public async setShowMidi(show: boolean) {
    this.showMidi = show;
    if (!this.showMidi) return;
    try {
      const inputIds = await this.midiDispatcher.getMidiAccess();
      this.midiInputIds = inputIds;
      this.activeMidiInputId = this.midiDispatcher.activeMidiInputId;
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
    }
  }

  private setActiveMidiInput(id: string) {
    this.activeMidiInputId = id;
    this.midiDispatcher.activeMidiInputId = id;
  }

  private handlePlayPause() {
    this.dispatchEvent(new CustomEvent('play-pause'));
  }

  public addFilteredPrompt(promptText: string) {
    this.filteredPrompts = new Set([...this.filteredPrompts, promptText]);
  }

  public setEmotionClickCounts(counts: Record<string, number>) {
    this.emotionClickCounts = new Map(Object.entries(counts));
  }

  private openController() {
    const controllerHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Emotion Controller</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500&display=swap');
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    body {
        font-family: 'Noto Sans JP', sans-serif;
        line-height: 1.6;
        color: #333;
        background: #f8f6f0;
        min-height: 100vh;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px;
    }
    #logo {
        margin-bottom: 20px;
        width: 600px;
        height: 180px;
    }
    #logo svg,
    #logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    h1 {
        font-size: 1.8rem;
        margin-bottom: 30px;
        color: #2c3e50;
        text-align: center;
        font-weight: 400;
        line-height: 1.4;
    }
    .mood-options {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 15px;
        max-width: 800px;
        margin: 0 auto;
        width: 100%;
    }
    .mood-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px 15px;
        background: white;
        border: 2px solid #e9ecef;
        border-radius: 15px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        min-height: 100px;
    }
    .mood-option:hover {
        border-color: #8e44ad;
        background: #fbf5ff;
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(142, 68, 173, 0.2);
    }
    .mood-option:active {
        transform: scale(0.95);
        background: #f0f2ff;
    }
    .mood-option.clicked {
        background: #8e44ad;
        color: white;
        border-color: #8e44ad;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(142, 68, 173, 0.3);
    }
    .mood-option.clicked .mood-text,
    .mood-option.clicked .english-label {
        color: white;
    }
    .mood-emoji {
        font-size: 2rem;
        margin-bottom: 8px;
        transition: transform 0.3s ease;
    }
    .mood-text {
        font-size: 0.9rem;
        font-weight: 500;
        line-height: 1.2;
        color: #333;
    }
    .english-label {
        font-size: 0.8em;
        opacity: 0.8;
    }
    @media (max-width: 600px) {
      .mood-options {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      .mood-emoji {
        font-size: 1.5rem;
      }
      .mood-text {
        font-size: 0.8rem;
      }
    }
  </style>
</head>
<body>
  <div id="logo">
    <img src="/logo.svg" alt="City Memories" />
  </div>
  <h1>あなたの今の気分を選びましょう！<br><span style="font-size: 0.7em; font-weight: 300;">Choose your current mood!</span></h1>
  <div class="mood-options" id="controller"></div>
  <script>
    const emotions = [
      { name: 'Excited', emoji: '🤩', label: 'わくわくする', englishLabel: 'Excited' },
      { name: 'Joyful', emoji: '😊', label: '楽しい', englishLabel: 'Joyful' },
      { name: 'Calm', emoji: '😌', label: '穏やか', englishLabel: 'Calm' },
      { name: 'Content', emoji: '🥰', label: '満たされている', englishLabel: 'Content' },
      { name: 'Lonely', emoji: '😢', label: '孤独を感じる', englishLabel: 'Lonely' },
      { name: 'Tired', emoji: '😴', label: '疲れている', englishLabel: 'Tired' },
      { name: 'Irritated', emoji: '😠', label: 'いらいらする', englishLabel: 'Irritated' },
      { name: 'Anxious / Rushed', emoji: '😰', label: '焦っている', englishLabel: 'Anxious / Rushed' },
    ];
    const controller = document.getElementById('controller');
    const emotionClicks = {};
    const mainAppWindow = window.opener;

    emotions.forEach(emotion => {
      emotionClicks[emotion.name] = [];
      const button = document.createElement('div');
      button.className = 'mood-option';
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'mood-emoji';
      emojiSpan.textContent = emotion.emoji;
      const textSpan = document.createElement('span');
      textSpan.className = 'mood-text';
      textSpan.innerHTML = \`\${emotion.label}<br><span class="english-label">\${emotion.englishLabel}</span>\`;
      button.appendChild(emojiSpan);
      button.appendChild(textSpan);

      button.addEventListener('click', () => {
        emotionClicks[emotion.name].push(Date.now());
        
        // Visual feedback
        button.classList.add('clicked');
        setTimeout(() => {
          button.classList.remove('clicked');
        }, 1000);

        updateAndSendCounts();
      });
      controller.appendChild(button);
    });

    function updateAndSendCounts() {
      const now = Date.now();
      const clickCounts = {};
      const oneMinuteAgo = now - 60000; // 1 minute in milliseconds

      emotions.forEach(emotion => {
        const activeClicks = emotionClicks[emotion.name].filter(timestamp => timestamp > oneMinuteAgo);
        emotionClicks[emotion.name] = activeClicks;
        clickCounts[emotion.name] = activeClicks.length;
      });

      if (mainAppWindow) {
        mainAppWindow.postMessage({
          type: 'setEmotionClickCounts',
          payload: clickCounts
        }, '*');
      } else {
        console.warn('Could not find the main application window.');
      }
    }

    setInterval(updateAndSendCounts, 1000);

  <\/script>
</body>
</html>
    `;
    const controllerWindow = window.open('', 'EmotionController', 'width=850,height=400,resizable,scrollbars=yes,status=1');
    if (controllerWindow) {
      controllerWindow.document.write(controllerHtml);
      controllerWindow.document.close();
    }
  }

  override render() {
    return html` <div
        id="background"
        style=${styleMap({
      backgroundImage: this.makeBackground(),
    })}></div>

      <div id="logo">
        <img src="/logo.svg" alt="City Memories" />
      </div>

      <play-pause-button
        playbackState=${this.playbackState}
        @click=${this.handlePlayPause}></play-pause-button>

      <div id="grid">
        ${[...this.prompts.values()].map(
      (p) => html` <prompt-controller
              .promptId=${p.promptId}
              .text=${p.text}
              .emotion=${p.emotion}
              .japaneseEmotion=${p.japaneseEmotion}
              .weight=${p.weight}
              .color=${p.color}
              .cc=${p.cc}
              .showCC=${this.showMidi}
              .audioLevel=${this.audioLevel}
              .midiDispatcher=${this.midiDispatcher}
              ?filtered=${this.filteredPrompts.has(p.text)}
              .clickCount=${this.emotionClickCounts.get(p.emotion) ?? 0}
              @prompt-changed=${this.handlePromptChanged}></prompt-controller>`,
    )}
      </div>
      <div id="buttons">
        <button @click=${this.openController}>Open Controller</button>
        <button
          @click=${this.toggleShowMidi}
          class=${this.showMidi ? 'active' : ''}>
          MIDI
        </button>
        ${this.showMidi && this.midiInputIds.length > 0
      ? html`<select
              @change=${(e: Event) =>
      this.setActiveMidiInput((e.target as HTMLSelectElement).value)}>
              ${this.midiInputIds.map(
        (id) =>
          html`<option
                    value=${id}
                    ?selected=${id === this.activeMidiInputId}>
                    ${this.midiDispatcher.getDeviceName(id)}
                  </option>`,
      )}
            </select>`
      : ''}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj-midi': PromptDjMidi;
  }
}