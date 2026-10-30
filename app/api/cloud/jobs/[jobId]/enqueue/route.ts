import {NextRequest, NextResponse} from 'next/server';
import {CloudConfigError, resolveCloudConfig} from '@/lib/cloud/config';
import {getCloudJobRecord, updateCloudJobRecord} from '@/lib/cloud/d1';
import {headR2Object, putR2Object} from '@/lib/cloud/r2';
import {enqueueRenderJobMessage} from '@/lib/cloud/queue';
import type {CloudRenderManifest} from '@/lib/types';

export async function POST(
  req: NextRequest,
  {params}: {params: Promise<{jobId: string}>}
) {
  try {
    const {jobId} = await params;
    const config = resolveCloudConfig(req);
    const existing = await getCloudJobRecord(config, jobId);

    if (!existing) {
      return NextResponse.json(
        {error: `Cloud job "${jobId}" not found in D1.`},
        {status: 404}
      );
    }

    if (existing.state === 'CANCELLED') {
      return NextResponse.json(
        {error: 'Cannot enqueue a cancelled job.'},
        {status: 409}
      );
    }

    const body = (await req.json()) as {manifest?: CloudRenderManifest};
    const manifest = body.manifest;
    if (
      !manifest ||
      manifest.jobId !== jobId ||
      !Array.isArray(manifest.scenes) ||
      manifest.scenes.length === 0 ||
      !manifest.masterAudioKey
    ) {
      return NextResponse.json(
        {error: 'Invalid or incomplete CloudRenderManifest.'},
        {status: 400}
      );
    }

    // Security check: ensure no API keys or unexpected fields leaked into manifest
    const serializedManifest = JSON.stringify(manifest);
    if (serializedManifest.includes('AIza')) {
      return NextResponse.json(
        {error: 'Security policy violation: API keys are forbidden in render manifests.'},
        {status: 400}
      );
    }

    // Verify master audio and unique visual source files exist in private R2
    const keysToVerify = new Set<string>([manifest.masterAudioKey]);
    for (const sc of manifest.scenes) {
      keysToVerify.add(sc.sourceR2Key);
    }

    for (const r2Key of keysToVerify) {
      const check = await headR2Object(config, r2Key);
      if (!check.exists || check.sizeBytes === 0) {
        return NextResponse.json(
          {
            error: `Required uploaded media object "${r2Key}" was not found in private R2 storage.`,
          },
          {status: 400}
        );
      }
    }

    const manifestKey = `${existing.r2Prefix}/manifest.json`;
    const outputVideoKey = `${existing.r2Prefix}/output/final.mp4`;

    await putR2Object(
      config,
      manifestKey,
      serializedManifest,
      'application/json'
    );

    await enqueueRenderJobMessage(config, {
      jobId,
      projectId: existing.projectId,
      projectName: manifest.projectName || existing.projectName,
      r2Prefix: existing.r2Prefix,
      manifestKey,
      outputVideoKey,
      enqueuedAt: Date.now(),
    });

    const updated = await updateCloudJobRecord(config, jobId, {
      projectName: manifest.projectName || existing.projectName,
      state: 'QUEUED',
      uploadStatus: 'completed',
      analysisStatus: 'completed',
      planStatus: 'completed',
      renderStatus: 'pending',
      completionStatus: 'incomplete',
      manifestKey,
      outputVideoKey,
      errorDetails: null,
      progressPercent: 55,
      progressDetail:
        'Job queued in Cloudflare Queues. You can safely close Chrome or turn off your phone.',
    });

    return NextResponse.json({job: updated});
  } catch (err) {
    if (err instanceof CloudConfigError) {
      return NextResponse.json(
        {error: err.message, code: err.code},
        {status: err.status}
      );
    }
    const msg =
      err instanceof Error
        ? err.message
        : 'Failed to enqueue cloud rendering job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}
