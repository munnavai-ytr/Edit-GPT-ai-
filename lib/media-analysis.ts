import {buildGeminiAuthHeaders} from './gemini-client';
import {
  AudioAuxAnalysisData,
  FontAnalysisData,
  ImageAnalysisData,
  MediaAssetMeta,
  PauseInterval,
  VideoAnalysisData,
  VoiceAnalysisData,
} from './types';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return '9:16';
  const ratio = w / h;
  if (Math.abs(ratio - 9 / 16) < 0.04) return '9:16';
  if (Math.abs(ratio - 16 / 9) < 0.04) return '16:9';
  if (Math.abs(ratio - 1) < 0.04) return '1:1';
  if (Math.abs(ratio - 4 / 5) < 0.04) return '4:5';
  if (Math.abs(ratio - 4 / 3) < 0.04) return '4:3';
  const d = gcd(w, h);
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const clamped = Math.max(0, Math.min(timeSec, Math.max(0, (video.duration || 1) - 0.05)));
    if (Math.abs(video.currentTime - clamped) < 0.02 && video.readyState >= 2) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      video.removeEventListener('error', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 2500);
    video.addEventListener(
      'seeked',
      () => {
        window.clearTimeout(timer);
        finish();
      },
      {once: true}
    );
    video.addEventListener(
      'error',
      () => {
        window.clearTimeout(timer);
        finish();
      },
      {once: true}
    );
    try {
      video.currentTime = clamped;
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

function computeHistogram(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const img = ctx.getImageData(0, 0, size, size).data;
  const bins = new Float32Array(48); // 16 bins per R, G, B channel
  const pixelCount = size * size;
  for (let i = 0; i < img.length; i += 4) {
    bins[img[i] >> 4] += 1;
    bins[16 + (img[i + 1] >> 4)] += 1;
    bins[32 + (img[i + 2] >> 4)] += 1;
  }
  for (let b = 0; b < 48; b++) {
    bins[b] /= pixelCount;
  }
  return bins;
}

function histogramDistance(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / 3; // normalized [0..2]
}

export async function analyzeVideoFile(
  blob: Blob
): Promise<{analysis: VideoAnalysisData; keyframesBase64: string[]}> {
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Timed out reading video metadata. Unsupported or corrupt video container.')),
        12000
      );
      video.onloadeddata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onloadedmetadata = () => {
        if (video.duration > 0) {
          window.clearTimeout(timeout);
          resolve();
        }
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Browser could not decode this video format. Use MP4 (H.264) or WEBM.'));
      };
      video.src = objectUrl;
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1920;
    const aspectRatio = formatAspectRatio(width, height);

    // Check audio track presence using browser media properties
    const vidAny = video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: {length: number};
    };
    const audioPresence =
      typeof vidAny.mozHasAudio === 'boolean'
        ? vidAny.mozHasAudio
        : vidAny.audioTracks
          ? vidAny.audioTracks.length > 0
          : true;

    // Sample frames sequentially to detect real scene changes via RGB histogram delta
    const sampleCount = Math.min(10, Math.max(3, Math.floor(duration / 1.5)));
    const histSize = 64;
    const histCanvas = document.createElement('canvas');
    histCanvas.width = histSize;
    histCanvas.height = histSize;
    const histCtx = histCanvas.getContext('2d', {willReadFrequently: true});

    const sceneChanges: number[] = [];
    let prevHist: Float32Array | null = null;

    for (let i = 0; i < sampleCount; i++) {
      const t = (duration * (i + 0.5)) / sampleCount;
      await seekVideo(video, t);
      if (histCtx) {
        histCtx.drawImage(video, 0, 0, histSize, histSize);
        const currHist = computeHistogram(histCtx, histSize);
        if (prevHist) {
          const dist = histogramDistance(prevHist, currHist);
          if (dist > 0.36) {
            sceneChanges.push(Number(t.toFixed(2)));
          }
        }
        prevHist = currHist;
      }
    }

    // Extract 2 compact 480px JPEG keyframes for Gemini multimodal vision + 1 UI thumbnail
    const keyframeTimes =
      duration > 3 ? [duration * 0.2, duration * 0.65] : [duration * 0.35];
    const keyframesBase64: string[] = [];
    let thumbnailDataUrl: string | undefined;

    for (let k = 0; k < keyframeTimes.length; k++) {
      await seekVideo(video, keyframeTimes[k]);
      const scale = Math.min(1, 480 / Math.max(width, height));
      const kw = Math.max(64, Math.round(width * scale));
      const kh = Math.max(64, Math.round(height * scale));
      const kCanvas = document.createElement('canvas');
      kCanvas.width = kw;
      kCanvas.height = kh;
      const kCtx = kCanvas.getContext('2d');
      if (kCtx) {
        kCtx.drawImage(video, 0, 0, kw, kh);
        const jpegUrl = kCanvas.toDataURL('image/jpeg', 0.72);
        keyframesBase64.push(jpegUrl);
        if (k === 0) {
          const thumbScale = Math.min(1, 240 / Math.max(width, height));
          const tw = Math.max(48, Math.round(width * thumbScale));
          const th = Math.max(48, Math.round(height * thumbScale));
          const tCanvas = document.createElement('canvas');
          tCanvas.width = tw;
          tCanvas.height = th;
          tCanvas.getContext('2d')?.drawImage(video, 0, 0, tw, th);
          thumbnailDataUrl = tCanvas.toDataURL('image/jpeg', 0.68);
        }
      }
    }

    return {
      analysis: {
        kind: 'video',
        duration: Number(duration.toFixed(2)),
        width,
        height,
        aspectRatio,
        fps: 30,
        sceneChanges,
        audioPresence,
        visualContent: 'Video footage ready for scene matching',
        visualTags: [],
        mood: 'neutral',
        thumbnailDataUrl,
      },
      keyframesBase64,
    };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function analyzeImageFile(
  blob: Blob
): Promise<{analysis: ImageAnalysisData; keyframesBase64: string[]}> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('Unsupported or corrupt image file. Use JPG, PNG, or WEBP.'));
      el.src = objectUrl;
    });

    const width = img.naturalWidth || 1080;
    const height = img.naturalHeight || 1920;
    const orientation: ImageAnalysisData['orientation'] =
      Math.abs(width - height) / Math.max(width, height) < 0.08
        ? 'square'
        : height > width
          ? 'portrait'
          : 'landscape';

    const scale = Math.min(1, 480 / Math.max(width, height));
    const kw = Math.max(64, Math.round(width * scale));
    const kh = Math.max(64, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = kw;
    canvas.height = kh;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, kw, kh);
    const keyframe = canvas.toDataURL('image/jpeg', 0.74);

    const tScale = Math.min(1, 240 / Math.max(width, height));
    const tCanvas = document.createElement('canvas');
    tCanvas.width = Math.max(48, Math.round(width * tScale));
    tCanvas.height = Math.max(48, Math.round(height * tScale));
    tCanvas.getContext('2d')?.drawImage(img, 0, 0, tCanvas.width, tCanvas.height);
    const thumbnailDataUrl = tCanvas.toDataURL('image/jpeg', 0.68);

    return {
      analysis: {
        kind: 'image',
        width,
        height,
        orientation,
        visualContent: 'Still image ready for motion framing',
        visualTags: [],
        mood: 'neutral',
        thumbnailDataUrl,
      },
      keyframesBase64: [keyframe],
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function analyzeVoiceFile(blob: Blob): Promise<VoiceAnalysisData> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const duration = audioBuffer.duration;
    const sampleRate = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);

    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < ch0.length; i++) {
      const abs = Math.abs(ch0[i]);
      if (abs > peak) peak = abs;
      sumSq += ch0[i] * ch0[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, ch0.length));
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -96;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -96;

    // 120-bar normalized waveform peaks for visual display
    const barCount = 120;
    const samplesPerBar = Math.max(1, Math.floor(ch0.length / barCount));
    const waveformPeaks: number[] = [];
    for (let b = 0; b < barCount; b++) {
      const startIdx = b * samplesPerBar;
      const endIdx = Math.min(ch0.length, startIdx + samplesPerBar);
      let localMax = 0;
      for (let s = startIdx; s < endIdx; s++) {
        const v = Math.abs(ch0[s]);
        if (v > localMax) localMax = v;
      }
      waveformPeaks.push(
        Number((peak > 0 ? localMax / peak : 0).toFixed(3))
      );
    }

    // Detect real silent pauses >= 0.28s using 50ms RMS windows
    const windowSamples = Math.max(1, Math.floor(sampleRate * 0.05));
    const silenceLinearThreshold = Math.max(0.012, rms * 0.22);
    const pauses: PauseInterval[] = [];
    let silenceStart: number | null = null;

    for (let pos = 0; pos < ch0.length; pos += windowSamples) {
      const end = Math.min(ch0.length, pos + windowSamples);
      let wSq = 0;
      for (let i = pos; i < end; i++) {
        wSq += ch0[i] * ch0[i];
      }
      const wRms = Math.sqrt(wSq / Math.max(1, end - pos));
      const tSec = pos / sampleRate;

      if (wRms < silenceLinearThreshold) {
        if (silenceStart === null) silenceStart = tSec;
      } else if (silenceStart !== null) {
        const dur = tSec - silenceStart;
        if (dur >= 0.28) {
          pauses.push({
            start: Number(silenceStart.toFixed(2)),
            end: Number(tSec.toFixed(2)),
            duration: Number(dur.toFixed(2)),
          });
        }
        silenceStart = null;
      }
    }

    if (silenceStart !== null && duration - silenceStart >= 0.28) {
      pauses.push({
        start: Number(silenceStart.toFixed(2)),
        end: Number(duration.toFixed(2)),
        duration: Number((duration - silenceStart).toFixed(2)),
      });
    }

    return {
      kind: 'voice',
      duration: Number(duration.toFixed(3)),
      sampleRate,
      peakDb: Number(peakDb.toFixed(1)),
      rmsDb: Number(rmsDb.toFixed(1)),
      pauses,
      waveformPeaks,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function analyzeAuxAudioFile(blob: Blob): Promise<AudioAuxAnalysisData> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const ab = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    return {
      kind: 'audio_aux',
      duration: Number(buf.duration.toFixed(2)),
      sampleRate: buf.sampleRate,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function registerCustomFontBlob(
  assetId: string,
  fileName: string,
  blob: Blob
): Promise<FontAnalysisData> {
  const cleanBase = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  const fontFamilyName = `CustomFont_${cleanBase || 'User'}_${assetId.slice(0, 6)}`;
  const buffer = await blob.arrayBuffer();
  const fontFace = new FontFace(fontFamilyName, buffer);
  const loaded = await fontFace.load();
  document.fonts.add(loaded);
  return {
    kind: 'font',
    fontFamilyName,
  };
}

export async function ensureCustomFontsLoaded(
  assets: MediaAssetMeta[],
  blobs: Map<string, Blob>
): Promise<void> {
  for (const asset of assets) {
    if (asset.role === 'custom_font' && asset.analysis?.kind === 'font') {
      const blob = blobs.get(asset.id);
      if (!blob) continue;
      const targetFamily = asset.analysis.fontFamilyName;
      let alreadyLoaded = false;
      document.fonts.forEach((f) => {
        if (f.family.replace(/['"]/g, '') === targetFamily) {
          alreadyLoaded = true;
        }
      });
      if (!alreadyLoaded) {
        try {
          const buffer = await blob.arrayBuffer();
          const fontFace = new FontFace(targetFamily, buffer);
          const loaded = await fontFace.load();
          document.fonts.add(loaded);
        } catch {
          // Ignore custom font reload error and fall back gracefully
        }
      }
    }
  }
}

export async function analyzeAllProjectAssets(params: {
  assets: MediaAssetMeta[];
  blobs: Map<string, Blob>;
  directorModel: string;
  onProgress: (detail: string, fraction: number) => void;
}): Promise<{updatedAssets: MediaAssetMeta[]; referenceVideoSummary?: string}> {
  const {assets, blobs, directorModel, onProgress} = params;
  const updated: MediaAssetMeta[] = [];
  const visionQueue: Array<{
    id: string;
    name: string;
    kind: 'video' | 'image';
    framesBase64: string[];
  }> = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = {...assets[i]};
    const blob = blobs.get(asset.id);
    if (!blob) {
      throw new Error(`Missing local media file for "${asset.name}". Re-upload the file.`);
    }

    onProgress(
      `Inspecting ${asset.name} (${i + 1} of ${assets.length})...`,
      (i / Math.max(1, assets.length)) * 0.65
    );

    if (asset.role === 'voiceover') {
      asset.analysis = await analyzeVoiceFile(blob);
    } else if (
      asset.role === 'video' ||
      asset.role === 'extra_video' ||
      asset.role === 'reference_video'
    ) {
      const {analysis, keyframesBase64} = await analyzeVideoFile(blob);
      asset.analysis = analysis;
      visionQueue.push({
        id: asset.id,
        name: asset.name,
        kind: 'video',
        framesBase64: keyframesBase64,
      });
    } else if (
      asset.role === 'image' ||
      asset.role === 'extra_image'
    ) {
      const {analysis, keyframesBase64} = await analyzeImageFile(blob);
      asset.analysis = analysis;
      visionQueue.push({
        id: asset.id,
        name: asset.name,
        kind: 'image',
        framesBase64: keyframesBase64,
      });
    } else if (asset.role === 'watermark') {
      const {analysis} = await analyzeImageFile(blob);
      asset.analysis = analysis;
    } else if (asset.role === 'music') {
      asset.analysis = await analyzeAuxAudioFile(blob);
    } else if (asset.role === 'custom_font') {
      asset.analysis = await registerCustomFontBlob(asset.id, asset.name, blob);
    }

    updated.push(asset);
  }

  // Run Gemini vision analysis sequentially in compact batches of 4 assets
  const BATCH_SIZE = 4;
  for (let start = 0; start < visionQueue.length; start += BATCH_SIZE) {
    const batch = visionQueue.slice(start, start + BATCH_SIZE);
    onProgress(
      `Analyzing visual content with Gemini (${Math.min(visionQueue.length, start + BATCH_SIZE)}/${visionQueue.length})...`,
      0.65 + (start / Math.max(1, visionQueue.length)) * 0.35
    );

    const headers = await buildGeminiAuthHeaders();
    const res = await fetch('/api/gemini/analyze-visuals', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: batch,
        directorModel,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Visual content analysis failed.');
    }

    const resultList = Array.isArray(data.results) ? data.results : [];
    for (const r of resultList) {
      const target = updated.find((u) => u.id === r.id);
      if (
        target?.analysis &&
        (target.analysis.kind === 'video' || target.analysis.kind === 'image')
      ) {
        target.analysis.visualContent = r.visualContent || target.analysis.visualContent;
        target.analysis.visualTags = Array.isArray(r.visualTags) ? r.visualTags : [];
        target.analysis.mood = r.mood || 'neutral';
      }
    }
  }

  let referenceVideoSummary: string | undefined;
  const refVid = updated.find((u) => u.role === 'reference_video');
  if (refVid?.analysis?.kind === 'video') {
    const cutRate =
      refVid.analysis.sceneChanges.length > 0
        ? (refVid.analysis.duration / (refVid.analysis.sceneChanges.length + 1)).toFixed(1)
        : refVid.analysis.duration.toFixed(1);
    referenceVideoSummary = `Reference video "${refVid.name}" (${refVid.analysis.duration}s, ${refVid.analysis.aspectRatio}): avg shot length ~${cutRate}s, mood "${refVid.analysis.mood}", visual style: ${refVid.analysis.visualContent}`;
  }

  return {updatedAssets: updated, referenceVideoSummary};
}
