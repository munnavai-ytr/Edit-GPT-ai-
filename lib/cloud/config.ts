import type {NextRequest} from 'next/server';
import type {CloudConnectionSettings} from '@/lib/types';

export class CloudConfigError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'CLOUD_NOT_CONFIGURED') {
    super(message);
    this.name = 'CloudConfigError';
    this.status = status;
    this.code = code;
  }
}

function cleanEnv(val?: string): string {
  const trimmed = (val || '').trim();
  if (
    !trimmed ||
    trimmed.startsWith('YOUR_') ||
    trimmed === 'MY_GEMINI_API_KEY' ||
    trimmed === 'MY_APP_URL'
  ) {
    return '';
  }
  return trimmed;
}

function parseClientCloudHeader(
  req?: NextRequest
): Partial<CloudConnectionSettings> {
  const encoded = req?.headers.get('x-cloud-config')?.trim();
  if (!encoded) return {};

  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as Partial<CloudConnectionSettings>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export interface ResolvedCloudConfig extends CloudConnectionSettings {
  configSource: 'client_vault' | 'server_env' | 'hybrid';
}

export function inspectCloudConfigPresence(req?: NextRequest): {
  configured: boolean;
  missingFields: string[];
  configSource: 'client_vault' | 'server_env' | 'hybrid' | 'none';
  partialConfig: CloudConnectionSettings;
} {
  const clientCfg = parseClientCloudHeader(req);
  const hasClient = Object.values(clientCfg).some(
    (v) => typeof v === 'string' && v.trim().length > 0
  );

  const envAccountId = cleanEnv(process.env.CF_ACCOUNT_ID);
  const envApiToken = cleanEnv(process.env.CF_API_TOKEN);
  const envD1Id = cleanEnv(process.env.CF_D1_DATABASE_ID);
  const envQueueId = cleanEnv(process.env.CF_QUEUE_ID);
  const envR2Account = cleanEnv(process.env.R2_ACCOUNT_ID) || envAccountId;
  const envR2Access = cleanEnv(process.env.R2_ACCESS_KEY_ID);
  const envR2Secret = cleanEnv(process.env.R2_SECRET_ACCESS_KEY);
  const envR2Bucket = cleanEnv(process.env.R2_BUCKET_NAME);
  const envWakeUrl = cleanEnv(process.env.FFMPEG_WORKER_WAKE_URL);
  const envWakeSecret = cleanEnv(process.env.FFMPEG_WORKER_SHARED_SECRET);

  const hasEnv = Boolean(
    envAccountId ||
      envApiToken ||
      envD1Id ||
      envQueueId ||
      envR2Access ||
      envR2Secret ||
      envR2Bucket
  );

  const cfAccountId = clientCfg.cfAccountId?.trim() || envAccountId;
  const partialConfig: CloudConnectionSettings = {
    cfAccountId,
    cfApiToken: clientCfg.cfApiToken?.trim() || envApiToken,
    cfD1DatabaseId: clientCfg.cfD1DatabaseId?.trim() || envD1Id,
    cfQueueId: clientCfg.cfQueueId?.trim() || envQueueId,
    r2AccountId: clientCfg.r2AccountId?.trim() || envR2Account || cfAccountId,
    r2AccessKeyId: clientCfg.r2AccessKeyId?.trim() || envR2Access,
    r2SecretAccessKey: clientCfg.r2SecretAccessKey?.trim() || envR2Secret,
    r2BucketName: clientCfg.r2BucketName?.trim() || envR2Bucket,
    workerWakeUrl: clientCfg.workerWakeUrl?.trim() || envWakeUrl || undefined,
    workerSharedSecret:
      clientCfg.workerSharedSecret?.trim() || envWakeSecret || undefined,
  };

  const missingFields: string[] = [];
  if (!partialConfig.cfAccountId) missingFields.push('CF_ACCOUNT_ID');
  if (!partialConfig.cfApiToken) missingFields.push('CF_API_TOKEN');
  if (!partialConfig.cfD1DatabaseId) missingFields.push('CF_D1_DATABASE_ID');
  if (!partialConfig.cfQueueId) missingFields.push('CF_QUEUE_ID');
  if (!partialConfig.r2AccountId) missingFields.push('R2_ACCOUNT_ID');
  if (!partialConfig.r2AccessKeyId) missingFields.push('R2_ACCESS_KEY_ID');
  if (!partialConfig.r2SecretAccessKey)
    missingFields.push('R2_SECRET_ACCESS_KEY');
  if (!partialConfig.r2BucketName) missingFields.push('R2_BUCKET_NAME');

  const configSource =
    hasClient && hasEnv
      ? 'hybrid'
      : hasClient
        ? 'client_vault'
        : hasEnv
          ? 'server_env'
          : 'none';

  return {
    configured: missingFields.length === 0,
    missingFields,
    configSource,
    partialConfig,
  };
}

export function resolveCloudConfig(req?: NextRequest): ResolvedCloudConfig {
  const {configured, missingFields, configSource, partialConfig} =
    inspectCloudConfigPresence(req);

  if (!configured) {
    throw new CloudConfigError(
      `Cloud Background Rendering is not configured yet. Missing: ${missingFields.join(
        ', '
      )}. Configure Cloudflare R2, D1, and Queues in Settings → Cloud Render, or switch to Local FFmpeg.wasm mode.`,
      400,
      'CLOUD_NOT_CONFIGURED'
    );
  }

  return {
    ...partialConfig,
    configSource: configSource === 'none' ? 'server_env' : configSource,
  };
}
