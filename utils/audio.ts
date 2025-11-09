/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const frameCount = data.length / 2 / numChannels;
  const buffer = ctx.createBuffer(
    numChannels,
    frameCount,
    sampleRate,
  );

  const dataInt16 = new Int16Array(data.buffer);

  // De-interleave and convert PCM data from Int16 to Float32.
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize to [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }

  return buffer;
}

export { decode, decodeAudioData };