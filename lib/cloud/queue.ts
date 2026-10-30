import type {CloudConnectionSettings} from '@/lib/types';

export interface CloudQueueJobMessage {
  jobId: string;
  projectId: string;
  projectName: string;
  r2Prefix: string;
  manifestKey: string;
  outputVideoKey: string;
  enqueuedAt: number;
}

export async function enqueueRenderJobMessage(
  config: CloudConnectionSettings,
  message: CloudQueueJobMessage
): Promise<void> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    config.cfAccountId
  )}/queues/${encodeURIComponent(config.cfQueueId)}/messages`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: message,
      content_type: 'json',
    }),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: Array<{message?: string}>;
  } | null;

  if (!res.ok || !payload?.success) {
    const errText =
      payload?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
      `HTTP ${res.status}`;
    throw new Error(`Cloudflare Queues dispatch failed: ${errText}`);
  }

  // Optional wake webhook if the user runs a scale-to-zero / on-demand FFmpeg compute server
  if (config.workerWakeUrl) {
    const wakeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.workerSharedSecret) {
      wakeHeaders['x-worker-secret'] = config.workerSharedSecret;
    }

    fetch(config.workerWakeUrl, {
      method: 'POST',
      headers: wakeHeaders,
      body: JSON.stringify({jobId: message.jobId, trigger: 'cloudflare_queue'}),
    }).catch(() => {
      // Non-fatal: job is already durably stored in Cloudflare Queues & D1
    });
  }
}

export async function checkQueueReachable(
  config: CloudConnectionSettings
): Promise<{ok: boolean; queueName?: string; message: string}> {
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      config.cfAccountId
    )}/queues/${encodeURIComponent(config.cfQueueId)}`;

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.cfApiToken}`,
      },
      cache: 'no-store',
    });

    const payload = (await res.json().catch(() => null)) as {
      success?: boolean;
      result?: {queue_name?: string};
      errors?: Array<{message?: string}>;
    } | null;

    if (!res.ok || !payload?.success) {
      const errMsg =
        payload?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
        `HTTP ${res.status}`;
      return {
        ok: false,
        message: `Cloudflare Queue check failed: ${errMsg}`,
      };
    }

    const qName = payload.result?.queue_name || config.cfQueueId;
    return {
      ok: true,
      queueName: qName,
      message: `Connected to Cloudflare Queue "${qName}".`,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Cloudflare Queue connection failed: ${err.message}`
          : 'Cloudflare Queue connection failed.',
    };
  }
}
