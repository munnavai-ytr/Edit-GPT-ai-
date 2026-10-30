import type {
  CloudConnectionSettings,
  CloudJobRecord,
  CloudJobState,
  StepStatus,
} from '@/lib/types';

interface D1QueryEnvelope<T = Record<string, unknown>> {
  success: boolean;
  errors?: Array<{code?: number; message?: string}>;
  result?: Array<{
    success: boolean;
    results?: T[];
  }>;
}

let initializedD1Keys = new Set<string>();

async function executeD1Query<T = Record<string, unknown>>(
  config: CloudConnectionSettings,
  sql: string,
  params: Array<string | number | null> = []
): Promise<T[]> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    config.cfAccountId
  )}/d1/database/${encodeURIComponent(config.cfD1DatabaseId)}/query`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({sql, params}),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => null)) as D1QueryEnvelope<T> | null;

  if (!res.ok || !payload?.success) {
    const errMsg =
      payload?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
      `Cloudflare D1 HTTP ${res.status}`;
    throw new Error(`Cloudflare D1 error: ${errMsg}`);
  }

  const firstStatement = payload.result?.[0];
  return Array.isArray(firstStatement?.results) ? firstStatement.results : [];
}

export async function ensureCloudTables(
  config: CloudConnectionSettings
): Promise<void> {
  const cacheKey = `${config.cfAccountId}:${config.cfD1DatabaseId}`;
  if (initializedD1Keys.has(cacheKey)) return;

  await executeD1Query(
    config,
    `CREATE TABLE IF NOT EXISTS render_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      state TEXT NOT NULL,
      upload_status TEXT NOT NULL,
      analysis_status TEXT NOT NULL,
      plan_status TEXT NOT NULL,
      render_status TEXT NOT NULL,
      completion_status TEXT NOT NULL,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      progress_detail TEXT NOT NULL DEFAULT '',
      error_details TEXT,
      r2_prefix TEXT NOT NULL,
      manifest_key TEXT,
      output_video_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`
  );

  await executeD1Query(
    config,
    `CREATE INDEX IF NOT EXISTS idx_render_jobs_created_at ON render_jobs(created_at DESC);`
  );

  await executeD1Query(
    config,
    `CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      ffmpeg_version TEXT NOT NULL,
      active_job_id TEXT,
      last_seen_at INTEGER NOT NULL
    );`
  );

  initializedD1Keys.add(cacheKey);
}

interface RawD1JobRow {
  id: string;
  project_id: string;
  project_name: string;
  state: CloudJobState;
  upload_status: StepStatus;
  analysis_status: StepStatus;
  plan_status: StepStatus;
  render_status: StepStatus;
  completion_status: 'incomplete' | 'completed' | 'failed' | 'cancelled';
  progress_percent: number;
  progress_detail: string;
  error_details: string | null;
  r2_prefix: string;
  manifest_key: string | null;
  output_video_key: string | null;
  created_at: number;
  updated_at: number;
}

function mapRowToCloudJob(row: RawD1JobRow): CloudJobRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: String(row.project_name),
    state: row.state,
    uploadStatus: row.upload_status,
    analysisStatus: row.analysis_status,
    planStatus: row.plan_status,
    renderStatus: row.render_status,
    completionStatus: row.completion_status,
    progressPercent: Number(row.progress_percent) || 0,
    progressDetail: String(row.progress_detail || ''),
    errorDetails: row.error_details ? String(row.error_details) : null,
    r2Prefix: String(row.r2_prefix),
    manifestKey: row.manifest_key ? String(row.manifest_key) : null,
    outputVideoKey: row.output_video_key ? String(row.output_video_key) : null,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

export async function createCloudJobRecord(
  config: CloudConnectionSettings,
  job: CloudJobRecord
): Promise<CloudJobRecord> {
  await ensureCloudTables(config);
  await executeD1Query(
    config,
    `INSERT INTO render_jobs (
      id, project_id, project_name, state,
      upload_status, analysis_status, plan_status, render_status, completion_status,
      progress_percent, progress_detail, error_details,
      r2_prefix, manifest_key, output_video_key,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.projectId,
      job.projectName,
      job.state,
      job.uploadStatus,
      job.analysisStatus,
      job.planStatus,
      job.renderStatus,
      job.completionStatus,
      Math.round(job.progressPercent),
      job.progressDetail,
      job.errorDetails,
      job.r2Prefix,
      job.manifestKey,
      job.outputVideoKey,
      job.createdAt,
      job.updatedAt,
    ]
  );
  return job;
}

export async function getCloudJobRecord(
  config: CloudConnectionSettings,
  jobId: string
): Promise<CloudJobRecord | null> {
  await ensureCloudTables(config);
  const rows = await executeD1Query<RawD1JobRow>(
    config,
    `SELECT * FROM render_jobs WHERE id = ? LIMIT 1`,
    [jobId]
  );
  if (rows.length === 0) return null;
  return mapRowToCloudJob(rows[0]);
}

export async function listCloudJobRecords(
  config: CloudConnectionSettings,
  limit = 50
): Promise<CloudJobRecord[]> {
  await ensureCloudTables(config);
  const rows = await executeD1Query<RawD1JobRow>(
    config,
    `SELECT * FROM render_jobs ORDER BY created_at DESC LIMIT ?`,
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map(mapRowToCloudJob);
}

export async function updateCloudJobRecord(
  config: CloudConnectionSettings,
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
    manifestKey: string | null;
    outputVideoKey: string | null;
  }>
): Promise<CloudJobRecord | null> {
  await ensureCloudTables(config);
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.projectName !== undefined) {
    sets.push('project_name = ?');
    values.push(patch.projectName);
  }
  if (patch.state !== undefined) {
    sets.push('state = ?');
    values.push(patch.state);
  }
  if (patch.uploadStatus !== undefined) {
    sets.push('upload_status = ?');
    values.push(patch.uploadStatus);
  }
  if (patch.analysisStatus !== undefined) {
    sets.push('analysis_status = ?');
    values.push(patch.analysisStatus);
  }
  if (patch.planStatus !== undefined) {
    sets.push('plan_status = ?');
    values.push(patch.planStatus);
  }
  if (patch.renderStatus !== undefined) {
    sets.push('render_status = ?');
    values.push(patch.renderStatus);
  }
  if (patch.completionStatus !== undefined) {
    sets.push('completion_status = ?');
    values.push(patch.completionStatus);
  }
  if (patch.progressPercent !== undefined) {
    sets.push('progress_percent = ?');
    values.push(Math.round(patch.progressPercent));
  }
  if (patch.progressDetail !== undefined) {
    sets.push('progress_detail = ?');
    values.push(patch.progressDetail);
  }
  if (patch.errorDetails !== undefined) {
    sets.push('error_details = ?');
    values.push(patch.errorDetails);
  }
  if (patch.manifestKey !== undefined) {
    sets.push('manifest_key = ?');
    values.push(patch.manifestKey);
  }
  if (patch.outputVideoKey !== undefined) {
    sets.push('output_video_key = ?');
    values.push(patch.outputVideoKey);
  }

  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(jobId);

  await executeD1Query(
    config,
    `UPDATE render_jobs SET ${sets.join(', ')} WHERE id = ?`,
    values
  );

  return getCloudJobRecord(config, jobId);
}

export async function deleteCloudJobRecord(
  config: CloudConnectionSettings,
  jobId: string
): Promise<void> {
  await ensureCloudTables(config);
  await executeD1Query(config, `DELETE FROM render_jobs WHERE id = ?`, [jobId]);
}

export interface WorkerHeartbeatSummary {
  status: 'online' | 'stale' | 'never_seen';
  workerId?: string;
  hostname?: string;
  ffmpegVersion?: string;
  activeJobId?: string | null;
  lastSeenAt?: number;
  message: string;
}

export async function getWorkerHeartbeatSummary(
  config: CloudConnectionSettings
): Promise<WorkerHeartbeatSummary> {
  await ensureCloudTables(config);
  const rows = await executeD1Query<{
    worker_id: string;
    hostname: string;
    ffmpeg_version: string;
    active_job_id: string | null;
    last_seen_at: number;
  }>(
    config,
    `SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`
  );

  if (rows.length === 0) {
    return {
      status: 'never_seen',
      message:
        'No FFmpeg Worker Server heartbeat detected yet. Jobs pushed to Cloudflare Queues will wait safely until your worker starts.',
    };
  }

  const latest = rows[0];
  const lastSeenAt = Number(latest.last_seen_at) || 0;
  const ageMs = Date.now() - lastSeenAt;
  const isOnline = ageMs <= 90_000;

  return {
    status: isOnline ? 'online' : 'stale',
    workerId: latest.worker_id,
    hostname: latest.hostname,
    ffmpegVersion: latest.ffmpeg_version,
    activeJobId: latest.active_job_id,
    lastSeenAt,
    message: isOnline
      ? `FFmpeg Worker "${latest.hostname}" is online (${latest.ffmpeg_version}).`
      : `FFmpeg Worker "${latest.hostname}" last checked in ${Math.round(
          ageMs / 60000
        )}m ago. Queued jobs remain persisted until the worker resumes.`,
  };
}

export async function checkD1Reachable(
  config: CloudConnectionSettings
): Promise<{ok: boolean; message: string}> {
  try {
    await ensureCloudTables(config);
    return {
      ok: true,
      message: 'Connected to Cloudflare D1 job metadata database.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'Cloudflare D1 connection failed.',
    };
  }
}
