import {renderMasterAudioMix} from './audio-engine';
import {
  buildSceneOverlayStrips,
  getTargetDimensions,
  prepareWatermarkPng,
} from './caption-engine';
import {loadEncryptedCloudConfig} from './crypto-vault';
import {ensureCustomFontsLoaded} from './media-analysis';
import type {
  CloudConnectionSettings,
  CloudJobRecord,
  CloudJobState,
  CloudManifestSceneOverlay,
  CloudRenderManifest,
  EditDecisionList,
  MediaAssetMeta,
  ProjectRecord,
  StepStatus,
} from './types';

export class CloudUploadCancelledError extends Error {
  constructor() {
    super('Cloud upload and job submission was cancelled.');
    this.name = 'CloudUploadCancelledError';
  }
}

export interface CloudInfrastructureStatus {
  configured: boolean;
  ready: boolean;
  configSource: 'client_vault' | 'server_env' | 'hybrid' | 'none';
  missingFields: string[];
  r2: {ok: boolean; message: string};
  d1: {ok: boolean; message: string};
  queue: {ok: boolean; message: string};
  worker: {
    status: 'online' | 'stale' | 'never_seen';
    workerId?: string;
    hostname?: string;
    ffmpegVersion?: string;
    activeJobId?: string | null;
    lastSeenAt?: number;
    message: string;
  };
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function buildCloudHeaders(
  explicitConfig?: CloudConnectionSettings | null
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const cfg =
    explicitConfig !== undefined
      ? explicitConfig
      : await loadEncryptedCloudConfig();

  if (cfg) {
    headers['x-cloud-config'] = utf8ToBase64(JSON.stringify(cfg));
  }

  return headers;
}

export async function checkCloudInfrastructureStatus(
  explicitConfig?: CloudConnectionSettings | null
): Promise<CloudInfrastructureStatus> {
  const headers = await buildCloudHeaders(explicitConfig);
  const res = await fetch('/api/cloud/status', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = (await res.json()) as CloudInfrastructureStatus;
  return data;
}

export async function fetchCloudJobs(): Promise<{
  configured: boolean;
  jobs: CloudJobRecord[];
}> {
  const headers = await buildCloudHeaders();
  const res = await fetch('/api/cloud/jobs', {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load persistent cloud jobs.');
  }
  return {
    configured: Boolean(data.configured),
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
  };
}

export async function fetchCloudJobDetail(
  jobId: string
): Promise<CloudJobRecord> {
  const headers = await buildCloudHeaders();
  const res = await fetch(`/api/cloud/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch cloud job status.');
  }
  return data.job as CloudJobRecord;
}

export async function createAnalyzingCloudJob(params: {
  projectId: string;
  projectName: string;
}): Promise<CloudJobRecord> {
  const headers = await buildCloudHeaders();
  const res = await fetch('/api/cloud/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: params.projectId,
      projectName: params.projectName,
      initialState: 'ANALYZING',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Could not create persistent job in D1.');
  }
  return data.job as CloudJobRecord;
}

export async function updateCloudJobStage(
  jobId: string,
  patch: Partial<{
    projectName: string;
    state: CloudJobState;
    uploadStatus: StepStatus;
    analysisStatus: StepStatus;
    planStatus: StepStatus;
    renderStatus: StepStatus;
    completionStatus: 'incomplete' | 'completed' | 'failed' | 'cancelled';
    progressPercent: number;
    progressDetail: string;
    errorDetails: string | null;
  }>
): Promise<CloudJobRecord> {
  const headers = await buildCloudHeaders();
  const res = await fetch(`/api/cloud/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed updating cloud job stage.');
  }
  return data.job as CloudJobRecord;
}

export async function cancelCloudJob(jobId: string): Promise<CloudJobRecord> {
  const headers = await buildCloudHeaders();
  const res = await fetch(
    `/api/cloud/jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed cancelling cloud job.');
  }
  return data.job as CloudJobRecord;
}

export async function retryCloudJob(jobId: string): Promise<{
  job: CloudJobRecord;
  action: 'requeued' | 'resume_from_client';
  message?: string;
}> {
  const headers = await buildCloudHeaders();
  const res = await fetch(
    `/api/cloud/jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed retrying cloud job.');
  }
  return data;
}

export async function deleteCloudJobAndAssets(
  jobId: string,
  tempOnly = false
): Promise<{deletedObjects: number}> {
  const headers = await buildCloudHeaders();
  const query = tempOnly ? '?scope=temp_only' : '';
  const res = await fetch(
    `/api/cloud/jobs/${encodeURIComponent(jobId)}${query}`,
    {
      method: 'DELETE',
      headers,
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed deleting cloud job and R2 objects.');
  }
  return {deletedObjects: Number(data.deletedObjects) || 0};
}

interface PendingUploadItem {
  id: string;
  keySuffix: string;
  blob: Blob;
  label: string;
}

export async function uploadAndEnqueueCloudRenderJob(params: {
  existingJobId?: string;
  project: ProjectRecord;
  edl: EditDecisionList;
  assets: MediaAssetMeta[];
  blobs: Map<string, Blob>;
  signal?: AbortSignal;
  onProgress: (info: {
    stage: 'mixing_audio' | 'rendering_captions' | 'uploading_cloud' | 'queued_cloud';
    detail: string;
    percent: number;
  }) => void;
}): Promise<CloudJobRecord> {
  const {existingJobId, project, edl, assets, blobs, signal, onProgress} = params;

  const checkAborted = () => {
    if (signal?.aborted) {
      throw new CloudUploadCancelledError();
    }
  };

  checkAborted();

  const voiceAsset = assets.find((a) => a.role === 'voiceover');
  if (!voiceAsset) {
    throw new Error('Voiceover asset metadata is missing.');
  }
  const voiceBlob = blobs.get(voiceAsset.id);
  if (!voiceBlob) {
    throw new Error('Voiceover audio file is missing from IndexedDB.');
  }

  await ensureCustomFontsLoaded(assets, blobs);
  const {width, height} = getTargetDimensions(edl.aspectRatio, edl.resolution);

  // 1. Render synchronized master audio mix locally so voice normalization, ducking & SFX are exact
  onProgress({
    stage: 'mixing_audio',
    detail: 'Mixing normalized voiceover & ducked background music for cloud worker...',
    percent: 45,
  });

  const musicBlob = edl.audioMix.musicAssetId
    ? blobs.get(edl.audioMix.musicAssetId)
    : undefined;

  const masterAudioBytes = await renderMasterAudioMix({
    edl,
    voiceBlob,
    musicBlob,
  });
  const masterAudioBlob = new Blob([new Uint8Array(masterAudioBytes)], {
    type: 'audio/wav',
  });

  checkAborted();

  // 2. Render Bengali/English active-word caption strips & optional watermark PNGs
  onProgress({
    stage: 'rendering_captions',
    detail: 'Shaping English / বাংলা active-word caption overlays...',
    percent: 50,
  });

  const uploadQueue: PendingUploadItem[] = [
    {
      id: 'master_audio',
      keySuffix: 'inputs/master_audio.wav',
      blob: masterAudioBlob,
      label: 'master_audio.wav',
    },
  ];

  let watermarkPrepared: {
    pngBytes: Uint8Array;
    x: number;
    y: number;
  } | null = null;

  if (edl.watermark.enabled && edl.watermark.assetId) {
    const wmBlob = blobs.get(edl.watermark.assetId);
    if (wmBlob) {
      watermarkPrepared = await prepareWatermarkPng({
        watermarkBlob: wmBlob,
        edl,
        videoWidth: width,
        videoHeight: height,
      });
      if (watermarkPrepared) {
        uploadQueue.push({
          id: 'watermark',
          keySuffix: 'overlays/watermark.png',
          blob: new Blob([new Uint8Array(watermarkPrepared.pngBytes)], {
            type: 'image/png',
          }),
          label: 'watermark.png',
        });
      }
    }
  }

  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const queuedSourceAssetIds = new Set<string>();
  const sceneOverlayUploadIds: Array<
    Array<{
      uploadId: string;
      x: number;
      y: number;
      localStart: number;
      localEnd: number;
    }>
  > = [];

  for (let i = 0; i < edl.scenes.length; i++) {
    checkAborted();
    const scene = edl.scenes[i];
    const assetMeta = assetMap.get(scene.assetId);
    if (!assetMeta) {
      throw new Error(`Visual asset metadata missing for scene ${scene.sceneNumber}.`);
    }
    const assetBlob = blobs.get(assetMeta.id);
    if (!assetBlob) {
      throw new Error(`Visual file "${assetMeta.name}" is missing from local storage.`);
    }

    if (!queuedSourceAssetIds.has(assetMeta.id)) {
      queuedSourceAssetIds.add(assetMeta.id);
      const extMatch = assetMeta.name.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch
        ? extMatch[1].toLowerCase()
        : assetMeta.analysis?.kind === 'video'
          ? 'mp4'
          : 'jpg';
      uploadQueue.push({
        id: `src_${assetMeta.id}`,
        keySuffix: `inputs/src_${assetMeta.id}.${ext}`,
        blob: assetBlob,
        label: assetMeta.name,
      });
    }

    const strips = await buildSceneOverlayStrips({
      scene,
      sceneIndex: i,
      edl,
      videoWidth: width,
      videoHeight: height,
    });

    const sceneRefs: Array<{
      uploadId: string;
      x: number;
      y: number;
      localStart: number;
      localEnd: number;
    }> = [];

    for (const st of strips) {
      const uploadId = `ov_${i}_${st.filename}`;
      uploadQueue.push({
        id: uploadId,
        keySuffix: `overlays/${st.filename}`,
        blob: new Blob([new Uint8Array(st.pngBytes)], {type: 'image/png'}),
        label: st.filename,
      });
      sceneRefs.push({
        uploadId,
        x: st.x,
        y: st.y,
        localStart: st.localStart,
        localEnd: st.localEnd,
      });
    }

    sceneOverlayUploadIds.push(sceneRefs);
  }

  checkAborted();

  // 3. Request short-lived private R2 presigned PUT URLs & persist UPLOADING state in D1
  onProgress({
    stage: 'uploading_cloud',
    detail: `Requesting short-lived signed upload URLs for ${uploadQueue.length} private R2 objects...`,
    percent: 55,
  });

  const headers = await buildCloudHeaders();
  const filesToSign = uploadQueue.map((item) => ({
    id: item.id,
    keySuffix: item.keySuffix,
  }));

  let activeJob: CloudJobRecord;
  let presignedUploads: Record<string, {r2Key: string; uploadUrl: string}>;

  if (existingJobId) {
    const patchRes = await fetch(
      `/api/cloud/jobs/${encodeURIComponent(existingJobId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          projectName: edl.projectTitle || project.name,
          state: 'UPLOADING',
          uploadStatus: 'in_progress',
          analysisStatus: 'completed',
          planStatus: 'completed',
          progressPercent: 45,
          progressDetail: `Uploading ${uploadQueue.length} media & caption assets to private R2...`,
          errorDetails: null,
          filesToSign,
        }),
        signal,
      }
    );
    const patchData = await patchRes.json();
    if (!patchRes.ok) {
      throw new Error(
        patchData.error || 'Failed preparing presigned R2 uploads for cloud job.'
      );
    }
    activeJob = patchData.job as CloudJobRecord;
    presignedUploads = patchData.presignedUploads;
  } else {
    const createRes = await fetch('/api/cloud/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId: project.id,
        projectName: edl.projectTitle || project.name,
        initialState: 'UPLOADING',
        filesToSign,
      }),
      signal,
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(
        createData.error || 'Failed creating persistent cloud job in D1.'
      );
    }
    activeJob = createData.job as CloudJobRecord;
    presignedUploads = createData.presignedUploads;
  }

  // 4. Upload all media & PNG overlays directly from browser to private Cloudflare R2
  try {
    for (let u = 0; u < uploadQueue.length; u++) {
      checkAborted();
      const item = uploadQueue[u];
      const signedInfo = presignedUploads[item.id];
      if (!signedInfo?.uploadUrl) {
        throw new Error(`Missing presigned R2 URL for "${item.label}".`);
      }

      const pct = 56 + Math.round(((u + 1) / uploadQueue.length) * 34);
      onProgress({
        stage: 'uploading_cloud',
        detail: `Uploading to private R2 (${u + 1}/${uploadQueue.length}): ${item.label}`,
        percent: pct,
      });

      let putRes: Response;
      try {
        putRes = await fetch(signedInfo.uploadUrl, {
          method: 'PUT',
          body: item.blob,
          signal,
        });
      } catch (networkErr) {
        if (signal?.aborted) throw new CloudUploadCancelledError();
        throw new Error(
          `Direct R2 upload failed for "${item.label}". Ensure your private Cloudflare R2 bucket has a CORS policy allowing PUT from this app origin (${window.location.origin}). (${
            networkErr instanceof Error ? networkErr.message : 'Network error'
          })`
        );
      }

      if (!putRes.ok) {
        throw new Error(
          `Private R2 rejected upload for "${item.label}" (HTTP ${putRes.status}).`
        );
      }
    }

    checkAborted();

    // 5. Build CloudRenderManifest (validated EDL + R2 keys ONLY — ZERO Gemini API keys)
    const totalScenes = edl.scenes.length;
    const manifest: CloudRenderManifest = {
      version: 1,
      jobId: activeJob.id,
      projectId: project.id,
      projectName: edl.projectTitle || project.name,
      createdAt: Date.now(),
      width,
      height,
      fps: edl.fps || 30,
      totalDuration: edl.totalDuration,
      masterAudioKey: presignedUploads['master_audio'].r2Key,
      watermark:
        watermarkPrepared && presignedUploads['watermark']
          ? {
              r2Key: presignedUploads['watermark'].r2Key,
              x: watermarkPrepared.x,
              y: watermarkPrepared.y,
            }
          : null,
      scenes: edl.scenes.map((scene, idx) => {
        const nextScene = edl.scenes[idx + 1];
        const assetMeta = assetMap.get(scene.assetId)!;
        const extMatch = assetMeta.name.match(/\.([a-zA-Z0-9]+)$/);
        const assetExt = extMatch
          ? extMatch[1].toLowerCase()
          : assetMeta.analysis?.kind === 'video'
            ? 'mp4'
            : 'jpg';
        const sceneDur = Math.max(0.5, scene.endTime - scene.startTime);
        const isLast = idx === totalScenes - 1;
        const fadeIn = idx > 0 && scene.transition !== 'cut';
        const fadeOut =
          isLast || Boolean(nextScene && nextScene.transition !== 'cut');

        const overlays: CloudManifestSceneOverlay[] = sceneOverlayUploadIds[
          idx
        ].map((ov) => ({
          r2Key: presignedUploads[ov.uploadId].r2Key,
          x: ov.x,
          y: ov.y,
          localStart: ov.localStart,
          localEnd: ov.localEnd,
        }));

        return {
          sceneIndex: idx,
          assetKind: assetMeta.analysis?.kind === 'video' ? 'video' : 'image',
          assetDuration:
            assetMeta.analysis?.kind === 'video'
              ? assetMeta.analysis.duration
              : sceneDur,
          assetExt,
          sourceR2Key: presignedUploads[`src_${assetMeta.id}`].r2Key,
          sourceInPoint: scene.sourceInPoint,
          duration: sceneDur,
          cropMode: scene.cropMode,
          zoomAnimation: scene.zoomAnimation,
          fadeIn,
          fadeOut,
          fadeOutDuration: isLast ? 0.35 : 0.18,
          contrast: edl.colorGrade.contrast,
          brightness: edl.colorGrade.brightness,
          saturation: edl.colorGrade.saturation,
          overlays,
        };
      }),
    };

    onProgress({
      stage: 'uploading_cloud',
      detail: 'Verifying R2 assets & dispatching job to Cloudflare Queues...',
      percent: 94,
    });

    const enqueueRes = await fetch(
      `/api/cloud/jobs/${encodeURIComponent(activeJob.id)}/enqueue`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({manifest}),
        signal,
      }
    );
    const enqueueData = await enqueueRes.json();
    if (!enqueueRes.ok) {
      throw new Error(
        enqueueData.error || 'Failed to enqueue cloud rendering job.'
      );
    }

    const queuedJob = enqueueData.job as CloudJobRecord;

    onProgress({
      stage: 'queued_cloud',
      detail:
        'Accepted by Cloudflare Queue! You may now close Chrome, leave this page, or turn off your phone.',
      percent: 100,
    });

    return queuedJob;
  } catch (err) {
    if (err instanceof CloudUploadCancelledError || signal?.aborted) {
      await cancelCloudJob(activeJob.id).catch(() => {});
      throw new CloudUploadCancelledError();
    }
    const errMsg =
      err instanceof Error ? err.message : 'Cloud upload or queue dispatch failed.';
    await updateCloudJobStage(activeJob.id, {
      state: 'FAILED',
      uploadStatus: 'failed',
      completionStatus: 'failed',
      errorDetails: errMsg,
      progressDetail: 'Upload interrupted before queueing.',
    }).catch(() => {});
    throw err;
  }
}
