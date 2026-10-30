import crypto from 'node:crypto';
import type {CloudConnectionSettings} from '@/lib/types';

function sha256Hex(data: string | Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export function awsUriEncode(input: string, encodeSlash = true): string {
  const bytes = Buffer.from(input, 'utf8');
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const ch = String.fromCharCode(b);
    if (
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.' ||
      (!encodeSlash && ch === '/')
    ) {
      result += ch;
    } else {
      result += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return result;
}

function formatAmzTimestamps(now = new Date()): {
  amzDate: string;
  dateStamp: string;
} {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function buildCanonicalQueryString(params: Record<string, string>): string {
  const encodedPairs = Object.entries(params).map(([k, v]) => [
    awsUriEncode(k, true),
    awsUriEncode(v, true),
  ]);
  encodedPairs.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );
  return encodedPairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function getR2Host(config: CloudConnectionSettings): string {
  return `${config.r2AccountId}.r2.cloudflarestorage.com`;
}

function buildObjectCanonicalUri(bucket: string, key?: string): string {
  const cleanBucket = awsUriEncode(bucket, true);
  if (!key) {
    return `/${cleanBucket}`;
  }
  const cleanKey = key.replace(/^\/+/, '');
  return `/${cleanBucket}/${awsUriEncode(cleanKey, false)}`;
}

/**
 * Generates a short-lived (default 10 minutes) private presigned PUT URL for Cloudflare R2.
 * Uses UNSIGNED-PAYLOAD and signs host so browser direct uploads never route media through Vercel.
 */
export function createPresignedPutUrl(
  config: CloudConnectionSettings,
  key: string,
  expiresSeconds = 600
): string {
  const host = getR2Host(config);
  const canonicalUri = buildObjectCanonicalUri(config.r2BucketName, key);
  const {amzDate, dateStamp} = formatAmzTimestamps();
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.r2AccessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(60, Math.min(3600, expiresSeconds))),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQuery = buildCanonicalQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(
    config.r2SecretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Generates a short-lived (default 10 minutes) private presigned GET URL for completed MP4 playback/download.
 */
export function createPresignedGetUrl(
  config: CloudConnectionSettings,
  key: string,
  options?: {downloadFilename?: string; expiresSeconds?: number}
): {url: string; expiresAt: number} {
  const expiresSeconds = Math.max(
    60,
    Math.min(3600, options?.expiresSeconds ?? 600)
  );
  const host = getR2Host(config);
  const canonicalUri = buildObjectCanonicalUri(config.r2BucketName, key);
  const now = new Date();
  const {amzDate, dateStamp} = formatAmzTimestamps(now);
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.r2AccessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };

  if (options?.downloadFilename) {
    const safeName = options.downloadFilename.replace(/[^a-zA-Z0-9._-]+/g, '-');
    queryParams['response-content-disposition'] =
      `attachment; filename="${safeName}"`;
    queryParams['response-content-type'] = 'video/mp4';
  }

  const canonicalQuery = buildCanonicalQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(
    config.r2SecretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: now.getTime() + expiresSeconds * 1000,
  };
}

async function signedR2Fetch(params: {
  config: CloudConnectionSettings;
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key?: string;
  query?: Record<string, string>;
  body?: Buffer | Uint8Array | string;
  contentType?: string;
}): Promise<Response> {
  const {config, method, key, query = {}, body, contentType} = params;
  const host = getR2Host(config);
  const canonicalUri = buildObjectCanonicalUri(config.r2BucketName, key);
  const {amzDate, dateStamp} = formatAmzTimestamps();
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const payloadBuf =
    body === undefined
      ? Buffer.alloc(0)
      : typeof body === 'string'
        ? Buffer.from(body, 'utf8')
        : Buffer.from(body);

  const payloadHash = sha256Hex(payloadBuf);

  const headerMap: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    headerMap['content-type'] = contentType;
  }

  const sortedHeaderKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${headerMap[k].trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');
  const canonicalQuery = buildCanonicalQueryString(query);

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
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

  const signingKey = getSigningKey(
    config.r2SecretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders: Record<string, string> = {
    Authorization: authHeader,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) {
    requestHeaders['Content-Type'] = contentType;
  }

  const url = `https://${host}${canonicalUri}${
    canonicalQuery ? `?${canonicalQuery}` : ''
  }`;

  return fetch(url, {
    method,
    headers: requestHeaders,
    body:
      method === 'GET' || method === 'HEAD' || payloadBuf.length === 0
        ? undefined
        : new Uint8Array(payloadBuf),
    cache: 'no-store',
  });
}

export async function putR2Object(
  config: CloudConnectionSettings,
  key: string,
  body: string | Uint8Array | Buffer,
  contentType: string
): Promise<void> {
  const res = await signedR2Fetch({
    config,
    method: 'PUT',
    key,
    body,
    contentType,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `R2 PUT failed (${res.status}) for "${key}": ${errText.slice(0, 180)}`
    );
  }
}

export async function headR2Object(
  config: CloudConnectionSettings,
  key: string
): Promise<{exists: boolean; sizeBytes: number}> {
  const res = await signedR2Fetch({
    config,
    method: 'HEAD',
    key,
  });
  if (res.status === 404) {
    return {exists: false, sizeBytes: 0};
  }
  if (!res.ok) {
    throw new Error(`R2 HEAD check failed (${res.status}) for "${key}".`);
  }
  const len = Number(res.headers.get('content-length') || '0');
  return {exists: true, sizeBytes: Number.isFinite(len) ? len : 0};
}

export async function checkR2BucketReachable(
  config: CloudConnectionSettings
): Promise<{ok: boolean; message: string}> {
  try {
    const res = await signedR2Fetch({
      config,
      method: 'GET',
      query: {
        'list-type': '2',
        'max-keys': '1',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return {
        ok: false,
        message: `R2 bucket "${config.r2BucketName}" returned HTTP ${res.status}: ${txt.slice(0, 140)}`,
      };
    }
    return {
      ok: true,
      message: `Connected to private R2 bucket "${config.r2BucketName}".`,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `R2 connection failed: ${err.message}`
          : 'R2 connection failed.',
    };
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function listR2ObjectsByPrefix(
  config: CloudConnectionSettings,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = {
      'list-type': '2',
      prefix: prefix.replace(/^\/+/, ''),
      'max-keys': '500',
    };
    if (continuationToken) {
      query['continuation-token'] = continuationToken;
    }

    const res = await signedR2Fetch({
      config,
      method: 'GET',
      query,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(
        `Failed listing R2 objects (${res.status}): ${txt.slice(0, 160)}`
      );
    }

    const xml = await res.text();
    const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const m of keyMatches) {
      if (m[1]) {
        keys.push(decodeXmlEntities(m[1]));
      }
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    const nextMatch = xml.match(
      /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/
    );
    if (truncated && nextMatch?.[1]) {
      continuationToken = decodeXmlEntities(nextMatch[1]);
    } else {
      break;
    }
  }

  return keys;
}

export async function deleteR2Object(
  config: CloudConnectionSettings,
  key: string
): Promise<void> {
  const res = await signedR2Fetch({
    config,
    method: 'DELETE',
    key,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed deleting R2 object "${key}" (${res.status}).`);
  }
}

export async function deleteR2ObjectsByPrefix(
  config: CloudConnectionSettings,
  prefix: string
): Promise<number> {
  const keys = await listR2ObjectsByPrefix(config, prefix);
  if (keys.length === 0) return 0;

  const CONCURRENCY = 8;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const slice = keys.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((k) => deleteR2Object(config, k)));
  }

  return keys.length;
}
