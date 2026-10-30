/// <reference lib="webworker" />

export interface WorkerSceneOverlay {
  filename: string;
  pngBytes: Uint8Array;
  x: number;
  y: number;
  localStart: number;
  localEnd: number;
}

export interface WorkerSceneJob {
  sceneIndex: number;
  totalScenes: number;
  assetKind: 'video' | 'image';
  assetDuration: number;
  assetExt: string;
  assetBlob: Blob;
  sourceInPoint: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  cropMode: string;
  zoomAnimation: string;
  fadeIn: boolean;
  fadeOut: boolean;
  fadeOutDuration: number;
  contrast: number;
  brightness: number;
  saturation: number;
  overlays: WorkerSceneOverlay[];
  watermark?: {
    pngBytes: Uint8Array;
    x: number;
    y: number;
  } | null;
}

export interface WorkerFinalizeJob {
  segmentCount: number;
  masterAudioWav: Uint8Array;
  totalDuration: number;
}

interface EmscriptenFS {
  mkdir: (path: string) => void;
  rmdir: (path: string) => void;
  mount: (type: unknown, opts: unknown, mountPoint: string) => void;
  unmount: (mountPoint: string) => void;
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (
    path: string,
    opts?: {encoding?: 'binary' | 'utf8'}
  ) => Uint8Array | string;
  unlink: (path: string) => void;
  readdir: (path: string) => string[];
  stat: (path: string) => {size: number};
  filesystems?: {
    WORKERFS?: unknown;
  };
}

interface FFmpegCoreInstance {
  FS: EmscriptenFS;
  exec: (...args: string[]) => number;
  reset: () => void;
  ret: number;
  setLogger: (cb: (data: {type: string; message: string}) => void) => void;
  setProgress: (cb: (data: {progress: number; time: number}) => void) => void;
}

let core: FFmpegCoreInstance | null = null;
let currentSceneIndex = 0;

function safeUnlink(path: string): void {
  if (!core) return;
  try {
    core.FS.unlink(path);
  } catch {
    // Ignore if file already removed
  }
}

function safeUnmount(mountPoint: string): void {
  if (!core) return;
  try {
    core.FS.unmount(mountPoint);
  } catch {
    // Ignore
  }
  try {
    core.FS.rmdir(mountPoint);
  } catch {
    // Ignore
  }
}

async function ensureFFmpegLoaded(origin: string): Promise<void> {
  if (core) return;

  const coreJsUrl = `${origin}/ffmpeg/ffmpeg-core.js`;
  const wasmUrl = `${origin}/ffmpeg/ffmpeg-core.wasm`;

  const mod = await import(/* webpackIgnore: true */ coreJsUrl);
  const createFFmpegCore = mod.default || (self as unknown as {createFFmpegCore?: unknown}).createFFmpegCore;

  if (typeof createFFmpegCore !== 'function') {
    throw new Error('Failed to load FFmpeg WebAssembly core module.');
  }

  const hashConfig = btoa(JSON.stringify({wasmURL: wasmUrl, workerURL: ''}));
  core = (await (createFFmpegCore as (cfg: unknown) => Promise<FFmpegCoreInstance>)({
    mainScriptUrlOrBlob: `${coreJsUrl}#${hashConfig}`,
  })) as FFmpegCoreInstance;

  core.setLogger(({message}) => {
    if (
      message.includes('frame=') ||
      message.includes('Error') ||
      message.includes('Invalid')
    ) {
      self.postMessage({
        type: 'LOG',
        sceneIndex: currentSceneIndex,
        message,
      });
    }
  });

  core.setProgress(({progress, time}) => {
    self.postMessage({
      type: 'SCENE_PROGRESS',
      sceneIndex: currentSceneIndex,
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0,
      time,
    });
  });
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function buildVisualBaseFilter(job: WorkerSceneJob): string {
  const W = even(job.width);
  const H = even(job.height);
  const fps = job.fps;
  const dur = Math.max(0.5, job.duration);
  const totalFrames = Math.max(12, Math.round(dur * fps));
  const preW = even(W * 1.16);
  const preH = even(H * 1.16);

  let motionChain = '';

  if (job.cropMode === 'fit_blur') {
    motionChain =
      `[0:v]fps=${fps},split=2[bg0][fg0];` +
      `[bg0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=18:2[bg1];` +
      `[fg0]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg1];` +
      `[bg1][fg1]overlay=(W-w)/2:(H-h)/2,setsar=1`;
  } else if (job.zoomAnimation === 'pan_left_right') {
    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='(iw-ow)*t/${dur.toFixed(3)}':y='(ih-oh)/2',setsar=1`;
  } else if (job.zoomAnimation === 'pan_right_left') {
    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='(iw-ow)*(1-t/${dur.toFixed(3)})':y='(ih-oh)/2',setsar=1`;
  } else if (job.zoomAnimation === 'none') {
    const yOffset =
      job.cropMode === 'cover_top'
        ? '(ih-oh)/5'
        : job.cropMode === 'cover_bottom'
          ? '4*(ih-oh)/5'
          : '(ih-oh)/2';
    const xOffset =
      job.cropMode === 'cover_left'
        ? '(iw-ow)/5'
        : job.cropMode === 'cover_right'
          ? '4*(iw-ow)/5'
          : '(iw-ow)/2';
    motionChain =
      `[0:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='${xOffset}':y='${yOffset}',setsar=1`;
  } else {
    // Smooth zoom_in_slow, zoom_out_slow, or zoom_in_punch via zoompan d=1 (zero unescaped commas)
    let zExpr = `1+0.09*on/${totalFrames}`;
    if (job.zoomAnimation === 'zoom_out_slow') {
      zExpr = `1.10-0.09*on/${totalFrames}`;
    } else if (job.zoomAnimation === 'zoom_in_punch') {
      zExpr = `1.03+0.12*on/${totalFrames}`;
    }

    const xExpr =
      job.cropMode === 'cover_left'
        ? 'iw/4-(iw/zoom/4)'
        : job.cropMode === 'cover_right'
          ? '3*iw/4-(3*iw/zoom/4)'
          : 'iw/2-(iw/zoom/2)';
    const yExpr =
      job.cropMode === 'cover_top'
        ? 'ih/4-(ih/zoom/4)'
        : job.cropMode === 'cover_bottom'
          ? '3*ih/4-(3*ih/zoom/4)'
          : 'ih/2-(ih/zoom/2)';

    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${preW}:${preH},` +
      `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${W}x${H}:fps=${fps},setsar=1`;
  }

  // Color adjustment
  const colorFilter = `,eq=contrast=${job.contrast.toFixed(2)}:brightness=${job.brightness.toFixed(2)}:saturation=${job.saturation.toFixed(2)}`;

  // Optional transitions (fade in / fade out)
  let fadeFilter = '';
  if (job.fadeIn) {
    fadeFilter += `,fade=t=in:st=0:d=0.18`;
  }
  if (job.fadeOut) {
    const fDur = Math.max(0.12, Math.min(0.45, job.fadeOutDuration));
    const st = Math.max(0, dur - fDur);
    fadeFilter += `,fade=t=out:st=${st.toFixed(3)}:d=${fDur.toFixed(3)}`;
  }

  return `${motionChain}${colorFilter}${fadeFilter}[v0]`;
}

async function encodeSceneSegment(job: WorkerSceneJob): Promise<void> {
  if (!core) throw new Error('FFmpeg core is not initialized.');
  currentSceneIndex = job.sceneIndex;

  const mountDir = `/mnt_${job.sceneIndex}`;
  const cleanExt = (job.assetExt || 'mp4').replace(/[^a-zA-Z0-9]/g, '') || 'mp4';
  const sourceName = `src_${job.sceneIndex}.${cleanExt}`;
  let inputPath = `/${sourceName}`;
  let usedWorkerFs = false;

  // Prefer zero-copy WORKERFS mount so large video files do not consume WASM heap
  if (core.FS.filesystems?.WORKERFS) {
    try {
      core.FS.mkdir(mountDir);
      core.FS.mount(
        core.FS.filesystems.WORKERFS,
        {blobs: [{name: sourceName, data: job.assetBlob}]},
        mountDir
      );
      inputPath = `${mountDir}/${sourceName}`;
      usedWorkerFs = true;
    } catch {
      usedWorkerFs = false;
    }
  }

  if (!usedWorkerFs) {
    const ab = await job.assetBlob.arrayBuffer();
    core.FS.writeFile(inputPath, new Uint8Array(ab));
  }

  const overlayPaths: string[] = [];
  try {
    const inputArgs: string[] = [];
    const dur = Math.max(0.5, job.duration);

    if (job.assetKind === 'image') {
      inputArgs.push(
        '-framerate',
        String(job.fps),
        '-loop',
        '1',
        '-t',
        dur.toFixed(3),
        '-i',
        inputPath
      );
    } else {
      const needLoop = job.assetDuration < job.sourceInPoint + dur + 0.1;
      if (needLoop) {
        inputArgs.push('-stream_loop', '-1', '-t', dur.toFixed(3), '-i', inputPath);
      } else {
        inputArgs.push(
          '-ss',
          Math.max(0, job.sourceInPoint).toFixed(3),
          '-t',
          dur.toFixed(3),
          '-i',
          inputPath
        );
      }
    }

    let filterGraph = buildVisualBaseFilter(job);
    let currentLabel = 'v0';
    let inputIndex = 1;

    // Optional watermark
    if (job.watermark) {
      const wmPath = `/wm_${job.sceneIndex}.png`;
      core.FS.writeFile(wmPath, job.watermark.pngBytes);
      overlayPaths.push(wmPath);
      inputArgs.push('-i', wmPath);
      const nextLabel = `vwm`;
      filterGraph += `;[${currentLabel}][${inputIndex}:v]overlay=${job.watermark.x}:${job.watermark.y}[${nextLabel}]`;
      currentLabel = nextLabel;
      inputIndex++;
    }

    // Scene title & active word-highlighted caption PNG strips
    for (let k = 0; k < job.overlays.length; k++) {
      const ov = job.overlays[k];
      const ovPath = `/${ov.filename}`;
      core.FS.writeFile(ovPath, ov.pngBytes);
      overlayPaths.push(ovPath);
      inputArgs.push('-i', ovPath);
      const nextLabel = `vov${k}`;
      filterGraph +=
        `;[${currentLabel}][${inputIndex}:v]overlay=${ov.x}:${ov.y}:enable='between(t,${ov.localStart.toFixed(3)},${ov.localEnd.toFixed(3)})'[${nextLabel}]`;
      currentLabel = nextLabel;
      inputIndex++;
    }

    const segPath = `/seg_${job.sceneIndex}.mp4`;
    safeUnlink(segPath);

    const args = [
      ...inputArgs,
      '-filter_complex',
      filterGraph,
      '-map',
      `[${currentLabel}]`,
      '-t',
      dur.toFixed(3),
      '-r',
      String(job.fps),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'main',
      '-video_track_timescale',
      '30000',
      '-an',
      segPath,
    ];

    const ret = core.exec(...args);
    core.reset();

    if (ret !== 0) {
      throw new Error(`FFmpeg failed encoding scene ${job.sceneIndex + 1} (exit code ${ret}).`);
    }

    const stat = core.FS.stat(segPath);
    if (!stat || stat.size < 256) {
      throw new Error(`Encoded segment for scene ${job.sceneIndex + 1} was empty.`);
    }
  } finally {
    for (const p of overlayPaths) {
      safeUnlink(p);
    }
    if (usedWorkerFs) {
      safeUnmount(mountDir);
    } else {
      safeUnlink(inputPath);
    }
  }
}

function finalizeMp4(job: WorkerFinalizeJob): Uint8Array {
  if (!core) throw new Error('FFmpeg core is not initialized.');

  const concatLines: string[] = [];
  for (let i = 0; i < job.segmentCount; i++) {
    concatLines.push(`file '/seg_${i}.mp4'`);
  }

  const concatPath = '/concat_list.txt';
  const audioPath = '/master_audio.wav';
  const outputPath = '/final_output.mp4';

  safeUnlink(concatPath);
  safeUnlink(audioPath);
  safeUnlink(outputPath);

  core.FS.writeFile(concatPath, concatLines.join('\n'));
  core.FS.writeFile(audioPath, job.masterAudioWav);

  try {
    // Fast stream copy of uniform H.264 segments + AAC audio encode
    let ret = core.exec(
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-i',
      audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      '-t',
      job.totalDuration.toFixed(3),
      outputPath
    );
    core.reset();

    // Self-healing fallback re-encode if stream copy encountered any SPS/PPS boundary variance
    if (ret !== 0) {
      safeUnlink(outputPath);
      ret = core.exec(
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatPath,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-t',
        job.totalDuration.toFixed(3),
        outputPath
      );
      core.reset();
    }

    if (ret !== 0) {
      throw new Error(`FFmpeg final MP4 muxing failed with code ${ret}.`);
    }

    const mp4Bytes = core.FS.readFile(outputPath, {
      encoding: 'binary',
    }) as Uint8Array;
    if (!mp4Bytes || mp4Bytes.byteLength < 1024) {
      throw new Error('Rendered MP4 file was invalid or empty.');
    }

    // Copy out of WASM linear memory before unlinking so buffer transfer is clean
    const outCopy = new Uint8Array(mp4Bytes.byteLength);
    outCopy.set(mp4Bytes);
    return outCopy;
  } finally {
    safeUnlink(concatPath);
    safeUnlink(audioPath);
    safeUnlink(outputPath);
    for (let i = 0; i < job.segmentCount; i++) {
      safeUnlink(`/seg_${i}.mp4`);
    }
  }
}

self.onmessage = async (event: MessageEvent) => {
  const {id, cmd, payload} = event.data as {
    id: string;
    cmd: 'INIT' | 'ENCODE_SCENE' | 'FINALIZE' | 'CLEANUP';
    payload: unknown;
  };

  try {
    if (cmd === 'INIT') {
      const {origin} = payload as {origin: string};
      await ensureFFmpegLoaded(origin);
      self.postMessage({id, type: 'RESULT', ok: true});
      return;
    }

    if (cmd === 'ENCODE_SCENE') {
      await encodeSceneSegment(payload as WorkerSceneJob);
      self.postMessage({id, type: 'RESULT', ok: true});
      return;
    }

    if (cmd === 'FINALIZE') {
      const mp4 = finalizeMp4(payload as WorkerFinalizeJob);
      self.postMessage(
        {id, type: 'RESULT', ok: true, mp4Buffer: mp4.buffer},
        [mp4.buffer]
      );
      return;
    }

    if (cmd === 'CLEANUP') {
      if (core) {
        const files = core.FS.readdir('/');
        for (const f of files) {
          if (f.startsWith('seg_') || f.startsWith('cap_') || f.endsWith('.mp4') || f.endsWith('.wav')) {
            safeUnlink(`/${f}`);
          }
        }
      }
      self.postMessage({id, type: 'RESULT', ok: true});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({id, type: 'ERROR', error: message});
  }
};
