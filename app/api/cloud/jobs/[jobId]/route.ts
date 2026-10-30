import {NextRequest, NextResponse} from 'next/server';
import {CloudConfigError, resolveCloudConfig} from '@/lib/cloud/config';
import {
  deleteCloudJobRecord,
  getCloudJobRecord,
  updateCloudJobRecord,
} from '@/lib/cloud/d1';
import {
  createPresignedGetUrl,
  createPresignedPutUrl,
  deleteR2ObjectsByPrefix,
  headR2Object,
} from '@/lib/cloud/r2';
import type {CloudJobState, StepStatus} from '@/lib/types';

export async function GET(
  req: NextRequest,
  {params}: {params: Promise<{jobId: string}>}
) {
  try {
    const {jobId} = await params;
    const config = resolveCloudConfig(req);
    const job = await getCloudJobRecord(config, jobId);

    if (!job) {
      return NextResponse.json(
        {error: `Cloud job "${jobId}" not found in D1.`},
        {status: 404}
      );
    }

    if (job.state === 'COMPLETED' && job.outputVideoKey) {
      const head = await headR2Object(config, job.outputVideoKey);
      if (head.exists) {
        const safeName = `${job.projectName || 'short'}-${job.id.slice(-6)}.mp4`;
        const signed = createPresignedGetUrl(config, job.outputVideoKey, {
          downloadFilename: safeName,
          expiresSeconds: 600,
        });
        job.outputVideoSignedUrl = signed.url;
        job.outputSignedUrlExpiresAt = signed.expiresAt;
      }
    }

    return NextResponse.json({job});
  } catch (err) {
    if (err instanceof CloudConfigError) {
      return NextResponse.json(
        {error: err.message, code: err.code},
        {status: err.status}
      );
    }
    const msg =
      err instanceof Error ? err.message : 'Failed to retrieve cloud job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}

export async function PATCH(
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

    const body = (await req.json()) as {
      projectName?: string;
      state?: CloudJobState;
      uploadStatus?: StepStatus;
      analysisStatus?: StepStatus;
      planStatus?: StepStatus;
      renderStatus?: StepStatus;
      completionStatus?: 'incomplete' | 'completed' | 'failed' | 'cancelled';
      progressPercent?: number;
      progressDetail?: string;
      errorDetails?: string | null;
      filesToSign?: Array<{id: string; keySuffix: string}>;
    };

    const updated = await updateCloudJobRecord(config, jobId, {
      projectName: body.projectName,
      state: body.state,
      uploadStatus: body.uploadStatus,
      analysisStatus: body.analysisStatus,
      planStatus: body.planStatus,
      renderStatus: body.renderStatus,
      completionStatus: body.completionStatus,
      progressPercent: body.progressPercent,
      progressDetail: body.progressDetail,
      errorDetails: body.errorDetails,
    });

    const presignedUploads: Record<string, {r2Key: string; uploadUrl: string}> =
      {};

    if (Array.isArray(body.filesToSign)) {
      for (const item of body.filesToSign) {
        const cleanSuffix = String(item.keySuffix || '')
          .replace(/^\/+/, '')
          .replace(/\.\./g, '');
        if (!cleanSuffix) continue;
        const r2Key = `${existing.r2Prefix}/${cleanSuffix}`;
        const uploadUrl = createPresignedPutUrl(config, r2Key, 900);
        presignedUploads[item.id] = {r2Key, uploadUrl};
      }
    }

    return NextResponse.json({
      job: updated,
      presignedUploads,
    });
  } catch (err) {
    if (err instanceof CloudConfigError) {
      return NextResponse.json(
        {error: err.message, code: err.code},
        {status: err.status}
      );
    }
    const msg =
      err instanceof Error ? err.message : 'Failed to update cloud job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}

export async function DELETE(
  req: NextRequest,
  {params}: {params: Promise<{jobId: string}>}
) {
  try {
    const {jobId} = await params;
    const config = resolveCloudConfig(req);
    const scope = req.nextUrl.searchParams.get('scope');
    const existing = await getCloudJobRecord(config, jobId);

    const prefix = existing?.r2Prefix || `jobs/${jobId}`;

    if (scope === 'temp_only') {
      const deletedInputs = await deleteR2ObjectsByPrefix(
        config,
        `${prefix}/inputs/`
      );
      const deletedOverlays = await deleteR2ObjectsByPrefix(
        config,
        `${prefix}/overlays/`
      );
      return NextResponse.json({
        deletedObjects: deletedInputs + deletedOverlays,
        scope: 'temp_only',
      });
    }

    const deletedObjects = await deleteR2ObjectsByPrefix(config, `${prefix}/`);
    await deleteCloudJobRecord(config, jobId);

    return NextResponse.json({
      deletedJobId: jobId,
      deletedObjects,
      scope: 'all',
    });
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
        : 'Failed to delete cloud job and R2 assets.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}
