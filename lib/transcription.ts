import {MAX_VIDEO_DURATION_SECONDS} from './edl-validator';
import {buildGeminiAuthHeaders} from './gemini-client';
import {
  PauseInterval,
  TranscriptData,
  TranscriptSegment,
  TranscriptWord,
} from './types';

function encodeMono16kWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return window.btoa(binary);
}

async function decodeAndDownsample16k(
  voiceBlob: Blob,
  maxSeconds: number
): Promise<{samples: Float32Array; sampleRate: number; duration: number}> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const ab = await voiceBlob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    const cappedDuration = Math.min(maxSeconds, decoded.duration);
    const targetRate = 16000;
    const frameCount = Math.max(1, Math.ceil(cappedDuration * targetRate));

    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0, 0, cappedDuration);

    const rendered = await offline.startRendering();
    return {
      samples: rendered.getChannelData(0),
      sampleRate: targetRate,
      duration: cappedDuration,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

function computeChunkBoundaries(
  totalDuration: number,
  pauses: PauseInterval[]
): Array<{start: number; end: number}> {
  const TARGET_CHUNK_SEC = 38;
  if (totalDuration <= 44) {
    return [{start: 0, end: totalDuration}];
  }

  const chunks: Array<{start: number; end: number}> = [];
  let cursor = 0;

  while (cursor < totalDuration - 0.5) {
    const idealEnd = cursor + TARGET_CHUNK_SEC;
    if (idealEnd >= totalDuration - 3) {
      chunks.push({start: cursor, end: totalDuration});
      break;
    }

    // Snap chunk split to the closest natural spoken pause between [cursor + 22s, cursor + 44s]
    let bestSplit = idealEnd;
    let bestScore = Infinity;
    for (const p of pauses) {
      const mid = (p.start + p.end) / 2;
      if (mid >= cursor + 22 && mid <= cursor + 44) {
        const dist = Math.abs(mid - idealEnd);
        if (dist < bestScore) {
          bestScore = dist;
          bestSplit = mid;
        }
      }
    }

    chunks.push({start: cursor, end: bestSplit});
    cursor = bestSplit;
  }

  return chunks;
}

export async function transcribeAndSyncVoiceover(params: {
  voiceBlob: Blob;
  pauses: PauseInterval[];
  directorModel: string;
  onProgress: (detail: string, fraction: number) => void;
}): Promise<TranscriptData> {
  const {voiceBlob, pauses, directorModel, onProgress} = params;

  onProgress('Preparing 16kHz master voiceover stream for transcription...', 0.1);
  const {samples, sampleRate, duration} = await decodeAndDownsample16k(
    voiceBlob,
    MAX_VIDEO_DURATION_SECONDS
  );

  const chunks = computeChunkBoundaries(duration, pauses);
  const allSegments: TranscriptSegment[] = [];
  let detectedLanguage = 'en';
  let detectedLanguageLabel = 'English';
  let alignmentPrecision: 'word' | 'sentence-approximate' = 'word';

  for (let c = 0; c < chunks.length; c++) {
    const {start, end} = chunks[c];
    const chunkDur = Math.max(0.3, end - start);
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(samples.length, Math.ceil(end * sampleRate));
    const slice = samples.subarray(startSample, endSample);

    const wavBytes = encodeMono16kWav(slice, sampleRate);
    const audioBase64 = uint8ToBase64(wavBytes);

    onProgress(
      chunks.length > 1
        ? `Transcribing voiceover part ${c + 1} of ${chunks.length} (${start.toFixed(1)}s–${end.toFixed(1)}s)...`
        : 'Transcribing voiceover & aligning word timestamps with Gemini...',
      0.15 + (c / chunks.length) * 0.8
    );

    const headers = await buildGeminiAuthHeaders();
    const res = await fetch('/api/gemini/transcribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audioBase64,
        mimeType: 'audio/wav',
        chunkDuration: chunkDur,
        directorModel,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Voiceover transcription failed.');
    }

    if (c === 0) {
      if (data.language) detectedLanguage = data.language;
      if (data.languageLabel) detectedLanguageLabel = data.languageLabel;
    } else if (data.language && data.language !== detectedLanguage) {
      detectedLanguage = 'mixed';
      detectedLanguageLabel = 'Mixed Bengali-English';
    }

    if (data.alignmentPrecision === 'sentence-approximate') {
      alignmentPrecision = 'sentence-approximate';
    }

    const rawSegs = Array.isArray(data.segments) ? data.segments : [];
    for (let sIdx = 0; sIdx < rawSegs.length; sIdx++) {
      const seg = rawSegs[sIdx];
      const sentence = String(seg.sentence || '').trim();
      if (!sentence) continue;

      const localStart = Math.max(0, Math.min(chunkDur, Number(seg.startTime) || 0));
      const localEnd = Math.max(
        localStart + 0.2,
        Math.min(chunkDur, Number(seg.endTime) || chunkDur)
      );

      const globalStart = Number(Math.min(duration, start + localStart).toFixed(3));
      const globalEnd = Number(
        Math.min(duration, Math.max(globalStart + 0.2, start + localEnd)).toFixed(3)
      );

      const rawWords = Array.isArray(seg.words) ? seg.words : [];
      const words: TranscriptWord[] = rawWords
        .filter((w: {word?: string}) => Boolean(w?.word && String(w.word).trim()))
        .map(
          (w: {
            word: string;
            startTime?: number;
            endTime?: number;
            isKeyword?: boolean;
          }) => {
            const wLocalStart = Math.max(
              localStart,
              Math.min(localEnd, Number(w.startTime) || localStart)
            );
            const wLocalEnd = Math.max(
              wLocalStart + 0.06,
              Math.min(localEnd, Number(w.endTime) || wLocalStart + 0.2)
            );
            return {
              word: String(w.word).trim(),
              startTime: Number(Math.min(duration, start + wLocalStart).toFixed(3)),
              endTime: Number(Math.min(duration, start + wLocalEnd).toFixed(3)),
              isKeyword: Boolean(w.isKeyword),
            };
          }
        );

      allSegments.push({
        id: `seg_${c}_${sIdx}`,
        sentence,
        startTime: globalStart,
        endTime: globalEnd,
        speaker: seg.speaker || undefined,
        words,
      });
    }
  }

  // Fallback if audio had speech that returned plain verbatimText without segments
  if (allSegments.length === 0) {
    throw new Error(
      'No intelligible speech was detected in the uploaded voiceover. Check that your voiceover file is audible.'
    );
  }

  // Sort and repair minor overlaps across segments
  allSegments.sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < allSegments.length; i++) {
    if (allSegments[i].startTime < allSegments[i - 1].endTime) {
      allSegments[i].startTime = allSegments[i - 1].endTime;
      if (allSegments[i].endTime <= allSegments[i].startTime) {
        allSegments[i].endTime = Math.min(duration, allSegments[i].startTime + 0.35);
      }
    }
  }

  const sentences = allSegments.map((s) => s.sentence);
  const fullText = sentences.join(' ');

  return {
    fullText,
    language: detectedLanguage,
    languageLabel: detectedLanguageLabel,
    alignmentPrecision,
    segments: allSegments,
    scriptAnalysis: {
      sentences,
      keywords: [],
      hook: sentences[0] || '',
      body: sentences.slice(1, Math.max(2, sentences.length - 1)).join(' '),
      ending: sentences[sentences.length - 1] || '',
    },
  };
}
