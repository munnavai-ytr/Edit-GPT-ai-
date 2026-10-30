import {NextRequest, NextResponse} from 'next/server';
import {inspectCloudConfigPresence} from '@/lib/cloud/config';
import {checkR2BucketReachable} from '@/lib/cloud/r2';
import {checkD1Reachable, getWorkerHeartbeatSummary} from '@/lib/cloud/d1';
import {checkQueueReachable} from '@/lib/cloud/queue';

async function handleCloudStatus(req: NextRequest) {
  const inspection = inspectCloudConfigPresence(req);

  if (!inspection.configured) {
    return NextResponse.json({
      configured: false,
      ready: false,
      configSource: inspection.configSource,
      missingFields: inspection.missingFields,
      r2: {
        ok: false,
        message: 'Cloudflare R2 credentials not configured.',
      },
      d1: {
        ok: false,
        message: 'Cloudflare D1 database credentials not configured.',
      },
      queue: {
        ok: false,
        message: 'Cloudflare Queue ID not configured.',
      },
      worker: {
        status: 'never_seen' as const,
        message: 'Configure D1 & Queue to inspect FFmpeg Worker heartbeat.',
      },
    });
  }

  const cfg = inspection.partialConfig;
  const [r2, d1, queue] = await Promise.all([
    checkR2BucketReachable(cfg),
    checkD1Reachable(cfg),
    checkQueueReachable(cfg),
  ]);

  const worker = d1.ok
    ? await getWorkerHeartbeatSummary(cfg).catch((err) => ({
        status: 'never_seen' as const,
        message:
          err instanceof Error
            ? err.message
            : 'Unable to query worker heartbeat.',
      }))
    : {
        status: 'never_seen' as const,
        message: 'D1 connection required to read FFmpeg Worker heartbeat.',
      };

  const ready = r2.ok && d1.ok && queue.ok;

  return NextResponse.json({
    configured: true,
    ready,
    configSource: inspection.configSource,
    missingFields: [],
    r2,
    d1,
    queue,
    worker,
  });
}

export async function GET(req: NextRequest) {
  return handleCloudStatus(req);
}

export async function POST(req: NextRequest) {
  return handleCloudStatus(req);
}
