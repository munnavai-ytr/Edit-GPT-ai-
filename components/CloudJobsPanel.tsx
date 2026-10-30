'use client';

import React, {useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  Eraser,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import {formatRelativeDate} from '@/lib/format';
import {CloudJobRecord, StepStatus} from '@/lib/types';

interface CloudJobsPanelProps {
  cloudConfigured: boolean;
  jobs: CloudJobRecord[];
  isLoading: boolean;
  localProjectIds: Set<string>;
  onRefreshJobs: () => Promise<void>;
  onOpenCloudConfig: () => void;
  onPreviewCloudJob: (job: CloudJobRecord) => Promise<void>;
  onRetryCloudJob: (job: CloudJobRecord) => Promise<void>;
  onCancelCloudJob: (job: CloudJobRecord) => Promise<void>;
  onResumeInterruptedUpload: (projectId: string) => Promise<void>;
  onDeleteCloudJob: (job: CloudJobRecord, tempOnly: boolean) => Promise<void>;
}

function formatStepLabel(label: string, status: StepStatus): string {
  const shortStatus =
    status === 'completed'
      ? 'Done'
      : status === 'in_progress'
        ? 'Active'
        : status === 'failed'
          ? 'Failed'
          : status === 'cancelled'
            ? 'Stopped'
            : 'Pending';
  return `${label}: ${shortStatus}`;
}

export default function CloudJobsPanel({
  cloudConfigured,
  jobs,
  isLoading,
  localProjectIds,
  onRefreshJobs,
  onOpenCloudConfig,
  onPreviewCloudJob,
  onRetryCloudJob,
  onCancelCloudJob,
  onResumeInterruptedUpload,
  onDeleteCloudJob,
}: CloudJobsPanelProps) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const runAction = async (id: string, fn: () => Promise<void>) => {
    setBusyJobId(id);
    setActionNotice(null);
    try {
      await fn();
    } catch (err) {
      setActionNotice(
        err instanceof Error ? err.message : 'Cloud job action failed.'
      );
    } finally {
      setBusyJobId(null);
    }
  };

  const renderStateIndicator = (job: CloudJobRecord) => {
    switch (job.state) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>COMPLETED</span>
          </span>
        );
      case 'QUEUED':
      case 'RENDERING':
      case 'UPLOADING':
      case 'ANALYZING':
      case 'PLANNING':
        return (
          <span className="inline-flex items-center gap-1.5 text-blue-400 font-semibold">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>{job.state}</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>FAILED</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 text-slate-400 font-semibold">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span>CANCELLED</span>
          </span>
        );
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-400 shrink-0" />
            <h2 className="text-xl font-semibold text-white">
              Cloud Background Rendering Jobs
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            {cloudConfigured
              ? `${jobs.length} persistent ${
                  jobs.length === 1 ? 'job' : 'jobs'
                } in Cloudflare D1 · Private R2 Short-Lived Signed URLs`
              : 'Optional Cloud Queue · Configure R2 + D1 + Queues + FFmpeg Worker to render with browser closed'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {cloudConfigured && (
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void onRefreshJobs()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
              <span>Refresh Status</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCloudConfig}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap"
          >
            <Settings2 className="h-3.5 w-3.5 text-blue-400" />
            <span>{cloudConfigured ? 'Cloud Diagnostics' : 'Configure Cloud Render'}</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-3">
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="underline text-amber-300 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {!cloudConfigured ? (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 max-w-2xl">
            <h3 className="text-sm font-semibold text-white">
              Cloud Background Rendering is Optional &amp; Currently Unconfigured
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Local browser rendering via FFmpeg.wasm works immediately with zero cloud cost. Connect your private Cloudflare R2 bucket, D1 database, Queue, and standalone FFmpeg Worker Server if you want jobs to continue rendering after closing Chrome or turning off your phone.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCloudConfig}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-950/20 px-4 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-600 hover:text-white whitespace-nowrap shrink-0"
          >
            <span>Setup Cloud R2 / D1 / Queue</span>
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0B1120] px-6 py-10 text-center">
          <p className="text-sm font-semibold text-white">
            No persistent cloud jobs in Cloudflare D1 yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Select &ldquo;Cloud Background Rendering&rdquo; when creating or re-rendering a project to dispatch jobs to your FFmpeg Worker Server.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0B1120] divide-y divide-slate-800/80">
          {jobs.map((job) => {
            const isActiveCloud =
              job.state === 'QUEUED' || job.state === 'RENDERING';
            const isRecoverableClient =
              (job.state === 'FAILED' ||
                job.state === 'CANCELLED' ||
                job.state === 'UPLOADING' ||
                job.state === 'ANALYZING' ||
                job.state === 'PLANNING') &&
              !job.manifestKey &&
              localProjectIds.has(job.projectId);

            const safeFilename = `${(job.projectName || 'short')
              .toLowerCase()
              .replace(/[^a-z0-9-_]+/g, '-')}-${job.id.slice(-6)}.mp4`;

            return (
              <div key={job.id} className="p-5 space-y-3.5 hover:bg-slate-900/35">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-base font-semibold text-white truncate">
                        {job.projectName}
                      </h3>
                      <span className="text-xs font-mono tabular-nums">
                        {renderStateIndicator(job)}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        ID: {job.id}
                      </span>
                    </div>

                    {/* Explicit 5-stage persistent job status line */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-400">
                      <span>{formatStepLabel('AI Analysis', job.analysisStatus)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatStepLabel('Edit Plan', job.planStatus)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatStepLabel('R2 Upload', job.uploadStatus)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatStepLabel('FFmpeg Render', job.renderStatus)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Created {formatRelativeDate(job.createdAt)}</span>
                    </div>

                    <p className="text-xs text-slate-300">
                      {job.progressDetail}
                      {isActiveCloud && (
                        <span className="text-emerald-400 ml-2">
                          · Safe to close browser or turn off phone
                        </span>
                      )}
                    </p>

                    {job.errorDetails && (
                      <p className="text-xs text-rose-400 leading-relaxed">
                        Error: {job.errorDetails}
                      </p>
                    )}
                  </div>

                  {/* Job Management Controls */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {job.state === 'COMPLETED' && job.outputVideoSignedUrl && (
                      <>
                        <button
                          type="button"
                          disabled={busyJobId === job.id}
                          onClick={() =>
                            runAction(job.id, () => onPreviewCloudJob(job))
                          }
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-600 hover:text-white whitespace-nowrap"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>Preview</span>
                        </button>
                        <a
                          href={job.outputVideoSignedUrl}
                          download={safeFilename}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download MP4</span>
                        </a>
                        <button
                          type="button"
                          title="Delete temporary R2 input & overlay files while keeping completed MP4"
                          disabled={busyJobId === job.id}
                          onClick={() =>
                            runAction(job.id, async () => {
                              await onDeleteCloudJob(job, true);
                              setActionNotice(
                                `Purged temporary R2 input & overlay assets for "${job.projectName}".`
                              );
                            })
                          }
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                        >
                          <Eraser className="h-3.5 w-3.5" />
                          <span>Purge Temp Files</span>
                        </button>
                      </>
                    )}

                    {(job.state === 'FAILED' || job.state === 'CANCELLED') &&
                      job.manifestKey && (
                        <button
                          type="button"
                          disabled={busyJobId === job.id}
                          onClick={() =>
                            runAction(job.id, () => onRetryCloudJob(job))
                          }
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Retry Job</span>
                        </button>
                      )}

                    {isRecoverableClient && (
                      <button
                        type="button"
                        disabled={busyJobId === job.id}
                        onClick={() =>
                          runAction(job.id, () =>
                            onResumeInterruptedUpload(job.projectId)
                          )
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-500 whitespace-nowrap"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Resume Recoverable Job</span>
                      </button>
                    )}

                    {(job.state === 'QUEUED' ||
                      job.state === 'UPLOADING' ||
                      job.state === 'ANALYZING' ||
                      job.state === 'PLANNING' ||
                      job.state === 'RENDERING') && (
                      <button
                        type="button"
                        disabled={busyJobId === job.id}
                        onClick={() =>
                          runAction(job.id, () => onCancelCloudJob(job))
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/25 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 whitespace-nowrap"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        <span>Cancel</span>
                      </button>
                    )}

                    {confirmDeleteId === job.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyJobId === job.id}
                          onClick={() =>
                            runAction(job.id, async () => {
                              await onDeleteCloudJob(job, false);
                              setConfirmDeleteId(null);
                            })
                          }
                          className="min-h-[40px] rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 whitespace-nowrap"
                        >
                          {busyJobId === job.id
                            ? 'Deleting…'
                            : 'Delete Job & R2'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[40px] rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete cloud job ${job.projectName}`}
                        onClick={() => setConfirmDeleteId(job.id)}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:border-rose-800 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar for In-Flight Jobs */}
                {(job.state === 'QUEUED' ||
                  job.state === 'RENDERING' ||
                  job.state === 'UPLOADING' ||
                  job.state === 'ANALYZING' ||
                  job.state === 'PLANNING') && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-transform duration-300 origin-left"
                      style={{
                        transform: `scaleX(${Math.max(
                          0.04,
                          Math.min(1, job.progressPercent / 100)
                        )})`,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
