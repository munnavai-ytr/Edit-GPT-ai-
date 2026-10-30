import {renderMasterAudioMix} from './audio-engine';
import {
  buildSceneOverlayStrips,
  getTargetDimensions,
  prepareWatermarkPng,
} from './caption-engine';
import {ensureCustomFontsLoaded} from './media-analysis';
import {EditDecisionList, MediaAssetMeta} from './types';
import type {WorkerFinalizeJob, WorkerSceneJob} from '@/workers/render.worker';

export class RenderCancelledError extends Error {
  constructor() {
    super('Video rendering was cancelled.');
    this.name = 'RenderCancelledError';
  }
}

export class FFmpegRenderController {
  private worker: Worker | null = null;
  private cancelled = false;
  private pendingRejects = new Map<string, (err: Error) => void>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/render.worker.ts', import.meta.url),
        {type: 'module'}
      );
    }
    return this.worker;
  }

  public cancel(): void {
    this.cancelled = true;
    for (const reject of this.pendingRejects.values()) {
      reject(new RenderCancelledError());
    }
    this.pendingRejects.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRejects.clear();
  }

  private sendWorkerCommand<T = void>(
    cmd: 'INIT' | 'ENCODE_SCENE' | 'FINALIZE' | 'CLEANUP',
    payload: unknown,
    transferables: Transferable[] = [],
    onSceneProgress?: (sceneIdx: number, sceneFraction: number, logLine?: string) => void
  ): Promise<T> {
    if (this.cancelled) {
      return Promise.reject(new RenderCancelledError());
    }

    const worker = this.ensureWorker();
    const reqId = `${cmd}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<T>((resolve, reject) => {
      this.pendingRejects.set(reqId, reject);

      const handleMessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg) return;

        if (msg.type === 'SCENE_PROGRESS' && onSceneProgress) {
          onSceneProgress(msg.sceneIndex, msg.progress);
          return;
        }
        if (msg.type === 'LOG' && onSceneProgress) {
          onSceneProgress(msg.sceneIndex, -1, msg.message);
          return;
        }

        if (msg.id !== reqId) return;

        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.pendingRejects.delete(reqId);

        if (msg.type === 'ERROR') {
          reject(new Error(msg.error || 'FFmpeg worker execution failed.'));
        } else {
          resolve(msg as T);
        }
      };

      const handleError = (errEv: ErrorEvent) => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.pendingRejects.delete(reqId);
        reject(
          new Error(
            errEv.message ||
              'WebAssembly memory limit reached during rendering. Switch to 720p output resolution and retry.'
          )
        );
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage({id: reqId, cmd, payload}, transferables);
    });
  }

  public async renderProjectVideo(params: {
    edl: EditDecisionList;
    assets: MediaAssetMeta[];
    blobs: Map<string, Blob>;
    onProgress: (info: {
      stage: 'mixing_audio' | 'rendering_captions' | 'rendering_video';
      detail: string;
      percent: number;
      sceneCurrent?: number;
      sceneTotal?: number;
    }) => void;
  }): Promise<{mp4Blob: Blob; width: number; height: number; duration: number}> {
    const {edl, assets, blobs, onProgress} = params;
    this.cancelled = false;

    const voiceAsset = assets.find((a) => a.role === 'voiceover');
    if (!voiceAsset) {
      throw new Error('Voiceover asset is missing.');
    }
    const voiceBlob = blobs.get(voiceAsset.id);
    if (!voiceBlob) {
      throw new Error('Voiceover audio file is missing from local storage.');
    }

    await ensureCustomFontsLoaded(assets, blobs);

    const {width, height} = getTargetDimensions(edl.aspectRatio, edl.resolution);

    // 1. Mix Master Audio (Voiceover + Normalization + Ducking + Music + SFX)
    onProgress({
      stage: 'mixing_audio',
      detail: 'Normalizing voiceover and mixing audio track...',
      percent: 4,
    });

    const musicBlob = edl.audioMix.musicAssetId
      ? blobs.get(edl.audioMix.musicAssetId)
      : undefined;

    const masterAudioWav = await renderMasterAudioMix({
      edl,
      voiceBlob,
      musicBlob,
      onProgress: (detail) =>
        onProgress({
          stage: 'mixing_audio',
          detail,
          percent: 8,
        }),
    });

    if (this.cancelled) throw new RenderCancelledError();

    // 2. Lazy-load FFmpeg.wasm inside Web Worker
    onProgress({
      stage: 'rendering_video',
      detail: 'Loading FFmpeg.wasm H.264 encoder in Web Worker...',
      percent: 12,
    });

    await this.sendWorkerCommand('INIT', {origin: window.location.origin});

    // Optional watermark preparation
    let watermarkPrepared: {pngBytes: Uint8Array; x: number; y: number} | null =
      null;
    if (edl.watermark.enabled && edl.watermark.assetId) {
      const wmBlob = blobs.get(edl.watermark.assetId);
      if (wmBlob) {
        watermarkPrepared = await prepareWatermarkPng({
          watermarkBlob: wmBlob,
          edl,
          videoWidth: width,
          videoHeight: height,
        });
      }
    }

    // 3. Sequentially render each EDL scene (memory-safe for 6GB Android Chrome)
    const totalScenes = edl.scenes.length;
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    for (let i = 0; i < totalScenes; i++) {
      if (this.cancelled) throw new RenderCancelledError();

      const scene = edl.scenes[i];
      const nextScene = edl.scenes[i + 1];
      const assetMeta = assetMap.get(scene.assetId);
      if (!assetMeta) {
        throw new Error(`Missing visual asset metadata for scene ${scene.sceneNumber}.`);
      }
      const assetBlob = blobs.get(assetMeta.id);
      if (!assetBlob) {
        throw new Error(`Missing visual file "${assetMeta.name}" in IndexedDB.`);
      }

      const sceneBasePct = 14 + (i / totalScenes) * 76;

      onProgress({
        stage: 'rendering_captions',
        detail: `Rendering captions & overlays for Scene ${i + 1} of ${totalScenes}...`,
        percent: Math.round(sceneBasePct),
        sceneCurrent: i + 1,
        sceneTotal: totalScenes,
      });

      const sceneOverlays = await buildSceneOverlayStrips({
        scene,
        sceneIndex: i,
        edl,
        videoWidth: width,
        videoHeight: height,
      });

      const extMatch = assetMeta.name.match(/\.([a-zA-Z0-9]+)$/);
      const assetExt = extMatch
        ? extMatch[1].toLowerCase()
        : assetMeta.analysis?.kind === 'video'
          ? 'mp4'
          : 'jpg';

      const sceneDur = Math.max(0.5, scene.endTime - scene.startTime);
      const isLast = i === totalScenes - 1;
      const fadeIn = i > 0 && scene.transition !== 'cut';
      const fadeOut = isLast || Boolean(nextScene && nextScene.transition !== 'cut');

      const job: WorkerSceneJob = {
        sceneIndex: i,
        totalScenes,
        assetKind: assetMeta.analysis?.kind === 'video' ? 'video' : 'image',
        assetDuration:
          assetMeta.analysis?.kind === 'video'
            ? assetMeta.analysis.duration
            : sceneDur,
        assetExt,
        assetBlob,
        sourceInPoint: scene.sourceInPoint,
        duration: sceneDur,
        width,
        height,
        fps: edl.fps || 30,
        cropMode: scene.cropMode,
        zoomAnimation: scene.zoomAnimation,
        fadeIn,
        fadeOut,
        fadeOutDuration: isLast ? 0.35 : 0.18,
        contrast: edl.colorGrade.contrast,
        brightness: edl.colorGrade.brightness,
        saturation: edl.colorGrade.saturation,
        overlays: sceneOverlays,
        watermark: watermarkPrepared
          ? {
              pngBytes: new Uint8Array(watermarkPrepared.pngBytes),
              x: watermarkPrepared.x,
              y: watermarkPrepared.y,
            }
          : null,
      };

      const transferList: Transferable[] = sceneOverlays.map(
        (ov) => ov.pngBytes.buffer
      );

      onProgress({
        stage: 'rendering_video',
        detail: `Encoding Scene ${i + 1} of ${totalScenes} (${assetMeta.name})...`,
        percent: Math.round(sceneBasePct + (0.2 / totalScenes) * 76),
        sceneCurrent: i + 1,
        sceneTotal: totalScenes,
      });

      await this.sendWorkerCommand(
        'ENCODE_SCENE',
        job,
        transferList,
        (_idx, frac) => {
          if (frac >= 0) {
            const pct = Math.min(
              90,
              sceneBasePct + ((0.2 + frac * 0.8) / totalScenes) * 76
            );
            onProgress({
              stage: 'rendering_video',
              detail: `Encoding Scene ${i + 1} of ${totalScenes} (${Math.round(frac * 100)}%)...`,
              percent: Math.round(pct),
              sceneCurrent: i + 1,
              sceneTotal: totalScenes,
            });
          }
        }
      );

      // Yield briefly to keep mobile UI responsive between scenes
      await new Promise((r) => window.setTimeout(r, 15));
    }

    if (this.cancelled) throw new RenderCancelledError();

    // 4. Final Concat + Master Audio AAC Mux -> Validated MP4
    onProgress({
      stage: 'rendering_video',
      detail: 'Muxing H.264 video stream with AAC master audio...',
      percent: 93,
      sceneCurrent: totalScenes,
      sceneTotal: totalScenes,
    });

    const finalizeJob: WorkerFinalizeJob = {
      segmentCount: totalScenes,
      masterAudioWav,
      totalDuration: edl.totalDuration,
    };

    const finalRes = await this.sendWorkerCommand<{mp4Buffer: ArrayBuffer}>(
      'FINALIZE',
      finalizeJob,
      [masterAudioWav.buffer]
    );

    const mp4Blob = new Blob([finalRes.mp4Buffer], {type: 'video/mp4'});
    if (mp4Blob.size < 1024) {
      throw new Error('Generated MP4 file failed integrity verification.');
    }

    // Verify browser can read the generated MP4 header & duration before claiming completion
    await verifyGeneratedMp4Blob(mp4Blob);

    this.dispose();

    return {
      mp4Blob,
      width,
      height,
      duration: edl.totalDuration,
    };
  }
}

async function verifyGeneratedMp4Blob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const vid = document.createElement('video');
  vid.muted = true;
  vid.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('Rendered MP4 verification timed out.')),
        8000
      );
      vid.onloadedmetadata = () => {
        window.clearTimeout(timer);
        if (vid.videoWidth > 0 && vid.duration > 0) {
          resolve();
        } else {
          reject(new Error('Rendered MP4 had zero video dimensions or duration.'));
        }
      };
      vid.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Rendered MP4 failed browser playback verification.'));
      };
      vid.src = url;
    });
  } finally {
    vid.removeAttribute('src');
    vid.load();
    URL.revokeObjectURL(url);
  }
}
