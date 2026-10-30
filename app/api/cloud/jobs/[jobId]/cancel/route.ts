import {NextRequest, NextResponse} from 'next/server';
import {CloudConfigError, resolveCloudConfig} from '@/lib/cloud/config';
import {getCloudJobRecord, updateCloudJobRecord} from '@/lib/cloud/d1';

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

    if (existing.state === 'COMPLETED') {
      return NextResponse.json(
        {error: 'Job has already completed rendering.'},
        {status: 409}
      );
    }

    const updated = await updateCloudJobRecord(config, jobId, {
      state: 'CANCELLED',
      uploadStatus:
        existing.uploadStatus === 'completed' ? 'completed' : 'cancelled',
      renderStatus: 'cancelled',
      completionStatus: 'cancelled',
      progressDetail: 'Cancelled by user.',
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
      err instanceof Error ? err.message : 'Failed to cancel cloud job.';
    return NextResponse.json({error: msg}, {status: 500});
  }
}
