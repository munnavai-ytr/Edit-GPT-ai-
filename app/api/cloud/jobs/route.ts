import {NextRequest, NextResponse} from 'next/server';
import {
  CloudConfigError,
  inspectCloudConfigPresence,
  resolveCloudConfig,
} from '@/lib/cloud/config';
import {createCloudJobRecord, listCloudJobRecords} from '@/lib/cloud/d1';
import {createPresignedGetUrl, createPresignedPutUrl} from '@/lib/cloud/r2';
import type {CloudJobRecord, CloudJobState} from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const inspection = inspectCloudConfigPresence(req);
    if (!inspection.configured) {
      return NextResponse.json({
        configured: false,
        jobs: [],
      });
    }

    const jobs = await listCloudJobRecords(inspection.partialConfig, 60);
    const enriched = jobs.map((job) => {
      if (job.state === 'COMPLETED' && job.outputVideoKey) {
        const safeName = `${job.projectName || 'short'}-${job.id.slice(-6)}.mp4`;
        const signed = createPresignedGetUrl(
          inspection.partialConfig,
          job.outputVideoKey,
          {downloadFilename: safeName, expiresSeconds: 600}
        );
        return {
          ...job,
          outputVideoSignedUrl: signed.url,
          outputSignedUrlExpiresAt: signed.expiresAt,
        };
      }
      return job;
    });

    return NextResponse.json({
      configured: true,
      jobs: enriched,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Failed to list persistent cloud jobs.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}

export async function POST(req: NextRequest) {
  try {
    const config = resolveCloudConfig(req);
    const body = (await req.json()) as {
      projectId?: string;
      projectName?: string;
      initialState?: 'ANALYZING' | 'UPLOADING';
      filesToSign?: Array<{id: string; keySuffix: string}>;
    };

    const now = Date.now();
    const jobId = `job_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = (body.projectId || `proj_${now}`).trim();
    const projectName = (body.projectName || 'Untitled Vertical Short').trim();
    const initialState: CloudJobState =
      body.initialState === 'ANALYZING' ? 'ANALYZING' : 'UPLOADING';

    const r2Prefix = `jobs/${jobId}`;

    const job: CloudJobRecord = {
      id: jobId,
      projectId,
      projectName,
      state: initialState,
      uploadStatus: initialState === 'UPLOADING' ? 'in_progress' : 'pending',
      analysisStatus:
        initialState === 'ANALYZING' ? 'in_progress' : 'completed',
      planStatus: initialState === 'ANALYZING' ? 'pending' : 'completed',
      renderStatus: 'pending',
      completionStatus: 'incomplete',
      progressPercent: initialState === 'ANALYZING' ? 5 : 42,
      progressDetail:
        initialState === 'ANALYZING'
          ? 'Analyzing media assets and voiceover...'
          : 'Uploading media & overlays to private Cloudflare R2...',
      errorDetails: null,
      r2Prefix,
      manifestKey: null,
      outputVideoKey: null,
      createdAt: now,
      updatedAt: now,
    };

    await createCloudJobRecord(config, job);

    const presignedUploads: Record<string, {r2Key: string; uploadUrl: string}> =
      {};

    if (Array.isArray(body.filesToSign)) {
      for (const item of body.filesToSign) {
        const cleanSuffix = String(item.keySuffix || '')
          .replace(/^\/+/, '')
          .replace(/\.\./g, '');
        if (!cleanSuffix) continue;
        const r2Key = `${r2Prefix}/${cleanSuffix}`;
        const uploadUrl = createPresignedPutUrl(config, r2Key, 900);
        presignedUploads[item.id] = {r2Key, uploadUrl};
      }
    }

    return NextResponse.json({
      job,
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
      err instanceof Error ? err.message : 'Failed to create cloud render job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}
