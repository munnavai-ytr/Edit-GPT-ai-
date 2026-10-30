#!/usr/bin/env node
/**
 * AI SHORTS EDITOR — Standalone Long-Running FFmpeg Worker Server
 *
 * Architecture:
 * - Polls Cloudflare Queues HTTP Pull Consumer API for persistent rendering jobs.
 * - Reads & writes persistent job state in Cloudflare D1 (`render_jobs` & `worker_heartbeats`).
 * - Downloads source clips, master mixed audio, and pre-shaped Bengali/English caption PNGs
 *   from private Cloudflare R2 via AWS Signature V4.
 * - Renders H.264 + AAC MP4 videos using native system `ffmpeg` (libx264).
 * - Uploads completed MP4 back to private Cloudflare R2 (`jobs/<jobId>/output/final.mp4`).
 * - NEVER receives or requires Gemini API keys.
 */

import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const REQUIRED_ENV = [
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CF_D1_DATABASE_ID',
  'CF_QUEUE_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]?.trim()) {
    console.error(`[FFmpeg Worker] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID.trim();
const CF_API_TOKEN = process.env.CF_API_TOKEN.trim();
const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID.trim();
const CF_QUEUE_ID = process.env.CF_QUEUE_ID.trim();
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || CF_ACCOUNT_ID).trim();
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID.trim();
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY.trim();
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME.trim();
const WORKER_SHARED_SECRET = (process.env.FFMPEG_WORKER_SHARED_SECRET || '').trim();
const PORT = Number(process.env.PORT || '8080');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '5000');
const WORKER_ID =
  process.env.WORKER_ID?.trim() ||
  `worker_${os.hostname().replace(/[^a-zA-Z0-9_-]/g, '')}`;

let activeJobId = null;
let ffmpegVersionBanner = 'ffmpeg (unknown)';
let wakeTriggerResolve = null;
let shuttingDown = false;

// --- AWS Signature V4 Helpers for Private Cloudflare R2 ---

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function getSigningKey(secretAccessKey, dateStamp) {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, 'auto');
  const kService = hmacSha256(kRegion, 's3');
  return hmacSha256(kService, 'aws4_request');
}

function awsUriEncode(input, encodeSlash = true) {
  const bytes = Buffer.from(input, 'utf8');
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const ch = String.fromCharCode(b);
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.' ||
      (!encodeSlash && ch === '/')
    ) {
      out += ch;
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

async function r2SignedRequest(method, objectKey, bodyBuffer, contentType) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const cleanKey = objectKey.replace(/^\/+/, '');
  const canonicalUri = `/${awsUriEncode(R2_BUCKET_NAME, true)}/${awsUriEncode(
    cleanKey,
    false
  )}`;
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const amzDate = iso;
  const dateStamp = iso.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const payload = bodyBuffer ? Buffer.from(bodyBuffer) : Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);

  const headersToSign = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    headersToSign['content-type'] = contentType;
  }

  const sortedKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedKeys
    .map((k) => `${k}:${headersToSign[k]}\n`)
    .join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(R2_SECRET_ACCESS_KEY, dateStamp);
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const headers = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers,
    body: method === 'PUT' ? payload : undefined,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`R2 ${method} "${objectKey}" failed (${res.status}): ${txt.slice(0, 180)}`);
  }

  return res;
}

async function downloadR2ToFile(r2Key, localPath) {
  const res = await r2SignedRequest('GET', r2Key);
  const ab = await res.arrayBuffer();
  await fs.writeFile(localPath, Buffer.from(ab));
}

async function downloadR2Json(r2Key) {
  const res = await r2SignedRequest('GET', r2Key);
  return res.json();
}

async function uploadFileToR2(localPath, r2Key, contentType) {
  const buf = await fs.readFile(localPath);
  await r2SignedRequest('PUT', r2Key, buf, contentType);
}

// --- Cloudflare D1 & Queues Helpers ---

async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    CF_ACCOUNT_ID
  )}/d1/database/${encodeURIComponent(CF_D1_DATABASE_ID)}/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({sql, params}),
  });

  const data = await res.json();
  if (!res.ok || !data?.success) {
    throw new Error(
      `D1 query failed: ${JSON.stringify(data?.errors || res.status)}`
    );
  }
  return data.result?.[0]?.results || [];
}

async function sendHeartbeat() {
  try {
    await d1Query(
      `INSERT INTO worker_heartbeats (worker_id, hostname, ffmpeg_version, active_job_id, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(worker_id) DO UPDATE SET
         hostname = excluded.hostname,
         ffmpeg_version = excluded.ffmpeg_version,
         active_job_id = excluded.active_job_id,
         last_seen_at = excluded.last_seen_at`,
      [WORKER_ID, os.hostname(), ffmpegVersionBanner, activeJobId, Date.now()]
    );
  } catch (err) {
    console.warn('[FFmpeg Worker] Heartbeat warning:', err.message);
  }
}

async function getJobStateFromD1(jobId) {
  const rows = await d1Query(
    `SELECT state FROM render_jobs WHERE id = ? LIMIT 1`,
    [jobId]
  );
  return rows[0]?.state || null;
}

async function updateJobInD1(jobId, fields) {
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  cols.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(jobId);

  await d1Query(`UPDATE render_jobs SET ${cols.join(', ')} WHERE id = ?`, vals);
}

async function pullQueueBatch() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    CF_ACCOUNT_ID
  )}/queues/${encodeURIComponent(CF_QUEUE_ID)}/messages/pull`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      batch_size: 1,
      visibility_timeout_ms: 600_000, // 10 minutes lease while encoding MP4
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(
      `Queue pull failed (${res.status}): ${JSON.stringify(data?.errors || '')}`
    );
  }
  return data.result?.messages || [];
}

async function ackQueueMessage(leaseId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    CF_ACCOUNT_ID
  )}/queues/${encodeURIComponent(CF_QUEUE_ID)}/messages/ack`;

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      acks: [{lease_id: leaseId}],
      retries: [],
    }),
  });
}

// --- Native FFmpeg Execution & Scene Filter Graph ---

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-400)}`)
        );
      }
    });
  });
}

async function detectFFmpegVersion() {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-version']);
    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.on('error', () =>
      reject(new Error('Native `ffmpeg` binary not found in PATH.'))
    );
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('`ffmpeg -version` exited with non-zero status.'));
        return;
      }
      const firstLine = stdout.split('\n')[0]?.trim() || 'ffmpeg';
      resolve(firstLine.slice(0, 64));
    });
  });
}

function even(n) {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function buildVisualBaseFilter(scene, width, height, fps) {
  const W = even(width);
  const H = even(height);
  const dur = Math.max(0.5, scene.duration);
  const totalFrames = Math.max(12, Math.round(dur * fps));
  const preW = even(W * 1.16);
  const preH = even(H * 1.16);

  let motionChain = '';
  if (scene.cropMode === 'fit_blur') {
    motionChain =
      `[0:v]fps=${fps},split=2[bg0][fg0];` +
      `[bg0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=18:2[bg1];` +
      `[fg0]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg1];` +
      `[bg1][fg1]overlay=(W-w)/2:(H-h)/2,setsar=1`;
  } else if (scene.zoomAnimation === 'pan_left_right') {
    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='(iw-ow)*t/${dur.toFixed(3)}':y='(ih-oh)/2',setsar=1`;
  } else if (scene.zoomAnimation === 'pan_right_left') {
    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='(iw-ow)*(1-t/${dur.toFixed(3)})':y='(ih-oh)/2',setsar=1`;
  } else if (scene.zoomAnimation === 'none') {
    const yOffset =
      scene.cropMode === 'cover_top'
        ? '(ih-oh)/5'
        : scene.cropMode === 'cover_bottom'
          ? '4*(ih-oh)/5'
          : '(ih-oh)/2';
    const xOffset =
      scene.cropMode === 'cover_left'
        ? '(iw-ow)/5'
        : scene.cropMode === 'cover_right'
          ? '4*(iw-ow)/5'
          : '(iw-ow)/2';
    motionChain =
      `[0:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H}:x='${xOffset}':y='${yOffset}',setsar=1`;
  } else {
    let zExpr = `1+0.09*on/${totalFrames}`;
    if (scene.zoomAnimation === 'zoom_out_slow') {
      zExpr = `1.10-0.09*on/${totalFrames}`;
    } else if (scene.zoomAnimation === 'zoom_in_punch') {
      zExpr = `1.03+0.12*on/${totalFrames}`;
    }
    const xExpr =
      scene.cropMode === 'cover_left'
        ? 'iw/4-(iw/zoom/4)'
        : scene.cropMode === 'cover_right'
          ? '3*iw/4-(3*iw/zoom/4)'
          : 'iw/2-(iw/zoom/2)';
    const yExpr =
      scene.cropMode === 'cover_top'
        ? 'ih/4-(ih/zoom/4)'
        : scene.cropMode === 'cover_bottom'
          ? '3*ih/4-(3*ih/zoom/4)'
          : 'ih/2-(ih/zoom/2)';
    motionChain =
      `[0:v]fps=${fps},scale=${preW}:${preH}:force_original_aspect_ratio=increase,` +
      `crop=${preW}:${preH},` +
      `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${W}x${H}:fps=${fps},setsar=1`;
  }

  const colorFilter = `,eq=contrast=${Number(scene.contrast).toFixed(
    2
  )}:brightness=${Number(scene.brightness).toFixed(2)}:saturation=${Number(
    scene.saturation
  ).toFixed(2)}`;

  let fadeFilter = '';
  if (scene.fadeIn) {
    fadeFilter += `,fade=t=in:st=0:d=0.18`;
  }
  if (scene.fadeOut) {
    const fDur = Math.max(0.12, Math.min(0.45, Number(scene.fadeOutDuration) || 0.2));
    const st = Math.max(0, dur - fDur);
    fadeFilter += `,fade=t=out:st=${st.toFixed(3)}:d=${fDur.toFixed(3)}`;
  }

  return `${motionChain}${colorFilter}${fadeFilter}[v0]`;
}

async function processQueuedJob(queuePayload, leaseId) {
  const {jobId, manifestKey, outputVideoKey} = queuePayload;
  activeJobId = jobId;
  await sendHeartbeat();

  const currentState = await getJobStateFromD1(jobId);
  if (!currentState || currentState === 'CANCELLED') {
    console.log(`[FFmpeg Worker] Skipping cancelled/deleted job ${jobId}`);
    await ackQueueMessage(leaseId);
    activeJobId = null;
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `shorts-${jobId}-`));
  console.log(`[FFmpeg Worker] Rendering job ${jobId} in ${workDir}`);

  try {
    await updateJobInD1(jobId, {
      state: 'RENDERING',
      render_status: 'in_progress',
      completion_status: 'incomplete',
      error_details: null,
      progress_percent: 58,
      progress_detail: 'FFmpeg Worker downloading manifest & private R2 media...',
    });

    const manifest = await downloadR2Json(manifestKey);
    const audioLocalPath = path.join(workDir, 'master_audio.wav');
    await downloadR2ToFile(manifest.masterAudioKey, audioLocalPath);

    let watermarkLocalPath = null;
    if (manifest.watermark?.r2Key) {
      watermarkLocalPath = path.join(workDir, 'watermark.png');
      await downloadR2ToFile(manifest.watermark.r2Key, watermarkLocalPath);
    }

    // Download unique visual source files once per job
    const downloadedSources = new Map();
    for (const sc of manifest.scenes) {
      if (!downloadedSources.has(sc.sourceR2Key)) {
        const ext = String(sc.assetExt || 'mp4').replace(/[^a-zA-Z0-9]/g, '') || 'mp4';
        const localSrc = path.join(
          workDir,
          `source_${downloadedSources.size}.${ext}`
        );
        await downloadR2ToFile(sc.sourceR2Key, localSrc);
        downloadedSources.set(sc.sourceR2Key, localSrc);
      }
    }

    const totalScenes = manifest.scenes.length;
    const segmentPaths = [];

    for (let i = 0; i < totalScenes; i++) {
      // Respect mid-render user cancellation
      const checkState = await getJobStateFromD1(jobId);
      if (checkState === 'CANCELLED') {
        console.log(`[FFmpeg Worker] Job ${jobId} cancelled mid-render.`);
        await ackQueueMessage(leaseId);
        return;
      }

      const scene = manifest.scenes[i];
      const pct = 60 + Math.round((i / totalScenes) * 30);
      await updateJobInD1(jobId, {
        progress_percent: pct,
        progress_detail: `Encoding scene ${i + 1} of ${totalScenes} with native libx264...`,
      });

      const srcPath = downloadedSources.get(scene.sourceR2Key);
      const dur = Math.max(0.5, Number(scene.duration));
      const fps = Number(manifest.fps) || 30;
      const inputArgs = [];

      if (scene.assetKind === 'image') {
        inputArgs.push(
          '-framerate',
          String(fps),
          '-loop',
          '1',
          '-t',
          dur.toFixed(3),
          '-i',
          srcPath
        );
      } else {
        const needLoop =
          Number(scene.assetDuration) < Number(scene.sourceInPoint) + dur + 0.1;
        if (needLoop) {
          inputArgs.push('-stream_loop', '-1', '-t', dur.toFixed(3), '-i', srcPath);
        } else {
          inputArgs.push(
            '-ss',
            Math.max(0, Number(scene.sourceInPoint)).toFixed(3),
            '-t',
            dur.toFixed(3),
            '-i',
            srcPath
          );
        }
      }

      let filterGraph = buildVisualBaseFilter(
        scene,
        manifest.width,
        manifest.height,
        fps
      );
      let currentLabel = 'v0';
      let inputIndex = 1;

      if (watermarkLocalPath && manifest.watermark) {
        inputArgs.push('-i', watermarkLocalPath);
        const nextLabel = 'vwm';
        filterGraph += `;[${currentLabel}][${inputIndex}:v]overlay=${manifest.watermark.x}:${manifest.watermark.y}[${nextLabel}]`;
        currentLabel = nextLabel;
        inputIndex++;
      }

      for (let k = 0; k < (scene.overlays || []).length; k++) {
        const ov = scene.overlays[k];
        const ovLocal = path.join(workDir, `ov_${i}_${k}.png`);
        await downloadR2ToFile(ov.r2Key, ovLocal);
        inputArgs.push('-i', ovLocal);
        const nextLabel = `vov${k}`;
        filterGraph += `;[${currentLabel}][${inputIndex}:v]overlay=${ov.x}:${ov.y}:enable='between(t,${Number(
          ov.localStart
        ).toFixed(3)},${Number(ov.localEnd).toFixed(3)})'[${nextLabel}]`;
        currentLabel = nextLabel;
        inputIndex++;
      }

      const segPath = path.join(workDir, `seg_${i}.mp4`);
      await runFFmpeg([
        ...inputArgs,
        '-filter_complex',
        filterGraph,
        '-map',
        `[${currentLabel}]`,
        '-t',
        dur.toFixed(3),
        '-r',
        String(fps),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '21',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'main',
        '-video_track_timescale',
        '30000',
        '-an',
        segPath,
      ]);
      segmentPaths.push(segPath);
    }

    await updateJobInD1(jobId, {
      progress_percent: 93,
      progress_detail: 'Muxing H.264 scenes with 44.1kHz AAC master audio...',
    });

    const concatPath = path.join(workDir, 'concat.txt');
    const concatContent = segmentPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.writeFile(concatPath, concatContent, 'utf8');

    const finalMp4Path = path.join(workDir, 'final.mp4');
    await runFFmpeg([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-i',
      audioLocalPath,
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
      Number(manifest.totalDuration).toFixed(3),
      finalMp4Path,
    ]);

    const stat = await fs.stat(finalMp4Path);
    if (stat.size < 1024) {
      throw new Error('Rendered MP4 output was unexpectedly empty.');
    }

    await updateJobInD1(jobId, {
      progress_percent: 97,
      progress_detail: 'Uploading completed MP4 to private Cloudflare R2...',
    });

    await uploadFileToR2(finalMp4Path, outputVideoKey, 'video/mp4');

    await updateJobInD1(jobId, {
      state: 'COMPLETED',
      render_status: 'completed',
      completion_status: 'completed',
      output_video_key: outputVideoKey,
      error_details: null,
      progress_percent: 100,
      progress_detail: `Completed (${(stat.size / (1024 * 1024)).toFixed(1)} MB MP4 stored in private R2).`,
    });

    await ackQueueMessage(leaseId);
    console.log(`[FFmpeg Worker] Completed job ${jobId}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[FFmpeg Worker] Job ${jobId} failed:`, errMsg);
    await updateJobInD1(jobId, {
      state: 'FAILED',
      render_status: 'failed',
      completion_status: 'failed',
      error_details: errMsg.slice(0, 500),
      progress_detail: 'Rendering failed on FFmpeg Worker Server.',
    }).catch(() => {});
    // Acknowledge message so we don't spin infinitely; user can click Retry in UI
    await ackQueueMessage(leaseId).catch(() => {});
  } finally {
    activeJobId = null;
    await fs.rm(workDir, {recursive: true, force: true}).catch(() => {});
    await sendHeartbeat();
  }
}

async function startWorkerLoop() {
  ffmpegVersionBanner = await detectFFmpegVersion();
  console.log(`[FFmpeg Worker] Started (${WORKER_ID}) — ${ffmpegVersionBanner}`);
  await sendHeartbeat();

  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, 30_000);

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(
        JSON.stringify({
          ok: true,
          workerId: WORKER_ID,
          ffmpeg: ffmpegVersionBanner,
          activeJobId,
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/wake') {
      if (
        WORKER_SHARED_SECRET &&
        req.headers['x-worker-secret'] !== WORKER_SHARED_SECRET
      ) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Unauthorized'}));
        return;
      }
      if (wakeTriggerResolve) {
        wakeTriggerResolve();
      }
      res.writeHead(202, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({woken: true}));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, () => {
    console.log(`[FFmpeg Worker] Health & wake HTTP server listening on :${PORT}`);
  });

  process.on('SIGTERM', () => {
    shuttingDown = true;
    clearInterval(heartbeatTimer);
    server.close();
  });

  while (!shuttingDown) {
    try {
      const messages = await pullQueueBatch();
      if (messages.length > 0) {
        for (const msg of messages) {
          const parsedBody =
            typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
          await processQueuedJob(parsedBody, msg.lease_id);
        }
        continue;
      }
    } catch (err) {
      console.warn('[FFmpeg Worker] Poll error:', err.message);
    }

    await new Promise((resolve) => {
      wakeTriggerResolve = resolve;
      setTimeout(() => {
        if (wakeTriggerResolve === resolve) {
          wakeTriggerResolve = null;
        }
        resolve();
      }, POLL_INTERVAL_MS);
    });
  }
}

startWorkerLoop().catch((err) => {
  console.error('[FFmpeg Worker] Fatal startup error:', err);
  process.exit(1);
});
