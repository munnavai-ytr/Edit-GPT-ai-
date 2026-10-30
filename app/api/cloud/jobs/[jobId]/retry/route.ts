import {NextRequest, NextResponse} from 'next/server';
import {CloudConfigError, resolveCloudConfig} from '@/lib/cloud/config';
import {getCloudJobRecord, updateCloudJobRecord} from '@/lib/cloud/d1';
import {headR2Object} from '@/lib/cloud/r2';
import {enqueueRenderJobMessage} from '@/lib/cloud/queue';

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
        {error: `Cloud job "${jobId}" not found.`},
        {status: 404}
      );
    }

    const manifestKey =
      existing.manifestKey || `${existing.r2Prefix}/manifest.json`;
    const manifestHead = await headR2Object(config, manifestKey);

    if (!manifestHead.exists) {
      return NextResponse.json({
        job: existing,
        action: 'resume_from_client' as const,
        message:
          'Media upload had not finished before interruption. Resume upload from your saved local project.',
      });
    }

    const outputVideoKey =
      existing.outputVideoKey || `${existing.r2Prefix}/output/final.mp4`;

    await enqueueRenderJobMessage(config, {
      jobId: existing.id,
      projectId: existing.projectId,
      projectName: existing.projectName,
      r2Prefix: existing.r2Prefix,
      manifestKey,
      outputVideoKey,
      enqueuedAt: Date.now(),
    });

    const updated = await updateCloudJobRecord(config, jobId, {
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
        'Job re-dispatched to Cloudflare Queues for FFmpeg Worker rendering.',
    });

    return NextResponse.json({
      job: updated,
      action: 'requeued' as const,
    });
  } catch (err) {
    if (err instanceof CloudConfigError) {
      return NextResponse.json(
        {error: err.message, code: err.code},
        {status: err.status}
      );
    }
    const msg =
      err instanceof Error ? err.message : 'Failed to retry cloud job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}
