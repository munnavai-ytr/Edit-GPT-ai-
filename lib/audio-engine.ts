import {EditDecisionList, SoundEffectType} from './types';

function encodeStereoWav16(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;

    if (numChannels > 1) {
      const s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

function scheduleProceduralSfx(
  offline: OfflineAudioContext,
  destination: AudioNode,
  sfxType: SoundEffectType,
  timeSec: number,
  volume: number
): void {
  if (sfxType === 'none' || volume <= 0.001) return;
  const start = Math.max(0.01, timeSec);

  if (sfxType === 'pop_subtle' || sfxType === 'click_clean') {
    const osc = offline.createOscillator();
    const gain = offline.createGain();
    osc.type = 'sine';
    const dur = sfxType === 'pop_subtle' ? 0.09 : 0.045;
    osc.frequency.setValueAtTime(sfxType === 'pop_subtle' ? 280 : 620, start);
    osc.frequency.exponentialRampToValueAtTime(
      sfxType === 'pop_subtle' ? 520 : 180,
      start + dur
    );

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume * 0.45, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + dur + 0.01);
    return;
  }

  // Filtered noise sweep for whoosh_soft and riser_cinematic
  const dur = sfxType === 'riser_cinematic' ? 0.55 : 0.26;
  const frameCount = Math.ceil(dur * offline.sampleRate);
  const noiseBuf = offline.createBuffer(1, frameCount, offline.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const src = offline.createBufferSource();
  src.buffer = noiseBuf;

  const filter = offline.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = sfxType === 'riser_cinematic' ? 2.4 : 1.4;
  filter.frequency.setValueAtTime(
    sfxType === 'riser_cinematic' ? 220 : 340,
    start
  );
  filter.frequency.exponentialRampToValueAtTime(
    sfxType === 'riser_cinematic' ? 1650 : 1200,
    start + dur * 0.75
  );
  filter.frequency.exponentialRampToValueAtTime(280, start + dur);

  const gain = offline.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume * 0.4, start + dur * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  src.start(start);
  src.stop(start + dur + 0.01);
}

export async function renderMasterAudioMix(params: {
  edl: EditDecisionList;
  voiceBlob: Blob;
  musicBlob?: Blob;
  onProgress?: (detail: string) => void;
}): Promise<Uint8Array> {
  const {edl, voiceBlob, musicBlob, onProgress} = params;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;

  const decodeCtx = new AudioCtx();
  try {
    onProgress?.('Decoding master voiceover track...');
    const voiceAb = await voiceBlob.arrayBuffer();
    const voiceBuf = await decodeCtx.decodeAudioData(voiceAb.slice(0));

    let musicBuf: AudioBuffer | null = null;
    if (musicBlob && edl.audioMix.musicAssetId && edl.audioMix.musicVolume > 0) {
      try {
        onProgress?.('Decoding background music track...');
        const musicAb = await musicBlob.arrayBuffer();
        musicBuf = await decodeCtx.decodeAudioData(musicAb.slice(0));
      } catch {
        musicBuf = null;
      }
    }

    const sampleRate = 44100;
    const totalDuration = Math.max(1, edl.totalDuration);
    const totalFrames = Math.ceil(totalDuration * sampleRate);
    const offline = new OfflineAudioContext(2, totalFrames, sampleRate);

    // Master brickwall peak limiter to prevent any digital clipping
    const masterLimiter = offline.createDynamicsCompressor();
    masterLimiter.threshold.value = -1.2;
    masterLimiter.knee.value = 3;
    masterLimiter.ratio.value = 16;
    masterLimiter.attack.value = 0.002;
    masterLimiter.release.value = 0.12;

    const masterFadeGain = offline.createGain();
    const fadeIn = Math.max(0.05, Math.min(1.5, edl.audioMix.fadeInSeconds));
    const fadeOut = Math.max(0.1, Math.min(2.5, edl.audioMix.fadeOutSeconds));

    masterFadeGain.gain.setValueAtTime(0.001, 0);
    masterFadeGain.gain.linearRampToValueAtTime(1.0, Math.min(totalDuration * 0.25, fadeIn));
    if (totalDuration > fadeOut + 0.5) {
      masterFadeGain.gain.setValueAtTime(1.0, totalDuration - fadeOut);
      masterFadeGain.gain.linearRampToValueAtTime(0.0001, totalDuration);
    }

    masterLimiter.connect(masterFadeGain);
    masterFadeGain.connect(offline.destination);

    // Compute voiceover peak for clean loudness normalization (target -1.5 dBFS = 0.841)
    const vCh0 = voiceBuf.getChannelData(0);
    let voicePeak = 0;
    let voiceRmsSq = 0;
    const maxVoiceSamples = Math.min(
      vCh0.length,
      Math.ceil(totalDuration * voiceBuf.sampleRate)
    );
    for (let i = 0; i < maxVoiceSamples; i++) {
      const a = Math.abs(vCh0[i]);
      if (a > voicePeak) voicePeak = a;
      voiceRmsSq += vCh0[i] * vCh0[i];
    }
    const voiceRms = Math.sqrt(voiceRmsSq / Math.max(1, maxVoiceSamples));
    const normFactor =
      edl.audioMix.normalizeVoice && voicePeak > 0.02
        ? Math.min(2.6, 0.841 / voicePeak)
        : 1.0;

    const voiceSrc = offline.createBufferSource();
    voiceSrc.buffer = voiceBuf;

    let lastVoiceNode: AudioNode = voiceSrc;

    // Optional clean rumble filtering (high-pass at 80Hz) without distorting voice timbre
    if (edl.audioMix.noiseReduction) {
      const hp = offline.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 80;
      hp.Q.value = 0.707;
      lastVoiceNode.connect(hp);
      lastVoiceNode = hp;
    }

    const voiceGain = offline.createGain();
    voiceGain.gain.value = normFactor * edl.audioMix.voiceVolume;
    lastVoiceNode.connect(voiceGain);
    voiceGain.connect(masterLimiter);
    voiceSrc.start(0, 0, Math.min(voiceBuf.duration, totalDuration));

    // Background Music with automatic speech-envelope ducking
    if (musicBuf && edl.audioMix.musicVolume > 0) {
      onProgress?.('Applying background music ducking under voiceover...');
      const musicGain = offline.createGain();
      const baseVol = Math.max(0, Math.min(0.6, edl.audioMix.musicVolume));
      const duckedVol = baseVol * 0.28;

      if (edl.audioMix.duckingEnabled) {
        const stepSec = 0.1;
        const stepSamples = Math.max(1, Math.floor(voiceBuf.sampleRate * stepSec));
        const speechThreshold = Math.max(0.015, voiceRms * 0.25);

        musicGain.gain.setValueAtTime(baseVol * 0.85, 0);
        for (let t = 0; t < totalDuration; t += stepSec) {
          const sStart = Math.floor(t * voiceBuf.sampleRate);
          const sEnd = Math.min(vCh0.length, sStart + stepSamples);
          let sum = 0;
          for (let j = sStart; j < sEnd; j++) {
            sum += vCh0[j] * vCh0[j];
          }
          const windowRms =
            sEnd > sStart ? Math.sqrt(sum / (sEnd - sStart)) : 0;
          const isSpeaking = windowRms >= speechThreshold;
          const target = isSpeaking ? duckedVol : baseVol * 0.88;
          musicGain.gain.setTargetAtTime(target, t, 0.08);
        }
      } else {
        musicGain.gain.setValueAtTime(baseVol, 0);
      }

      musicGain.connect(masterLimiter);

      // Loop music seamlessly if shorter than totalDuration
      let musicCursor = 0;
      const musicTrackDur = Math.max(0.5, musicBuf.duration);
      while (musicCursor < totalDuration - 0.05) {
        const mSrc = offline.createBufferSource();
        mSrc.buffer = musicBuf;
        const playLen = Math.min(musicTrackDur, totalDuration - musicCursor);
        mSrc.connect(musicGain);
        mSrc.start(musicCursor, 0, playLen);
        musicCursor += playLen;
      }
    }

    // Subtle scene transition sound effects
    if (edl.audioMix.sfxEnabled && edl.audioMix.sfxVolume > 0) {
      for (const scene of edl.scenes) {
        if (scene.soundEffect !== 'none' && scene.startTime < totalDuration - 0.2) {
          scheduleProceduralSfx(
            offline,
            masterLimiter,
            scene.soundEffect,
            scene.startTime,
            edl.audioMix.sfxVolume
          );
        }
      }
    }

    onProgress?.('Rendering synchronized 44.1kHz master audio mix...');
    const mixedBuffer = await offline.startRendering();
    return encodeStereoWav16(mixedBuffer);
  } finally {
    await decodeCtx.close().catch(() => {});
  }
}
